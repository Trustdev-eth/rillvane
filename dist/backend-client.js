import {setBusy} from './app-motion.js';
let revision=0, wallet=null, noticeCursor=0, polling=false, provider=null;
let streamSocket=null, streamSeq=0, streamLive=false, streamTimer=null, streamClosed=false, streamHandlers=null;
let apiStatus='connecting';
export const backendSession = () => wallet;
export const walletProvider = () => provider;
export const streamConnected = () => streamLive;
export const backendStatus = () => apiStatus;

function setApiStatus(status){
  apiStatus=status;
  document.body.dataset.backendStatus=status;
  const label=document.querySelector('#backend-status');
  if(label)label.textContent=status==='online'?'Live data':status==='connecting'?'Connecting':'Offline';
  const notice=document.querySelector('#backend-notice');
  if(notice)notice.hidden=status!=='offline';
  document.dispatchEvent(new CustomEvent('rillvane:backend',{detail:{status}}));
}

async function request(path, body, extra={}) {
  const response=await fetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(10000),...extra,...(body?{method:'POST',headers:{'content-type':'application/json',...extra.headers},body:JSON.stringify(body)}:{})});
  let result;
  try{result=await response.json();}catch{throw new Error('The app API is unavailable. Open the app from the backend server.');}
  if(!response.ok){
    const error=new Error(result.error||'Request failed.');
    error.status=response.status;error.code=result.code;throw error;
  }
  return result;
}

function adopt(account,onAccount) {
  revision=account.revision;
  wallet=account.wallet;
  onAccount(account.state);
}

export async function loadPortfolio(onAccount) {
  const account=await request('/api/account');
  adopt(account,onAccount);
  return account;
}

export async function quoteAction(kind, body) {
  return request('/api/v1/quotes/'+kind, body);
}

function injectedProvider() {
  return window.phantom?.solana||window.solflare||window.solana||null;
}

function providerAddress(target=provider) {
  try{
    const key=target?.publicKey;
    if(!key) return null;
    return typeof key.toString==='function'?key.toString():String(key);
  }catch{return null;}
}

function waitForProvider(ms=3000) {
  const found=injectedProvider();
  if(found) return Promise.resolve(found);
  return new Promise(resolve=>{
    const finish=value=>{clearInterval(timer);clearTimeout(limit);resolve(value||injectedProvider());};
    const timer=setInterval(()=>{const next=injectedProvider();if(next)finish(next);},80);
    const limit=setTimeout(()=>finish(null),ms);
  });
}

let boundProvider=null, signingOut=false;

function bindWalletEvents(target) {
  if(!target?.on||target===boundProvider) return;
  boundProvider=target;
  target.on('disconnect',()=>{
    if(signingOut||!wallet) return;
    sessionNotify('Wallet disconnected.',{tone:'info'});
    signOut().catch(()=>{});
  });
  target.on('accountChanged',publicKey=>{
    const next=publicKey?(publicKey.toString?publicKey.toString():String(publicKey)):null;
    if(!next){if(!signingOut&&wallet)signOut().catch(()=>{});return;}
    if(next===wallet) return;
    verifyCurrentWallet(next).then(()=>sessionNotify('Wallet account updated.',{tone:'success'})).catch(error=>{
      sessionNotify(error.message,{tone:'error'});
      signOut().catch(()=>{});
    });
  });
}

async function attachProvider({trustedOnly=false}={}) {
  const injected=injectedProvider();
  if(!injected){provider=null;return null;}
  provider=injected;
  bindWalletEvents(injected);
  const current=providerAddress(injected);
  if(current&&(!wallet||current===wallet)) return current;
  if(!injected.connect) return current;
  try{
    const connection=await injected.connect(trustedOnly?{onlyIfTrusted:true}:undefined);
    const key=connection?.publicKey||injected.publicKey;
    return key?(key.toString?key.toString():String(key)):providerAddress(injected);
  }catch(error){
    if(trustedOnly) return providerAddress(injected);
    const msg=String(error?.message||error||'');
    if(/reject|cancel|denied/i.test(msg)) throw new Error('Wallet connection was cancelled.');
    throw error instanceof Error?error:new Error(msg);
  }
}

