import {
  START_PRICE, INDEX_SCALE, UNIT, PRICE_SCALE, MARKET_ID, ORACLE_STALE_MS, QUOTE_TTL_MS, BPS,
  ProtocolError, fail, swapOut, depositShares, redeemAssets, navQuote, minCash, accrueIndex,
  debtFromShares, sharesFromDebt, ltvBps, maxBorrow, liquidation, MAX_LTV_BPS, LIQ_BPS
} from './math.mjs';

export const KINDS = ['swap', 'supply', 'withdraw', 'credit', 'faucet'];
export const CREDIT_ACTIONS = ['borrow', 'repay', 'add', 'remove'];

export function freshMarket(now) {
  return {
    id: MARKET_ID,
    baseSymbol: 'RLVN',
    quoteSymbol: 'USDC',
    price: START_PRICE.toString(),
    oracleTime: now,
    oracleSlot: 1,
    baseCash: (UNIT * 10_000n).toString(),
    quoteCash: (UNIT * 1_000_000n).toString(),
    quoteDebt: '0',
    baseShares: (UNIT * 10_000n).toString(),
    quoteShares: (UNIT * 1_000_000n).toString(),
    debtShares: '0',
    borrowIndex: INDEX_SCALE.toString(),
    lastAccrual: now,
    paused: 0,
    epoch: 1,
    configVersion: 1
  };
}

const bn = value => BigInt(value || 0);
const dump = market => ({
  ...market,
  price: market.price.toString(),
  baseCash: market.baseCash.toString(),
  quoteCash: market.quoteCash.toString(),
  quoteDebt: market.quoteDebt.toString(),
  baseShares: market.baseShares.toString(),
  quoteShares: market.quoteShares.toString(),
  debtShares: market.debtShares.toString(),
  borrowIndex: market.borrowIndex.toString()
});

export function loadMarket(row) {
  return {
    ...row,
    price: bn(row.price),
    baseCash: bn(row.baseCash),
    quoteCash: bn(row.quoteCash),
    quoteDebt: bn(row.quoteDebt),
    baseShares: bn(row.baseShares),
    quoteShares: bn(row.quoteShares),
    debtShares: bn(row.debtShares),
    borrowIndex: bn(row.borrowIndex),
    paused: Number(row.paused || 0)
  };
}

export function freshWallet() {
  return {base: 0n, quote: 0n, baseShares: 0n, quoteShares: 0n, collateral: 0n, debtShares: 0n, nonce: 0n};
}

export function loadWallet(row) {
  if (!row) return freshWallet();
  return {
    base: bn(row.base),
    quote: bn(row.quote),
    baseShares: bn(row.baseShares),
    quoteShares: bn(row.quoteShares),
    collateral: bn(row.collateral),
    debtShares: bn(row.debtShares),
    nonce: bn(row.nonce)
  };
}

export function dumpWallet(wallet) {
  return {
    base: wallet.base.toString(),
    quote: wallet.quote.toString(),
    baseShares: wallet.baseShares.toString(),
    quoteShares: wallet.quoteShares.toString(),
    collateral: wallet.collateral.toString(),
    debtShares: wallet.debtShares.toString(),
    nonce: wallet.nonce.toString()
  };
}

function accrue(market, now) {
  const index = accrueIndex(market.borrowIndex, market.lastAccrual, now);
  if (index !== market.borrowIndex) {
    market.quoteDebt = debtFromShares(market.debtShares, index);
    market.borrowIndex = index;
    market.lastAccrual = now;
  }
  return market;
}

function oracleFresh(market, now, required) {
  if (!required) return;
  if (now - market.oracleTime > ORACLE_STALE_MS) fail('STALE_ORACLE', 'Oracle price is stale.', 503);
  if (market.price <= 0n) fail('STALE_ORACLE', 'Oracle price is unavailable.', 503);
}

export function userDebt(wallet, market) {
  return debtFromShares(wallet.debtShares, market.borrowIndex);
}

