import {digest, rateLimit} from './db-util.mjs';
import {tokenHash} from './auth.mjs';
import {
  ensureProtocol, publicMarket, publicPool, portfolio, workspaceState,
  listTrades, listCandles, faucetStatus, MARKET_ID
} from './protocol.mjs';
import {
  acceptKey, attachWebSocket, handshakeResponse, isWebSocketRequest
} from './websocket.mjs';

const PUBLIC_TOPICS = new Set(['market', 'pool', 'token', 'trades', 'candles']);
const PRIVATE_TOPICS = new Set(['account', 'notices']);
const MAX_CLIENTS = 200;
const MAX_PER_IP = 16;
const RING = 64;
const TICK_MS = 1000;
const HELLO_MS = 5000;
const PING_MS = 20000;

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function accountIdentity(account) {
  const s = account?.state;
  if (!s) return '';
  return JSON.stringify({
    wallet: s.wallet,
    deposits: s.deposits,
    credit: s.credit,
    nonce: s.nonce,
    activity: (s.activity || []).map(row => row.id || row.time)
  });
}

function dayChange(db, price, now) {
  const day = listCandles(db, '1d', now, {count: 2});
  const open = Number(day.items?.[0]?.open);
  if (!Number.isFinite(open) || open <= 0) return 0;
  return Number((((Number(price) - open) / open) * 100).toFixed(2));
}

function lastCandle(db, interval, now) {
  const result = listCandles(db, interval, now, {count: 64});
  return {interval: result.interval, items: result.items, earliest: result.earliest, hasMore: result.hasMore};
}

function tokenInfo(market, pool, change) {
  return {
    symbol: market.base,
    quote: market.quote,
    market: market.id || MARKET_ID,
    price: market.price,
    change,
    oracleTime: market.oracleTime,
    oracleSlot: market.oracleSlot,
    stale: market.stale,
    decimals: market.decimals,
    feeBps: Number(pool.feeBps),
    maxImpactBps: Number(pool.maxImpactBps),
    reserveBps: Number(pool.reserveBps),
    ltvBps: 5000,
    liquidationBps: 6000,
    borrowApr: market.borrowApr,
    supplyApy: market.supplyApy,
    utilization: market.utilization,
    baseCash: market.baseCash,
    quoteCash: market.quoteCash,
    quoteDebt: market.quoteDebt,
    navQuote: pool.navQuote
  };
}

function publicSnapshot(db, now, interval) {
  const row = ensureProtocol(db, now);
  const market = publicMarket(row, now);
  const pool = publicPool(row);
  const change = dayChange(db, market.price, now);
  market.change = change;
  const trades = listTrades(db, 50);
  const candles = lastCandle(db, interval, now);
  return {
    market,
    pool,
    token: tokenInfo(market, pool, change),
    trades: trades.items,
    candles
  };
}

function accountSnapshot(db, wallet, now, faucetLimit) {
  if (!wallet) return null;
  return {
    wallet,
    portfolio: portfolio(db, wallet, now),
    state: workspaceState(db, wallet, now),
    faucet: faucetStatus(db, wallet, now, faucetLimit)
  };
}

function sessionWallet(db, cookieHeader, now) {
  const token = String(cookieHeader || '').split(';').map(s => s.trim()).find(s => s.startsWith('rv_session='))?.slice(11);
  if (!token) return null;
  const row = db.prepare('SELECT wallet FROM sessions WHERE token_hash=? AND expires>?').get(tokenHash(token), now);
  return row?.wallet || null;
}

