import {randomUUID, createHash} from 'node:crypto';
import {atomic, audit} from './db-util.mjs';
import {
  freshMarket, loadWallet, dumpWallet, applyInstruction, quotePreview, instructionMessage,
  quoteExpiry, userDebt, applyLiquidation, setOracle, utilizationBps
} from './engine.mjs';
import {
  MARKET_ID, toUnits, fromUnits, displayPrice, navQuote, ltvBps, healthBps, maxBorrow,
  START_PRICE, ProtocolError, fail, LIQ_BPS
} from './math.mjs';

const marketColumns = 'id, base_symbol AS baseSymbol, quote_symbol AS quoteSymbol, price, oracle_time AS oracleTime, oracle_slot AS oracleSlot, base_cash AS baseCash, quote_cash AS quoteCash, quote_debt AS quoteDebt, base_shares AS baseShares, quote_shares AS quoteShares, debt_shares AS debtShares, borrow_index AS borrowIndex, last_accrual AS lastAccrual, paused, epoch, config_version AS configVersion';
const walletColumns = 'wallet, base, quote, base_shares AS baseShares, quote_shares AS quoteShares, collateral, debt_shares AS debtShares, nonce';

function saveMarket(db, market) {
  db.prepare(`UPDATE markets SET price=?, oracle_time=?, oracle_slot=?, base_cash=?, quote_cash=?, quote_debt=?, base_shares=?, quote_shares=?, debt_shares=?, borrow_index=?, last_accrual=?, paused=?, epoch=?, config_version=? WHERE id=?`).run(
    market.price, market.oracleTime, market.oracleSlot, market.baseCash, market.quoteCash, market.quoteDebt,
    market.baseShares, market.quoteShares, market.debtShares, market.borrowIndex, market.lastAccrual,
    market.paused, market.epoch, market.configVersion, market.id
  );
}

function saveWallet(db, address, wallet) {
  db.prepare(`INSERT INTO protocol_wallets(wallet,base,quote,base_shares,quote_shares,collateral,debt_shares,nonce)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(wallet) DO UPDATE SET base=excluded.base, quote=excluded.quote, base_shares=excluded.base_shares,
      quote_shares=excluded.quote_shares, collateral=excluded.collateral, debt_shares=excluded.debt_shares, nonce=excluded.nonce`)
    .run(address, wallet.base, wallet.quote, wallet.baseShares, wallet.quoteShares, wallet.collateral, wallet.debtShares, wallet.nonce);
}

function notice(db, wallet, kind, message, time, dedupe) {
  db.prepare('INSERT OR IGNORE INTO notifications(wallet,dedupe,kind,message,created) VALUES(?,?,?,?,?)')
    .run(wallet, dedupe, kind, message, time);
}

