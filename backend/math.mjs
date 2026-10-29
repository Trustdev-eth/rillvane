export const DECIMALS = 6;
export const UNIT = 1_000_000n;
export const PRICE_SCALE = 1_000_000n;
export const BPS = 10_000n;
export const FEE_BPS = 10n;
export const MAX_IMPACT_BPS = 190n;
export const ORACLE_DEV_BPS = 500n;
export const RESERVE_BPS = 1_000n;
export const MAX_LTV_BPS = 5_000n;
export const LIQ_BPS = 6_000n;
export const BONUS_BPS = 500n;
export const CLOSE_BPS = 5_000n;
export const APR_BPS = 800n;
export const INDEX_SCALE = 1_000_000_000_000n;
export const SECONDS_PER_YEAR = 31_536_000n;
export const ORACLE_STALE_MS = 30_000;
export const START_PRICE = 100_000_000n;
export const QUOTE_TTL_MS = 15_000;
export const MARKET_ID = 'rlvn-usdc';

export class ProtocolError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const fail = (code, message, status) => {
  throw new ProtocolError(code, message, status);
};

export function toUnits(value, decimals = DECIMALS) {
  if (typeof value === 'bigint') return value;
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) fail('INVALID_AMOUNT', 'Enter a valid amount.');
  const [whole, frac = ''] = text.split('.');
  if (frac.length > decimals) fail('INVALID_AMOUNT', 'Too many decimal places.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

export function fromUnits(units, decimals = DECIMALS) {
  const scale = 10n ** BigInt(decimals);
  const sign = units < 0n ? '-' : '';
  const abs = units < 0n ? -units : units;
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return sign + whole.toString() + (frac ? '.' + frac : '');
}

export function navQuote(market) {
  return market.quoteCash + market.quoteDebt;
}

export function minCash(market) {
  return navQuote(market) * RESERVE_BPS / BPS;
}

export function accrueIndex(index, lastAccrual, now) {
  const dt = BigInt(Math.max(0, Math.floor((now - lastAccrual) / 1000)));
  if (dt === 0n) return index;
  const growth = INDEX_SCALE + APR_BPS * INDEX_SCALE * dt / (BPS * SECONDS_PER_YEAR);
  return index * growth / INDEX_SCALE;
}

export function debtFromShares(shares, index) {
  return shares * index / INDEX_SCALE;
}

export function sharesFromDebt(amount, index) {
  if (index === 0n) fail('INVALID_AMOUNT', 'Borrow index is not initialized.');
  return amount * INDEX_SCALE / index;
}

export function depositShares(amount, totalShares, nav) {
  if (amount <= 0n) fail('INVALID_AMOUNT', 'Enter a positive amount.');
  if (totalShares === 0n || nav === 0n) return amount;
  return amount * totalShares / nav;
}

export function redeemAssets(shares, totalShares, nav) {
  if (shares <= 0n || totalShares <= 0n) fail('INVALID_AMOUNT', 'No claim to redeem.');
  if (shares > totalShares) fail('INSUFFICIENT_FUNDS', 'Redeem amount exceeds your claim.');
  return shares * nav / totalShares;
}

export function impactBps(amountIn, cash) {
  if (cash <= 0n) fail('INSUFFICIENT_LIQUIDITY', 'The pool has no inventory for this trade.');
  const raw = amountIn * BPS / cash;
  return raw > MAX_IMPACT_BPS ? MAX_IMPACT_BPS : raw;
}

export function swapOut({buyBase, amountIn, price, baseCash, quoteCash}) {
  if (amountIn <= 0n) fail('INVALID_AMOUNT', 'Enter a positive amount.');
  if (price <= 0n) fail('STALE_ORACLE', 'Oracle price is unavailable.');
  const cash = buyBase ? quoteCash : baseCash;
  const impact = impactBps(amountIn, cash);
  const gross = buyBase ? amountIn * PRICE_SCALE / price : amountIn * price / PRICE_SCALE;
  const out = gross * (BPS - FEE_BPS - impact) / BPS;
  if (out <= 0n) fail('INSUFFICIENT_LIQUIDITY', 'Output rounds to zero.');
  const inventory = buyBase ? baseCash : quoteCash;
  if (out > inventory) fail('INSUFFICIENT_LIQUIDITY', 'Pool inventory cannot fill this trade.');
  const execPrice = buyBase ? amountIn * PRICE_SCALE / out : out * PRICE_SCALE / amountIn;
  const deviation = execPrice > price ? execPrice - price : price - execPrice;
  if (deviation * BPS / price > ORACLE_DEV_BPS) fail('SLIPPAGE_EXCEEDED', 'Execution price moved too far from the oracle.');
  const next = buyBase
    ? {baseCash: baseCash - out, quoteCash: quoteCash + amountIn}
    : {baseCash: baseCash + amountIn, quoteCash: quoteCash - out};
  return {out, impact, feeBps: FEE_BPS, execPrice, ...next};
}

export function assertCashFloor(market) {
  if (market.quoteCash < minCash(market)) fail('INSUFFICIENT_LIQUIDITY', 'Action would breach the cash reserve floor.');
}

export function ltvBps(debt, collateral, price) {
  if (collateral <= 0n || price <= 0n) return debt > 0n ? BPS * 10n : 0n;
  return debt * PRICE_SCALE * BPS / (collateral * price);
}

export function maxBorrow(collateral, price, debt) {
  const capacity = collateral * price * MAX_LTV_BPS / (PRICE_SCALE * BPS);
  return capacity > debt ? capacity - debt : 0n;
}

export function healthBps(debt, collateral, price) {
  if (debt <= 0n) return 0n;
  return collateral * price * LIQ_BPS / (debt * PRICE_SCALE);
}

export function liquidation(debt, collateral, price) {
  const ltv = ltvBps(debt, collateral, price);
  if (ltv < LIQ_BPS) fail('HEALTH_LIMIT', 'Position is healthy.');
  let repay = debt * CLOSE_BPS / BPS;
  if (repay <= 0n) repay = debt;
  if (repay > debt) repay = debt;
  const seize = repay * PRICE_SCALE * (BPS + BONUS_BPS) / (price * BPS);
  if (seize > collateral) fail('HEALTH_LIMIT', 'Insufficient collateral for this liquidation.');
  return {repay, seize, ltv};
}

export function displayPrice(price) {
  return Number(price) / Number(PRICE_SCALE);
}
