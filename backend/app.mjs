import {audit, rateLimit, digest, atomic} from './db-util.mjs';
import {createRpc} from './rpc.mjs';
import {trackTransaction, publicTransaction} from './transactions.mjs';
import {createProtocolWorker} from './workers.mjs';
import {timingSafeEqual} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {decodePublicKey, challengeMessage, verifyEd25519, tokenHash, randomToken} from './auth.mjs';
import {
  ensureProtocol, publicMarket, publicPool, createQuote, createIntent, prepareIntent,
  getIntent, applySignedIntent, attachSignature, portfolio, workspaceState, listActivity,
  listTrades, listCandles, faucetStatus, ProtocolError, MARKET_ID
} from './protocol.mjs';
import {
  chainConfigured, createChainRpc, sendIx, protocolPdas, ataAddress, userPda,
  createAtaIdempotent, faucetMintIx, swapIx, supplyIx, withdrawIx, creditIx, unsignedTransaction,
  readUserNonce
} from './chain.mjs';
import {createStreamHub} from './stream.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };

function securityHeaders(publicOrigin) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  };
  if (publicOrigin.startsWith('https:')) headers['Strict-Transport-Security'] = 'max-age=31536000';
  return headers;
}

function jsonResponse(status, data, extra = {}, publicOrigin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...securityHeaders(publicOrigin),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra
    }
  });
}

