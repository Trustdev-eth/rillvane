// Browser-to-API test with a generated test wallet, an in-memory backend, and
// a mocked RPC. Never reads configured keys/state or broadcasts transactions.
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {Transaction,PublicKey,SystemProgram} from '@solana/web3.js';
import {encodeBase58} from '../backend/chain.mjs';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApplication} from '../backend/server.mjs';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv[2]||join(projectRoot,'output','integration-checks'));
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'rillvane-integration-browser-'));
const testTime=Date.now();
const app=createApplication({dbPath:':memory:',origin:'',keys:null,workerEnabled:false,now:()=>testTime,
 fetchRpc:async(_,init)=>{const {method}=JSON.parse(init.body);return {ok:true,json:async()=>({result:method==='getGenesisHash'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG':method==='getLatestBlockhash'?{value:{blockhash:'1'.repeat(32),lastValidBlockHeight:99}}:{value:[]}})};}
});
await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${app.server.address().port}`;
app.adoptOrigin(new Request(origin));
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
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const input=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
async function route(name){await evaluate(`location.hash=${JSON.stringify(name)}`);await until(`document.body.dataset.page===${JSON.stringify(name)}`);}
async function portfolio(){return evaluate('fetch("/api/v1/me/portfolio").then(r=>r.json())');}
async function confirm(){
  await until('!!document.querySelector("#workspace-modal[open] [data-action=confirm]")');
  await click('#workspace-modal [data-action=confirm]');
  await until('!document.querySelector("#workspace-modal").open','instruction settles and dialog closes');
  assert.equal(await evaluate('!!document.querySelector(".app-toast[data-tone=error]")'),false,'No transaction error');
}
const pair=generateKeyPairSync('ed25519');
const wallet=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
const privateBytes=[...pair.privateKey.export({format:'der',type:'pkcs8'})];
const fixture=new Transaction({feePayer:new PublicKey(wallet),recentBlockhash:'1'.repeat(32)}).add(SystemProgram.transfer({fromPubkey:new PublicKey(wallet),toPubkey:new PublicKey(wallet),lamports:0}));
const fixtureWire=fixture.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
try{
  const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);
  ({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__calls=[];window.__signedTransactions=0;window.__slowQuotes=false;
    const keyPromise=crypto.subtle.importKey('pkcs8',new Uint8Array(${JSON.stringify(privateBytes)}),{name:'Ed25519'},false,['sign']);
    const sign=async bytes=>{try{return new Uint8Array(await crypto.subtle.sign('Ed25519',await keyPromise,bytes));}catch(error){window.__signError=error.message;throw error;}};
    window.phantom={solana:{publicKey:{toString:()=>${JSON.stringify(wallet)}},connect:async()=>({publicKey:{toString:()=>${JSON.stringify(wallet)}}}),on:()=>{},signMessage:async bytes=>({signature:await sign(bytes)}),signTransaction:async transaction=>{
      if(typeof transaction.addSignature!=='function'||typeof transaction.compileMessage!=='function')throw new Error('Expected a decoded Solana Transaction');
      transaction.addSignature(transaction.feePayer,await sign(transaction.serializeMessage()));
      if(!transaction.verifySignatures())throw new Error('Wallet signature did not verify');
      window.__signedTransactions++;return transaction;
    }}};
    const realFetch=window.fetch.bind(window);
    window.fetch=async(url,init)=>{
      const path=String(url);let body;try{body=JSON.parse(init?.body)}catch{}
      window.__calls.push({path,body});
      if(path==='/api/health'&&window.__offline)return new Response(JSON.stringify({error:'Unavailable'}),{status:503});
      const response=await realFetch(url,init);
      if(path.includes('/quotes/swap')&&window.__slowQuotes&&body?.amountIn==='10')await new Promise(r=>setTimeout(r,650));
      if(path.endsWith('/prepare')&&window.__injectTransaction){
        window.__injectTransaction=false;const data=await response.json();data.transaction=${JSON.stringify(fixtureWire)};
        return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
      }
      return response;
    };
  `});
  await send('Page.navigate',{url:origin+'/app/#overview'});
  await until('document.body.dataset.backendStatus==="online"');
  await click('#header-account');await until('document.querySelector("#header-account").hasAttribute("data-connected")');
  assert.equal((await portfolio()).wallet,wallet);
  checks.push('Wallet sign-in with a real Ed25519 challenge');
  for(const asset of ['USDC','RLVN']){
    await click('#header-account');await until('document.querySelector("#workspace-modal").open');
    await click(`[data-action="faucet"][data-asset="${asset}"]`);
    await until('!document.querySelector("#workspace-modal").open');
  }
  let account=await portfolio();assert.equal(account.balances.USDC,'10000');assert.equal(account.balances.RLVN,'100');
  checks.push('Wallet-signed USDC and RLVN faucet claims');
  await route('earn');await click('[data-action="vault"][data-vault="usdc"]');
  await input('#vault-amount','1000');await click('#vault-submit');await confirm();
  assert.equal((await portfolio()).shares.USDC,'1000');checks.push('Supply quote, review, signed intent and NAV shares');
  await route('trade');await input('#trade-amount','100');
  await until('!document.querySelector("#trade-submit").disabled');
  assert.ok(Number(await evaluate('document.querySelector("#quote-min").textContent.split(" ")[0]'))<Number(await evaluate('document.querySelector("#receive-amount").textContent')));
  await click('#trade-submit');await evaluate('window.__injectTransaction=true');await confirm();
  account=await portfolio();assert.ok(Number(account.balances.RLVN)>100);
  const suppliedSnapshot=await evaluate('fetch("/api/account").then(r=>r.json())');
  assert.ok(suppliedSnapshot.state.supplied.usdc>suppliedSnapshot.state.deposits.usdc,'NAV proceeds include earned fees rather than valuing shares as assets');
  assert.equal(await evaluate('window.__signedTransactions'),1);checks.push('Swap slippage and genuine transaction deserialization/signing');
  await evaluate('window.__slowQuotes=true');await input('#trade-amount','10');
  await until('window.__calls.some(x=>x.path.includes("/quotes/swap")&&x.body?.amountIn==="10")');
  await input('#trade-amount','20');await until('!document.querySelector("#trade-submit").disabled');
  await new Promise(resolve=>setTimeout(resolve,750));await click('#trade-submit');
  assert.match(await evaluate('document.querySelector("#modal-content .review-amount strong").textContent'),/^20 USDC/);
  await click('#workspace-modal [data-action="close-modal"]');checks.push('Out-of-order quotes cannot replace the current amount');
  for(const [action,amount] of [['add','50'],['borrow','100'],['repay','100'],['remove','50']]){
    await route('borrow');await click(`[data-action="credit-tab"][data-value="${action}"]`);
    await input('#credit-amount',amount);await click('#credit-submit');await confirm();
  }
  account=await portfolio();assert.equal(account.debt,'0');assert.equal(account.collateral.RLVN,'0');
  checks.push('Add collateral, borrow, repay, and release collateral');
  await route('earn');await click('[data-action="vault"][data-vault="usdc"]');
  await click('[data-action="vault-tab"][data-value="withdraw"]');await input('#vault-amount','1000');
  await click('#vault-submit');await until('!!document.querySelector("#workspace-modal [data-action=confirm]")');
  assert.match(await evaluate('document.querySelector("#modal-content").textContent'),/Shares redeemed/);
  await confirm();assert.equal((await portfolio()).shares.USDC,'0');checks.push('Withdraw shares with the backend-quoted asset proceeds');
  await route('overview');await until('document.querySelector("[data-live=net]").textContent!=="$0.00"');
  const snapshot=await evaluate('fetch("/api/account").then(r=>r.json())');
  assert.ok(snapshot.state.supplied);assert.equal(snapshot.state.deposits.usdc,0);
  await route('activity');assert.match(await evaluate('document.querySelector("#activity-results").textContent'),/Market buy|Swap/);
  checks.push('Overview, portfolio and activity reflect backend settlement');
  await evaluate('window.__offline=true;document.dispatchEvent(new Event("visibilitychange"))');
  await until('document.body.dataset.backendStatus==="offline"');
  assert.equal(await evaluate('document.querySelector("#backend-notice").hidden'),false);
  await evaluate('window.__offline=false;document.dispatchEvent(new Event("visibilitychange"))');
  await until('document.body.dataset.backendStatus==="online"');
  assert.equal(await evaluate('document.querySelector("#backend-notice").hidden'),true);
  checks.push('Connection status recovers after a temporary API outage');
  await send('Page.navigate',{url:origin+'/app/#portfolio'});
  await until('document.body.dataset.page==="portfolio"&&document.querySelector("#header-account").hasAttribute("data-connected")');
  assert.equal((await portfolio()).wallet,wallet);
  await click('#header-account');await until('document.querySelector("#workspace-modal").open');
  await click('[data-action="sign-out"]');
  await until('document.documentElement.dataset.ready==="true"&&!document.querySelector("#header-account").hasAttribute("data-connected")');
  assert.equal(await evaluate('fetch("/api/account").then(r=>r.status)'),401);
  checks.push('Session restores on reload and logout revokes access');
  assert.deepEqual(errors,[]);
  await writeFile(join(output,'report.json'),JSON.stringify({checks,wallet,runtimeExceptions:errors},null,2)+'\n');
  console.log('Frontend/backend integration passed: '+checks.join('; '));
}catch(error){
  if(sessionId&&!exited){const {data}=await send('Page.captureScreenshot',{format:'png'}).catch(()=>({}));if(data)await writeFile(join(output,'failure.png'),Buffer.from(data,'base64'));}
  console.error(JSON.stringify({checks,errors,state:await evaluate('({toast:document.querySelector("#toast")?.textContent,signError:window.__signError,provider:!!window.phantom,connected:document.querySelector("#header-account")?.outerHTML,calls:window.__calls?.slice(-12)})').catch(()=>null)}));throw error;
}finally{
  browser.kill();await app.close();
  const checked=resolve(profile),temporaryRoot=resolve(tmpdir())+sep;
  if(!checked.startsWith(temporaryRoot)||!checked.split(sep).at(-1).startsWith('rillvane-integration-browser-'))throw new Error('Unexpected test profile path');
  await rm(checked,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});
}