export function quotePreview(market, wallet, action, now) {
  const m = accrue({...loadMarket(dump(loadMarket(market)))}, now);
  const w = loadWallet(typeof wallet?.base === 'bigint' ? dumpWallet(wallet) : wallet);
  if (action.kind === 'swap') return previewSwap(m, w, action, now);
  if (action.kind === 'supply') return previewSupply(m, w, action, now);
  if (action.kind === 'withdraw') return previewWithdraw(m, w, action, now);
  if (action.kind === 'credit') return previewCredit(m, w, action, now);
  if (action.kind === 'faucet') return {kind:'faucet', amountIn: action.amountIn, asset: action.asset};
  fail('UNSUPPORTED_MINT', 'Unknown action.');
}

function previewSwap(market, wallet, action, now) {
  oracleFresh(market, now, true);
  if (market.paused) fail('MARKET_PAUSED', 'Trading is paused.');
  const buyBase = action.side !== 'sell';
  const amountIn = bn(action.amountIn);
  const source = buyBase ? wallet.quote : wallet.base;
  if (amountIn > source) fail('INSUFFICIENT_FUNDS', 'Insufficient wallet balance.');
  const result = swapOut({
    buyBase, amountIn, price: market.price, baseCash: market.baseCash, quoteCash: market.quoteCash
  });
  const next = {...market, baseCash: result.baseCash, quoteCash: result.quoteCash};
  assertFloor(next);
  const minOut = bn(action.minOut || result.out);
  if (result.out < minOut) fail('SLIPPAGE_EXCEEDED', 'Output is below the minimum.');
  return {
    kind: 'swap',
    side: buyBase ? 'buy' : 'sell',
    amountIn: amountIn.toString(),
    amountOut: result.out.toString(),
    minOut: minOut.toString(),
    feeBps: result.feeBps.toString(),
    impactBps: result.impact.toString(),
    execPrice: result.execPrice.toString(),
    oraclePrice: market.price.toString(),
    oracleTime: market.oracleTime
  };
}

function previewSupply(market, wallet, action) {
  if (market.paused) fail('MARKET_PAUSED', 'Deposits are paused.');
  const asset = action.asset === 'RLVN' ? 'base' : 'quote';
  const amount = bn(action.amountIn);
  if (amount > wallet[asset]) fail('INSUFFICIENT_FUNDS', 'Insufficient wallet balance.');
  const nav = asset === 'quote' ? navQuote(market) : market.baseCash;
  const total = asset === 'quote' ? market.quoteShares : market.baseShares;
  const shares = depositShares(amount, total, nav);
  return {kind:'supply', asset: asset === 'base' ? 'RLVN' : 'USDC', amountIn: amount.toString(), shares: shares.toString(), nav: nav.toString()};
}

function previewWithdraw(market, wallet, action) {
  const asset = action.asset === 'RLVN' ? 'base' : 'quote';
  const shares = bn(action.amountIn);
  const owned = asset === 'quote' ? wallet.quoteShares : wallet.baseShares;
  if (shares > owned) fail('INSUFFICIENT_FUNDS', 'Insufficient supply claim.');
  const nav = asset === 'quote' ? navQuote(market) : market.baseCash;
  const total = asset === 'quote' ? market.quoteShares : market.baseShares;
  const assets = redeemAssets(shares, total, nav);
  if (asset === 'quote') {
    const next = {...market, quoteCash: market.quoteCash - assets, quoteShares: market.quoteShares - shares};
    if (next.quoteCash < 0n) fail('INSUFFICIENT_LIQUIDITY', 'Not enough cash to withdraw.');
    assertFloor(next);
  } else if (assets > market.baseCash) fail('INSUFFICIENT_LIQUIDITY', 'Not enough inventory to withdraw.');
  return {kind:'withdraw', asset: asset === 'base' ? 'RLVN' : 'USDC', shares: shares.toString(), amountOut: assets.toString()};
}