export function createApplication({
  db,
  origin = 'http://localhost:8787',
  rpcUrl = 'https://api.devnet.solana.com',
  fetchRpc = fetch,
  now = () => Date.now(),
  rpcUrls,
  opsToken = '',
  workerEnabled = false,
  logger = () => {},
  registry,
  keys = null,
  faucetLimit = {USDC: '10000', RLVN: '100'},
  production = false,
  streamTimers = true
} = {}) {
  if (!db) throw new Error('Database is required.');
  if (!registry) throw new Error('Protocol registry is required.');
  const originLock = origin ? new URL(origin).origin : '';
  let currentPublicOrigin = originLock || 'http://localhost:8787';
  const log = entry => { try { logger(entry); } catch {} };
  const rpcClient = createRpc({urls: rpcUrls || [rpcUrl], fetchRpc, now});
  log({event: 'rpc.configured', host: new URL((rpcUrls || [rpcUrl])[0]).host});
  const writeRpc = chainConfigured(registry) ? createChainRpc((rpcUrls || [rpcUrl])[0], fetchRpc) : null;
  let closing = false, closePromise, readyPromise, readyAt = 0, readyResult = null;
  const metrics = {requests: 0, errors: 0, durationMs: 0, rateLimited: 0};
  const worker = createProtocolWorker({db, rpc: rpcClient, now, log, faucetLimit, registry, keys, chainRpc: writeRpc});
  if (workerEnabled) worker.start();
  ensureProtocol(db, now());
  const stream = createStreamHub({
    db, now, faucetLimit, origin: () => currentPublicOrigin, log, autoStart: streamTimers
  });

  const ready = async () => {
    if (closing) return false;
    if (readyResult !== null && now() - readyAt < 10000) return readyResult;
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      try {
        db.prepare('SELECT 1 AS ok').get();
        await rpcClient.check();
        readyResult = true;
      } catch (error) {
        log({level: 'error', event: 'ready.failed', error: error.message, cause: error.cause});
        readyResult = false;
      } finally {
        readyAt = now();
        readyPromise = null;
      }
      return readyResult;
    })();
    return readyPromise;
  };

  const rpc = (method, params) => rpcClient.read(method, params);

  function protocolAccounts(wallet) {
    const pdas = protocolPdas(registry.programId);
    return {
      pdas,
      user: userPda(registry.programId, wallet).address,
      userBase: ataAddress(registry.baseMint, wallet).address,
      userQuote: ataAddress(registry.quoteMint, wallet).address
    };
  }

  function instructionForAction(wallet, action, nonce, deadline) {
    const {pdas, user, userBase, userQuote} = protocolAccounts(wallet);
    const amount = BigInt(action.amountIn);
    if (action.kind === 'swap') {
      return swapIx(
        registry.programId, registry, pdas, wallet, user, userBase, userQuote,
        amount, action.side !== 'sell', BigInt(action.minOut || 0), nonce, deadline
      );
    }
    if (action.kind === 'supply' || action.kind === 'withdraw') {
      const base = action.asset === 'RLVN';
      const token = base ? userBase : userQuote;
      const vault = base ? registry.baseVault : registry.quoteVault;
      const build = action.kind === 'supply' ? supplyIx : withdrawIx;
      return build(registry.programId, pdas, wallet, user, token, vault, amount, base);
    }
    if (action.kind === 'credit') {
      return creditIx(registry.programId, pdas, registry, wallet, user, userBase, userQuote, action.action, amount);
    }
    throw new Error('Unsupported on-chain action.');
  }

  async function buildUserTransaction(wallet, intentId, blockhash) {
    const row = db.prepare('SELECT * FROM intents WHERE id=? AND wallet=?').get(intentId, wallet);
    const action = JSON.parse(row.payload);
    const {userBase, userQuote} = protocolAccounts(wallet);
    const nonce = action.kind === 'swap' ? await readUserNonce(writeRpc, registry.programId, wallet) : 0n;
    const deadline = Math.floor(Date.now() / 1000) + 90;
    const instructions = [
      createAtaIdempotent(wallet, userBase, wallet, registry.baseMint),
      createAtaIdempotent(wallet, userQuote, wallet, registry.quoteMint),
      instructionForAction(wallet, action, nonce, deadline)
    ];
    return unsignedTransaction({
      feePayer: wallet,
      blockhash: blockhash.blockhash || blockhash,
      instructions
    }).wire.toString('base64');
  }

  async function sendFaucetMint(wallet, action) {
    const mint = action.asset === 'RLVN' ? registry.baseMint : registry.quoteMint;
    const dest = ataAddress(mint, wallet).address;
    const pdas = protocolPdas(registry.programId);
    return sendIx(writeRpc, {
      feePayer: keys.deployer,
      signers: [keys.deployer, keys.faucet],
      instructions: [
        createAtaIdempotent(keys.deployer.publicKey, dest, wallet, mint),
        faucetMintIx(registry.programId, pdas, keys.faucet.publicKey, mint, dest, BigInt(action.amountIn), action.asset === 'RLVN')
      ]
    });
  }

  function adoptOrigin(request) {
    currentPublicOrigin = originLock || new URL(request.url).origin;
    return currentPublicOrigin;
  }

  async function handleFetch(request, {ip = 'unknown'} = {}) {
    const requestId = randomUUID(), started = performance.now();
    metrics.requests++;
    const publicOrigin = adoptOrigin(request);
    const json = (status, data, extra = {}) => {
      const response = jsonResponse(status, data, {'X-Request-Id': requestId, ...extra}, publicOrigin);
      const duration = performance.now() - started;
      metrics.durationMs += duration;
      if (status >= 400) metrics.errors++;
      log({level: status >= 500 ? 'error' : 'info', event: 'http.request', requestId, method: request.method, status, durationMs: Math.round(duration)});
      return response;
    };
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/livez') return json(200, {ok: !closing});
      if (path === '/readyz') {
        const ok = await ready();
        return json(ok ? 200 : 503, {ok, ...(ok ? {} : {rpc: rpcClient.stats().lastError || 'unverified'})});
      }
      if (!path.startsWith('/api/')) return null;
      if (closing) fail(503, 'Service is shutting down. Retry later.');
      const timestamp = now();
      const clientIp = ip || request.headers.get('x-rillvane-ip') || 'unknown';
      const bucket = path.startsWith('/api/auth/') ? 'auth' : 'api';
      const limit = rateLimit(db, digest(clientIp + ':' + bucket), bucket === 'auth' ? 24 : 120, timestamp);
      if (!limit.allowed) {
        metrics.rateLimited++;
        throw Object.assign(new Error('Too many requests. Try again later.'), {status: 429, retryAfter: limit.retryAfter});
      }
      let body = {};
      if (request.method === 'POST') {
        if (request.headers.get('origin') !== publicOrigin) fail(403, 'Request origin does not match this application.');
        if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Use application/json.');
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 16384) fail(413, 'Request too large.');
        try { body = JSON.parse(raw); } catch { fail(400, 'Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Expected a JSON object.');
      }
      const authenticate = () => {
        const token = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('rv_session='))?.slice(11);
        const session = token && db.prepare('SELECT wallet FROM sessions WHERE token_hash=? AND expires>?').get(tokenHash(token), timestamp);
        if (!session) fail(401, 'Connect and sign in with your wallet.');
        return session.wallet;
      };
      const requireOps = () => {
        if (!opsToken) fail(404, 'API endpoint not found.');
        const provided = String(request.headers.get('authorization') || '').replace(/^Bearer /, '');
        const a = Buffer.from(digest(provided)), b = Buffer.from(digest(opsToken));
        if (!timingSafeEqual(a, b)) fail(401, 'Operator authentication required.');
      };
      const requireIdempotency = () => {
        const key = request.headers.get('idempotency-key');
        if (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key)) fail(400, 'Provide an Idempotency-Key (8–100 letters, numbers or dashes).');
        return key;
      };
      const cookie = (token, maxAge) =>
        `rv_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${publicOrigin.startsWith('https:') ? '; Secure' : ''}`;

      if (request.method === 'GET' && path === '/api/ops/metrics') {
        requireOps();
        const stats = rpcClient.stats(), queue = worker.health();
        const values = {
          rillvane_http_requests_total: metrics.requests,
          rillvane_http_errors_total: metrics.errors,
          rillvane_http_duration_milliseconds_total: Math.round(metrics.durationMs),
          rillvane_rate_limited_total: metrics.rateLimited,
          rillvane_rpc_attempts_total: stats.attempts,
          rillvane_rpc_failures_total: stats.failures,
          rillvane_queue_pending: queue.pending,
          rillvane_queue_exhausted: queue.exhausted,
          rillvane_worker_heartbeat_seconds: Math.floor(queue.heartbeat / 1000),
          rillvane_stream_clients: stream.clientCount()
        };
        return new Response(Object.entries(values).map(([k, v]) => k + ' ' + v + '\n').join(''), {
          status: 200,
          headers: {
            ...securityHeaders(publicOrigin),
            'X-Request-Id': requestId,
            'content-type': 'text/plain; version=0.0.4; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      }
      if (request.method === 'GET' && path === '/api/ops/audit') {
        requireOps();
        const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
        if (!Number.isSafeInteger(before) || before < 1) fail(422, 'Invalid cursor.');
        const rows = db.prepare('SELECT * FROM audit WHERE id<? ORDER BY id DESC LIMIT 100').all(before);
        return json(200, {items: rows.map(row => ({...row, detail: JSON.parse(row.detail)})), nextCursor: rows.length === 100 ? rows.at(-1).id : null});
      }
      if (request.method === 'GET' && path === '/api/health') return json(200, {ok: true, brand: 'Rillvane'});
      if (request.method === 'GET' && (path === '/api/v1/stream' || path === '/stream')) {
        return json(426, {error: 'Upgrade to WebSocket.', path: '/api/v1/stream'}, {Upgrade: 'websocket'});
      }
      if (request.method === 'GET' && (path === '/api/v1/config' || path === '/api/v1/markets' || path === '/api/markets')) {
        const market = publicMarket(ensureProtocol(db, timestamp), timestamp);
        if (path === '/api/v1/config') {
          return json(200, {
            market: market.id,
            programId: registry.programId,
            baseMint: registry.baseMint,
            quoteMint: registry.quoteMint,
            decimals: 6,
            ltvBps: 5000,
            liquidationBps: 6000,
            feeBps: 10,
            borrowApr: 8
          });
        }
        return json(200, {items: [market]});
      }
      if (request.method === 'GET' && path === '/api/v1/markets/' + MARKET_ID) {
        return json(200, publicMarket(ensureProtocol(db, timestamp), timestamp));
      }
      if (request.method === 'GET' && path === '/api/v1/pool') {
        return json(200, publicPool(ensureProtocol(db, timestamp)));
      }
      if (request.method === 'GET' && path === '/api/v1/trades') return json(200, listTrades(db));
      if (request.method === 'GET' && path === '/api/v1/candles') {
        return json(200, listCandles(db, url.searchParams.get('interval') || '1h', timestamp, {end: url.searchParams.get('end'), count: url.searchParams.get('count')}));
      }

      if (request.method === 'POST' && path === '/api/auth/challenge') {
        decodePublicKey(body.wallet);
        db.prepare('DELETE FROM challenges WHERE expires<?').run(timestamp);
        db.prepare('DELETE FROM sessions WHERE expires<?').run(timestamp);
        if (!rateLimit(db, digest('challenge:' + body.wallet), 8, timestamp).allowed) fail(429, 'Too many sign-in requests for this wallet.');
        const nonce = randomToken(), expires = timestamp + 300000;
        const message = challengeMessage(publicOrigin, body.wallet, nonce);
        db.prepare('INSERT INTO challenges VALUES(?,?,?,?)').run(nonce, body.wallet, message, expires);
        return json(200, {nonce, message, expires});
      }
      if (request.method === 'POST' && path === '/api/auth/verify') {
        if (typeof body.nonce !== 'string' || typeof body.signature !== 'string' || body.signature.length > 100) fail(400, 'Invalid sign-in response.');
        const challenge = db.prepare('SELECT * FROM challenges WHERE nonce=?').get(body.nonce);
        if (!challenge || challenge.expires <= timestamp) fail(401, 'Sign-in challenge expired or already used.');
        if (!verifyEd25519(challenge.wallet, challenge.message, body.signature)) fail(401, 'Wallet signature is invalid.');
        const token = randomToken();
        atomic(db, () => {
          db.prepare('DELETE FROM challenges WHERE nonce=?').run(body.nonce);
          db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token), challenge.wallet, timestamp + 86400000);
        });
        audit(db, {event: 'auth.sign_in', wallet: challenge.wallet, requestId, time: timestamp});
        db.prepare('DELETE FROM sessions WHERE token_hash IN(SELECT token_hash FROM sessions WHERE wallet=? ORDER BY expires DESC LIMIT -1 OFFSET 5)').run(challenge.wallet);
        ensureProtocol(db, timestamp);
        const state = workspaceState(db, challenge.wallet, timestamp);
        return json(200, {wallet: challenge.wallet, state, revision: Number(state.nonce)}, {'Set-Cookie': cookie(token, 86400)});
      }
      if (request.method === 'POST' && path === '/api/auth/logout') {
        const wallet = authenticate();
        const token = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('rv_session='))?.slice(11);
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
        audit(db, {event: 'auth.sign_out', wallet, requestId, time: timestamp});
        return json(200, {ok: true, wallet}, {'Set-Cookie': cookie('', 0)});
      }
      if (request.method === 'GET' && path === '/api/account') {
        const wallet = authenticate();
        const state = workspaceState(db, wallet, timestamp);
        return json(200, {wallet, state, revision: Number(state.nonce)});
      }
      if (path === '/api/chain/transactions' && request.method === 'POST') {
        const wallet = authenticate();
        const tx = trackTransaction(db, wallet, body.signature, timestamp, requestId);
        return json(202, {transaction: publicTransaction(tx)});
      }
      if (path === '/api/chain/transactions' && request.method === 'GET') {
        const wallet = authenticate();
        const rows = db.prepare('SELECT * FROM chain_transactions WHERE wallet=? ORDER BY created DESC,id DESC LIMIT 50').all(wallet);
        return json(200, {items: rows.map(publicTransaction)});
      }
      if (path === '/api/notifications' && request.method === 'GET') {
        const wallet = authenticate();
        const after = Number(url.searchParams.get('after') || 0);
        if (!Number.isSafeInteger(after) || after < 0) fail(422, 'Invalid notification cursor.');
        const items = db.prepare('SELECT id,kind,message,created,read_at FROM notifications WHERE wallet=? AND id>? ORDER BY id LIMIT 50').all(wallet, after);
        return json(200, {items, nextCursor: items.at(-1)?.id || after});
      }
      if (path === '/api/notifications/read' && request.method === 'POST') {
        const wallet = authenticate();
        if (!Number.isSafeInteger(body.id) || body.id < 1) fail(422, 'Invalid notification id.');
        db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND wallet=? AND read_at IS NULL').run(timestamp, body.id, wallet);
        return json(200, {ok: true});
      }
      if (request.method === 'GET' && path === '/api/wallet') {
        const wallet = authenticate();
        const [balance, classic, token2022] = await Promise.all([
          rpc('getBalance', [wallet, {commitment: 'confirmed'}]),
          rpc('getTokenAccountsByOwner', [wallet, {programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'}, {encoding: 'jsonParsed', commitment: 'confirmed'}]),
          rpc('getTokenAccountsByOwner', [wallet, {programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'}, {encoding: 'jsonParsed', commitment: 'confirmed'}])
        ]);
        return json(200, {wallet, lamports: balance.value, sol: balance.value / 1e9, tokens: [...classic.value, ...token2022.value].map(a => ({account: a.pubkey, ...a.account.data.parsed.info}))});
      }

      if (path.startsWith('/api/v1/')) {
        const wallet = authenticate();
        if (request.method === 'GET' && path === '/api/v1/me/portfolio') return json(200, portfolio(db, wallet, timestamp));
        if (request.method === 'GET' && path === '/api/v1/me/positions') return json(200, {state: workspaceState(db, wallet, timestamp)});
        if (request.method === 'GET' && path === '/api/v1/me/activity') return json(200, listActivity(db, wallet, url.searchParams.get('filter') || 'all'));
        if (request.method === 'GET' && path === '/api/v1/faucet/claims') return json(200, faucetStatus(db, wallet, timestamp, faucetLimit));
        if (request.method === 'POST' && path.startsWith('/api/v1/quotes/')) {
          const kind = path.slice('/api/v1/quotes/'.length);
          return json(200, createQuote(db, wallet, body, timestamp, kind, faucetLimit));
        }
        if (request.method === 'POST' && path === '/api/v1/intents') {
          const key = requireIdempotency();
          return json(200, createIntent(db, wallet, body, publicOrigin, timestamp, key));
        }
        const prepareMatch = path.match(/^\/api\/v1\/intents\/([^/]+)\/prepare$/);
        if (request.method === 'POST' && prepareMatch) {
          let blockhash = null;
          try {
            const latest = await rpc('getLatestBlockhash', [{commitment: 'confirmed'}]);
            blockhash = latest.value || latest;
          } catch { /* local engine still prepares the instruction message */ }
          const prepared = prepareIntent(db, wallet, prepareMatch[1], timestamp, blockhash);
          if (chainConfigured(registry) && writeRpc && prepared.kind !== 'faucet' && blockhash?.blockhash) {
            try {
              prepared.transaction = await buildUserTransaction(wallet, prepareMatch[1], blockhash);
            } catch (e) {
              log({level: 'error', event: 'chain.prepare', error: e.message});
            }
          }
          return json(200, prepared);
        }
        const submitMatch = path.match(/^\/api\/v1\/intents\/([^/]+)\/submission$/);
        if (request.method === 'POST' && submitMatch) {
          const intent = getIntent(db, wallet, submitMatch[1]);
          if (typeof body.signature !== 'string') fail(400, 'Provide the wallet signature.');
          if (!verifyEd25519(wallet, intent.message, body.signature)) fail(401, 'Wallet signature is invalid.');
          attachSignature(db, wallet, submitMatch[1], body.signature);
          if (chainConfigured(registry) && writeRpc && keys?.deployer && keys?.faucet) {
            const row = db.prepare('SELECT * FROM intents WHERE id=? AND wallet=?').get(submitMatch[1], wallet);
            const action = JSON.parse(row.payload);
            try {
              let signature;
              if (action.kind === 'faucet') {
                signature = (await sendFaucetMint(wallet, action)).signature;
              } else if (typeof body.signedTransaction === 'string') {
                signature = await writeRpc.call('sendTransaction', [
                  body.signedTransaction,
                  {encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed'}
                ]);
              } else {
                fail(400, 'Sign the prepared transaction with your wallet.');
              }
              if (signature) trackTransaction(db, wallet, signature, timestamp, requestId);
            } catch (e) {
              if (e.status) throw e;
              fail(503, e.message || 'On-chain submission failed.');
            }
          }
          const result = applySignedIntent(db, wallet, submitMatch[1], timestamp, faucetLimit);
          return json(200, result);
        }
        const intentMatch = path.match(/^\/api\/v1\/intents\/([^/]+)$/);
        if (request.method === 'GET' && intentMatch) return json(200, getIntent(db, wallet, intentMatch[1]));
        if (request.method === 'POST' && path === '/api/v1/faucet/claims') {
          const key = requireIdempotency();
          const quote = createQuote(db, wallet, {kind: 'faucet', asset: body.asset === 'RLVN' ? 'RLVN' : 'USDC', amountIn: body.amountIn || body.amount || (body.asset === 'RLVN' ? faucetLimit.RLVN : faucetLimit.USDC)}, timestamp, 'faucet', faucetLimit);
          const intent = createIntent(db, wallet, {quoteId: quote.quoteId}, publicOrigin, timestamp, key);
          return json(200, {...intent, quote});
        }
      }

      if (path.startsWith('/api/mainnet') || path === '/api/transactions' || path === '/api/demo/action') {
        return json(404, {error: 'API endpoint not found.'});
      }
      fail(404, 'API endpoint not found.');
    } catch (e) {
      if (e instanceof ProtocolError) return json(e.status || 422, {error: e.message, code: e.code, requestId});
      if (!e.status) log({level: 'error', event: 'http.internal_error', requestId, error: e.message});
      const status = e.status || 500;
      const extra = e.retryAfter ? {'Retry-After': String(e.retryAfter)} : {};
      return json(status, {error: e.status ? e.message : 'The server could not complete this request.', requestId}, extra);
    }
  }

  return {
    db,
    worker,
    stream,
    ready,
    handleFetch,
    adoptOrigin,
    origin: () => currentPublicOrigin,
    close: () => closePromise ??= (async () => {
      closing = true;
      stream.stop();
      await worker.stop();
      db.close();
    })()
  };
}
