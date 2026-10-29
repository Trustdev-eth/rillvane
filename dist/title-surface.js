// Matte projected headline with a restrained, reversible light response.
export class TitleSurface {
 constructor(title,canvas){this.title=title;this.canvas=canvas;this.ctx=canvas.getContext('2d');this.light=0;}
 render({width,height,dpr,matrix,homography,pointer,dt,opacity}){
  const c=this.canvas,ctx=this.ctx;if(c.width!==Math.ceil(width*dpr)||c.height!==Math.ceil(height*dpr)){c.width=Math.ceil(width*dpr);c.height=Math.ceil(height*dpr);c.style.width=width+'px';c.style.height=height+'px';}
  c.style.transform=matrix;c.style.opacity=opacity;const s=getComputedStyle(this.title);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.font=`${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;ctx.letterSpacing=s.letterSpacing;ctx.textBaseline='alphabetic';const m=ctx.measureText(this.title.textContent),a=m.fontBoundingBoxAscent||parseFloat(s.fontSize)*.8,b=m.fontBoundingBoxDescent||0;
  const rect=c.getBoundingClientRect(),over=pointer.active&&pointer.x>rect.left&&pointer.x<rect.right&&pointer.y>rect.top&&pointer.y<rect.bottom;this.light+=(Number(over)-this.light)*(1-Math.exp(-dt*3));
  ctx.fillStyle=`rgb(${232+this.light*5},${237+this.light*4},${224+this.light*5})`;ctx.fillText(this.title.textContent,0,(height-a-b)/2+a);
 }
}
