import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIT, PRICE_SCALE, START_PRICE, INDEX_SCALE, BPS,
  toUnits, fromUnits, depositShares, redeemAssets, swapOut, navQuote, minCash,
  ltvBps, liquidation, accrueIndex, debtFromShares, sharesFromDebt, maxBorrow, ProtocolError
} from './math.mjs';

test('unit conversion round-trips six decimal amounts', () => {
  assert.equal(toUnits('1'), UNIT);
  assert.equal(toUnits('100.5'), 100_500_000n);
  assert.equal(fromUnits(35_000_000n), '35');
  assert.equal(fromUnits(4_000_000_000n), '4000');
  assert.throws(() => toUnits('1.1234567'), ProtocolError);
});

test('bootstrap shares equal the first deposit', () => {
  assert.equal(depositShares(toUnits('1000'), 0n, 0n), toUnits('1000'));
  assert.equal(depositShares(toUnits('500'), toUnits('1000'), toUnits('1000')), toUnits('500'));
});

test('zero liquidity swaps are rejected', () => {
  assert.throws(() => swapOut({buyBase:true, amountIn:UNIT, price:START_PRICE, baseCash:0n, quoteCash:0n}), /no inventory/i);
});

test('exact-input buy and sell agree with oracle at the starting price', () => {
  const pool = {baseCash: toUnits('10000'), quoteCash: toUnits('1000000')};
  const buy = swapOut({buyBase:true, amountIn:toUnits('100'), price:START_PRICE, ...pool});
  assert.equal(buy.out > 0n, true);
  assert.equal(buy.quoteCash, pool.quoteCash + toUnits('100'));
  assert.equal(buy.baseCash, pool.baseCash - buy.out);
  const sell = swapOut({buyBase:false, amountIn:buy.out, price:START_PRICE, baseCash:buy.baseCash, quoteCash:buy.quoteCash});
  assert.equal(sell.out < toUnits('100'), true);
});

test('NAV includes loans and cash floor is 10 percent', () => {
  const market = {quoteCash: toUnits('9000'), quoteDebt: toUnits('1000')};
  assert.equal(navQuote(market), toUnits('10000'));
  assert.equal(minCash(market), toUnits('1000'));
});

test('dust redemption floors and cannot exceed claims', () => {
  assert.equal(redeemAssets(1n, toUnits('1000'), toUnits('1000')), 1n);
  assert.throws(() => redeemAssets(toUnits('2'), UNIT, UNIT), ProtocolError);
});

test('liquidation vector: 100 RLVN at 60 with 4000 debt seizes 35', () => {
  const collateral = toUnits('100');
  const debt = toUnits('4000');
  const price = 60_000_000n;
  assert.equal(ltvBps(debt, collateral, START_PRICE) < 6000n, true);
  assert.equal(ltvBps(debt, collateral, price) > 6000n, true);
  const result = liquidation(debt, collateral, price);
  assert.equal(result.repay, toUnits('2000'));
  assert.equal(result.seize, toUnits('35'));
});

test('healthy position cannot be liquidated', () => {
  assert.throws(() => liquidation(toUnits('1000'), toUnits('100'), START_PRICE), /healthy/i);
});

test('borrow capacity is 50 percent LTV', () => {
  assert.equal(maxBorrow(toUnits('100'), START_PRICE, 0n), toUnits('5000'));
  assert.equal(maxBorrow(toUnits('100'), START_PRICE, toUnits('4000')), toUnits('1000'));
});

test('interest index grows over a year at 8 percent', () => {
  const yearMs = Number(31_536_000n * 1000n);
  const shares = sharesFromDebt(UNIT, INDEX_SCALE);
  const next = accrueIndex(INDEX_SCALE, 0, yearMs);
  assert.equal(next, INDEX_SCALE * 108n / 100n);
  assert.equal(debtFromShares(shares, next), UNIT * 108n / 100n);
});

test('all cash borrowed blocks further quote outflow via reserve floor', () => {
  const market = {quoteCash: toUnits('1000'), quoteDebt: toUnits('9000')};
  assert.equal(minCash(market), toUnits('1000'));
  assert.equal(market.quoteCash >= minCash(market), true);
  assert.equal(market.quoteCash - 1n >= minCash({quoteCash: market.quoteCash - 1n, quoteDebt: market.quoteDebt + 1n}), false);
});
