import {setupProtocolNotes,updateProtocolNotes} from './protocol-notes.js';
import {initializeSiteLinks} from './site-links.js';
import {initializeLaunchCountdown} from './launch-countdown.js';
import * as T from './vendor/three.module.js';
import {loadBuffer} from './buffer.js';
import {TitleSurface} from './title-surface.js';
import {FogTrail} from './fog-trail.js';

const $ = s => document.querySelector(s);
initializeSiteLinks();
initializeLaunchCountdown();
const clamp = v => Math.max(0, Math.min(1, v));
const fit = (v,a,b) => clamp((v-a)/(b-a));
const smooth = v => v*v*(3-2*v);
const envelope = (v,a,b,c,d) => fit(v,a,b)*(1-fit(v,c,d));
let canvas = $('#landscape');
const titleSurface=new TitleSurface($('#hero-title'),$('#title-surface'));
const titlePointer={x:0,y:0,active:false};
const summitFog=new FogTrail($('.summit-fog'));
const camera = new T.PerspectiveCamera(29,1,1,5000);
const titleCamera = new T.PerspectiveCamera(29,1,1,5000);
const titlePoint = new T.Vector3();
const q1 = new T.Quaternion(), q2 = new T.Quaternion(), p1 = new T.Vector3(), p2 = new T.Vector3();
const euler = new T.Euler(), matrix = new T.Matrix4();
const birdLocal = new T.Matrix4(), birdProjection = new T.Matrix4(), unitScale = new T.Vector3(1,1,1);
const scenes = [...document.querySelectorAll('.scene')];
const nav = [...document.querySelectorAll('.chapter-nav button')];
const roles = [...document.querySelectorAll('.role')];
const paths = Object.fromEntries(['pool','flows','redefined'].map(name=>[name,[...document.querySelectorAll(`.${name} .draw`)]]));
const ui = Object.fromEntries(['hero-kicker','hero-title-wrap','hero-intro','word-one','word-pool','pool-subtitle','pool-description','pool-emblem','flows-heading','flows-description','flow-mark','everyone-kicker','redefined-emblem','horizon-inner','join-content','scroll-invitation'].map(n=>[n,$('.'+n)]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let width = innerWidth, height = innerHeight, mobile = width < 768, pixelRatio = Math.min(devicePixelRatio || 1, 2);
let y = scrollY / height, ready = false, engine, worker, workerBusy = false, lastWorker = 0, firstRender = false;
let startTime = 0, previousTime = 0, pointerX = 0, pointerY = 0, mouseX=0,mouseY=0;
let playing = false, travel = null, titleEntry = 0, currentChapter = -1;
let cameraSummit,cameraLake,birdPath,trailSpline;
let flowLayout = null;
const menu = $('#chapter-menu'), tour = $('#tour-toggle');

function progress(p) {
  const track=$('.loader-line');
  const v = Math.max(Number(track.getAttribute('aria-valuenow'))||0,Math.round(clamp(p)*100));
  $('#loader-percent').textContent = `${v}%`;
  track.setAttribute('aria-valuenow',String(v));
  $('#loader').style.setProperty('--load-progress',String(v));
}
function show(el, amount, blur = 0) {
  amount = clamp(amount);
  el.style.opacity = amount;
  el.style.visibility = amount > .001 ? 'visible' : 'hidden';
  if(blur) el.style.filter = `blur(${(1-amount)*blur}px)`;
}
function sceneVisibility(index, amount) {
  show(scenes[index],amount);
  const hidden = amount < .02;
  if(scenes[index].getAttribute('aria-hidden') !== String(hidden)) {
    scenes[index].setAttribute('aria-hidden',String(hidden));
    scenes[index].inert = hidden;
  }
}
function resize() {
  const oldHeight = height, unit = scrollY / oldHeight;
  width=innerWidth; height=innerHeight; mobile=width<768; pixelRatio=Math.min(devicePixelRatio||1,2);
  flowLayout=null;
  document.documentElement.style.setProperty('--vh',`${height/100}px`);
  $('#scroll-space').style.height = `${height*20.75}px`;
  camera.aspect=width/height; camera.updateProjectionMatrix();
  if(engine)engine.resize(width,height,pixelRatio);
  else { canvas.width=width; canvas.height=height; }
  if(worker) worker.postMessage({type:'resize',width:Math.min(width,960),height:Math.round(Math.min(width,960)*height/width)});
  if(ready && Math.abs(oldHeight-height)>10) {window.scrollTo(0,unit*height);y=unit;}
}
function applyTrack(track,ratio,out=camera) {
  const a=track.attributes, n=a.position.count, frame=clamp(ratio)*n, i=Math.min(n-1,Math.floor(frame)),j=Math.min(n-1,i+1),t=frame-i;
  p1.fromArray(a.position.array,i*3); p2.fromArray(a.position.array,j*3);
  out.position.copy(p1.lerp(p2,t));
  q1.fromArray(a.orient.array,i*4);q2.fromArray(a.orient.array,j*4);
  out.quaternion.copy(q1.slerp(q2,t));
  const focal=mobile?a.mobileFocal.array:a.focal.array;
  const f=focal[i]+(focal[j]-focal[i])*t;
  out.fov=2*Math.atan((mobile?82.8428:20.7107)/2/f)*180/Math.PI;
  return (a.dist.array[i]+(a.dist.array[j]-a.dist.array[i])*t)*.5;
}
function cameraState(unit,time) {
  const summit=clamp(unit/7),river=clamp((unit-7)/6.75),lake=clamp((unit-16.5)/2);
  let group=unit<7?0:unit<14.5?1:2, distance;
  if(group===0) {
    distance=applyTrack(cameraSummit,summit);
    const intro=1-Math.pow(1-fit(time,.2,2),3);
    camera.fov+=5*(1-intro);camera.translateZ(-200*(1-intro));
  } else if(group===1) {
    distance=300;
    const view=250*height/width,span=1500-view*2;
    camera.position.set(span/2-span*river,150,0);
    camera.rotation.set(-Math.PI/2,0,-Math.PI/2);
    camera.fov=2*Math.atan(view/2/150)*180/Math.PI;
  } else distance=applyTrack(cameraLake,lake);
  // Mouse movement only affects the view; interface controls stay in place.
  const damping=1-Math.exp(-.1*60/60);
  pointerX+=(mouseX-pointerX)*damping;pointerY+=(mouseY-pointerY)*damping;
  if(!reducedMotion) {
    camera.translateZ(-distance);
    euler.set(pointerY*.009+Math.sin(time*.31)*.0012,-pointerX*.009+Math.sin(time*.21)*.0015,0);
    q1.setFromEuler(euler);camera.quaternion.multiply(q1);camera.translateZ(distance);
  }
  camera.updateProjectionMatrix();camera.updateMatrixWorld();
  matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  const dim=envelope(unit,1.25,1.75,4.5,5.5);
  const everyone=fit(unit,9.05,13.75),h=envelope(everyone,0,.15,.85,1);
  const roleWeights=[h*(1-fit(everyone,.18,.3333)),h*fit(everyone,.3333,.48)*(1-fit(everyone,.51,.6666)),h*fit(everyone,.6666,.81)];
  let birdModel=null,birdMatrix=null;
  const birdT=(summit*449-19)/168;
  if(group===0&&birdT>=0&&birdT<=1){
    const a=birdPath.attributes,f=birdT*(a.position.count-1),i=Math.floor(f),j=Math.min(i+1,a.position.count-1);
    p1.fromArray(a.position.array,i*3);p2.fromArray(a.position.array,j*3);p1.lerp(p2,f-i);
    q1.fromArray(a.orient.array,i*4);q2.fromArray(a.orient.array,j*4);q1.slerp(q2,f-i);
    birdLocal.compose(p1,q1,unitScale);birdProjection.multiplyMatrices(camera.projectionMatrix,birdLocal);
    birdModel=Array.from(birdLocal.elements);birdMatrix=Array.from(birdProjection.elements);
  }
  return {group,matrix:Array.from(matrix.elements),dim,trail:fit(unit,1.45,5.5),trailActive:1-smooth(fit(unit,4.5,5.5)),roleWeights,time,unit,summit,river,lake,birdModel,birdMatrix,birdFrame:(unit*2+2)*30};
}
function drawEmblem(which,ratio,fade=1) {
  paths[which].forEach((p,i)=>{const r=fit(ratio,i*.07,.8+i*.07);p.style.strokeDashoffset=850*(1-r);p.style.opacity=fade;});
}
function measureFlowLayout() {
  const top=$('.site-header').getBoundingClientRect().bottom+20;
  const bottom=$('.journey-footer').getBoundingClientRect().top-20;
  const titleHeight=ui['flows-heading'].offsetHeight;
  const shapeSize=$('.flows-emblem').offsetHeight;
  const copyHeight=ui['flows-description'].offsetHeight;
  const naturalGap=mobile?24:height<=650?20:32;
  const scale=Math.min(1,Math.max(1,bottom-top)/(titleHeight+shapeSize+copyHeight+2*naturalGap));
  const title=titleHeight*scale,shape=shapeSize*scale,copy=copyHeight*scale,gap=naturalGap*scale;
  const minimumCenter=top+title+gap+shape/2;
  const maximumCenter=bottom-copy-gap-shape/2;
  const center=Math.max(minimumCenter,Math.min(maximumCenter,height*(mobile?.54:height<=650?.6:.58)));
  const titleStart=height*(mobile?.48:.5)-title/2;
  return {scale,titleStart,titleEnd:center-shape/2-gap-title,shapeCenter:center,
    copyStart:Math.min(bottom-copy,titleStart+title+gap),copyEnd:center+shape/2+gap};
}
function renderTitle(state,time,dt) {
  if(state.group!==0||state.summit>.233)return;
  // Keep the title facing the camera until the reference's 0.112 anchor point.
  // It then stays in the landscape while the actual camera travels past it.
  applyTrack(cameraSummit,Math.min(.112,state.summit),titleCamera);
  titleCamera.aspect=width/height;titleCamera.updateMatrixWorld();
  const title=$('#hero-title'),tw=title.offsetWidth,th=title.offsetHeight;
  const distance=850+150*fit(state.summit,.056,.112);
  const pixel=2*distance*Math.tan(titleCamera.fov*Math.PI/360)/height;
  const top=height*(mobile?.38:.36),center=top+th/2;
  const corners=[[-tw/2,height/2-center+th/2],[tw/2,height/2-center+th/2],[tw/2,height/2-center-th/2],[-tw/2,height/2-center-th/2]].map(([x,y])=>{
    titlePoint.set(x*pixel,y*pixel,-distance).applyMatrix4(titleCamera.matrixWorld).project(camera);
    return [(titlePoint.x*.5+.5)*width,(-titlePoint.y*.5+.5)*height];
  });
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=corners;
  const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
  const denominator=dx1*dy2-dx2*dy1;
  if(Math.abs(denominator)<.0001||!tw||!th)return;
  const g=(dx3*dy2-dx2*dy3)/denominator,h=(dx1*dy3-dx3*dy1)/denominator;
  const a=(x1-x0+g*x1)/tw,b=(x3-x0+h*x3)/th,d=(y1-y0+g*y1)/tw,e=(y3-y0+h*y3)/th;
  ui['hero-title-wrap'].style.cssText='inset:0;top:0;left:0;text-align:left;perspective:none;transform:none;';
  title.style.position='absolute';title.style.left='0';title.style.top='0';title.style.transformOrigin='0 0';
  const titleMatrix=`matrix3d(${a},${d},0,${g/tw},${b},${e},0,${h/th},0,0,1,0,${x0},${y0},0,1)`;
  title.style.transform=titleMatrix;
  const fill=fit(time,1.3,2.8),outline=fit(time,.5,1.5)*(1-fit(time,2.6,3.5));
  title.style.opacity=fit(time,.5,1.5)*(1-fit(state.summit,.218,.233));
  title.style.color=`rgba(251,255,244,${fill})`;
  title.style.webkitTextStroke=`${outline*.7}px rgba(251,255,244,.8)`;
  title.style.filter='none';
  const depth=fit(state.summit,.112,.212)*9;
  title.style.textShadow=depth>.1?Array.from({length:8},(_,i)=>`${(i+1)*depth/8}px ${(i+1)*depth*.25/8}px 0 rgba(${218-i*12},${227-i*11},${218-i*10},${fill})`).join(','):'none';
  titleSurface.render({width:tw,height:th,dpr:pixelRatio,matrix:titleMatrix,homography:[a,b,d,e,g/tw,h/th,x0,y0],pointer:titlePointer,time,dt,opacity:fit(time,.5,1.5)*(1-fit(state.summit,.218,.233)),depth});
}
function renderUI(unit,time,dt) {
  const intro=fit(time,.5,2.4);
  sceneVisibility(0,1-fit(unit,1.4,1.7));
  show(ui['hero-kicker'],envelope(unit,-1,-.5,1.15,1.65)*intro,4);
  const depart=fit(unit,.78,1.63);
  ui['hero-title-wrap'].style.transform=`translate3d(${-depart*width*.5}px,${-depart*height*.12}px,0)`;
  const title=$('#hero-title');
  title.style.transform=`rotateY(${depart*35}deg) rotateX(${depart*-8}deg) scale(${1+depart*.35})`;
  title.style.opacity=intro*(1-depart);title.style.filter=`blur(${(1-intro)*5}px)`;
  show(ui['hero-intro'],(1-fit(unit,.05,.6))*intro);
  show(ui['scroll-invitation'],(1-fit(unit,.05,.4))*intro);

  const pool=fit(unit,1,7),poolOn=envelope(pool,.14,.23,.76,.85),split=envelope(pool,.3,.4,.66,.76);
  sceneVisibility(1,pool>0&&pool<1?1:0);
  const drift=(1-poolOn+fit(pool,.92,1))*110;
  ui['word-one'].firstElementChild.style.transform=`translate(${mobile?0:drift}%,${mobile?drift*1.6:0}%)`;
  ui['word-pool'].firstElementChild.style.transform=`translate(${mobile?0:-drift}%,${mobile?drift*1.6:0}%)`;
  const spread=split*(mobile?0:Math.min(width*.14,200));
  ui['word-one'].style.transform=`translate(${-spread}px,${mobile?-split*height*.14:0}px)`;
  ui['word-pool'].style.transform=`translate(${spread}px,${mobile?-split*height*.14:0}px)`;
  const symbol=envelope(pool,.35,.45,.65,.7);
  let lineStart=fit(pool,.25,.33),lineEnd=fit(pool,.08,.16);
  lineStart=lineStart*(1-fit(pool,.65,.75));
  lineEnd=lineEnd*(1-fit(pool,.85,.9));
  const axis=$('.pool-axis');
  axis.style.clipPath=`inset(${Math.min(lineStart,lineEnd)*100}% 0 ${(1-Math.max(lineStart,lineEnd))*100}% 0)`;
  axis.style.opacity=poolOn;
  show(ui['pool-emblem'],symbol);
  ui['pool-emblem'].style.transform=`translate(-50%,-50%) perspective(900px) rotateX(${pointerY*-7}deg) rotateY(${pointerX*9}deg) scale(${.9+.1*symbol}) rotate(${45*(1-symbol)}deg)`;
  drawEmblem('pool',fit(pool,.35,.45),1-fit(pool,.65,.7));
  show(ui['pool-subtitle'],envelope(pool,.34,.39,.66,.72));
  ui['pool-subtitle'].querySelectorAll('span').forEach((word,i)=>{
    const enter=smooth(fit(pool,.34+i*.012,.395+i*.012)),leave=fit(pool,.64+i*.012,.69+i*.012);
    word.style.opacity=enter*(1-leave);
    word.style.transform=`translate3d(0,${(1-enter)*16-leave*12}px,${(1-enter)*-70}px) rotateX(${(1-enter)*-65+leave*25}deg)`;
    word.style.filter=`blur(${(1-enter)*2}px)`;
  });
  show(ui['pool-description'],envelope(pool,.32,.4,.82,.9),6);

  // Start with a clean title. Keep it visible as it rises and the squares
  // draw beneath it in the second half of the section.
  const flow=fit(unit,7.3,9.05);
  const opening=smooth(fit(flow,.43,.53)),leaving=fit(flow,.9,1);
  const emblem=$('.flows-emblem');
  const layout=flowLayout||(flowLayout=measureFlowLayout());
  const titleEnter=smooth(fit(flow,.1,.3));
  sceneVisibility(2,flow>0&&flow<1?1:0);
  show(ui['flows-heading'],fit(flow,.08,.16)*(1-leaving));
  ui['flows-heading'].style.top=`${layout.titleStart+(layout.titleEnd-layout.titleStart)*opening}px`;
  ui['flows-heading'].style.transform=`scale(${layout.scale})`;
  const flowTitle=$('.flows h2');
  flowTitle.style.overflow=titleEnter<1?'hidden':'visible';
  flowTitle.firstElementChild.style.transform=`translateY(${(1-titleEnter)*135}%)`;
  show($('.flows .eyebrow'),envelope(flow,.15,.3,.9,1));
  show(emblem,envelope(flow,.53,.6,.9,1));
  // Normalize each path so every outline closes before the center mark enters.
  paths.flows.forEach((path,i)=>{
    const order=2-i,enter=fit(flow,.53+order*.02,.62+order*.02);
    const exit=fit(flow,.85,1),scale=1-fit(exit,order*.25,.5+order*.25);
    path.style.strokeDasharray=enter>=1?'none':'1';
    path.style.strokeDashoffset=1-enter;
    path.style.opacity=1-exit;
    path.style.transform=`scale(${scale})`;
  });
  emblem.style.setProperty('--glass-opacity',envelope(flow,.65,.7,.8,.9));
  show(ui['flow-mark'],envelope(flow,.67,.71,.85,.88));
  show(ui['flows-description'],envelope(flow,.25,.35,.85,.95),3);
  ui['flows-description'].style.top=`${layout.copyStart+(layout.copyEnd-layout.copyStart)*opening}px`;
  ui['flows-description'].style.transform=`translateX(-50%) scale(${layout.scale})`;
  emblem.style.top=`${layout.shapeCenter}px`;
  emblem.style.transform=`translate(-50%,-50%) perspective(850px) rotateX(${-pointerY*2}deg) rotateY(${pointerX*3}deg) scale(${layout.scale*(.92+.08*smooth(fit(flow,.53,.66)))})`;

  const everyone=fit(unit,9.05,13.75),everyoneOn=envelope(everyone,0,.15,.85,1);
  sceneVisibility(3,everyoneOn);
  show(ui['everyone-kicker'],fit(everyoneOn,0,.25),4);
  const roleOn=[everyoneOn*(1-fit(everyone,.18,.3333)),everyoneOn*fit(everyone,.3333,.48)*(1-fit(everyone,.51,.6666)),everyoneOn*fit(everyone,.6666,.81)];
  roles.forEach((role,i)=>{
    show(role,fit(roleOn[i],0,.5),6);
    const ratio=smooth(fit(roleOn[i],.2,.7));
    role.querySelector('.role-icon').style.transform=`rotate(${(1-ratio)*-45}deg) scale(${.5+ratio*.5})`;
    show(role.querySelector('.role-icon'),ratio);
    show(role.querySelector('p'),fit(roleOn[i],.4,1),4);
  });

  const redef=fit(unit,14.25,16.25);
  sceneVisibility(4,redef>0&&redef<1?1:0);
  show($('.redefined h2'),envelope(redef,.075,.125,.75,.95),6);
  show($('.redefined .body-copy'),envelope(redef,.12,.22,.655,.755),5);
  show(ui['redefined-emblem'],envelope(redef,.035,.2,.8,1));
  drawEmblem('redefined',fit(redef,.035,.2),1-fit(redef,.8,1));
  $('.interlock').style.transform=`rotate(${(1-smooth(fit(redef,.035,.2)))*-90}deg)`;

  const horizon=fit(unit,16.25,19.75),exit=fit(horizon,.9,.975);
  sceneVisibility(5,horizon>0&&horizon<1&&exit<.999?1:0);
  ui['horizon-inner'].style.transform=`translateY(${-exit*height/5}px) translateZ(${-exit*300}px) rotateX(${exit*25}deg)`;
  ui['horizon-inner'].style.opacity=1-exit;
  show($('.horizon h2'),fit(horizon,.2,.4),8);
  show($('.horizon .body-copy'),fit(horizon,.35,.5),5);
  show($('.horizon-cta'),fit(horizon,.45,.6));
  $('.horizon-cta').style.transform=`translateY(${(1-fit(horizon,.45,.6))*28}px)`;

  const ending=fit(unit,18.75,19.7);
  $('#end-veil').style.opacity=smooth(ending);
  const portal=smooth(fit(unit,18.95,19.7)),cx=width/2,cy=height*(width>=768&&height<600?.29:.31);
  const portalSize=mobile?180:height<600?height*.30:Math.min(250,Math.max(170,width*.17));
  const before=[[0,0],[width,0],[width,height],[0,height]],after=[[cx,cy-portalSize/2],[cx+portalSize/2,cy],[cx,cy+portalSize/2],[cx-portalSize/2,cy]];
  $('#stage').style.clipPath=portal>0?`polygon(${before.map((p,i)=>`${p[0]+(after[i][0]-p[0])*portal}px ${p[1]+(after[i][1]-p[1])*portal}px`).join(',')})`:'none';
  canvas.style.transform=`translateY(${(cy-height/2)*portal}px) scale(${1+(portalSize/Math.min(width,height)-1)*portal})`;
  $('.outro-portal-frame').style.opacity=fit(portal,.92,1);
  $('#shade').style.opacity=1-portal;
  document.documentElement.classList.toggle('is-ending',ending>.8);
  titleEntry=unit<19.45?0:clamp(titleEntry+(unit>19.65?dt:-dt*3));
  sceneVisibility(6,fit(titleEntry,.05,.5));
  summitFog.render({width,height,dt,pointer:titlePointer,visible:titleEntry>.05&&ending>.8});
  $('.chapter-nav').inert=ending>.8;
  $('.journey-footer').inert=ending>.8;
  ui['join-content'].style.transform=`translateY(${(1-fit(titleEntry,.15,.8))*25}px)`;
  const transition=envelope(unit,6.5,6.9,7.0,7.3)+envelope(unit,14.22,14.48,14.55,14.95);
  $('#transition-veil').style.opacity=transition*.72;
  $('#stage').style.filter=`blur(${transition*7}px)`;
  $('#stage').style.transform=`scale(${1+transition*.035})`;
  $('#atmosphere').style.opacity=(1-fit(unit,6.5,7))*.4*(1-ending);
  $('#scroll-progress').style.height=`${unit/19.75*100}%`;
  const chapter=unit<1.75?0:unit<6.5?1:unit<14.25?2:unit<16.25?3:4;
  if(chapter!==currentChapter){currentChapter=chapter;$('#chapter-number').textContent=`0${chapter+1}`;$('#chapter-label').textContent=['The vision','One pool','Connected liquidity','Risk in view','Your workspace'][chapter];nav.forEach((b,i)=>i===chapter?b.setAttribute('aria-current','step'):b.removeAttribute('aria-current'));}
}

function setPlaying(value) {
  playing=value;tour.setAttribute('aria-pressed',String(value));tour.setAttribute('aria-label',value?'Pause guided journey':'Play guided journey');tour.querySelector('span').textContent=value?'Pause journey':'Play journey';
}
function closeMenu(){menu.close();$('.chapter-toggle').setAttribute('aria-expanded','false');}
function jump(unit) {
  setPlaying(false);closeMenu();travel={from:scrollY/height,to:unit,started:performance.now(),duration:reducedMotion?.05:Math.min(4.2,1.2+Math.abs(unit-scrollY/height)*.12)};
}
document.querySelectorAll('[data-jump]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();jump(Number(el.dataset.jump));}));
function openMenu(){setPlaying(false);menu.showModal();$('.chapter-toggle').setAttribute('aria-expanded','true');}
$('.chapter-toggle').addEventListener('click',openMenu);
$('.join-chapters')?.addEventListener('click',openMenu);
$('.skip-link').addEventListener('click',e=>{e.preventDefault();openMenu();});
$('.close-menu').addEventListener('click',closeMenu);
menu.addEventListener('cancel',()=>$('.chapter-toggle').setAttribute('aria-expanded','false'));
tour.addEventListener('click',()=>{if(y>19.6)jump(0);else {travel=null;setPlaying(!playing);}});
function stopTravel(){travel=null;setPlaying(false);}
setupProtocolNotes(stopTravel);
window.addEventListener('wheel',stopTravel,{passive:true});window.addEventListener('touchstart',stopTravel,{passive:true});
window.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key))stopTravel();});
window.addEventListener('pointermove',e=>{if(e.pointerType!=='touch'){mouseX=e.clientX/width*2-1;mouseY=e.clientY/height*2-1;titlePointer.x=e.clientX;titlePointer.y=e.clientY;titlePointer.active=true;}});
window.addEventListener('pointerleave',()=>{mouseX=mouseY=0;titlePointer.active=false;});
window.addEventListener('resize',resize);
window.addEventListener('scroll',()=>{if(!ready)y=scrollY/height;},{passive:true});
resize();