export function ensureProtocol(db, now = Date.now()) {
  let row = db.prepare(`SELECT ${marketColumns} FROM markets WHERE id=?`).get(MARKET_ID);
  if (!row) {
    const market = freshMarket(now);
    db.prepare(`INSERT INTO markets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      market.id, market.baseSymbol, market.quoteSymbol, market.price, market.oracleTime, market.oracleSlot,
      market.baseCash, market.quoteCash, market.quoteDebt, market.baseShares, market.quoteShares,
      market.debtShares, market.borrowIndex, market.lastAccrual, market.paused, market.epoch, market.configVersion
    );
    row = db.prepare(`SELECT ${marketColumns} FROM markets WHERE id=?`).get(MARKET_ID);
  }
  return row;
}

export function getWallet(db, address) {
  return db.prepare(`SELECT ${walletColumns} FROM protocol_wallets WHERE wallet=?`).get(address)
    || {wallet: address, base: '0', quote: '0', baseShares: '0', quoteShares: '0', collateral: '0', debtShares: '0', nonce: '0'};
}

export function publicMarket(row, now) {
  const util = Number(utilizationBps(row)) / 100;
  return {
    id: row.id,
    base: row.baseSymbol,
    quote: row.quoteSymbol,
    price: displayPrice(BigInt(row.price)),
    priceRaw: row.price,
    oracleTime: row.oracleTime,
    oracleSlot: row.oracleSlot,
    baseCash: fromUnits(BigInt(row.baseCash)),
    quoteCash: fromUnits(BigInt(row.quoteCash)),
    quoteDebt: fromUnits(BigInt(row.quoteDebt)),
    utilization: util,
    supplyApy: 8 * util / 100,
    borrowApr: 8,
    decimals: 6,
    stale: now - row.oracleTime > 30_000
  };
}

export function publicPool(row) {
  const nav = navQuote({quoteCash: BigInt(row.quoteCash), quoteDebt: BigInt(row.quoteDebt)});
  return {
    market: row.id,
    baseCash: fromUnits(BigInt(row.baseCash)),
    quoteCash: fromUnits(BigInt(row.quoteCash)),
    quoteDebt: fromUnits(BigInt(row.quoteDebt)),
    navQuote: fromUnits(nav),
    utilizationBps: utilizationBps(row).toString(),
    feeBps: '10',
    reserveBps: '1000',
    maxImpactBps: '190'
  };
}

function displayQuote(result) {
  const copy = {...result};
  for (const key of ['amountIn', 'amountOut', 'minOut', 'shares', 'nav', 'debtAfter']) {
    if (copy[key] != null) copy[key] = fromUnits(BigInt(copy[key]));
  }
  if (copy.execPrice) copy.execPrice = displayPrice(BigInt(copy.execPrice));
  if (copy.oraclePrice) copy.oraclePrice = displayPrice(BigInt(copy.oraclePrice));
  if (copy.impactBps) copy.impactBps = (Number(copy.impactBps) / 100).toFixed(3);
  if (copy.ltvBps) copy.ltvBps = (Number(copy.ltvBps) / 100).toFixed(2);
  return copy;
}

export function normalizeAction(body, kindHint) {
  const kind = kindHint || body.kind || body.action;
  if (kind === 'swap') {
    const side = body.side === 'sell' ? 'sell' : 'buy';
    return {kind: 'swap', side, amountIn: toUnits(body.amountIn ?? body.amount).toString(), minOut: body.minOut != null && body.minOut !== '' ? toUnits(body.minOut).toString() : undefined};
  }
  if (kind === 'supply' || kind === 'withdraw') {
    const asset = body.asset === 'RLVN' ? 'RLVN' : 'USDC';
    return {kind, asset, amountIn: toUnits(body.amountIn ?? body.amount ?? body.shares).toString()};
  }
  if (kind === 'credit') {
    let action = body.action || body.creditAction;
    if (action === 'withdraw') action = 'remove';
    if (!['borrow', 'repay', 'add', 'remove'].includes(action)) fail('UNSUPPORTED_MINT', 'Unknown credit action.');
    return {kind: 'credit', action, amountIn: toUnits(body.amountIn ?? body.amount).toString()};
  }
  if (kind === 'faucet') {
    const asset = body.asset === 'RLVN' ? 'RLVN' : 'USDC';
    return {kind: 'faucet', asset, amountIn: toUnits(body.amountIn ?? body.amount).toString()};
  }
  fail('UNSUPPORTED_MINT', 'Unknown quote kind.');
}

export function portfolio(db, address, now = Date.now()) {
  const market = ensureProtocol(db, now);
  const wallet = getWallet(db, address);
  const loaded = loadWallet(wallet);
  const price = BigInt(market.price);
  const debt = userDebt(loaded, {borrowIndex: BigInt(market.borrowIndex)});
  const collateralValue = loaded.collateral * price / 1_000_000n;
  const navQ = navQuote({quoteCash: BigInt(market.quoteCash), quoteDebt: BigInt(market.quoteDebt)});
  const quoteRedeem = loaded.quoteShares === 0n || BigInt(market.quoteShares) === 0n ? 0n : loaded.quoteShares * navQ / BigInt(market.quoteShares);
  const baseRedeem = loaded.baseShares === 0n || BigInt(market.baseShares) === 0n ? 0n : loaded.baseShares * BigInt(market.baseCash) / BigInt(market.baseShares);
  const ltv = ltvBps(debt, loaded.collateral, price);
  const health = healthBps(debt, loaded.collateral, price);
  return {
    wallet: address,
    nonce: wallet.nonce,
    balances: {RLVN: fromUnits(loaded.base), USDC: fromUnits(loaded.quote)},
    shares: {RLVN: fromUnits(loaded.baseShares), USDC: fromUnits(loaded.quoteShares)},
    supplied: {RLVN: fromUnits(baseRedeem), USDC: fromUnits(quoteRedeem)},
    collateral: {RLVN: fromUnits(loaded.collateral), value: fromUnits(collateralValue)},
    debt: fromUnits(debt),
    ltv: Number(ltv) / 100,
    health: debt === 0n ? null : Number(health) / 100,
    borrowCapacity: fromUnits(maxBorrow(loaded.collateral, price, debt)),
    price: displayPrice(price)
  };
}

export function workspaceState(db, address, now = Date.now()) {
  const p = portfolio(db, address, now);
  const activity = listActivity(db, address).items;
  return {
    wallet: {USDC: Number(p.balances.USDC), RLVN: Number(p.balances.RLVN)},
    deposits: {usdc: Number(p.shares.USDC), rlvn: Number(p.shares.RLVN)},
    supplied: {usdc: Number(p.supplied.USDC), rlvn: Number(p.supplied.RLVN)},
    credit: {collateral: Number(p.collateral.RLVN), debt: Number(p.debt)},
    watchlist: ['RLVN'],
    slippage: 0.5,
    activity,
    orders: [],
    nonce: p.nonce,
    ltv: p.ltv,
    health: p.health,
    borrowCapacity: Number(p.borrowCapacity),
    price: p.price
  };
}

function assertFaucetQuota(db, address, action, now, faucetLimit = {USDC: '10000', RLVN: '100'}) {
  if (action.kind !== 'faucet') return;
  const amount = BigInt(action.amountIn);
  const limit = toUnits(faucetLimit[action.asset] || '0');
  const used = faucetUsed(db, address, action.asset, now);
  if (used + amount > limit) fail('FAUCET_LIMIT', 'Daily faucet limit reached.');
}

export function createQuote(db, address, body, now, kindHint, faucetLimit) {
  const market = ensureProtocol(db, now);
  const wallet = getWallet(db, address);
  const action = normalizeAction(body, kindHint);
  if (action.kind === 'swap' && body.slippageBps != null && action.minOut == null) {
    const bps = Number(body.slippageBps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 1000) fail('INVALID_AMOUNT', 'Slippage must be between 0% and 10%.');
    const preview = quotePreview(market, wallet, action, now);
    action.minOut = (BigInt(preview.amountOut) * BigInt(10000 - bps) / 10000n).toString();
  }
  assertFaucetQuota(db, address, action, now, faucetLimit);
  const result = quotePreview(market, wallet, action, now);
  const id = randomUUID();
  const expires = quoteExpiry(now);
  db.prepare('INSERT INTO quotes VALUES(?,?,?,?,?,?,?)').run(id, address, action.kind, JSON.stringify(action), JSON.stringify(result), expires, now);
  return {quoteId: id, expires, configEpoch: market.epoch, decimals: 6, ...displayQuote(result)};
}

export function publicIntent(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    nonce: row.nonce,
    status: row.status,
    message: row.message,
    unsignedBytes: row.unsigned_bytes,
    deadline: row.deadline,
    created: row.created,
    quoteId: row.quote_id
  };
}

export function createIntent(db, address, body, origin, now, idempotency) {
  const market = ensureProtocol(db, now);
  const wallet = getWallet(db, address);
  let action;
  if (body.quoteId) {
    const quote = db.prepare('SELECT * FROM quotes WHERE id=? AND wallet=?').get(body.quoteId, address);
    if (!quote) {
      if (idempotency) {
        const prior = db.prepare('SELECT * FROM intents WHERE wallet=? AND idempotency=?').get(address, idempotency);
        if (prior) return publicIntent(prior);
      }
      fail('QUOTE_EXPIRED', 'Quote was not found.');
    }
    action = JSON.parse(quote.payload);
  } else {
    action = normalizeAction(body);
  }
  const digest = createHash('sha256').update(JSON.stringify(action)).digest('hex');
  if (idempotency) {
    const prior = db.prepare('SELECT * FROM intents WHERE wallet=? AND idempotency=?').get(address, idempotency);
    if (prior) {
      if (prior.digest !== digest) fail('INTENT_CONFLICT', 'Idempotency key was used for a different request.', 409);
      return publicIntent(prior);
    }
  }
  if (body.quoteId) {
    const quote = db.prepare('SELECT expires FROM quotes WHERE id=?').get(body.quoteId);
    if (!quote || quote.expires < now) fail('QUOTE_EXPIRED', 'Quote has expired.');
  }
  quotePreview(market, wallet, action, now);
  const nonce = wallet.nonce;
  const payload = JSON.stringify({...action, nonce});
  const deadline = now + 120_000;
  const message = instructionMessage({origin, wallet: address, nonce, kind: action.kind, payload, deadline});
  const unsigned = Buffer.from(message, 'utf8').toString('base64');
  const id = randomUUID();
  db.prepare('INSERT INTO intents(id,wallet,kind,nonce,digest,payload,message,status,quote_id,idempotency,deadline,created,unsigned_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    id, address, action.kind, nonce, digest, payload, message, 'prepared', body.quoteId || null, idempotency || null, deadline, now, unsigned
  );
  return publicIntent(db.prepare('SELECT * FROM intents WHERE id=?').get(id));
}

export function prepareIntent(db, address, id, now, blockhash) {
  const intent = db.prepare('SELECT * FROM intents WHERE id=? AND wallet=?').get(id, address);
  if (!intent) fail('QUOTE_EXPIRED', 'Intent was not found.', 404);
  if (intent.status === 'applied') return {...publicIntent(intent), blockhash: blockhash || null, lastValidBlockHeight: null};
  if (intent.deadline < now) fail('QUOTE_EXPIRED', 'Intent deadline has passed.');
  db.prepare("UPDATE intents SET status='prepared' WHERE id=? AND status='prepared'").run(id);
  return {
    ...publicIntent(intent),
    blockhash: blockhash?.blockhash || blockhash || null,
    lastValidBlockHeight: blockhash?.lastValidBlockHeight || null,
    feePayer: address
  };
}

export function getIntent(db, address, id) {
  const row = db.prepare('SELECT * FROM intents WHERE id=? AND wallet=?').get(id, address);
  if (!row) fail('QUOTE_EXPIRED', 'Intent was not found.', 404);
  return publicIntent(row);
}

function faucetDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function faucetUsed(db, address, asset, now) {
  const row = db.prepare('SELECT amount FROM faucet_claims WHERE wallet=? AND day=? AND asset=?').get(address, faucetDay(now), asset);
  return BigInt(row?.amount || 0);
}

export function faucetStatus(db, address, now, limits) {
  const assets = ['USDC', 'RLVN'];
  const out = {};
  for (const asset of assets) {
    const limit = toUnits(limits[asset] || '0');
    const used = faucetUsed(db, address, asset, now);
    out[asset] = {claimed: fromUnits(used), limit: fromUnits(limit), remaining: fromUnits(limit > used ? limit - used : 0n)};
  }
  return {day: faucetDay(now), ...out};
}

function recordFaucet(db, address, asset, amount, now) {
  const day = faucetDay(now);
  const used = faucetUsed(db, address, asset, now);
  const next = used + amount;
  const existing = db.prepare('SELECT id FROM faucet_claims WHERE wallet=? AND day=? AND asset=?').get(address, day, asset);
  if (existing) db.prepare('UPDATE faucet_claims SET amount=? WHERE id=?').run(next.toString(), existing.id);
  else db.prepare('INSERT INTO faucet_claims VALUES(?,?,?,?,?,?)').run(randomUUID(), address, day, asset, next.toString(), now);
}

export function applySignedIntent(db, address, intentId, now, faucetLimit = {USDC: '10000', RLVN: '100'}) {
  return atomic(db, () => {
    const intent = db.prepare('SELECT * FROM intents WHERE id=? AND wallet=?').get(intentId, address);
    if (!intent) fail('QUOTE_EXPIRED', 'Intent was not found.', 404);
    if (intent.status === 'applied' && intent.result) return JSON.parse(intent.result);
    if (intent.deadline < now) fail('QUOTE_EXPIRED', 'Intent deadline has passed.');
    const action = JSON.parse(intent.payload);
    if (action.kind === 'faucet') {
      const amount = BigInt(action.amountIn);
      const limit = toUnits(faucetLimit[action.asset] || '0');
      const used = faucetUsed(db, address, action.asset, now);
      if (used + amount > limit) fail('FAUCET_LIMIT', 'Daily faucet limit reached.');
    }
    const market = ensureProtocol(db, now);
    const wallet = getWallet(db, address);
    const applied = applyInstruction(market, wallet, {...action, nonce: intent.nonce, deadline: intent.deadline, kind: action.kind}, now);
    saveMarket(db, applied.market);
    saveWallet(db, address, applied.wallet);
    db.prepare('INSERT INTO protocol_events(wallet,kind,payload,signature,slot,created) VALUES(?,?,?,?,?,?)')
      .run(address, applied.event.kind || action.kind, JSON.stringify(applied.event), intent.signature, applied.market.oracleSlot, now);
    if (action.kind === 'swap') {
      const buy = applied.event.side === 'buy';
      db.prepare('INSERT INTO trades(side,price,base_amount,quote_amount,slot,created) VALUES(?,?,?,?,?,?)').run(
        applied.event.side,
        applied.event.execPrice || applied.market.price,
        buy ? applied.event.amountOut : applied.event.amountIn,
        buy ? applied.event.amountIn : applied.event.amountOut,
        applied.market.oracleSlot,
        now
      );
    }
    if (action.kind === 'faucet') recordFaucet(db, address, action.asset, BigInt(action.amountIn), now);
    const response = {
      intentId,
      event: displayQuote({...applied.event}),
      portfolio: portfolio(db, address, now)
    };
    db.prepare("UPDATE intents SET status='applied', result=?, applied_at=? WHERE id=?").run(JSON.stringify(response), now, intentId);
    notice(db, address, 'applied', `${applied.event.type || action.kind} settled.`, now, intentId + ':applied');
    audit(db, {event: 'protocol.' + action.kind, wallet: address, time: now, detail: {intentId, kind: action.kind}});
    return response;
  });
}

export function attachSignature(db, address, intentId, signature) {
  const intent = db.prepare('SELECT * FROM intents WHERE id=? AND wallet=?').get(intentId, address);
  if (!intent) fail('QUOTE_EXPIRED', 'Intent was not found.', 404);
  if (intent.status === 'applied') return intent;
  db.prepare("UPDATE intents SET signature=?, status='submitted' WHERE id=?").run(signature, intentId);
  return db.prepare('SELECT * FROM intents WHERE id=?').get(intentId);
}

export function listActivity(db, address, filter = 'all') {
  const rows = db.prepare('SELECT * FROM protocol_events WHERE wallet=? ORDER BY id DESC LIMIT 100').all(address);
  const items = rows.map(row => {
    const payload = JSON.parse(row.payload);
    const amount = payload.amountOut || payload.amountIn || payload.amount || payload.shares || '0';
    const asset = payload.asset || (payload.side === 'buy' ? 'RLVN' : payload.kind === 'swap' ? 'USDC' : 'USDC');
    return {
      id: 'RV-' + row.id,
      type: payload.type || payload.kind,
      asset,
      amount: Number(fromUnits(BigInt(amount || 0))),
      value: Number(fromUnits(BigInt(amount || 0))),
      time: new Date(row.created).toISOString(),
      detail: payload.side ? `${payload.side} ${fromUnits(BigInt(payload.amountIn || 0))}` : (payload.asset || payload.kind),
      signature: row.signature,
      slot: row.slot
    };
  }).filter(item => {
    if (filter === 'all') return true;
    if (filter === 'swaps') return ['swap', 'Market buy', 'Market sell'].includes(item.type);
    if (filter === 'supply') return ['supply', 'withdraw', 'Supply', 'Withdraw'].includes(item.type);
    if (filter === 'credit') return ['credit', 'Borrow', 'Repay', 'Collateral', 'Release collateral'].includes(item.type);
    return true;
  });
  return {items};
}

export function listTrades(db, limit = 50) {
  const rows = db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT ?').all(limit);
  return {
    items: rows.map(row => ({
      id: row.id,
      side: row.side,
      price: displayPrice(BigInt(row.price)),
      baseAmount: fromUnits(BigInt(row.base_amount)),
      quoteAmount: fromUnits(BigInt(row.quote_amount)),
      time: new Date(row.created).toISOString()
    }))
  };
}

function markCandles(from, end, ms, price) {
  const items = [];
  for (let t = from; t <= end; t += ms) {
    items.push({time: t, open: price, high: price, low: price, close: price, volume: 0, price});
  }
  return items;
}

export function listCandles(db, interval = '1h', now = Date.now(), options = {}) {
  const ms = {'5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000}[interval] || 3_600_000;
  const count = Math.max(12, Math.min(600, Math.round(Number(options.count) || 120)));
  const requestedEnd = Number(options.end);
  const end = Math.floor(Math.min(now, options.end != null && Number.isFinite(requestedEnd) && requestedEnd >= 0 ? requestedEnd : now) / ms) * ms;
  const from = end - ms * (count - 1);
  const rows = db.prepare('SELECT * FROM trades WHERE created>=? AND created<? ORDER BY created, id').all(from, end + ms);
  const earliest = db.prepare('SELECT MIN(created) AS time FROM trades').get().time;
  const buckets = new Map();
  for (const row of rows) {
    const t = Math.floor(row.created / ms) * ms;
    const price = displayPrice(BigInt(row.price));
    const volume = Number(fromUnits(BigInt(row.base_amount)));
    const bucket = buckets.get(t) || {time: t, open: price, high: price, low: price, close: price, volume: 0};
    bucket.high = Math.max(bucket.high, price);
    bucket.low = Math.min(bucket.low, price);
    bucket.close = price;
    bucket.volume += volume;
    buckets.set(t, bucket);
  }
  const traded = [...buckets.values()].map(bucket => ({...bucket, price: bucket.close}));
  if (traded.length) {
    return {interval, from, end, earliest, hasMore: earliest != null && earliest < from, items: traded};
  }
  const market = ensureProtocol(db, now);
  const mark = displayPrice(BigInt(market.price));
  return {
    interval,
    from, end,
    earliest: Number(market.oracleTime) || now,
    hasMore: false,
    items: markCandles(from, end, ms, mark)
  };
}

export function refreshOracle(db, now, price = START_PRICE) {
  const market = ensureProtocol(db, now);
  const next = setOracle(market, BigInt(price), now, Number(market.oracleSlot) + 1);
  saveMarket(db, next);
  return next;
}

export function liquidateUnhealthy(db, now) {
  const market = ensureProtocol(db, now);
  const wallets = db.prepare(`SELECT ${walletColumns} FROM protocol_wallets`).all();
  const liquidated = [];
  for (const row of wallets) {
    const loaded = loadWallet(row);
    const debt = userDebt(loaded, {borrowIndex: BigInt(market.borrowIndex)});
    if (debt === 0n) continue;
    const ltv = ltvBps(debt, loaded.collateral, BigInt(market.price));
    if (ltv < LIQ_BPS) continue;
    try {
      const current = db.prepare(`SELECT ${marketColumns} FROM markets WHERE id=?`).get(MARKET_ID);
      const result = applyLiquidation(current, row, now);
      saveMarket(db, result.market);
      saveWallet(db, row.wallet, result.wallet);
      db.prepare('INSERT INTO protocol_events(wallet,kind,payload,created) VALUES(?,?,?,?)')
        .run(row.wallet, 'liquidate', JSON.stringify(result.event), now);
      notice(db, row.wallet, 'liquidated', 'Position liquidated against the 60% threshold.', now, 'liq:' + row.wallet + ':' + now);
      liquidated.push(row.wallet);
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error;
    }
  }
  return liquidated;
}

export {MARKET_ID, ProtocolError};
