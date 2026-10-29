import {ASSETS,asset,money,number,compact,tokenIcon,tokenMark} from './workspace-data.js';
import {sanitizeChartPreferences} from './chart-preferences.js';
import {chartWindow} from './chart-navigation.js';

const INTERVAL_MS={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
const INTERVAL_MIN={'5m':5,'15m':15,'1h':60,'4h':240,'1d':1440};
const intervalMs=interval=>INTERVAL_MS[interval]||3600000;
const finite=v=>Number.isFinite(Number(v));
const isCandle=row=>row&&finite(row.open)&&finite(row.close);
const stamp=row=>{const t=typeof row.time==='number'?row.time:Date.parse(row.time||row.created);return Number.isFinite(t)?t:NaN;};

export function candlesFromTrades(trades=[], interval='1h'){
  if(!trades.length)return [];
  const ms=intervalMs(interval),buckets=new Map();
  for(const row of [...trades].sort((a,b)=>stamp(a)-stamp(b)||Number(a.id||0)-Number(b.id||0))){
    if(isCandle(row)){
      const t=Math.floor(stamp(row)/ms)*ms;
      if(!Number.isFinite(t))continue;
      const open=Number(row.open),high=Number(row.high??open),low=Number(row.low??open),close=Number(row.close);
      if(![open,high,low,close].every(Number.isFinite))continue;
      buckets.set(t,{time:t,open,high:Math.max(high,open,close),low:Math.min(low,open,close),close,volume:Number(row.volume||0)});
      continue;
    }
    const created=stamp(row),price=Number(row.price??row.close);
    if(!Number.isFinite(created)||!Number.isFinite(price))continue;
    const t=Math.floor(created/ms)*ms,volume=Number(row.baseAmount||row.volume||0);
    const bucket=buckets.get(t)||{time:t,open:price,high:price,low:price,close:price,volume:0};
    bucket.high=Math.max(bucket.high,price);
    bucket.low=Math.min(bucket.low,price);
    bucket.close=price;
    bucket.volume+=Number.isFinite(volume)?volume:0;
    buckets.set(t,bucket);
  }
  return [...buckets.values()].sort((a,b)=>a.time-b.time);
}

export function padCandleWindow(candles=[], interval='1h', count=64, now=Date.now(), seedPrice){
  const ms=intervalMs(interval),end=Math.floor(now/ms)*ms,start=end-(count-1)*ms;
  const byTime=new Map(candles.map(c=>[c.time,c]));
  const out=[];
  let prev=null;
  for(let t=start;t<=end;t+=ms){
    const hit=byTime.get(t);
    if(hit&&finite(hit.close)){
      prev=Number(hit.close);
      out.push({...hit,empty:false});
    }else if(prev!=null){
      out.push({time:t,open:prev,high:prev,low:prev,close:prev,volume:0,empty:false});
    }else{
      out.push({time:t,open:null,high:null,low:null,close:null,volume:0,empty:true});
    }
  }
  const seed=finite(seedPrice)?Number(seedPrice):null;
  if(seed!=null&&!out.some(c=>!c.empty)){
    return out.map(c=>({time:c.time,open:seed,high:seed,low:seed,close:seed,volume:0,empty:false}));
  }
  return out;
}

function filledCandles(data){
  return data.filter(c=>!c.empty&&finite(c.open)&&finite(c.close)&&finite(c.high)&&finite(c.low));
}

export function buildCandles(a, interval='1h', count=64, trades, now=Date.now()){
  const raw=Array.isArray(trades)?candlesFromTrades(trades, interval):[];
  const seed=finite(a?.price)?Number(a.price):undefined;
  if(!raw.length)return seed!=null?padCandleWindow([], interval, count, now, seed):[];
  return padCandleWindow(raw, interval, count, now);
}

function pickSeries(interval, count, now, candles, trades, seedPrice){
  const seed=finite(seedPrice)?Number(seedPrice):undefined;
  const fromCandles=candles?.length?buildCandles({price:seed},interval,count,candles,now):[];
  const fromTrades=trades?.length?buildCandles({price:seed},interval,count,trades,now):[];
  const fillC=filledCandles(fromCandles),fillT=filledCandles(fromTrades);
  if(fillC.length>=fillT.length&&fillC.length)return fromCandles;
  if(fillT.length)return fromTrades;
  if(seed!=null)return padCandleWindow([], interval, count, now, seed);
  return fromCandles;
}

function axisTime(ts, interval, latest){
  if(latest)return 'Latest';
  const d=new Date(ts);
  const hh=String(d.getUTCHours()).padStart(2,'0'),mm=String(d.getUTCMinutes()).padStart(2,'0');
  if(interval==='1d')return `${d.getUTCMonth()+1}/${d.getUTCDate()}`;
  if(interval==='4h'||interval==='1h')return hh+':00';
  return hh+':'+mm;
}

function tickStepMs(interval){
  if(interval==='5m'||interval==='15m')return 3_600_000;
  if(interval==='1h')return 14_400_000;
  if(interval==='4h')return 86_400_000;
  return 7*86_400_000;
}

function timeTickIndexes(data, interval, width=900){
  const n=data.length;
  if(n<2)return n?[0]:[];
  const step=tickStepMs(interval)*Math.max(1,Math.ceil((data.at(-1).time-data[0].time)/tickStepMs(interval)/Math.max(2,Math.floor(width/70))));
  const hits=[];
  for(let i=0;i<n-1;i++){
    if(data[i].time%step===0 && (n-1-i)>=3) hits.push(i);
  }
  if(!hits.length || hits[0]>4) hits.unshift(0);
  hits.push(n-1);
  return [...new Set(hits)];
}

export function candleChart(a, options={}){
  const {interval='1h',chartStyle='candles',volume=true,candleCount=64,chartWidth,chartHeight,now}=options,p=sanitizeChartPreferences(options);
  const window=chartWindow(options,now),count=window.count;
  const v=typeof innerWidth==='number'?innerWidth:1440,w=Math.max(260,Math.round(chartWidth||(v<768?v-40:v-680))),h=Math.max(190,Math.round(chartHeight||(v<768?260:430)));
  const left=10,right=w-64,top=18,bottom=volume?h-92:h-36,volumeBottom=h-28,volumeHeight=44;
  let data=pickSeries(interval,count,window.end,options.candles,options.trades,a.price);
  let filled=filledCandles(data);
  if(!filled.length){
    data=padCandleWindow([],interval,count,window.end,finite(a.price)?Number(a.price):100);
    filled=filledCandles(data);
  }
  if(!filled.length){
    return `<div class="ohlc-readout" id="ohlc-readout"><b>${a.symbol} · ${interval}</b><span>Waiting for oracle price</span></div><svg class="terminal-chart-svg" tabindex="0" style="background:${p.chartBackground}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Empty chart. Drag to move through history." data-right="${right}" data-left="${left}" data-width="${w}" data-height="${h}" data-count="${count}"><text x="${w/2}" y="${h/2}" text-anchor="middle" fill="${p.axisColor}" font-size="12">Waiting for oracle price</text></svg>${chartFooter(window,options,0,chartStyle,p)}`;
  }
  const last=filled.at(-1),mark=last.close;
  let min=Math.min(...filled.map(c=>c.low)),max=Math.max(...filled.map(c=>c.high));
  if(Number.isFinite(mark)&&max-min>mark*0.14&&filled.length>=12){
    const lows=[...filled.map(c=>c.low)].sort((a,b)=>a-b);
    const highs=[...filled.map(c=>c.high)].sort((a,b)=>a-b);
    const drop=Math.max(1,Math.round(filled.length*0.04));
    min=lows[Math.min(drop,lows.length-1)];
    max=highs[Math.max(0,highs.length-1-drop)];
  }
  min=Math.min(min,last.open,last.close,mark);
  max=Math.max(max,last.open,last.close,mark);
  if(!Number.isFinite(min)||!Number.isFinite(max)||!(max>min)){min=mark*0.995;max=mark*1.005;}
  else{const pad=(max-min)*0.08||mark*0.002;min-=pad;max+=pad;}
  const minSpan=Math.max(Math.abs(mark)*0.01,0.5);
  if(max-min<minSpan){
    const extra=(minSpan-(max-min))/2;
    min-=extra;max+=extra;
  }
  const yRaw=value=>top+(max-value)/(max-min)*(bottom-top),y=value=>Math.max(top,Math.min(bottom,yRaw(value))),step=(right-left)/data.length,bar=Math.max(.3,Math.min(12,step*.7));
  const id='terminal-price-fill',maxVol=Math.max(1e-9,...data.map(c=>c.volume||0));
  const lastColor=last.close>=last.open?p.upColor:p.downColor;
  const closes=data.map((c,i)=>Number.isFinite(c.close)?[left+step*(i+.5),y(c.close)]:null).filter(Boolean);
  const path=closes.map((pt,i)=>`${i?'L':'M'}${pt[0]},${pt[1]}`).join(' ');
  const candles=data.map((c,i)=>{
    const x=left+step*(i+.5);
    if(c.empty||!Number.isFinite(c.open))return `<g data-candle="${i}" data-empty="1"></g>`;
    const reference=p.colorPrevious&&i&&Number.isFinite(data[i-1].close)?data[i-1].close:c.open;
    const color=c.close>=reference?p.upColor:p.downColor;
    const volH=c.volume>0?Math.max(2,Math.sqrt(c.volume/maxVol)*volumeHeight):0;
    const bodyTop=Math.min(y(c.open),y(c.close)),bodyH=Math.max(1,Math.abs(y(c.open)-y(c.close)));
    return `<g data-candle="${i}" data-time="${c.time}" data-o="${c.open.toFixed(2)}" data-h="${c.high.toFixed(2)}" data-l="${c.low.toFixed(2)}" data-c="${c.close.toFixed(2)}" data-v="${c.volume.toFixed(4)}">${chartStyle==='candles'?`${p.candleWicks?`<path data-part="wick" d="M${x} ${y(c.high)}V${y(c.low)}" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`:''}${p.candleBodies||p.candleBorders?`<rect data-part="body" x="${x-bar/2}" y="${bodyTop}" width="${bar}" height="${bodyH}" fill="${p.candleBodies?color:'none'}" fill-opacity="${p.hollowCandles?.55:1}" stroke="${p.candleBorders?color:'none'}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`:''}`:''}${volume&&volH?`<rect data-part="volume" x="${x-bar/2}" y="${volumeBottom-volH}" width="${bar}" height="${volH}" fill="${color}" opacity=".72"/>`:''}</g>`;
  }).join('');
  const px=t=>left+(right-left)*t;
  const timeTicks=timeTickIndexes(data,interval,right-left).map(i=>{
    const t=(i+.5)/data.length;
    const latest=i===data.length-1&&options.chartEnd==null;
    return `${p.verticalGrid?`<path class="chart-grid vertical" d="M${px(t)} ${top}V${volumeBottom}"/>`:''}<text class="chart-axis" x="${Math.min(right-28,px(t))}" y="${h-7}">${axisTime(data[i].time,interval,latest)}</text>`;
  }).join('');
  return `<div class="ohlc-readout" id="ohlc-readout"><b>${a.symbol} · ${interval}</b><span>O <strong>${last.open.toFixed(2)}</strong></span><span>H <strong>${last.high.toFixed(2)}</strong></span><span>L <strong>${last.low.toFixed(2)}</strong></span><span>C <strong>${last.close.toFixed(2)}</strong></span></div><svg class="terminal-chart-svg" tabindex="0" preserveAspectRatio="none" style="background:${p.chartBackground};--chart-grid:${p.gridColor};--chart-text:${p.axisColor}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${a.symbol} ${interval} ${chartStyle} chart" data-symbol="${a.symbol}" data-interval="${interval}" data-right="${right}" data-count="${data.length}" data-left="${left}" data-width="${w}" data-height="${h}" data-min="${min}" data-max="${max}" data-top="${top}" data-bottom="${bottom}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--accent)" stop-opacity=".16"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${[0,.25,.5,.75,1].map(t=>`${p.horizontalGrid?`<path class="chart-grid" d="M${left} ${top+(bottom-top)*t}H${right}"/>`:''}<text class="chart-axis" x="${right+8}" y="${top+(bottom-top)*t+4}">${(max-(max-min)*t).toFixed(2)}</text>`).join('')}${timeTicks}${candles}${chartStyle==='line'&&closes.length>1?`<path d="${path} L${closes.at(-1)[0]} ${bottom}L${closes[0][0]} ${bottom}Z" fill="url(#${id})"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>`:''}${chartStyle==='line'&&closes.length===1?`<circle data-part="line-point" cx="${closes[0][0]}" cy="${closes[0][1]}" r="3" fill="var(--accent)"/>`:''}${p.lastPrice?`<g class="chart-current-price"><path data-part="last-price" d="M${left} ${y(mark)}H${right}" stroke="${lastColor}" stroke-width=".7" stroke-dasharray="2 5" opacity=".8"/><rect x="${right+2}" y="${y(mark)-10}" width="${w-right-4}" height="20" rx="2" fill="${lastColor}"/><text class="chart-current-label" x="${right+7}" y="${y(mark)+4}">${mark.toFixed(2)}</text></g>`:''}<g class="chart-crosshair" visibility="hidden"><path class="crosshair-x" d="M0 0V${volumeBottom}"/><path class="crosshair-y" d="M0 0H${right}"/></g>${volume?`<text class="chart-axis" x="10" y="${volumeBottom-volumeHeight-8}">VOL</text>`:''}</svg>${chartFooter(window,options,filled.length,chartStyle,p)}`;
}

function chartFooter(window,options,filled,style,p){
  const date=t=>new Date(t).toISOString().slice(0,16).replace('T',' ');
  const earliest=options.earliest==null?null:Math.floor(options.earliest/window.ms)*window.ms;
  const atStart=earliest!=null&&window.start<=earliest;
  return `<div class="chart-foot"><span class="chart-color-key"><i class="key-up" style="background:${p.upColor}"></i>Up <i class="key-down" style="background:${p.downColor}"></i>Down &middot; ${filled} ${style==='line'?'closes':'candles'}</span><span class="chart-history-range">${date(window.start)} &mdash; ${date(window.end)} UTC</span></div><div class="chart-navigation" aria-label="Chart navigation"><div><button data-action="chart-pan" data-value="-1" aria-label="Earlier history" title="Earlier history" ${atStart?'disabled':''}>&larr;</button><button data-action="chart-zoom" data-value="1.25" aria-label="Zoom out" title="Zoom out" ${window.count>=600?'disabled':''}>&minus;</button><button data-action="chart-zoom" data-value="0.8" aria-label="Zoom in" title="Zoom in" ${window.count<=12?'disabled':''}>+</button><button data-action="chart-pan" data-value="1" aria-label="Later history" title="Later history" ${options.chartEnd==null?'disabled':''}>&rarr;</button><button data-action="chart-latest" class="${options.chartEnd==null?'active':''}" title="Return to latest trades">Latest</button></div><span role="status">${options.historyLoading?'Loading history...':options.historyError?'History unavailable. Move chart to retry.':atStart?'Start of trading history':'Drag to move &middot; Scroll to zoom'}</span></div>`;
}

export function paintLiveChart(root, a, options={}){
  const svg=root?.querySelector?.('.terminal-chart-svg');
  if(!svg)return false;
  const interval=options.interval||'1h';
  if(svg.dataset.symbol!==a.symbol||svg.dataset.interval!==interval)return false;
  const p=sanitizeChartPreferences(options);
  const window=chartWindow(options,options.now);
  const data=pickSeries(interval,window.count,window.end,options.candles,options.trades,a.price);
  const filled=filledCandles(data);
  const last=filled.at(-1);
  if(!last||!Number.isFinite(last.close))return false;
  if(Number(svg.dataset.count)!==data.length)return false;
  const groups=svg.querySelectorAll('[data-candle]');
  let g=null;
  for(const el of groups){if(Number(el.dataset.time)===last.time){g=el;break;}}
  if(!g)return false;
  const min=Number(svg.dataset.min),max=Number(svg.dataset.max),top=Number(svg.dataset.top),bottom=Number(svg.dataset.bottom);
  const left=Number(svg.dataset.left),right=Number(svg.dataset.right);
  if(!Number.isFinite(min)||!Number.isFinite(max)||!(max>min))return false;
  const span=max-min;
  if(last.high>max+span*0.2||last.low<min-span*0.2)return false;
  const yRaw=value=>top+(max-value)/(max-min)*(bottom-top);
  const y=value=>Math.max(top,Math.min(bottom,yRaw(value)));
  const mark=last.close;
  const previous=p.colorPrevious&&filled.length>1&&Number.isFinite(filled.at(-2).close)?filled.at(-2).close:last.open;
  const color=mark>=previous?p.upColor:p.downColor;
  const body=g.querySelector('[data-part="body"]');
  const wick=g.querySelector('[data-part="wick"]');
  const x=body?Number(body.getAttribute('x'))+Number(body.getAttribute('width'))/2:left+(right-left)*(data.length-0.5)/data.length;
  if(wick){wick.setAttribute('d',`M${x} ${y(last.high)}V${y(last.low)}`);wick.setAttribute('stroke',color);}
  if(body){
    const bodyTop=Math.min(y(last.open),y(last.close)),bodyH=Math.max(1,Math.abs(y(last.open)-y(last.close)));
    body.setAttribute('y',String(bodyTop));body.setAttribute('height',String(bodyH));
    if(p.candleBodies)body.setAttribute('fill',color);
    if(p.candleBorders)body.setAttribute('stroke',color);
  }
  g.dataset.o=last.open.toFixed(2);g.dataset.h=last.high.toFixed(2);g.dataset.l=last.low.toFixed(2);g.dataset.c=last.close.toFixed(2);g.dataset.v=Number(last.volume||0).toFixed(4);
  const lastLine=svg.querySelector('[data-part="last-price"]');
  if(lastLine){lastLine.setAttribute('d',`M${left} ${y(mark)}H${right}`);lastLine.setAttribute('stroke',color);}
  const badge=svg.querySelector('.chart-current-price rect');
  if(badge){badge.setAttribute('y',String(y(mark)-10));badge.setAttribute('fill',color);}
  const label=svg.querySelector('.chart-current-label');
  if(label){label.textContent=mark.toFixed(2);label.setAttribute('y',String(y(mark)+4));}
  if(svg.querySelector('.chart-crosshair')?.getAttribute('visibility')!=='visible'){
    const title=root.querySelector('#ohlc-readout b');
    if(title)title.textContent=`${a.symbol} · ${interval}`;
    const strongs=root.querySelectorAll('#ohlc-readout strong');
    if(strongs[0])strongs[0].textContent=last.open.toFixed(2);
    if(strongs[1])strongs[1].textContent=last.high.toFixed(2);
    if(strongs[2])strongs[2].textContent=last.low.toFixed(2);
    if(strongs[3])strongs[3].textContent=last.close.toFixed(2);
  }
  return true;
}
function nearestFilled(svg, i){
  const count=Number(svg.dataset.count);
  for(let d=0;d<count;d++){
    for(const j of [i-d,i+d]){
      if(j<0||j>=count)continue;
      const g=svg.querySelector(`[data-candle="${j}"]`);
      if(g&&!g.dataset.empty&&g.style.opacity!=='0')return {g,j};
    }
  }
  return null;
}

export function chartHover(e){
  const svg=e.target.closest?.('.terminal-chart-svg');if(!svg)return;
  const ctm=svg.getScreenCTM();if(!ctm)return;
  const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;
  const p=pt.matrixTransform(ctm.inverse());
  const left=Number(svg.dataset.left),right=Number(svg.dataset.right),count=Number(svg.dataset.count);
  const i=Math.max(0,Math.min(count-1,Math.floor((p.x-left)/Math.max(1,right-left)*count)));
  const hit=nearestFilled(svg,i),cross=svg.querySelector('.chart-crosshair');if(!cross)return;
  if(!hit){cross?.setAttribute('visibility','hidden');return;}
  const {g,j}=hit;
  cross.setAttribute('visibility','visible');cross.querySelector('.crosshair-x').setAttribute('transform',`translate(${left+(right-left)/count*(j+.5)},0)`);cross.querySelector('.crosshair-y').setAttribute('transform',`translate(0,${Math.max(20,Math.min(Number(svg.dataset.height)-32,p.y))})`);
  const d=g.dataset;document.querySelector('#ohlc-readout').innerHTML=`<b>${svg.dataset.symbol} · ${svg.dataset.interval}</b><span>O <strong>${d.o}</strong></span><span>H <strong>${d.h}</strong></span><span>L <strong>${d.l}</strong></span><span>C <strong>${d.c}</strong></span><em>${new Date(Number(d.time)).toISOString().slice(0,16).replace('T',' ')} UTC &middot; Vol ${number(Number(d.v),4)}</em>`;
}

export function orderBookBody(a, view='book', pool=null, trades=[]){
  if(view==='tape'){
    const rows=trades.length?trades.map(t=>`<div class="tape-row"><span class="${t.side==='buy'?'positive':'negative'}">${Number(t.price).toFixed(2)}</span><span>${t.baseAmount}</span><time>${new Date(t.time).toISOString().slice(11,19)}</time></div>`).join(''):'<div class="desk-empty"><strong>No trades yet</strong><p>Executed swaps appear here.</p></div>';
    return `<div class="book-column-labels"><span>Price (USDC)</span><span>Size</span><span>Time · UTC</span></div><div class="market-tape">${rows}</div>`;
  }
  const base=Number(pool?.baseCash||a.liquidity||0);
  const quote=Number(pool?.quoteCash||0);
  const impact=pool?.maxImpactBps||'190';
  return `<div class="book-controls"><span class="token-pair-label">${tokenMark(a.symbol)} / ${tokenMark('USDC')}</span></div><div class="detail-rows">${[['Oracle price',money(a.price)],['RLVN inventory',number(base)+' RLVN'],['USDC cash',money(quote)],['Fee','10 bps to suppliers'],['Max impact',Number(impact)/100+'%'],['Reserve floor','10% of quote NAV']].map(([k,v])=>`<div class="detail-row"><span>${k}</span><strong>${v}</strong></div>`).join('')}</div><div class="depth-summary"><div><span>BASE INVENTORY</span><b>${compact(base*a.price)}</b></div><div><span>QUOTE CASH</span><b>${compact(quote)}</b></div></div><div class="book-note">Oracle-priced inventory pool · Market exact-in</div>`;
}
export function orderBook(a, view='book', _tick=.01, pool=null, trades=[]){
  const head=`<div class="desk-panel-head"><div class="desk-tabs"><button type="button" data-action="book-view" data-value="book" class="${view==='book'?'active':''}" aria-pressed="${view==='book'}">Pool</button><button type="button" data-action="book-view" data-value="tape" class="${view==='tape'?'active':''}" aria-pressed="${view==='tape'}">Trades</button></div></div>`;
  return head+`<div class="book-body">${orderBookBody(a,view,pool,trades)}</div>`;
}

export const marketStrip=current=>`<nav class="terminal-market-strip" aria-label="Trading markets">${ASSETS.filter(a=>a.symbol!=='USDC').map(a=>`<a href="#trade/${a.symbol}" class="${current===a.symbol?'selected':''}">${tokenIcon(a.symbol,true)}<strong>${a.symbol}</strong><span data-live="strip-price">${a.price.toFixed(2)}</span><small data-live="strip-change" class="${a.change>=0?'positive':'negative'}">${a.change>=0?'+':''}${a.change.toFixed(2)}%</small></a>`).join('')}</nav>`;
