// The bird's two-weight skeletal animation is evaluated on the CPU so both
// rendering paths follow the same wing cycle and camera-relative flight path.
export class BirdSkin {
  constructor(geometry,animation) {
    this.bind=geometry.attributes.position.array;
    this.positions=new Float32Array(this.bind.length);
    this.indices=geometry.attributes.boneIndices.array;
    this.weights=geometry.attributes.boneWeights.array;
    this.rotations=animation.attributes.orient.array;
    this.translations=animation.attributes.position.array;
    this.bones=21;this.frames=animation.count/this.bones;
  }
  update(frame) {
    frame=((frame%this.frames)+this.frames)%this.frames;
    const f0=Math.floor(frame),f1=(f0+1)%this.frames,t=frame-f0;
    const p=this.bind,out=this.positions,rots=this.rotations,trans=this.translations;
    for(let i=0,k=0;i<p.length/3;i++,k+=3){
      const x=p[k],y=p[k+1],z=p[k+2];let ox=0,oy=0,oz=0;
      for(let pass=0;pass<2;pass++){
        const f=pass?f1:f0,blend=pass?t:1-t;
        for(let j=0;j<2;j++){
          const w=this.weights[i*2+j]*blend;
          if(w===0)continue;
          const bone=f*this.bones+Math.round(this.indices[i*2+j]),r=bone*4,v=bone*3;
          const qx=rots[r],qy=rots[r+1],qz=rots[r+2],qw=rots[r+3];
          const ix=qy*z-qz*y+qw*x,iy=qz*x-qx*z+qw*y,iz=qx*y-qy*x+qw*z;
          ox+=(x+2*(qy*iz-qz*iy)+trans[v])*w;
          oy+=(y+2*(qz*ix-qx*iz)+trans[v+1])*w;
          oz+=(z+2*(qx*iy-qy*ix)+trans[v+2])*w;
        }
      }
      out[k]=ox;out[k+1]=oy;out[k+2]=oz;
    }
    return out;
  }
}
