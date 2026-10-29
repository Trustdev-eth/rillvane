import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CHART_DEFAULTS,sanitizeChartPreferences} from '../dist/chart-preferences.js';
import {candleChart,buildCandles,candlesFromTrades} from '../dist/market-ui.js';
import {chartWindow,panChart,zoomChart} from '../dist/chart-navigation.js';
import {ASSETS} from '../dist/workspace-data.js';

function sampleTrades(price, count=40){
  return Array.from({length:count},(_,i)=>({price:price*(.99+i/count*.02), baseAmount:1+i%3, time:Date.now()-(count-i)*3600000, side:i%2?'buy':'sell'}));
}

test('newest-first trades retain chronological OHLC and volume',()=>{
 const time=Date.UTC(2025,0,1,12);
 const trades=[{time:time+2000,price:103,baseAmount:2},{time,price:100,baseAmount:1},{time:time+1000,price:98,baseAmount:3}];
 assert.deepEqual(candlesFromTrades(trades),[{time,open:100,high:103,low:98,close:103,volume:6}]);
});

test('panning reaches older windows, clamps to recorded history and returns live',()=>{
 const now=Date.UTC(2025,0,20),view={interval:'1h',candleCount:64,chartEnd:null};
 const older=panChart(view,-150,now),w=chartWindow(older,now);
 assert.equal(w.end,now-150*3600000);
 assert.equal(panChart(older,1000,now).chartEnd,null);
 const earliest=now-300*3600000;
 assert.equal(chartWindow(panChart(view,-10000,now,earliest),now).start,earliest);
 assert.equal(chartWindow(older,now+3600000).end,w.end);
});

test('zoom preserves the pointer time and clamps the visible candle count',()=>{
 const now=Date.UTC(2025,0,20),view={interval:'1h',candleCount:64,chartEnd:now-100*3600000};
 const before=chartWindow(view,now),after=chartWindow(zoomChart(view,.5,.25,now),now);
 assert.equal(after.count,32);
 assert.ok(Math.abs((before.start+.25*63*before.ms)-(after.start+.25*31*after.ms))<=before.ms/2);
 assert.equal(chartWindow(zoomChart(view,.001,.5,now),now).count,12);
 assert.equal(chartWindow(zoomChart(view,100,.5,now),now).count,600);
});

test('both chart styles render older history with dates and navigation',()=>{
 const a=ASSETS.find(x=>x.symbol==='RLVN'),now=Date.UTC(2025,0,20),chartEnd=now-200*3600000;
 const candles=[{time:chartEnd,open:100,high:102,low:99,close:101,volume:3}];
 for(const chartStyle of ['line','candles']){
  const html=candleChart(a,{interval:'1h',chartStyle,now,chartEnd,candles});
  assert.match(html,/C <strong>101\.00/);
  assert.match(html,/2025-01-11/);
  assert.match(html,/data-action="chart-zoom"/);
  assert.match(html,/data-action="chart-pan"/);
  assert.doesNotMatch(html,/>Latest<\/text>/);
  if(chartStyle==='line')assert.match(html,/data-part="line-point"/);
 }
 const empty=candleChart(a,{now,chartEnd,candles:[]});
 assert.match(empty,/terminal-chart-svg/);
 assert.match(empty,/data-action="chart-latest"/);
});

