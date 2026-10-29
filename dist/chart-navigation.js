export const INTERVAL_MS={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
export const MIN_BARS=12,MAX_BARS=600;
export function chartWindow(view={},now=Date.now()){
  const ms=INTERVAL_MS[view.interval]||INTERVAL_MS['1h'];
  const count=Math.max(MIN_BARS,Math.min(MAX_BARS,Math.round(view.candleCount||64)));
  const latest=Math.floor(now/ms)*ms;
  const end=view.chartEnd==null?latest:Math.min(latest,Math.floor(view.chartEnd/ms)*ms);
  return {ms,count,end,start:end-(count-1)*ms,latest};
}
export function panChart(view,bars,now=Date.now(),earliest=null){
  const w=chartWindow(view,now);
  const oldest=earliest==null?0:Math.floor(earliest/w.ms)*w.ms;
  const end=Math.min(w.latest,Math.max(Math.min(w.latest,oldest+(w.count-1)*w.ms),w.end+Math.round(bars)*w.ms));
  return {...view,chartEnd:end===w.latest?null:end};
}
export function zoomChart(view,factor,anchor=0.5,now=Date.now()){
  const w=chartWindow(view,now),count=Math.max(MIN_BARS,Math.min(MAX_BARS,Math.round(w.count*factor)));
  const fixed=w.start+Math.max(0,Math.min(1,anchor))*(w.count-1)*w.ms;
  const end=Math.min(w.latest,Math.round((fixed+(1-anchor)*(count-1)*w.ms)/w.ms)*w.ms);
  return {...view,candleCount:count,chartEnd:end===w.latest?null:end};
}
