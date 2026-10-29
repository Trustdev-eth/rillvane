import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyInstruction, freshMarket, freshWallet, dumpWallet, applyLiquidation, setOracle} from './engine.mjs';
import {toUnits, START_PRICE, fromUnits} from './math.mjs';

const now = 1_700_000_000_000;
const dump = wallet => dumpWallet(wallet);

function run(kind, payload, market, wallet, time = now) {
  const instruction = {kind, nonce: wallet.nonce ?? '0', deadline: time + 15_000, ...payload};
  if (wallet.nonce === undefined) instruction.nonce = '0';
  return applyInstruction(market, dump(typeof wallet.base === 'bigint' ? wallet : wallet), instruction, time);
}

test('faucet then supply, swap, collateral, borrow, repay, withdraw', () => {
  let market = freshMarket(now);
  let wallet = dump(freshWallet());
  let step = applyInstruction(market, wallet, {kind:'faucet', asset:'USDC', amountIn: toUnits('20000').toString(), nonce:'0', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  step = applyInstruction(market, wallet, {kind:'faucet', asset:'RLVN', amountIn: toUnits('200').toString(), nonce:'1', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  step = applyInstruction(market, wallet, {kind:'supply', asset:'USDC', amountIn: toUnits('10000').toString(), nonce:'2', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  assert.equal(BigInt(wallet.quoteShares) > 0n, true);
  step = applyInstruction(market, wallet, {kind:'swap', side:'buy', amountIn: toUnits('100').toString(), nonce:'3', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  assert.equal(BigInt(wallet.base) > 0n, true);
  step = applyInstruction(market, wallet, {kind:'credit', action:'add', amountIn: toUnits('100').toString(), nonce:'4', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  step = applyInstruction(market, wallet, {kind:'credit', action:'borrow', amountIn: toUnits('4000').toString(), nonce:'5', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  assert.equal(BigInt(wallet.quote) >= toUnits('13900'), true);
  step = applyInstruction(market, wallet, {kind:'credit', action:'repay', amountIn: toUnits('4000').toString(), nonce:'6', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  step = applyInstruction(market, wallet, {kind:'credit', action:'remove', amountIn: toUnits('100').toString(), nonce:'7', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  const shares = wallet.quoteShares;
  step = applyInstruction(market, wallet, {kind:'withdraw', asset:'USDC', amountIn: shares, nonce:'8', deadline: now + 60_000}, now);
  assert.equal(BigInt(step.wallet.quoteShares), 0n);
});

test('replayed nonce is rejected', () => {
  const market = freshMarket(now);
  const wallet = dump(freshWallet());
  const first = applyInstruction(market, wallet, {kind:'faucet', asset:'USDC', amountIn: toUnits('10').toString(), nonce:'0', deadline: now + 60_000}, now);
  assert.throws(() => applyInstruction(market, first.wallet, {kind:'faucet', asset:'USDC', amountIn: toUnits('10').toString(), nonce:'0', deadline: now + 60_000}, now), /nonce/i);
});

test('price drop enables bounded liquidation of 35 RLVN', () => {
  let market = freshMarket(now);
  let wallet = dump(freshWallet());
  let step = applyInstruction(market, wallet, {kind:'faucet', asset:'RLVN', amountIn: toUnits('100').toString(), nonce:'0', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  step = applyInstruction(market, wallet, {kind:'credit', action:'add', amountIn: toUnits('100').toString(), nonce:'1', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  step = applyInstruction(market, wallet, {kind:'credit', action:'borrow', amountIn: toUnits('4000').toString(), nonce:'2', deadline: now + 60_000}, now);
  wallet = step.wallet; market = step.market;
  market = setOracle(market, 60_000_000n, now, 2);
  const liq = applyLiquidation(market, wallet, now);
  assert.equal(liq.event.seize, toUnits('35').toString());
  assert.equal(liq.event.repay, toUnits('2000').toString());
});
