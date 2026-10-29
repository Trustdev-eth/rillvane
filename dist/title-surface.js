// Projected headline: cursor light and water refraction remain inside the lettering.
export function titlePointerPosition(pointer, homography, rect, width, height) {
 if (homography) {
  const [a,b,d,e,g,h,x0,y0]=homography,X=pointer.x,Y=pointer.y;
  const A=a-X*g,B=b-X*h,C=d-Y*g,D=e-Y*h,det=A*D-B*C;
  if(Math.abs(det)>1e-8)return {x:((X-x0)*D-B*(Y-y0))/det,y:(A*(Y-y0)-(X-x0)*C)/det};
  return {x:-1,y:-1};
 }
 return {x:(pointer.x-rect.left)*width/rect.width,y:(pointer.y-rect.top)*height/rect.height};
}
export class TitleSurface {
 constructor(title,canvas){
  this.title=title;this.canvas=canvas;this.ctx=canvas.getContext('2d');
  this.source=document.createElement('canvas');this.ink=this.source.getContext('2d');
  this.motion=matchMedia('(prefers-reduced-motion: reduce)');
  this.light=0;this.clock=0;this.cursor=null;this.lastDrop=null;this.ripples=[];
 }
 render({width,height,dpr,matrix,homography,pointer,dt,opacity}){
  const c=this.canvas,ctx=this.ctx,ink=this.ink,source=this.source;
  const pixelWidth=Math.ceil(width*dpr),pixelHeight=Math.ceil(height*dpr);
  if(c.width!==pixelWidth||c.height!==pixelHeight){
   c.width=source.width=pixelWidth;c.height=source.height=pixelHeight;
   c.style.width=width+'px';c.style.height=height+'px';
  }
  c.style.transform=matrix;c.style.opacity=opacity;
  const step=Math.min(Math.max(dt||0,0),.05);this.clock+=step;
  const point=titlePointerPosition(pointer,homography,c.getBoundingClientRect(),width,height);
  const over=pointer.active&&opacity>.05&&point.x>=0&&point.x<=width&&point.y>=0&&point.y<=height;
  this.light+=(Number(over)-this.light)*(1-Math.exp(-step*(over?9:4)));
  if(over){
   if(!this.cursor)this.cursor={...point};
   this.cursor.x+=(point.x-this.cursor.x)*(1-Math.exp(-step*14));
   this.cursor.y+=(point.y-this.cursor.y)*(1-Math.exp(-step*14));
   if(!this.motion.matches&&(!this.lastDrop||Math.hypot(point.x-this.lastDrop.x,point.y-this.lastDrop.y)>24||this.clock-this.lastDrop.at>.32)){
    const drop={...point,at:this.clock};this.ripples.push(drop);this.lastDrop=drop;
    this.ripples=this.ripples.slice(-6);
   }
  }else this.lastDrop=null;
  this.ripples=this.motion.matches?[]:this.ripples.filter(drop=>this.clock-drop.at<1.5);
  const s=getComputedStyle(this.title);
  ink.setTransform(dpr,0,0,dpr,0,0);ink.clearRect(0,0,width,height);
  ink.font=s.fontWeight+' '+s.fontSize+' '+s.fontFamily;ink.letterSpacing=s.letterSpacing;ink.textBaseline='alphabetic';
  const m=ink.measureText(this.title.textContent),a=m.fontBoundingBoxAscent||parseFloat(s.fontSize)*.8,b=m.fontBoundingBoxDescent||0;
  const x=parseFloat(s.paddingLeft)||0,y=(height-a-b)/2+a;
  const finish=ink.createLinearGradient(0,y-a,0,y+b);
  finish.addColorStop(0,'#ffffff');finish.addColorStop(.48,'#f4f9e9');finish.addColorStop(1,'#dcf0b1');
  ink.shadowColor='rgba(10,35,23,.28)';ink.shadowBlur=14;ink.shadowOffsetY=4;
  ink.fillStyle=finish;ink.fillText(this.title.textContent,x,y);
  ink.shadowColor='transparent';ink.shadowBlur=0;ink.shadowOffsetY=0;
  ink.strokeStyle='rgba(255,255,244,.38)';ink.lineWidth=.65;ink.strokeText(this.title.textContent,x,y);
  if(this.cursor&&this.light>.005){
   ink.save();ink.globalCompositeOperation='source-atop';
   const radius=Math.max(65,height*.75),p=this.cursor;
   const light=ink.createRadialGradient(p.x,p.y,0,p.x,p.y,radius);
   light.addColorStop(0,'rgba(255,255,255,'+this.light*.85+')');
   light.addColorStop(.3,'rgba(209,250,242,'+this.light*.55+')');light.addColorStop(1,'rgba(209,250,242,0)');
   ink.fillStyle=light;ink.fillRect(0,0,width,height);
   if(!this.motion.matches){
    ink.lineWidth=1.5;
    for(const drop of this.ripples){
     const age=this.clock-drop.at;
     ink.strokeStyle='rgba(255,255,255,'+(1-age/1.5)*this.light*.55+')';
     ink.beginPath();ink.ellipse(drop.x,drop.y,6+age*130,3+age*65,0,0,Math.PI*2);ink.stroke();
    }
   }
   ink.restore();
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  if(this.motion.matches||this.light<.005||!this.cursor){ctx.drawImage(source,0,0,width,height);return;}
  // Thin horizontal bands refract the text without moving its layout or hit area.
  for(let row=0;row<pixelHeight;row+=4){
   const strip=Math.min(4,pixelHeight-row),localY=row/dpr;
   const distance=Math.abs(localY-this.cursor.y),falloff=Math.exp(-distance/Math.max(35,height*.45));
   const shift=Math.sin(localY*.085-this.clock*7)*Math.min(3.5,height*.013)*falloff*this.light;
   ctx.drawImage(source,0,row,pixelWidth,strip,shift,localY,width,strip/dpr);
  }
 }
}
