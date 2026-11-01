import {TOKEN_LAUNCH_AT} from './launch-config.js';

export function countdownParts(deadline,now=Date.now()){
 const target=typeof deadline==='number'?deadline:Date.parse(deadline);
 if(!Number.isFinite(target)||!Number.isFinite(now))throw new TypeError('A valid launch deadline and current time are required.');
 const remaining=Math.max(0,Math.ceil((target-now)/1000));
 return {hours:Math.floor(remaining/3600),minutes:Math.floor(remaining/60)%60,seconds:remaining%60,complete:remaining===0};
}

export function initializeLaunchCountdown(root=document,{deadline=TOKEN_LAUNCH_AT,now=()=>Date.now()}={}){
 const panel=root.querySelector('[data-launch-countdown]');
 if(!panel)return ()=>{};
 const label=panel.querySelector('.launch-countdown-label'),clock=panel.querySelector('[role="timer"]'),note=panel.querySelector('.launch-countdown-note'),time=panel.querySelector('time');
 let target;
 try{target=Date.parse(deadline);countdownParts(target,now());}
 catch{label.textContent='Launch time to be announced';clock.hidden=true;note.hidden=true;return ()=>{};}
 time.dateTime=new Date(target).toISOString();
 time.textContent=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC',timeZoneName:'short'}).format(target);
 time.title=new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'long'}).format(target);
 let interval;
 const update=()=>{
  const parts=countdownParts(target,now());
  if(parts.complete){
   label.textContent='Scheduled launch time reached';clock.hidden=true;
   note.textContent='Follow Twitter / X for launch updates.';
   panel.dataset.state='complete';clearInterval(interval);return;
  }
  for(const unit of ['hours','minutes','seconds']){
   const value=String(parts[unit]).padStart(2,'0'),node=panel.querySelector('[data-countdown="'+unit+'"]');
   if(node.textContent!==value)node.textContent=value;
  }
  clock.setAttribute('aria-label',parts.hours+' hours, '+parts.minutes+' minutes, '+parts.seconds+' seconds until the scheduled RLVN token launch');
 };
 update();if(panel.dataset.state!=='complete')interval=setInterval(update,1000);
 document.addEventListener('visibilitychange',update);
 const stop=()=>{clearInterval(interval);document.removeEventListener('visibilitychange',update);};
 window.addEventListener('pagehide',event=>{if(!event.persisted)stop();},{once:true});
 return stop;
}
