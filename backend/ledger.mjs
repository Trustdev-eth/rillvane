import {randomUUID} from 'node:crypto';
import {ASSETS, VAULTS, INITIAL_STATE} from '../dist/workspace-data.js';

export const freshAccount = () => structuredClone(INITIAL_STATE);
const fail = message => {throw Object.assign(new Error(message), {status:422});};
const positive = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e9) fail('Enter a valid positive amount.');
  return value;
};
const findAsset = symbol => ASSETS.find(a => a.symbol === symbol) || fail('Unknown sample asset.');
const available = (amount, balance) => {if (amount > balance + 1e-9) fail('Insufficient demo balance.');};

// Sample-price accounting only. This module cannot construct or broadcast a transaction.
export function applyAction(previous, action) {
  const state = structuredClone(previous);
  const record = (type, symbol, amount, detail) => state.activity.unshift({id:'SIM-'+randomUUID(), type, asset:symbol, amount, value:amount*findAsset(symbol).price, detail, time:new Date().toISOString()});
  if (action.kind === 'reset') return freshAccount();
  if (action.kind === 'cancel') {
    const order = state.orders.find(o => o.id === action.id);
    if (!order) fail('Order is no longer open.');
    state.wallet[order.payAsset] += order.pay;
    state.orders = state.orders.filter(o => o.id !== order.id);
    record('Cancel order',order.payAsset,order.pay,'Released demo order reserve');
  } else if (action.kind === 'trade') {
    const amount = positive(action.amount), from = findAsset(action.from), to = findAsset(action.to);
    if (from.symbol === to.symbol || (from.symbol !== 'USDC' && to.symbol !== 'USDC')) fail('Choose a supported USDC market.');
    if (!['swap','limit'].includes(action.mode)) fail('Unknown order type.');
    available(amount,state.wallet[from.symbol]);
    const base = from.symbol === 'USDC' ? to : from, sell = to.symbol === 'USDC';
    let received;
    if (action.mode === 'limit') {
      const limit = positive(action.limit);
      if (action.postOnly && (sell ? limit <= base.price : limit >= base.price)) fail('Post-only order would cross the sample mid price.');
      received = sell ? amount*limit*.999 : amount/limit*.999;
      state.orders.unshift({id:'ORDER-'+randomUUID(),asset:base.symbol,side:sell?'sell':'buy',payAsset:from.symbol,receiveAsset:to.symbol,price:limit,pay:amount,quantity:sell?amount:received,postOnly:!!action.postOnly,createdAt:new Date().toISOString()});
      record('Limit order',from.symbol,amount,'Demo reserve at '+limit);
    } else {
      const impact = Math.min(.019, amount*from.price/base.liquidity*5);
      received = amount*from.price*.999*(1-impact)/to.price;
      state.wallet[to.symbol] += received;
      record(sell?'Market sell':'Market buy',to.symbol,received,from.symbol+' → '+to.symbol);
    }
    state.wallet[from.symbol] -= amount;
  } else if (action.kind === 'vault') {
    const vault = VAULTS.find(v=>v.id===action.id) || fail('Unknown sample pool.');
    const amount = positive(action.amount);
    if (!['deposit','withdraw'].includes(action.mode)) fail('Unknown supply action.');
    const delta = action.mode === 'deposit' ? amount : -amount;
    available(amount,delta>0?state.wallet[vault.asset]:(state.deposits[vault.id]||0));
    state.wallet[vault.asset] -= delta;
    state.deposits[vault.id] = (state.deposits[vault.id]||0)+delta;
    record(delta>0?'Supply':'Withdraw',vault.asset,amount,vault.name);
  } else if (action.kind === 'credit') {
    const amount = positive(action.amount), price = findAsset('SPYx').price;
    if (action.action === 'borrow') {state.credit.debt+=amount;state.wallet.USDC+=amount;}
    else if (action.action === 'repay') {available(amount,state.wallet.USDC);available(amount,state.credit.debt);state.credit.debt-=amount;state.wallet.USDC-=amount;}
    else if (action.action === 'add') {available(amount,state.wallet.SPYx);state.credit.collateral+=amount;state.wallet.SPYx-=amount;}
    else if (action.action === 'withdraw') {available(amount,state.credit.collateral);state.credit.collateral-=amount;state.wallet.SPYx+=amount;}
    else fail('Unknown credit action.');
    if (['borrow','withdraw'].includes(action.action) && state.credit.debt > state.credit.collateral*price*.65+1e-8) fail('Demo position exceeds the 65% borrowing limit.');
    record(action.action,['borrow','repay'].includes(action.action)?'USDC':'SPYx',amount,'Sample SPYx-backed credit');
  } else fail('Unknown demo action.');
  state.activity = state.activity.slice(0,1000);
  for (const value of [...Object.values(state.wallet),...Object.values(state.deposits),...Object.values(state.credit)]) {
    if (!Number.isFinite(value) || value < -1e-8) fail('Invalid account result.');
  }
  return state;
}
