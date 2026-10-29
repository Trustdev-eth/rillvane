import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FogTrail} from '../dist/fog-trail.js';
function fixture(){
 let clears=0;
 const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},clearRect(){clears++}};
 globalThis.matchMedia=()=>({matches:false});
 const fog=new FogTrail({width:0,height:0,getContext:()=>ctx});
 const state={width:1440,height:900,dt:1/60,visible:true,pointer:{active:true,x:200,y:400}};
 return {fog,state,clears:()=>clears};
}
test('flow responds to continuous movement, caps alpha, and fades after stopping',()=>{
 const {fog,state}=fixture();fog.render(state);assert.equal(fog.energy,0);
 for(let i=0;i<60;i++){state.pointer.x+=8;state.pointer.y+=Math.sin(i*.1)*3;fog.render(state)}
 assert.ok(fog.energy>0);assert.ok(fog.vx.some(v=>v>0));
 const alpha=fog.image.data.filter((_,i)=>i%4===3);assert.ok(Math.max(...alpha)>0);assert.ok(Math.max(...alpha)<=31);
 const before=fog.density.slice();fog.render(state);assert.notDeepEqual(fog.density,before,'wake continues flowing');
 for(let i=0;i<300;i++)fog.render(state);
 assert.equal(fog.energy,0);assert.ok(fog.density.every(v=>v===0));
});
test('scene exit and reduced motion clear the field; rendering resolution stays bounded',()=>{
 const {fog,state,clears}=fixture();fog.render(state);state.pointer.x+=100;fog.render(state);assert.ok(fog.energy>0);
 fog.motion.matches=true;fog.render(state);assert.equal(fog.energy,0);assert.equal(fog.last,null);assert.ok(clears()>0);
 fog.motion.matches=false;fog.render(state);state.pointer.x+=100;fog.render(state);state.visible=false;fog.render(state);assert.equal(fog.energy,0);
 state.width=7680;state.height=4320;fog.render(state);assert.ok(fog.w<=144&&fog.h<=144);assert.equal(fog.density.length,fog.w*fog.h);
});