async function verifyCurrentWallet(address) {
  if(!provider?.signMessage) throw new Error('Unlock your Solana wallet to continue.');
  const challenge=await request('/api/auth/challenge',{wallet:address});
  const signed=await provider.signMessage(new TextEncoder().encode(challenge.message),'utf8');
  const bytes=signed.signature||signed,signature=btoa(String.fromCharCode(...bytes));
  adopt(await request('/api/auth/verify',{nonce:challenge.nonce,signature}), sessionOnAccount||(()=>{}));
  paintWalletChip();
  reconnectMarketStream();
  return wallet;
}

async function ensureSigner() {
  if(provider?.signMessage&&(!wallet||providerAddress()===wallet)) return provider;
  await waitForProvider(1200);
  let address=await attachProvider({trustedOnly:true});
  if(provider?.signMessage&&(!wallet||address===wallet)) return provider;
  address=await attachProvider({trustedOnly:false});
  if(!provider?.signMessage) throw new Error('Unlock Phantom or Solflare to sign this order.');
  if(wallet&&address&&address!==wallet) await verifyCurrentWallet(address);
  if(wallet&&address&&address!==wallet) throw new Error('Switch back to the connected wallet to sign.');
  return provider;
}

export async function signBytes(bytes) {
  await ensureSigner();
  const signed=await provider.signMessage(bytes,'utf8');
  const raw=signed.signature||signed;
  return btoa(String.fromCharCode(...raw));
}

export async function submitIntent(body, onAccount) {
  await ensureSigner();
  const intent=await request('/api/v1/intents', body, {headers:{'Idempotency-Key':crypto.randomUUID()}});
  const prepared=await request('/api/v1/intents/'+intent.id+'/prepare', {});
  const bytes=Uint8Array.from(atob(prepared.unsignedBytes), c=>c.charCodeAt(0));
  let signedTransaction;
  if(prepared.transaction){
    if(!provider?.signTransaction)throw new Error('This instruction requires a wallet that supports transaction signing.');
    const {Transaction,VersionedTransaction}=await import('./vendor/solana-wallet.js');
    const wire=Uint8Array.from(atob(prepared.transaction), c=>c.charCodeAt(0));
    let transaction;
    try{transaction=Transaction.from(wire);}catch{transaction=VersionedTransaction.deserialize(wire);}
    const signed=await provider.signTransaction(transaction);
    if(!signed?.serialize)throw new Error('The wallet did not return a signed transaction.');
    signedTransaction=btoa(String.fromCharCode(...signed.serialize()));
  }
  const signature=await signBytes(bytes);
  const result=await request('/api/v1/intents/'+intent.id+'/submission', {signature, signedTransaction});
  if(onAccount) await loadPortfolio(onAccount);
  return result;
}

export async function claimFaucet(asset, amount, onAccount) {
  await ensureSigner();
  const intent=await request('/api/v1/faucet/claims', {asset, amountIn: amount}, {headers:{'Idempotency-Key':crypto.randomUUID()}});
  const prepared=await request('/api/v1/intents/'+intent.id+'/prepare', {});
  const bytes=Uint8Array.from(atob(prepared.unsignedBytes), c=>c.charCodeAt(0));
  const signature=await signBytes(bytes);
  const result=await request('/api/v1/intents/'+intent.id+'/submission', {signature});
  if(onAccount) await loadPortfolio(onAccount);
  return result;
}

export async function fetchMarkets(){return request('/api/v1/markets');}
export async function fetchPool(){return request('/api/v1/pool');}
export async function fetchTrades(){return request('/api/v1/trades');}
export async function fetchCandles(interval='1h',options={}){const params=new URLSearchParams({interval});if(options.end!=null)params.set('end',String(options.end));if(options.count!=null)params.set('count',String(options.count));return request('/api/v1/candles?'+params);}
export async function fetchActivity(){return request('/api/v1/me/activity');}
export async function fetchFaucet(){return request('/api/v1/faucet/claims');}

export function setStreamView({interval}={}) {
  if(interval && streamHandlers) streamHandlers.interval=interval;
  if(streamSocket?.readyState===1 && interval) streamSocket.send(JSON.stringify({op:'subscribe',interval}));
}

export function reconnectMarketStream() {
  streamSeq=0;
  if(streamSocket && streamSocket.readyState<2) streamSocket.close();
}

