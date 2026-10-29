// Original low-resolution flow field: cursor momentum advects a continuous mist.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function sample(field,x,y,w,h){
 x=clamp(x,0,w-1);y=clamp(y,0,h-1);
 const ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1),fx=x-ix,fy=y-iy;
 return (field[iy*w+ix]*(1-fx)+field[iy*w+jx]*fx)*(1-fy)+(field[jy*w+ix]*(1-fx)+field[jy*w+jx]*fx)*fy;
}
export class FogTrail {
 constructor(canvas){
  this.canvas=canvas;this.ctx=canvas.getContext('2d');
  this.motion=matchMedia('(prefers-reduced-motion: reduce)');
  this.last=null;this.clock=0;this.energy=0;this.density=null;
 }
 resize(width,height){
  // Fixed work budget regardless of display resolution.
  const scale=144/Math.max(width,height),w=Math.max(16,Math.round(width*scale)),h=Math.max(16,Math.round(height*scale));
  if(this.canvas.width===w&&this.canvas.height===h&&this.density)return;
  this.canvas.width=w;this.canvas.height=h;this.w=w;this.h=h;
  this.density=new Float32Array(w*h);this.nextDensity=new Float32Array(w*h);
  this.vx=new Float32Array(w*h);this.vy=new Float32Array(w*h);
  this.nextVx=new Float32Array(w*h);this.nextVy=new Float32Array(w*h);
  this.image=this.ctx.createImageData(w,h);this.energy=0;this.last=null;
 }
 reset(){
  if(this.energy>0){
   for(const field of [this.density,this.nextDensity,this.vx,this.vy,this.nextVx,this.nextVy])field.fill(0);
   this.ctx.clearRect(0,0,this.w,this.h);
  }
  this.energy=0;this.last=null;
 }
 inject(x,y,dx,dy){
  const {w,h}=this,radius=4.5,speed=Math.hypot(dx,dy);
  if(speed<.025)return;
  const strength=Math.min(.14,speed*.035);
  for(let row=Math.max(0,Math.floor(y-radius));row<=Math.min(h-1,Math.ceil(y+radius));row++){
   for(let col=Math.max(0,Math.floor(x-radius));col<=Math.min(w-1,Math.ceil(x+radius));col++){
    const r2=((col-x)**2+(row-y)**2)/(radius*radius);
    if(r2>1)continue;
    const weight=Math.exp(-r2*4)*(1-r2),i=row*w+col;
    this.density[i]=Math.min(.75,this.density[i]+weight*strength);
    this.vx[i]=clamp(this.vx[i]+dx*weight*.65,-2.5,2.5);
    this.vy[i]=clamp(this.vy[i]+dy*weight*.65,-2.5,2.5);
   }
  }
  this.energy=1;
 }
 render({width,height,dt,pointer,visible}){
  this.resize(width,height);
  if(!visible||this.motion.matches){this.reset();return;}
  const step=clamp(dt||0,0,.04),frame=step*60;this.clock+=step;
  const {w,h}=this;
  if(pointer.active){
   const point={x:clamp(pointer.x/width*w,0,w-1),y:clamp(pointer.y/height*h,0,h-1)};
   if(this.last){
    const dx=point.x-this.last.x,dy=point.y-this.last.y;
    const segments=Math.min(12,Math.max(1,Math.ceil(Math.hypot(dx,dy)/2)));
    for(let i=1;i<=segments;i++)this.inject(this.last.x+dx*i/segments,this.last.y+dy*i/segments,dx/segments,dy/segments);
   }
   this.last=point;
  }else this.last=null;
  if(!this.energy)return;
  const fade=Math.exp(-step*2.2),drag=Math.exp(-step*3.5),data=this.image.data;
  let maximum=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=y*w+x,vx=this.vx[i],vy=this.vy[i];
   // Small divergence-free eddies soften the wake instead of expanding circular clouds.
   const phase=x*.18+y*.14+this.clock*.35;
   const curlX=Math.cos(phase)*.08,curlY=-Math.cos(phase)*.1;
   const fromX=x-(vx+curlX)*frame,fromY=y-(vy+curlY)*frame;
   let amount=sample(this.density,fromX,fromY,w,h)*fade;
   amount=amount<.001?0:amount;
   this.nextDensity[i]=amount;maximum=Math.max(maximum,amount);
   this.nextVx[i]=sample(this.vx,fromX,fromY,w,h)*drag;
   this.nextVy[i]=sample(this.vy,fromX,fromY,w,h)*drag;
   const tint=(Math.sin(phase*.5)+1)*.5,pixel=i*4;
   data[pixel]=112+tint*15;data[pixel+1]=155+tint*12;data[pixel+2]=137+tint*15;
   data[pixel+3]=Math.round(Math.min(.12,amount*.65)*255);
  }
  [this.density,this.nextDensity]=[this.nextDensity,this.density];
  [this.vx,this.nextVx]=[this.nextVx,this.vx];[this.vy,this.nextVy]=[this.nextVy,this.vy];
  this.ctx.putImageData(this.image,0,0);this.energy=maximum;
  if(maximum<.002)this.reset();
 }
}
