import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {resolveSiteMode,resolveStaticRoute} from './site-routing.mjs';
import {loadConfig} from './config.mjs';
import {createApplication} from './server.mjs';
import {encodeBase58} from './chain.mjs';
import {siteDestinations,initializeSiteLinks} from '../dist/site-links.js';

test('app subdomain resolves to app mode while local development stays combined',()=>{
  assert.equal(resolveSiteMode('https://app.rillvane.trade'),'app');
  assert.equal(resolveSiteMode('http://localhost:8787'),'combined');
  assert.equal(resolveSiteMode('https://app.example.com','app'),'app');
  assert.throws(()=>resolveSiteMode('https://app.example.com','unknown'),/SITE_MODE/);
  assert.equal(loadConfig({PUBLIC_ORIGIN:'https://app.rillvane.trade'}).siteMode,'app');
  assert.equal(loadConfig({PUBLIC_ORIGIN:'http://localhost:8787'}).siteMode,'combined');
  assert.equal(loadConfig({SITE_MODE:'app'}).siteMode,'app');
});

test('canonical app redirects retain query strings and leave asset/API paths intact',()=>{
  for(const path of ['/app','/app/','/app/index.html','/index.html']){
    assert.deepEqual(resolveStaticRoute(path,'?ref=landing','app'),{redirect:'/?ref=landing'});
  }
  assert.deepEqual(resolveStaticRoute('/','', 'app'),{pathname:'/app/index.html'});
  assert.deepEqual(resolveStaticRoute('/assets/brand-mark.svg','', 'app'),{pathname:'/assets/brand-mark.svg'});
  assert.deepEqual(resolveStaticRoute('/api/v1/stream','', 'app'),{pathname:'/api/v1/stream'});
  assert.deepEqual(resolveStaticRoute('/app','?ref=local','combined'),{redirect:'/app/?ref=local'});
});

test('production links switch domains; local links retain the original development paths',()=>{
  const production={app:'https://app.rillvane.trade/',landing:'https://rillvane.trade/'};
  for(const hostname of ['rillvane.trade','www.rillvane.trade','app.rillvane.trade']){
    assert.deepEqual(siteDestinations(hostname),production);
  }
  assert.deepEqual(siteDestinations('localhost'),{app:'/app/',landing:'/'});
  assert.deepEqual(siteDestinations('127.0.0.1'),{app:'/app/',landing:'/'});
  const anchors=['app','landing'].map(siteLink=>({dataset:{siteLink},setAttribute(name,value){this[name]=value;}}));
  initializeSiteLinks({querySelectorAll:()=>anchors},'app.rillvane.trade');
  assert.equal(anchors[0].href,production.app);assert.equal(anchors[1].href,production.landing);
  const landing=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.equal((landing.match(/href="https:\/\/app\.rillvane\.trade\/" data-site-link="app"/g)||[]).length,3);
});

test('standalone app serves the workspace at root with working assets and domain-bound API auth',async t=>{
  const origin='https://app.rillvane.trade';
  const app=createApplication({dbPath:':memory:',origin,siteMode:'app',keys:null,workerEnabled:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const request=(path,init={})=>fetch(base+path,{redirect:'manual',...init});
  const root=await request('/');assert.equal(root.status,200);
  const html=await root.text();assert.match(html,/id="main-content"/);assert.doesNotMatch(html,/id="landscape"/);
  assert.match(html,/href="https:\/\/rillvane\.trade\/" data-site-link="landing"/);
  for(const path of ['/workspace.js','/site-links.js','/gradients.css','/assets/brand-mark.svg']){
    assert.equal((await request(path)).status,200,path+' loads from the app origin');
  }
  assert.equal((await request('/',{method:'HEAD'})).status,200);
  const oldPath=await request('/app/?ref=landing');assert.equal(oldPath.status,308);assert.equal(oldPath.headers.get('location'),'/?ref=landing');
  assert.equal((await request('/api/health')).status,200);
  assert.equal((await request('/api/account')).status,401);
  const pair=generateKeyPairSync('ed25519'),wallet=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
  const challenge=await request('/api/auth/challenge',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({wallet})});
  assert.equal(challenge.status,200);assert.ok((await challenge.json()).message.startsWith(origin+' requests'));
  const wrongOrigin=await request('/api/auth/challenge',{method:'POST',headers:{Origin:'https://rillvane.trade','content-type':'application/json'},body:JSON.stringify({wallet})});
  assert.equal(wrongOrigin.status,403,'Landing origin cannot authorize an app write');
});

test('combined development still serves landing at / and workspace at /app/',async t=>{
  const app=createApplication({dbPath:':memory:',keys:null,workerEnabled:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  assert.match(await (await fetch(base+'/')).text(),/id="landscape"/);
  assert.match(await (await fetch(base+'/app/')).text(),/id="main-content"/);
  const canonical=await fetch(base+'/app?ref=dev',{redirect:'manual'});
  assert.equal(canonical.status,308);assert.equal(canonical.headers.get('location'),'/app/?ref=dev');
});