function drawFrame(now) {
  requestAnimationFrame(drawFrame);
  if(!ready||document.hidden)return;
  const dt=Math.min((now-previousTime)/1000,.05);previousTime=now;
  const time=(now-startTime)/1000;
  if(travel){const t=fit((now-travel.started)/1000,0,travel.duration),s=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;window.scrollTo(0,(travel.from+(travel.to-travel.from)*s)*height);if(t>=1)travel=null;}
  else if(playing&&!menu.open){window.scrollTo(0,Math.min(19.75,scrollY/height+dt*.2)*height);if(scrollY/height>=19.74)setPlaying(false);}
  const target=clamp(scrollY/(height*19.75))*19.75;
  y += (target-y)*(reducedMotion?1:1-Math.exp(-dt*10));
  if(Math.abs(target-y)<.00005)y=target;
  const state=cameraState(y,time);
  renderUI(y,time,dt);
  updateProtocolNotes(y);
  renderTitle(state,time,dt);
  if(engine)engine.render(state,camera);
  else if(worker&&!workerBusy&&now-lastWorker>60){workerBusy=true;lastWorker=now;worker.postMessage({type:'render',...state});}
}

async function prepareSoftwareRenderer() {
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{alpha:false});
    worker=new Worker('/render-worker.js',{type:'module'});
    await new Promise((resolve,reject)=>{
      worker.onerror=e=>reject(new Error(e.message||'The landscape renderer could not start.'));
      worker.onmessage=({data})=>{
        if(data.type==='progress')progress(.12+data.progress*.85);
        if(data.type==='ready')resolve();
        if(data.type==='error')reject(new Error(data.message));
        if(data.type==='frame'){
          context.drawImage(data.bitmap,0,0,canvas.width,canvas.height);data.bitmap.close();workerBusy=false;
          if(!firstRender){firstRender=true;finishLoading();}
        }
      };
      worker.postMessage({type:'init',width:Math.min(width,960),height:Math.round(Math.min(width,960)*height/width)});
    });
}

