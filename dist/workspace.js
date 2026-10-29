import {chartWindow,panChart,zoomChart} from './chart-navigation.js';
import {initializeSiteLinks} from './site-links.js';
import {initializeAppLoading} from './app-loading.js';
import {captureMotion,finishRender,moveIndicator,animateChart,setBusy,showNotification,animateModal,initializeMotion} from './app-motion.js';
import {candleChart,chartHover,orderBook,orderBookBody,marketStrip,paintLiveChart} from './market-ui.js';
import {CHART_DEFAULTS,loadChartPreferences,saveChartPreferences,chartSettingsContent} from './chart-preferences.js';
import {backendSession,initializeBackend,quoteAction,submitIntent,claimFaucet,fetchMarkets,fetchPool,fetchTrades,fetchCandles,setStreamView,streamConnected,connectWallet,signOut,openChainWallet} from './backend-client.js';
import {ASSETS,VAULTS,INITIAL_STATE,asset,money,number,compact,accountTotals,applyMarket,tokenIcon,tokenMark,pairIcons} from './workspace-data.js';
const $=s=>document.querySelector(s), escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>JSON.parse(JSON.stringify(v));
initializeSiteLinks();
const appLoading=initializeAppLoading();
const NAV_EXPANDED_KEY='rillvane-nav-expanded';
function readNavExpanded(){try{return localStorage.getItem(NAV_EXPANDED_KEY)!=='0';}catch{return false;}}
let navMotionTimer;
function setNavExpanded(open){
  document.documentElement.classList.toggle('nav-expanded',open);
  document.body.classList.toggle('nav-expanded',open);
  try{localStorage.setItem(NAV_EXPANDED_KEY,open?'1':'0');}catch{}
  const b=$('.desktop-nav-toggle');
  if(b){
    b.setAttribute('aria-expanded',String(open));
    const label=open?'Collapse navigation to icons':'Expand navigation labels';
    b.setAttribute('aria-label',label);b.title=label;
  }
  terminalChartObserver?.disconnect();
  clearTimeout(navMotionTimer);
  navMotionTimer=setTimeout(()=>{if(page==='trade')observeTerminalChart();},320);
}
try{
  const open=readNavExpanded();
  document.documentElement.classList.toggle('nav-expanded',open);
  document.body.classList.toggle('nav-expanded',open);
}catch{}
function armNavMotion(){
  const enable=()=>{
    document.documentElement.classList.remove('nav-boot');
    document.documentElement.classList.add('nav-motion');
  };
  requestAnimationFrame(()=>requestAnimationFrame(enable));
  setTimeout(enable,400);
}
let state=clone(INITIAL_STATE), livePool=null, liveTrades=[], liveCandles=[], liveCandleInterval='1h';
const ui={range:'1M',marketFilter:'all',search:'',vaultFilter:'all',tradeMode:'swap',pay:'USDC',receive:'RLVN',amount:'',tradePercent:null,extra:'positions',creditAction:'borrow',creditAmount:'',portfolioTab:'wallet',activityFilter:'all',shock:-20,side:'buy',interval:'1h',chartStyle:'candles',volume:true,candleCount:64,chartEnd:null,earliest:null,historyLoading:false,historyError:false,bookView:'book',showBook:true,focusChart:false,...loadChartPreferences()};
let page='overview',routeKey='',pending=null,modalState=null,lastQuote=null,quoteTimer,quoteSequence=0,readViewStamp='';
const labels={overview:'Overview',markets:'Markets',trade:'Trade',earn:'Supply',borrow:'Borrow',portfolio:'Portfolio',activity:'Activity',risk:'Risk monitor'};
const iconPaths={grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',market:'<path d="M4 20V10m5 10V4m6 16v-7m5 7V7M2 21h20"/>',swap:'<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',layers:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',credit:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h4"/>',wallet:'<path d="M19 7V4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16V7H5a1 1 0 0 1 0-2"/><path d="M21 11h-6v5h6m-3-2.5h.1"/>',activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',shield:'<path d="M12 3 3 7v6c0 5 9 8 9 8s9-3 9-8V7l-9-4Z"/><path d="m8 12 3 3 5-6"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2m0 3h.01"/>','arrow-left':'<path d="M20 12H4m6-6-6 6 6 6"/>','arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>','arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>','arrow-down':'<path d="M12 4v16m-6-6 6 6 6-6"/>','chevron-down':'<path d="m6 9 6 6 6-6"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',settings:'<path d="m10 3-.7 2.2-2 .9L5 5.5 3.5 8l1.5 1.8-.1 2.2L3 13.5 4.5 16l2.3-.3 1.8 1.2L9 20h3l1-2.2 2-.8 2.3.5 1.5-2.5-1.5-1.8.1-2.2 1.9-1.5-1.5-2.5-2.3.3-1.8-1.2L13 3h-3Z"/><circle cx="11" cy="11.5" r="3"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',star:'<path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',check:'<path d="m5 12 4 4L19 6"/>',plus:'<path d="M12 4v16M4 12h16"/>',minus:'<path d="M4 12h16"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',refresh:'<path d="M20 8a8 8 0 1 0 .4 7M20 3v5h-5"/>',alert:'<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',chevron:'<path d="m9 5 7 7-7 7"/>',external:'<path d="M14 3h7v7m-1-6L10 14m-3-9H3v16h16v-4"/>'};
const icon=(name,cls='')=>`<svg class="${cls}" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]||iconPaths.grid}</svg>`;
function hydrate(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
const assetCell=symbol=>{const a=asset(symbol);return `<span class="asset-cell">${tokenIcon(symbol)}<span><strong>${a.symbol}</strong><p>${a.name}</p></span></span>`;};
const positive=v=>`<span class="${v>=0?'positive':'negative'}">${v>=0?'+':''}${Number(v).toFixed(2)}%</span>`;
const stat=(label,value,note='',live='')=>`<div><span class="stat-label">${label}</span><strong class="stat-value"${live?` data-live="${live}"`:''}>${value}</strong>${note?`<p class="stat-note">${note}</p>`:''}</div>`;
const accountShell=s=>JSON.stringify({w:s.wallet,d:s.deposits,s:s.supplied,c:s.credit,n:s.nonce,len:(s.activity||[]).length,last:s.activity?.[0]?.id||s.activity?.[0]?.time||''});
function setLive(name,value,className){
  document.querySelectorAll(`[data-live="${name}"]`).forEach(el=>{
    if(el.textContent!==value)el.textContent=value;
    if(className!=null&&el.className!==className)el.className=className;
  });
}
function syncSessionHeader(){
  const w=backendSession(),chip=$('#header-account'),label=$('#header-account-label'),row=$('#header-balances');
  if(label&&!chip?.classList.contains('is-busy'))label.textContent=w?w.slice(0,4)+'…'+w.slice(-4):'Connect wallet';
  chip?.classList.toggle('wallet-on',!!w);
  chip?.toggleAttribute('data-connected',!!w);
  chip?.setAttribute('aria-label',w?'Account '+(w.slice(0,4)+'…'+w.slice(-4)):'Connect wallet');
  if(row){
    row.hidden=false;
    row.toggleAttribute('data-empty',!w);
  }
  setLive('header-usdc',number(state.wallet.USDC||0,2));
  setLive('header-rlvn',number(state.wallet.RLVN||0,4));
}
function markTabs(action,value){
  const buttons=[...document.querySelectorAll(`[data-action="${action}"]`)];
  buttons.forEach(button=>{
    const on=button.dataset.value===value;
    button.classList.toggle('active',on);
    if(action==='trade-side'){
      button.classList.toggle('buy',button.dataset.value==='buy'&&on);
      button.classList.toggle('sell',button.dataset.value==='sell'&&on);
    }
    if(button.hasAttribute('aria-pressed'))button.setAttribute('aria-pressed',String(on));
    if(button.hasAttribute('aria-selected'))button.setAttribute('aria-selected',String(on));
  });
  const group=buttons[0]?.closest('.desk-tabs,.trade-side,.tabs,.credit-tabs,.setting-pills,.range-switch,.order-type-tabs,.chart-pref-layout nav');
  moveIndicator(group);
}
const detail=(label,value)=>`<div class="detail-row"><span>${label}</span><strong>${value}</strong></div>`;
const pageHead=(title,description,actions='',eyebrow='YOUR WORKSPACE')=>`<div class="page-head${actions?' with-actions':''}"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${actions?`<div class="head-actions">${actions}</div>`:''}</div>`;
const MAX_LTV=.5,LIQUIDATION_LTV=.6;
function chart(base,key,performance=false){
  if(!liveCandles.length && !performance) return `<div class="desk-empty"><strong>No price history yet</strong><p>Candles appear after swaps execute.</p></div>`;
  const values=performance?[base,base]:liveCandles
    .filter(c=>Number.isFinite(Number(c?.close))&&Number.isFinite(Number(c?.time)))
    .sort((a,b)=>a.time-b.time)
    .slice(-64)
    .map(c=>Number(c.close));
  if(values.length<2) values.push(base,base);
  const mobile=innerWidth<768,w=mobile?380:900,h=mobile?188:250,left=2,right=w-(mobile?66:88),top=17,bottom=h-26,min=Math.min(...values)*.998,max=Math.max(...values)*1.002;
  const pts=values.map((v,i)=>[left+i/(values.length-1)*(right-left),bottom-(v-min)/(max-min||1)*(bottom-top)]);
  const path=pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return `<div class="chart-container"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${performance?'Account value':'RLVN price'} chart"><defs><linearGradient id="flow-chart" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--accent)" stop-opacity=".16"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${[0,.333,.666,1].map(t=>{const y=top+(bottom-top)*t;return `<path d="M${left} ${y}H${right}" stroke="var(--line-soft)" stroke-width=".7" stroke-dasharray="3 6"/><text x="${right+12}" y="${y+4}" fill="var(--dim)" font-family="DM,Arial" font-size="${mobile?11:13}">${money(max-(max-min)*t,performance?0:2)}</text>`;}).join('')}<path d="${path} L${right} ${bottom} L${left} ${bottom}Z" fill="url(#flow-chart)"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/></svg></div>`;
}
function marketTable(list){
  return `<div class="table-scroll"><table><thead><tr><th>Asset</th><th class="num">Oracle</th><th class="num">Inventory</th><th class="num optional-column">Supply APY</th><th class="num">Borrow APR</th><th></th></tr></thead><tbody>${list.map(a=>`<tr><td><div class="asset-cell"><button class="star-button ${state.watchlist.includes(a.symbol)?'selected':''}" data-action="watch" data-asset="${a.symbol}" aria-label="Watch ${a.symbol}">${icon('star')}</button><button data-action="asset" data-asset="${a.symbol}" style="text-align:left;padding:0">${assetCell(a.symbol)}</button></div></td><td class="num" data-live="table-oracle">${money(a.price)}</td><td class="num" data-live="table-inventory">${compact(a.liquidity)}</td><td class="num optional-column positive">${a.supply.toFixed(2)}%</td><td class="num">${a.borrow.toFixed(2)}%</td><td class="num"><a href="#trade/${a.symbol}" class="row-action">Trade ${icon('arrow-up-right')}</a></td></tr>`).join('')}</tbody></table></div>${!list.length?'<div class="empty-state"><strong>No matching markets</strong></div>':''}`;
}
function activityTable(list,limit=0){
  if(limit)list=list.slice(0,limit);
  return list.length?`<div class="table-scroll"><table><thead><tr><th>Action</th><th>Asset</th><th class="num">Amount</th><th class="optional-column">Time (UTC)</th><th>Signature</th></tr></thead><tbody>${list.map(a=>`<tr><td><div class="activity-type"><span class="activity-icon">${icon(['Swap','Market buy','Market sell'].includes(a.type)?'swap':a.type==='Borrow'||a.type==='Repay'?'credit':'layers')}</span><span><strong>${escape(a.type)}</strong><p>${escape(a.detail||'')}</p></span></div></td><td>${a.asset}</td><td class="num">${number(a.amount)} <span class="dim">${a.asset}</span></td><td class="optional-column activity-date">${new Date(a.time).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})}</td><td class="num">${a.signature?`<code title="${escape(a.signature)}">${escape(String(a.signature).slice(0,8))}…</code>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><strong>No activity yet</strong>Connect a wallet, claim the faucet, then swap, supply, or borrow.</div>';
}
function overview(){
  const t=accountTotals(state),deployed=t.supplied+t.collateral-t.debt;
  const alloc=[['Wallet',t.wallet,'var(--positive)'],['Supply positions',t.supplied,'var(--accent)'],['Collateral, net of debt',Math.max(0,t.collateral-t.debt),'var(--allocation-credit)']];
  const summary=[
    ['Available balance',money(state.wallet.USDC),'USDC in your wallet','wallet','portfolio','overview-available'],
    ['Supplied',money(t.supplied),'Single-asset positions','layers','earn','overview-supplied'],
    ['Borrowed',money(t.debt),'Outstanding USDC debt','credit','borrow','overview-debt']
  ];
  return `<div class="landscape-overview">
    <section class="landscape-hero" aria-labelledby="overview-title">
      <picture><source media="(max-width:767px)" srcset="/assets/landscape/landing-valley-small-v2.webp"><img class="landscape-hero-art" src="/assets/landscape/landing-valley-v2.webp" alt="" width="2172" height="724" fetchpriority="high" decoding="async"></picture>
      <div class="landscape-hero-copy"><div class="eyebrow">YOUR WORKSPACE</div><h1 id="overview-title">A clearer view<br>of your capital.</h1><div class="landscape-hero-value" data-live="net">${money(t.net)}</div><p class="landscape-hero-label">Total portfolio value</p></div>
      <span class="landscape-hero-signature" aria-hidden="true">Capital, connected.</span>
    </section>
    <div class="landscape-content">
      <div class="landscape-summary" aria-label="Account balances">${summary.map(([label,value,note,glyph,route,live])=>`<a href="#${route}" class="landscape-summary-card"><span class="landscape-summary-icon">${icon(glyph)}</span><div>${stat(label,value,note,live)}</div><span class="landscape-summary-arrow" aria-hidden="true">${icon('chevron')}</span></a>`).join('')}</div>
      <div class="landscape-grid">
        <section class="panel landscape-market" aria-labelledby="overview-market-title">
          <div class="landscape-market-head"><div><h2 id="overview-market-title">Market overview</h2><p>RLVN / USDC &middot; Oracle-priced pool</p></div><a href="#trade" class="secondary-button">Open market ${icon('arrow-up-right')}</a></div>
          <div class="market-price"><strong data-live="oracle">${money(asset('RLVN').price)}</strong><span>Oracle &middot; USDC</span></div>
          <div id="overview-market-chart" class="landscape-market-chart">${chart(asset('RLVN').price,'market')}</div>
          ${marketTable(ASSETS.filter(a=>a.symbol!=='USDC'))}
        </section>
        <div class="landscape-side">
          <section class="panel landscape-next" aria-labelledby="next-move-title"><h2 id="next-move-title">Your next move</h2><div class="quick-actions">
            <a class="quick-action" href="#trade"><span class="quick-icon">${icon('swap')}</span><div><strong>Trade assets</strong><p>Move between RLVN and USDC.</p></div><i aria-hidden="true">${icon('chevron')}</i></a>
            <a class="quick-action" href="#earn"><span class="quick-icon">${icon('layers')}</span><div><strong>Supply liquidity</strong><p>Put a single asset to work.</p></div><i aria-hidden="true">${icon('chevron')}</i></a>
            <a class="quick-action" href="#borrow"><span class="quick-icon">${icon('credit')}</span><div><strong>Explore credit</strong><p>Borrow against your RLVN.</p></div><i aria-hidden="true">${icon('chevron')}</i></a>
          </div></section>
          <section class="panel allocation-panel landscape-allocation" aria-label="Capital allocation"><div class="allocation-title">Capital allocation</div><div class="allocation-total">${money(Math.max(0,deployed))}</div><div class="allocation-bar">${t.net?alloc.map(a=>`<span style="width:${Math.max(0,a[1])/t.net*100}%;background:${a[2]}"></span>`).join(''):''}</div><div class="allocation-legend">${alloc.map(a=>`<div class="legend-row"><span><i class="legend-dot" style="background:${a[2]}"></i>${a[0]}</span><span>${t.net?(a[1]/t.net*100).toFixed(1):'0.0'}%</span></div>`).join('')}</div><div class="allocation-foot">Credit health <strong>${state.credit.debt?creditHealth().toFixed(2):'&mdash;'} <span class="positive">${state.credit.debt?'Active':'No debt'}</span></strong></div></section>
        </div>
      </div>
      <section class="panel landscape-activity" aria-labelledby="recent-activity-title"><div class="panel-heading"><h2 id="recent-activity-title">Recent activity</h2><a class="text-button" href="#activity">View all ${icon('arrow-right')}</a></div>${activityTable(state.activity,3)}</section>
    </div>
  </div>`;
}
function filteredMarkets(){return ASSETS.filter(a=>a.symbol!=='USDC'&&(ui.marketFilter==='all'||ui.marketFilter==='watchlist'&&state.watchlist.includes(a.symbol))&&(a.name+' '+a.symbol).toLowerCase().includes(ui.search.toLowerCase()));}
function markets(){return `${pageHead('Asset markets','The RLVN/USDC inventory pool. Oracle price, cash, and utilization.','','ASSET MARKETS')}<div class="summary-grid">${[['Market','RLVN / USDC','Oracle-priced pool'],['Oracle',money(asset('RLVN').price),'100 USDC start','oracle'],['Quote cash',compact(Number(livePool?.quoteCash||0)),'Spendable inventory','quote-cash'],['Borrow APR','8.00%','Fixed']].map(a=>`<div class="summary-card">${stat(...a)}</div>`).join('')}</div><section class="panel"><div class="market-toolbar"><div class="tabs">${[['all','All markets'],['watchlist','Watchlist']].map(([v,n])=>`<button data-action="market-filter" data-value="${v}" class="${ui.marketFilter===v?'active':''}">${n}</button>`).join('')}</div><label class="search-field">${icon('search')}<input id="market-search" placeholder="Search markets" value="${escape(ui.search)}"></label></div><div id="market-results">${marketTable(filteredMarkets())}</div></section>`;}
function currentMarket(){return asset(ui.receive==='USDC'?ui.pay:ui.receive);}
function terminalTicket(a){
  const from=asset(ui.pay),to=asset(ui.receive),buy=ui.side==='buy',t=accountTotals(state);
  return `<section class="panel terminal-ticket" aria-label="Trading ticket"><div class="desk-panel-head"><h2>Market order</h2><span class="ticket-market-kind">EXACT IN</span></div><div class="ticket-body">
 <div class="trade-side" aria-label="Order side"><button type="button" data-action="trade-side" data-value="buy" aria-pressed="${buy}" class="${buy?'active buy':''}">Buy ${tokenIcon(a.symbol,true)} <span>${a.symbol}</span></button><button type="button" data-action="trade-side" data-value="sell" aria-pressed="${!buy}" class="${!buy?'active sell':''}">Sell ${tokenIcon(a.symbol,true)} <span>${a.symbol}</span></button></div>
 <div class="ticket-available"><span>Available balance</span><button data-action="trade-percent" data-value="100" title="Use available balance">${number(state.wallet[from.symbol]||0,4)} ${tokenMark(from.symbol)}</button></div>
 <label class="desk-field"><span>${buy?'You pay':'Quantity to sell'}</span><div><input id="trade-amount" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00" value="${escape(ui.amount)}">${tokenMark(from.symbol)}</div></label>
 <div class="order-percent" role="group" aria-label="Order size">${[25,50,75,100].map(n=>`<button type="button" data-action="trade-percent" data-value="${n}" class="${String(ui.tradePercent)===String(n)?'active':''}" aria-pressed="${String(ui.tradePercent)===String(n)}">${n===100?'Max':n+'%'}</button>`).join('')}</div>
 <div class="ticket-output"><div class="ticket-estimate"><span>${buy?'You receive':'Estimated proceeds'}</span></div><div class="ticket-output-value"><strong id="receive-amount">0.00</strong>${tokenMark(to.symbol)}</div></div>
 <details class="execution-details" ${Number(ui.amount)>0?'open':''}><summary>Execution details <span>↘</span></summary><div class="detail-rows">${detail('Trading fee','<span id="quote-fee">10 bps</span>')}${detail('Price impact','<span id="quote-impact">—</span>')}${detail('Slippage tolerance',`<button class="inline-setting" data-action="settings">${state.slippage}% ${icon('settings')}</button>`)}${detail('Minimum received','<span id="quote-min">—</span>')}</div></details>
 <div class="validation-message" id="trade-error" role="status"></div><button class="order-submit ${buy?'buy':'sell'}" data-action="review-trade" id="trade-submit" disabled>${backendSession()?'Enter an amount':'Connect wallet'}</button>
 <details class="ticket-account"><summary>Account overview <strong>${money(t.net)}</strong></summary><div class="detail-rows">${detail('Available USDC',money(state.wallet.USDC))}${detail('Available RLVN',number(state.wallet.RLVN))}${detail('Debt',money(t.debt))}</div></details>
 </div></section>`;
}
function terminalBlotter(){
  if(ui.extra==='fills')return activityTable(state.activity.filter(a=>['Swap','Market buy','Market sell','swap'].includes(a.type)),12);
  const rows=ASSETS.filter(a=>(state.wallet[a.symbol]||0)>0).map(a=>`<tr><td>${assetCell(a.symbol)}</td><td class="num">${number(state.wallet[a.symbol],4)}</td><td class="num">${money(state.wallet[a.symbol]*a.price)}</td></tr>`).join('');
  return rows?`<div class="table-scroll"><table><thead><tr><th>Asset</th><th class="num">Balance</th><th class="num">Value</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="desk-empty"><strong>No balances</strong><p>Claim the faucet after connecting a wallet.</p></div>';
}
function trade(){
  const a=currentMarket();
  return `<h1 class="sr-only">Spot trading terminal</h1>${marketStrip(a.symbol)}
 <section class="terminal-market-bar" aria-label="Current market"><button class="terminal-pair" data-action="market-selector">${pairIcons()}<span><strong>${a.symbol}<small> / USDC</small></strong><em>${a.name}</em></span>${icon('chevron-down')}</button><div class="terminal-mark"><strong data-live="mark-price">${a.price.toFixed(2)}</strong><small>Oracle · USDC</small></div><div class="market-bar-stat"><span>Inventory</span><strong data-live="inventory">${compact(a.liquidity)}</strong></div><div class="market-bar-stat"><span>Fee</span><strong>10 bps</strong></div></section>
 <div class="terminal-shell"><section class="panel terminal-chart" aria-label="Market chart"><div class="chart-toolbar"><div class="desk-tabs" role="tablist" aria-label="Chart interval">${['5m','15m','1h','4h','1d'].map(n=>`<button type="button" role="tab" data-action="chart-interval" data-value="${n}" class="${ui.interval===n?'active':''}" aria-pressed="${ui.interval===n}" aria-selected="${ui.interval===n}">${n}</button>`).join('')}</div><div class="chart-tools"><button type="button" data-action="chart-style" data-value="candles" class="${ui.chartStyle==='candles'?'active':''}" aria-pressed="${ui.chartStyle==='candles'}" aria-label="Candlestick chart" title="Candles">${icon('market')}</button><button type="button" data-action="chart-style" data-value="line" class="${ui.chartStyle==='line'?'active':''}" aria-pressed="${ui.chartStyle==='line'}" aria-label="Line chart" title="Line">${icon('activity')}</button><button type="button" data-action="chart-volume" class="${ui.volume?'active':''}" aria-pressed="${ui.volume}" aria-label="Volume">Vol</button><button type="button" data-action="chart-settings" aria-label="Chart settings">${icon('settings')}</button></div></div><div id="primary-chart" class="terminal-chart-content">${candleChart(a,{...ui,candles:chartSeries(),trades:liveTrades})}</div></section>
 ${ui.showBook?`<section class="panel terminal-book" id="terminal-book">${orderBook(a,ui.bookView,0.01,livePool,liveTrades)}</section>`:''}${terminalTicket(a)}
 <section class="panel terminal-blotter"><div class="desk-panel-head"><div class="desk-tabs">${[['positions','Balances'],['fills','Fills']].map(([v,n])=>`<button data-action="trade-extra" data-value="${v}" class="${ui.extra===v?'active':''}">${n}</button>`).join('')}</div></div><div class="blotter-content">${terminalBlotter()}</div></section></div>
 <div class="terminal-status"><span><i></i>${tokenMark('RLVN')} / ${tokenMark('USDC')}</span><span>Market exact-in · Oracle inventory pool</span><a href="#risk">Risk parameters ${icon('external')}</a></div>`;
}
function earn(){
  const t=accountTotals(state),list=VAULTS.filter(v=>ui.vaultFilter==='all'||ui.vaultFilter==='positions'&&state.deposits[v.id]>0||ui.vaultFilter===v.type.toLowerCase());
  return `${pageHead('Supply markets','Single-asset NAV shares. Withdrawals are bound by cash, not receivables.','','SUPPLY')}<div class="summary-grid">${[['Your supplied assets',money(t.supplied),'NAV redeemable'],['USDC utilization',(VAULTS[0].utilization||0).toFixed(1)+'%','Loans vs quote NAV'],['Borrow APR','8.00%','Paid to USDC suppliers'],['Wallet USDC',money(state.wallet.USDC),'Available to deposit']].map(a=>`<div class="summary-card">${stat(...a)}</div>`).join('')}</div><section class="panel"><div class="market-toolbar"><div class="tabs">${[['all','All markets'],['positions','My positions']].map(([v,n])=>`<button data-action="vault-filter" data-value="${v}" class="${ui.vaultFilter===v?'active':''}">${n}</button>`).join('')}</div></div><div class="table-scroll supply-table"><table><thead><tr><th>Supply market</th><th class="num">Supply APY</th><th class="num">Total</th><th class="num">Available cash</th><th>Utilization</th><th class="num">Your position</th><th></th></tr></thead><tbody>${list.map(v=>`<tr><td><div class="asset-cell">${tokenIcon(v.asset)}<span class="supply-name"><strong>${v.asset}</strong><small>${v.type} · Single asset</small></span></div></td><td class="num positive">${v.apy.toFixed(2)}%</td><td class="num">${compact(v.total)}</td><td class="num">${compact(v.available)}</td><td><span class="util-text">${v.utilization.toFixed(1)}%</span><div class="meter"><span style="width:${Math.min(100,v.utilization)}%"></span></div></td><td class="num">${number(state.supplied?.[v.id]??state.deposits[v.id]??0)} ${v.asset}</td><td><button class="secondary-button" data-action="vault" data-vault="${v.id}">${state.deposits[v.id]>0?'Manage':'Supply'} ${icon('arrow-up-right')}</button></td></tr>`).join('')}</tbody></table></div></section>`;
}
function creditHealth(){return state.credit.debt?state.credit.collateral*asset('RLVN').price*LIQUIDATION_LTV/state.credit.debt:0;}
function creditFigures(){const value=state.credit.collateral*asset('RLVN').price;return{value,ltv:value?state.credit.debt/value:0,capacity:Math.max(0,value*MAX_LTV-state.credit.debt),health:creditHealth()};}
function creditMaximum(){const c=creditFigures();return ui.creditAction==='borrow'?c.capacity:ui.creditAction==='repay'?Math.min(state.credit.debt,state.wallet.USDC):ui.creditAction==='add'?state.wallet.RLVN:Math.max(0,state.credit.collateral-state.credit.debt/(asset('RLVN').price*MAX_LTV||1));}
function borrow(){
  const c=creditFigures(),action=ui.creditAction,unit=['borrow','repay'].includes(action)?'USDC':'RLVN';
  return `${pageHead('Credit & collateral','USDC debt against RLVN collateral. 50% LTV, 60% liquidation, 5% bonus.','','BORROW')}<div class="credit-layout"><div><section class="panel credit-position"><div class="panel-heading"><h2>Your credit line</h2><span class="badge green">${!state.credit.debt?'No outstanding debt':c.ltv<=MAX_LTV?'Within limits':'Review position'}</span></div><div class="asset-cell">${tokenIcon('RLVN')}<div><strong>RLVN collateral</strong><p>Oracle-priced</p></div></div><div class="credit-hero"><div><span class="stat-label">Collateral value</span><strong>${money(c.value)}</strong><p>${number(state.credit.collateral)} RLVN</p></div><div class="credit-ltv"><span class="stat-label">Current loan-to-value</span><strong>${(c.ltv*100).toFixed(1)}%</strong><p>50% borrowing limit</p></div></div><div class="ltv-track"><span class="ltv-marker" style="left:${Math.min(100,c.ltv*100)}%"></span></div><div class="ltv-labels"><span>0%</span><span>Borrow limit 50%</span><span>Liquidation 60%</span><span>100%</span></div><div class="credit-breakdown">${stat('Outstanding debt',money(state.credit.debt))}${stat('Available to borrow',money(c.capacity))}${stat('Borrowing APR','8.00%')}${stat('Position health',state.credit.debt?c.health.toFixed(2):'No debt')}</div></section></div><section class="panel ticket"><h2 style="margin-bottom:17px">Manage credit</h2><div class="credit-tabs">${[['borrow','Borrow'],['repay','Repay'],['add','Add collateral'],['remove','Withdraw collateral']].map(([v,n])=>`<button data-action="credit-tab" data-value="${v}" class="${action===v?'active':''}">${n}</button>`).join('')}</div><label class="field-label" for="credit-amount"><span>${action==='add'?'Add collateral':action==='remove'?'Withdraw collateral':action==='repay'?'Repay amount':'Borrow amount'}</span><span>${unit}</span></label><input class="borrow-input" id="credit-amount" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00" value="${escape(ui.creditAmount)}"><div class="field-label"><span>Available: ${number(creditMaximum())} ${unit}</span><button class="max-button" data-action="credit-max">MAX</button></div><div class="projection"><div class="stat-label" style="margin-bottom:12px">AFTER THIS ACTION</div>${detail('Loan-to-value','<span id="projected-ltv">—</span>')}${detail('Outstanding debt','<span id="projected-debt">—</span>')}${detail('Collateral value','<span id="projected-collateral">—</span>')}</div><div class="validation-message" id="credit-error"></div><button class="primary-button full-button" data-action="review-credit" id="credit-submit" disabled>${backendSession()?'Enter an amount':'Connect wallet'}</button></section></div>`;
}
function portfolioTable(){
  let rows=[];
  if(ui.portfolioTab==='wallet')rows=ASSETS.filter(a=>(state.wallet[a.symbol]||0)>0).map(a=>({asset:a.symbol,qty:state.wallet[a.symbol],value:state.wallet[a.symbol]*a.price,note:'Available balance',action:`<a href="#trade/RLVN" class="row-action">Trade</a>`}));
  else if(ui.portfolioTab==='earn')rows=VAULTS.filter(v=>state.deposits[v.id]>0).map(v=>({asset:v.asset,qty:state.supplied?.[v.id]??state.deposits[v.id],value:(state.supplied?.[v.id]??state.deposits[v.id])*asset(v.asset).price,note:v.name+' / '+number(state.deposits[v.id])+' shares',action:`<button data-action="vault" data-vault="${v.id}" class="row-action">Manage</button>`}));
  else if(state.credit.collateral>0)rows=[{asset:'RLVN',qty:state.credit.collateral,value:state.credit.collateral*asset('RLVN').price,note:'Backing USDC credit',action:'<a href="#borrow" class="row-action">Manage</a>'}];
  return rows.length?`<div class="table-scroll"><table><thead><tr><th>Asset</th><th class="num">Balance</th><th class="num">Value</th><th class="optional-column">Position</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${assetCell(r.asset)}</td><td class="num">${number(r.qty)}</td><td class="num">${money(r.value)}</td><td class="optional-column muted">${r.note}</td><td class="num">${r.action}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><strong>No positions in this view</strong>Connect a wallet and claim the faucet to start.</div>';
}
function portfolio(){const t=accountTotals(state);return `${pageHead('Positions & balances','Wallet, supply claims, and RLVN collateral.',`<button class="secondary-button" data-action="export">${icon('download')}Export activity</button>`,'PORTFOLIO')}<div class="summary-grid">${[['Net account value',money(t.net),'Assets less debt'],['Wallet',money(t.wallet),'RLVN + USDC'],['Supply',money(t.supplied),'NAV shares'],['Collateral',money(t.collateral),'Debt '+money(t.debt)]].map(a=>`<div class="summary-card">${stat(...a)}</div>`).join('')}</div><section class="panel"><div class="panel-heading panel-padding" style="margin:0;border-bottom:1px solid var(--line)"><h2>Your positions</h2></div><div class="tabs portfolio-tabs">${[['wallet','Wallet'],['earn','Supply'],['collateral','Collateral']].map(([v,n])=>`<button data-action="portfolio-tab" data-value="${v}" class="${ui.portfolioTab===v?'active':''}">${n}</button>`).join('')}</div><div id="portfolio-results">${portfolioTable()}</div></section><div class="section-header"><h2>Recent activity</h2><a href="#activity" class="text-button">View activity ${icon('arrow-right')}</a></div><section class="panel">${activityTable(state.activity,5)}</section>`;}
function filteredActivity(){return state.activity.filter(a=>ui.activityFilter==='all'||ui.activityFilter==='swaps'&&['Swap','Market buy','Market sell','swap'].includes(a.type)||ui.activityFilter==='supply'&&['Supply','Withdraw','supply','withdraw'].includes(a.type)||ui.activityFilter==='credit'&&['Borrow','Repay','Collateral','Release collateral','credit'].includes(a.type));}
function activity(){return `${pageHead('Transaction history','Settled instructions for this wallet.',`<button class="secondary-button" data-action="export">${icon('download')}Export CSV</button>`,'ACTIVITY')}<section class="panel"><div class="market-toolbar"><div class="tabs">${[['all','All activity'],['swaps','Swaps'],['supply','Supply'],['credit','Credit']].map(([v,n])=>`<button data-action="activity-filter" data-value="${v}" class="${ui.activityFilter===v?'active':''}">${n}</button>`).join('')}</div></div><div id="activity-results">${activityTable(filteredActivity())}</div></section>`;}
function scenarioResults(){const price=asset('RLVN').price*(1+ui.shock/100),value=state.credit.collateral*price,ltv=value?state.credit.debt/value:0,health=state.credit.debt?value*LIQUIDATION_LTV/state.credit.debt:0;return `${stat('Collateral value',money(value))}${stat('Loan-to-value',(ltv*100).toFixed(1)+'%')}${stat('Position health',state.credit.debt?health.toFixed(2):'No debt')}<div class="info-box" style="grid-column:1/-1;margin-top:8px">${icon(ltv>=LIQUIDATION_LTV?'alert':'info')}<span>${ltv>=LIQUIDATION_LTV?'This shock crosses the 60% liquidation threshold.':ltv>=MAX_LTV?'This shock exceeds the 50% borrow limit.':'This shock remains below the borrow limit.'}</span></div>`;}
function risk(){return `${pageHead('Risk monitor','How RLVN price, cash floor, and LTV affect your positions.','','RISK OVERVIEW')}<div class="risk-grid"><section class="panel scenario-panel"><div class="panel-heading"><h2>Collateral stress test</h2><button class="text-button" data-action="reset-shock">Reset</button></div><p class="panel-subtitle">Apply an oracle shock to your current RLVN collateral. Positions are not changed until an instruction settles.</p><div class="scenario-value" id="shock-value">${ui.shock>0?'+':''}${ui.shock}%</div><input type="range" id="shock-range" min="-50" max="20" step="1" value="${ui.shock}"><div class="scenario-labels"><span>−50%</span><span>No change</span><span>+20%</span></div><div class="scenario-results" id="scenario-results">${scenarioResults()}</div></section><div class="risk-explanation"><section class="panel risk-note"><span>${icon('shield')}</span><h3>Collateral &amp; liquidation</h3><p>Max LTV 50%. Liquidation at 60% with a 5% bonus and 50% close factor.</p></section><section class="panel risk-note"><span>${icon('layers')}</span><h3>Cash floor</h3><p>10% of quote NAV stays unborrowable. Loans are receivables: they count in NAV but cannot pay swaps or withdrawals.</p></section></div></div>`;}
function notify(message,options={}){showNotification(message,options);}
function closeModal(){document.body.classList.remove('modal-open');$('#workspace-modal').classList.remove('chart-settings-dialog');if($('#workspace-modal').open)$('#workspace-modal').close();modalState=null;pending=null;}
function openModal(html){const snapshot=captureMotion(),dialog=$('#workspace-modal'),template=document.createElement('template');template.innerHTML=html;const inner=document.createElement('div'),body=document.createElement('div'),children=[...template.content.children],head=children.find(el=>el.classList.contains('modal-head')),actions=children.find(el=>el.classList.contains('modal-actions'));inner.className='modal-inner';body.className='modal-body';head?.remove();actions?.remove();body.append(template.content);if(head)inner.append(head);inner.append(body);if(actions)inner.append(actions);$('#modal-content').replaceChildren(inner);dialog.classList.toggle('chart-settings-dialog',!!body.querySelector('.chart-pref-layout'));document.body.classList.add('modal-open');if(!dialog.open){dialog.showModal();animateModal(dialog);}finishRender({snapshot});}
const modalHead=title=>`<div class="modal-head"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div>`;
function updateQuote(){
  clearTimeout(quoteTimer);const sequence=++quoteSequence;lastQuote=null;
  const input=$('#trade-amount'),submit=$('#trade-submit');if(!input||!submit)return;
  const amount=Number(ui.amount),side=ui.side,amountIn=String(ui.amount),slippageBps=Math.round(state.slippage*100);
  submit.disabled=true;
  if(!backendSession()){submit.disabled=true;submit.textContent='Connect wallet';return;}
  if(!Number.isFinite(amount)||amount<=0){submit.disabled=true;submit.textContent='Enter an amount';lastQuote=null;return;}
  submit.textContent='Getting quote...';
  quoteTimer=setTimeout(async()=>{
    try{
      const q=await quoteAction('swap',{side,amountIn,slippageBps});
      if(sequence!==quoteSequence||page!=='trade')return;
      lastQuote=q;
      if($('#receive-amount'))$('#receive-amount').textContent=q.amountOut||'0.00';
      if($('#quote-impact'))$('#quote-impact').textContent=(q.impactBps||'0')+'%';
      if($('#quote-min'))$('#quote-min').textContent=(q.minOut||q.amountOut||'0')+' '+(side==='buy'?'RLVN':'USDC');
      if($('#trade-error'))$('#trade-error').textContent='';
      submit.disabled=false;submit.textContent='Review '+side;
    }catch(error){
      if(sequence!==quoteSequence||page!=='trade')return;
      lastQuote=null;
      if($('#trade-error'))$('#trade-error').textContent=error.message;
      submit.disabled=true;submit.textContent='Check order';
    }
  },180);
}
function reviewTrade(){
  if(!lastQuote||lastQuote.expires<=Date.now()){notify('Refreshing the quote. Review the updated amount.');updateQuote();return;}
  pending={kind:'swap',quoteId:lastQuote.quoteId,...lastQuote};
  openModal(`${modalHead('Review market '+ui.side)}<p class="modal-intro">Sign the instruction with your wallet to settle against the pool.</p><div class="review-amount"><span><small>You pay</small><strong>${lastQuote.amountIn} ${ui.pay}</strong></span>${tokenIcon(ui.pay)}</div><div class="review-amount"><span><small>You receive</small><strong>${lastQuote.amountOut} ${ui.receive}</strong></span>${tokenIcon(ui.receive)}</div><div class="detail-rows">${detail('Oracle',money(asset('RLVN').price))}${detail('Minimum received',(lastQuote.minOut||lastQuote.amountOut)+' '+ui.receive)}${detail('Impact',(lastQuote.impactBps||'0')+'%')}${detail('Fee','10 bps')}</div><div class="modal-actions"><button class="secondary-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="confirm">Sign and submit</button></div>`);
}
function openAsset(symbol){const a=asset(symbol);openModal(`${modalHead('Market overview')}<div class="asset-detail-header">${tokenIcon(a.symbol)}<div><h3>${a.symbol}</h3><p>${a.name}</p></div></div><div class="balance-amount">${money(a.price)}</div><div class="asset-detail-stats">${stat('Inventory',compact(a.liquidity))}${stat('Supply APY',a.supply.toFixed(2)+'%')}${stat('Borrow APR',a.borrow.toFixed(2)+'%')}${stat('Wallet',number(state.wallet[a.symbol]||0)+' '+a.symbol)}</div><div class="modal-actions"><a class="primary-button" href="#trade/RLVN" style="flex:1">Trade ${icon('arrow-up-right')}</a></div>`);}
function openVault(id,mode='deposit'){
  modalState={kind:'vault',id,mode};
  const v=VAULTS.find(v=>v.id===id);if(!v)return;
  openModal(`${modalHead(v.name)}<div class="asset-cell" style="margin-bottom:18px">${tokenIcon(v.asset)}<div><strong>${v.asset}</strong><p>Single-asset NAV shares</p></div></div><div class="credit-tabs"><button data-action="vault-tab" data-value="deposit" class="${mode==='deposit'?'active':''}">Deposit</button><button data-action="vault-tab" data-value="withdraw" class="${mode==='withdraw'?'active':''}">Withdraw</button></div><label class="field-label" for="vault-amount"><span>${mode==='deposit'?'Deposit amount':'Shares to redeem'}</span><span>${mode==='deposit'?v.asset:'shares'}</span></label><input class="borrow-input" id="vault-amount" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00"><div class="field-label"><span>${mode==='deposit'?'Wallet':'Supply shares'}: ${number(mode==='deposit'?state.wallet[v.asset]||0:state.deposits[id]||0)} ${mode==='deposit'?v.asset:'shares'}</span><button class="max-button" data-action="vault-max">MAX</button></div><div id="vault-error" class="validation-message"></div><div class="modal-actions"><button class="primary-button full-button" id="vault-submit" data-action="review-vault" disabled>Enter an amount</button></div>`);
}
function vaultAmount(){const v=VAULTS.find(v=>v.id===modalState?.id),amount=Number($('#vault-amount')?.value);if(!v)return null;const max=modalState.mode==='deposit'?(state.wallet[v.asset]||0):(state.deposits[v.id]||0);return{v,amount,max,mode:modalState.mode,error:!Number.isFinite(amount)||amount<=0?'Enter an amount.':amount>max+1e-8?'Amount exceeds your available balance.':''};}
function updateVault(){const q=vaultAmount();if(!q)return;$('#vault-error').textContent=q.amount>0?q.error:'';$('#vault-submit').disabled=!!q.error;$('#vault-submit').textContent=q.error?'Enter a valid amount':q.mode==='deposit'?'Review deposit':'Review withdrawal';}
async function reviewVault(){
  const q=vaultAmount();if(!q||q.error)return;
  const kind=q.mode==='deposit'?'supply':'withdraw',amountIn=$('#vault-amount').value,button=$('#vault-submit');
  setBusy(button,true,'Getting quote...');
  try{
    const quote=await quoteAction(kind,{asset:q.v.asset,amountIn});
    pending={kind,quoteId:quote.quoteId,expires:quote.expires};
    const amount=q.mode==='deposit'?quote.amountIn:quote.amountOut;
    openModal(`${modalHead(q.mode==='deposit'?'Review deposit':'Review withdrawal')}<div class="review-amount"><span><small>${q.mode==='deposit'?'You supply':'You receive'}</small><strong>${amount} ${q.v.asset}</strong></span>${tokenIcon(q.v.asset)}</div><div class="detail-rows">${detail(q.mode==='deposit'?'Shares received':'Shares redeemed',quote.shares)}</div><div class="modal-actions"><button class="secondary-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="confirm">Sign and submit</button></div>`);
  }catch(error){notify(error.message,{tone:'error'});}
  finally{setBusy(button,false);}
}
function creditPreview(){const amount=Number(ui.creditAmount),max=creditMaximum();let collateral=state.credit.collateral,debt=state.credit.debt;const a=ui.creditAction;if(a==='borrow')debt+=amount;if(a==='repay')debt-=amount;if(a==='add')collateral+=amount;if(a==='remove')collateral-=amount;const value=collateral*asset('RLVN').price;return{amount,collateral,debt,value,ltv:value?debt/value:0,error:!Number.isFinite(amount)||amount<=0?'Enter an amount.':amount>max+1e-7?'Amount exceeds the available balance or credit limit.':''};}
function updateCredit(){if(!$('#credit-amount'))return;const q=creditPreview();$('#projected-ltv').textContent=(q.ltv*100).toFixed(1)+'%';$('#projected-debt').textContent=money(Math.max(0,q.debt));$('#projected-collateral').textContent=money(Math.max(0,q.value));$('#credit-error').textContent=q.amount>0?q.error:'';$('#credit-submit').disabled=!!q.error||!backendSession();$('#credit-submit').textContent=!backendSession()?'Connect wallet':q.error?'Enter a valid amount':'Review '+ui.creditAction;}
function reviewCredit(){const q=creditPreview();if(q.error)return;const a=ui.creditAction,unit=['borrow','repay'].includes(a)?'USDC':'RLVN';pending={kind:'credit',action:a,amount:q.amount};openModal(`${modalHead('Review '+a)}<div class="review-amount"><span><small>${a}</small><strong>${number(q.amount)} ${unit}</strong></span>${tokenIcon(unit)}</div><div class="detail-rows">${detail('Projected LTV',(q.ltv*100).toFixed(1)+'%')}${detail('Projected debt',money(Math.max(0,q.debt)))}</div><div class="modal-actions"><button class="secondary-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="confirm">Sign and submit</button></div>`);}
let serverBusy=false;
async function executePending(){
  const p=pending;if(!p||serverBusy)return;
  if(!backendSession()){notify('Connect a wallet first.',{tone:'error'});return;}
  serverBusy=true;const confirm=$('[data-action=confirm]');if(confirm)setBusy(confirm,true,'Waiting for signature…');
  try{
    if(p.quoteId) await submitIntent({quoteId:p.quoteId}, next=>{state={...state,...next};});
    else if(p.kind==='supply'||p.kind==='withdraw'){
      const quote=await quoteAction(p.kind,{asset:p.asset,amountIn:String(p.amount)});
      await submitIntent({quoteId:quote.quoteId}, next=>{state={...state,...next};});
    } else if(p.kind==='credit'){
      const quote=await quoteAction('credit',{action:p.action,amountIn:String(p.amount)});
      await submitIntent({quoteId:quote.quoteId}, next=>{state={...state,...next};});
    } else if(p.kind==='faucet'){
      await claimFaucet(p.asset,p.amount, next=>{state={...state,...next};});
    }
    ui.amount='';ui.creditAmount='';
    closeModal();await refreshMarket();render();notify('Instruction settled.',{tone:'success'});
  }catch(error){notify(error.message,{tone:'error'});}
  finally{serverBusy=false;if(confirm)setBusy(confirm,false);}
}
async function refreshMarket(){
  try{
    const [markets,pool,trades,candles]=await Promise.all([fetchMarkets(),fetchPool(),fetchTrades(),loadChartHistory()]);
    livePool=pool;liveTrades=trades.items||[];
    applyMarket(state,markets.items?.[0],pool);
  }catch{}
}
function openChartSettings(tab='symbol'){openModal(`${modalHead('Chart appearance')}${chartSettingsContent(ui,tab)}`);$('#workspace-modal').classList.add('chart-settings-dialog');modalState={kind:'chart-settings',tab};}
function openSettings(){openModal(`${modalHead('Workspace settings')}<p class="modal-intro">Slippage sets the minimum received on market swaps.</p><div class="setting-pills">${[.1,.5,1].map(n=>`<button data-action="slippage" data-value="${n}" class="${state.slippage===n?'active':''}">${n}%</button>`).join('')}</div><div class="detail-rows">${detail('Market','RLVN / USDC')}${detail('Execution','Wallet-signed instructions')}${detail('Fee','10 bps to suppliers')}</div>`);}
function openAccount(){
  const t=accountTotals(state),w=backendSession();
  if(!w){connectWallet().catch(()=>{});return;}
  openModal(`${modalHead('Account')}<p class="account-address" title="${escape(w)}">${escape(w)}</p><p class="stat-label" style="margin-top:16px">Net account value</p><div class="account-modal-value">${money(t.net)}</div><div class="detail-rows">${detail('Wallet USDC',number(state.wallet.USDC||0,2)+' USDC')}${detail('Wallet RLVN',number(state.wallet.RLVN||0)+' RLVN')}${detail('Supplied',money(t.supplied))}${detail('Debt',money(t.debt))}</div><div class="account-tools"><button type="button" class="secondary-button" data-action="faucet" data-asset="USDC">Claim 10,000 USDC</button><button type="button" class="secondary-button" data-action="faucet" data-asset="RLVN">Claim 100 RLVN</button></div><div class="modal-actions"><button type="button" class="secondary-button" data-action="chain-wallet">On-chain wallet</button><button type="button" class="secondary-button sign-out-button" data-action="sign-out">Sign out</button></div>`);
}
function openHelp(){openModal(`${modalHead('Using Rillvane')}<div class="help-list"><div><h3>Connect a wallet</h3><p>Phantom or Solflare. Sign in, then sign each instruction.</p></div><div><h3>Faucet, then act</h3><p>Claim test inventory, supply, swap, post collateral, borrow, repay, and withdraw.</p></div><div><h3>Risk</h3><p>50% LTV, 60% liquidation, 10% cash floor, 8% APR.</p></div></div><div class="modal-actions"><button class="primary-button full-button" data-action="close-modal">Close</button></div>`);}
function exportActivity(){const rows=[['ID','Action','Asset','Amount','Time UTC','Description','Signature'],...state.activity.map(a=>[a.id,a.type,a.asset,a.amount,a.time,a.detail,a.signature||''])];const csv=rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download='rillvane-activity.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Activity exported');}
function closeNav(){document.body.classList.remove('nav-open');$('.mobile-menu').setAttribute('aria-expanded','false');$('.sidebar').inert=innerWidth<768;}
let terminalChartObserver,chartFrame;
let historySequence=0,historyTimer;
async function loadChartHistory(){
  const sequence=++historySequence,interval=ui.interval,w=chartWindow(ui),end=ui.chartEnd;
  try{
    const result=await fetchCandles(interval,{end:w.end,count:w.count});
    if(sequence!==historySequence||ui.interval!==interval||ui.chartEnd!==end||ui.candleCount!==w.count)return;
    liveCandles=result.items||[];liveCandleInterval=interval;ui.earliest=result.earliest??null;ui.historyError=false;
    return result;
  }catch(error){if(sequence===historySequence)ui.historyError=true;}
  finally{if(sequence===historySequence){ui.historyLoading=false;refreshTerminalChart(true);}}
}
function changeChartView(){
  historySequence++;clearTimeout(historyTimer);ui.historyLoading=true;ui.historyError=false;
  refreshTerminalChart(true);historyTimer=setTimeout(loadChartHistory,140);
}
function chartSeries(){return liveCandleInterval===ui.interval?liveCandles:[];}
function chartOptions(el){
  const readout=el.querySelector('.ohlc-readout'),foot=el.querySelector('.chart-foot'),nav=el.querySelector('.chart-navigation');
  const width=Math.max(260,el.clientWidth-24),height=Math.max(190,el.clientHeight-((readout?.offsetHeight||32)+(foot?.offsetHeight||28)+(nav?.offsetHeight||38)));
  return {...ui,chartWidth:width,chartHeight:height,now:Date.now(),candles:chartSeries(),trades:liveTrades};
}
function refreshTerminalChart(force=false){
  const el=$('#primary-chart');if(page!=='trade'||!el)return;
  const options=chartOptions(el),a=currentMarket();
  if(!force&&paintLiveChart(el,a,options))return;
  const key=[a.symbol,ui.interval,ui.chartStyle].join(':');
  el.innerHTML=candleChart(a,options);
  if(force)animateChart(key);
}
function patchPoolPanel(){
  const book=$('#terminal-book');if(!book||ui.bookView!=='book')return;
  const a=currentMarket(),base=Number(livePool?.baseCash||a.liquidity||0),quote=Number(livePool?.quoteCash||0);
  book.querySelectorAll('.detail-row').forEach(row=>{
    const key=row.querySelector('span')?.textContent,strong=row.querySelector('strong');if(!strong)return;
    if(key==='Oracle price')strong.textContent=money(a.price);
    else if(key==='RLVN inventory')strong.textContent=number(base)+' RLVN';
    else if(key==='USDC cash')strong.textContent=money(quote);
  });
  const sums=book.querySelectorAll('.depth-summary b');
  if(sums[0])sums[0].textContent=compact(base*a.price);
  if(sums[1])sums[1].textContent=compact(quote);
}
function patchTapePanel(){
  const tape=$('#terminal-book .market-tape');if(!tape||ui.bookView!=='tape')return;
  tape.innerHTML=liveTrades.length?liveTrades.map(t=>`<div class="tape-row"><span class="${t.side==='buy'?'positive':'negative'}">${Number(t.price).toFixed(2)}</span><span>${t.baseAmount}</span><time>${new Date(t.time).toISOString().slice(11,19)}</time></div>`).join(''):'<div class="desk-empty"><strong>No trades yet</strong><p>Executed swaps appear here.</p></div>';
}
function fillBookView(view){
  const book=$('#terminal-book');if(!book)return;
  const a=currentMarket();
  const body=book.querySelector('.book-body');
  if(body) body.innerHTML=orderBookBody(a,view,livePool,liveTrades);
  else book.innerHTML=orderBook(a,view,0.01,livePool,liveTrades);
  markTabs('book-view',view);
}
function formatTradeAmount(value,symbol){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return '';
  const decimals=symbol==='USDC'?2:4;
  const factor=10**decimals;
  const clipped=Math.floor(n*factor+1e-8)/factor;
  if(clipped<=0)return '';
  if(symbol==='USDC')return clipped.toFixed(2);
  return clipped.toFixed(decimals).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
}
function markTradePercent(value){
  ui.tradePercent=value==null||value===''?null:String(value);
  document.querySelectorAll('.order-percent [data-action="trade-percent"]').forEach(button=>{
    const on=ui.tradePercent!=null&&button.dataset.value===ui.tradePercent;
    button.classList.toggle('active',on);
    button.setAttribute('aria-pressed',String(on));
  });
}
function applyTradePercent(pct){
  const wallet=Number(state.wallet[ui.pay]||0);
  ui.amount=formatTradeAmount(wallet*Number(pct)/100, ui.pay);
  const input=$('#trade-amount');
  if(input)input.value=ui.amount;
  markTradePercent(pct);
  updateQuote();
}
function applyTradeSide(side){
  ui.side=side;
  ui.pay=side==='sell'?'RLVN':'USDC';
  ui.receive=side==='sell'?'USDC':'RLVN';
  ui.amount='';
  ui.tradePercent=null;
  lastQuote=null;
  const ticket=$('.terminal-ticket');
  if(!ticket){render();return;}
  const wrap=document.createElement('div');
  wrap.innerHTML=terminalTicket(currentMarket());
  const next=wrap.querySelector('.ticket-body');
  const prev=ticket.querySelector('.ticket-body');
  if(next&&prev)prev.replaceWith(next);
  markTabs('trade-side',side);
  updateQuote();
}
function patchLiveTerminal(){
  const a=currentMarket(),change=Number(a.change||0),t=accountTotals(state);
  setLive('mark-price',a.price.toFixed(2));
  setLive('strip-price',a.price.toFixed(2));
  setLive('strip-change',`${change>=0?'+':''}${change.toFixed(2)}%`,change>=0?'positive':'negative');
  setLive('inventory',compact(a.liquidity));
  setLive('oracle',money(a.price));
  setLive('table-oracle',money(a.price));
  setLive('table-inventory',compact(a.liquidity));
  setLive('quote-cash',compact(Number(livePool?.quoteCash||0)));
  setLive('net',money(t.net));
  setLive('overview-available',money(state.wallet.USDC));
  setLive('overview-supplied',money(t.supplied));
  setLive('overview-debt',money(t.debt));
  if(page==='overview'){
    const chartEl=document.querySelector('#overview-market-chart');
    if(chartEl)chartEl.innerHTML=chart(asset('RLVN').price,'market');
  }
  syncSessionHeader();
  patchPoolPanel();
  patchTapePanel();
  refreshTerminalChart();
  const stamp=JSON.stringify([page,a.price,a.supply,a.borrow,a.liquidity,livePool]);
  if(page!=='trade'&&page!=='overview'&&stamp!==readViewStamp&&!$('#workspace-modal').open&&!document.body.classList.contains('nav-open')&&!document.activeElement?.matches('input,select,textarea')){
    readViewStamp=stamp;render();
  }
}
let liveRaf=0;
function scheduleLivePatch(){
  if(liveRaf)return;
  liveRaf=requestAnimationFrame(()=>{liveRaf=0;patchLiveTerminal();});
}
function applyStream(msg){
  if(msg.type==='snapshot'){
    livePool=msg.pool||livePool;
    if(msg.trades) liveTrades=msg.trades;
    if(msg.candles?.items?.length && ui.chartEnd==null && msg.candles.interval===ui.interval){
      liveCandles=msg.candles.items; liveCandleInterval=msg.candles.interval;
    }
    applyMarket(state,msg.market,msg.pool);
    scheduleLivePatch();
    return;
  }
  if(msg.type!=='delta') return;
  if(msg.topic==='market') applyMarket(state,msg.payload,livePool);
  else if(msg.topic==='pool'){ livePool=msg.payload; applyMarket(state,null,msg.payload); }
  else if(msg.topic==='token') applyMarket(state,{price:msg.payload.price,change:msg.payload.change,baseCash:msg.payload.baseCash,quoteCash:msg.payload.quoteCash,supplyApy:msg.payload.supplyApy,borrowApr:msg.payload.borrowApr},livePool);
  else if(msg.topic==='trades' && msg.payload){
    liveTrades=[msg.payload,...liveTrades.filter(row=>row.id!==msg.payload.id)].slice(0,80);
  }else if(msg.topic==='candles' && msg.payload?.items?.length && ui.chartEnd==null && msg.payload.interval===ui.interval){
    liveCandles=msg.payload.items; liveCandleInterval=msg.payload.interval;
  }else return;
  scheduleLivePatch();
}
function observeTerminalChart(){
  terminalChartObserver?.disconnect();cancelAnimationFrame(chartFrame);
  const chartEl=$('.terminal-chart');if(!chartEl)return;
  let previous='';
  const sizeKey=el=>{const r=el.getBoundingClientRect();return Math.round(r.width/4)*4+'x'+Math.round(r.height/4)*4;};
  previous=sizeKey(chartEl);
  chartFrame=requestAnimationFrame(()=>refreshTerminalChart(true));
  terminalChartObserver=new ResizeObserver(entries=>{
    const r=entries[0].contentRect,key=Math.round(r.width/4)*4+'x'+Math.round(r.height/4)*4;
    if(key===previous)return;
    previous=key;cancelAnimationFrame(chartFrame);
    chartFrame=requestAnimationFrame(()=>refreshTerminalChart(true));
  });
  terminalChartObserver.observe(chartEl);
}
function render(){
  const motionSnapshot=captureMotion();const active=document.activeElement;const focusKey=active?.dataset?.action?{action:active.dataset.action,value:active.dataset.value}:null;
  clearTimeout(quoteTimer);quoteSequence++;lastQuote=null;
  const raw=location.hash.slice(1)||'overview',parts=raw.split('/'),next=labels[parts[0]]?parts[0]:'overview',changed=routeKey!==raw;page=next;
  if(changed&&page==='trade'&&parts[1]==='RLVN'){ui.pay=ui.side==='sell'?'RLVN':'USDC';ui.receive=ui.side==='sell'?'USDC':'RLVN';}
  routeKey=raw;document.body.dataset.page=page;document.body.classList.toggle('chart-focus',page==='trade'&&ui.focusChart);document.title='Rillvane — '+labels[page];$('#breadcrumb').textContent=labels[page];
  document.querySelectorAll('[data-route]').forEach(el=>{el.title=labels[el.dataset.route]||'';if(el.dataset.route===page)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  $('#main-content').innerHTML=({overview,markets,trade,earn,borrow,portfolio,activity,risk}[page])();hydrate($('#main-content'));
  if(page==='trade'){updateQuote();observeTerminalChart();}else terminalChartObserver?.disconnect();
  if(page==='borrow')updateCredit();closeNav();if(changed)window.scrollTo({top:0,behavior:'instant'});
  const firstPaint=!document.documentElement.classList.contains('app-hydrated');
  document.documentElement.dataset.ready='true';finishRender({changed:changed&&!firstPaint,snapshot:motionSnapshot});
  syncSessionHeader();
}
document.addEventListener('input',e=>{
  const id=e.target.id;
  if(e.target.dataset.chartPref){const key=e.target.dataset.chartPref,value=e.target.type==='checkbox'?e.target.checked:e.target.value;Object.assign(ui,saveChartPreferences({...ui,[key]:value}));refreshTerminalChart();return;}
  if(id==='trade-amount'){ui.amount=e.target.value;if(ui.tradePercent!=null)markTradePercent(null);updateQuote();}
  else if(id==='market-search'){ui.search=e.target.value;$('#market-results').innerHTML=marketTable(filteredMarkets());}
  else if(id==='credit-amount'){ui.creditAmount=e.target.value;updateCredit();}
  else if(id==='vault-amount')updateVault();
  else if(id==='shock-range'){ui.shock=Number(e.target.value);$('#shock-value').textContent=(ui.shock>0?'+':'')+ui.shock+'%';$('#scenario-results').innerHTML=scenarioResults();}
});
document.addEventListener('click',e=>{
  if(e.target.closest('a.skip-link')){e.preventDefault();$('#main-content').focus();return;}
  const b=e.target.closest('[data-action]');if(!b){if(e.target.closest('a[href^="#"]')){closeModal();closeNav();}return;}
  const action=b.dataset.action,v=b.dataset.value;if(b.disabled)return;
  if(action==='chart-settings'){openChartSettings();return;}if(action==='chart-settings-tab'){openChartSettings(v);return;}
  if(action==='chart-reset'){Object.assign(ui,saveChartPreferences(CHART_DEFAULTS));refreshTerminalChart();openChartSettings(modalState?.tab||'symbol');return;}
  if(action==='toggle-depth'){ui.showBook=!ui.showBook;render();return;}if(action==='chart-focus'){ui.focusChart=!ui.focusChart;render();return;}
  if(action==='nav-density'){setNavExpanded(!document.documentElement.classList.contains('nav-expanded'));return;}
  if(action==='close-modal'){closeModal();return;}if(action==='confirm'){executePending();return;}
  if(action==='toggle-nav'){const open=document.body.classList.toggle('nav-open');$('.mobile-menu').setAttribute('aria-expanded',String(open));$('.sidebar').inert=!open&&innerWidth<768;return;}
  if(action==='close-nav'){closeNav();return;}if(action==='settings'){openSettings();return;}
  if(action==='account'){if(backendSession())openAccount();else connectWallet().catch(()=>{});return;}
  if(action==='sign-out'){signOut().catch(err=>notify(err.message,{tone:'error'}));return;}
  if(action==='chain-wallet'){openChainWallet().catch(err=>notify(err.message,{tone:'error'}));return;}
  if(action==='help'){openHelp();return;}
  if(action==='market-filter'){ui.marketFilter=v;render();return;}if(action==='watch'){const s=b.dataset.asset;state.watchlist=state.watchlist.includes(s)?state.watchlist.filter(x=>x!==s):[...state.watchlist,s];render();return;}
  if(action==='asset'){openAsset(b.dataset.asset);return;}
  if(action==='market-selector'){openModal(`${modalHead('Select market')}<div class="asset-picker-list">${ASSETS.filter(a=>a.symbol!=='USDC').map(a=>`<a class="asset-picker-row" href="#trade/${a.symbol}">${assetCell(a.symbol)}<span>${money(a.price)}</span></a>`).join('')}</div>`);return;}
  if(action==='trade-side'){if(ui.side!==v)applyTradeSide(v);else markTabs('trade-side',v);return;}
  if(action==='trade-percent'){applyTradePercent(v);return;}
  if(action==='chart-interval'){
    if(ui.interval!==v){
      ui.interval=v;liveCandles=[];liveCandleInterval=v;
      setStreamView({interval:v});
      markTabs('chart-interval',v);
      changeChartView();
    }else markTabs('chart-interval',v);
    return;
  }
  if(action==='chart-pan'){Object.assign(ui,panChart(ui,Number(v)*Math.max(1,Math.round(ui.candleCount/2)),Date.now(),ui.earliest));changeChartView();return;}
  if(action==='chart-zoom'){Object.assign(ui,zoomChart(ui,Number(v),ui.chartEnd==null?1:.5));changeChartView();return;}
  if(action==='chart-latest'){ui.chartEnd=null;changeChartView();return;}
  if(action==='chart-style'){ui.chartStyle=v;markTabs('chart-style',v);refreshTerminalChart(true);return;}
  if(action==='chart-volume'){ui.volume=!ui.volume;b.classList.toggle('active',ui.volume);refreshTerminalChart(true);return;}
  if(action==='book-view'){if(ui.bookView!==v){ui.bookView=v;fillBookView(v);}else markTabs('book-view',v);return;}
  if(action==='review-trade'){reviewTrade();return;}
  if(action==='trade-extra'){ui.extra=v;markTabs('trade-extra',v);const blotter=$('.blotter-content');if(blotter)blotter.innerHTML=terminalBlotter();return;}
  if(action==='vault-filter'){ui.vaultFilter=v;render();return;}if(action==='vault'){openVault(b.dataset.vault);return;}if(action==='vault-tab'){openVault(modalState.id,v);return;}
  if(action==='vault-max'){const q=vaultAmount();$('#vault-amount').value=q.max;updateVault();return;}if(action==='review-vault'){reviewVault();return;}
  if(action==='credit-tab'){ui.creditAction=v;ui.creditAmount='';render();return;}
  if(action==='credit-max'){ui.creditAmount=String(Math.max(0,creditMaximum()));$('#credit-amount').value=ui.creditAmount;updateCredit();return;}
  if(action==='review-credit'){reviewCredit();return;}
  if(action==='portfolio-tab'){ui.portfolioTab=v;render();return;}if(action==='activity-filter'){ui.activityFilter=v;render();return;}
  if(action==='reset-shock'){ui.shock=-20;$('#shock-range').value=ui.shock;$('#shock-value').textContent='−20%';$('#scenario-results').innerHTML=scenarioResults();return;}
  if(action==='slippage'){state.slippage=Number(v);render();openSettings();return;}
  if(action==='export'){exportActivity();return;}
  if(action==='faucet'){pending={kind:'faucet',asset:b.dataset.asset,amount:b.dataset.asset==='RLVN'?'100':'10000'};executePending();return;}
});
window.addEventListener('hashchange',()=>{closeModal();render();});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){closeNav();if(ui.focusChart&&!$('#workspace-modal').open){ui.focusChart=false;render();}}if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();if(page!=='markets')location.hash='markets';requestAnimationFrame(()=>$('#market-search')?.focus());}if(e.key==='Enter'){if(e.target.id==='trade-amount')reviewTrade();if(e.target.id==='credit-amount')reviewCredit();if(e.target.id==='vault-amount')reviewVault();}});
$('#workspace-modal').addEventListener('close',()=>{document.body.classList.remove('modal-open');pending=null;modalState=null;$('#workspace-modal').classList.remove('chart-settings-dialog');});
window.addEventListener('resize',()=>{$('.sidebar').inert=innerWidth<768&&!document.body.classList.contains('nav-open');if(page==='trade')refreshTerminalChart();});
document.addEventListener('pointermove',e=>{if(!chartGesture)chartHover(e);});document.addEventListener('pointerout',e=>{const svg=e.target.closest?.('.terminal-chart-svg');if(svg&&!svg.contains(e.relatedTarget))svg.querySelector('.chart-crosshair')?.setAttribute('visibility','hidden');});
let chartGesture=null,gestureFrame;
function scheduleChartGesture(){
  if(gestureFrame)return;
  gestureFrame=requestAnimationFrame(()=>{gestureFrame=null;changeChartView();});
}
document.addEventListener('pointerdown',e=>{
  const svg=e.target.closest?.('.terminal-chart-svg');if(!svg||e.button!==0)return;
  const rect=svg.getBoundingClientRect();
  chartGesture={id:e.pointerId,x:e.clientX,view:{...ui},width:rect.width*(Number(svg.dataset.right)-Number(svg.dataset.left))/Number(svg.dataset.width)};
  svg.closest('.terminal-chart-content').setPointerCapture(e.pointerId);svg.focus({preventScroll:true});
});
document.addEventListener('pointermove',e=>{
  if(!chartGesture||e.pointerId!==chartGesture.id)return;
  const bars=(chartGesture.x-e.clientX)/Math.max(1,chartGesture.width)*chartGesture.view.candleCount;
  Object.assign(ui,panChart(chartGesture.view,bars,Date.now(),ui.earliest));scheduleChartGesture();
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>{
  if(chartGesture?.id===e.pointerId){chartGesture=null;changeChartView();}
});
document.addEventListener('wheel',e=>{
  const svg=e.target.closest?.('.terminal-chart-svg');if(!svg)return;e.preventDefault();
  const rect=svg.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*Number(svg.dataset.width);
  if(Math.abs(e.deltaX)>Math.abs(e.deltaY)||e.shiftKey){Object.assign(ui,panChart(ui,(e.deltaX||e.deltaY)/rect.width*ui.candleCount,Date.now(),ui.earliest));}
  else{const anchor=Math.max(0,Math.min(1,(x-Number(svg.dataset.left))/(Number(svg.dataset.right)-Number(svg.dataset.left))));if(e.deltaY!==0)Object.assign(ui,zoomChart(ui,Math.exp(Math.sign(e.deltaY)*Math.max(.085,Math.min(.3,Math.abs(e.deltaY)*.002))),anchor));}
  scheduleChartGesture();
},{passive:false});
document.addEventListener('dblclick',e=>{if(e.target.closest?.('.terminal-chart-svg')){ui.chartEnd=null;ui.candleCount=64;changeChartView();}});
document.addEventListener('keydown',e=>{
  if(!e.target.matches?.('.terminal-chart-svg'))return;
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();Object.assign(ui,panChart(ui,(e.key==='ArrowLeft'?-1:1)*Math.max(1,Math.round(ui.candleCount/4)),Date.now(),ui.earliest));}
  else if(['+','=','-'].includes(e.key)){e.preventDefault();Object.assign(ui,zoomChart(ui,e.key==='-'?1.25:.8,ui.chartEnd==null?1:.5));}
  else if(e.key==='End'){e.preventDefault();ui.chartEnd=null;}
  else return;
  changeChartView();requestAnimationFrame(()=>document.querySelector('.terminal-chart-svg')?.focus({preventScroll:true}));
});
initializeMotion();hydrate();setNavExpanded(readNavExpanded());render();armNavMotion();
initializeBackend({
  onAccount:next=>{
    const incoming={...clone(INITIAL_STATE),...next,watchlist:next?.watchlist||['RLVN'],slippage:state.slippage};
    const redraw=accountShell(state)!==accountShell(incoming);
    state=incoming;
    syncSessionHeader();
    if(redraw){render();refreshMarket();}
    else scheduleLivePatch();
  },
  notify,
  interval:ui.interval,
  onStream:applyStream,
  onMarket:(market,pool,trades,candles,interval)=>{livePool=pool;if(trades)liveTrades=trades;if(candles?.length&&ui.chartEnd==null&&ui.interval===(interval||'1h')&&!streamConnected()){liveCandles=candles;liveCandleInterval=interval||'1h';}applyMarket(state,market,pool);patchLiveTerminal();}
}).finally(appLoading.finish);
window.addEventListener('rillvane:wallet-panel',e=>{openModal(`${modalHead('Wallet')}<div class="detail-rows">${detail('Address',escape(e.detail.wallet))}${detail('SOL',escape(e.detail.sol))}</div><div class="service-panel"><label for="chain-signature">Track a signature</label><input id="chain-signature" autocomplete="off" placeholder="Transaction signature"><button class="secondary-button full-button" id="track-chain-transaction" style="margin-top:12px">Track transaction</button><div id="chain-status" class="modal-note" role="status"></div><div id="chain-transactions" class="chain-list"></div></div>`);e.detail.mount($('#modal-content'));});
document.addEventListener('rillvane:session',syncSessionHeader);
document.addEventListener('rillvane:chain-update',()=>{refreshMarket();});
setInterval(()=>{
  if(page!=='trade'||document.hidden||streamConnected())return;
  refreshMarket().then(()=>{
    if(page!=='trade')return;
    patchLiveTerminal();
  });
},8000);