function previewCredit(market, wallet, action, now) {
  const amount = bn(action.amountIn);
  const debt = userDebt(wallet, market);
  const op = action.action;
  if (op === 'add') {
    if (amount > wallet.base) fail('INSUFFICIENT_FUNDS', 'Insufficient RLVN balance.');
    return {kind:'credit', action:op, amountIn: amount.toString(), ltvBps: ltvBps(debt, wallet.collateral + amount, market.price).toString()};
  }
  if (op === 'repay') {
    if (amount > wallet.quote) fail('INSUFFICIENT_FUNDS', 'Insufficient USDC balance.');
    if (amount > debt) fail('INVALID_AMOUNT', 'Repay exceeds outstanding debt.');
    return {kind:'credit', action:op, amountIn: amount.toString(), debtAfter: (debt - amount).toString()};
  }
  oracleFresh(market, now, true);
  if (market.paused) fail('MARKET_PAUSED', 'Risk-increasing actions are paused.');
  if (op === 'borrow') {
    const capacity = maxBorrow(wallet.collateral, market.price, debt);
    if (amount > capacity) fail('HEALTH_LIMIT', 'Borrow exceeds the 50% LTV limit.');
    const next = {...market, quoteCash: market.quoteCash - amount, quoteDebt: market.quoteDebt + amount};
    if (next.quoteCash < 0n) fail('INSUFFICIENT_LIQUIDITY', 'The pool cannot fund this loan.');
    assertFloor(next);
    return {kind:'credit', action:op, amountIn: amount.toString(), ltvBps: ltvBps(debt + amount, wallet.collateral, market.price).toString()};
  }
  if (op === 'remove') {
    if (amount > wallet.collateral) fail('INSUFFICIENT_FUNDS', 'Insufficient collateral.');
    const ltv = ltvBps(debt, wallet.collateral - amount, market.price);
    if (ltv > MAX_LTV_BPS) fail('HEALTH_LIMIT', 'Removing collateral would exceed the borrow limit.');
    return {kind:'credit', action:op, amountIn: amount.toString(), ltvBps: ltv.toString()};
  }
  fail('UNSUPPORTED_MINT', 'Unknown credit action.');
}

function assertFloor(market) {
  if (market.quoteCash < minCash(market)) fail('INSUFFICIENT_LIQUIDITY', 'Action would breach the cash reserve floor.');
}

export function applyInstruction(marketRow, walletRow, instruction, now) {
  const market = accrue(loadMarket(marketRow), now);
  const wallet = loadWallet(walletRow);
  if (bn(instruction.nonce) !== wallet.nonce) fail('INTENT_CONFLICT', 'Instruction nonce does not match the wallet sequence.');
  if (instruction.deadline && now > instruction.deadline) fail('QUOTE_EXPIRED', 'Instruction deadline has passed.');
  const kind = instruction.kind;
  let event;
  if (kind === 'faucet') event = applyFaucet(wallet, instruction);
  else if (kind === 'swap') event = applySwap(market, wallet, instruction, now);
  else if (kind === 'supply') event = applySupply(market, wallet, instruction);
  else if (kind === 'withdraw') event = applyWithdraw(market, wallet, instruction);
  else if (kind === 'credit') event = applyCredit(market, wallet, instruction, now);
  else fail('UNSUPPORTED_MINT', 'Unknown instruction.');
  wallet.nonce += 1n;
  return {market: dump(market), wallet: dumpWallet(wallet), event};
}

function applyFaucet(wallet, instruction) {
  const amount = bn(instruction.amountIn);
  if (instruction.asset === 'RLVN') wallet.base += amount;
  else wallet.quote += amount;
  return {kind:'faucet', asset: instruction.asset, amount: amount.toString()};
}

function applySwap(market, wallet, instruction, now) {
  const preview = previewSwap(market, wallet, instruction, now);
  const buyBase = preview.side === 'buy';
  const amountIn = bn(preview.amountIn);
  const amountOut = bn(preview.amountOut);
  if (buyBase) {
    wallet.quote -= amountIn;
    wallet.base += amountOut;
    market.quoteCash += amountIn;
    market.baseCash -= amountOut;
  } else {
    wallet.base -= amountIn;
    wallet.quote += amountOut;
    market.baseCash += amountIn;
    market.quoteCash -= amountOut;
  }
  assertFloor(market);
  return {...preview, type: buyBase ? 'Market buy' : 'Market sell'};
}

function applySupply(market, wallet, instruction) {
  const preview = previewSupply(market, wallet, instruction);
  const amount = bn(preview.amountIn);
  const shares = bn(preview.shares);
  if (preview.asset === 'RLVN') {
    wallet.base -= amount;
    wallet.baseShares += shares;
    market.baseCash += amount;
    market.baseShares += shares;
  } else {
    wallet.quote -= amount;
    wallet.quoteShares += shares;
    market.quoteCash += amount;
    market.quoteShares += shares;
  }
  return {...preview, type: 'Supply'};
}

