import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,backupDatabase,rateLimit} from './database.mjs';
import {loadConfig} from './config.mjs';
import {createRpc,DEVNET_GENESIS} from './rpc.mjs';
import {createTransactionWorker,trackTransaction,validSignature} from './transactions.mjs';
import {createApplication} from './server.mjs';

const signature='2'.repeat(88),wallet='wallet-A';
const rpcResponse=result=>({ok:true,json:async()=>({result})});
test('production configuration fails closed on unsafe origin, cluster, execution or secrets',()=>{
 const env={NODE_ENV:'production',PUBLIC_ORIGIN:'https://app.example',DATABASE_PATH:'/data/app.sqlite',OPS_TOKEN:'a'.repeat(48)};
 assert.equal(loadConfig(env).production,true);
 for(const change of [{PUBLIC_ORIGIN:'http://app.example'},{SOLANA_CLUSTER:'mainnet-beta'},{EXECUTION_MODE:'live'},{OPS_TOKEN:'short'},{DATABASE_PATH:''},{PUBLIC_ORIGIN:'https://app.example/path'},{SOLANA_RPC_URL:'http://rpc.example'},{PORT:'bad'}])assert.throws(()=>loadConfig({...env,...change}));
});
test('RPC verifies genesis, fails over read requests, re-verifies after TTL and never submits',async()=>{
 assert.equal(DEVNET_GENESIS,'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
 let time=1000;const calls=[];
 const rpc=createRpc({urls:['https://wrong.example','https://dev.example'],now:()=>time,fetchRpc:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,...body});return rpcResponse(body.method==='getGenesisHash'?(url.includes('wrong')?'mainnet':DEVNET_GENESIS):123);}});
 assert.equal(await rpc.check(),123);assert.equal(calls.filter(c=>c.url.includes('wrong')&&c.method!=='getGenesisHash').length,0);
 await assert.rejects(rpc.read('sendTransaction',[]),/read-only/);
 const before=calls.filter(c=>c.url.includes('dev')&&c.method==='getGenesisHash').length;time+=60001;await rpc.check();assert.equal(calls.filter(c=>c.url.includes('dev')&&c.method==='getGenesisHash').length,before+1);
 const down=createRpc({fetchRpc:async()=>{throw new Error('RPC secret URL');}});await assert.rejects(down.check(),error=>error.status===503&&!error.message.includes('secret'));
});
test('migrations preserve legacy accounts, rate limits survive restart and online backups restore',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rillvane-ops-')),path=join(dir,'app.sqlite');
 let old=new DatabaseSync(path);old.exec('CREATE TABLE accounts(wallet TEXT PRIMARY KEY,state TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0)');old.prepare('INSERT INTO accounts VALUES(?,?,?)').run(wallet,'{"legacy":true}',7);old.close();
 let db=openDatabase(path);assert.equal(db.prepare('SELECT revision FROM accounts').get().revision,7);assert.equal(rateLimit(db,'ip-hash',1,1000).allowed,true);db.close();db=openDatabase(path);
 t.after(async()=>{try{db.close();}catch{}await rm(dir,{recursive:true,force:true});});
 assert.equal(rateLimit(db,'ip-hash',1,1001).allowed,false);assert.equal(rateLimit(db,'ip-hash',1,61001).allowed,true);
 const backup=join(dir,'backup.sqlite');await backupDatabase(db,backup);const restored=openDatabase(backup);assert.equal(restored.prepare('SELECT revision FROM accounts').get().revision,7);restored.close();
});
test('durable transaction jobs recover leases and verify signer before finality or notices',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());let time=1000,confirmation='confirmed',owns=true,chainError=null,missing=false,offline=false;
 const rpc={read:async(method)=>{if(offline)throw new Error('RPC offline');if(method==='getSignatureStatuses')return {value:missing?[null]:[{confirmationStatus:confirmation,err:chainError}]};return {slot:42,meta:{err:chainError},transaction:{message:{accountKeys:[{pubkey:owns?wallet:'someone-else',signer:true}]}}};}};
 const worker=createTransactionWorker({db,rpc,now:()=>time});
 assert.equal(validSignature(signature),true);assert.equal(validSignature('<script>'),false);
 const tx=trackTransaction(db,wallet,signature,time);assert.equal(trackTransaction(db,wallet,signature,time).id,tx.id);assert.equal(db.prepare('SELECT count(*) AS n FROM jobs').get().n,1);
 db.prepare("UPDATE jobs SET state='leased',lease_until=?,lease_token='dead-process'").run(time+100);await worker.tick();assert.equal(db.prepare('SELECT state FROM chain_transactions').get().state,'unknown');time+=101;
 await worker.tick();assert.equal(db.prepare('SELECT state FROM chain_transactions').get().state,'confirmed');assert.equal(db.prepare('SELECT ownership_verified FROM chain_transactions').get().ownership_verified,1);
 confirmation='finalized';time+=60001;await worker.tick();assert.equal(db.prepare('SELECT state FROM chain_transactions').get().state,'finalized');assert.equal(db.prepare('SELECT state FROM jobs').get().state,'done');assert.equal(db.prepare('SELECT count(*) AS n FROM notifications').get().n,2);await worker.tick();assert.equal(db.prepare('SELECT count(*) AS n FROM notifications').get().n,2);
 owns=false;const rejected=trackTransaction(db,wallet,'3'.repeat(88),time);await worker.tick();assert.equal(db.prepare('SELECT state FROM chain_transactions WHERE id=?').get(rejected.id).state,'rejected');
 owns=true;chainError={InstructionError:[0,'Custom']};const failed=trackTransaction(db,wallet,'4'.repeat(88),time);await worker.tick();assert.equal(db.prepare('SELECT state FROM chain_transactions WHERE id=?').get(failed.id).state,'failed');
 missing=true;offline=true;const unknown=trackTransaction(db,wallet,'5'.repeat(88),time);db.prepare('UPDATE jobs SET attempts=11 WHERE transaction_id=?').run(unknown.id);await worker.tick();assert.equal(db.prepare('SELECT state FROM chain_transactions WHERE id=?').get(unknown.id).state,'unknown');assert.equal(db.prepare('SELECT state FROM jobs WHERE transaction_id=?').get(unknown.id).state,'exhausted');
 assert.equal(db.prepare('SELECT count(*) AS n FROM accounts').get().n,0); // tracking cannot credit a protocol balance
});
test('readiness verifies RPC, operator routes require bearer authentication and logs omit secrets',async t=>{
 let online=true;const logs=[];const app=createApplication({dbPath:':memory:',opsToken:'ops-secret',logger:entry=>logs.push(entry),fetchRpc:async(_,options)=>{if(!online)throw new Error('private rpc endpoint');const body=JSON.parse(options.body);return rpcResponse(body.method==='getGenesisHash'?DEVNET_GENESIS:123);}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());const base='http://127.0.0.1:'+app.server.address().port;
 const get=(path,headers)=>fetch(base+path,{headers});assert.equal((await get('/readyz')).status,200);assert.equal((await get('/livez')).status,200);
 const unauth=await get('/api/ops/metrics');assert.equal(unauth.status,401);assert.ok(unauth.headers.get('x-request-id'));assert.match(unauth.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const auth=await get('/api/ops/metrics',{authorization:'Bearer ops-secret'});assert.equal(auth.status,200);assert.match(await auth.text(),/rillvane_queue_pending 0/);
 assert.equal((await get('/api/chain/transactions')).status,401);assert.equal((await get('/api/notifications')).status,401);
 assert.ok(!JSON.stringify(logs).includes('ops-secret'));assert.ok(!JSON.stringify(logs).includes('private rpc'));
 const bad=createApplication({dbPath:':memory:',fetchRpc:async()=>rpcResponse('wrong-network')});assert.equal(await bad.ready(),false);await bad.close();
});

test('worker shutdown waits for its active RPC lease before the database can close',async()=>{
 const db=openDatabase(':memory:');let release;const gate=new Promise(resolve=>release=resolve);let reading=false;
 const worker=createTransactionWorker({db,rpc:{read:async()=>{reading=true;await gate;return {value:[null]};}}});trackTransaction(db,wallet,signature);worker.start();assert.equal(reading,true);
 let stopped=false;const shutdown=worker.stop().then(()=>stopped=true);await Promise.resolve();assert.equal(stopped,false);release();await shutdown;assert.equal(stopped,true);assert.equal(db.prepare('SELECT attempts FROM jobs').get().attempts,1);db.close();
});
