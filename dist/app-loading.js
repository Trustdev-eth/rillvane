// Startup overlay ends on the first completed live-data attempt.
export function initializeAppLoading(){
 const root=document.querySelector('#app-loader');
 if(!root)return {finish(){}};
 let finished=false,removal;
 const shell=document.querySelector('.app-shell'),mobile=document.querySelector('.mobile-bottom-nav');
 const finish=()=>{
  if(finished)return;finished=true;clearTimeout(slow);
  document.removeEventListener('rillvane:backend',onStatus);
  root.removeEventListener('click',onClick);
  delete document.body.dataset.appLoading;
  if(shell)shell.inert=false;if(mobile)mobile.inert=false;
  root.inert=true;root.setAttribute('aria-hidden','true');root.classList.add('is-leaving');
  const remove=()=>{clearTimeout(removal);root.remove();};
  root.addEventListener('transitionend',event=>{if(event.target===root)remove();},{once:true});
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)remove();else removal=setTimeout(remove,400);
 };
 const onStatus=event=>{if(['online','offline'].includes(event.detail?.status))finish();};
 const onClick=event=>{
  const action=event.target.closest('[data-loader-action]')?.dataset.loaderAction;
  if(action==='continue')finish();if(action==='retry')location.reload();
 };
 const slow=setTimeout(()=>{root.querySelector('.app-loader-recovery').hidden=false;},8000);
 document.addEventListener('rillvane:backend',onStatus);root.addEventListener('click',onClick);
 return {finish};
}
