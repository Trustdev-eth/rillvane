import {randomUUID} from 'node:crypto';
import {atomic,audit,maintenance} from './db-util.mjs';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function validSignature(value){
  if(typeof value!=='string'||value.length<64||value.length>88||![...value].every(c=>alphabet.includes(c)))return false;
  let n=0n;for(const c of value)n=n*58n+BigInt(alphabet.indexOf(c));
  let size=0;while(n){n>>=8n;size++;}for(const c of value){if(c!=='1')break;size++;}return size===64;
}
export function trackTransaction(db,wallet,signature,now=Date.now(),requestId){
  if(!validSignature(signature))throw Object.assign(new Error('Enter a valid 64-byte Solana signature.'),{status:422});
  return atomic(db,()=>{
    const prior=db.prepare('SELECT * FROM chain_transactions WHERE wallet=? AND signature=?').get(wallet,signature);if(prior)return prior;
    if(db.prepare("SELECT count(*) AS n FROM jobs WHERE state IN ('queued','leased')").get().n>=1000||db.prepare("SELECT count(*) AS n FROM chain_transactions WHERE wallet=? AND id IN(SELECT transaction_id FROM jobs WHERE state IN ('queued','leased'))").get(wallet).n>=20)throw Object.assign(new Error('Tracking queue is full. Wait for current checks to finish.'),{status:429});
    const id=randomUUID();db.prepare('INSERT INTO chain_transactions(id,wallet,signature,created,updated) VALUES(?,?,?,?,?)').run(id,wallet,signature,now,now);
    db.prepare('INSERT INTO jobs(id,transaction_id,available) VALUES(?,?,?)').run(randomUUID(),id,now);
    audit(db,{event:'transaction.track',wallet,requestId,time:now,detail:{transactionId:id}});
    return db.prepare('SELECT * FROM chain_transactions WHERE id=?').get(id);
  });
}
export const publicTransaction=row=>({id:row.id,signature:row.signature,state:row.state,ownershipVerified:!!row.ownership_verified,slot:row.slot,error:row.error?JSON.parse(row.error):null,created:row.created,updated:row.updated});

// Durable leased work; a crash is retried after the lease. RPC calls never submit funds.
export function createTransactionWorker({db,rpc,now=()=>Date.now(),log=()=>{}}){
  let running=false,stopping=false,timer,maintenanceAt=0,current=Promise.resolve(),heartbeat=0;
  async function tick(){
    if(running||stopping)return;running=true;heartbeat=now();
    try{
      if(now()-maintenanceAt>60000){maintenance(db,now());maintenanceAt=now();}
      for(let i=0;i<8&&!stopping;i++){
        const job=atomic(db,()=>{
          const row=db.prepare("SELECT * FROM jobs WHERE (state='queued' AND available<=?) OR (state='leased' AND lease_until<=?) ORDER BY available LIMIT 1").get(now(),now());if(!row)return null;
          const token=randomUUID();db.prepare("UPDATE jobs SET state='leased',lease_until=?,lease_token=?,attempts=attempts+1 WHERE id=?").run(now()+120000,token,row.id);return {...row,lease_token:token,attempts:row.attempts+1};
        });if(!job)break;
        const tx=db.prepare('SELECT * FROM chain_transactions WHERE id=?').get(job.transaction_id);if(!tx)continue;
        let state='unknown',slot=null,chainError=null,ownership=tx.ownership_verified,terminal=false,jobError=null;
        try{
          const response=await rpc.read('getSignatureStatuses',[[tx.signature],{searchTransactionHistory:true}]);
          if(!response||!Array.isArray(response.value))throw new Error('Malformed signature status.');
          const status=response.value[0];
          if(status&&['confirmed','finalized'].includes(status.confirmationStatus)){
            const detail=await rpc.read('getTransaction',[tx.signature,{encoding:'jsonParsed',commitment:status.confirmationStatus,maxSupportedTransactionVersion:0}]);
            if(detail){
              const keys=detail.transaction?.message?.accountKeys;
              if(!Array.isArray(keys)||!detail.meta||!Number.isSafeInteger(detail.slot))throw new Error('Malformed transaction response.');
              ownership=keys.some(key=>key.pubkey===tx.wallet&&key.signer===true)?1:0;
              if(!ownership){state='rejected';terminal=true;}
              else{slot=detail.slot;chainError=detail.meta.err??null;state=status.confirmationStatus==='finalized'?(chainError?'failed':'finalized'):(chainError?'confirmed_error':'confirmed');terminal=status.confirmationStatus==='finalized';}
            }
          }
        }catch{jobError='Verified RPC read unavailable; no execution outcome inferred.';}
        atomic(db,()=>{
          const lease=db.prepare('SELECT lease_token FROM jobs WHERE id=?').get(job.id);if(lease?.lease_token!==job.lease_token)return;
          const timestamp=now();
          db.prepare('UPDATE chain_transactions SET state=?,ownership_verified=?,slot=?,error=?,updated=? WHERE id=?').run(state,ownership,slot,chainError?JSON.stringify(chainError):null,timestamp,tx.id);
          const exhausted=job.attempts>=12;
          db.prepare('UPDATE jobs SET state=?,available=?,lease_until=NULL,lease_token=NULL,last_error=? WHERE id=?').run(terminal?'done':exhausted?'exhausted':'queued',timestamp+Math.min(60000,1000*2**Math.min(job.attempts,6)),jobError,job.id);
          if(tx.state!==state||exhausted){
            const message=state==='rejected'?'Signature does not include this wallet as a signer.':state==='finalized'?'Transaction finalized.':state==='failed'?'Transaction finalized with an on-chain error.':state==='confirmed_error'?'Transaction has a confirmed error; finality is pending.':state==='confirmed'?'Transaction confirmed; finality is pending.':'Tracking timed out. Outcome remains unknown.';
            db.prepare('INSERT OR IGNORE INTO notifications(wallet,dedupe,kind,message,created) VALUES(?,?,?,?,?)').run(tx.wallet,tx.id+':'+state+':'+(exhausted?'exhausted':'state'),state,message,timestamp);
            audit(db,{event:'transaction.state',wallet:tx.wallet,time:timestamp,detail:{transactionId:tx.id,state,exhausted}});
          }
        });
      }
    }catch{log({level:'error',event:'worker.tick_failed'});}finally{running=false;heartbeat=now();}
  }
  return {tick,start(){if(timer)return;stopping=false;timer=setInterval(()=>{if(!running)current=tick();},1000);timer.unref?.();current=tick();},async stop(){stopping=true;clearInterval(timer);timer=null;await current;},health:()=>({running,heartbeat,pending:db.prepare("SELECT count(*) AS n FROM jobs WHERE state IN ('queued','leased')").get().n,exhausted:db.prepare("SELECT count(*) AS n FROM jobs WHERE state='exhausted'").get().n})};
}
