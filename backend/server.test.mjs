import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEVNET_GENESIS} from './rpc.mjs';
import {createApplication} from './server.mjs';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = BigInt('0x' + bytes.toString('hex')), s = '';
  while (n) { s = alphabet[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b) break; s = '1' + s; }
  return s;
}

test('wallet authentication, protocol API and execution guard', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'rillvane-test-')), dbPath = join(temp, 'test.sqlite');
  let clock = Date.now(), rpcCalls = [];
  const options = {
    dbPath, origin: 'http://localhost:8787', now: () => clock, faucetLimit: {USDC: '10000', RLVN: '100'},
    fetchRpc: async (_, request) => {
      const {method, params} = JSON.parse(request.body);
      rpcCalls.push({method, params});
      return {
        ok: true,
        json: async () => ({
          result: method === 'getGenesisHash' ? DEVNET_GENESIS
            : method === 'getBalance' ? {value: 1250000000}
            : method === 'getLatestBlockhash' ? {value: {blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 99}}
            : method === 'getSignatureStatuses' ? {value: [{confirmationStatus: 'finalized', err: null}]}
            : method === 'getTransaction' ? {slot: 42, meta: {err: null}, transaction: {message: {accountKeys: [{pubkey: wallet, signer: true}]}}}
            : {value: []}
        })
      };
    }
  };
  let app = createApplication(options), cookie = '', url;
  async function listen() {
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    url = 'http://127.0.0.1:' + app.server.address().port;
  }
  async function request(path, body, headers = {}) {
    const response = await fetch(url + path, {
      method: body ? 'POST' : 'GET',
      headers: {Origin: options.origin, ...(body ? {'Content-Type': 'application/json'} : {}), ...(cookie ? {Cookie: cookie} : {}), ...headers},
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    return {response, data: await response.json()};
  }
  await listen();
  const pair = generateKeyPairSync('ed25519'), wallet = base58(pair.publicKey.export({format: 'der', type: 'spki'}).subarray(-32));
  t.after(async () => { await app.close(); await rm(temp, {recursive: true, force: true}); });

  async function signSubmit(intentPath, message) {
    const signature = sign(null, Buffer.from(message), pair.privateKey).toString('base64');
    return request(intentPath + '/submission', {signature});
  }

  await t.test('rejects cross-origin writes and invalid addresses', async () => {
    assert.equal((await request('/api/auth/challenge', {wallet}, {Origin: 'https://elsewhere.example'})).response.status, 403);
    assert.equal((await request('/api/auth/challenge', {wallet: 'not-a-key'})).response.status, 400);
    assert.equal((await request('/api/account')).response.status, 401);
  });

  await t.test('verifies domain-bound Ed25519 challenge and blocks replay', async () => {
    const challenge = (await request('/api/auth/challenge', {wallet})).data;
    assert.match(challenge.message, /http:\/\/localhost:8787/);
    assert.match(challenge.message, /Wallet: /);
    assert.match(challenge.message, /Nonce: /);
    assert.doesNotMatch(challenge.message, /devnet|demo|simulat/i);
    const bad = await request('/api/auth/verify', {nonce: challenge.nonce, signature: Buffer.alloc(64).toString('base64')});
    assert.equal(bad.response.status, 401);
    const payload = {nonce: challenge.nonce, signature: sign(null, Buffer.from(challenge.message), pair.privateKey).toString('base64')};
    const auth = await request('/api/auth/verify', payload);
    assert.equal(auth.response.status, 200);
    const header = auth.response.headers.get('set-cookie');
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Strict/);
    cookie = header.split(';')[0];
    assert.equal((await request('/api/auth/verify', payload)).response.status, 401);
    assert.equal((await request('/api/account')).data.wallet, wallet);
    assert.equal((await request('/api/account')).data.state.wallet.USDC, 0);
    assert.equal((await request('/api/health')).data.ok, true);
    assert.equal((await request('/api/health')).data.cluster, undefined);
  });

  await t.test('faucet, supply, swap, credit and withdraw through signed intents', async () => {
    const faucet = await request('/api/v1/faucet/claims', {asset: 'USDC', amountIn: '20000'}, {'Idempotency-Key': 'faucet-usdc-1'});
    assert.equal(faucet.response.status, 422);
    const faucetOk = await request('/api/v1/faucet/claims', {asset: 'USDC', amountIn: '10000'}, {'Idempotency-Key': 'faucet-usdc-ok'});
    assert.equal(faucetOk.response.status, 200);
    const prepared = await request('/api/v1/intents/' + faucetOk.data.id + '/prepare', {});
    assert.equal(prepared.response.status, 200);
    assert.ok(prepared.data.message);
    const applied = await signSubmit('/api/v1/intents/' + faucetOk.data.id, prepared.data.message);
    assert.equal(applied.response.status, 200);
    assert.equal(applied.data.portfolio.balances.USDC, '10000');

    const rlvn = await request('/api/v1/faucet/claims', {asset: 'RLVN', amountIn: '100'}, {'Idempotency-Key': 'faucet-rlvn-ok'});
    const rlvnPrep = await request('/api/v1/intents/' + rlvn.data.id + '/prepare', {});
    await signSubmit('/api/v1/intents/' + rlvn.data.id, rlvnPrep.data.message);

    const supplyQuote = await request('/api/v1/quotes/supply', {asset: 'USDC', amountIn: '4000'});
    assert.equal(supplyQuote.response.status, 200);
    const supplyIntent = await request('/api/v1/intents', {quoteId: supplyQuote.data.quoteId}, {'Idempotency-Key': 'supply-usdc-1'});
    const supplyPrep = await request('/api/v1/intents/' + supplyIntent.data.id + '/prepare', {});
    const supplied = await signSubmit('/api/v1/intents/' + supplyIntent.data.id, supplyPrep.data.message);
    assert.equal(supplied.response.status, 200);
    assert.ok(Number(supplied.data.portfolio.supplied.USDC) > 0);

    const replay = await request('/api/v1/intents', {quoteId: supplyQuote.data.quoteId}, {'Idempotency-Key': 'supply-usdc-1'});
    assert.equal(replay.data.id, supplyIntent.data.id);
    assert.equal((await request('/api/v1/intents', {kind: 'supply', asset: 'USDC', amountIn: '1'}, {'Idempotency-Key': 'supply-usdc-1'})).response.status, 409);

    const swapQuote = await request('/api/v1/quotes/swap', {side: 'buy', amountIn: '100', slippageBps: 50});
    assert.equal(swapQuote.response.status, 200);
    assert.ok(Number(swapQuote.data.amountOut) > 0);
    assert.ok(Number(swapQuote.data.minOut) < Number(swapQuote.data.amountOut));
    assert.equal((await request('/api/v1/quotes/swap', {side:'buy', amountIn:'100', slippageBps:-1})).response.status,422);
    const swapIntent = await request('/api/v1/intents', {quoteId: swapQuote.data.quoteId}, {'Idempotency-Key': 'swap-buy-1'});
    const swapPrep = await request('/api/v1/intents/' + swapIntent.data.id + '/prepare', {});
    const swapped = await signSubmit('/api/v1/intents/' + swapIntent.data.id, swapPrep.data.message);
    assert.equal(swapped.response.status, 200);
    assert.ok(Number(swapped.data.portfolio.balances.RLVN) > 100);
    const snapshot = await request('/api/account');
    assert.ok(snapshot.data.state.supplied.usdc > snapshot.data.state.deposits.usdc);

    const addQuote = await request('/api/v1/quotes/credit', {action: 'add', amountIn: '50'});
    const addIntent = await request('/api/v1/intents', {quoteId: addQuote.data.quoteId}, {'Idempotency-Key': 'credit-add-1'});
    const addPrep = await request('/api/v1/intents/' + addIntent.data.id + '/prepare', {});
    await signSubmit('/api/v1/intents/' + addIntent.data.id, addPrep.data.message);

    const borrowQuote = await request('/api/v1/quotes/credit', {action: 'borrow', amountIn: '2000'});
    const borrowIntent = await request('/api/v1/intents', {quoteId: borrowQuote.data.quoteId}, {'Idempotency-Key': 'credit-borrow-1'});
    const borrowPrep = await request('/api/v1/intents/' + borrowIntent.data.id + '/prepare', {});
    const borrowed = await signSubmit('/api/v1/intents/' + borrowIntent.data.id, borrowPrep.data.message);
    assert.equal(borrowed.response.status, 200);
    assert.ok(Number(borrowed.data.portfolio.debt) >= 2000);

    const overBorrow = await request('/api/v1/quotes/credit', {action: 'borrow', amountIn: '100000'});
    assert.equal(overBorrow.response.status, 422);

    await app.close();
    app = createApplication(options);
    await listen();
    const restored = await request('/api/v1/me/portfolio');
    assert.equal(restored.response.status, 200);
    assert.ok(Number(restored.data.debt) >= 2000);
  });

  await t.test('reads chain balances without labelling the cluster', async () => {
    rpcCalls = [];
    const result = await request('/api/wallet');
    assert.equal(result.response.status, 200);
    assert.equal(result.data.sol, 1.25);
    assert.equal(result.data.cluster, undefined);
    assert.equal(result.data.execution, undefined);
    assert.ok(rpcCalls.filter(c => c.method !== 'getGenesisHash').every(c => c.params[0] === wallet));
    assert.equal((await request('/api/mainnet/swap', {})).response.status, 404);
    assert.equal((await request('/api/demo/action', {})).response.status, 404);
    const health = await request('/api/health');
    assert.equal(health.data.ok, true);
    assert.equal(health.data.execution, undefined);
    const markets = await request('/api/v1/markets');
    assert.equal(markets.data.items[0].base, 'RLVN');
    assert.equal(markets.data.items[0].quote, 'USDC');
  });

  await t.test('scopes transaction tracking, notifications and acknowledgements to authenticated wallets', async () => {
    const tracked = await request('/api/chain/transactions', {signature: '2'.repeat(88)});
    assert.equal(tracked.response.status, 202);
    const txId = tracked.data.transaction.id;
    assert.equal((await request('/api/chain/transactions', {signature: '2'.repeat(88)})).data.transaction.id, txId);
    await app.worker.tick();
    const items = (await request('/api/chain/transactions')).data.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].state, 'finalized');
    assert.equal(items[0].ownershipVerified, true);
    const notices = (await request('/api/notifications')).data.items;
    assert.ok(notices.length >= 1);
    const chainNotice = notices.find(n => n.kind === 'finalized');
    assert.ok(chainNotice);
    const firstCookie = cookie;
    const other = generateKeyPairSync('ed25519'), otherWallet = base58(other.publicKey.export({format: 'der', type: 'spki'}).subarray(-32));
    const challenge = (await request('/api/auth/challenge', {wallet: otherWallet})).data;
    const auth = await request('/api/auth/verify', {nonce: challenge.nonce, signature: sign(null, Buffer.from(challenge.message), other.privateKey).toString('base64')});
    cookie = auth.response.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/chain/transactions')).data.items.length, 0);
    assert.equal((await request('/api/notifications')).data.items.length, 0);
    assert.equal((await request('/api/notifications/read', {id: chainNotice.id})).response.status, 200);
    cookie = firstCookie;
    assert.equal((await request('/api/notifications')).data.items.find(n => n.id === chainNotice.id).read_at, null);
    await request('/api/notifications/read', {id: chainNotice.id});
    assert.ok((await request('/api/notifications')).data.items.find(n => n.id === chainNotice.id).read_at);
    assert.equal((await request('/api/chain/transactions', {signature: 'not-valid'})).response.status, 422);
  });

  await t.test('expires challenges and logs out sessions', async () => {
    const challenge = (await request('/api/auth/challenge', {wallet})).data;
    clock += 300001;
    assert.equal((await request('/api/auth/verify', {nonce: challenge.nonce, signature: sign(null, Buffer.from(challenge.message), pair.privateKey).toString('base64')})).response.status, 401);
    assert.equal((await request('/api/auth/logout', {})).response.status, 200);
    assert.equal((await request('/api/account')).response.status, 401);
  });
});
