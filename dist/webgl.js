import * as T from './vendor/three.module.js';
import {loadBuffer,landscapeModels} from './buffer.js';
import {BirdSkin} from './bird.js';

const terrainVertex=`
attribute float alpha;
attribute float shadowmask;
attribute float trailRatio;
attribute float mask;
uniform float uDim;
uniform float uTrail;
uniform float uTime;
uniform float uWater;
varying vec2 vUv;
varying float vAlpha;
varying float vDim;
varying vec3 vPosition;
varying float vDepth;
varying float vMask;
void main(){
  vec3 p=position;
  vMask=clamp(mask,0.,1.);
  p.y+=uWater*vMask*(sin(position.x*.027+uTime*.72)*.36+sin(position.z*.038-uTime*.93)*.24);
  vec4 view=modelViewMatrix*vec4(p,1.0);
  vUv=uv;vAlpha=alpha;vPosition=p;vDepth=-view.z;
  vDim=min(uDim,1.0-shadowmask*smoothstep(trailRatio-.1,trailRatio,uTrail));
  gl_Position=projectionMatrix*view;
}`;
const terrainFragment=`
uniform sampler2D uTexture;
uniform sampler2D uNormal;
uniform float uTime;
uniform float uDim;
uniform float uWater;
uniform float uMountain;
varying vec2 vUv;
varying float vAlpha;
varying float vDim;
varying vec3 vPosition;
varying float vDepth;
varying float vMask;
void main(){
  vec2 coord=vUv;
  vec2 normalUv=vPosition.xz*.012;
  vec2 n0=texture2D(uNormal,normalUv+vec2(uTime*.012,-uTime*.008)).rg*2.-1.;
  vec2 n1=texture2D(uNormal,normalUv*1.73+vec2(-uTime*.009,uTime*.011)).rg*2.-1.;
  vec2 ripples=(n0+n1*.55)*uWater;
  coord+=ripples*.0055*pow(vMask,3.);
  vec4 tex=texture2D(uTexture,coord);
  vec3 color=tex.rgb*mix(vec3(1.),vec3(.38,.47,.49),vDim*uMountain);
  if(uWater>.5){
    vec3 N=normalize(vec3(ripples.x*.24,1.,ripples.y*.24));
    vec3 V=normalize(cameraPosition-vPosition);
    float fresnel=pow(1.-clamp(dot(N,V),0.,1.),4.);
    vec3 reflection=reflect(-V,N);
    vec3 reflectedSky=mix(vec3(.65,.79,.85),vec3(.38,.60,.86),clamp(reflection.y,0.,1.));
    color=mix(color,reflectedSky,fresnel*.28*vMask);
    float caustic=pow(max(0.,1.-abs(n0.x-n1.y)),14.)*.035*vMask;
    color+=vec3(.7,.86,.9)*caustic;
  }
  float fog=smoothstep(mix(1900.,1800.,uMountain),mix(2800.,2500.,uMountain),vDepth);
  vec3 sky=mix(vec3(.678,.847,.902),vec3(.326,.405,.44),uDim*uMountain);
  color=mix(color,sky,fog);
  gl_FragColor=vec4(color,tex.a*vAlpha);
}`;
const riverVertex=`varying vec3 vPosition;void main(){vec3 p=position;p.z*=mix(1.,.9,max(0.,(p.y-3.)/20.));vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`;
const riverFragment=`
uniform sampler2D uTexture;
uniform sampler2D uPrevious;
uniform sampler2D uNext;
uniform sampler2D uFlow;
uniform sampler2D uMask;
uniform vec3 uRoles;
uniform float uTime;
uniform float uTile;
varying vec3 vPosition;
vec4 readTile(vec2 uv){if(uv.y>1.)return texture2D(uPrevious,uv-vec2(0.,1.));if(uv.y<0.)return texture2D(uNext,uv+vec2(0.,1.));return texture2D(uTexture,uv);}
void main(){
  vec2 full=vPosition.zx/vec2(250.,1500.)+.5;
  vec2 flow=clamp((texture2D(uFlow,full).rg*255.-128.)/127.,-1.,1.)/50.;
  float phase=fract(uTime*.36),phase2=fract(uTime*.36+.5);
  vec2 uv1=full-flow*phase,uv2=full-flow*phase2;
  uv1.y=uv1.y*6.-(5.-uTile);uv2.y=uv2.y*6.-(5.-uTile);
  vec3 color=readTile(uv1).rgb*(1.-abs(1.-2.*phase))+readTile(uv2).rgb*(1.-abs(1.-2.*phase2));
  float trail=dot(uRoles,texture2D(uMask,full).rgb),roleStrength=max(uRoles.x,max(uRoles.y,uRoles.z));
  color=mix(color,color*.28+color*trail*mix(.8,2.25,clamp(vPosition.y/20.,0.,1.)),roleStrength);
  float currentStrength=clamp(length(flow)*50.,0.,1.);
  float foam=pow(max(0.,sin(dot(full,vec2(940.,318.))-uTime*1.4)),18.);
  color+=vec3(.026,.036,.041)*foam*currentStrength;
  gl_FragColor=vec4(color,1.);
}`;
const trailVertex=`attribute vec3 offset;attribute float side;attribute float dist;uniform float uTime;varying float vSide;varying float vDist;void main(){vSide=side;vDist=dist;vec3 p=position+offset*sin(dist*.05+uTime*.5)*.12;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`;
const trailFragment=`uniform float uTime;uniform float uOpacity;varying float vSide;varying float vDist;void main(){float core=pow(max(0.,1.-abs(vSide)),2.);float flow=.65+.35*sin(vDist*.15-uTime*3.);gl_FragColor=vec4(.65,.8,1.,core*flow*uOpacity*.5);}`;
const streamVertex=`attribute float lane;uniform float uTime;varying vec2 vUv;varying float vLane;void main(){vUv=uv;vLane=lane;float envelope=sin(uv.x*3.14159265);float phase=lane*2.399963;vec3 p=position;float spread=1.5+2.*sin(uv.x*7.+phase)*sin(uv.x*7.+phase);p+=vec3(cos(phase+uv.x*28.+uTime*.27),sin(phase+uv.x*21.-uTime*.18),cos(phase+uv.x*17.))*spread*envelope;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`;
const streamFragment=`uniform float uTime;uniform float uOpacity;uniform float uProgress;varying vec2 vUv;varying float vLane;void main(){float head=1.-smoothstep(uProgress-.06,uProgress+.005,vUv.x);float pulse=pow(.5+.5*sin(vUv.x*150.-uTime*7.+vLane*1.8),9.);float edge=sin(vUv.y*3.14159265);float ends=smoothstep(0.,.025,vUv.x);gl_FragColor=vec4(1.05,1.18,.97,head*edge*ends*(.2+pulse*1.3)*uOpacity);}`;

const blurVertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const blurFragment=`uniform sampler2D uTexture;uniform vec2 uDirection;uniform float uExtract;varying vec2 vUv;vec3 sampleLight(vec2 p){vec3 c=texture2D(uTexture,p).rgb;float l=max(c.r,max(c.g,c.b));return mix(c,c*smoothstep(.65,.98,l),uExtract);}void main(){vec3 c=sampleLight(vUv)*.227027;c+=(sampleLight(vUv+uDirection*1.384615)+sampleLight(vUv-uDirection*1.384615))*.316216;c+=(sampleLight(vUv+uDirection*3.230769)+sampleLight(vUv-uDirection*3.230769))*.070270;gl_FragColor=vec4(c,1.);}`;
const postVertex=blurVertex;
const postFragment=`uniform sampler2D uTexture;uniform sampler2D uBloom;uniform sampler2D uNormal;uniform float uStrength;uniform float uTime;uniform float uLiquid;varying vec2 vUv;void main(){vec2 ripples=texture2D(uNormal,vUv*2.1+vec2(uTime*.017,-uTime*.012)).rg*2.-1.;ripples+=.5*(texture2D(uNormal,vUv*3.4-vec2(uTime*.012,uTime*.016)).rg*2.-1.);vec2 uv=clamp(vUv+ripples*.025*uLiquid,.001,.999);vec3 c=texture2D(uTexture,uv).rgb;c.r=texture2D(uTexture,clamp(uv+ripples*.0014*uLiquid,.001,.999)).r;c.b=texture2D(uTexture,clamp(uv-ripples*.0014*uLiquid,.001,.999)).b;vec3 glow=texture2D(uBloom,uv).rgb;c+=glow*uStrength;float vignette=(1.-smoothstep(.24,.85,length((vUv-.5)*vec2(1.,.85))));c*=.9+.1*vignette;float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233))+uTime*.1)*43758.5453);c+=(grain-.5)/255.;gl_FragColor=vec4(c,1.);}`;
const skyVertex=`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const skyFragment=`uniform float uDim;varying vec3 vDir;void main(){float t=clamp(normalize(vDir).y*.7+.3,0.,1.);vec3 daylight=mix(vec3(.68,.85,.91),vec3(.38,.58,.89),t);vec3 shade=mix(vec3(.326,.412,.439),vec3(.20,.28,.33),t);gl_FragColor=vec4(mix(daylight,shade,uDim),1.);}`;

function geometry(data) {
  const g=new T.BufferGeometry();
  for(const [name,value] of Object.entries(data.attributes)) {
    if(name==='indices')g.setIndex(new T.BufferAttribute(value.array,1));
    else g.setAttribute(name,new T.BufferAttribute(value.array,value.size));
  }
  for(const [name,value] of [['alpha',1],['shadowmask',0],['trailRatio',0],['mask',0]])if(!g.getAttribute(name))g.setAttribute(name,new T.BufferAttribute(new Float32Array(data.count).fill(value),1));
  g.computeBoundingSphere();return g;
}
export async function createWebGL(canvas,context,onProgress) {
  const renderer=new T.WebGLRenderer({canvas,context,antialias:true,alpha:false});
  renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{throw new Error('Landscape shader did not compile: '+(gl.getShaderInfoLog(vertex)||gl.getShaderInfoLog(fragment)||gl.getProgramInfoLog(program)||'unknown shader error'));};
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  renderer.outputColorSpace=T.LinearSRGBColorSpace;
  renderer.setClearColor(0x91b8d5,1);
  const scene=new T.Scene(),groups=[new T.Group(),new T.Group(),new T.Group()];groups.forEach(g=>scene.add(g));
  const loadedTextures=new Map();let completed=0;
  const loader=new T.TextureLoader();
  const texture=path=>{
    if(!loadedTextures.has(path))loadedTextures.set(path,loader.loadAsync('/assets/'+path).then(tex=>{tex.colorSpace=T.NoColorSpace;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return tex;}));
    return loadedTextures.get(path);
  };
  const [data,texes,flow,mask,spline,trailData,waterNormal]=await Promise.all([
    Promise.all(landscapeModels.map(async spec=>{const value=await loadBuffer(spec.model);onProgress(++completed/25);return value;})),
    Promise.all(landscapeModels.map(async spec=>{const value=await texture(spec.texture);onProgress(++completed/25);return value;})),
    texture('textures/scene2/FLOW.webp'),texture('textures/scene2/TRAILS.webp'),loadBuffer('models/scene1/SC_01_TRAIL_SPLINE.buf'),Promise.all([0,1,2].map(i=>loadBuffer(`models/scene2/TRAIL_${i}.buf`))),texture('textures/waterNormal.jpg')
  ]);
  waterNormal.wrapS=waterNormal.wrapT=T.RepeatWrapping;
  const materials=[];
  landscapeModels.forEach((spec,i)=>{
    let mat;
    if(spec.scene===1)mat=new T.ShaderMaterial({vertexShader:riverVertex,fragmentShader:riverFragment,uniforms:{uTexture:{value:texes[i]},uPrevious:{value:texes[Math.max(2,i-1)]},uNext:{value:texes[Math.min(7,i+1)]},uFlow:{value:flow},uMask:{value:mask},uRoles:{value:new T.Vector3()},uTime:{value:0},uTile:{value:spec.tile}}});
    else mat=new T.ShaderMaterial({vertexShader:terrainVertex,fragmentShader:terrainFragment,uniforms:{uTexture:{value:texes[i]},uNormal:{value:waterNormal},uTime:{value:0},uDim:{value:0},uTrail:{value:0},uWater:{value:spec.water?1:0},uMountain:{value:spec.scene===0?1:0}},transparent:!!spec.alpha,depthWrite:!spec.alpha});
    materials.push(mat);const mesh=new T.Mesh(geometry(data[i]),mat);mesh.frustumCulled=false;groups[spec.scene].add(mesh);
    if(spec.shared){const second=mesh.clone();second.frustumCulled=false;groups[2].add(second);}
  });
  const points=[];for(let i=0;i<spline.count;i++)points.push(new T.Vector3().fromArray(spline.attributes.position.array,i*3));
  const streamMat=new T.ShaderMaterial({vertexShader:streamVertex,fragmentShader:streamFragment,uniforms:{uTime:{value:0},uOpacity:{value:0},uProgress:{value:0}},blending:T.AdditiveBlending,transparent:true,depthWrite:false,depthTest:false});
  const streamGeometry=new T.InstancedBufferGeometry().copy(new T.TubeGeometry(new T.CatmullRomCurve3(points),256,.24,3,false));
  streamGeometry.setAttribute('lane',new T.InstancedBufferAttribute(Float32Array.from({length:24},(_,i)=>i),1));streamGeometry.instanceCount=24;
  const stream=new T.Mesh(streamGeometry,streamMat);stream.frustumCulled=false;stream.renderOrder=4;groups[0].add(stream);
  const trailMats=trailData.map((data,i)=>{
    const mat=new T.ShaderMaterial({vertexShader:trailVertex,fragmentShader:trailFragment,uniforms:{uTime:{value:0},uOpacity:{value:0}},transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide});
    const mesh=new T.Mesh(geometry(data),mat);mesh.frustumCulled=false;mesh.renderOrder=4;groups[1].add(mesh);return mat;
  });
  // A lightweight sky gradient shared by all three landscapes.
  const sky=new T.Mesh(new T.SphereGeometry(4200,12,8),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,vertexShader:skyVertex,fragmentShader:skyFragment,uniforms:{uDim:{value:0}}}));
  sky.renderOrder=-10;scene.add(sky);
  const [birdData,birdAnimation,birdTexture,birdAlpha]=await Promise.all([loadBuffer('models/scene1/BIRD.buf'),loadBuffer('models/scene1/BIRD_ANIMATION.buf'),texture('textures/scene1/BIRD_TEXTURE_01.webp'),texture('textures/scene1/BIRD_ALPHA.webp')]);
  const birdSkin=new BirdSkin(birdData,birdAnimation),birdGeometry=geometry(birdData);
  birdGeometry.setAttribute('position',new T.BufferAttribute(birdSkin.positions,3).setUsage(T.DynamicDrawUsage));
  const bird=new T.Mesh(birdGeometry,new T.MeshBasicMaterial({map:birdTexture,alphaMap:birdAlpha,transparent:true,depthTest:false,depthWrite:false,side:T.DoubleSide}));
  bird.matrixAutoUpdate=false;bird.frustumCulled=false;bird.renderOrder=100;scene.add(bird);
  const birdMatrix=new T.Matrix4();
  const sceneTarget=new T.WebGLRenderTarget(1,1,{depthBuffer:true});
  const bloomA=new T.WebGLRenderTarget(1,1,{depthBuffer:false}),bloomB=new T.WebGLRenderTarget(1,1,{depthBuffer:false});
  const blurMat=new T.ShaderMaterial({vertexShader:blurVertex,fragmentShader:blurFragment,uniforms:{uTexture:{value:null},uDirection:{value:new T.Vector2()},uExtract:{value:1}},depthWrite:false,depthTest:false});
  const postMat=new T.ShaderMaterial({vertexShader:postVertex,fragmentShader:postFragment,uniforms:{uTexture:{value:sceneTarget.texture},uBloom:{value:bloomB.texture},uNormal:{value:waterNormal},uLiquid:{value:0},uStrength:{value:0},uTime:{value:0}},depthWrite:false,depthTest:false});
  const postScene=new T.Scene(),postCamera=new T.Camera(),quad=new T.Mesh(new T.PlaneGeometry(2,2),postMat);quad.frustumCulled=false;postScene.add(quad);
  let targetWidth=1,targetHeight=1;
  // Exercise every material before hiding the loader, including the river and
  // postprocessing programs. The caller can select the compatible renderer if
  // a device rejects a shader instead of leaving later chapters empty.
  const probe=new T.PerspectiveCamera(45,1,1,5000);probe.position.z=2500;
  renderer.setRenderTarget(sceneTarget);renderer.render(scene,probe);
  quad.material=blurMat;blurMat.uniforms.uTexture.value=sceneTarget.texture;
  renderer.setRenderTarget(bloomA);renderer.render(postScene,postCamera);
  quad.material=postMat;renderer.setRenderTarget(null);renderer.render(postScene,postCamera);
  onProgress(1);
  return {
    resize(w,h,dpr){renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);targetWidth=Math.max(1,Math.round(w*dpr));targetHeight=Math.max(1,Math.round(h*dpr));sceneTarget.setSize(targetWidth,targetHeight);bloomA.setSize(Math.ceil(targetWidth/2),Math.ceil(targetHeight/2));bloomB.setSize(Math.ceil(targetWidth/2),Math.ceil(targetHeight/2));},
    render(state,camera){
      groups.forEach((g,i)=>g.visible=i===state.group);
      materials.forEach(mat=>{
        mat.uniforms.uTime.value=state.time;
        if(mat.uniforms.uDim){mat.uniforms.uDim.value=state.dim;mat.uniforms.uTrail.value=state.trail;}
        if(mat.uniforms.uRoles)mat.uniforms.uRoles.value.fromArray(state.roleWeights);
      });
      streamMat.uniforms.uTime.value=state.time;streamMat.uniforms.uOpacity.value=state.dim*state.trailActive;streamMat.uniforms.uProgress.value=state.trail;
      trailMats.forEach((mat,i)=>{mat.uniforms.uTime.value=state.time;mat.uniforms.uOpacity.value=state.roleWeights[i];});
      sky.position.copy(camera.position);sky.material.uniforms.uDim.value=state.group===0?state.dim:0;
      bird.visible=!!state.birdModel;
      if(bird.visible){birdSkin.update(state.birdFrame);birdGeometry.attributes.position.needsUpdate=true;birdMatrix.fromArray(state.birdModel);bird.matrix.multiplyMatrices(camera.matrixWorld,birdMatrix);}
      renderer.setRenderTarget(sceneTarget);renderer.render(scene,camera);
      quad.material=blurMat;blurMat.uniforms.uTexture.value=sceneTarget.texture;blurMat.uniforms.uDirection.value.set(3/targetWidth,0);blurMat.uniforms.uExtract.value=1;
      renderer.setRenderTarget(bloomA);renderer.render(postScene,postCamera);
      blurMat.uniforms.uTexture.value=bloomA.texture;blurMat.uniforms.uDirection.value.set(0,4/targetHeight);blurMat.uniforms.uExtract.value=0;
      renderer.setRenderTarget(bloomB);renderer.render(postScene,postCamera);
      quad.material=postMat;postMat.uniforms.uStrength.value=.09+state.dim*.8;postMat.uniforms.uTime.value=state.time;
      postMat.uniforms.uLiquid.value=state.group===2?Math.max(0,Math.min(1,(state.unit-14.5)/.4))*Math.max(0,Math.min(1,(17.25-state.unit)/.7)):0;
      renderer.setRenderTarget(null);renderer.render(postScene,postCamera);
    }
  };
}
