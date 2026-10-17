import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { evaluateGlsl, evaluateWgsl } from "./lib/scalarShaderEval.mjs";
import { FILL_COVERAGE_GLSL, FILL_COVERAGE_WGSL, FILL_COVERAGE_VERTEX_GLSL, FILL_COVERAGE_VERTEX_WGSL } from "../src/fillCoverageShaders.ts";

const hooks=registerHooks({resolve(s,c,n){return n(c.parentURL?.includes("/src/")&&/^\.\.?\//.test(s)&&!/\.[a-z0-9]+$/i.test(s)?`${s}.ts`:s,c);}});
try{
  const { planarViewportFootprintInto }=await import("../src/planarProjection.ts");
  const variants=[["GLSL",evaluateGlsl,FILL_COVERAGE_VERTEX_GLSL,FILL_COVERAGE_GLSL],
    ["WGSL",evaluateWgsl,FILL_COVERAGE_VERTEX_WGSL,FILL_COVERAGE_WGSL]].map(([name,evaluate,vertex,fragment])=>{
    const functions=["heprFillInverseMarginBounds","heprTightFillMarginSupported","heprCoverageExpansionScale"].map(fn=>
      vertex.match(new RegExp(`(?:float|vec4|fn) ${fn}\\([\\s\\S]*?\\n}`))[0]).join("\n");
    return{name,...evaluate(functions),...evaluate(fragment)};
  });
  const viewport={width:1600,height:900},pixels={x:viewport.width,y:viewport.height};
  const vec=([x,y,z,w])=>({x,y,z,w}),array=v=>[v.x,v.y,v.z,v.w];
  const project=(m,x,y,w=1)=>[m[0]*x+m[4]*y+m[12]*w,m[1]*x+m[5]*y+m[13]*w,
    m[2]*x+m[6]*y+m[14]*w,m[3]*x+m[7]*y+m[15]*w];
  const screen=(m,x,y)=>{const c=project(m,x,y);return[c[0]/c[3]*pixels.x/2,c[1]/c[3]*pixels.y/2];};
  const marginAt=(m,x,y)=>{
    const c=project(m,x,y),w=c[3];
    const a=(m[0]-c[0]/w*m[3])/w*pixels.x/2,b=(m[4]-c[0]/w*m[7])/w*pixels.x/2;
    const cc=(m[1]-c[1]/w*m[3])/w*pixels.y/2,d=(m[5]-c[1]/w*m[7])/w*pixels.y/2;
    const det=Math.abs(a*d-b*cc);return[Math.hypot(d,b)/det,Math.hypot(cc,a)/det];
  };
  const inside=(q,x,y)=>[[0,1,2],[0,2,3]].some(ids=>{
    const sides=ids.map((id,i)=>{const a=q[id],b=q[ids[(i+1)%3]];return(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);});
    return sides.every(v=>v>=-1e-9)||sides.every(v=>v<=1e-9);
  });
  let certified=0,tiltedCertified=0,inkSamples=0,shrinking=0;
  for(const perspective of [false,true])for(const tilt of [0,15,30,45,60,80,89.99]){
    const camera=perspective?new THREE.PerspectiveCamera(45,pixels.x/pixels.y,1,10000):
      new THREE.OrthographicCamera(-1400,1400,787.5,-787.5,1,10000);
    const angle=tilt*Math.PI/180;camera.position.set(0,-1800*Math.sin(angle),1800*Math.cos(angle));
    camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const transform=new THREE.Matrix4().makeRotationZ(.25).scale(new THREE.Vector3(-1.1,.8,1));
    const m=Float32Array.from(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(transform).elements);
    const footprint=planarViewportFootprintInto(m,viewport,{minX:0,minY:0,maxX:0,maxY:0,maxUnitsPerPixel:0,unitsPerPixelX:0,unitsPerPixelY:0});
    if(!footprint)continue;
    const inverse=new THREE.Matrix3().set(m[0]*pixels.x/2,m[4]*pixels.x/2,m[12]*pixels.x/2,
      m[1]*pixels.y/2,m[5]*pixels.y/2,m[13]*pixels.y/2,m[3],m[7],m[15]).invert();
    const local=(x,y)=>{const p=new THREE.Vector3(x,y,1).applyMatrix3(inverse);return[p.x/p.z,p.y/p.z];};
    for(const box of [[-.1,-.2,.3,.5],[100,20,100.1,20.3],[-12,-1,12,1]])for(const aa of [.5,1,2])for(const shader of variants){
      const [x0,y0,x1,y1]=box,size=[x1-x0,y1-y0],center=project(m,(x0+x1)/2,(y0+y1)/2);
      const extent=Array.from({length:4},(_,i)=>Math.abs(m[i])*size[0]/2+Math.abs(m[i+4])*size[1]/2);
      const candidate=[footprint.unitsPerPixelX,footprint.unitsPerPixelY].map(u=>Math.max(u*.5*aa,.00005)+u*.00001);
      const old=[],next=[];let successes=0;
      for(const [cx,cy] of [[0,0],[1,0],[1,1],[0,1]]){
        const x=x0+size[0]*cx,y=y0+size[1]*cy,clip=project(m,x,y),raw=marginAt(m,x,y);
        const bounds=shader.heprFillInverseMarginBounds(vec(size),vec(raw),center[3]-extent[3],center[3]+extent[3],Math.abs(clip[3]),vec([m[3],m[7]]));
        // Compare the shipped analytic bounds with actual Jacobians throughout
        // the hull, including orientation changes and negative determinants.
        for(let ix=0;ix<=4;ix++)for(let iy=0;iy<=4;iy++){
          const actual=marginAt(m,x0+size[0]*ix/4,y0+size[1]*iy/4);
          assert(actual[0]>=bounds.x&&actual[0]<=bounds.z&&actual[1]>=bounds.y&&actual[1]<=bounds.w,
            `${shader.name}: inverse bounds enclose the entire projected hull`);
        }
        const expansion=Array.from({length:4},(_,i)=>Math.abs(m[i])*bounds.z+Math.abs(m[i+4])*bounds.w);
        const supported=candidate[0]<=bounds.x&&candidate[1]<=bounds.y&&
          shader.heprTightFillMarginSupported(vec(center),vec(extent),vec(expansion),pixels)>.5;
        const deltaX=project(m,raw[0],0,0),deltaY=project(m,0,raw[1],0);
        const scale=shader.heprCoverageExpansionScale(vec(clip),vec(deltaX),vec(deltaY),pixels);
        if(supported){assert.equal(scale,1,"certified original margins need no projection limiting");successes++;}
        const original=raw.map(u=>u*scale),selected=supported?candidate:original;
        old.push([x+(cx?1:-1)*original[0],y+(cy?1:-1)*original[1]]);
        next.push([x+(cx?1:-1)*selected[0],y+(cy?1:-1)*selected[1]]);
        if(supported)assert(selected.every((u,i)=>u<=original[i]),"tightening never increases either original margin");
      }
      if(!successes)continue;
      certified+=successes;shrinking++;
      if(perspective&&tilt>0)tiltedCertified+=successes;
      const projected=old.map(p=>screen(m,...p));
      const minX=Math.max(-pixels.x/2,Math.floor(Math.min(...projected.map(p=>p[0])))-2);
      const maxX=Math.min(pixels.x/2,Math.ceil(Math.max(...projected.map(p=>p[0])))+2);
      const minY=Math.max(-pixels.y/2,Math.floor(Math.min(...projected.map(p=>p[1])))-2);
      const maxY=Math.min(pixels.y/2,Math.ceil(Math.max(...projected.map(p=>p[1])))+2);
      const points=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
      for(let sx=minX+.5;sx<maxX;sx++)for(let sy=minY+.5;sy<maxY;sy++){
        const p=local(sx,sy),dx=local(sx+1,sy).map((v,i)=>v-p[i]),dy=local(sx,sy+1).map((v,i)=>v-p[i]);
        const width=Math.max(Math.hypot(dx[0],dy[0])*aa,.0001),height=Math.max(Math.hypot(dx[1],dy[1])*aa,.0001);
        const filter=vec([p[0]-width/2,p[1]-height/2,1/width,1/height]);
        let winding=0;
        for(let i=0;i<4;i++)winding+=shader.heprSegmentCoverage(vec(points[i]),vec(points[i]),vec(points[(i+1)%4]),false,filter,0,1);
        const alpha=shader.heprFillCoverage(winding,false)*.4;
        const before=inside(old,...p)?alpha:0,after=inside(next,...p)?alpha:0;
        assert(Math.abs(before-after)<1e-10,`${shader.name}: projected edge coverage and opacity survive tighter quads`);
        if(before>0)inkSamples++;
      }
    }
  }
  assert(certified>100&&inkSamples>100,"fixtures exercise both tightening and visible subpixel ink");
  assert(tiltedCertified>0,"genuinely tilted perspective views also use tighter padding");
  for(const shader of variants){
    const clip=vec([0,0,0,10]),zero=vec([0,0,0,0]);
    assert.equal(shader.heprTightFillMarginSupported(clip,zero,vec([.01,.01,0,0]),pixels),1);
    for(const extent of [vec([0,0,0,10]),vec([11,0,0,0]),vec([NaN,0,0,0])])
      assert.equal(shader.heprTightFillMarginSupported(clip,extent,zero,pixels),0);
    assert.equal(shader.heprTightFillMarginSupported(clip,zero,vec([0,0,0,10]),pixels),0);
  }
  console.log(`Projected closed-fill padding: ${shrinking} shrinking quads, ${certified} certified vertices (${tiltedCertified} tilted perspective) and ${inkSamples} visible samples preserve GLSL/WGSL coverage, opacity and projection limits.`);
}finally{hooks.deregister();}
