// Optional browser smoke check. Uses a local Chrome installation and an isolated
// in-memory market; never reads the application's configured database or keys.
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
import {createApplication} from '../backend/server.mjs';

const profile=await mkdtemp(join(tmpdir(),'rillvane-chart-browser-'));
const app=createApplication({dbPath:':memory:',workerEnabled:false});
const ms=3600000,end=Math.floor(Date.now()/ms)*ms;
const insert=app.db.prepare('INSERT INTO trades(side,price,base_amount,quote_amount,created) VALUES(?,?,?,?,?)');
for(let i=0;i<800;i++)for(let j=0;j<3;j++){
 const price=100+Math.sin(i/10)*2+Math.cos(j*2+i)*.3;
 insert.run(j%2?'buy':'sell',String(Math.round(price*1e6)),'1000000',String(Math.round(price*1e6)),end-(799-i)*ms+j*1000);
}
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless=new','--remote-debugging-pipe','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
let nextId=0,buffer='',sessionId;const pending=new Map(),errors=[];
browser.on('error',error=>{for(const p of pending.values())p.reject(error);});
browser.stdio[4].on('data',chunk=>{
 buffer+=chunk.toString();let index;
 while((index=buffer.indexOf('\0'))>=0){
  const message=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text+': '+(message.params.exceptionDetails.exception?.description||''));
  const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result);}
 }
});
function send(method,params={},session=sessionId){
 const id=++nextId;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},15000);
  pending.set(id,{resolve,reject,timer});browser.stdio[3].write(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})})+'\0');
 });
}
async function evaluate(expression){
 const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
 return r.result.value;
}
async function until(expression){
 for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}
 throw new Error('Browser condition failed: '+expression);
}
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const count=()=>evaluate('Number(document.querySelector(".terminal-chart-svg").dataset.count)');
try{
 const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);
 ({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`http://127.0.0.1:${app.server.address().port}/app/#trade`});
 await until('document.querySelectorAll("[data-part=body]").length > 0');
 assert.equal(await count(),64);
 await click('[data-action="chart-zoom"][data-value="0.8"]');
 await until('Number(document.querySelector(".terminal-chart-svg").dataset.count)===51');
 await click('[data-action="chart-style"][data-value="line"]');
 assert.equal(await evaluate('document.querySelectorAll("[data-part=body]").length'),0);
 for(let i=0;i<6;i++)await click('[data-action="chart-pan"][data-value="-1"]');
 await until('!document.querySelector(".chart-navigation [role=status]").textContent.includes("Loading")');
 assert.ok(await evaluate('document.querySelectorAll("[data-candle]:not([data-empty])").length > 0'));
 assert.equal(await evaluate('document.querySelector("[data-action=chart-latest]").classList.contains("active")'),false);
 await click('[data-action="chart-style"][data-value="candles"]');
 await until('document.querySelectorAll("[data-part=body]").length > 0');
 const beforeDrag=await evaluate('document.querySelector(".chart-history-range").textContent');
 const rect=await evaluate('(()=>{const r=document.querySelector(".terminal-chart-svg").getBoundingClientRect();return {x:r.x+100,y:r.y+100};})()');
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+180,y:rect.y,button:'left',buttons:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+180,y:rect.y,button:'left',clickCount:1});
 await until(`document.querySelector('.chart-history-range').textContent!==${JSON.stringify(beforeDrag)} && !document.querySelector('.chart-navigation [role=status]').textContent.includes('Loading')`);
 const beforeWheel=await count();
 await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.x,y:rect.y,deltaX:0,deltaY:-100});
 await until(`Number(document.querySelector('.terminal-chart-svg').dataset.count)<${beforeWheel}`);
 await click('[data-action="chart-latest"]');
 await until('document.querySelector("[data-action=chart-latest]").classList.contains("active")');
 await until('!document.querySelector(".chart-navigation [role=status]").textContent.includes("Loading")');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".chart-history-range")).display'), 'block');
 if(process.argv[2]){const {data}=await send('Page.captureScreenshot',{format:'png'});await writeFile(process.argv[2].replace('.png','-desktop.png'),Buffer.from(data,'base64'));}
 await click('[data-action="chart-interval"][data-value="5m"]');
 await until('document.querySelector(".terminal-chart-svg").dataset.interval==="5m" && !document.querySelector(".chart-navigation [role=status]").textContent.includes("Loading")');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await until('document.querySelector(".chart-navigation").getBoundingClientRect().width < 390');
 await new Promise(r=>setTimeout(r,500));
 assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
 assert.equal(await evaluate('document.querySelector("[data-action=chart-interval].active").dataset.value'),'5m');
 assert.ok(await evaluate('document.querySelector(".terminal-chart-content").getBoundingClientRect().left>=0'));
 if(process.argv[2]){const {data}=await send('Page.captureScreenshot',{format:'png'});await writeFile(process.argv[2],Buffer.from(data,'base64'));}
 assert.deepEqual(errors,[]);
 console.log('Browser check passed: both chart styles, zoom buttons, old history, drag, mouse wheel, latest, interval switch, mobile layout; no runtime exceptions.');
}finally{
 browser.kill();await app.close();
 const checked=resolve(profile),root=resolve(tmpdir())+sep;
 if(!checked.startsWith(root)||!checked.split(sep).at(-1).startsWith('rillvane-chart-browser-'))throw new Error('Unexpected browser profile path');
 await rm(checked,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});
}
