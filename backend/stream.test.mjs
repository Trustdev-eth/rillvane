import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes, generateKeyPairSync, sign} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEVNET_GENESIS} from './rpc.mjs';
import {createApplication} from './server.mjs';
import {decodeFrame, encodeFrame} from './websocket.mjs';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = BigInt('0x' + bytes.toString('hex')), s = '';
  while (n) { s = alphabet[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b) break; s = '1' + s; }
  return s;
}

function openStream(url, {origin = 'http://localhost:8787', cookie} = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const key = randomBytes(16).toString('base64');
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: '/api/v1/stream',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        Origin: origin,
        ...(cookie ? {Cookie: cookie} : {})
      }
    });
    req.on('response', res => {
      const error = new Error('upgrade rejected');
      error.status = res.statusCode;
      reject(error);
    });
    req.on('upgrade', (_res, socket, head) => {
      let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0);
      const queued = [];
      const waiters = [];
      const pump = () => {
        while (true) {
          const frame = decodeFrame(buf);
          if (!frame) break;
          buf = frame.rest;
          if (frame.opcode === 1) {
            const msg = JSON.parse(frame.payload.toString());
            if (waiters.length) waiters.shift()(msg);
            else queued.push(msg);
          }
        }
      };
      socket.on('data', chunk => { buf = Buffer.concat([buf, chunk]); pump(); });
      if (buf.length) pump();
      resolve({
        send(obj) { socket.write(encodeFrame(JSON.stringify(obj), {masked: true})); },
        next() { return queued.length ? Promise.resolve(queued.shift()) : new Promise(resolveNext => waiters.push(resolveNext)); },
        close() { socket.destroy(); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('websocket frames round-trip with masking', () => {
  const encoded = encodeFrame('{"op":"hello"}', {masked: true});
  const decoded = decodeFrame(encoded);
  assert.equal(decoded.opcode, 1);
  assert.equal(decoded.masked, true);
  assert.equal(decoded.payload.toString(), '{"op":"hello"}');
  assert.equal(decoded.rest.length, 0);
});

test('market stream snapshots price, token info and private account status', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'rillvane-stream-')), dbPath = join(temp, 'test.sqlite');
  let clock = Date.now();
  const options = {
    dbPath, origin: 'http://localhost:8787', now: () => clock, faucetLimit: {USDC: '10000', RLVN: '100'},
    fetchRpc: async (_, request) => {
      const {method} = JSON.parse(request.body);
      return {
        ok: true,
        json: async () => ({
          result: method === 'getGenesisHash' ? DEVNET_GENESIS
            : method === 'getBalance' ? {value: 1250000000}
            : method === 'getLatestBlockhash' ? {value: {blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 99}}
            : {value: []}
        })
      };
    }
  };
  const app = createApplication(options);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => { await app.close(); await rm(temp, {recursive: true, force: true}); });

  const pair = generateKeyPairSync('ed25519');
  const wallet = base58(pair.publicKey.export({format: 'der', type: 'spki'}).subarray(-32));
  async function request(path, body, headers = {}) {
    const response = await fetch(url + path, {
      method: body ? 'POST' : 'GET',
      headers: {Origin: options.origin, ...(body ? {'Content-Type': 'application/json'} : {}), ...headers},
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    return {response, data: await response.json()};
  }

  const upgradeRequired = await request('/api/v1/stream');
  assert.equal(upgradeRequired.response.status, 426);

  await assert.rejects(() => openStream(url, {origin: 'https://elsewhere.example'}), error => error.status === 403);

  const challenge = (await request('/api/auth/challenge', {wallet})).data;
  const auth = await request('/api/auth/verify', {
    nonce: challenge.nonce,
    signature: sign(null, Buffer.from(challenge.message), pair.privateKey).toString('base64')
  });
  assert.equal(auth.response.status, 200);
  const cookie = auth.response.headers.get('set-cookie').split(';')[0];

  const faucet = await request('/api/v1/faucet/claims', {asset: 'USDC', amountIn: '10000'}, {Cookie: cookie, 'Idempotency-Key': 'stream-faucet'});
  const prepared = await request('/api/v1/intents/' + faucet.data.id + '/prepare', {}, {Cookie: cookie});
  await request('/api/v1/intents/' + faucet.data.id + '/submission', {
    signature: sign(null, Buffer.from(prepared.data.message), pair.privateKey).toString('base64')
  }, {Cookie: cookie});

  const stream = await openStream(url, {cookie});
  stream.send({op: 'hello', lastSeq: 0, interval: '1h', topics: ['market', 'pool', 'token', 'trades', 'candles', 'account']});
  const snapshot = await stream.next();
  assert.equal(snapshot.type, 'snapshot');
  assert.equal(snapshot.source, 'rillvane');
  assert.ok(snapshot.market.price > 0);
  assert.equal(snapshot.token.symbol, 'RLVN');
  assert.equal(snapshot.token.quote, 'USDC');
  assert.equal(snapshot.account.wallet, wallet);
  assert.equal(snapshot.account.portfolio.balances.USDC, '10000');
  stream.close();
});
