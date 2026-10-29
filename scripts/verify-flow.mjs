import {generateKeyPairSync, sign} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../backend/server.mjs';
import {DEVNET_GENESIS} from '../backend/rpc.mjs';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = BigInt('0x' + bytes.toString('hex')), s = '';
  while (n) { s = alphabet[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b) break; s = '1' + s; }
  return s;
}

const temp = await mkdtemp(join(tmpdir(), 'rillvane-verify-'));
const pair = generateKeyPairSync('ed25519');
const wallet = base58(pair.publicKey.export({format: 'der', type: 'spki'}).subarray(-32));
const app = createApplication({
  dbPath: join(temp, 'app.sqlite'),
  origin: 'http://localhost:8787',
  faucetLimit: {USDC: '20000', RLVN: '200'},
  fetchRpc: async (_, request) => {
    const {method} = JSON.parse(request.body);
    return {ok: true, json: async () => ({result: method === 'getGenesisHash' ? DEVNET_GENESIS : method === 'getLatestBlockhash' ? {value: {blockhash: '1'.repeat(32), lastValidBlockHeight: 1}} : {value: []}})};
  }
});
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + app.server.address().port;
let cookie = '';
async function request(path, body, headers = {}) {
  const response = await fetch(url + path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: {
      Origin: 'http://localhost:8787',
      ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
      ...(cookie ? {Cookie: cookie} : {}),
      ...headers
    },
    ...(body !== undefined ? {body: JSON.stringify(body)} : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error((data.error || response.status) + ' ' + path);
  return data;
}
async function settle(kind, body, key) {
  const headers = {'idempotency-key': key};
  const quote = kind === 'faucet'
    ? await request('/api/v1/faucet/claims', body, headers)
    : await request('/api/v1/quotes/' + kind, body);
  if (kind !== 'faucet' && !quote.quoteId) throw new Error('quote missing id ' + JSON.stringify(quote));
  const intent = kind === 'faucet' ? quote : await request('/api/v1/intents', {quoteId: quote.quoteId}, headers);
  const prepared = await request('/api/v1/intents/' + intent.id + '/prepare', {});
  const signature = sign(null, Buffer.from(prepared.message), pair.privateKey).toString('base64');
  return request('/api/v1/intents/' + intent.id + '/submission', {signature});
}
try {
  const health = await request('/api/health');
  if (!health.ok) throw new Error('health failed');
  const challenge = await request('/api/auth/challenge', {wallet});
  const auth = await fetch(url + '/api/auth/verify', {
    method: 'POST',
    headers: {Origin: 'http://localhost:8787', 'Content-Type': 'application/json'},
    body: JSON.stringify({nonce: challenge.nonce, signature: sign(null, Buffer.from(challenge.message), pair.privateKey).toString('base64')})
  });
  cookie = auth.headers.get('set-cookie').split(';')[0];
  await settle('faucet', {asset: 'USDC', amountIn: '20000'}, 'verify-faucet-usdc');
  await settle('faucet', {asset: 'RLVN', amountIn: '200'}, 'verify-faucet-rlvn');
  await settle('supply', {asset: 'USDC', amountIn: '10000'}, 'verify-supply');
  await settle('swap', {side: 'buy', amountIn: '100'}, 'verify-swap');
  await settle('credit', {action: 'add', amountIn: '100'}, 'verify-add');
  await settle('credit', {action: 'borrow', amountIn: '4000'}, 'verify-borrow');
  await settle('credit', {action: 'repay', amountIn: '4000'}, 'verify-repay');
  await settle('credit', {action: 'remove', amountIn: '100'}, 'verify-remove');
  const portfolio = await request('/api/v1/me/portfolio');
  const shares = portfolio.shares?.USDC || '0';
  if (Number(shares) > 0) await settle('withdraw', {asset: 'USDC', amountIn: shares}, 'verify-withdraw');
  const done = await request('/api/v1/me/portfolio');
  process.stdout.write(JSON.stringify({event: 'verify.ok', wallet, balances: done.balances, supplied: done.supplied, debt: done.debt}) + '\n');
} finally {
  await app.close();
  await rm(temp, {recursive: true, force: true});
}
