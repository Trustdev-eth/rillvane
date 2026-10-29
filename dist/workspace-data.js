export const ASSETS = [
  {symbol:'USDC',name:'USD Coin',category:'Stablecoin',price:1,change:0,color:'#2775CA',letter:'$',icon:'/assets/tokens/usdc.svg',liquidity:0,supply:0,borrow:8},
  {symbol:'RLVN',name:'Rillvane',category:'Protocol',price:100,change:0,color:'#65dcff',letter:'R',icon:'/assets/tokens/rlvn.svg',liquidity:0,supply:0,borrow:8}
];
export const TOKEN_ICONS={USDC:'/assets/tokens/usdc.svg',RLVN:'/assets/tokens/rlvn.svg'};
export function tokenIcon(symbol,small=false){
  const a=asset(symbol);
  const src=a.icon||TOKEN_ICONS[a.symbol]||TOKEN_ICONS.RLVN;
  return `<span class="asset-icon${small?' small':''} token-${String(a.symbol).toLowerCase()}" title="${a.name}"><img src="${src}" alt="" width="32" height="32"></span>`;
}
export function tokenMark(symbol,small=true){
  const a=asset(symbol);
  return `<span class="token-mark">${tokenIcon(a.symbol,small)}<b>${a.symbol}</b></span>`;
}
export function pairIcons(){
  return `<span class="pair-icons" aria-hidden="true">${tokenIcon('RLVN')}${tokenIcon('USDC')}</span>`;
}
export const VAULTS = [
  {id:'usdc',name:'USDC supply',asset:'USDC',type:'Stablecoin',apy:0,utilization:0,total:0,available:0,description:'Single-asset USDC supply. Interest is paid by borrowers at a fixed 8% APR, pro-rata to utilization.'},
  {id:'rlvn',name:'RLVN supply',asset:'RLVN',type:'Protocol',apy:0,utilization:0,total:0,available:0,description:'Single-asset RLVN inventory. Used to settle buys against the oracle-priced pool.'}
];
export const INITIAL_STATE = {
  wallet:{USDC:0,RLVN:0},
  deposits:{usdc:0,rlvn:0},
  supplied:{usdc:0,rlvn:0},
  credit:{collateral:0,debt:0},
  watchlist:['RLVN'],
  slippage:.5,
  activity:[],
  orders:[],
  nonce:'0',
  ltv:0,
  health:null,
  borrowCapacity:0,
  price:100
};
export const asset = symbol => ASSETS.find(a=>a.symbol===symbol)||ASSETS[0];
export const money = (v,d=2) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
export const number = (v,d=4) => new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(v);
export const compact = v => v>=1e6?`$${(v/1e6).toFixed(2)}M`:v>=1e3?`$${(v/1e3).toFixed(0)}K`:`$${Number(v||0).toFixed(0)}`;
export function accountTotals(state){
  const rlvnPrice=asset('RLVN').price;
  const wallet=(state.wallet.USDC||0)+(state.wallet.RLVN||0)*rlvnPrice;
  const supplied=(state.supplied?.usdc??state.deposits.usdc??0)+(state.supplied?.rlvn??state.deposits.rlvn??0)*rlvnPrice;
  const collateral=(state.credit.collateral||0)*rlvnPrice;
  return {wallet,supplied,collateral,locked:0,debt:state.credit.debt||0,net:wallet+supplied+collateral-(state.credit.debt||0)};
}
export function applyMarket(state, market, pool){
  if(market){
    const rlvn=asset('RLVN');
    rlvn.price=market.price;
    rlvn.change=Number(market.change||0);
    rlvn.liquidity=Number(market.baseCash||0)*market.price;
    rlvn.supply=market.supplyApy||0;
    rlvn.borrow=market.borrowApr||8;
    const usdc=asset('USDC');
    usdc.supply=market.supplyApy||0;
    usdc.borrow=market.borrowApr||8;
    usdc.liquidity=Number(market.quoteCash||0);
  }
  if(pool){
    const usdc=VAULTS.find(v=>v.id==='usdc'), rlvn=VAULTS.find(v=>v.id==='rlvn');
    if(usdc){
      usdc.total=Number(pool.navQuote||pool.quoteCash||0);
      usdc.available=Number(pool.quoteCash||0);
      usdc.utilization=Number(pool.utilizationBps||0)/100;
      usdc.apy=(market?.supplyApy)||0;
    }
    if(rlvn){
      rlvn.total=Number(pool.baseCash||0);
      rlvn.available=Number(pool.baseCash||0);
      rlvn.utilization=0;
      rlvn.apy=0;
    }
  }
  return state;
}
