// Textured software renderer for browsers without a WebGL context.
// It uses the same geometry, projection matrices, and scroll timeline as WebGL.
import {loadBuffer,landscapeModels} from './buffer.js';
import {BirdSkin} from './bird.js';
let width=800,height=600,canvas,context,image,depth,models=[],textures=new Map(),summitTrail,riverTrails=[];
let bird,birdSkin;
let flowMap,trailMap,normalMap,riverTextures;
let refractionCanvas,refractionContext;
const clamp=v=>Math.max(0,Math.min(1,v));
const fit=(v,a,b)=>clamp((v-a)/(b-a));

async function texture(path) {
  if(textures.has(path))return textures.get(path);
  const promise=(async()=>{
    const response=await fetch('/assets/'+path);
    if(!response.ok)throw new Error('Landscape texture unavailable.');
    const bitmap=await createImageBitmap(await response.blob());
    const scale=Math.min(1,1536/Math.max(bitmap.width,bitmap.height));
    const w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale);
    const c=new OffscreenCanvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0,w,h);bitmap.close();
    return {data:ctx.getImageData(0,0,w,h).data,width:w,height:h};
  })();
  textures.set(path,promise);return promise;
}
function resize(w,h) {
  width=Math.round(w);height=Math.round(h);canvas=new OffscreenCanvas(width,height);context=canvas.getContext('2d',{alpha:false});
  image=context.createImageData(width,height);depth=new Float32Array(width*height);
  refractionCanvas=new OffscreenCanvas(width,height);refractionContext=refractionCanvas.getContext('2d');
}
async function init(data) {
  resize(data.width,data.height);
  let count=0;
  models=await Promise.all(landscapeModels.map(async spec=>{
    const [geometry,tex]=await Promise.all([loadBuffer(spec.model),texture(spec.texture)]);
    const a=geometry.attributes,positions=a.position.array,uv=a.uv?.array || new Float32Array(geometry.count*2);
    if(spec.scene===1)for(let i=0;i<geometry.count;i++){uv[i*2]=positions[i*3+2]/250+.5;uv[i*2+1]=(positions[i*3]/1500+.5)*6-(5-spec.tile);}
    postMessage({type:'progress',progress:++count/landscapeModels.length});
    return {...spec,geometry,tex,uv,projected:new Float32Array(geometry.count*7)};
  }));
  [flowMap,trailMap,normalMap]=await Promise.all([texture('textures/scene2/FLOW.webp'),texture('textures/scene2/TRAILS.webp'),texture('textures/waterNormal.jpg')]);
  riverTextures=models.filter(m=>m.scene===1).sort((a,b)=>a.tile-b.tile).map(m=>m.tex);
  summitTrail=(await loadBuffer('models/scene1/SC_01_TRAIL_SPLINE.buf')).attributes.position.array;
  riverTrails=await Promise.all([0,1,2].map(async i=>{
    const a=(await loadBuffer(`models/scene2/TRAIL_${i}.buf`)).attributes;const values=[];
    let prev=-100;
    for(let j=0;j<a.position.count;j++){const d=a.dist.array[j];if(Math.abs(d-prev)>.01){prev=d;values.push(a.position.array[j*3],a.position.array[j*3+1],a.position.array[j*3+2]);}}
    return new Float32Array(values);
  }));
  const [birdGeometry,animation,birdTexture,birdAlpha]=await Promise.all([loadBuffer('models/scene1/BIRD.buf'),loadBuffer('models/scene1/BIRD_ANIMATION.buf'),texture('textures/scene1/BIRD_TEXTURE_01.webp'),texture('textures/scene1/BIRD_ALPHA.webp')]);
  birdSkin=new BirdSkin(birdGeometry,animation);
  for(let yy=0;yy<birdTexture.height;yy++)for(let xx=0;xx<birdTexture.width;xx++){
    const ax=Math.min(birdAlpha.width-1,Math.floor(xx/birdTexture.width*birdAlpha.width)),ay=Math.min(birdAlpha.height-1,Math.floor(yy/birdTexture.height*birdAlpha.height));
    birdTexture.data[(yy*birdTexture.width+xx)*4+3]=birdAlpha.data[(ay*birdAlpha.width+ax)*4];
  }
  birdGeometry.attributes.position.array=birdSkin.positions;
  bird={id:'bird',scene:-1,geometry:birdGeometry,tex:birdTexture,uv:birdGeometry.attributes.uv.array,projected:new Float32Array(birdGeometry.count*7)};
  postMessage({type:'ready'});
}