async function initialize() {
  let completed=0;
  [cameraSummit,cameraLake,birdPath,trailSpline]=await Promise.all(['models/scene1/SC_01_CAMERA.buf','models/scene3/SC_03_CAMERA.buf','models/scene1/BIRD_PATH.buf','models/scene1/SC_01_TRAIL_SPLINE.buf'].map(async path=>{const data=await loadBuffer(path);progress(++completed/4*.12);return data;}));
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:true,powerPreference:'high-performance'});
  if(gl) {
    try {
      const {createWebGL}=await import('./webgl.js');
      engine=await createWebGL(canvas,gl,p=>progress(.12+p*.85));
      resize();
    } catch(error) {
      console.warn('Using the compatible landscape renderer.',error);
      const replacement=canvas.cloneNode(false);canvas.replaceWith(replacement);canvas=replacement;
    }
  }
  if(!engine)await prepareSoftwareRenderer();
  await document.fonts.ready;
  progress(1);ready=true;startTime=performance.now();previousTime=startTime;
  if(engine)finishLoading();
  requestAnimationFrame(drawFrame);
}
function finishLoading(){firstRender=true;progress(1);$('#loader').classList.add('loaded');document.documentElement.dataset.ready='true';}
initialize().catch(error=>{
  console.error(error);
  $('#loader p').textContent='The journey could not load. Please try again.';
  $('#loader-percent').textContent='↻';
  const retry=document.createElement('button');retry.className='pill';retry.textContent='Reload the journey';retry.addEventListener('click',()=>location.reload());$('.loader-progress').append(retry);
});
