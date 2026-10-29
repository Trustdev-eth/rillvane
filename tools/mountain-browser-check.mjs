// Visual smoke check for the mountain workspace. Uses an isolated in-memory
// backend and a temporary Chrome profile; never loads configured keys or state.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApplication} from '../backend/server.mjs';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv[2]||join(projectRoot,'output','ui-checks'));
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'rillvane-mountain-browser-'));
const app=createApplication({dbPath:':memory:',keys:null,workerEnabled:false});
await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
const origin=process.env.RILLVANE_PREVIEW_URL||`http://127.0.0.1:${app.server.address().port}`;
const browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--remote-debugging-pipe','--no-first-run','--no-default-browser-check',
  `--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
let nextId=0,buffer='',sessionId,exited=false;
const pending=new Map(),errors=[],checks=[];
function failPending(error){for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();}
browser.on('error',failPending);
browser.on('exit',(code,signal)=>{exited=true;failPending(new Error(`Chrome exited (${code??signal})`));});
browser.stdio[4].on('data',chunk=>{
  buffer+=chunk.toString();let index;
  while((index=buffer.indexOf('\0'))>=0){
    const message=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);
    if(message.method==='Runtime.exceptionThrown'){
      const d=message.params.exceptionDetails;
      errors.push(d.exception?.description||d.text);
    }
    const entry=pending.get(message.id);
    if(entry){pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(new Error(message.error.message)):entry.resolve(message.result);}
  }
});
function send(method,params={},session=sessionId){
  if(exited)return Promise.reject(new Error('Chrome is no longer running'));
  const id=++nextId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);
    pending.set(id,{resolve,reject,timer});
    browser.stdio[3].write(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})})+'\0');
  });
}
async function evaluate(expression){
  const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
  return response.result.value;
}
async function until(expression,label=expression){
  for(let i=0;i<100;i++){
    if(await evaluate(expression))return;
    await new Promise(resolve=>setTimeout(resolve,75));
  }
  throw new Error(`Browser condition failed: ${label}`);
}
async function settle(){await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');}
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function route(name){
  await evaluate(`location.hash=${JSON.stringify(name)}`);
  await until(`document.body.dataset.page===${JSON.stringify(name)} && document.documentElement.dataset.ready==='true' && !document.querySelector('.workspace-loading')`,name+' renders');
  await settle();
}
async function screenshot(name,fullPage=true){
  await settle();
  const options={format:'png',captureBeyondViewport:fullPage};
  if(fullPage){
    const {cssContentSize}=await send('Page.getLayoutMetrics');
    options.clip={x:0,y:0,width:Math.ceil(cssContentSize.width),height:Math.ceil(cssContentSize.height),scale:1};
  }
  const {data}=await send('Page.captureScreenshot',options);
  await writeFile(join(output,name+'.png'),Buffer.from(data,'base64'));
}
async function checkRoute(name,viewport){
  await route(name);
  const result=await evaluate(`(()=>{
    const main=document.querySelector('#main-content'),rect=main.getBoundingClientRect();
    return {route:document.body.dataset.page,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      mainLeft:rect.left,mainRight:rect.right,content:main.textContent.trim().length,
      background:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
      logo:document.querySelector('.app-brand img').getAttribute('src'),
      loadedLogo:document.querySelector('.app-brand img').complete&&document.querySelector('.app-brand img').naturalWidth>0};
  })()`);
  assert.equal(result.route,name,`${viewport}: route renders`);
  assert.ok(result.content>10,`${viewport}/${name}: content present`);
  assert.ok(result.scrollWidth<=result.width+1,`${viewport}/${name}: horizontal overflow (${result.scrollWidth}>${result.width})`);
  assert.ok(result.mainLeft>=-1&&result.mainRight<=result.width+1,`${viewport}/${name}: main content fits the viewport`);
  assert.equal(result.background,'#14251a',`${viewport}/${name}: dark forest background`);
  assert.equal(result.logo,'/assets/brand-mark.svg',`${viewport}/${name}: original logo source`);
  assert.equal(result.loadedLogo,true,`${viewport}/${name}: logo loaded`);
  checks.push({viewport,...result});
}
async function checkLandscape(){
  assert.equal(await evaluate('!!document.querySelector(".landscape-hero")'),true,'Overview has a landscape hero');
  assert.equal(await evaluate('!!document.querySelector(".landscape-summary")'),true,'Overview has landscape summary cards');
  const images=await evaluate(`(async()=>{
    const hero=document.querySelector('.landscape-hero'),sources=new Set();
    for(const node of [hero,...hero.querySelectorAll('*')]){
      if(node.tagName==='IMG'&&node.currentSrc)sources.add(node.currentSrc);
      for(const pseudo of [null,'::before','::after']){
        const css=getComputedStyle(node,pseudo).backgroundImage;
        for(const match of css.matchAll(/url\\(["']?([^"')]+)["']?\\)/g))sources.add(new URL(match[1],location.href).href);
      }
    }
    return Promise.all([...sources].map(src=>new Promise(resolve=>{
      const image=new Image(),timer=setTimeout(()=>resolve({src,loaded:false}),8000);
      image.onload=()=>{clearTimeout(timer);resolve({src,loaded:image.naturalWidth>0});};
      image.onerror=()=>{clearTimeout(timer);resolve({src,loaded:false});};image.src=src;
    })));
  })()`);
  assert.ok(images.length>0,'Overview uses generated landscape artwork');
  assert.ok(images.every(image=>image.loaded),'Landscape images load: '+JSON.stringify(images));
  return images;
}
async function checkSummaryValues(){
  const clipped=await evaluate(`Array.from(document.querySelectorAll('.landscape-summary-card .stat-value')).map(value=>{
    const range=document.createRange();range.selectNodeContents(value);
    const text=range.getBoundingClientRect(),card=value.closest('.landscape-summary-card').getBoundingClientRect();
    return {value:value.textContent.trim(),left:text.left,right:text.right,top:text.top,bottom:text.bottom,
      cardLeft:card.left,cardRight:card.right,cardTop:card.top,cardBottom:card.bottom};
  }).filter(item=>item.left<item.cardLeft||item.right>item.cardRight||item.top<item.cardTop||item.bottom>item.cardBottom)`);
  assert.deepEqual(clipped,[],'Account summary amounts remain fully visible');
}
try{
  const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);
  ({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:origin+'/app/#overview'});
  await until('document.documentElement.dataset.ready==="true"','initial workspace hydration');
  const routes=['overview','markets','trade','earn','borrow','portfolio','activity','risk'];
  for(const name of routes)await checkRoute(name,'desktop');
  await route('overview');
  const images=await checkLandscape();
  await screenshot('overview-desktop');
  const expandedBefore=await evaluate('document.documentElement.classList.contains("nav-expanded")');
  const widthBefore=await evaluate('document.querySelector(".sidebar").getBoundingClientRect().width');
  await click('.desktop-nav-toggle');
  await until(`document.documentElement.classList.contains('nav-expanded')!==${expandedBefore}`,'desktop navigation toggles');
  await settle();
  const widthAfter=await evaluate('document.querySelector(".sidebar").getBoundingClientRect().width');
  assert.ok(Math.abs(widthAfter-widthBefore)>50,'Desktop navigation expands/collapses');
  await checkRoute('overview','desktop-navigation-toggled');
  await screenshot('overview-desktop-navigation-toggled');
  await click('.desktop-nav-toggle');await settle();
  await route('trade');await screenshot('trade-desktop');
  await click('.app-topbar [data-action="settings"]');
  await until('document.querySelector("#workspace-modal").open','workspace settings opens');
  assert.equal(await evaluate('document.querySelector("#modal-title").textContent'),'Workspace settings');
  await screenshot('settings-desktop',false);
  await click('#workspace-modal [data-action="close-modal"]');
  await until('!document.querySelector("#workspace-modal").open','workspace settings closes');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const name of routes)await checkRoute(name,'mobile');
  await route('overview');await checkLandscape();await screenshot('overview-mobile');await checkSummaryValues();
  await click('.mobile-menu');
  await until('document.body.classList.contains("nav-open")','mobile navigation opens');
  await click('.sidebar [data-route="markets"]');
  await until('document.body.dataset.page==="markets"&&!document.body.classList.contains("nav-open")','mobile navigation changes route');
  await route('trade');await screenshot('trade-mobile');
  await click('.app-topbar [data-action="settings"]');
  await until('document.querySelector("#workspace-modal").open','mobile settings opens');
  const modal=await evaluate('(()=>{const r=document.querySelector("#workspace-modal").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()');
  assert.ok(modal.left>=0&&modal.right<=modal.width&&modal.top>=0&&modal.bottom<=modal.height,'Mobile settings fits the screen');
  await screenshot('settings-mobile',false);
  await click('#workspace-modal [data-action="close-modal"]');
  assert.deepEqual(errors,[],'No browser runtime exceptions');
  await writeFile(join(output,'report.json'),JSON.stringify({checks,images,runtimeExceptions:errors},null,2)+'\n');
  console.log(`Mountain browser check passed: all 8 routes on desktop/mobile, generated artwork, original logo, navigation, settings dialogs, no horizontal overflow or runtime exceptions. Screenshots: ${output}`);
}catch(error){
  if(sessionId&&!exited)await screenshot('failure',false).catch(()=>{});
  await writeFile(join(output,'failure.json'),JSON.stringify({message:error.message,checks,runtimeExceptions:errors},null,2)+'\n').catch(()=>{});
  throw error;
}finally{
  browser.kill();await app.close();
  const checked=resolve(profile),temporaryRoot=resolve(tmpdir())+sep;
  if(!checked.startsWith(temporaryRoot)||!checked.split(sep).at(-1).startsWith('rillvane-mountain-browser-'))throw new Error('Unexpected browser profile path');
  await rm(checked,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});
}