function projectMesh(model,state) {
  const {geometry,uv,projected}=model,a=geometry.attributes,pos=a.position.array,m=state.matrix;
  for(let i=0,j=0,k=0;i<geometry.count;i++,j+=3,k+=7) {
    const waterMask=model.water?clamp(a.mask.array[i]):0;
    const x=pos[j],y=pos[j+1]+waterMask*(Math.sin(pos[j]*.027+state.time*.72)*.36+Math.sin(pos[j+2]*.038-state.time*.93)*.24),z=pos[j+2]*(model.scene===1?(1-.1*Math.max(0,(pos[j+1]-3)/20)):1);
    const w=m[3]*x+m[7]*y+m[11]*z+m[15];
    const q=w>.01?1/w:0;
    projected[k]=((m[0]*x+m[4]*y+m[8]*z+m[12])*q*.5+.5)*width;
    projected[k+1]=(-((m[1]*x+m[5]*y+m[9]*z+m[13])*q)*.5+.5)*height;
    projected[k+2]=q;projected[k+3]=uv[i*2]*q;projected[k+4]=uv[i*2+1]*q;
    projected[k+5]=(a.alpha?.array[i]??1)*q;
    const shadow=a.shadowmask?.array[i]??0,tr=a.trailRatio?.array[i]??0;
    projected[k+6]=(model.water?waterMask:Math.min(state.dim,1-shadow*fit(state.trail,tr-.1,tr)))*q;
  }
}
function texel(tex,u,v,repeat=false){
  if(repeat){u=((u%1)+1)%1;v=((v%1)+1)%1;}
  const x=Math.max(0,Math.min(tex.width-1,(u*(tex.width-1))|0)),y=Math.max(0,Math.min(tex.height-1,((1-v)*(tex.height-1))|0));
  return (y*tex.width+x)*4;
}
function rasterize(model,state) {
  const p=model.projected,ix=model.geometry.attributes.indices?.array;
  const count=ix?ix.length:model.geometry.count;
  const tex=model.tex.data,tw=model.tex.width,th=model.tex.height,pixels=image.data;
  const isRiver=model.scene===1,isMountain=model.scene===0;
  let role=0;for(const r of state.roleWeights)role=Math.max(role,r);
  const phaseA=(state.time*.36)%1,phaseB=(state.time*.36+.5)%1,weightA=1-Math.abs(1-2*phaseA),weightB=1-Math.abs(1-2*phaseB);
  for(let i=0;i<count;i+=3) {
    const a=(ix?ix[i]:i)*7,b=(ix?ix[i+1]:i+1)*7,c=(ix?ix[i+2]:i+2)*7;
    const aq=p[a+2],bq=p[b+2],cq=p[c+2];
    if(aq<=0||bq<=0||cq<=0)continue;
    const ax=p[a],ay=p[a+1],bx=p[b],by=p[b+1],cx=p[c],cy=p[c+1];
    let minX=Math.max(0,Math.floor(Math.min(ax,bx,cx))),maxX=Math.min(width-1,Math.ceil(Math.max(ax,bx,cx)));
    let minY=Math.max(0,Math.floor(Math.min(ay,by,cy))),maxY=Math.min(height-1,Math.ceil(Math.max(ay,by,cy)));
    if(minX>maxX||minY>maxY)continue;
    const denom=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
    if(Math.abs(denom)<.01)continue;
    const inv=1/denom,w0dx=(by-cy)*inv,w0dy=(cx-bx)*inv,w1dx=(cy-ay)*inv,w1dy=(ax-cx)*inv;
    const u0=p[a+3],u1=p[b+3],u2=p[c+3],v0=p[a+4],v1=p[b+4],v2=p[c+4];
    const al0=p[a+5],al1=p[b+5],al2=p[c+5],d0=p[a+6],d1=p[b+6],d2=p[c+6];
    let r0=((by-cy)*(minX+.5-cx)+(cx-bx)*(minY+.5-cy))*inv;
    let r1=((cy-ay)*(minX+.5-cx)+(ax-cx)*(minY+.5-cy))*inv;
    for(let yy=minY;yy<=maxY;yy++) {
      let w0=r0,w1=r1,offset=yy*width+minX;
      for(let xx=minX;xx<=maxX;xx++,offset++,w0+=w0dx,w1+=w1dx) {
        const w2=1-w0-w1;
        if(w0<-.00001||w1<-.00001||w2<-.00001)continue;
        const q=w0*aq+w1*bq+w2*cq;
        if(model.id!=='bird'&&q<=depth[offset])continue;
        const z=1/q;
        let u=(w0*u0+w1*u1+w2*u2)*z,v=(w0*v0+w1*v1+w2*v2)*z;
        let waterMask=0,normalX=0,normalY=0;
        if(model.water){
          waterMask=(w0*d0+w1*d1+w2*d2)*z;
          const n0=texel(normalMap,u*13+state.time*.012,v*13-state.time*.008,true),n1=texel(normalMap,u*22.49-state.time*.009,v*22.49+state.time*.011,true);
          normalX=((normalMap.data[n0]/255*2-1)+(normalMap.data[n1]/255*2-1)*.55);
          normalY=((normalMap.data[n0+1]/255*2-1)+(normalMap.data[n1+1]/255*2-1)*.55);
          const mask3=waterMask*waterMask*waterMask;u+=normalX*.0055*mask3;v+=normalY*.0055*mask3;
        }
        const tx=Math.max(0,Math.min(tw-1,(u*(tw-1))|0)),ty=Math.max(0,Math.min(th-1,((1-v)*(th-1))|0));
        const ti=(ty*tw+tx)*4;
        let alpha=(w0*al0+w1*al1+w2*al2)*z*tex[ti+3]/255;
        if(alpha<.005)continue;
        let red=tex[ti],green=tex[ti+1],blue=tex[ti+2];
        if(isRiver){
          const fullV=(v+5-model.tile)/6,fi=texel(flowMap,u,fullV);
          const fx=Math.max(-1,Math.min(1,(flowMap.data[fi]-128)/127))/50,fy=Math.max(-1,Math.min(1,(flowMap.data[fi+1]-128)/127))/50;
          let av=(fullV-fy*phaseA)*6-(5-model.tile),bv=(fullV-fy*phaseB)*6-(5-model.tile),at=riverTextures[model.tile],bt=at;
          if(av>1){at=riverTextures[Math.max(0,model.tile-1)];av-=1;}else if(av<0){at=riverTextures[Math.min(5,model.tile+1)];av+=1;}
          if(bv>1){bt=riverTextures[Math.max(0,model.tile-1)];bv-=1;}else if(bv<0){bt=riverTextures[Math.min(5,model.tile+1)];bv+=1;}
          const ia=texel(at,u-fx*phaseA,av),ib=texel(bt,u-fx*phaseB,bv),ta=at.data,tb=bt.data;
          red=ta[ia]*weightA+tb[ib]*weightB;green=ta[ia+1]*weightA+tb[ib+1]*weightB;blue=ta[ia+2]*weightA+tb[ib+2]*weightB;
          if(role>.01){
            const mi=texel(trailMap,u,fullV),mask=trailMap.data;
            const light=(state.roleWeights[0]*mask[mi]+state.roleWeights[1]*mask[mi+1]+state.roleWeights[2]*mask[mi+2])/255;
            const multiplier=1-role+role*(.28+light*1.6);red*=multiplier;green*=multiplier;blue*=multiplier;
          }
          const foam=Math.pow(Math.max(0,Math.sin(u*940+fullV*318-state.time*1.4)),18)*Math.min(1,Math.hypot(fx,fy)*50);
          red+=foam*6.6;green+=foam*9.2;blue+=foam*10.4;
        }
        if(model.water){
          const reflect=waterMask*(.13+Math.abs(normalX*.04));
          red+=(157-red)*reflect;green+=(194-green)*reflect;blue+=(212-blue)*reflect;
          const caustic=Math.pow(Math.max(0,1-Math.abs(normalX-normalY)*.6),14)*waterMask*5;
          red+=caustic*.7;green+=caustic*.86;blue+=caustic*.9;
        }
        if(isMountain){
          const dim=(w0*d0+w1*d1+w2*d2)*z;
          red*=1-dim*.62;green*=1-dim*.53;blue*=1-dim*.51;
        }
        if(!isRiver&&model.id!=='bird'){
          const fog=fit(z,isMountain?1800:1900,isMountain?2500:2800);
          const fr=173-state.dim*93,fg=216-state.dim*113,fb=230-state.dim*108;
          red+=(fr-red)*fog;green+=(fg-green)*fog;blue+=(fb-blue)*fog;
        }
        const pi=offset*4;
        if(alpha>.995){pixels[pi]=red;pixels[pi+1]=green;pixels[pi+2]=blue;}else{pixels[pi]+=(red-pixels[pi])*alpha;pixels[pi+1]+=(green-pixels[pi+1])*alpha;pixels[pi+2]+=(blue-pixels[pi+2])*alpha;}
        if(alpha>.2)depth[offset]=q;
      }
      r0+=w0dy;r1+=w1dy;
    }
  }
}
function projectPoint(points,i,m) {
  const x=points[i],y=points[i+1],z=points[i+2],w=m[3]*x+m[7]*y+m[11]*z+m[15];
  if(w<1)return null;
  return [((m[0]*x+m[4]*y+m[8]*z+m[12])/w*.5+.5)*width,(-(m[1]*x+m[5]*y+m[9]*z+m[13])/w*.5+.5)*height];
}
function drawTrail(points,state,opacity,progress=1) {
  if(opacity<.01)return;
  if(state.group===0){drawSummitCurrent(points,state,opacity,progress);return;}
  context.save();context.globalCompositeOperation='screen';context.globalAlpha=opacity;
  context.strokeStyle='#b2dcff';context.lineWidth=1.2;context.shadowBlur=10;context.shadowColor='#8bbcff';context.beginPath();
  let started=false;const count=Math.min(points.length,Math.floor(points.length*progress/3)*3);
  for(let i=0;i<count;i+=3){const p=projectPoint(points,i,state.matrix);if(!p||Math.abs(p[0])>width*5||Math.abs(p[1])>height*5){started=false;continue;}if(started)context.lineTo(p[0],p[1]);else{context.moveTo(p[0],p[1]);started=true;}}
  context.stroke();
  for(let k=0;k<14;k++) {
    const t=(k/14+state.time*.085)%1;if(t>progress)continue;
    const p=projectPoint(points,Math.floor(t*(points.length/3-1))*3,state.matrix);if(!p)continue;
    context.globalAlpha=opacity*.7;context.fillStyle='#f1fbff';context.beginPath();context.ellipse(p[0],p[1],1.5,1.5,0,0,Math.PI*2);context.fill();
  }
  context.restore();
}
function drawSummitCurrent(points,state,opacity,progress){
  const coords=[];const count=Math.min(points.length,Math.floor(points.length*progress/3)*3);
  for(let i=0;i<count;i+=3)coords.push(projectPoint(points,i,state.matrix));
  context.save();context.globalCompositeOperation='lighter';
  context.beginPath();let started=false;
  for(const p of coords){if(!p||Math.abs(p[0])>width*3||Math.abs(p[1])>height*3){started=false;continue;}if(started)context.lineTo(p[0],p[1]);else{context.moveTo(p[0],p[1]);started=true;}}
  context.strokeStyle='#d9ffd0';context.globalAlpha=opacity*.2;context.lineWidth=5;context.shadowColor='#baffb0';context.shadowBlur=22;context.stroke();context.shadowBlur=0;
  for(let lane=0;lane<24;lane++){
    const seed=lane*2.399963;context.beginPath();let begun=false;
    for(let i=0;i<coords.length;i++){
      const p=coords[i];if(!p){begun=false;continue;}
      const t=i/Math.max(1,points.length/3-1),spread=Math.sin(t*Math.PI)*(1.2+Math.sin(seed+t*17)**2*2.3);
      const x=p[0]+Math.cos(seed+t*28+state.time*.27)*spread,y=p[1]+Math.sin(seed+t*21-state.time*.18)*spread;
      if(begun)context.lineTo(x,y);else{context.moveTo(x,y);begun=true;}
    }
    context.globalAlpha=opacity*(.12+(lane%5)*.018);context.lineWidth=.4+(lane%3)*.22;context.strokeStyle=lane%4===0?'#ffffdf':'#dffaff';context.stroke();
    const head=((state.time*.085+lane/24)%1);
    if(head<progress){const p=coords[Math.floor(head*(points.length/3-1))];if(p){context.globalAlpha=opacity*.65;context.fillStyle='#f6ffd5';context.beginPath();context.ellipse(p[0],p[1],.6+(lane%3)*.3,.65,0,0,Math.PI*2);context.fill();}}
  }
  context.restore();
}
function render(state) {
  depth.fill(0);
  const pixels=image.data,d=state.group===0?state.dim:0;
  for(let yy=0;yy<height;yy++){
    const t=yy/height,red=(125+48*t)*(1-d)+(60+23*t)*d,green=(170+46*t)*(1-d)+(77+28*t)*d,blue=(219+11*t)*(1-d)+(95+17*t)*d;
    for(let xx=0,i=yy*width*4;xx<width;xx++,i+=4){pixels[i]=red;pixels[i+1]=green;pixels[i+2]=blue;pixels[i+3]=255;}
  }
  for(const model of models)if(model.scene===state.group||(model.shared&&state.group===2)){projectMesh(model,state);rasterize(model,state);}
  if(state.birdMatrix){birdSkin.update(state.birdFrame);const birdState={...state,matrix:state.birdMatrix,dim:0};projectMesh(bird,birdState);rasterize(bird,birdState);}
  context.putImageData(image,0,0);
  if(state.group===0)drawTrail(summitTrail,state,state.dim*state.trailActive*.8,state.trail);
  if(state.group===1)riverTrails.forEach((p,i)=>drawTrail(p,state,state.roleWeights[i]*.55));
  const liquid=state.group===2?fit(state.unit,14.5,14.9)*(1-fit(state.unit,16.55,17.25)):0;
  if(liquid>.001){
    refractionContext.clearRect(0,0,width,height);refractionContext.drawImage(canvas,0,0);
    context.clearRect(0,0,width,height);
    for(let row=0;row<height;row+=3){const offset=(Math.sin(row*.028+state.time*.7)+Math.sin(row*.051-state.time*.43)*.5)*liquid*width*.008;const overscan=width*.025;context.drawImage(refractionCanvas,0,row,width,Math.min(3,height-row),offset-overscan,row,width+overscan*2,Math.min(3,height-row));}
  }
  const bitmap=canvas.transferToImageBitmap();postMessage({type:'frame',bitmap},[bitmap]);
}
self.onmessage=async({data})=>{
  try{
    if(data.type==='init')await init(data);
    else if(data.type==='resize')resize(data.width,data.height);
    else if(data.type==='render')render(data);
  }catch(error){postMessage({type:'error',message:error.message});}
};