export function createStreamHub({db, now = () => Date.now(), faucetLimit, origin, log = () => {}, autoStart = true} = {}) {
  const clients = new Set();
  const byIp = new Map();
  let seq = 0;
  const ring = [];
  let lastPublic = null;
  let lastTradeId = 0;
  let timer, pingTimer, closing = false;

  function nextSeq() {
    seq += 1;
    return seq;
  }

  function remember(topic, payload) {
    ring.push({seq, topic, payload});
    if (ring.length > RING) ring.shift();
  }

  function send(client, message) {
    try { client.ws.sendText(JSON.stringify(message)); } catch { client.ws.close(1011); }
  }

  function snapshotFor(client) {
    const time = now();
    const publicData = publicSnapshot(db, time, client.interval);
    lastPublic = publicData;
    lastTradeId = Math.max(lastTradeId, publicData.trades[0]?.id || 0);
    const payload = {
      type: 'snapshot',
      seq,
      time,
      source: 'rillvane',
      stale: publicData.market.stale,
      slot: publicData.market.oracleSlot,
      market: publicData.market,
      pool: publicData.pool,
      token: publicData.token,
      trades: publicData.trades,
      candles: publicData.candles
    };
    if (client.wallet && client.topics.has('account')) {
      payload.account = accountSnapshot(db, client.wallet, time, faucetLimit);
    }
    send(client, payload);
    client.lastAccount = payload.account || null;
  }

  function publish(topic, payload) {
    const time = now();
    const message = {
      type: 'delta',
      seq: nextSeq(),
      time,
      source: 'rillvane',
      topic,
      payload
    };
    if (PUBLIC_TOPICS.has(topic)) remember(topic, payload);
    for (const client of clients) {
      if (!client.hello) continue;
      if (!client.topics.has(topic)) continue;
      if (PRIVATE_TOPICS.has(topic) && !client.wallet) continue;
      send(client, message);
    }
  }

  function replay(client, lastSeq) {
    if (!lastSeq || lastSeq < 1 || !ring.length || lastSeq < ring[0].seq || lastSeq > seq) {
      snapshotFor(client);
      return;
    }
    if (lastSeq === seq) {
      send(client, {type: 'ok', seq, time: now()});
      return;
    }
    for (const entry of ring) {
      if (entry.seq <= lastSeq) continue;
      send(client, {type: 'delta', seq: entry.seq, time: now(), source: 'rillvane', topic: entry.topic, payload: entry.payload});
    }
  }

  function drop(client) {
    if (!clients.has(client)) return;
    clients.delete(client);
    const list = byIp.get(client.ip);
    if (list) {
      const next = list.filter(item => item !== client);
      if (next.length) byIp.set(client.ip, next);
      else byIp.delete(client.ip);
    }
    try { client.ws.close(1000); } catch { /* closed */ }
  }

  function tick() {
    if (closing || !clients.size) return;
    const time = now();
    const publicData = publicSnapshot(db, time, '5m');
    const newestTrade = publicData.trades[0]?.id || 0;
    const marketChanged = !lastPublic || !jsonEqual(
      [lastPublic.market.price, lastPublic.market.oracleTime, lastPublic.pool.quoteCash, lastPublic.pool.baseCash, lastPublic.token.stale],
      [publicData.market.price, publicData.market.oracleTime, publicData.pool.quoteCash, publicData.pool.baseCash, publicData.token.stale]
    );
    if (marketChanged) {
      lastPublic = publicData;
      publish('market', publicData.market);
      publish('pool', publicData.pool);
      publish('token', publicData.token);
    }
    let tradesChanged = false;
    if (newestTrade > lastTradeId) {
      const fresh = publicData.trades.filter(item => item.id > lastTradeId).reverse();
      lastTradeId = newestTrade;
      tradesChanged = true;
      for (const trade of fresh) publish('trades', trade);
    }
    if (marketChanged || tradesChanged) {
      const intervals = new Set([...clients].map(client => client.interval));
      for (const interval of intervals) {
        publish('candles', lastCandle(db, interval, time));
      }
    }
    for (const client of clients) {
      if (!client.hello || !client.wallet || !client.topics.has('account')) continue;
      const account = accountSnapshot(db, client.wallet, time, faucetLimit);
      if (accountIdentity(account) !== accountIdentity(client.lastAccount)) {
        client.lastAccount = account;
        send(client, {type: 'delta', seq, time, source: 'rillvane', topic: 'account', payload: account});
      }
      const notices = db.prepare('SELECT id,kind,message,created,read_at FROM notifications WHERE wallet=? AND id>? ORDER BY id LIMIT 20').all(client.wallet, client.noticeCursor);
      for (const item of notices) {
        client.noticeCursor = item.id;
        if (client.topics.has('notices') && !item.read_at) {
          send(client, {type: 'delta', seq, time, source: 'rillvane', topic: 'notices', payload: item});
        }
      }
    }
  }

  function handleHello(client, message) {
    const topics = Array.isArray(message.topics) ? message.topics : [...PUBLIC_TOPICS];
    client.topics = new Set(
      topics.filter(topic => PUBLIC_TOPICS.has(topic) || (client.wallet && PRIVATE_TOPICS.has(topic)))
    );
    if (!client.topics.size) client.topics = new Set(PUBLIC_TOPICS);
    if (typeof message.interval === 'string' && ['5m', '15m', '1h', '4h', '1d'].includes(message.interval)) {
      client.interval = message.interval;
    }
    client.hello = true;
    clearTimeout(client.helloTimer);
    const lastSeq = Number(message.lastSeq);
    replay(client, Number.isFinite(lastSeq) ? lastSeq : 0);
  }

  function onUpgrade(req, socket, head) {
    const ip = socket.remoteAddress || 'unknown';
    const fail = (status, body) => {
      socket.write(`HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({error: body})}`);
      socket.destroy();
    };
    if (!isWebSocketRequest(req)) return fail(400, 'WebSocket upgrade required.');
    const path = req.url?.split('?')[0];
    if (path !== '/api/v1/stream' && path !== '/stream') return fail(404, 'API endpoint not found.');
    const gate = canUpgrade({ip, origin: req.headers.origin});
    if (!gate.ok) return fail(gate.status, gate.error);

    socket.write(handshakeResponse(req.headers['sec-websocket-key']));
    const time = gate.time;
    const wallet = sessionWallet(db, req.headers.cookie, time);
    const client = {
      ip,
      wallet,
      hello: false,
      interval: '1h',
      topics: new Set(PUBLIC_TOPICS),
      lastAccount: null,
      noticeCursor: 0,
      alive: true
    };
    client.ws = attachWebSocket(socket, {
      head,
      onMessage(text) {
        let message;
        try { message = JSON.parse(text); } catch { client.ws.close(1003, 'json'); return; }
        if (message?.op === 'hello') handleHello(client, message);
        else if (message?.op === 'subscribe' && client.hello) {
          if (typeof message.interval === 'string' && ['5m', '15m', '1h', '4h', '1d'].includes(message.interval)) {
            client.interval = message.interval;
            send(client, {type: 'delta', seq, time: now(), source: 'rillvane', topic: 'candles', payload: lastCandle(db, client.interval, now())});
          }
        } else if (message?.op === 'pong' || message?.op === 'ping') {
          if (message.op === 'ping') send(client, {type: 'pong', time: now()});
        }
      },
      onClose() {
        clearTimeout(client.helloTimer);
        drop(client);
      }
    });
    client.helloTimer = setTimeout(() => {
      if (!client.hello) client.ws.close(1008, 'hello required');
    }, HELLO_MS);
    clients.add(client);
    const list = byIp.get(ip) || [];
    list.push(client);
    byIp.set(ip, list);
    log({event: 'stream.open', ip, wallet: wallet ? 'yes' : 'no', clients: clients.size});
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
    pingTimer = setInterval(pingAll, PING_MS);
    pingTimer.unref?.();
  }

  function expectedOrigin() {
    return typeof origin === 'function' ? origin() : origin;
  }

  function pingAll() {
    for (const client of clients) {
      try { client.ws.ping(); } catch { /* closed */ }
    }
  }

  function canUpgrade({ip = 'unknown', origin: requestOrigin} = {}) {
    const time = now();
    if (closing) return {ok: false, status: 503, error: 'Service is shutting down.'};
    if (requestOrigin && requestOrigin !== expectedOrigin()) return {ok: false, status: 403, error: 'Request origin does not match this application.'};
    const limit = rateLimit(db, digest(ip + ':stream'), 24, time);
    if (!limit.allowed) return {ok: false, status: 429, error: 'Too many requests. Try again later.'};
    if (clients.size >= MAX_CLIENTS) return {ok: false, status: 503, error: 'Stream capacity reached.'};
    if ((byIp.get(ip) || []).length >= MAX_PER_IP) return {ok: false, status: 503, error: 'Too many stream connections.'};
    return {ok: true, time};
  }

  function attachBrowser(ws, {ip = 'unknown', cookie = '', origin: requestOrigin} = {}, alreadyChecked = false) {
    const gate = alreadyChecked ? {ok: true, time: now()} : canUpgrade({ip, origin: requestOrigin});
    if (!gate.ok) return gate;
    const time = gate.time;
    const wallet = sessionWallet(db, cookie, time);
    const client = {
      ip,
      wallet,
      hello: false,
      interval: '1h',
      topics: new Set(PUBLIC_TOPICS),
      lastAccount: null,
      noticeCursor: 0,
      alive: true,
      ws: {
        sendText(text) { try { ws.send(text); } catch { try { ws.close(1011); } catch {} } },
        ping() { try { if (typeof ws.ping === 'function') ws.ping(); else ws.send(''); } catch {} },
        close(code = 1000, reason = '') { try { ws.close(code, reason); } catch {} }
      }
    };
    ws.addEventListener('message', event => {
      const text = typeof event.data === 'string' ? event.data : String(event.data || '');
      let message;
      try { message = JSON.parse(text); } catch { client.ws.close(1003, 'json'); return; }
      if (message?.op === 'hello') handleHello(client, message);
      else if (message?.op === 'subscribe' && client.hello) {
        if (typeof message.interval === 'string' && ['5m', '15m', '1h', '4h', '1d'].includes(message.interval)) {
          client.interval = message.interval;
          send(client, {type: 'delta', seq, time: now(), source: 'rillvane', topic: 'candles', payload: lastCandle(db, client.interval, now())});
        }
      } else if (message?.op === 'pong' || message?.op === 'ping') {
        if (message.op === 'ping') send(client, {type: 'pong', time: now()});
      }
    });
    ws.addEventListener('close', () => {
      clearTimeout(client.helloTimer);
      drop(client);
    });
    ws.addEventListener('error', () => {
      clearTimeout(client.helloTimer);
      drop(client);
    });
    client.helloTimer = setTimeout(() => {
      if (!client.hello) client.ws.close(1008, 'hello required');
    }, HELLO_MS);
    clients.add(client);
    const list = byIp.get(ip) || [];
    list.push(client);
    byIp.set(ip, list);
    log({event: 'stream.open', ip, wallet: wallet ? 'yes' : 'no', clients: clients.size});
    return {ok: true, client};
  }

  function stop() {
    closing = true;
    clearInterval(timer);
    clearInterval(pingTimer);
    timer = pingTimer = null;
    for (const client of [...clients]) drop(client);
  }

  if (autoStart) start();

  return {
    onUpgrade,
    canUpgrade,
    attachBrowser,
    publish,
    tick,
    pingAll,
    snapshot: interval => publicSnapshot(db, now(), interval),
    clientCount: () => clients.size,
    stop
  };
}

export {PUBLIC_TOPICS, PRIVATE_TOPICS, acceptKey};