function applyWithdraw(market, wallet, instruction) {
  const preview = previewWithdraw(market, wallet, instruction);
  const shares = bn(preview.shares);
  const assets = bn(preview.amountOut);
  if (preview.asset === 'RLVN') {
    wallet.baseShares -= shares;
    wallet.base += assets;
    market.baseShares -= shares;
    market.baseCash -= assets;
  } else {
    wallet.quoteShares -= shares;
    wallet.quote += assets;
    market.quoteShares -= shares;
    market.quoteCash -= assets;
    market.quoteDebt = debtFromShares(market.debtShares, market.borrowIndex);
    assertFloor(market);
  }
  return {...preview, type: 'Withdraw'};
}

function applyCredit(market, wallet, instruction, now) {
  const preview = previewCredit(market, wallet, instruction, now);
  const amount = bn(preview.amountIn);
  if (preview.action === 'add') {
    wallet.base -= amount;
    wallet.collateral += amount;
    return {...preview, type: 'Collateral', asset: 'RLVN'};
  }
  if (preview.action === 'remove') {
    wallet.collateral -= amount;
    wallet.base += amount;
    return {...preview, type: 'Release collateral', asset: 'RLVN'};
  }
  if (preview.action === 'borrow') {
    const shares = sharesFromDebt(amount, market.borrowIndex);
    wallet.debtShares += shares;
    wallet.quote += amount;
    market.debtShares += shares;
    market.quoteCash -= amount;
    market.quoteDebt = debtFromShares(market.debtShares, market.borrowIndex);
    assertFloor(market);
    return {...preview, type: 'Borrow', asset: 'USDC'};
  }
  const debt = userDebt(wallet, market);
  const repay = amount > debt ? debt : amount;
  const shares = sharesFromDebt(repay, market.borrowIndex);
  const burned = shares > wallet.debtShares ? wallet.debtShares : shares;
  wallet.debtShares -= burned;
  wallet.quote -= repay;
  market.debtShares -= burned;
  market.quoteCash += repay;
  market.quoteDebt = debtFromShares(market.debtShares, market.borrowIndex);
  return {...preview, type: 'Repay', asset: 'USDC', amountIn: repay.toString()};
}

export function applyLiquidation(marketRow, walletRow, now) {
  const market = accrue(loadMarket(marketRow), now);
  const wallet = loadWallet(walletRow);
  oracleFresh(market, now, true);
  const debt = userDebt(wallet, market);
  const result = liquidation(debt, wallet.collateral, market.price);
  const shares = sharesFromDebt(result.repay, market.borrowIndex);
  const burned = shares > wallet.debtShares ? wallet.debtShares : shares;
  wallet.debtShares -= burned;
  wallet.collateral -= result.seize;
  market.debtShares -= burned;
  market.quoteCash += result.repay;
  market.baseCash += result.seize;
  market.quoteDebt = debtFromShares(market.debtShares, market.borrowIndex);
  return {market: dump(market), wallet: dumpWallet(wallet), event: {kind:'liquidate', ...result, repay: result.repay.toString(), seize: result.seize.toString()}};
}

export function setOracle(marketRow, price, now, slot) {
  const market = loadMarket(marketRow);
  if (price <= 0n) fail('STALE_ORACLE', 'Oracle price must be positive.');
  if (now < market.oracleTime) fail('STALE_ORACLE', 'Oracle update is older than the last publish.');
  market.price = price;
  market.oracleTime = now;
  market.oracleSlot = slot || market.oracleSlot + 1;
  return dump(market);
}

export function instructionMessage({origin, wallet, nonce, kind, payload, deadline}) {
  return [
    `${origin} authorizes a Rillvane instruction.`,
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Kind: ${kind}`,
    `Payload: ${payload}`,
    `Expires: ${new Date(deadline).toISOString()}`,
    'This signature authorizes only this instruction.'
  ].join('\n');
}

export function quoteExpiry(now) {
  return now + QUOTE_TTL_MS;
}

export function utilizationBps(market) {
  const nav = navQuote(loadMarket(market));
  if (nav === 0n) return 0n;
  return bn(market.quoteDebt) * BPS / nav;
}

export {dump, bn, LIQ_BPS};