test('appearance settings reject unsafe values and keep candle parts visible',()=>{
 const p=sanitizeChartPreferences({upColor:'red;position:fixed',downColor:'#ABCDEF',chartBackground:'url(javascript:alert(1))',candleBodies:false,candleBorders:false,candleWicks:false,unexpected:'ignored'});
 assert.equal(p.upColor,CHART_DEFAULTS.upColor);assert.equal(p.downColor,'#abcdef');assert.equal(p.chartBackground,CHART_DEFAULTS.chartBackground);assert.equal(p.candleBorders,true);assert.equal(p.unexpected,undefined);
});
test('candle appearance switches modify the actual plotted elements',()=>{
 const asset=ASSETS.find(a=>a.symbol==='RLVN'),trades=sampleTrades(asset.price);
 const defaultChart=candleChart(asset,{chartWidth:800,chartHeight:420,trades});
 assert.match(defaultChart,/fill-opacity="0.55"/);assert.match(defaultChart,/data-part="wick"/);assert.match(defaultChart,/data-part="last-price"/);assert.ok(defaultChart.includes(`stroke="${CHART_DEFAULTS.upColor}"`));
 const changed=candleChart(asset,{candleWicks:false,candleBodies:false,candleBorders:true,lastPrice:false,volume:false,horizontalGrid:false,verticalGrid:false,trades});
 assert.doesNotMatch(changed,/data-part="wick"|data-part="volume"|data-part="last-price"|class="chart-grid/);assert.match(changed,/fill="none" fill-opacity=/);
 assert.match(candleChart(asset,{hollowCandles:false,trades}),/fill-opacity="1"/);
 assert.doesNotMatch(candleChart(asset,{chartStyle:'line',volume:false,trades}),/data-part="body"|data-part="wick"/);
});
test('oracle mark fills an empty window and executed trades build candles',()=>{
 const a=ASSETS.find(x=>x.symbol==='RLVN');
 const seeded=buildCandles(a,'1h',64,[],Date.now());
 assert.equal(seeded.filter(c=>!c.empty).length,64);
 assert.match(candleChart(a,{chartWidth:900,chartHeight:500,interval:'1h'}), /C <strong>100\.00/);
 assert.doesNotMatch(candleChart(a,{chartWidth:900,chartHeight:500,interval:'1h'}), /No executed trades yet/);
 const data=buildCandles(a,'1h',64,sampleTrades(a.price));
 assert.ok(data.length>0);
 const filled=data.filter(c=>!c.empty);
 assert.ok(filled.length>0);
 assert.ok(filled.every(c=>c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)));
 const html=candleChart(a,{chartWidth:900,chartHeight:500,interval:'1h',trades:sampleTrades(a.price)});
 assert.match(html,/viewBox="0 0 900 500"/);
 assert.doesNotMatch(html,/NaN/);
});
test('API candles plot finite OHLC and do not stretch a single bar across the pane',()=>{
 const a=ASSETS.find(x=>x.symbol==='RLVN'),now=1_700_000_000_000;
 const candles=[{time:now,open:100,high:100.2,low:99.8,close:100.1,volume:0.998}];
 const data=buildCandles(a,'1h',64,candles,now);
 assert.equal(data.length,64);
 assert.equal(data.filter(c=>!c.empty).length,1);
 const html=candleChart(a,{chartWidth:900,chartHeight:400,interval:'1h',candles,now,candleCount:64});
 assert.match(html,/O <strong>100\.00/);
 assert.match(html,/C <strong>100\.10/);
 assert.match(html,/preserveAspectRatio="none"/);
 assert.match(html,/>100\.10</);
 assert.doesNotMatch(html,/NaN/);
 assert.match(html,/1 candles/);
 const width=html.match(/data-part="body"[^>]*width="([\d.]+)"/);
 assert.ok(width&&Number(width[1])<40);
 const broken=[{time:now,open:100,high:100,low:100,close:100,volume:1}];
 assert.doesNotMatch(candleChart(a,{chartWidth:900,chartHeight:400,interval:'1h',candles:broken,now}),/NaN/);
});
test('last price follows the last close, not the oracle mark',()=>{
 const a={...ASSETS.find(x=>x.symbol==='RLVN'),price:100};
 const now=1_700_000_000_000;
 const candles=Array.from({length:8},(_,i)=>({time:now-(7-i)*3600000,open:100.08,high:100.22,low:99.88,close:100.12+i*0.01,volume:2}));
 const html=candleChart(a,{chartWidth:900,chartHeight:400,interval:'1h',candles,now,candleCount:8});
 assert.match(html,/data-part="last-price"/);
 assert.match(html,/>100\.19</);
 assert.doesNotMatch(html,/<text class="chart-current-label"[^>]*>100\.00</);
});
test('5m axis keeps each UTC hour, including the middle of the window',()=>{
 const a=ASSETS.find(x=>x.symbol==='RLVN');
 const now=Date.UTC(2024,0,2,16,15,0);
 const candles=Array.from({length:64},(_,i)=>{
  const time=now-(63-i)*300000;
  return {time,open:100.05,high:100.18,low:99.88,close:100.08,volume:1};
 });
 const html=candleChart(a,{chartWidth:900,chartHeight:400,interval:'5m',candles,now,candleCount:64});
 assert.match(html,/>11:00</);
 assert.match(html,/>12:00</);
 assert.match(html,/>13:00</);
 assert.match(html,/>14:00</);
 assert.match(html,/>15:00</);
 assert.match(html,/>Latest</);
});
test('tight bid-ask prints keep a readable price scale',()=>{
 const a=ASSETS.find(x=>x.symbol==='RLVN'),now=1_700_000_000_000;
 const candles=[
  {time:now-3600000,open:100.10,high:100.10,low:99.90,close:100.10,volume:2},
  {time:now,open:100.10,high:100.10,low:99.90,close:99.90,volume:3}
 ];
 const html=candleChart(a,{chartWidth:900,chartHeight:400,interval:'1h',candles,now,candleCount:64});
 const min=Number(html.match(/data-min="([-\d.]+)"/)[1]),max=Number(html.match(/data-max="([-\d.]+)"/)[1]);
 assert.ok(max-min>=0.99);
 assert.ok(min<=99.90&&max>=100.10);
 assert.match(html,/2 candles/);
});
test('one wild wick does not flatten the rest of the pane',()=>{
 const a=ASSETS.find(x=>x.symbol==='RLVN'),now=1_700_000_000_000;
 const candles=Array.from({length:24},(_,i)=>({time:now-(23-i)*3600000,open:100,high:100.4,low:99.6,close:100.1,volume:1}));
 candles[10]={...candles[10],high:180,low:40};
 const html=candleChart(a,{chartWidth:900,chartHeight:400,interval:'1h',candles,now,candleCount:24});
 assert.doesNotMatch(html,/>180\.00</);
 assert.doesNotMatch(html,/>40\.00</);
 assert.match(html,/>100\.10</);
});