function connectMarketStream(handlers) {
  streamHandlers=handlers;
  if(streamClosed) return;
  const proto=location.protocol==='https:'?'wss:':'ws:';
  const socket=new WebSocket(proto+'//'+location.host+'/api/v1/stream');
  streamSocket=socket;
  socket.addEventListener('open',()=>{
    socket.send(JSON.stringify({
      op:'hello',
      lastSeq:streamSeq,
      interval:handlers.interval||'1h',
      topics:['market','pool','token','trades','candles','account','notices']
    }));
  });
  socket.addEventListener('message',ev=>{
    let msg; try{msg=JSON.parse(ev.data);}catch{return;}
    if(Number.isFinite(msg.seq)) streamSeq=msg.seq;
    streamLive=true;
    handlers.onStream?.(msg);
    if(msg.type==='snapshot' && msg.account?.state){
      adopt({wallet:msg.account.wallet,state:msg.account.state,revision:Number(msg.account.state.nonce||0)}, handlers.onAccount);
    }
    if(msg.type==='delta' && msg.topic==='account' && msg.payload?.state){
      adopt({wallet:msg.payload.wallet,state:msg.payload.state,revision:Number(msg.payload.state.nonce||0)}, handlers.onAccount);
    }
    if(msg.type==='delta' && msg.topic==='notices' && msg.payload && !msg.payload.read_at){
      handlers.notify?.(msg.payload.message,{
        tone:['failed','rejected','liquidated'].includes(msg.payload.kind)?'error':msg.payload.kind==='finalized'||msg.payload.kind==='applied'?'success':'info',
        title:'Transaction'
      });
      noticeCursor=Math.max(noticeCursor, msg.payload.id||0);
      request('/api/notifications/read',{id:msg.payload.id}).catch(()=>{});
    }
  });
  socket.addEventListener('close',()=>{
    streamLive=false;
    if(streamSocket===socket) streamSocket=null;
    if(!streamClosed) streamTimer=setTimeout(()=>connectMarketStream(handlers),1500);
  });
  socket.addEventListener('error',()=>{ try{socket.close();}catch{} });
}

function paintWalletChip() {
  document.querySelectorAll('.backend-connect').forEach(el=>el.remove());
  const chip=document.querySelector('#header-account');
  const label=document.querySelector('#header-account-label');
  const short=wallet?wallet.slice(0,4)+'…'+wallet.slice(-4):'Connect wallet';
  if(label) label.textContent=short;
  chip?.classList.toggle('wallet-on',!!wallet);
  chip?.toggleAttribute('data-connected',!!wallet);
  chip?.setAttribute('aria-label', wallet?'Account '+short:'Connect wallet');
  const balances=document.querySelector('#header-balances');
  if(balances){balances.hidden=false;balances.toggleAttribute('data-empty',!wallet);}
  document.dispatchEvent(new Event('rillvane:session'));
}

let sessionNotify=()=>{}, sessionOnAccount=null, connecting=false;

export async function connectWallet() {
  if(connecting) return wallet;
  if(wallet&&provider?.signMessage&&providerAddress()===wallet) return wallet;
  const chip=document.querySelector('#header-account');
  connecting=true;
  chip?.classList.add('is-busy');
  chip?.setAttribute('aria-busy','true');
  try{
    const address=await attachProvider({trustedOnly:false});
    if(!address||!provider?.signMessage)throw new Error('Install a Solana wallet that supports message signing.');
    if(wallet&&address===wallet){
      paintWalletChip();
      return wallet;
    }
    await verifyCurrentWallet(address);
    sessionNotify('Wallet connected.',{tone:'success'});
    return wallet;
  }catch(error){
    sessionNotify(error.message,{tone:'error'});
    throw error;
  }finally{
    connecting=false;
    chip?.classList.remove('is-busy');
    chip?.removeAttribute('aria-busy');
    paintWalletChip();
  }
}

export async function signOut() {
  if(signingOut) return;
  signingOut=true;
  try{await request('/api/auth/logout',{});}catch{}
  wallet=null;provider=null;
  location.reload();
}

export async function openChainWallet() {
  if(!wallet) return;
  const balance=await request('/api/wallet');
  window.dispatchEvent(new CustomEvent('rillvane:wallet-panel',{detail:{wallet,sol:balance.sol.toFixed(4),mount:mountWalletPanel}}));
}

