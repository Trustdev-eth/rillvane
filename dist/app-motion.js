// Motion conveys changes in state. It never invents ticks or delays an API result.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const groups = '.trade-side,.tabs,.desk-tabs,.range-switch,.credit-tabs,.setting-pills,.order-type-tabs,.chart-pref-layout nav';
let animations = [], chartKey = '', toastSequence = 0;
const run = (el, frames, options) => {
  if (!el || reduced()) return;
  const animation = el.animate(frames, {duration:220, easing:'cubic-bezier(.2,.7,.2,1)', ...options});
  animations.push(animation);
  animation.finished.catch(()=>{}).finally(()=>{animations=animations.filter(a=>a!==animation);});
};
export function captureMotion(root=document) {
  return [...root.querySelectorAll(groups)].map(group=>{
    const selected=group.querySelector('button.active');
    return selected?{key:selected.dataset.action,rect:selected.getBoundingClientRect(),value:selected.dataset.value}:null;
  }).filter(Boolean);
}
export function moveIndicator(group, {immediate=false}={}) {
  if(!group)return;
  const selected=group.querySelector('button.active');
  if(!selected)return;
  group.classList.add('motion-group');
  let indicator=group.querySelector('.motion-indicator');
  if(!indicator){
    indicator=document.createElement('span');
    indicator.className='motion-indicator';
    indicator.setAttribute('aria-hidden','true');
    group.append(indicator);
    immediate=true;
  }
  if(immediate)group.classList.add('no-indicator-motion');
  Object.assign(indicator.style,{
    left:selected.offsetLeft+'px',
    top:selected.offsetTop+'px',
    width:selected.offsetWidth+'px',
    height:selected.offsetHeight+'px'
  });
  if(immediate)requestAnimationFrame(()=>group.classList.remove('no-indicator-motion'));
}
export function finishRender({changed=false}={}) {
  if (changed) {
    animations.forEach(a=>a.cancel());
    run(document.querySelector('#main-content'),[{opacity:.25,transform:'translateY(9px)'},{opacity:1,transform:'translateY(0)'}],{duration:280});
    [...document.querySelectorAll('#main-content>.summary-grid>.summary-card,#main-content>.vault-cards>.vault-card')].slice(0,6).forEach((el,i)=>run(el,[{opacity:0,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],{duration:240,delay:i*25}));
  }
  document.querySelectorAll(groups).forEach(group=>moveIndicator(group,{immediate:true}));
  document.documentElement.classList.add('app-hydrated');
}
export function animateChart(key) {
  if(key===chartKey)return;chartKey=key;
  const svg=document.querySelector('.terminal-chart-svg');
  run(svg,[{opacity:.3,transform:'translateX(7px)'},{opacity:1,transform:'translateX(0)'}],{duration:300});
  svg?.querySelectorAll('[data-candle]').forEach((el,i)=>run(el,[{opacity:0},{opacity:1}],{duration:160,delay:Math.min(i*3,180)}));
}
export function setBusy(button,busy,label='Processing…') {
  if(!button)return;
  if(busy){button.dataset.idleLabel=button.textContent;button.textContent=label;button.setAttribute('aria-busy','true');button.disabled=true;}
  else{button.textContent=button.dataset.idleLabel||button.textContent;button.removeAttribute('aria-busy');button.disabled=false;}
}
export function showNotification(message,{tone='info',title}={}) {
  const region=document.querySelector('#toast');if(!region)return;
  const headingText=title||(tone==='error'?'Action needs attention':tone==='success'?'Workspace updated':'Workspace');
  for(const existing of [...region.querySelectorAll('.app-toast')]){
    if(existing.querySelector('p')?.textContent===message) existing.remove();
  }
  const toast=document.createElement('div'),id=++toastSequence;
  toast.className='app-toast';toast.dataset.tone=tone;toast.dataset.noticeId=id;
  const mark=document.createElement('span');mark.className='toast-mark';mark.textContent=tone==='error'?'!':tone==='success'?'✓':'i';mark.setAttribute('aria-hidden','true');
  const copy=document.createElement('div'),heading=document.createElement('strong'),text=document.createElement('p');
  heading.textContent=headingText;text.textContent=message;copy.append(heading,text);
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='toast-dismiss';dismiss.setAttribute('aria-label','Dismiss notification');dismiss.textContent='×';
  const progress=document.createElement('span');progress.className='toast-progress';progress.setAttribute('aria-hidden','true');toast.append(mark,copy,dismiss,progress);region.append(toast);
  const remove=()=>{clearTimeout(timer);toast.classList.add('toast-out');if(reduced())toast.remove();else setTimeout(()=>toast.remove(),180);};
  let timer=setTimeout(remove,6500);dismiss.onclick=remove;
  toast.onpointerenter=toast.onfocusin=()=>{clearTimeout(timer);toast.classList.add('toast-paused');};
  toast.onpointerleave=toast.onfocusout=()=>{timer=setTimeout(remove,6500);toast.classList.remove('toast-paused');};
  while(region.children.length>3)region.firstElementChild.remove();
}
export function animateModal(dialog){run(dialog,[{opacity:0,transform:'translateY(9px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:220});}
export function initializeMotion(){
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.classList.contains('icon-button')||button.closest('.main-nav,.chart-tools,.sidebar,.desk-tabs,.trade-side,.tabs,.order-percent'))return;
    run(button,[{translate:'0 0'},{translate:'0 1px'},{translate:'0 0'}],{duration:160});
  },{capture:true});
  let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>finishRender());});document.fonts?.ready.then(()=>finishRender());
  const media=matchMedia('(prefers-reduced-motion: reduce)');media.addEventListener('change',()=>{if(media.matches)animations.forEach(a=>a.cancel());});
}