export async function initializeBackend({onAccount, notify, onMarket, onStream, interval}) {
  sessionNotify=notify||(()=>{});
  sessionOnAccount=onAccount||null;
  let syncing=false,streamStarted=false;
  async function sync(){
    if(syncing||document.hidden)return;
    syncing=true;
    try{
      const health=await request('/api/health');
      if(!health.ok)throw new Error('API unavailable.');
      const candleInterval=streamHandlers?.interval||interval||'1h';
      const [markets,pool,trades,candles]=await Promise.all([
        fetchMarkets(),
        fetchPool(),
        fetchTrades(),
        streamLive?Promise.resolve({items:[],interval:candleInterval}):fetchCandles(candleInterval,{count:64})
      ]);
      onMarket?.(markets.items[0],pool,trades.items||[],candles.items||[],candles.interval);
      setApiStatus('online');
      if(!streamStarted){streamStarted=true;connectMarketStream({onAccount,notify,onMarket,onStream,interval:interval||'1h'});}
      if(!streamLive){
        try{adopt(await request('/api/account'),onAccount);}catch(error){
          if(error.status===401&&wallet){wallet=null;onAccount?.(null);paintWalletChip();}
        }
      }
    }catch{setApiStatus('offline');}
    finally{syncing=false;}
  }
  await sync();
  const syncTimer=setInterval(sync,10000);
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('pagehide',()=>{clearInterval(syncTimer);document.removeEventListener('visibilitychange',sync);},{once:true});
  window.addEventListener('pagehide',()=>{streamClosed=true;clearTimeout(streamTimer);try{streamSocket?.close();}catch{}},{once:true});
  paintWalletChip();
  if(wallet) waitForProvider().then(()=>attachProvider({trustedOnly:true})).catch(()=>{});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden||!wallet)return;
    if(provider?.signMessage&&providerAddress()===wallet)return;
    attachProvider({trustedOnly:true}).catch(()=>{});
  });
  async function pollNotices(){
    if(!wallet||polling||document.hidden||streamLive)return;polling=true;
    try{
      const result=await request('/api/notifications?after='+noticeCursor);
      for(const item of result.items){
        if(!item.read_at){
          notify(item.message,{tone:['failed','rejected','liquidated'].includes(item.kind)?'error':item.kind==='finalized'||item.kind==='applied'?'success':'info',title:'Transaction'});
          await request('/api/notifications/read',{id:item.id});
        }
        noticeCursor=item.id;
      }
      document.dispatchEvent(new Event('rillvane:chain-update'));
    }catch{}
    finally{polling=false;}
  }
  const pollTimer=setInterval(pollNotices,10000);
  window.addEventListener('pagehide',()=>clearInterval(pollTimer),{once:true});
  document.addEventListener('visibilitychange',pollNotices);
  pollNotices();
}

function mountWalletPanel(root){
  const list=root.querySelector('#chain-transactions'),status=root.querySelector('#chain-status'),button=root.querySelector('#track-chain-transaction');
  let active=true;
  const update=async()=>{
    if(!root.isConnected||!document.querySelector('#workspace-modal')?.open){active=false;document.removeEventListener('rillvane:chain-update',update);return;}
    try{
      const result=await request('/api/chain/transactions');
      if(!active)return;
      list.replaceChildren();
      if(!result.items.length){status.textContent='No transactions tracked yet.';return;}
      status.textContent='Latest tracked signatures';
      for(const item of result.items){
        const row=document.createElement('div');row.className='chain-row';row.dataset.state=item.state;
        const signature=document.createElement('code'),state=document.createElement('strong'),note=document.createElement('small');
        signature.textContent=item.signature.slice(0,12)+'…'+item.signature.slice(-8);signature.title=item.signature;
        state.textContent=item.state.replaceAll('_',' ');
        note.textContent=item.ownershipVerified?'Wallet signer verified · '+(item.slot?'Slot '+item.slot:'Awaiting finality'):'Signer verification pending';
        if(item.state==='rejected')note.textContent='This wallet is not a signer of this transaction.';
        row.append(signature,state,note);list.append(row);
      }
    }catch(error){status.textContent=error.message;}
  };
  button.addEventListener('click',async()=>{
    setBusy(button,true,'Adding to tracking queue…');
    try{
      await request('/api/chain/transactions',{signature:root.querySelector('#chain-signature').value.trim()});
      root.querySelector('#chain-signature').value='';
      await update();
    }catch(error){status.textContent=error.message;}
    finally{setBusy(button,false);}
  });
  document.addEventListener('rillvane:chain-update',update);update();
}
