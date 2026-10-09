import{$t as e,A as t,Dt as n,Et as r,Ft as i,G as a,It as o,J as s,Jt as c,K as l,Kt as u,L as d,Lt as f,Mt as p,Nt as m,P as h,Qt as g,Si as _,W as v,Xt as y,Yt as b,Zn as x,Zt as S,_i as C,ai as w,bi as T,ci as ee,et as E,hi as D,ir as te,j as ne,li as re,mi as ie,oi as ae,or as oe,pi as se,qt as ce,rt as le,si as ue,sr as O,ui as de,ur as fe,wt as k,xt as pe}from"./drawCallMetrics-D8SN3rSM.js";import{c as me}from"./scenePaintQuery-CLBaPf97.js";import{S as he,_ as ge,b as _e,g as ve,h as ye,p as be,v as xe,x as Se,y as Ce}from"./structureData-DMK2kZdU.js";import{c as we,l as Te,m as Ee,o as De,u as Oe}from"./scenePaintGraph-BzrmcX_0.js";import{a as A,c as ke,d as Ae,m as je,s as Me,t as Ne}from"./monochromeRaster-BN5vDsqU.js";import{a as Pe,o as j,r as Fe,t as Ie}from"./rasterTiles-GlD7ia5J.js";import{C as Le,S as Re,_ as ze,a as Be,b as Ve,c as He,f as Ue,g as We,h as Ge,m as Ke,n as qe,p as Je,r as Ye,u as Xe,v as Ze,x as Qe,y as M}from"./textRasterAtlas-BNR5i65a.js";import{a as $e,c as et,g as tt,h as nt,l as rt,m as it,n as at,o as ot,p as st,r as ct,s as N,t as lt,u as ut}from"./searchHighlights-BIaBO6V-.js";import{n as dt,t as ft}from"./vectorFillBandShaders-CRyg2aoB.js";import{t as pt}from"./renderPerformance-DZ2bmysL.js";import{t as mt}from"./webGpuRasterCompression-Dgvahvmx.js";import{deferRendererInitialization as ht}from"./deferredRendererInitialization-CVYOkG4L.js";import{a as gt,i as _t,n as vt,r as yt,t as bt}from"./rasterStripWebGpuSampling-ZZGY41Kz.js";var P=272,xt=class{layout;device;stride;buffer=null;slots=0;nextSlot=1;retired=[];neutral=null;groups=new WeakMap;current=null;constructor(e){this.device=e;let t=globalThis.GPUShaderStage?.FRAGMENT??2;this.layout=e.createBindGroupLayout({entries:[{binding:0,visibility:t,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:P}},{binding:1,visibility:t,texture:{sampleType:`float`}}]});let n=Math.max(256,Number(e.limits?.minUniformBufferOffsetAlignment)||256);this.stride=Math.ceil(P/n)*n}beginFrame(){this.nextSlot=1;for(let e of this.retired)e.destroy();this.retired.length=0}begin(e,t,n,r){let i=this.nextSlot++;this.ensure(i+1);let a=i*this.stride,[o,s,c,l,u]=ne(n),d=new Float32Array(P/4);d.set([e,r?2:+!!t,u,0,o,s,c,l]),r&&d.set(r,8),this.device.queue.writeBuffer(this.buffer,a,d),this.current={offset:a,mask:t}}end(){this.current=null}bind(e,t){this.ensure(1);let n=this.current,r=n?.mask??this.neutral.view,i=this.groups.get(r);(!i||i.buffer!==this.buffer)&&(i={buffer:this.buffer,group:this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.buffer,size:P}},{binding:1,resource:r}]})},this.groups.set(r,i)),e.setBindGroup(t,i.group,[n?.offset??0])}dispose(){this.buffer?.destroy(),this.buffer=null,this.slots=0,this.beginFrame(),this.neutral?.texture.destroy(),this.neutral=null,this.groups=new WeakMap}ensure(e){if(!this.neutral){let e=globalThis.GPUTextureUsage,t=this.device.createTexture({size:[1,1],format:`rgba8unorm`,usage:(e?.TEXTURE_BINDING??4)|(e?.COPY_DST??2)});this.device.queue.writeTexture({texture:t},Uint8Array.of(255,255,255,255),{bytesPerRow:4},[1,1]),this.neutral={texture:t,view:t.createView()}}if(this.buffer&&this.slots>=e)return;this.buffer&&this.retired.push(this.buffer),this.slots=Math.max(64,this.slots*2,e);let t=globalThis.GPUBufferUsage;this.buffer=this.device.createBuffer({size:this.slots*this.stride,usage:(t?.UNIFORM??64)|(t?.COPY_DST??8)}),this.device.queue.writeBuffer(this.buffer,0,new Float32Array(P/4).fill(1,0,1))}},F=1024,St=2,Ct=class{unavailableReason;note=`WebGPU GPU times come from timestamps at the start and end of each render pass of a sampled frame: the frame time spans its first pass's start to its last pass's end, each operation is a whole render pass, and its instances count the pass's draws. Browsers may quantize these timestamps; Chrome rounds them to 100 µs unless its WebGPU developer features are enabled.`;device;slots=[];recording=null;results=[];constructor(e){this.device=e,this.unavailableReason=e?.features?.has?.(`timestamp-query`)?null:`The WebGPU device was created without the timestamp-query feature.`}beginFrame(e){if(this.unavailableReason)return!1;let t=this.slots.find(e=>e.state===`idle`)??null;return!t&&(this.slots.length>=St||(t=this.createSlot(),!t))?!1:(t.frame=e,t.passes=[],t.state=`recording`,t.cancelled=!1,this.recording=t,!0)}instrument(e){let t=this.recording;return t?new Proxy(e,{get:(e,n)=>{if(n===`beginRenderPass`)return n=>this.beginPass(e,t,n);let r=e[n];return typeof r==`function`?r.bind(e):r}}):e}endFrame(){let e=this.recording;if(this.recording=null,!e)return;let t=e.passes.length*2;if(!t){e.state=`idle`,this.results.push({frame:e.frame,ms:null});return}let n=this.device.createCommandEncoder();n.resolveQuerySet(e.querySet,0,t,e.resolve,0),n.copyBufferToBuffer(e.resolve,0,e.readback,0,t*8),this.device.queue.submit([n.finish()]),e.state=`reading`;let{frame:r,passes:i}=e,a=globalThis.GPUMapMode?.READ??1;e.readback.mapAsync(a,0,t*8).then(()=>{let n=new BigUint64Array(e.readback.getMappedRange(0,t*8).slice(0));e.readback.unmap(),e.cancelled||this.results.push(wt(r,i,n))},()=>{e.cancelled||this.results.push({frame:r,ms:null})}).finally(()=>{e.state=`idle`})}takeResults(){return this.results.splice(0)}cancel(){let e=0;for(let t of this.slots)t.state===`idle`||t.cancelled||(t.cancelled=!0,e++,t.state===`recording`&&(t.state=`idle`));return this.recording=null,this.results.length=0,e}dispose(){this.cancel();for(let e of this.slots)e.querySet.destroy?.(),e.resolve.destroy?.(),e.readback.destroy?.();this.slots.length=0}beginPass(e,t,n){if(t.state!==`recording`||t.passes.length>=F)return e.beginRenderPass(n);let r=t.passes.length*2,i={label:n.label??`pass`,draws:0};t.passes.push(i);let a=e.beginRenderPass({...n,timestampWrites:{querySet:t.querySet,beginningOfPassWriteIndex:r,endOfPassWriteIndex:r+1}});return new Proxy(a,{get:(e,t)=>{let n=e[t];return typeof n==`function`?t===`draw`||t===`drawIndexed`||t===`drawIndirect`||t===`drawIndexedIndirect`?(...t)=>(i.draws++,n.apply(e,t)):n.bind(e):n}})}createSlot(){try{let e=globalThis.GPUBufferUsage,t=F*2*8,n={querySet:this.device.createQuerySet({type:`timestamp`,count:F*2}),resolve:this.device.createBuffer({size:t,usage:(e?.QUERY_RESOLVE??512)|(e?.COPY_SRC??4)}),readback:this.device.createBuffer({size:t,usage:(e?.MAP_READ??1)|(e?.COPY_DST??8)}),frame:0,passes:[],state:`idle`,cancelled:!1};return this.slots.push(n),n}catch{return null}}};function wt(e,t,n){let r=1/0,i=-1/0,a=[];for(let o=0;o<t.length;o++){let s=Number(n[o*2]),c=Number(n[o*2+1]);if(!(s>0)||!(c>=s))return{frame:e,ms:null};r=Math.min(r,s),i=Math.max(i,c);let l=t[o].label;a.push({label:l,ms:(c-s)/1e6,order:o,call:`renderPass`,vertices:null,instances:t[o].draws,pixels:null,target:l===`frame`?`screen`:`offscreen`,viewport:[0,0],scissor:null})}return{frame:e,ms:(i-r)/1e6,operations:a}}var Tt=`
${E}
${le}
fn heprMonochromeBit(pixel : vec2i, size : vec2i) -> f32 {
  let p = clamp(pixel, vec2i(0), size - vec2i(1));
  
  let packed = u32(round(textureLoad(uRasterTex, vec2i(p.x / 8, p.y), 0).r * 255.0));
  return f32((packed >> (7u - (u32(p.x) & 7u))) & 1u);
}

fn heprMonochromeBilinear(uv : vec2f, size : vec2i) -> f32 {
  let position = uv * vec2f(size) - vec2f(0.5);
  let pixel = vec2i(floor(position));
  let weight = fract(position);
  return mix(
    mix(heprMonochromeBit(pixel, size), heprMonochromeBit(pixel + vec2i(1, 0), size), weight.x),
    mix(heprMonochromeBit(pixel + vec2i(0, 1), size), heprMonochromeBit(pixel + vec2i(1, 1), size), weight.x),
    weight.y
  );
}

fn heprMonochromeColor(uv : vec2f, uvDx : vec2f, uvDy : vec2f) -> vec4f {
  
  let compact = fract(abs(uRaster.matrixB.w)) > 0.25;
  var size = vec2i(i32(abs(uRaster.matrixB.w)), i32(textureDimensions(uRasterTex).y));
  if (compact) { size = vec2i(i32(heprCompactWord(uRasterTex, 0u)), i32(heprCompactWord(uRasterTex, 1u))); }
  let footprint = max(length(uvDx * vec2f(size)), length(uvDy * vec2f(size)));
  let lod = max(log2(max(footprint, 1.0)), 0.0);
  var coverage : f32;
  if (compact) {
    coverage = heprCompactSample(uRasterTex, size, uv, lod);
  } else if (lod < 1.0) {
    var base : f32;
    if (uRaster.matrixB.w < 0.0) {
      base = textureSampleLevel(uRasterTex, uRasterSampler, uv, 0.0).r;
    } else { base = heprMonochromeBilinear(uv, size); }
    let reduced = heprPackedCoverage(uRasterCoverageTex, size, uv, 0.0);
    coverage = mix(base, reduced, lod);
  } else {
    coverage = heprPackedCoverage(uRasterCoverageTex, size, uv, lod - 1.0);
  }
  return mix(uRaster.zeroColor, uRaster.oneColor, coverage);
}
`,Et=`
struct CameraUniforms {
  viewport : vec2f,
  cameraCenter : vec2f,
  zoom : f32,
  strokeAAScreenPx : f32,
  strokeCurveEnabled : f32,
  textAAScreenPx : f32,
  textCurveEnabled : f32,
  fillAAScreenPx : f32,
  textVectorOnly : f32,
  pad0 : f32,
  vectorOverride : vec4f,
};

struct RasterStripInstance {
  matrixA : vec4f,
  matrixB : vec4f,
};

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var<storage, read> uInstances : array<RasterStripInstance>;
@group(0) @binding(2) var uRasterSampler : sampler;
@group(0) @binding(3) var uRasterTex : texture_2d<f32>;
@group(1) @binding(0) var uVectorClipTex : texture_2d<f32>;
@group(1) @binding(1) var<uniform> uVectorClip : vec4f;
${pe}

struct VsOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
  @location(1) world : vec2f,
  @location(2) @interpolate(flat) row : u32,
  @location(3) @interpolate(flat) width : f32,
  @location(4) @interpolate(flat) opacity : f32,
};

@vertex
fn vsMain(
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32
) -> VsOut {
  let uv = vec2f(f32(vertexIndex & 1u), 1.0 - f32(vertexIndex >> 1u));
  let instance = uInstances[instanceIndex];
  let world = vec2f(
    instance.matrixA.x * uv.x + instance.matrixA.z * uv.y + instance.matrixB.x,
    instance.matrixA.y * uv.x + instance.matrixA.w * uv.y + instance.matrixB.y
  );
  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  var out : VsOut;
  out.position = vec4f(screen / (0.5 * uCamera.viewport) - 1.0, 0.0, 1.0);
  out.uv = uv;
  out.world = world;
  out.row = instanceIndex;
  out.width = instance.matrixB.z;
  out.opacity = instance.matrixB.w;
  return out;
}

${bt}
${vt}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  
  let clipAAWidth = max(max(length(vec2f(dpdx(inData.world.x), dpdy(inData.world.x))),
    length(vec2f(dpdx(inData.world.y), dpdy(inData.world.y)))), 1e-4);
  let color = heprRasterStripSample(
    uRasterTex, uRasterSampler, inData.uv, inData.row, u32(inData.width)
  ) * inData.opacity;
  if (color.a <= 0.001) { discard; }
  return color * heprVectorClipAA(inData.world, uVectorClip.x, uVectorClipTex, clipAAWidth);
}
`,Dt=[`composite`,`stats`,`extract`,`shapeExtract`,`softMask`,`copy`,`blendLayer`],Ot=new WeakMap;function I(e,t){let n=e.beginRenderPass(t),r={encoder:e,descriptor:t,pause(){n.end()},resume(){return n=e.beginRenderPass({...t,colorAttachments:t.colorAttachments.map(e=>({...e,loadOp:`load`}))}),n}},i=new Proxy({},{get(e,t){let r=n[t];return typeof r==`function`?r.bind(n):r}});return Ot.set(i,r),i}var kt=class{blendsPasses=!0;device;format;pipeline;blendPipeline;zero;one;uniforms=[];uniformIndex=0;uniformEncoder=null;transfers=new Map;pool=[];all=new Set;width=0;height=0;approximationReported=!1;encoder;activePass=null;drawSpan=null;scene=null;gradientMask=null;folding=null;pendingClears=new Map;project=null;viewportWidth=0;viewportHeight=0;onDraw;constructor(e,t,n){this.device=e,this.format=t,this.onDraw=n;let r=e.createShaderModule({code:h}),i=e.createBindGroupLayout({entries:[{binding:0,visibility:2,buffer:{type:`uniform`,minBindingSize:48}},...Array.from({length:7},(e,t)=>({binding:t+1,visibility:2,texture:{sampleType:`unfilterable-float`}}))]}),a=n=>({layout:e.createPipelineLayout({bindGroupLayouts:[i]}),vertex:{module:r,entryPoint:`vs`},fragment:{module:r,entryPoint:`fs`,targets:[{format:t,...n?{blend:n}:{}}]},primitive:{topology:`triangle-list`}});this.pipeline=e.createRenderPipeline(a());let o={srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`};this.blendPipeline=e.createRenderPipeline(a({color:o,alpha:o})),this.zero=this.constant(new Uint8Array(4)),this.one=this.constant(Uint8Array.of(255,255,255,255))}render(e,t,n,r,i,a,o=null,s=null,c=null){let l=Ot.get(t);if(!l)throw Error(`PDF compositing requires a managed render pass.`);if(!Number.isSafeInteger(n)||!Number.isSafeInteger(r)||n<=0||r<=0)throw RangeError(`PDF compositor dimensions must be positive integers.`);let u=this.uniformEncoder!==l.encoder,d=Ke(e,n,r);if(!u){let t=[...this.all].filter(e=>e.width!==d.width||e.height!==d.height).reduce((e,t)=>e+t.width*t.height*4,0);d=Ke(e,n,r,Math.max(4096,Je-t))}d.scale<1&&!this.approximationReported&&(this.approximationReported=!0,console.warn(`[hepr] PDF composite surfaces use ${d.width}×${d.height} instead of ${n}×${r} to stay within the memory budget.`)),u&&(this.uniformIndex=0,this.uniformEncoder=l.encoder,this.trimSurfaces(d.width,d.height)),this.width=d.width,this.height=d.height,this.encoder=l.encoder,this.drawSpan=i,this.folding=c,this.scene=e,this.project=s,this.viewportWidth=n,this.viewportHeight=r,l.pause();let f=null,p=null,m=!1;try{f=this.acquire(),this.pass({operation:5,source:{view:l.descriptor.colorAttachments[0].view,texture:null}},f),p=Ge(e,this,f,a,o,!0),this.flushClears([p]),this.endPass();let t=l.resume();m=!0,this.encode({operation:5,source:p},t,n,r)}catch(e){throw this.endPass(),m||l.resume(),e}finally{p&&this.release(p),f&&f!==p&&this.release(f),this.pendingClears.clear(),this.drawSpan=null,this.folding=null,this.scene=null,this.gradientMask=null,this.encoder=null,this.project=null}}acquire(){let e=this.pool.findIndex(e=>e.width===this.width&&e.height===this.height);if(e>=0)return this.pool.splice(e,1)[0];if([...this.all].reduce((e,t)=>e+t.width*t.height*4,0)+this.width*this.height*4>536870912)throw RangeError(`PDF compositing surfaces exceed 512 MiB.`);let t=this.device.createTexture({size:[this.width,this.height],format:this.format,usage:23}),n={texture:t,view:t.createView(),width:this.width,height:this.height};return this.all.add(n),n}release(e){this.pendingClears.delete(e),this.pool.push(e)}clear(e,t=[0,0,0,0]){this.endPass(),this.pendingClears.set(e,{r:t[0],g:t[1],b:t[2],a:t[3]})}copy(e,t,n){this.endPass();let r=this.scissor(n);if(this.flushClears([e]),r?this.flushClears([t]):this.pendingClears.delete(t),!r){this.encoder.copyTextureToTexture({texture:e.texture},{texture:t.texture},[this.width,this.height]);return}if(r.width===0||r.height===0)return;let i={x:r.x,y:this.height-r.y-r.height};this.encoder.copyTextureToTexture({texture:e.texture,origin:i},{texture:t.texture,origin:i},[r.width,r.height])}scissor(e){return We(e,this.project,this.viewportWidth,this.viewportHeight,this.width,this.height)}draw(e,t,n){if(e.length===0)return;let r=this.renderPass(t,`span`);this.drawSpan(e,r,n)}canFold(e){return this.folding?.canFold(e)??!1}canFoldMaskPaint(e,t){return this.gradientMask=null,!this.scene||!this.folding?.canFoldMaskPaint?.(e,t)?!1:(this.gradientMask=d(this.scene,t,e.clipIndex,this.project,this.width,this.height,this.viewportWidth,this.viewportHeight,!0),this.gradientMask!==null)}drawFolded(e,t,n,r,i,a){r&&this.flushClears([r]);let o=this.renderPass(t,`fold`);this.folding.draw(e,o,n,r?.view??null,i,a?this.gradientMask:void 0)}pass(e,t){let n=this.scissor(e.bounds);if(n&&(n.width===0||n.height===0))return;this.flushClears([e.source,e.shape,e.current,e.stats,e.initial,e.mask].filter(e=>e!==void 0&&e!==t));let r=this.renderPass(t,`composite:${Dt[e.operation]}`);n&&r.setScissorRect(n.x,this.height-n.y-n.height,n.width,n.height),this.encode(e,r)}dispose(){this.releaseSurfaces(),this.zero.texture.destroy(),this.one.texture.destroy();for(let e of this.uniforms)e.destroy();this.uniforms.length=0;for(let e of this.transfers.values())e.texture.destroy();this.transfers.clear()}attachment(e){let t=this.pendingClears.get(e);return t?(this.pendingClears.delete(e),{view:e.view,loadOp:`clear`,storeOp:`store`,clearValue:t}):{view:e.view,loadOp:`load`,storeOp:`store`}}renderPass(e,t){this.activePass?.target!==e&&this.endPass(),this.activePass||={target:e,pass:this.encoder.beginRenderPass({label:t,colorAttachments:[this.attachment(e)]})};let n=this.activePass.pass;return n.setScissorRect(0,0,this.width,this.height),n}endPass(){let e=this.activePass;this.activePass=null,e?.pass.end()}flushClears(e){for(let t of e){let e=this.pendingClears.get(t);e&&(this.endPass(),this.pendingClears.delete(t),this.encoder.beginRenderPass({label:`clear`,colorAttachments:[{view:t.view,loadOp:`clear`,storeOp:`store`,clearValue:e}]}).end())}}encode(e,t,n=this.width,r=this.height){let i=e.softMask?.transfer,a=new Float32Array([e.operation,e.blendMode??0,+!!e.knockout,e.opacity??1,+!!e.alphaIsShape,+(e.softMask?.subtype===`Luminosity`),i?.length??0,+!!e.isolated,...e.operation===5?[n,r,0]:e.softMask?.backdrop??[0,0,0],0]),o=this.uniformIndex++;if(o>=262144)throw RangeError(`PDF compositing exceeds its per-encoder pass budget.`);let s=this.uniforms[o]??(this.uniforms[o]=this.device.createBuffer({size:48,usage:72}));this.device.queue.writeBuffer(s,0,a);let c=[e.source,e.shape,e.current,e.stats,e.initial,e.mask??this.one,i?this.transferTexture(i):this.zero],l=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:s,size:48}},...c.map((e,t)=>({binding:t+1,resource:(e??this.zero).view}))]});t.setPipeline(e.blend?this.blendPipeline:this.pipeline),t.setBindGroup(0,l),t.draw(3),this.onDraw?.()}constant(e){let t=this.device.createTexture({size:[1,1],format:this.format,usage:6});return this.device.queue.writeTexture({texture:t},e,{},[1,1]),{texture:t,view:t.createView()}}transferTexture(e){let t=this.transfers.get(e);if(t)return t;let n=Math.min(e.length,this.device.limits.maxTextureDimension2D),r=Math.ceil(e.length/n),i=new Float32Array(n*r);i.set(e);let a=this.device.createTexture({size:[n,r],format:`r32float`,usage:6});return this.device.queue.writeTexture({texture:a},i,{bytesPerRow:n*4},[n,r]),t={texture:a,view:a.createView()},this.transfers.set(e,t),t}releaseSurfaces(){for(let e of this.all)e.texture.destroy();this.all.clear(),this.pool.length=0}trimSurfaces(e,t){for(let n=this.pool.length-1;n>=0;n--){let r=this.pool[n];(r.width!==e||r.height!==t)&&(r.texture.destroy(),this.all.delete(r),this.pool.splice(n,1))}}};function L(e,t,n){return!e.monochrome&&!!e.gpuCompression&&e.gpuCompression.format===n&&j(e.gpuCompression.plan,t)&&e.gpuCompression.tiles.length===t.tiles.length}function At(e,t){return!!e.gpuPreparation&&j(e.gpuPreparation.plan,t)}var jt=140,Mt=.92,Nt=2,Pt=24,R=1e-4,z=1e-5,Ft=64,It=2,Lt=5,Rt=2e4,zt=120,B={r:160/255,g:169/255,b:175/255,a:1},Bt=24,V=96,Vt=4,H=16,Ht=24,U=96,W=`
fn heprEncodeOutputColor(color : vec4f) -> vec4f {
  
  
  return color;
}

fn heprLinearCoverageToOutputAlpha(coverage : f32) -> f32 {
  return clamp(coverage, 0.0, 1.0);
}
`,Ut=`
${i}
${o}
struct CameraUniforms {
  viewport : vec2f,
  cameraCenter : vec2f,
  zoom : f32,
  strokeAAScreenPx : f32,
  strokeCurveEnabled : f32,
  textAAScreenPx : f32,
  textCurveEnabled : f32,
  fillAAScreenPx : f32,
  textVectorOnly : f32,
  pad0 : f32,
  vectorOverride : vec4f,
  fillBands : vec4f,
  fillCells : vec4f,
};

struct SegmentIdBuffer {
  values : array<u32>,
};

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uSegmentTexA : texture_2d<f32>;
@group(0) @binding(2) var uSegmentTexB : texture_2d<f32>;
@group(0) @binding(3) var uSegmentStyleTex : texture_2d<f32>;
@group(0) @binding(4) var uSegmentBoundsTex : texture_2d<f32>;
@group(0) @binding(5) var<storage, read> uSegmentIds : SegmentIdBuffer;

struct VsOut {
  @location(11) @interpolate(flat) vectorClipIndex: f32,
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) p0 : vec2f,
  @location(2) @interpolate(flat) p1 : vec2f,
  @location(3) @interpolate(flat) p2 : vec2f,
  @location(4) @interpolate(flat) primitiveType : f32,
  @location(5) @interpolate(flat) halfWidth : f32,
  @location(6) @interpolate(flat) aaWorld : f32,
  @location(7) @interpolate(flat) color : vec3f,
  @location(8) @interpolate(flat) alpha : f32,
  @location(9) @interpolate(flat) clipBounds : vec4f,
  @location(10) @interpolate(flat) hasClipBounds : f32,
};

${W}

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

fn coordFromIndex(index : u32, width : u32) -> vec2<i32> {
  return vec2<i32>(i32(index % width), i32(index / width));
}

${yt}
${_t}
${gt}
@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> VsOut {
  var segmentIndex: u32;
  if (uVectorClip.x < -1.5) { segmentIndex = uOrderedInstances[instanceIndex].x; }
  else { segmentIndex = uSegmentIds.values[instanceIndex]; }
  let dims = textureDimensions(uSegmentTexA);
  let coord = coordFromIndex(segmentIndex, dims.x);

  let primitiveA = textureLoad(uSegmentTexA, coord, 0);
  let primitiveB = textureLoad(uSegmentTexB, coord, 0);
  let style = textureLoad(uSegmentStyleTex, coord, 0);
  let primitiveBounds = textureLoad(uSegmentBoundsTex, coord, 0);

  let p0 = primitiveA.xy;
  let p1 = primitiveA.zw;
  let p2 = primitiveB.xy;
  let primitiveType = primitiveB.z;
  let isQuadratic = primitiveType >= 0.5;

  var halfWidth = style.x;
  let color = style.yzw;
  let packedStyle = primitiveB.w;
  let styleFlags = i32(floor(packedStyle / 2.0 + 1e-6));
  let alpha = clamp(packedStyle - f32(styleFlags) * 2.0, 0.0, 1.0);
  let isHairline = (styleFlags & 1) != 0;
  let isRoundCap = (styleFlags & 2) != 0;
  let isClipped = (styleFlags & 4) != 0;

  let geometryLength = select(length(p2 - p0), length(p1 - p0) + length(p2 - p1), isQuadratic);

  var out : VsOut;
  out.vectorClipIndex = uVectorClip.x;
  if (uVectorClip.x < -1.5) { out.vectorClipIndex = f32(uOrderedInstances[instanceIndex].y) - 1.0; }
  if ((geometryLength == 0.0 && !isRoundCap) || alpha <= 0.001) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0, 0.0);
    out.p0 = vec2f(0.0, 0.0);
    out.p1 = vec2f(0.0, 0.0);
    out.p2 = vec2f(0.0, 0.0);
    out.primitiveType = 0.0;
    out.halfWidth = 0.0;
    out.aaWorld = 1.0;
    out.color = color;
    out.alpha = 0.0;
    out.clipBounds = vec4f(0.0, 0.0, 0.0, 0.0);
    out.hasClipBounds = 0.0;
    return out;
  }

  if (isHairline) {
    halfWidth = max(0.5 / max(uCamera.zoom, 1e-4), 1e-5);
  }

  var aaWorld = max(1.0 / max(uCamera.zoom, 1e-4), 0.0001) * uCamera.strokeAAScreenPx;
  if (isHairline) {
    aaWorld = max(0.35 / max(uCamera.zoom, 1e-4), 5e-5);
  }

  let extent = halfWidth + aaWorld;
  let corner01 = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let worldPosition = heprStrokeQuadWorldPosition(corner01, p0, p1, p2, primitiveBounds, extent);

  let screen = (worldPosition - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  let clip = (screen / (0.5 * uCamera.viewport)) - 1.0;

  out.position = vec4f(clip, 0.0, 1.0);
  out.local = worldPosition;
  out.p0 = p0;
  out.p1 = p1;
  out.p2 = p2;
  out.primitiveType = primitiveType;
  out.halfWidth = halfWidth;
  out.aaWorld = aaWorld;
  out.color = color;
  out.alpha = alpha;
  out.clipBounds = primitiveBounds;
  out.hasClipBounds = select(0.0, 1.0, isClipped);
  return out;
}

@group(1) @binding(0) var uVectorClipTex: texture_2d<f32>;
@group(1) @binding(1) var<uniform> uVectorClip: vec4f;
@group(1) @binding(2) var<storage, read> uOrderedInstances: array<vec2u>;
${k}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  if (inData.alpha <= 0.001) {
    discard;
  }

  if (
    inData.hasClipBounds >= 0.5 &&
    (inData.local.x < inData.clipBounds.x || inData.local.y < inData.clipBounds.y ||
      inData.local.x > inData.clipBounds.z || inData.local.y > inData.clipBounds.w)
  ) {
    discard;
  }

  let useCurve = uCamera.strokeCurveEnabled >= 0.5 && inData.primitiveType >= 0.5;
  let distanceToSegment = select(
    heprDistanceToLineSegment(inData.local, inData.p0, inData.p2),
    heprDistanceToQuadraticBezier(inData.local, inData.p0, inData.p1, inData.p2),
    useCurve
  );

  let coverage = heprStrokeCoverage(distanceToSegment, inData.halfWidth, inData.aaWorld);
  var alpha = heprLinearCoverageToOutputAlpha(coverage) * inData.alpha;
  alpha = heprStrokeLodAlpha(alpha, inData.primitiveType);

  if (alpha <= 0.0) {
    discard;
  }

  let color = mix(inData.color, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return heprEncodeOutputColor(vec4f(color, alpha)) * heprVectorClip(inData.local, inData.vectorClipIndex, uVectorClipTex);
}
`,Wt=`
struct CameraUniforms {
  viewport : vec2f,
  cameraCenter : vec2f,
  zoom : f32,
  strokeAAScreenPx : f32,
  strokeCurveEnabled : f32,
  textAAScreenPx : f32,
  textCurveEnabled : f32,
  fillAAScreenPx : f32,
  textVectorOnly : f32,
  pad0 : f32,
  vectorOverride : vec4f,
  fillBands : vec4f,
  fillCells : vec4f,
};

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uFillPathMetaTexA : texture_2d<f32>;
@group(0) @binding(2) var uFillPathMetaTexB : texture_2d<f32>;
@group(0) @binding(3) var uFillPathMetaTexC : texture_2d<f32>;
@group(0) @binding(4) var uFillSegmentTexA : texture_2d<f32>;
@group(0) @binding(5) var uFillSegmentTexB : texture_2d<f32>;

struct VsOut {
  @location(11) @interpolate(flat) vectorClipIndex: f32,
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) segmentStart : i32,
  @location(2) @interpolate(flat) segmentCount : i32,
  @location(3) @interpolate(flat) color : vec3f,
  @location(4) @interpolate(flat) alpha : f32,
  @location(5) @interpolate(flat) fillRule : f32,
  @location(6) @interpolate(flat) fillHasCompanionStroke : f32,
  @location(7) @interpolate(flat) bands : vec4f,
  @location(8) @interpolate(flat) cells : vec4f,
  @location(9) @interpolate(flat) origin : vec2f,
};

${W}
${ft}
${n}

const FILL_PRIMITIVE_QUADRATIC : f32 = 1.0;
fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

fn coordFromIndex(index : i32, width : i32) -> vec2<i32> {
  return vec2<i32>(index % width, index / width);
}

${m}
${p}
${r}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> VsOut {
  let metaDims = textureDimensions(uFillPathMetaTexA);
  var pathIndex = i32(instanceIndex);
  if (uVectorClip.x < -1.5) { pathIndex = i32(uOrderedInstances[instanceIndex].x); }
  let coord = coordFromIndex(pathIndex, i32(metaDims.x));

  let metaA = textureLoad(uFillPathMetaTexA, coord, 0);
  let metaB = textureLoad(uFillPathMetaTexB, coord, 0);
  let metaC = textureLoad(uFillPathMetaTexC, coord, 0);

  let segmentCount = i32(metaA.y);
  let alpha = metaC.w;

  var out : VsOut;
  out.bands = heprFillBandInfo(f32(pathIndex), uCamera.fillBands.x, uFillSegmentTexA);
  out.cells = heprFillCellInfo(f32(pathIndex), uCamera.fillCells.x, uFillSegmentTexA);
  out.origin = metaA.zw;
  out.vectorClipIndex = uVectorClip.x;
  if (uVectorClip.x < -1.5) { out.vectorClipIndex = f32(uOrderedInstances[instanceIndex].y) - 1.0; }
  if (segmentCount <= 0 || alpha <= 0.001) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0, 0.0);
    out.segmentStart = 0;
    out.segmentCount = 0;
    out.color = vec3f(0.0, 0.0, 0.0);
    out.alpha = 0.0;
    out.fillRule = 0.0;
    out.fillHasCompanionStroke = 0.0;
    return out;
  }

  let minBounds = metaA.zw;
  let maxBounds = metaB.xy;
  let corner01 = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  
  
  let margin = heprCoverageMargin(mat2x2f(uCamera.zoom, 0.0, 0.0, uCamera.zoom));
  let world = mix(minBounds - margin, maxBounds + margin, corner01);

  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  let clip = (screen / (0.5 * uCamera.viewport)) - 1.0;

  out.position = vec4f(clip, 0.0, 1.0);
  out.local = world;
  out.segmentStart = i32(metaA.x);
  out.segmentCount = segmentCount;
  out.color = vec3f(metaB.z, metaB.w, metaC.z);
  out.alpha = alpha;
  out.fillRule = metaC.x;
  out.fillHasCompanionStroke = metaC.y;
  return out;
}

@group(1) @binding(0) var uVectorClipTex: texture_2d<f32>;
@group(1) @binding(1) var<uniform> uVectorClip: vec4f;
@group(1) @binding(2) var<storage, read> uOrderedInstances: array<vec2u>;
${k}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  
  let footprint = max(vec2f(
    length(vec2f(dpdx(inData.local.x), dpdy(inData.local.x))),
    length(vec2f(dpdx(inData.local.y), dpdy(inData.local.y)))
  ) * uCamera.fillAAScreenPx, vec2f(1e-4));

  if (inData.segmentCount <= 0 || inData.alpha <= 0.001) {
    discard;
  }

  let fillSegDims = textureDimensions(uFillSegmentTexA);

  
  
  
  let box = vec4f(inData.local - 0.5 * footprint, 1.0 / footprint);
  var winding = 0.0;
  if (inData.cells.y > 0.0) {
    winding = heprCellWinding(inData.cells, inData.origin, box, footprint, uFillSegmentTexA, uFillSegmentTexB);
  } else {
${dt({bands:`inData.bands`,y:`inData.local.y`,radius:`0.5 * footprint.y`,count:`inData.segmentCount`,start:`inData.segmentStart`,texture:`uFillSegmentTexA`,entries:`uCamera.fillBands.y`,setup:`let rows = heprBandRows(bandInfo, band, bandCount, box);`,edge:`
    let coord = coordFromIndex(segmentIndex, i32(fillSegDims.x));
    let primitiveA = textureLoad(uFillSegmentTexA, coord, 0);
    let primitiveB = textureLoad(uFillSegmentTexB, coord, 0);
    winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
      primitiveB.z >= FILL_PRIMITIVE_QUADRATIC, box, rows.x, rows.y);
`})}
  }

  let color = mix(inData.color, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  
  
  let coverage = heprFillCoverage(winding, inData.fillRule >= 0.5);
  let alpha = heprLinearCoverageToOutputAlpha(coverage) * inData.alpha;
  if (alpha <= 0.001) {
    discard;
  }

  return heprEncodeOutputColor(vec4f(color, alpha)) * heprVectorClip(inData.local, inData.vectorClipIndex, uVectorClipTex);
}
`,Gt=`
struct CameraUniforms {
  viewport : vec2f,
  cameraCenter : vec2f,
  zoom : f32,
  strokeAAScreenPx : f32,
  strokeCurveEnabled : f32,
  textAAScreenPx : f32,
  textCurveEnabled : f32,
  fillAAScreenPx : f32,
  textVectorOnly : f32,
  pad0 : f32,
  vectorOverride : vec4f,
  fillBands : vec4f,
  fillCells : vec4f,
};

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uTextInstanceTexA : texture_2d<f32>;
@group(0) @binding(2) var uTextInstanceTexB : texture_2d<f32>;
@group(0) @binding(3) var uTextInstanceTexC : texture_2d<f32>;
@group(0) @binding(4) var uTextGlyphMetaTexA : texture_2d<f32>;
@group(0) @binding(5) var uTextGlyphMetaTexB : texture_2d<f32>;
@group(0) @binding(6) var uTextGlyphSegmentTexA : texture_2d<f32>;
@group(0) @binding(7) var uTextGlyphSegmentTexB : texture_2d<f32>;
@group(0) @binding(8) var uTextGlyphRasterMetaTex : texture_2d<f32>;
@group(0) @binding(9) var uTextRasterSampler : sampler;
@group(0) @binding(10) var uTextRasterAtlasTex : texture_2d<f32>;

struct TextInstanceIdBuffer {
  values : array<u32>,
};

@group(0) @binding(11) var<storage, read> uTextInstanceIds : TextInstanceIdBuffer;

struct VsOut {
  @location(11) @interpolate(flat) vectorClipIndex: f32,
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) segmentStart : i32,
  @location(2) @interpolate(flat) segmentCount : i32,
  @location(3) @interpolate(flat) color : vec3f,
  @location(4) @interpolate(flat) colorAlpha : f32,
  @location(5) @interpolate(flat) rasterRect : vec4f,
  @location(6) normCoord : vec2f,
  @location(7) world : vec2f,
  @location(8) @interpolate(flat) clipRect : vec4f,
  @location(9) @interpolate(flat) inkDensity : f32,
};

${W}

const TEXT_PRIMITIVE_QUADRATIC : f32 = 1.0;

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

fn coordFromIndex(index : i32, width : i32) -> vec2<i32> {
  return vec2<i32>(index % width, index / width);
}

${m}
${p}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> VsOut {
  let instanceDims = textureDimensions(uTextInstanceTexA);
  let glyphMetaDims = textureDimensions(uTextGlyphMetaTexA);

  
  
  var selectedInstanceIndex = instanceIndex;
  if (uVectorClip.x < -1.5) {
    selectedInstanceIndex = uOrderedInstances[instanceIndex].x;
  } else if (uCamera.pad0 >= 0.5) {
    selectedInstanceIndex = uTextInstanceIds.values[instanceIndex];
  }
  let instanceIndexI = i32(selectedInstanceIndex);
  let instanceCoord = coordFromIndex(instanceIndexI, i32(instanceDims.x));

  let instanceA = textureLoad(uTextInstanceTexA, instanceCoord, 0);
  let instanceB = textureLoad(uTextInstanceTexB, instanceCoord, 0);
  let instanceC = textureLoad(uTextInstanceTexC, instanceCoord, 0);

  let glyphIndex = i32(instanceB.z);
  let glyphCoord = coordFromIndex(glyphIndex, i32(glyphMetaDims.x));
  let glyphMetaA = textureLoad(uTextGlyphMetaTexA, glyphCoord, 0);
  let glyphMetaB = textureLoad(uTextGlyphMetaTexB, glyphCoord, 0);
  let glyphRasterMeta = textureLoad(uTextGlyphRasterMetaTex, glyphCoord, 0);

  let segmentCount = i32(glyphMetaA.y);

  var out : VsOut;
  out.vectorClipIndex = uVectorClip.x;
  if (uVectorClip.x < -1.5) { out.vectorClipIndex = f32(uOrderedInstances[instanceIndex].y) - 1.0; }
  if (segmentCount <= 0) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0, 0.0);
    out.segmentStart = 0;
    out.segmentCount = 0;
    out.color = vec3f(0.0, 0.0, 0.0);
    out.colorAlpha = 0.0;
    out.rasterRect = vec4f(0.0, 0.0, 0.0, 0.0);
    out.normCoord = vec2f(0.0, 0.0);
    out.world = vec2f(0.0, 0.0);
    out.clipRect = vec4f(0.0, 0.0, 0.0, 0.0);
    out.inkDensity = 0.0;
    return out;
  }

  let minBounds = glyphMetaA.zw;
  let maxBounds = glyphMetaB.xy;
  let corner01 = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  
  
  let margin = heprCoverageMargin(uCamera.zoom * mat2x2f(instanceA.x, instanceA.y, instanceA.z, instanceA.w));
  let local = mix(minBounds - margin, maxBounds + margin, corner01);

  let world = vec2f(
    instanceA.x * local.x + instanceA.z * local.y + instanceB.x,
    instanceA.y * local.x + instanceA.w * local.y + instanceB.y
  );
  let clipRef = i32(instanceB.w);
  out.clipRect = vec4f(0.0, 0.0, 0.0, 0.0);
  if (clipRef > 0) {
    out.clipRect = textureLoad(
      uTextGlyphMetaTexA,
      coordFromIndex(clipRef - 1, i32(glyphMetaDims.x)),
      0
    );
  }

  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  let clip = (screen / (0.5 * uCamera.viewport)) - 1.0;

  out.position = vec4f(clip, 0.0, 1.0);
  out.local = local;
  out.segmentStart = i32(glyphMetaA.x);
  out.segmentCount = segmentCount;
  out.color = instanceC.xyz;
  out.colorAlpha = instanceC.w;
  out.rasterRect = glyphRasterMeta;
  out.inkDensity = glyphMetaB.z;
  
  out.normCoord = (local - minBounds) / max(maxBounds - minBounds, vec2f(1e-6, 1e-6));
  out.world = world;
  return out;
}

@group(1) @binding(0) var uVectorClipTex: texture_2d<f32>;
@group(1) @binding(1) var<uniform> uVectorClip: vec4f;
@group(1) @binding(2) var<storage, read> uOrderedInstances: array<vec2u>;
${k}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  if (inData.clipRect.z > inData.clipRect.x && inData.clipRect.w > inData.clipRect.y &&
      (inData.world.x < inData.clipRect.x || inData.world.y < inData.clipRect.y ||
       inData.world.x > inData.clipRect.z || inData.world.y > inData.clipRect.w)) {
    discard;
  }
  let localDx = dpdx(inData.local);
  let localDy = dpdy(inData.local);
  let pixelToLocalX = length(vec2f(localDx.x, localDy.x));
  let pixelToLocalY = length(vec2f(localDx.y, localDy.y));
  let glyphPixel = vec2f(
    length(vec2f(dpdx(inData.normCoord.x), dpdy(inData.normCoord.x))),
    length(vec2f(dpdx(inData.normCoord.y), dpdy(inData.normCoord.y)))
  );
  let atlasDims = vec2f(textureDimensions(uTextRasterAtlasTex));
  let nc = vec2f(inData.normCoord.x, 1.0 - inData.normCoord.y) * (inData.rasterRect.zw * atlasDims);
  let dncDx = dpdx(nc);
  let dncDy = dpdy(nc);
  let ncFwidthX = abs(dncDx.x) + abs(dncDy.x);
  let ncFwidthY = abs(dncDx.y) + abs(dncDy.y);

  if (inData.segmentCount <= 0) {
    discard;
  }

  
  
  
  let glyphPixels = 1.0 / max(min(glyphPixel.x, glyphPixel.y), 1e-6);
  let detail = clamp((glyphPixels - 2.5) / 2.5, 0.0, 1.0);
  let halfBox = max(0.5 * uCamera.textAAScreenPx * glyphPixel, vec2f(1e-6));
  let boxOverlap = max(min(inData.normCoord + halfBox, vec2f(1.0)) - max(inData.normCoord - halfBox, vec2f(0.0)), vec2f(0.0)) /
    (2.0 * halfBox);
  var coverage = clamp(inData.inkDensity, 0.0, 1.0) * boxOverlap.x * boxOverlap.y;

  if (detail > 0.0) {
    var detailCoverage = 0.0;
    if (
      uCamera.textVectorOnly < 0.5 &&
      inData.rasterRect.z > 0.0 &&
      inData.rasterRect.w > 0.0 &&
      min(ncFwidthX, ncFwidthY) > 2.0
    ) {
      let uvCenter = vec2f(
        inData.rasterRect.x + inData.normCoord.x * inData.rasterRect.z,
        inData.rasterRect.y + (1.0 - inData.normCoord.y) * inData.rasterRect.w
      );
      let texel = 1.0 / max(atlasDims, vec2f(1.0, 1.0));
      
      
      let padding = texel * 7.5;
      let uvMin = inData.rasterRect.xy - padding;
      let uvMax = inData.rasterRect.xy + inData.rasterRect.zw + padding;
      let tapDx = dncDx * 0.33 * texel;
      let tapDy = dncDy * 0.33 * texel;
      
      let mipCap = min(1.0, 8.0 /
        max(max(length(dncDx), length(dncDy)) * 0.42044820762685725, 1e-6));
      
      
      
      let mipBiasedUvDx = dncDx * texel * 0.42044820762685725 * mipCap;
      let mipBiasedUvDy = dncDy * texel * 0.42044820762685725 * mipCap;
      detailCoverage = (1.0 / 3.0) * textureSampleGrad(
        uTextRasterAtlasTex,
        uTextRasterSampler,
        clamp(uvCenter, uvMin, uvMax),
        mipBiasedUvDx,
        mipBiasedUvDy
      ).r + (1.0 / 6.0) * (
        textureSampleGrad(
          uTextRasterAtlasTex,
          uTextRasterSampler,
          clamp(uvCenter - tapDx - tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r +
        textureSampleGrad(
          uTextRasterAtlasTex,
          uTextRasterSampler,
          clamp(uvCenter - tapDx + tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r +
        textureSampleGrad(
          uTextRasterAtlasTex,
          uTextRasterSampler,
          clamp(uvCenter + tapDx - tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r +
        textureSampleGrad(
          uTextRasterAtlasTex,
          uTextRasterSampler,
          clamp(uvCenter + tapDx + tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r
      );
    } else {
      
      
      let glyphSegDims = textureDimensions(uTextGlyphSegmentTexA);
      let footprint = max(vec2f(pixelToLocalX, pixelToLocalY) * uCamera.textAAScreenPx, vec2f(1e-4));
      let box = vec4f(inData.local - 0.5 * footprint, 1.0 / footprint);
      var winding = 0.0;
      for (var i = 0; i < inData.segmentCount; i = i + 1) {
        let coord = coordFromIndex(inData.segmentStart + i, i32(glyphSegDims.x));
        let primitiveA = textureLoad(uTextGlyphSegmentTexA, coord, 0);
        let primitiveB = textureLoad(uTextGlyphSegmentTexB, coord, 0);
        winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
          uCamera.textCurveEnabled >= 0.5 && primitiveB.z >= TEXT_PRIMITIVE_QUADRATIC, box, 0.0, 1.0);
      }
      detailCoverage = heprFillCoverage(winding, false);
    }
    coverage = mix(coverage, detailCoverage, detail);
  }

  let alpha = heprLinearCoverageToOutputAlpha(coverage) * inData.colorAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  let color = mix(inData.color, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return heprEncodeOutputColor(vec4f(color, alpha)) * heprVectorClip(inData.world, inData.vectorClipIndex, uVectorClipTex);
}
`,Kt=qt(!1);function qt(e){return`
struct CameraUniforms {
  viewport : vec2f,
  cameraCenter : vec2f,
  zoom : f32,
  strokeAAScreenPx : f32,
  strokeCurveEnabled : f32,
  textAAScreenPx : f32,
  textCurveEnabled : f32,
  fillAAScreenPx : f32,
  textVectorOnly : f32,
  pad0 : f32,
  vectorOverride : vec4f,
  fillBands : vec4f,
  fillCells : vec4f,
};

struct RasterUniforms {
  matrixA : vec4f,
  matrixB : vec4f,
  
  quad : vec4f,
  uv : vec4f,
  zeroColor : vec4f,
  oneColor : vec4f,
};

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
${e?`struct PageBackground { rect: vec4f, placeholder: vec4f };`:``}
@group(0) @binding(1) ${e?`var<storage, read> uPageRects : array<PageBackground>;`:`var<uniform> uRaster : RasterUniforms;`}
@group(0) @binding(2) var uRasterSampler : sampler;
@group(0) @binding(3) var uRasterTex : texture_2d<f32>;
${e?`@group(0) @binding(4) var<uniform> uPagePlaceholderTime: vec4f;`:`@group(0) @binding(4) var uRasterCoverageTex : texture_2d<f32>;`}

struct VsOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
  @location(1) world : vec2f,
  ${e?`@location(2) @interpolate(flat) pending: f32,`:``}
};

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> VsOut {
  let corner01 = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let localTopDown = vec2f(corner01.x, 1.0 - corner01.y);

${e?`
  let rect = uPageRects[instanceIndex].rect;
  let world = rect.xy + rect.zw * localTopDown;
`:`
  let a = uRaster.matrixA.x;
  let b = uRaster.matrixA.y;
  let c = uRaster.matrixA.z;
  let d = uRaster.matrixA.w;
  let e = uRaster.matrixB.x;
  let f = uRaster.matrixB.y;

  // Corners select, never interpolate, so neighboring tiles share exact edges.
  let farCorner = localTopDown > vec2f(0.5);
  let tileCorner = select(uRaster.quad.xy, uRaster.quad.zw, farCorner);
  let tileUv = select(uRaster.uv.xy, uRaster.uv.zw, farCorner);
  let world = vec2f(
    a * tileCorner.x + c * tileCorner.y + e,
    b * tileCorner.x + d * tileCorner.y + f
  );
`}

  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  let clip = (screen / (0.5 * uCamera.viewport)) - 1.0;

  var out : VsOut;
  out.position = vec4f(clip, 0.0, 1.0);
  out.uv = ${e?`localTopDown`:`tileUv`};
  out.world = world;
  ${e?`out.pending = uPageRects[instanceIndex].placeholder.x;`:``}
  return out;
}

@group(1) @binding(0) var uVectorClipTex: texture_2d<f32>;
@group(1) @binding(1) var<uniform> uVectorClip: vec4f;
${pe}
${e?``:Tt}
${e?v:``}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  
  
  let clipAAWidth = max(max(length(vec2f(dpdx(inData.world.x), dpdy(inData.world.x))),
    length(vec2f(dpdx(inData.world.y), dpdy(inData.world.y)))), 1e-4);
${e?`
  let color = heprPagePlaceholder(textureSample(uRasterTex, uRasterSampler, inData.uv),
    inData.uv, inData.pending, uPagePlaceholderTime.x);
`:`
  let uvDx = dpdx(inData.uv);
  let uvDy = dpdy(inData.uv);
  var imageColor : vec4f;
  if (uRaster.matrixB.w != 0.0) {
    imageColor = heprMonochromeColor(inData.uv, uvDx, uvDy);
  } else {
    imageColor = textureSampleGrad(uRasterTex, uRasterSampler, inData.uv, uvDx, uvDy);
    // BC7 endpoint bits can introduce spurious alpha in an opaque source.
    if (uRaster.zeroColor.x > 0.5) { imageColor.a = 1.0; }
  }
  let color = imageColor * uRaster.matrixB.z;
`}
  if (color.a <= 0.001) {
    discard;
  }
  return color * heprVectorClipAA(inData.world, uVectorClip.x, uVectorClipTex, clipAAWidth);
}
`}var Jt=`
struct HighlightCamera {
  viewport : vec2f,
  cameraCenter : vec2f,
  zoom : f32,
  pad0 : f32,
  pad1 : f32,
  pad2 : f32,
};

struct HighlightStyle {
  fillColor : vec4f,
  borderColor : vec4f,
  borderPx : f32,
  minSizePx : f32,
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var<uniform> uCamera : HighlightCamera;
@group(0) @binding(1) var<uniform> uStyle : HighlightStyle;
@group(0) @binding(2) var<storage, read> uRects : array<vec4f>;

struct VsOut {
  @builtin(position) position : vec4f,
  @location(0) localPx : vec2f,
  @location(1) halfSizePx : vec2f,
};

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

@vertex
fn vsMain(
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32
) -> VsOut {
  let rect = uRects[instanceIndex];
  let corner = cornerFromVertexIndex(vertexIndex);
  let center = (rect.xy + rect.zw) * 0.5;
  let halfSize = (rect.zw - rect.xy) * 0.5;
  let halfSizePx = max(halfSize * uCamera.zoom, vec2f(0.5 * uStyle.minSizePx));
  let expandedHalfPx = halfSizePx + vec2f(uStyle.borderPx);
  let world = center + corner * (expandedHalfPx / uCamera.zoom);
  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  let clip = (screen / (0.5 * uCamera.viewport)) - 1.0;

  var out : VsOut;
  out.position = vec4f(clip, 0.0, 1.0);
  out.localPx = corner * expandedHalfPx;
  out.halfSizePx = halfSizePx;
  return out;
}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  let distanceToEdgePx = inData.halfSizePx - abs(inData.localPx);
  let insideRect = all(distanceToEdgePx >= vec2f(0.0));
  return select(uStyle.borderColor, uStyle.fillColor, insideRect);
}
`,Yt=32,Xt=48,Zt=[{fillColor:[1,.921,.231,.35],borderColor:[.792,.541,.016,1],borderPx:1},{fillColor:[1,.596,0,.45],borderColor:[.918,.345,.047,1],borderPx:2},{fillColor:[.259,.522,.957,.35],borderColor:[.106,.365,.788,1],borderPx:1}],Qt=2,$t=`
struct VectorCompositeUniforms {
  viewportPx : vec2f,
  pad : vec2f,
};

@group(0) @binding(0) var uVectorSampler : sampler;
@group(0) @binding(1) var uVectorTex : texture_2d<f32>;
@group(0) @binding(2) var<uniform> uComposite : VectorCompositeUniforms;

struct VsOut {
  @builtin(position) position : vec4f,
};

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VsOut {
  var out : VsOut;
  out.position = vec4f(cornerFromVertexIndex(vertexIndex), 0.0, 1.0);
  return out;
}

@fragment
fn fsMain(@builtin(position) fragPos : vec4f) -> @location(0) vec4f {
  let viewport = max(uComposite.viewportPx, vec2f(1.0, 1.0));
  let uv = fragPos.xy / viewport;
  return textureSampleLevel(uVectorTex, uVectorSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
`,en=class n{canvas;gpuDevice;gpuContext;presentationFormat;multiplyPipelines=new Map;multiplyPipelineFactories=new Map;strokePipeline;fillPipeline;gradientFillPipeline;gradientMeshPipeline=null;gradientMeshBuffer=null;gradientMeshRanges=new Uint32Array;paintPipelineRecipes=new Map;shapePipelines=new Map;gradientStrokePipeline;textPipeline;rasterPipeline;pageBackgroundPipeline=null;rasterStripPipeline=null;vectorCompositePipeline;highlightPipeline;cameraUniformBuffer;highlightCameraBuffer;highlightStyleBuffers;highlightBindGroupLayout;highlightOthersRectsBuffer=null;highlightOthersCapacityBytes=0;highlightCurrentRectBuffer=null;highlightCurrentCapacityBytes=0;highlightSelectionRectsBuffer=null;highlightSelectionCapacityBytes=0;highlightOthersBindGroups=[];highlightCurrentBindGroups=[];highlightSelectionBindGroups=[];highlightOthersCount=0;highlightCurrentCount=0;highlightSelectionCount=0;vectorCompositeUniformBuffer;rasterLayerSampler;textRasterSampler;gradientSampler;vectorCompositeSampler;strokeBindGroupLayout;fillBindGroupLayout;gradientFillBindGroupLayout;gradientStrokeBindGroupLayout;textBindGroupLayout;rasterBindGroupLayout;vectorCompositeBindGroupLayout;strokeBindGroupAll=null;strokeBindGroupVisible=null;fillBindGroup=null;gradientFillBindGroup=null;gradientStrokeBindGroup=null;textBindGroup=null;vectorCompositeBindGroup=null;vectorLodLevelResources=[];segmentTextureA=null;segmentTextureB=null;segmentTextureC=null;segmentTextureD=null;fillPathMetaTextureA=null;fillPathMetaTextureB=null;fillPathMetaTextureC=null;fillSegmentTextureA=null;fillSegmentTextureB=null;textInstanceTextureA=null;textInstanceTextureB=null;textInstanceTextureC=null;rasterLayerResources=[];rasterResolutionPlanner=null;rasterResolutionView=null;rasterResolutionSources=null;rasterStripResources=new Map;rasterStripAllocationBytes=new WeakMap;rasterStagedBytes=0;rasterCompression=null;rasterTextureResidency=!0;pageBackgroundResources=[];textGlyphMetaTextureA=null;textGlyphMetaTextureB=null;textGlyphRasterMetaTexture=null;textGlyphSegmentTextureA=null;textGlyphSegmentTextureB=null;textRasterAtlasTexture=null;pageBackgroundTexture=null;pagePlaceholderUniformBuffer=null;gradientMetaTextures=[];gradientLutTexture=null;gradientLutView=null;gradientFillTextures=[];gradientStrokeTextures=[];gradientData=null;orderedGradientPaintCommands=[];gradientPaintRequiresDirectRendering=!1;segmentIdBufferAll=null;segmentIdBufferVisible=null;textInstanceIdBuffer=null;vectorMinifyTexture=null;vectorMinifyWidth=0;vectorMinifyHeight=0;orderedRunCuller=null;orderedCullingBounds=null;orderedRunsCulled=!1;vectorClipTexture=null;vectorClipBindGroupLayout;vectorClipBuffers=[];vectorClipBindGroups=[];vectorClipIndex=-1;vectorClipBounds=new Float32Array;orderedBatches=null;runLookup=null;orderedInstanceBuffer=null;orderedInstanceCapacityBytes=0;scene=null;rasterLayerUpdates=new Map;paintCompositor=null;paintViewportWidth=1;paintCameraCenterX=0;paintCameraCenterY=0;paintZoom=1;paintViewportHeight=1;optionalContentVisibility=null;scenePaintVisibility=null;primitiveColors=null;primitiveHighlights=null;primitiveGradientLayout;paintFolds=null;performanceProfiler=null;frameTimer=null;primitiveGradientColors=null;sceneStats=null;grid=null;vectorLodMode=`auto`;vectorLodRuntime=null;vectorLodStats=null;frameListener=null;frameDrawCalls=0;interactionViewportProvider=null;presentedCameraCenterX=0;presentedCameraCenterY=0;presentedZoom=1;presentedFrameSerial=0;rafHandle=0;externalFrameDriver=!1;isDisposed=!1;externalFramePending=!1;gpuFramesInFlight=0;framePendingOnGpu=!1;cameraCenterX=0;cameraCenterY=0;zoom=1;targetCameraCenterX=0;targetCameraCenterY=0;targetZoom=1;lastCameraAnimationTimeMs=0;hasZoomAnchor=!1;zoomAnchorClientX=0;zoomAnchorClientY=0;zoomAnchorWorldX=0;zoomAnchorWorldY=0;panVelocityWorldX=0;panVelocityWorldY=0;lastPanVelocityUpdateTimeMs=0;lastPanFrameCameraX=0;lastPanFrameCameraY=0;lastPanFrameTimeMs=0;minZoom=.01;maxZoom=8192;strokeCurveEnabled=!0;rasterRenderingEnabled=!0;fillRenderingEnabled=!0;strokeRenderingEnabled=!0;textRenderingEnabled=!0;textVectorOnly=!1;pageBackgroundColor=[1,1,1,1];vectorOverrideColor=[0,0,0];vectorOverrideOpacity=0;isPanInteracting=!1;hasCameraInteractionSinceSceneLoad=!1;lastInteractionTime=-1/0;needsVisibleSetUpdate=!1;segmentCount=0;fillPathCount=0;textInstanceCount=0;textLodMode=`auto`;textLodRuntime=null;orderedTextLod=null;textLodGpuActive=!1;selectedTextInstanceCount=0;useTextInstanceIndirection=!1;visibleSegmentCount=0;usingAllSegments=!0;segmentTextureWidth=1;segmentTextureHeight=1;fillBandBase=-1;fillBandEntries=0;gradientFillBandBase=-1;gradientFillBandEntries=0;fillCellBase=-1;gradientFillCellBase=-1;fillPathMetaTextureWidth=1;fillPathMetaTextureHeight=1;fillSegmentTextureWidth=1;fillSegmentTextureHeight=1;textInstanceTextureWidth=1;textInstanceTextureHeight=1;textGlyphMetaTextureWidth=1;textGlyphMetaTextureHeight=1;textGlyphSegmentTextureWidth=1;textGlyphSegmentTextureHeight=1;allSegmentIds=new Uint32Array;visibleSegmentIds=new Uint32Array;segmentMarks=new Uint32Array;segmentMinX=new Float32Array;segmentMinY=new Float32Array;segmentMaxX=new Float32Array;segmentMaxY=new Float32Array;markToken=1;constructor(e,n,r,i){this.canvas=e,this.gpuDevice=n,this.gpuContext=r,this.presentationFormat=i,this.configureContext();let a=globalThis.GPUBufferUsage,o=globalThis.GPUShaderStage;this.cameraUniformBuffer=this.gpuDevice.createBuffer({size:V,usage:a.UNIFORM|a.COPY_DST}),this.vectorCompositeUniformBuffer=this.gpuDevice.createBuffer({size:H,usage:a.UNIFORM|a.COPY_DST}),this.highlightCameraBuffer=this.gpuDevice.createBuffer({size:Yt,usage:a.UNIFORM|a.COPY_DST}),this.highlightStyleBuffers=Zt.map(e=>{let t=this.gpuDevice.createBuffer({size:Xt,usage:a.UNIFORM|a.COPY_DST}),n=new Float32Array(12);return n[0]=e.fillColor[0],n[1]=e.fillColor[1],n[2]=e.fillColor[2],n[3]=e.fillColor[3],n[4]=e.borderColor[0],n[5]=e.borderColor[1],n[6]=e.borderColor[2],n[7]=e.borderColor[3],n[8]=e.borderPx,n[9]=Qt,this.gpuDevice.queue.writeBuffer(t,0,n),t}),this.vectorClipBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:o.FRAGMENT,texture:{sampleType:`unfilterable-float`}},{binding:1,visibility:o.VERTEX|o.FRAGMENT,buffer:{type:`uniform`,minBindingSize:32}},{binding:2,visibility:o.VERTEX,buffer:{type:`read-only-storage`,minBindingSize:8}}]}),this.strokeBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:o.VERTEX|o.FRAGMENT,buffer:{type:`uniform`,minBindingSize:V}},{binding:1,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:2,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:3,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:4,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:5,visibility:o.VERTEX,buffer:{type:`read-only-storage`}}]}),this.fillBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:o.VERTEX|o.FRAGMENT,buffer:{type:`uniform`,minBindingSize:V}},{binding:1,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:2,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:3,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:4,visibility:o.VERTEX|o.FRAGMENT,texture:{sampleType:`unfilterable-float`}},{binding:5,visibility:o.FRAGMENT,texture:{sampleType:`unfilterable-float`}}]}),this.gradientFillBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:o.VERTEX|o.FRAGMENT,buffer:{type:`uniform`,minBindingSize:V}},...[1,2,3,4].map(e=>({binding:e,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}})),{binding:5,visibility:o.VERTEX|o.FRAGMENT,texture:{sampleType:`unfilterable-float`}},...[6,7,8,9,10,11].map(e=>({binding:e,visibility:o.FRAGMENT,texture:{sampleType:`unfilterable-float`}})),{binding:12,visibility:o.FRAGMENT,sampler:{type:`filtering`}},{binding:13,visibility:o.FRAGMENT,texture:{sampleType:`float`}}]}),this.gradientStrokeBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:o.VERTEX|o.FRAGMENT,buffer:{type:`uniform`,minBindingSize:V}},...[1,2,3,4,5].map(e=>({binding:e,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}})),...[6,7,8,9,10].map(e=>({binding:e,visibility:o.FRAGMENT,texture:{sampleType:`unfilterable-float`}})),{binding:11,visibility:o.FRAGMENT,sampler:{type:`filtering`}},{binding:12,visibility:o.FRAGMENT,texture:{sampleType:`float`}}]}),this.textBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:o.VERTEX|o.FRAGMENT,buffer:{type:`uniform`,minBindingSize:V}},{binding:1,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:2,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:3,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:4,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:5,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:6,visibility:o.FRAGMENT,texture:{sampleType:`unfilterable-float`}},{binding:7,visibility:o.FRAGMENT,texture:{sampleType:`unfilterable-float`}},{binding:8,visibility:o.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:9,visibility:o.FRAGMENT,sampler:{type:`filtering`}},{binding:10,visibility:o.FRAGMENT,texture:{sampleType:`float`}},{binding:11,visibility:o.VERTEX,buffer:{type:`read-only-storage`}}]}),this.rasterBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:o.VERTEX,buffer:{type:`uniform`,minBindingSize:V}},{binding:1,visibility:o.VERTEX|o.FRAGMENT,buffer:{type:`uniform`,minBindingSize:U}},{binding:2,visibility:o.FRAGMENT,sampler:{type:`filtering`}},{binding:3,visibility:o.FRAGMENT,texture:{sampleType:`float`}},{binding:4,visibility:o.FRAGMENT,texture:{sampleType:`float`}}]}),this.vectorCompositeBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:o.FRAGMENT,sampler:{type:`filtering`}},{binding:1,visibility:o.FRAGMENT,texture:{sampleType:`float`}},{binding:2,visibility:o.FRAGMENT,buffer:{type:`uniform`,minBindingSize:H}}]}),this.highlightBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:o.VERTEX,buffer:{type:`uniform`,minBindingSize:Yt}},{binding:1,visibility:o.VERTEX|o.FRAGMENT,buffer:{type:`uniform`,minBindingSize:Xt}},{binding:2,visibility:o.VERTEX,buffer:{type:`read-only-storage`}}]});let s=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.strokeBindGroupLayout,this.vectorClipBindGroupLayout]});this.paintFolds=new xt(this.gpuDevice);let c=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.fillBindGroupLayout,this.vectorClipBindGroupLayout,this.paintFolds.layout]});this.primitiveGradientLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:o.FRAGMENT,buffer:{type:`uniform`,minBindingSize:16}}]});let l=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.gradientFillBindGroupLayout,this.vectorClipBindGroupLayout,this.primitiveGradientLayout,this.paintFolds.layout]}),u=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.gradientStrokeBindGroupLayout,this.vectorClipBindGroupLayout,this.primitiveGradientLayout]}),d=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.textBindGroupLayout,this.vectorClipBindGroupLayout]}),f=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.rasterBindGroupLayout,this.vectorClipBindGroupLayout]}),p=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.vectorCompositeBindGroupLayout]}),m=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.highlightBindGroupLayout]});this.strokePipeline=this.createPipeline(Ut,`vsMain`,`fsMain`,s),this.highlightPipeline=this.createPipeline(Jt,`vsMain`,`fsMain`,m),this.fillPipeline=this.createPipeline(t(Wt,2),`vsMain`,`fsMain`,c),this.gradientFillPipeline=this.createPipeline(t(nt,3),`vsMain`,`fsMain`,l),this.gradientStrokePipeline=this.createPipeline(tt,`vsMain`,`fsMain`,u),this.textPipeline=this.createPipeline(Gt,`vsMain`,`fsMain`,d),this.rasterPipeline=this.createPipeline(Kt,`vsMain`,`fsMain`,f,!0),this.vectorCompositePipeline=this.createPipeline($t,`vsMain`,`fsMain`,p,!0),this.rasterLayerSampler=this.gpuDevice.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.textRasterSampler=this.gpuDevice.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`,maxAnisotropy:16}),this.gradientSampler=this.gpuDevice.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.vectorCompositeSampler=this.gpuDevice.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.pageBackgroundTexture=this.createRgba8Texture(1,1,new Uint8Array([255,255,255,255])),this.ensureSegmentIdBuffers(1)}static async create(e){let{device:t,presentationFormat:r}=await this.prepareDevice(),i=null;try{if(i=e.getContext(`webgpu`),!i)throw Error(`Failed to acquire a WebGPU canvas context.`);let a=new n(e,t,i,r);return await a.initializeRasterCompression(),a}catch(e){try{Z(t,i)}catch{}throw e}}static async createDeferred(e){let{device:t,presentationFormat:r}=await this.prepareDevice(),i=null;return ht(e,this.prototype,()=>{if(i=e.getContext(`webgpu`),!i)throw Error(`Failed to acquire a WebGPU canvas context.`);let a=new n(e,t,i,r);return a.initializeRasterCompression(!0).catch(e=>{console.warn(`[HEPR] Optional native fallback raster compression unavailable.`,e)}),a},()=>Z(t,i))}static async prepareDevice(){let e=navigator;if(!e.gpu)throw Error(`WebGPU is not available in this browser.`);let t=await e.gpu.requestAdapter({powerPreference:`high-performance`})??await e.gpu.requestAdapter();if(!t)throw Error(`Failed to acquire a WebGPU adapter.`);let n=Number(t.limits?.maxTextureDimension2D),r=[`timestamp-query`,`texture-compression-bc`,`texture-compression-astc`].filter(e=>t.features?.has?.(e)),i=n>8192?{maxTextureDimension2D:n}:void 0,a;try{a=await t.requestDevice({...r.length?{requiredFeatures:r}:{},...i?{requiredLimits:i}:{}})}catch(e){if(!r.some(e=>e.startsWith(`texture-compression-`)))throw e;console.warn(`[HEPR] Optional WebGPU raster compression features unavailable; retrying the base device.`,e);let n=r.filter(e=>e===`timestamp-query`);a=await t.requestDevice({...n.length?{requiredFeatures:n}:{},...i?{requiredLimits:i}:{}})}try{typeof a.addEventListener==`function`&&a.addEventListener(`uncapturederror`,e=>{let t=e?.error?.message||e?.error||e;console.warn(`[WebGPU uncaptured error]`,t)});let t=e.gpu.getPreferredCanvasFormat?.()??`bgra8unorm`;return{device:a,presentationFormat:t}}catch(e){try{Z(a,null)}catch{}throw e}}async initializeRasterCompression(e=!1){let t=await mt.create(this.gpuDevice,u().bytes/4);if(this.isDisposed){t?.dispose();return}this.rasterCompression=t;let n=()=>{if(!this.isDisposed&&this.scene&&this.rasterTextureResidency)try{this.configureRasterLayers(this.scene),this.destroyVectorMinifyResources(),this.requestFrame()}catch(e){console.warn(`[HEPR] Bounded RGBA raster recovery failed.`,e)}};t?.setFailureListener(n),e&&t&&n()}setFrameListener(e){this.frameListener=e}setExternalFrameDriver(e){let t=!!e;if(this.externalFrameDriver!==t){if(this.externalFrameDriver=t,this.externalFrameDriver){this.externalFramePending=!0,this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0);return}this.externalFramePending&&(this.externalFramePending=!1,this.requestFrame())}}renderExternalFrame(e=performance.now()){(!this.externalFrameDriver||this.externalFramePending)&&(this.externalFramePending=!1,this.render(e))}setVectorLodMode(e){let t=sn(e);if(this.vectorLodMode!==t){if(this.vectorLodMode=t,this.scene){let e=this.rebuildVectorLod(this.scene);this.grid=!e&&!this.scene.drawRuns&&this.segmentCount>0?Ye(this.scene):null}this.needsVisibleSetUpdate=!0,this.requestFrame(),this.primitiveColors&&this.setPrimitiveColorUpdates(this.primitiveColors.updates())}}getVectorStrokeLodStats(){return this.vectorLodStats?{...this.vectorLodStats,activeLevels:this.vectorLodStats.activeLevels.map(e=>({...e}))}:null}setTextLodMode(e){let t=e===`off`?`off`:`auto`;if(this.textLodMode!==t){if(this.textLodMode=t,t===`auto`&&this.scene&&!this.textLodGpuActive){this.setScene(this.scene);return}this.textLodRuntime?.setMode(this.primitiveColors?.has(`text`)?`off`:t),this.selectedTextInstanceCount=0,this.useTextInstanceIndirection=!1,this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame()}}getTextLodStats(){return this.textLodRuntime?.getStats()??null}setStrokeCurveEnabled(e){let t=!!e;this.strokeCurveEnabled!==t&&(this.strokeCurveEnabled=t,this.requestFrame())}setRasterRenderingEnabled(e){let t=!!e;this.rasterRenderingEnabled!==t&&(this.rasterRenderingEnabled=t,this.needsVisibleSetUpdate=!0,this.requestFrame())}setRasterTextureResidency(e){let t=!!e;if(!(this.rasterTextureResidency===t||this.isDisposed)){if(this.rasterTextureResidency=t,t){if(this.scene)try{this.configureRasterLayers(this.scene)}catch(e){throw this.rasterTextureResidency=!1,this.destroyRasterLayerResources(),e}}else this.destroyRasterLayerResources(),this.rasterCompression?.releaseWorkspace();this.needsVisibleSetUpdate=!0,this.requestFrame()}}setFillRenderingEnabled(e){let t=!!e;this.fillRenderingEnabled!==t&&(this.fillRenderingEnabled=t,this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeRenderingEnabled(e){let t=!!e;this.strokeRenderingEnabled!==t&&(this.strokeRenderingEnabled=t,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextRenderingEnabled(e){let t=!!e;this.textRenderingEnabled!==t&&(this.textRenderingEnabled=t,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextVectorOnly(e){let t=!!e;this.textVectorOnly!==t&&(this.textVectorOnly=t,this.textVectorOnly&&this.destroyVectorMinifyResources(),this.requestFrame())}setPageBackgroundColor(e,t,n,r){let i=Q(e,0,1),a=Q(t,0,1),o=Q(n,0,1),s=Q(r,0,1),c=this.pageBackgroundColor;Math.abs(c[0]-i)<=1e-6&&Math.abs(c[1]-a)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(c[3]-s)<=1e-6||(this.pageBackgroundColor=[i,a,o,s],this.uploadPageBackgroundTexture(),this.requestFrame())}setPrimitiveHighlights(e){if(!this.isDisposed){if(!e?.count){this.primitiveHighlights?.dispose(),this.primitiveHighlights=null,this.requestFrame();return}this.primitiveHighlights||=new $e(this.gpuDevice,this.presentationFormat),this.primitiveHighlights?.set(e),this.requestFrame()}}setPrimitiveColorUpdates(e){if(this.isDisposed||e.length===0)return;if(!this.scene)throw Error(`Cannot apply primitive colors before uploading a scene.`);this.primitiveColors??=new ot(this.scene);let t=this.primitiveColors.update(e),n={stroke:this.segmentTextureWidth,fillB:this.fillPathMetaTextureWidth,fillC:this.fillPathMetaTextureWidth,text:this.textInstanceTextureWidth},r=et(t,n);for(let e of r){let t=e.kind===`stroke`?this.segmentTextureC:e.kind===`fillB`?this.fillPathMetaTextureB:e.kind===`fillC`?this.fillPathMetaTextureC:this.textInstanceTextureC,r=n[e.kind];this.gpuDevice.queue.writeTexture({texture:t,origin:[e.index%r,Math.floor(e.index/r)]},e.pixels,{},[e.count,1])}let i=this.orderedBatches?this.vectorLodLevelResources[0]:void 0;if(i?.ownsTextures){let e=et(t.filter(e=>e.kind===`stroke`),{...n,stroke:i.textureWidth});for(let t of e)this.gpuDevice.queue.writeTexture({texture:i.textureC,origin:[t.index%i.textureWidth,Math.floor(t.index/i.textureWidth)]},t.pixels,{},[t.count,1])}e.some(e=>e.ref.kind===`gradient-fill`||e.ref.kind===`gradient-stroke`)&&(this.primitiveGradientColors??=new N(this.gpuDevice,this.primitiveGradientLayout),this.primitiveGradientColors.update(e)),this.vectorLodRuntime?.setForceExact(this.primitiveColors.has(`stroke`)),this.textLodRuntime?.setMode(this.primitiveColors.has(`text`)?`off`:this.textLodMode),this.selectedTextInstanceCount=0,this.orderedBatches?.setColorCommutationEnabled(!this.primitiveColors.has(`stroke`)&&!this.primitiveColors.has(`fill`)&&!this.primitiveColors.has(`text`)),this.orderedBatches?.invalidate(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame()}setVectorColorOverride(e,t,n,r){let i=Q(e,0,1),a=Q(t,0,1),o=Q(n,0,1),s=Q(r,0,1),c=this.vectorOverrideColor;Math.abs(c[0]-i)<=1e-6&&Math.abs(c[1]-a)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(this.vectorOverrideOpacity-s)<=1e-6||(this.vectorOverrideColor=[i,a,o],this.vectorOverrideOpacity=s,this.requestFrame())}getVectorColorOverride(){return[...this.vectorOverrideColor,this.vectorOverrideOpacity]}setInteractionViewportProvider(e){this.interactionViewportProvider=e}beginPanInteraction(){this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=0,this.isPanInteracting=!0,this.markInteraction()}endPanInteraction(){this.isPanInteracting=!1;let e=performance.now(),t=this.lastPanVelocityUpdateTimeMs>0&&e-this.lastPanVelocityUpdateTimeMs<=zt?Math.hypot(this.panVelocityWorldX,this.panVelocityWorldY):0;Number.isFinite(t)&&t>=Lt?(this.targetCameraCenterX=this.cameraCenterX+this.panVelocityWorldX/Pt,this.targetCameraCenterY=this.cameraCenterY+this.panVelocityWorldY/Pt,this.lastCameraAnimationTimeMs=0):(this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.markInteraction(),this.needsVisibleSetUpdate=!0,this.requestFrame()}resize(){let e=window.devicePixelRatio||1,t=Math.max(1,Math.floor(this.canvas.clientWidth*e)),n=Math.max(1,Math.floor(this.canvas.clientHeight*e));(this.canvas.width!==t||this.canvas.height!==n)&&(this.canvas.width=t,this.canvas.height=n,this.configureContext(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}getRasterLayerUpdates(){return this.rasterLayerUpdates}async prepareRasterLayerUpdatesAsync(e){return Ve(this.prepareRasterLayerUpdateSteps(e),(e,t)=>this.recordPerformanceTransition(e,t))}prepareRasterLayerUpdates(e){return M(this.prepareRasterLayerUpdateSteps(e))}*prepareRasterLayerUpdateSteps(e){e=new Map(e);let t=this.scene;if(!t||this.isDisposed)throw Error(`No active scene for raster replacement.`);Le(t,e);let n=new Map,r=0,i=!1,a=()=>{this.rasterStagedBytes=Math.max(0,(this.rasterStagedBytes??0)-r),r=0},o=()=>{for(let e of n.values())K(e);n.clear(),a()},s=!1,c=function*(){let i=[...e].filter(([e,n])=>(this.rasterLayerUpdates.get(e)??t.rasterLayers[e])!==n),a=new Set(i.map(([e])=>e)),o=u(),c=this.rasterLayerResources.reduce((e,t)=>e+(t.estimatedBytes??0),0)+(this.rasterResourceCache?.bytes??0),l=this.rasterLayerResources.reduce((e,t,n)=>e+(a.has(n)?0:t.estimatedBytes??0),0),d=[...this.rasterStripResources?.values()??[]].reduce((e,t)=>e+(this.rasterStripAllocationBytes?.get(t)??0),0),f=this.rasterStagedBytes??0,p=Math.max(1,Math.min(o.bytes-l-f,o.peakBytes-c-d-f)),m=i.map(([,e])=>this.prepareRasterSource(e)),h=this.planRasterLayerMemory(m,p);g(h,this),r=h.estimatedBytes,this.rasterStagedBytes=(this.rasterStagedBytes??0)+r;for(let[e,[r]]of i.entries()){let i=h.plans[e],a=h.compressionFormats[e],o=yield{source:m[e],plan:i,cached:At(m[e],i)||L(m[e],i,a)||(this.rasterResourceCache?.has(m[e],i,a)??!1)};if(this.scene!==t||this.isDisposed||!this.rasterTextureResidency)throw new DOMException(`Raster update superseded.`,`AbortError`);let s=this.createRasterLayerResource(m[e],r,i,a,o);n.set(r,s)}let _=[...n.values()].reduce((e,t)=>e+(t.estimatedBytes??0),0);this.rasterStagedBytes+=_-r,r=_,s=!0};try{this.rasterTextureResidency&&(yield*c.call(this))}catch(e){throw o(),e}return{commit:()=>{if(i||this.isDisposed||this.scene!==t)throw o(),i=!0,new DOMException(`Raster update superseded.`,`AbortError`);if(!this.rasterTextureResidency)o();else if([...n.values()].some(e=>e.compressionFormat)&&!this.rasterCompression?.available){o(),s=!1;try{M(c.call(this))}catch(e){throw o(),i=!0,e}}else if(!s)try{M(c.call(this))}catch(e){throw o(),i=!0,e}for(let[e,t]of n){let n=this.rasterLayerResources[e];n&&this.getRasterResourceCache().park(n,n.estimatedBytes??0),this.rasterLayerResources[e]=t}n.clear(),a(),this.destroyRasterStripResources();for(let[t,n]of e)this.rasterLayerUpdates.set(t,n);this.rasterResolutionSources=null,this.rasterResolutionPlanner?.invalidate(),this.trimRasterResourceCache(),i=!0,this.destroyVectorMinifyResources(),this.requestFrame()},dispose:()=>{i||(i=!0,o())}}}getOptionalContentVisibility(){return this.optionalContentVisibility}pageRasterVisibility;recordPerformanceTransition(e,t){this.performanceProfiler?.recordTransition(e,t)}setPageRasterVisibility(e){this.pageRasterVisibility?.size===e.size&&[...e].every(e=>this.pageRasterVisibility.has(e))||(this.pageRasterVisibility=new Set(e),this.setOptionalContentVisibility({...this.optionalContentVisibility??me(this.scene),rasterPages:this.pageRasterVisibility}))}setOptionalContentVisibility(e){this.pageRasterVisibility&&e.rasterPages!==this.pageRasterVisibility&&(e={...e,rasterPages:this.pageRasterVisibility}),!(this.isDisposed||this.optionalContentVisibility===e)&&(this.optionalContentVisibility=e,this.scenePaintVisibility?.setVisibility(e),this.orderedBatches?.invalidate(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setScene(e,t={}){let n=performance.now();if(this.isDisposed)throw Error(`Cannot upload a scene after the WebGPU renderer has been disposed.`);this.scene!==e&&(this.pageRasterVisibility=void 0,t.preserveRasterResolution?(this.rasterResolutionPlanner?.invalidate(),this.rasterResolutionView&&={...this.rasterResolutionView,width:this.canvas.width,height:this.canvas.height,cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom}):(this.rasterResolutionPlanner=new ze,this.rasterResolutionView=null,this.rasterResolutionSources=null),this.rasterLayerUpdates.clear(),this.paintCompositor?.dispose(),this.paintCompositor=null,this.optionalContentVisibility=me(e),this.primitiveColors=null,this.primitiveHighlights?.dispose(),this.primitiveHighlights=null,this.primitiveGradientColors?.dispose(),this.primitiveGradientColors=null),be(e),this.scenePaintVisibility=new O(e),this.scenePaintVisibility.setVisibility(this.optionalContentVisibility),this.orderedRunCuller=e.drawRuns?new we(e):null,this.scene=e,this.segmentCount=e.segmentCount,this.fillPathCount=e.fillPathCount,this.textInstanceCount=e.textInstanceCount,this.textLodRuntime?.dispose(),this.textLodRuntime=null,this.orderedTextLod=null,this.textLodGpuActive=!1,this.selectedTextInstanceCount=0,this.useTextInstanceIndirection=!1,this.buildSegmentBounds(e),this.isPanInteracting=!1,this.destroyVectorMinifyResources(),this.destroyVectorLodResources(),this.grid=null;let r=this.maxTextureSize(),i=performance.now(),a=this.scenePaintVisibility.requiresCompositing?null:this.textLodMode===`auto`?D(e):ie(e);this.recordPerformanceTransition(`pageSwap.textLod`,performance.now()-i),this.textLodRuntime=a?new se(a,this.textLodMode):null;let o=null;if(this.textLodMode===`auto`&&a?.data){let t=a.data;X(t.combinedInstanceCount,r)&&X(e.textGlyphCount+1,r)&&X(e.textGlyphSegmentCount+4,r)&&this.canFitTextLodStorageBuffer(e.textInstanceCount)?(o=t,this.textLodGpuActive=!0):this.textLodRuntime?.setResourceFallback(`resource-capacity`)}let s=Y(e.fillPathCount,r),c=Ce(he(e),Se(e),r);this.fillBandBase=c.bandBase,this.fillBandEntries=c.bandEntries,this.fillCellBase=c.cellBase;let l=Y(c.texels,r),u=Y(o?.combinedInstanceCount??e.textInstanceCount,r),d=Math.floor((e.textClipRects?.length??0)/4),f=Y(e.textGlyphCount+ +!!o+d,r),p=Y(e.textGlyphSegmentCount+(o?4:0),r);this.destroyDataResources();let m=this.prepareVectorLod(e),h=this.orderedBatches?.strokeRecords??Oe(e),g=Y(h.count,r),_;try{_=rn(e,o,u,f,p)}catch(t){if(!o)throw t;this.textLodRuntime?.setResourceFallback(`resource-capacity`),this.textLodGpuActive=!1,o=null,u=Y(e.textInstanceCount,r),f=Y(e.textGlyphCount+d,r),p=Y(e.textGlyphSegmentCount,r),_=rn(e,null,u,f,p)}this.segmentTextureWidth=g.width,this.segmentTextureHeight=g.height,this.fillPathMetaTextureWidth=s.width,this.fillPathMetaTextureHeight=s.height,this.fillSegmentTextureWidth=l.width,this.fillSegmentTextureHeight=l.height,this.textInstanceTextureWidth=u.width,this.textInstanceTextureHeight=u.height,this.textGlyphMetaTextureWidth=f.width,this.textGlyphMetaTextureHeight=f.height,this.textGlyphSegmentTextureWidth=p.width,this.textGlyphSegmentTextureHeight=p.height,this.createStrokeTextures(this.segmentTextureWidth,this.segmentTextureHeight,h),this.fillPathMetaTextureA=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,e.fillPathMetaA),this.fillPathMetaTextureB=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,e.fillPathMetaB),this.fillPathMetaTextureC=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,e.fillPathMetaC),this.fillSegmentTextureA=this.createFloatTexture(this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,c.dataA),this.fillSegmentTextureB=this.createFloatTexture(this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,c.dataB);let v=performance.now(),y=this.textInstanceTextureWidth*this.textInstanceTextureHeight;this.textInstanceTextureA=this.createFloatTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,_.textInstanceA),this.textInstanceTextureB=this.createFloatTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,_.textInstanceB),this.textInstanceTextureC=this.createRgba8DataTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,tn(_.textInstanceC,y)),this.textGlyphMetaTextureA=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,_.textGlyphMetaA),this.textGlyphMetaTextureB=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,_.textGlyphMetaB),this.textGlyphSegmentTextureA=this.createFloatTexture(this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,_.textGlyphSegmentsA),this.textGlyphSegmentTextureB=this.createFloatTexture(this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,_.textGlyphSegmentsB);let b=new Float32Array(this.textGlyphMetaTextureWidth*this.textGlyphMetaTextureHeight*4),x=performance.now(),S=qe(e,r);this.recordPerformanceTransition(`pageSwap.glyphAtlas`,performance.now()-x),S&&b.set(S.glyphUvRects),this.textGlyphRasterMetaTexture=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,b),this.textRasterAtlasTexture=S?this.createR8Texture(S.width,S.height,S.alpha):this.createR8Texture(1,1,new Uint8Array([0])),this.recordPerformanceTransition(`pageSwap.textUpload`,performance.now()-v),this.configurePageBackgroundResources(e),this.destroyRasterLayerResources(),this.rasterTextureResidency&&this.configureRasterLayers(e),this.configureGradientPaint(e,r);let C=e.drawRuns?0:this.segmentCount,w=this.scenePaintVisibility.requiresCompositing?this.segmentCount:C;this.allSegmentIds=new Uint32Array(w);for(let e=0;e<w;e+=1)this.allSegmentIds[e]=e;return this.ensureSegmentIdBuffers(Math.max(1,w)),w>0&&(this.gpuDevice.queue.writeBuffer(this.segmentIdBufferAll,0,this.allSegmentIds),this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible,0,this.allSegmentIds)),this.ensureTextInstanceIdBuffer(this.textLodGpuActive?this.textInstanceCount:1),this.fillBindGroup=this.gpuDevice.createBindGroup({layout:this.fillPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:V}},{binding:1,resource:this.fillPathMetaTextureA.createView()},{binding:2,resource:this.fillPathMetaTextureB.createView()},{binding:3,resource:this.fillPathMetaTextureC.createView()},{binding:4,resource:this.fillSegmentTextureA.createView()},{binding:5,resource:this.fillSegmentTextureB.createView()}]}),this.textBindGroup=this.gpuDevice.createBindGroup({layout:this.textPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:V}},{binding:1,resource:this.textInstanceTextureA.createView()},{binding:2,resource:this.textInstanceTextureB.createView()},{binding:3,resource:this.textInstanceTextureC.createView()},{binding:4,resource:this.textGlyphMetaTextureA.createView()},{binding:5,resource:this.textGlyphMetaTextureB.createView()},{binding:6,resource:this.textGlyphSegmentTextureA.createView()},{binding:7,resource:this.textGlyphSegmentTextureB.createView()},{binding:8,resource:this.textGlyphRasterMetaTexture.createView()},{binding:9,resource:this.textRasterSampler},{binding:10,resource:this.textRasterAtlasTexture.createView()},{binding:11,resource:{buffer:this.textInstanceIdBuffer}}]}),this.refreshStrokeBindGroups(),(e.drawRuns||this.visibleSegmentIds.length<C)&&(this.visibleSegmentIds=new Uint32Array(C)),(e.drawRuns||this.segmentMarks.length<C)&&(this.segmentMarks=new Uint32Array(C),this.markToken=1),this.visibleSegmentCount=this.segmentCount,this.usingAllSegments=!0,this.uploadVectorLodLevels(),this.grid=!m&&!e.drawRuns&&this.segmentCount>0?Ye(e):null,this.orderedTextLod=e.drawRuns&&o?new Be(e,o):null,this.orderedTextLod&&o&&this.orderedRunCuller?.includeTextLod(o),this.sceneStats={gridWidth:this.grid?.gridWidth??0,gridHeight:this.grid?.gridHeight??0,gridIndexCount:this.grid?.indices.length??0,maxCellPopulation:this.grid?.maxCellPopulation??0,fillPathTextureWidth:this.fillPathMetaTextureWidth,fillPathTextureHeight:this.fillPathMetaTextureHeight,fillSegmentTextureWidth:this.fillSegmentTextureWidth,fillSegmentTextureHeight:this.fillSegmentTextureHeight,textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,maxTextureSize:r,textInstanceTextureWidth:this.textInstanceTextureWidth,textInstanceTextureHeight:this.textInstanceTextureHeight,textGlyphTextureWidth:this.textGlyphMetaTextureWidth,textGlyphTextureHeight:this.textGlyphMetaTextureHeight,textSegmentTextureWidth:this.textGlyphSegmentTextureWidth,textSegmentTextureHeight:this.textGlyphSegmentTextureHeight},this.minZoom=.01,this.maxZoom=8192,this.hasCameraInteractionSinceSceneLoad=!1,this.syncCameraTargetsToCurrent(),this.needsVisibleSetUpdate=!0,this.requestFrame(),this.primitiveColors&&this.setPrimitiveColorUpdates(this.primitiveColors.updates()),this.recordPerformanceTransition(`pageSwap.setScene`,performance.now()-n),this.sceneStats}getSceneStats(){return this.sceneStats}getViewState(){return{cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom}}getPresentedViewState(){return{cameraCenterX:this.presentedCameraCenterX,cameraCenterY:this.presentedCameraCenterY,zoom:this.presentedZoom}}getPresentedFrameSerial(){return this.presentedFrameSerial}setViewState(e,t={}){let n=Number(e.cameraCenterX),r=Number(e.cameraCenterY),i=Number(e.zoom);if(!Number.isFinite(n)||!Number.isFinite(r)||!Number.isFinite(i))return;this.cameraCenterX=n,this.cameraCenterY=r;let a=Q(i,this.minZoom,this.maxZoom);this.zoom=a,this.targetCameraCenterX=n,this.targetCameraCenterY=r,this.targetZoom=a,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,t.scheduleFrame!==!1&&this.requestFrame()}setSearchHighlights(e){let t=lt(e);if(!t){(this.highlightOthersCount!==0||this.highlightCurrentCount!==0)&&(this.highlightOthersCount=0,this.highlightCurrentCount=0,this.requestFrame());return}let n=t.otherCount>0?t.otherRects:new Float32Array(4),r=globalThis.GPUBufferUsage,i=!1;(!this.highlightOthersRectsBuffer||this.highlightOthersCapacityBytes<n.byteLength)&&(this.highlightOthersRectsBuffer?.destroy(),this.highlightOthersCapacityBytes=Math.max(n.byteLength,1024),this.highlightOthersRectsBuffer=this.gpuDevice.createBuffer({size:this.highlightOthersCapacityBytes,usage:r.STORAGE|r.COPY_DST}),i=!0);let a=Math.max(16,t.currentRects.byteLength);(!this.highlightCurrentRectBuffer||this.highlightCurrentCapacityBytes<a)&&(this.highlightCurrentRectBuffer?.destroy(),this.highlightCurrentCapacityBytes=Math.max(a,1024),this.highlightCurrentRectBuffer=this.gpuDevice.createBuffer({size:this.highlightCurrentCapacityBytes,usage:r.STORAGE|r.COPY_DST}),i=!0),this.gpuDevice.queue.writeBuffer(this.highlightOthersRectsBuffer,0,n),t.currentCount>0&&this.gpuDevice.queue.writeBuffer(this.highlightCurrentRectBuffer,0,t.currentRects),(i||this.highlightOthersBindGroups.length===0)&&this.rebuildHighlightBindGroups(),this.highlightOthersCount=t.otherCount,this.highlightCurrentCount=t.currentCount,this.requestFrame()}rebuildHighlightBindGroups(){let e=(e,t)=>this.gpuDevice.createBindGroup({layout:this.highlightBindGroupLayout,entries:[{binding:0,resource:{buffer:this.highlightCameraBuffer}},{binding:1,resource:{buffer:this.highlightStyleBuffers[e]}},{binding:2,resource:{buffer:t}}]});this.highlightOthersBindGroups=this.highlightOthersRectsBuffer?[e(0,this.highlightOthersRectsBuffer)]:[],this.highlightCurrentBindGroups=this.highlightCurrentRectBuffer?[e(1,this.highlightCurrentRectBuffer)]:[],this.highlightSelectionBindGroups=this.highlightSelectionRectsBuffer?[e(2,this.highlightSelectionRectsBuffer)]:[]}setTextSelectionHighlights(e){let t=e?Math.floor(e.length/4):0;if(!e||t===0){this.highlightSelectionCount!==0&&(this.highlightSelectionCount=0,this.requestFrame());return}let n=e.length===t*4?e:e.subarray(0,t*4),r=globalThis.GPUBufferUsage,i=!1;(!this.highlightSelectionRectsBuffer||this.highlightSelectionCapacityBytes<n.byteLength)&&(this.highlightSelectionRectsBuffer?.destroy(),this.highlightSelectionCapacityBytes=Math.max(n.byteLength,1024),this.highlightSelectionRectsBuffer=this.gpuDevice.createBuffer({size:this.highlightSelectionCapacityBytes,usage:r.STORAGE|r.COPY_DST}),i=!0),this.gpuDevice.queue.writeBuffer(this.highlightSelectionRectsBuffer,0,n),(i||this.highlightSelectionBindGroups.length===0)&&this.rebuildHighlightBindGroups(),this.highlightSelectionCount=t,this.requestFrame()}drawHighlightsIntoPass(e,t,n,r,i,a){if(this.primitiveHighlights){let o=this.resolveClientToPixelScale();this.frameDrawCalls+=this.primitiveHighlights.draw(e,_(r,i,a,t,n),1/Math.max(a,1e-6),Math.max(o.x,o.y))}if(this.highlightOthersCount===0&&this.highlightCurrentCount===0&&this.highlightSelectionCount===0)return;let o=new Float32Array(8);o[0]=t,o[1]=n,o[2]=r,o[3]=i,o[4]=a,this.gpuDevice.queue.writeBuffer(this.highlightCameraBuffer,0,o),e.setPipeline(this.highlightPipeline),this.highlightSelectionCount>0&&this.highlightSelectionBindGroups.length===1&&(e.setBindGroup(0,this.highlightSelectionBindGroups[0]),e.draw(4,this.highlightSelectionCount,0,0),this.frameDrawCalls+=1),this.highlightOthersCount>0&&this.highlightOthersBindGroups.length===1&&(e.setBindGroup(0,this.highlightOthersBindGroups[0]),e.draw(4,this.highlightOthersCount,0,0),this.frameDrawCalls+=1),this.highlightCurrentCount>0&&this.highlightCurrentBindGroups.length===1&&(e.setBindGroup(0,this.highlightCurrentBindGroups[0]),e.draw(4,this.highlightCurrentCount,0,0),this.frameDrawCalls+=1)}fitToBounds(e,t=64){let n=Math.max(e.maxX-e.minX,1e-4),r=Math.max(e.maxY-e.minY,1e-4),i=Math.max(1,this.canvas.width-t*2),a=Math.max(1,this.canvas.height-t*2),o=Q(Math.min(i/n,a/r),1e-8,this.maxZoom);this.minZoom=Math.min(this.minZoom,o);let s=(e.minX+e.maxX)*.5,c=(e.minY+e.maxY)*.5;this.zoom=o,this.cameraCenterX=s,this.cameraCenterY=c,this.targetZoom=o,this.targetCameraCenterX=s,this.targetCameraCenterY=c,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}panByPixels(e,t){if(!Number.isFinite(e)||!Number.isFinite(t))return;this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction(),this.hasZoomAnchor=!1;let n=this.resolveClientToPixelScale(),r=-(e*n.x)/this.zoom,i=t*n.y/this.zoom;this.cameraCenterX+=r,this.cameraCenterY+=i,this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.needsVisibleSetUpdate=!0,this.requestFrame()}zoomAtClientPoint(e,t,n){let r=Q(n,.1,10);this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction();let i=this.clientToWorld(e,t),a=Q(this.targetZoom*r,this.minZoom,this.maxZoom);this.hasZoomAnchor=!0,this.zoomAnchorClientX=e,this.zoomAnchorClientY=t,this.zoomAnchorWorldX=i.x,this.zoomAnchorWorldY=i.y,this.targetZoom=a;let o=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,a);this.targetCameraCenterX=o.x,this.targetCameraCenterY=o.y,this.needsVisibleSetUpdate=!0,this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.requestFrame()}dispose(){this.paintCompositor?.dispose(),this.paintCompositor=null,this.orderedInstanceBuffer?.destroy(),this.orderedInstanceBuffer=null,this.orderedBatches=null,this.runLookup=null,this.vectorClipTexture?.destroy();for(let e of this.vectorClipBuffers)e.destroy();if(this.vectorClipBuffers=[],this.vectorClipBindGroups=[],!this.isDisposed){this.isDisposed=!0,this.rasterCompression?.dispose(),this.rasterCompression=null,this.primitiveHighlights?.dispose(),this.primitiveHighlights=null,this.primitiveColors=null,this.primitiveGradientColors?.dispose(),this.primitiveGradientColors=null,this.paintFolds?.dispose(),this.performanceProfiler?.dispose(),this.performanceProfiler=null,this.frameTimer?.dispose(),this.frameTimer=null,this.orderedRunCuller=null,this.scenePaintVisibility=null,this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0),this.framePendingOnGpu=!1,this.frameListener=null,this.destroyVectorMinifyResources(),this.destroyDataResources(),this.rasterLayerResources=[],this.scene=null,this.grid=null,this.sceneStats=null,this.segmentIdBufferAll&&=(this.segmentIdBufferAll.destroy(),null),this.segmentIdBufferVisible&&=(this.segmentIdBufferVisible.destroy(),null),this.textInstanceIdBuffer&&=(this.textInstanceIdBuffer.destroy(),null),this.textLodRuntime?.dispose(),this.textLodRuntime=null,this.orderedTextLod=null,this.textLodGpuActive=!1,this.selectedTextInstanceCount=0,this.useTextInstanceIndirection=!1,this.cameraUniformBuffer&&this.cameraUniformBuffer.destroy(),this.highlightCameraBuffer&&this.highlightCameraBuffer.destroy();for(let e of this.highlightStyleBuffers)e.destroy();this.highlightOthersRectsBuffer&&=(this.highlightOthersRectsBuffer.destroy(),null),this.highlightCurrentRectBuffer&&(this.highlightCurrentRectBuffer.destroy(),this.highlightCurrentRectBuffer=null,this.highlightCurrentCapacityBytes=0),this.highlightSelectionRectsBuffer&&=(this.highlightSelectionRectsBuffer.destroy(),null),this.vectorCompositeUniformBuffer&&this.vectorCompositeUniformBuffer.destroy(),this.pageBackgroundTexture&&=(this.pageBackgroundTexture.destroy(),null),this.pagePlaceholderUniformBuffer?.destroy(),this.pagePlaceholderUniformBuffer=null,Z(this.gpuDevice,this.gpuContext)}}configureContext(){this.gpuContext.configure({device:this.gpuDevice,format:this.presentationFormat,alphaMode:`opaque`,usage:20})}createPipeline(e,t,n,r,i=!1,a,o){let s=this.gpuDevice.createShaderModule({code:e}),c=i?`one`:`src-alpha`,l=this.gpuDevice.createRenderPipeline({layout:r,vertex:{module:s,entryPoint:t,...o?{buffers:o}:{}},fragment:{module:s,entryPoint:n,targets:[{format:this.presentationFormat,blend:a===void 0?{color:{srcFactor:c,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}}:He(a)}]},primitive:{topology:o?`triangle-list`:`triangle-strip`}});return a===void 0&&this.multiplyPipelineFactories.set(l,()=>{let a=i?e:Xe(e);return[this.createPipeline(a,t,n,r,!0,0,o),this.createPipeline(a,t,n,r,!0,1,o)]}),this.paintPipelineRecipes.set(l,{shaderSource:e,vertexEntry:t,fragmentEntry:n,layout:r,premultipliedColor:i,multiplyPass:a,vertices:o}),l}getPaintShapePipeline(e){let t=this.shapePipelines.get(e);if(t)return t;let n=this.paintPipelineRecipes.get(e);return n?(t=this.createPipeline(Ue(n.shaderSource),n.vertexEntry,n.fragmentEntry,n.layout,n.premultipliedColor,void 0,n.vertices),this.shapePipelines.set(e,t),t):e}multiplyPipeline(e,t){let n=this.multiplyPipelines.get(e);return n||(n=this.multiplyPipelineFactories.get(e)(),this.multiplyPipelines.set(e,n)),n[t]}maxTextureSize(){let e=Number(this.gpuDevice?.limits?.maxTextureDimension2D);return Number.isFinite(e)&&e>=1?Math.floor(e):8192}ensureSegmentIdBuffers(e){let t=Math.max(1,e)*4;this.segmentIdBufferAll&&=(this.segmentIdBufferAll.destroy(),null),this.segmentIdBufferVisible&&=(this.segmentIdBufferVisible.destroy(),null),this.segmentIdBufferAll=this.createSegmentIdStorageBuffer(t),this.segmentIdBufferVisible=this.createSegmentIdStorageBuffer(t)}canFitTextLodStorageBuffer(e){let t=Math.max(1,e)*4,n=Number(this.gpuDevice?.limits?.maxStorageBufferBindingSize),r=Number(this.gpuDevice?.limits?.maxBufferSize);return(!Number.isFinite(n)||t<=n)&&(!Number.isFinite(r)||t<=r)}ensureTextInstanceIdBuffer(e){this.textInstanceIdBuffer?.destroy(),this.textInstanceIdBuffer=this.createSegmentIdStorageBuffer(Math.max(1,e),!1)}createSegmentIdStorageBuffer(e,t=!0){let n=globalThis.GPUBufferUsage,r=t?e:Math.max(1,e)*4;return this.gpuDevice.createBuffer({size:Math.max(4,r),usage:n.STORAGE|n.COPY_DST})}requestFrame(){if(this.externalFrameDriver){this.externalFramePending=!0;return}if(this.rafHandle===0){if(this.gpuFramesInFlight>=It){this.framePendingOnGpu=!0;return}this.rafHandle=requestAnimationFrame(e=>{this.rafHandle=0,this.gpuFramesInFlight++;try{this.render(e)}finally{this.waitForGpuFrame()}})}}waitForGpuFrame(){let e=()=>{this.gpuFramesInFlight=Math.max(0,this.gpuFramesInFlight-1),this.framePendingOnGpu&&!this.isDisposed&&(this.framePendingOnGpu=!1,this.requestFrame())},t=this.gpuDevice?.queue;if(this.isDisposed||typeof t?.onSubmittedWorkDone!=`function`){e();return}t.onSubmittedWorkDone().then(e,e)}getPerformanceProfiler(){return this.frameTimer??=new Ct(this.gpuDevice),this.performanceProfiler??=new pt({gpuTimer:this.frameTimer})}createFrameEncoder(){let e=this.gpuDevice.createCommandEncoder();return this.frameTimer?.instrument(e)??e}render(e=performance.now()){let t=this.performanceProfiler?.enabled?this.performanceProfiler:null;t?.beginFrame(e);try{this.renderFrame(e,t)}finally{t?.add(`drawCalls`,this.frameDrawCalls),t?.endFrame()}}renderFrame(e,t){this.frameDrawCalls=0,this.paintFolds?.beginFrame(),t?.setFrameContext({cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom,viewportWidth:this.canvas.width,viewportHeight:this.canvas.height,unitsPerPixel:1/Math.max(this.zoom,1e-6)});let n=this.updateCameraWithDamping(e);if(this.updatePanReleaseVelocitySample(e),this.updateRasterResolution(),!this.scene||this.segmentCount===0&&this.fillPathCount===0&&this.textInstanceCount===0&&(this.gradientData?.gradientFillPathCount??0)===0&&(this.gradientData?.gradientStrokeRunCount??0)===0&&this.rasterLayerResources.length===0&&this.pageBackgroundResources.length===0){this.clearToScreen(),this.capturePresentedFrameState(),this.frameListener?.({drawCalls:this.frameDrawCalls,renderedSegments:0,totalSegments:0,usedCulling:!1,zoom:this.zoom}),n&&this.requestFrame();return}if(!this.hasNativeRenderingEnabled()){this.capturePresentedFrameState(),this.frameListener?.({drawCalls:this.frameDrawCalls,renderedSegments:0,totalSegments:this.segmentCount,usedCulling:!1,zoom:this.zoom}),n&&this.requestFrame();return}t?.beginSection(`drawSubmission`);try{this.renderDirectToScreen()}finally{t?.endSection(`drawSubmission`)}this.capturePresentedFrameState(),(n||this.scene?.pendingPagePreviews&&this.rasterRenderingEnabled&&this.pageBackgroundColor[3]>0&&l()&&a(this.scene,{...this.getViewState(),width:this.canvas.width,height:this.canvas.height}))&&this.requestFrame()}hasNativeRenderingEnabled(){return this.rasterRenderingEnabled||this.fillRenderingEnabled||this.strokeRenderingEnabled||this.textRenderingEnabled}capturePresentedFrameState(){this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.presentedFrameSerial+=1}isTextHeavyStrokeFreeScene(){return at(this.textInstanceCount,this.segmentCount)}renderDirectToScreen(){let e=this.shouldUseVectorMinifyPath()&&this.ensureVectorMinifyResources();if(this.vectorLodRuntime&&(e=!1),this.needsVisibleSetUpdate){if(e){let e=this.computeVectorMinifyZoom(this.vectorMinifyWidth,this.vectorMinifyHeight);this.updateStrokeVisibleSet(this.cameraCenterX,this.cameraCenterY,this.vectorMinifyWidth,this.vectorMinifyHeight,e)}else this.updateStrokeVisibleSet(this.cameraCenterX,this.cameraCenterY,this.canvas.width,this.canvas.height,this.zoom);this.needsVisibleSetUpdate=!1}if(e){let e=this.getOrderedGradientMinifyPlan(),t=this.renderVectorLayerIntoMinifyTarget(this.vectorMinifyWidth,this.vectorMinifyHeight,this.cameraCenterX,this.cameraCenterY,e.includeGradientPaint),n=this.gpuContext.getCurrentTexture().createView(),r=this.createFrameEncoder(),i=I(r,{label:`frame`,colorAttachments:[{view:n,clearValue:B,loadOp:`clear`,storeOp:`store`}]});this.updateCameraUniforms(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY,this.zoom,!1),e.splitOrderedGradientPrefix?this.drawOrderedGradientPaintIntoPass(i):this.drawRasterContentIntoPass(i),this.drawVectorMinifyCompositeIntoPass(i,this.canvas.width,this.canvas.height),this.drawHighlightsIntoPass(i,this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY,this.zoom),i.end(),this.gpuDevice.queue.submit([r.finish()]),this.frameListener?.({drawCalls:this.frameDrawCalls,renderedSegments:t,totalSegments:this.segmentCount,redundantSegments:this.getRedundantSegmentCount(),paintOrderApproximated:this.isPaintOrderApproximated(),usedCulling:this.scene?.drawRuns?this.orderedRunsCulled:!this.usingAllSegments,zoom:this.zoom});return}let t=this.gpuContext.getCurrentTexture().createView(),n=this.createFrameEncoder(),r=I(n,{label:`frame`,colorAttachments:[{view:t,clearValue:B,loadOp:`clear`,storeOp:`store`}]}),i=this.drawSceneIntoPass(r,this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY);this.drawHighlightsIntoPass(r,this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY,this.zoom),r.end(),this.gpuDevice.queue.submit([n.finish()]),this.frameListener?.({drawCalls:this.frameDrawCalls,renderedSegments:i,totalSegments:this.segmentCount,redundantSegments:this.getRedundantSegmentCount(),paintOrderApproximated:this.isPaintOrderApproximated(),usedCulling:this.scene?.drawRuns?this.orderedRunsCulled:!this.usingAllSegments,zoom:this.zoom})}getRedundantSegmentCount(){return this.strokeRenderingEnabled?this.orderedBatches?.culledSegmentCount??0:0}isPaintOrderApproximated(){return this.orderedBatches?.paintOrderApproximated??!1}hasOrdinaryVectorContent(){return this.fillRenderingEnabled&&this.fillPathCount>0||this.strokeRenderingEnabled&&this.segmentCount>0||this.textRenderingEnabled&&this.textInstanceCount>0}hasVectorContent(){return this.hasOrdinaryVectorContent()||this.fillRenderingEnabled&&(this.gradientData?.gradientFillPathCount??0)>0||this.strokeRenderingEnabled&&(this.gradientData?.gradientStrokeRunCount??0)>0}shouldUseVectorMinifyPath(){return this.scene?.drawRuns,!1}getOrderedGradientMinifyPlan(){return ee(this.rasterRenderingEnabled,this.gradientPaintRequiresDirectRendering,this.hasOrdinaryVectorContent(),this.hasVectorContent())}computeVectorMinifyZoom(e,t){let n=Math.min(e/Math.max(1,this.canvas.width),t/Math.max(1,this.canvas.height));return this.zoom*Math.max(1,n)}renderVectorLayerIntoMinifyTarget(e,t,n,r,i){if(!this.vectorMinifyTexture)return 0;let a=this.computeVectorMinifyZoom(e,t),o=this.createFrameEncoder(),s=I(o,{label:`minify`,colorAttachments:[{view:this.vectorMinifyTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:`clear`,storeOp:`store`}]});this.updateCameraUniforms(e,t,n,r,a,!0,{viewportWidth:this.canvas.width,viewportHeight:this.canvas.height,cameraCenterX:n,cameraCenterY:r,zoom:this.zoom}),i&&this.drawOrderedGradientVectorsIntoPass(s);let c=this.drawVectorContentIntoPass(s);return s.end(),this.gpuDevice.queue.submit([o.finish()]),c}drawVectorMinifyCompositeIntoPass(e,t,n){this.vectorCompositeBindGroup&&this.vectorMinifyTexture&&(this.updateVectorCompositeUniforms(t,n),e.setPipeline(this.vectorCompositePipeline),e.setBindGroup(0,this.vectorCompositeBindGroup),e.draw(4,1,0,0),this.frameDrawCalls+=1)}drawSceneIntoPass(e,t,n,r,i){return this.updateCameraUniforms(t,n,r,i),this.scene?.drawRuns?(this.orderedCullingBounds=Te(t,n,r,i,this.zoom),this.drawSourceOrderedContentIntoPass(e)):(this.drawOrderedGradientPaintIntoPass(e),this.drawVectorContentIntoPass(e))}drawPageBackgroundContentIntoPass(e){if(this.rasterRenderingEnabled&&this.pageBackgroundResources.length!==0){e.setPipeline(this.pageBackgroundPipeline),this.scene?.pendingPagePreviews?.some(Boolean)&&this.gpuDevice.queue.writeBuffer(this.pagePlaceholderUniformBuffer,0,Float32Array.of(s(),0,0,0)),this.bindVectorClip(e);for(let t of this.pageBackgroundResources)e.setBindGroup(0,t.bindGroup),e.draw(4,t.count,0,0),this.frameDrawCalls+=1,this.performanceProfiler?.enabled&&(this.performanceProfiler.add(`pageBackgroundBatches`),this.performanceProfiler.add(`pageBackgroundInstances`,t.count))}}drawOrderedGradientPaintIntoPass(e){this.drawPageBackgroundContentIntoPass(e);for(let t of this.orderedGradientPaintCommands)if(t.kind===`raster`){if(!this.rasterRenderingEnabled)continue;let n=this.rasterLayerResources[t.index];n&&(e.setPipeline(this.rasterPipeline),this.bindVectorClip(e),this.drawRasterLayerResource(e,n))}else t.kind===`gradient-fill`?this.fillRenderingEnabled&&this.drawGradientFillIntoPass(e,t.index):this.strokeRenderingEnabled&&this.drawGradientStrokeIntoPass(e,t.index)}drawOrderedGradientVectorsIntoPass(e){for(let t of this.orderedGradientPaintCommands)t.kind===`gradient-fill`&&this.fillRenderingEnabled?this.drawGradientFillIntoPass(e,t.index):t.kind===`gradient-stroke`&&this.strokeRenderingEnabled&&this.drawGradientStrokeIntoPass(e,t.index)}drawGradientFillIntoPass(e,t){let n=this.gradientData;if(!n||!this.gradientFillBindGroup||t<0||t>=n.gradientFillPathCount)return;let r=this.gradientMeshRanges?.[t*2+1]??0;e.setPipeline(r?this.gradientMeshPipeline:this.gradientFillPipeline),this.bindVectorClip(e),e.setBindGroup(0,this.gradientFillBindGroup),this.primitiveGradientColors??=new N(this.gpuDevice,this.primitiveGradientLayout),e.setBindGroup(2,this.primitiveGradientColors.bindGroup(`gradient-fill`,t)),r||this.paintFolds?.bind(e,3),r?(e.setVertexBuffer(0,this.gradientMeshBuffer),e.draw(r,1,this.gradientMeshRanges[t*2],t)):e.draw(4,1,t*4,0),this.frameDrawCalls+=1}drawGradientStrokeIntoPass(e,t){let n=this.gradientData;if(!n||!this.gradientStrokeBindGroup||t<0||t>=n.gradientStrokeRunCount)return;let r=Math.max(0,Math.trunc(n.gradientStrokeRunMetaA[t*4+1]??0));r!==0&&(e.setPipeline(this.gradientStrokePipeline),this.bindVectorClip(e),e.setBindGroup(0,this.gradientStrokeBindGroup),this.primitiveGradientColors??=new N(this.gpuDevice,this.primitiveGradientLayout),e.setBindGroup(2,this.primitiveGradientColors.bindGroup(`gradient-stroke`,t)),e.draw(4,r,t*4,0),this.frameDrawCalls+=1)}drawRasterContentIntoPass(e){if(this.rasterRenderingEnabled&&(this.drawPageBackgroundContentIntoPass(e),this.rasterLayerResources.length>0)){e.setPipeline(this.rasterPipeline),this.bindVectorClip(e);for(let t of this.orderedGradientPaintCommands){if(t.kind!==`raster`)continue;let n=this.rasterLayerResources[t.index];n&&this.drawRasterLayerResource(e,n)}}}drawRasterLayerResource(e,t){e.setBindGroup(0,t.bindGroup),e.draw(4,1,0,0),this.frameDrawCalls+=1;for(let n of t.extraTiles??[])e.setBindGroup(0,n.bindGroup),e.draw(4,1,0,0),this.frameDrawCalls+=1}uploadVectorClips(e){this.vectorClipTexture?.destroy();for(let e of this.vectorClipBuffers)e.destroy();this.vectorClipBuffers=[],this.vectorClipBindGroups=[];let t=this.maxTextureSize(),n=ge(e.clipPaths,Math.min(ye,t**2),{cells:!0}),r=Y(n.length/4,t);this.vectorClipTexture=this.createFloatTexture(r.width,r.height,n);let i=globalThis.GPUBufferUsage;this.vectorClipBounds=xe(e.clipPaths);for(let t=-2;t<(e.clipPaths?.length??0);t++){let e=this.gpuDevice.createBuffer({size:32,usage:i.UNIFORM|i.COPY_DST}),n=t>=0?this.vectorClipBounds.subarray(t*4,t*4+4):ve;this.gpuDevice.queue.writeBuffer(e,0,new Float32Array([t,0,0,0,...n])),this.vectorClipBuffers.push(e)}this.refreshVectorClipBindGroups(),this.vectorClipIndex=-1}refreshVectorClipBindGroups(){let e=this.vectorClipTexture.createView();this.vectorClipBindGroups=this.vectorClipBuffers.map(t=>this.gpuDevice.createBindGroup({layout:this.vectorClipBindGroupLayout,entries:[{binding:0,resource:e},{binding:1,resource:{buffer:t}},{binding:2,resource:{buffer:this.orderedInstanceBuffer}}]}))}growOrderedInstanceBuffer(e){if(e>this.orderedInstanceCapacityBytes){let t=globalThis.GPUBufferUsage;this.orderedInstanceBuffer?.destroy(),this.orderedInstanceCapacityBytes=Math.max(8,e),this.orderedInstanceBuffer=this.gpuDevice.createBuffer({size:this.orderedInstanceCapacityBytes,usage:t.STORAGE|t.COPY_DST}),this.refreshVectorClipBindGroups()}}bindVectorClip(e){e.setBindGroup(1,this.vectorClipBindGroups[this.vectorClipIndex+2])}drawSourceOrderedContentIntoPass(e){this.vectorClipIndex=-1;let t=0,n=this.orderedRunCuller?.select(this.orderedCullingBounds,1/Math.max(this.zoom,1e-6),this.orderedBatches?.cullingPadding)??this.scene.drawRuns,r=this.optionalContentVisibility,i=this.scenePaintVisibility??=new O(this.scene);i.setVisibility(r);let a=i.select(n);this.orderedRunsCulled=a.length<this.scene.drawRuns.length;let o=this.orderedBatches,s=o?.update(a,1/Math.max(this.zoom,1e-6))??!1;this.orderedRunsCulled||=this.strokeRenderingEnabled&&(o?.culledSegmentCount??0)>0,o&&s&&o.instanceCount>0&&(this.growOrderedInstanceBuffer(o.uintInstances.byteLength),this.gpuDevice.queue.writeBuffer(this.orderedInstanceBuffer,0,o.uintInstances.subarray(0,o.instanceCount*2))),this.drawPageBackgroundContentIntoPass(e);let c=(n,r)=>{this.vectorClipIndex=n.clipIndex??-1;let a=n.kind===`fill`&&this.fillRenderingEnabled?this.fillPipeline:n.kind===`stroke`&&this.strokeRenderingEnabled?this.strokePipeline:n.kind===`text`&&this.textRenderingEnabled?this.textPipeline:null,s=n.kind===`fill`?this.fillBindGroup:n.kind===`stroke`?(o?this.vectorLodLevelResources[0]?.bindGroup:null)??this.strokeBindGroupAll:this.textBindGroup;if(a&&s)e.setPipeline(r===void 0?a:this.multiplyPipeline(a,r)),this.bindVectorClip(e),e.setBindGroup(0,s),n.kind===`fill`&&this.paintFolds?.bind(e,2),e.draw(4,n.count,0,n.first),this.frameDrawCalls+=1,n.kind===`stroke`&&(t+=n.count);else for(let t=n.first;t<n.first+n.count;t++)if(n.kind===`raster`&&this.rasterRenderingEnabled){let a=r===void 0&&!i.requiresCompositing?this.rasterStripResources?.get(t):void 0;if(a&&a.first+a.count<=n.first+n.count){e.setPipeline(this.rasterStripPipeline),this.bindVectorClip(e),e.setBindGroup(0,a.bindGroup),e.draw(4,a.count,0,0),this.frameDrawCalls+=1,t+=a.count-1;continue}let o=this.rasterLayerResources[t];o&&(e.setPipeline(r===void 0?this.rasterPipeline:this.multiplyPipeline(this.rasterPipeline,r)),this.bindVectorClip(e),this.drawRasterLayerResource(e,o))}else n.kind===`gradient-fill`&&this.fillRenderingEnabled?this.drawGradientFillIntoPass(e,t):n.kind===`gradient-stroke`&&this.strokeRenderingEnabled&&this.drawGradientStrokeIntoPass(e,t)};if(i.requiresCompositing){this.paintCompositor??=new kt(this.gpuDevice,this.presentationFormat,()=>{this.frameDrawCalls+=1});let n=e;try{let i=De(this.scene);this.paintCompositor.render(this.scene,n,this.paintViewportWidth,this.paintViewportHeight,(n,r,a)=>{e=a?new Proxy(r,{get:(e,t)=>t===`setPipeline`?t=>e.setPipeline(this.getPaintShapePipeline(t)):typeof e[t]==`function`?e[t].bind(e):e[t]}):r;let s=t;ut(n,o,i,this.runLookup,e=>c(e)),a&&(t=s)},e=>e===void 0||r?.conditions[e]===1,this.orderedRunCuller?.selected??null,e=>({x:(e.minX-this.paintCameraCenterX)*this.paintZoom+this.paintViewportWidth/2,y:(e.minY-this.paintCameraCenterY)*this.paintZoom+this.paintViewportHeight/2,width:(e.maxX-e.minX)*this.paintZoom,height:(e.maxY-e.minY)*this.paintZoom}),{canFold:e=>e.count===1&&this.fillRenderingEnabled&&(e.kind===`fill`||e.kind===`gradient-fill`&&!(this.gradientMeshRanges?.[e.first*2+1]??0)),canFoldMaskPaint:(e,t)=>this.fillRenderingEnabled&&this.vectorOverrideOpacity===0&&!this.primitiveColors?.gradient(`gradient-fill`,t.first),draw:(t,n,r,i,a,o)=>{this.performanceProfiler?.add(`foldedPaints`),o&&this.performanceProfiler?.add(`computedMasks`),this.paintFolds?.begin(r,o?this.gradientLutView:i,a,o),e=n;try{c(t)}finally{this.paintFolds?.end()}}})}finally{e=n,this.vectorClipIndex=-1}return t}for(let e of o?.batches??a){if(!e.blendMode){c(e);continue}for(let t=e.first;t<e.first+e.count;t++){let n={...e,first:t,count:1};c(n,0),c(n,1)}e.kind===`stroke`&&this.strokeRenderingEnabled&&(t-=e.count)}return this.vectorClipIndex=-1,t}drawVectorContentIntoPass(e){this.fillRenderingEnabled&&this.fillPathCount>0&&this.fillBindGroup&&(e.setPipeline(this.fillPipeline),this.bindVectorClip(e),e.setBindGroup(0,this.fillBindGroup),this.paintFolds?.bind(e,2),e.draw(4,this.fillPathCount,0,0),this.frameDrawCalls+=1);let t=0;if(this.strokeRenderingEnabled&&this.vectorLodRuntime&&this.vectorLodLevelResources.length>0)for(let n=0;n<this.vectorLodRuntime.levels.length;n+=1){let r=this.vectorLodRuntime.levels[n],i=this.vectorLodLevelResources[n],a=Math.max(0,r.visibleSegmentCount|0);!i||a<=0||!i.bindGroup||(e.setPipeline(this.strokePipeline),this.bindVectorClip(e),e.setBindGroup(0,i.bindGroup),e.draw(4,a,0,0),this.frameDrawCalls+=1,t+=a)}else if(t=this.strokeRenderingEnabled?this.usingAllSegments?this.segmentCount:this.visibleSegmentCount:0,t>0){let n=this.usingAllSegments?this.strokeBindGroupAll:this.strokeBindGroupVisible;n&&(e.setPipeline(this.strokePipeline),this.bindVectorClip(e),e.setBindGroup(0,n),e.draw(4,t,0,0),this.frameDrawCalls+=1)}if(this.textRenderingEnabled&&this.textInstanceCount>0&&this.textBindGroup){let n=this.useTextInstanceIndirection?this.selectedTextInstanceCount:this.textInstanceCount;if(n<=0)return t;e.setPipeline(this.textPipeline),this.bindVectorClip(e),e.setBindGroup(0,this.textBindGroup),e.draw(4,n,0,0),this.frameDrawCalls+=1}return t}updateCameraUniforms(e,t,n,r,i=this.zoom,a=!0,o){this.scene?.drawRuns&&(a&&this.orderedTextLod&&this.updateTextLodSelection(e,t,n,r,i),a=!1,this.useTextInstanceIndirection=!1),a&&(this.useTextInstanceIndirection=this.updateTextLodSelection(o?.viewportWidth??e,o?.viewportHeight??t,o?.cameraCenterX??n,o?.cameraCenterY??r,o?.zoom??i)),this.paintViewportWidth=e,this.paintViewportHeight=t,this.paintCameraCenterX=n,this.paintCameraCenterY=r,this.paintZoom=i;let s=new Float32Array(Bt);s[0]=e,s[1]=t,s[2]=n,s[3]=r,s[4]=i,s[5]=1,s[6]=+!!this.strokeCurveEnabled,s[7]=1.25,s[8]=+!!this.strokeCurveEnabled,s[9]=1,s[10]=+!!this.textVectorOnly,s[11]=a&&this.useTextInstanceIndirection?1:0,s[12]=this.vectorOverrideColor[0],s[13]=this.vectorOverrideColor[1],s[14]=this.vectorOverrideColor[2],s[15]=this.vectorOverrideOpacity,s[16]=this.fillBandBase,s[17]=this.fillBandEntries,s[18]=this.gradientFillBandBase,s[19]=this.gradientFillBandEntries,s[20]=this.fillCellBase+1,s[21]=this.gradientFillCellBase+1,J(s,V,`camera`),this.gpuDevice.queue.writeBuffer(this.cameraUniformBuffer,0,s)}updateTextLodSelection(e,t,n,r,i){let a=this.textLodRuntime;if(!a||!this.textLodGpuActive||this.textLodMode===`off`||!this.textInstanceIdBuffer)return this.selectedTextInstanceCount=0,this.orderedTextLod&&this.orderedBatches?.setTextSelection(null),!1;let o=a.update({localToClip:_(n,r,i,e,t),viewportWidth:e,viewportHeight:t,pixelRatio:this.canvas.clientWidth>0?this.canvas.width/this.canvas.clientWidth:1});return this.selectedTextInstanceCount=o.instanceIds.length,this.orderedTextLod?(this.orderedTextLod.update(o),this.orderedBatches?.setTextSelection(this.orderedTextLod),!0):(o.changed&&o.instanceIds.length>0&&this.gpuDevice.queue.writeBuffer(this.textInstanceIdBuffer,0,o.instanceIds),!0)}updateVectorCompositeUniforms(e,t){let n=new Float32Array(Vt);n[0]=e,n[1]=t,n[2]=0,n[3]=0,J(n,H,`vector composite`),this.gpuDevice.queue.writeBuffer(this.vectorCompositeUniformBuffer,0,n)}ensureVectorMinifyResources(){let e=this.maxTextureSize(),t=e/Math.max(1,this.canvas.width),n=e/Math.max(1,this.canvas.height),r=Math.max(1,Math.min(Nt,t,n)),i=Math.max(this.canvas.width,Math.floor(this.canvas.width*r)),a=Math.max(this.canvas.height,Math.floor(this.canvas.height*r));if(i<this.canvas.width||a<this.canvas.height)return!1;if(this.vectorMinifyTexture&&this.vectorMinifyWidth===i&&this.vectorMinifyHeight===a&&this.vectorCompositeBindGroup)return!0;this.destroyVectorMinifyResources();let o=globalThis.GPUTextureUsage;return this.vectorMinifyTexture=this.gpuDevice.createTexture({size:{width:i,height:a,depthOrArrayLayers:1},format:this.presentationFormat,usage:o.RENDER_ATTACHMENT|o.TEXTURE_BINDING}),this.vectorMinifyWidth=i,this.vectorMinifyHeight=a,this.vectorCompositeBindGroup=this.gpuDevice.createBindGroup({layout:this.vectorCompositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.vectorCompositeSampler},{binding:1,resource:this.vectorMinifyTexture.createView()},{binding:2,resource:{buffer:this.vectorCompositeUniformBuffer,size:H}}]}),!0}destroyVectorMinifyResources(){this.vectorMinifyTexture&&=(this.vectorMinifyTexture.destroy(),null),this.vectorMinifyWidth=0,this.vectorMinifyHeight=0,this.vectorCompositeBindGroup=null}updateVisibleSet(e=this.cameraCenterX,t=this.cameraCenterY,n=this.canvas.width,r=this.canvas.height,i=this.zoom){if(!this.scene||!this.grid||this.orderedBatches){this.visibleSegmentCount=this.scene&&this.orderedBatches?this.segmentCount:0,this.usingAllSegments=!0;return}if(!this.hasCameraInteractionSinceSceneLoad){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount;return}let a=this.grid,o=Math.max(i,1e-6),s=n/(2*o),c=r/(2*o),l=Math.max(16/o,this.scene.maxHalfWidth*2),u=e-s-l,d=e+s+l,f=t-c-l,p=t+c+l,m=$(Math.floor((u-a.minX)/a.cellWidth),a.gridWidth),h=$(Math.floor((d-a.minX)/a.cellWidth),a.gridWidth),g=$(Math.floor((f-a.minY)/a.cellHeight),a.gridHeight),_=$(Math.floor((p-a.minY)/a.cellHeight),a.gridHeight),v=(h-m+1)*(_-g+1),y=a.gridWidth*a.gridHeight;if(!this.isInteractionActive()&&v>=y*Mt){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount;return}this.usingAllSegments=!1,this.markToken+=1,this.markToken===4294967295&&(this.segmentMarks.fill(0),this.markToken=1);let b=0;for(let e=g;e<=_;e+=1){let t=e*a.gridWidth+m;for(let e=m;e<=h;e+=1){let e=a.offsets[t],n=a.counts[t];for(let t=0;t<n;t+=1){let n=a.indices[e+t];this.segmentMarks[n]!==this.markToken&&(this.segmentMarks[n]=this.markToken,!(this.segmentMaxX[n]<u||this.segmentMinX[n]>d||this.segmentMaxY[n]<f||this.segmentMinY[n]>p)&&(this.visibleSegmentIds[b]=n,b+=1))}t+=1}}if(this.visibleSegmentCount=b,this.segmentIdBufferVisible&&b>0){let e=this.visibleSegmentIds.subarray(0,b);this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible,0,e)}}updateStrokeVisibleSet(e=this.cameraCenterX,t=this.cameraCenterY,n=this.canvas.width,r=this.canvas.height,i=this.zoom){if(this.vectorLodRuntime){this.updateVectorLodVisibleSet(e,t,n,r,i);return}this.updateVisibleSet(e,t,n,r,i)}updateVectorLodVisibleSet(e=this.cameraCenterX,t=this.cameraCenterY,n=this.canvas.width,r=this.canvas.height,i=this.zoom){if(!this.scene||!this.vectorLodRuntime){this.vectorLodStats=null,this.visibleSegmentCount=0,this.usingAllSegments=!0;return}let a=Math.max(i,1e-6);this.vectorLodRuntime.setScreenSpaceTransform(),this.vectorLodRuntime.updateForLocalUnitsPerPixel(1/a);let o=this.vectorLodRuntime.update({cameraCenterX:e,cameraCenterY:t,zoom:a},{width:Math.max(1,n),height:Math.max(1,r)},null);if(this.vectorLodStats=this.vectorLodRuntime.getStats(),this.visibleSegmentCount=this.vectorLodStats.renderedSegments,this.usingAllSegments=!1,o){if(this.orderedBatches){this.orderedBatches.invalidate();return}for(let e=0;e<this.vectorLodRuntime.levels.length;e+=1){let t=this.vectorLodRuntime.levels[e],n=this.vectorLodLevelResources[e];if(!n)continue;let r=Math.max(0,t.visibleSegmentCount|0);if(r>0){if(r*4>n.visibleSegmentIdBuffer.size){let e=Math.min(t.segmentCount,Math.max(r,Math.ceil(n.visibleSegmentIdBuffer.size/4*1.5)));n.visibleSegmentIdBuffer.destroy(),n.visibleSegmentIdBuffer=this.createSegmentIdStorageBuffer(e,!1),n.bindGroup=this.createStrokeBindGroup(n.textureA,n.textureB,n.textureC,n.textureD,n.visibleSegmentIdBuffer)}this.gpuDevice.queue.writeBuffer(n.visibleSegmentIdBuffer,0,t.visibleSegmentIds.subarray(0,r))}}}}rebuildVectorLod(e){this.destroyVectorLodResources();let t=this.prepareVectorLod(e),n=this.orderedBatches?.strokeRecords??Oe(e),r=Y(n.count,this.maxTextureSize());for(let e of[this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD])e?.destroy();return this.segmentTextureWidth=r.width,this.segmentTextureHeight=r.height,this.createStrokeTextures(r.width,r.height,n),this.refreshStrokeBindGroups(),this.uploadVectorLodLevels(),t}refreshStrokeBindGroups(){this.strokeBindGroupAll=this.createStrokeBindGroup(this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD,this.segmentIdBufferAll),this.strokeBindGroupVisible=this.createStrokeBindGroup(this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD,this.segmentIdBufferVisible)}prepareVectorLod(e){te(this.vectorLodMode,`webgpu`,e.segmentCount)?(this.vectorLodRuntime=oe(e)??new x(e),this.vectorLodRuntime.setForceExact(this.primitiveColors?.has(`stroke`)??!1)):this.vectorLodRuntime=null,this.vectorLodStats=null,this.runLookup=rt(e),this.orderedBatches=e.drawRuns?new ct(e,this.vectorLodRuntime&&this.vectorLodRuntime.levels.length>1?this.vectorLodRuntime:null):null,this.orderedBatches?.setColorCommutationEnabled(!this.primitiveColors?.has(`stroke`)&&!this.primitiveColors?.has(`fill`)&&!this.primitiveColors?.has(`text`)),this.orderedInstanceBuffer?.destroy();let t=globalThis.GPUBufferUsage;return this.orderedInstanceCapacityBytes=Math.max(8,this.orderedBatches?.uintInstances.byteLength??0),this.orderedInstanceBuffer=this.gpuDevice.createBuffer({size:this.orderedInstanceCapacityBytes,usage:t.STORAGE|t.COPY_DST}),this.uploadVectorClips(e),!this.vectorLodRuntime||this.vectorLodRuntime.levels.length<=1?(this.vectorLodRuntime=null,!1):this.vectorLodRuntime.levels.length>1}uploadVectorLodLevels(){if(this.destroyVectorLodResources(),!this.vectorLodRuntime)return;let e=this.maxTextureSize();if(this.orderedBatches){let e=this.segmentTextureA,t=this.segmentTextureB,n=this.segmentTextureC,r=this.segmentTextureD,i=this.createSegmentIdStorageBuffer(1,!1);this.vectorLodLevelResources.push({textureA:e,textureB:t,textureC:n,textureD:r,textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,ownsTextures:!1,visibleSegmentIdBuffer:i,bindGroup:this.strokeBindGroupAll});return}for(let t=0;t<this.vectorLodRuntime.levels.length;t+=1){let n=this.vectorLodRuntime.levels[t],r=this.createSegmentIdStorageBuffer(1,!1);if(t===0){this.vectorLodLevelResources.push({textureA:this.segmentTextureA,textureB:this.segmentTextureB,textureC:this.segmentTextureC,textureD:this.segmentTextureD,textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,visibleSegmentIdBuffer:r,bindGroup:this.createStrokeBindGroup(this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD,r),ownsTextures:!1});continue}let i=fe(n),a=Y(i.segmentCount,e),o=this.createFloatTexture(a.width,a.height,i.endpoints),s=this.createFloatTexture(a.width,a.height,i.primitiveMeta),c=this.createFloatTexture(a.width,a.height,i.styles),l=this.createFloatTexture(a.width,a.height,i.primitiveBounds);this.vectorLodLevelResources.push({textureA:o,textureB:s,textureC:c,textureD:l,textureWidth:a.width,textureHeight:a.height,visibleSegmentIdBuffer:r,bindGroup:this.createStrokeBindGroup(o,s,c,l,r),ownsTextures:!0})}}createStrokeBindGroup(e,t,n,r,i){return this.gpuDevice.createBindGroup({layout:this.strokePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:V}},{binding:1,resource:e.createView()},{binding:2,resource:t.createView()},{binding:3,resource:n.createView()},{binding:4,resource:r.createView()},{binding:5,resource:{buffer:i}}]})}destroyVectorLodResources(){for(let e of this.vectorLodLevelResources)e.ownsTextures&&(e.textureA?.destroy(),e.textureB?.destroy(),e.textureC?.destroy(),e.textureD?.destroy()),e.visibleSegmentIdBuffer?.destroy();this.vectorLodLevelResources=[],this.vectorLodStats=null}buildSegmentBounds(e){if(e.drawRuns){this.segmentMinX=new Float32Array,this.segmentMinY=new Float32Array,this.segmentMaxX=new Float32Array,this.segmentMaxY=new Float32Array;return}this.segmentMinX.length<this.segmentCount&&(this.segmentMinX=new Float32Array(this.segmentCount),this.segmentMinY=new Float32Array(this.segmentCount),this.segmentMaxX=new Float32Array(this.segmentCount),this.segmentMaxY=new Float32Array(this.segmentCount));for(let t=0;t<this.segmentCount;t+=1){let n=t*4,r=t*4,i=e.styles[r]+.35;this.segmentMinX[t]=e.primitiveBounds[n]-i,this.segmentMinY[t]=e.primitiveBounds[n+1]-i,this.segmentMaxX[t]=e.primitiveBounds[n+2]+i,this.segmentMaxY[t]=e.primitiveBounds[n+3]+i}}markInteraction(){this.lastInteractionTime=performance.now()}isInteractionActive(){return performance.now()-this.lastInteractionTime<=jt}configureRasterLayers(e){let t=this.getSceneRasterLayers(e);this.rasterResolutionPlanner&&this.rasterResolutionSources&&this.rasterResolutionPlanner.inheritTiers(this.rasterResolutionPlanner,this.rasterResolutionSources,t),this.rasterResolutionSources=t;let n=this.maxTextureSize();this.destroyRasterLayerResources();let r=this.planRasterLayerMemory(t);g(r,this);try{for(let[e,n]of t.entries())this.rasterLayerResources.push(this.createRasterLayerResource(n,e,r.plans[e],r.compressionFormats[e]));if(this.rasterLayerUpdates.size===0&&r.resolutionScale===1&&!r.compressionFormats.some(Boolean)&&r.plans.every((e,n)=>e.width===t[n].width&&e.height===t[n].height))try{let t=Re(e,n);t.length>0&&this.ensureRasterStripPipeline();let i=r.budget.bytes-(this.rasterCompression?.residentBytes??0)-this.rasterLayerResources.reduce((e,t)=>e+(t.estimatedBytes??0),0);for(let e of t){let t=e.width*e.height*4+e.instances.byteLength;t>i||(this.rasterStripResources.set(e.first,this.createRasterStripResource(e)),i-=t)}}catch(e){this.destroyRasterStripResources(),console.warn(`Raster strip batching unavailable; drawing original image layers.`,e)}}catch(e){throw this.destroyRasterLayerResources(),e}}configureGradientPaint(e,t){let n=re(e);if(this.gradientData=n,this.gradientMeshBuffer?.destroy(),this.gradientMeshBuffer=null,this.gradientMeshRanges=new Uint32Array,n.gradientMeshIndices?.length){let e=de(n);this.gradientMeshRanges=e.ranges;let t=globalThis.GPUBufferUsage;this.gradientMeshBuffer=this.gpuDevice.createBuffer({size:Math.max(24,e.vertices.byteLength),usage:t.VERTEX|t.COPY_DST}),this.gpuDevice.queue.writeBuffer(this.gradientMeshBuffer,0,e.vertices),this.gradientMeshPipeline??=this.createPipeline(it,`vsMain`,`fsMain`,this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.gradientFillBindGroupLayout,this.vectorClipBindGroupLayout,this.primitiveGradientLayout]}),!1,void 0,st)}let r=Y(n.gradientCount,t),i=Y(n.gradientFillPathCount,t),a={pathCount:n.gradientFillPathCount,segmentCount:n.gradientFillSegmentCount,pathMetaA:n.gradientFillPathMetaA,pathMetaB:n.gradientFillPathMetaB,segmentsA:n.gradientFillSegmentsA,segmentsB:n.gradientFillSegmentsB},o=Ce(a,_e(a),t);this.gradientFillBandBase=o.bandBase,this.gradientFillBandEntries=o.bandEntries,this.gradientFillCellBase=o.cellBase;let s=Y(o.texels,t),c=Y(n.gradientStrokeRunCount,t),l=Y(n.gradientStrokeSegmentCount,t);if(this.gradientMetaTextures=[n.gradientMetaA,n.gradientMetaB,n.gradientMetaC,n.gradientMetaD,n.gradientMetaE].map(e=>this.createFloatTexture(r.width,r.height,e)),n.gradientCount>0){let e=w*n.gradientCount*4,t=new Uint8Array(e);t.set(n.gradientLut.subarray(0,e)),this.gradientLutTexture=this.createRgba8DataTexture(w,n.gradientCount,t)}else this.gradientLutTexture=this.createRgba8DataTexture(1,1,new Uint8Array(4));this.gradientLutView=this.gradientLutTexture.createView(),this.gradientFillTextures=[this.createFloatTexture(i.width,i.height,n.gradientFillPathMetaA),this.createFloatTexture(i.width,i.height,n.gradientFillPathMetaB),this.createFloatTexture(i.width,i.height,n.gradientFillPathMetaC),this.createFloatTexture(i.width,i.height,n.gradientFillPaintMeta),this.createFloatTexture(s.width,s.height,o.dataA),this.createFloatTexture(s.width,s.height,o.dataB)],this.gradientStrokeTextures=[this.createFloatTexture(c.width,c.height,n.gradientStrokeRunMetaA),this.createFloatTexture(l.width,l.height,n.gradientStrokeEndpoints),this.createFloatTexture(l.width,l.height,n.gradientStrokePrimitiveMeta),this.createFloatTexture(l.width,l.height,n.gradientStrokePrimitiveBounds),this.createFloatTexture(l.width,l.height,n.gradientStrokeStyles)],this.gradientFillBindGroup=this.gpuDevice.createBindGroup({layout:this.gradientFillBindGroupLayout,entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:V}},...this.gradientFillTextures.map((e,t)=>({binding:t+1,resource:e.createView()})),...this.gradientMetaTextures.map((e,t)=>({binding:t+7,resource:e.createView()})),{binding:12,resource:this.gradientSampler},{binding:13,resource:this.gradientLutTexture.createView()}]}),this.gradientStrokeBindGroup=this.gpuDevice.createBindGroup({layout:this.gradientStrokeBindGroupLayout,entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:V}},...this.gradientStrokeTextures.map((e,t)=>({binding:t+1,resource:e.createView()})),...this.gradientMetaTextures.map((e,t)=>({binding:t+6,resource:e.createView()})),{binding:11,resource:this.gradientSampler},{binding:12,resource:this.gradientLutTexture.createView()}]}),this.orderedGradientPaintCommands=ae(this.getSceneRasterLayers(e),n),this.gradientPaintRequiresDirectRendering=ue(this.orderedGradientPaintCommands)}configurePageBackgroundResources(e){if(this.destroyPageBackgroundResources(),this.pageBackgroundTexture||this.uploadPageBackgroundTexture(),!this.pageBackgroundTexture)return;this.ensurePageBackgroundPipeline();let t=an(e),n=Math.floor(Math.min(this.gpuDevice.limits.maxStorageBufferBindingSize??134217728,this.gpuDevice.limits.maxBufferSize??268435456)/32);if(n<1)throw Error(`WebGPU buffer limits cannot hold a page background rectangle.`);let r=new Float32Array(Math.min(t.length/4,n)*8),i=0;try{for(let a=0;a+3<t.length;a+=4){let o=t[a],s=t[a+1],c=t[a+2],l=t[a+3];[o,s,c,l].every(Number.isFinite)&&(r[i*8]=o,r[i*8+1]=s,r[i*8+2]=Math.max(c-o,1e-6),r[i*8+3]=Math.max(l-s,1e-6),r[i*8+4]=+!!e.pendingPagePreviews?.[a/4],++i===n&&(this.pageBackgroundResources.push(this.createPageBackgroundResource(r)),i=0))}i&&this.pageBackgroundResources.push(this.createPageBackgroundResource(r.subarray(0,i*8)))}catch(e){throw this.destroyPageBackgroundResources(),e}}ensurePageBackgroundPipeline(){if(this.pageBackgroundPipeline)return;let e=globalThis.GPUBufferUsage;this.pagePlaceholderUniformBuffer??=this.gpuDevice.createBuffer({size:16,usage:e.UNIFORM|e.COPY_DST});let t=globalThis.GPUShaderStage,n=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:t.VERTEX,buffer:{type:`uniform`,minBindingSize:V}},{binding:1,visibility:t.VERTEX,buffer:{type:`read-only-storage`}},{binding:2,visibility:t.FRAGMENT,sampler:{type:`filtering`}},{binding:3,visibility:t.FRAGMENT,texture:{sampleType:`float`}},{binding:4,visibility:t.FRAGMENT,buffer:{type:`uniform`,minBindingSize:16}}]}),r=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[n,this.vectorClipBindGroupLayout]});this.pageBackgroundPipeline=this.createPipeline(qt(!0),`vsMain`,`fsMain`,r,!0)}createPageBackgroundResource(e){let t=globalThis.GPUBufferUsage,n=this.gpuDevice.createBuffer({size:e.byteLength,usage:t.STORAGE|t.COPY_DST});try{this.gpuDevice.queue.writeBuffer(n,0,e);let t=this.gpuDevice.createBindGroup({layout:this.pageBackgroundPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:V}},{binding:1,resource:{buffer:n}},{binding:2,resource:this.rasterLayerSampler},{binding:3,resource:this.pageBackgroundTexture.createView()},{binding:4,resource:{buffer:this.pagePlaceholderUniformBuffer}}]});return{count:e.length/8,instanceBuffer:n,bindGroup:t}}catch(e){throw n.destroy(),e}}getSceneRasterLayers(t){let n=[];if(Array.isArray(t.rasterLayers))for(let r=0;r<t.rasterLayers.length;r++){let i=this.rasterLayerUpdates.get(r)??t.rasterLayers[r],a=Math.max(0,Math.trunc(i?.width??0)),o=Math.max(0,Math.trunc(i?.height??0));if(a<=0||o<=0)continue;let s=i.monochrome,c;if(s){if(!(s.data instanceof Uint8Array)||s.data.length<Math.ceil(a/8)*o||!(s.colors instanceof Uint8Array)||s.colors.length!==8)continue;c=new Uint8Array}else{if(c=i.data,!(c instanceof Uint8Array)||c.length<a*o*4)continue;s=i.gpuCompression?void 0:A(c,a,o)??void 0}n.push({width:a,height:o,data:c,...s?{monochrome:s}:{},compressionHint:i.compressionHint,gpuCompression:i.gpuCompression,gpuPreparation:i.gpuPreparation,compressionEligible:!s&&!!this.rasterCompression?.available&&(!!i.gpuCompression||e(i).eligible),preferCompression:!s&&(i.compressionHint===`scan`||!!i.gpuCompression),opacity:i.opacity,matrix:i.matrix instanceof Float32Array?i.matrix:new Float32Array(i.matrix),paintOrder:Number.isFinite(i.paintOrder)?i.paintOrder:0,pageIndex:Number.isFinite(i.pageIndex)?Math.max(0,Math.trunc(i.pageIndex)):0})}if(n.length>0)return n;let r=Math.max(0,Math.trunc(t.rasterLayerWidth)),i=Math.max(0,Math.trunc(t.rasterLayerHeight));if(r<=0||i<=0||t.rasterLayerData.length<r*i*4)return n;let a=A(t.rasterLayerData,r,i);return n.push({width:r,height:i,data:t.rasterLayerData,...a?{monochrome:a}:{},compressionEligible:!a&&!!this.rasterCompression?.available&&e({width:r,height:i,data:t.rasterLayerData}).eligible,matrix:t.rasterLayerMatrix,paintOrder:0,pageIndex:0}),n}planRasterLayerMemory(e,t){let n=this.maxTextureSize(),r=this.rasterCompression?.available?this.rasterCompression.format:null,i=t=>this.rasterResolutionPlanner?this.rasterResolutionPlanner.plan(e,n,this.rasterResolutionView,t,r):y(e,n,t,r),a=i(t),o=a.plans.reduce((e,t)=>e+t.tiles.length*U,0)+(a.compressionFormats.some(Boolean)||this.rasterCompression?.residentBytes?this.rasterCompression?.workspaceBytes??0:0);return a.estimatedBytes+o<=a.availableBytes?a:i(Math.max(0,a.availableBytes-o))}updateRasterResolution(){let e=this.rasterResolutionPlanner;if(!e||!this.scene||!this.rasterTextureResidency||!this.rasterRenderingEnabled||(this.rasterResolutionView={width:this.canvas.width,height:this.canvas.height,cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom},this.rasterStagedBytes>0||this.rasterPreparationRunning))return;let t=this.rasterResolutionSources??=this.getSceneRasterLayers(this.scene),n=this.planRasterLayerMemory(t),r=e.nextChange(t,this.rasterLayerResources,n);if(r<0)return;g(n,this);let i=this.scene,a=t[r],o=n.plans[r];this.rasterPreparationRunning=!0;let s=performance.now();(At(a,o)||L(a,o,n.compressionFormats[r])||this.rasterResourceCache?.has(a,o,n.compressionFormats[r])?Promise.resolve(void 0):Qe(a,o)).then(e=>{if(this.isDisposed||this.scene!==i||this.rasterResolutionSources!==t||!this.rasterTextureResidency||this.rasterStagedBytes>0)return;this.rasterResolutionView={width:this.canvas.width,height:this.canvas.height,cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom};let c=this.planRasterLayerMemory(t);if(!j(c.plans[r],o)||c.compressionFormats[r]!==n.compressionFormats[r])return;this.recordPerformanceTransition(`rasterRefinement.prepare`,performance.now()-s);let l=this.createRasterLayerResource(a,r,o,n.compressionFormats[r],e);this.destroyRasterStripResources(),this.getRasterResourceCache().park(this.rasterLayerResources[r],this.rasterLayerResources[r].estimatedBytes??0),this.rasterLayerResources[r]=l,this.trimRasterResourceCache(),this.destroyVectorMinifyResources()}).catch(t=>{e.failed(r,n),console.warn(`[HEPR] Raster refinement unavailable; retaining the previous display resolution.`,t)}).finally(()=>{this.rasterPreparationRunning=!1,this.isDisposed||this.requestFrame()})}prepareRasterSource(t){if(t.monochrome)return t;let n=t.gpuCompression?void 0:A(t.data,t.width,t.height);return{width:t.width,height:t.height,data:n?new Uint8Array:t.data,...n?{monochrome:n}:{},compressionHint:t.compressionHint,gpuCompression:t.gpuCompression,gpuPreparation:t.gpuPreparation,compressionEligible:!n&&!!this.rasterCompression?.available&&(!!t.gpuCompression||e(t).eligible),preferCompression:!n&&(t.compressionHint===`scan`||!!t.gpuCompression),matrix:t.matrix,opacity:t.opacity,paintOrder:t.paintOrder,pageIndex:t.pageIndex}}rasterResourceCache=null;rasterPreparationRunning=!1;getRasterResourceCache(){return this.rasterResourceCache??=new Ze(K)}trimRasterResourceCache(){let e=(this.rasterLayerResources??[]).reduce((e,t)=>e+(t.estimatedBytes??0),0)+[...this.rasterStripResources?.values()??[]].reduce((e,t)=>e+(this.rasterStripAllocationBytes?.get(t)??0),0);this.rasterResourceCache?.trim(Math.max(0,u().bytes-e-(this.rasterStagedBytes??0)))}destroyRasterLayerResources(){this.destroyRasterStripResources();for(let e of this.rasterLayerResources)K(e);this.rasterResourceCache?.clear(),this.rasterLayerResources=[]}destroyRasterStripResources(){for(let e of this.rasterStripResources?.values()??[])e.texture.destroy(),e.instanceBuffer.destroy();this.rasterStripResources?.clear()}ensureRasterStripPipeline(){if(this.rasterStripPipeline)return;let e=globalThis.GPUShaderStage,t=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:e.VERTEX,buffer:{type:`uniform`,minBindingSize:V}},{binding:1,visibility:e.VERTEX,buffer:{type:`read-only-storage`}},{binding:2,visibility:e.FRAGMENT,sampler:{type:`filtering`}},{binding:3,visibility:e.FRAGMENT,texture:{sampleType:`float`}}]}),n=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[t,this.vectorClipBindGroupLayout]});this.rasterStripPipeline=this.createPipeline(Et,`vsMain`,`fsMain`,n,!0)}createRasterStripResource(e){let t=globalThis.GPUTextureUsage,n=globalThis.GPUBufferUsage,r=this.gpuDevice.createTexture({size:{width:e.width,height:e.height,depthOrArrayLayers:1},format:`rgba8unorm`,usage:t.TEXTURE_BINDING|t.COPY_DST}),i=null;try{this.writeRgba8Texture(r,e.width,e.height,e.data),i=this.gpuDevice.createBuffer({size:e.instances.byteLength,usage:n.STORAGE|n.COPY_DST}),this.gpuDevice.queue.writeBuffer(i,0,e.instances);let t=this.gpuDevice.createBindGroup({layout:this.rasterStripPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:V}},{binding:1,resource:{buffer:i}},{binding:2,resource:this.rasterLayerSampler},{binding:3,resource:r.createView()}]}),a={first:e.first,count:e.count,texture:r,instanceBuffer:i,bindGroup:t};return this.rasterStripAllocationBytes.set(a,e.width*e.height*4+e.instances.byteLength),a}catch(e){throw i?.destroy(),r.destroy(),e}}destroyPageBackgroundResources(){for(let e of this.pageBackgroundResources)e.instanceBuffer.destroy();this.pageBackgroundResources=[]}uploadPageBackgroundTexture(){let e=Math.round(this.pageBackgroundColor[3]*255),t=e/255,n=new Uint8Array([Math.round(this.pageBackgroundColor[0]*t*255),Math.round(this.pageBackgroundColor[1]*t*255),Math.round(this.pageBackgroundColor[2]*t*255),e]);if(!this.pageBackgroundTexture){this.pageBackgroundTexture=this.createRgba8Texture(1,1,n);return}this.writeRgba8Texture(this.pageBackgroundTexture,1,1,n,0)}createRasterLayerResource(e,t,n,r,i){let a=new Float32Array(6);e.matrix.length>=6?a.set(e.matrix.subarray(0,6)):(a[0]=1,a[3]=1);let o=this.maxTextureSize(),s=n?void 0:this.planRasterLayerMemory([this.prepareRasterSource(e)]),l=n??s.plans[0],u=r===void 0?s?.compressionFormats[0]??null:r,d=this.getRasterResourceCache().take(e,l,u);if(d)return this.recordPerformanceTransition(`rasterUpload.cacheHit`,0),d;let f=performance.now();i??=e.gpuPreparation,i&&!j(i.plan,l)&&(i=void 0);let p=e.monochrome??(!e.gpuCompression&&e.width*e.height>=256?A(e.data,e.width,e.height):void 0);this.rasterResolutionPlanner||Pe(t,{width:e.width,height:e.height,data:p?.data??e.data,...p?{monochrome:p}:{}},l,o);let m=p&&!Ie(e,l)?p:void 0,h=!!p&&!m&&!!this.rasterResolutionPlanner,_=!p&&L(e,l,u)?e.gpuCompression.tiles:void 0,v=_?void 0:i?.pixels??(m?void 0:h?Me(p,e.width,e.height,l):Fe(p?{width:e.width,height:e.height,data:new Uint8Array,monochrome:p}:e,l)),x=[],C=0;try{for(let[n,r]of l.tiles.entries()){let s=m?i?.monochromeTiles?.[n]??ke(m,e.width,e.height,r):h?p:void 0,d=!s&&u?_?this.rasterCompression?.createTextureFromEncoded(r.width,r.height,_[n]):this.rasterCompression?.createTexture(r.width,r.height,v[n]):null;if(u&&!d){for(let e of x)G(e);x.length=0;let n=y([e],o,b(l,!1,u));return g(n,this),this.createRasterLayerResource(e,t,n.plans[0],null)}let f=m||h?this.createMonochromeTextures(r.width,r.height,s,i?.coverageAtlases?.[n],h?v[n]:void 0,i?.compactAtlases?.[n],!!i?.compactAtlases):{texture:d?.texture??this.createRgba8Texture(r.width,r.height,v[n])};`compactBytes`in f&&f.compactBytes!==void 0&&(C+=c(r.width,r.height,!!m,null,h)-f.compactBytes);let S=d?{...r,uv:[r.uv[0]*d.uvScale[0],r.uv[1]*d.uvScale[1],r.uv[2]*d.uvScale[0],r.uv[3]*d.uvScale[1]]}:r;try{x.push(this.createRasterTileResource(a,f.texture,e.opacity??1,S,`coverageTexture`in f?f.coverageTexture:void 0,s,!!d,h,`compact`in f&&!!f.compact))}catch(e){throw f.texture.destroy(),`coverageTexture`in f&&f.coverageTexture!==f.texture&&f.coverageTexture.destroy(),e}}}catch(e){for(let e of x)G(e);throw e}let w=e.paintOrder??0,T=e.pageIndex??0,[ee,...E]=x,D={...ee,rasterPlan:l,estimatedBytes:ce({width:e.width,height:e.height,monochrome:p,reducedMonochrome:h},l,u)-C+l.tiles.length*U,...u?{compressionFormat:u}:{},...E.length>0?{extraTiles:E}:{},paintOrder:Number.isFinite(w)?w:0,pageIndex:Number.isFinite(T)?Math.max(0,Math.trunc(T)):0};return p&&S({width:e.width,height:e.height,monochrome:p},l,D.estimatedBytes-l.tiles.length*U),this.recordPerformanceTransition(`rasterUpload.submit`,performance.now()-f),this.getRasterResourceCache().remember(D,e,l,u)}createRasterTileResource(e,t,n,r,i,a,o=!1,s=!1,c=!1){let l=globalThis.GPUBufferUsage,u=new Float32Array(Ht);if(u[0]=e[0],u[1]=e[1],u[2]=e[2],u[3]=e[3],u[4]=e[4],u[5]=e[5],u[6]=n,u[7]=a?c?r.width+.5:r.width*(s?-1:1):0,u.set(r.quad,8),u.set(r.uv,12),o&&(u[16]=1),a)for(let e=0;e<2;e++){let t=e*4,n=a.colors[t+3];for(let e=0;e<3;e++)u[16+t+e]=Math.round(a.colors[t+e]*n/255)/255;u[19+t]=n/255}J(u,U,`raster`);let d=this.gpuDevice.createBuffer({size:U,usage:l.UNIFORM|l.COPY_DST});try{this.gpuDevice.queue.writeBuffer(d,0,u);let e=this.gpuDevice.createBindGroup({layout:this.rasterPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:V}},{binding:1,resource:{buffer:d,size:U}},{binding:2,resource:this.rasterLayerSampler},{binding:3,resource:t.createView()},{binding:4,resource:(i??t).createView()}]});return{texture:t,...i?{coverageTexture:i}:{},uniformBuffer:d,bindGroup:e}}catch(e){try{d.destroy()}catch{}throw e}}createStrokeTextures(e,t,n){this.segmentTextureA=this.createStrokeFieldTexture(e,t,n,`endpoints`),this.segmentTextureB=this.createStrokeFieldTexture(e,t,n,`primitiveMeta`),this.segmentTextureC=this.createStrokeFieldTexture(e,t,n,`styles`),this.segmentTextureD=this.createStrokeFieldTexture(e,t,n,`primitiveBounds`)}createStrokeFieldTexture(e,t,n,r){let i=globalThis.GPUTextureUsage;if(n.count>e*t)throw Error(`Texture source data exceeds texture size (${n.count} > ${e*t} texels).`);let a=this.gpuDevice.createTexture({size:{width:e,height:t,depthOrArrayLayers:1},format:`rgba32float`,usage:i.TEXTURE_BINDING|i.COPY_DST});for(let t of Ee(n,r,e))this.gpuDevice.queue.writeTexture({texture:a,origin:[0,t.y]},t.data,{bytesPerRow:t.width*16},{width:t.width,height:t.height,depthOrArrayLayers:1});return a}createFloatTexture(e,t,n){let r=globalThis.GPUTextureUsage,i=this.gpuDevice.createTexture({size:{width:e,height:t,depthOrArrayLayers:1},format:`rgba32float`,usage:r.TEXTURE_BINDING|r.COPY_DST});return this.writeFloatTexture(i,e,t,n),i}createRgba8Texture(e,t,n){let r=globalThis.GPUTextureUsage,i=nn(n,e,t),a=this.gpuDevice.createTexture({size:{width:e,height:t,depthOrArrayLayers:1},format:`rgba8unorm`,mipLevelCount:i.length,usage:r.TEXTURE_BINDING|r.COPY_DST});try{for(let e=0;e<i.length;e+=1){let t=i[e],n=q(t.data,t.width,t.height);this.writeRgba8Texture(a,t.width,t.height,n,e)}return a}catch(e){throw a.destroy(),e}}createR8Texture(e,t,n,r){let i=globalThis.GPUTextureUsage,a=r??je(n,e,t),o=this.gpuDevice.createTexture({size:{width:e,height:t,depthOrArrayLayers:1},format:`r8unorm`,mipLevelCount:a.length,usage:i.TEXTURE_BINDING|i.COPY_DST});for(let e=0;e<a.length;e+=1){let t=a[e],n=q(t.data,t.width,t.height,1);this.writeR8Texture(o,t.width,t.height,n,e)}return o}createMonochromeTextures(e,t,n,r,i,a,o=!1){let s=globalThis.GPUTextureUsage,c=i?e:Math.ceil(e/8),l=r??(i?Ae(i,e,t):Ne(n,e,t)),u=o?a:f(n,e,t,l,i);if(u){let e=this.createRgba8DataTexture(u.width,u.height,u.data);return{texture:e,coverageTexture:e,compact:!0,compactBytes:u.data.length}}let d=this.gpuDevice.createTexture({size:{width:c,height:t,depthOrArrayLayers:1},format:`r8unorm`,usage:s.TEXTURE_BINDING|s.COPY_DST}),p=null;try{return this.writeR8Texture(d,c,t,i??n.data),p=this.gpuDevice.createTexture({size:{width:l.width,height:l.height,depthOrArrayLayers:1},format:`r8unorm`,mipLevelCount:1,usage:s.TEXTURE_BINDING|s.COPY_DST}),this.writeR8Texture(p,l.width,l.height,l.data),{texture:d,coverageTexture:p}}catch(e){throw d.destroy(),p?.destroy(),e}}createRgba8DataTexture(e,t,n){let r=globalThis.GPUTextureUsage,i=this.gpuDevice.createTexture({size:{width:e,height:t,depthOrArrayLayers:1},format:`rgba8unorm`,usage:r.TEXTURE_BINDING|r.COPY_DST});try{let r=q(n,e,t,4);return this.writeRgba8Texture(i,e,t,r),i}catch(e){throw i.destroy(),e}}writeFloatTexture(e,t,n,r){let i=t*n*4;if(r.length>i)throw Error(`Texture source data exceeds texture size (${r.length} > ${i}).`);let a=t*4,o=Math.floor(r.length/a),s=Math.max(1,Math.floor(4194304/(a*4)));for(let n=0;n<o;n+=s){let i=Math.min(s,o-n);this.gpuDevice.queue.writeTexture({texture:e,origin:[0,n]},r.subarray(n*a,(n+i)*a),{bytesPerRow:a*4},{width:t,height:i,depthOrArrayLayers:1})}let c=r.length-o*a;if(c>0){let t=r.subarray(o*a);if(c%4!=0){let e=new Float32Array(Math.ceil(c/4)*4);e.set(t),t=e}this.gpuDevice.queue.writeTexture({texture:e,origin:[0,o]},t,{},{width:t.length/4,height:1,depthOrArrayLayers:1})}}writeRgba8Texture(e,t,n,r,i=0){let a=t*4,o=on(a,256);if(n<=1&&a===o){this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},r,{offset:0},{width:t,height:n,depthOrArrayLayers:1});return}if(a===o){this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},r,{offset:0,bytesPerRow:a,rowsPerImage:n},{width:t,height:n,depthOrArrayLayers:1});return}let s=new Uint8Array(o*n);for(let e=0;e<n;e+=1){let t=e*a,n=e*o;s.set(r.subarray(t,t+a),n)}this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},s,{offset:0,bytesPerRow:o,rowsPerImage:n},{width:t,height:n,depthOrArrayLayers:1})}writeR8Texture(e,t,n,r,i=0){let a=t,o=on(a,256);if(n<=1&&a===o){this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},r,{offset:0},{width:t,height:n,depthOrArrayLayers:1});return}if(a===o){this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},r,{offset:0,bytesPerRow:a,rowsPerImage:n},{width:t,height:n,depthOrArrayLayers:1});return}let s=new Uint8Array(o*n);for(let e=0;e<n;e+=1){let t=e*a,n=e*o;s.set(r.subarray(t,t+a),n)}this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},s,{offset:0,bytesPerRow:o,rowsPerImage:n},{width:t,height:n,depthOrArrayLayers:1})}clearToScreen(){let e=this.gpuContext.getCurrentTexture().createView(),t=this.createFrameEncoder();I(t,{label:`frame`,colorAttachments:[{view:e,clearValue:B,loadOp:`clear`,storeOp:`store`}]}).end(),this.gpuDevice.queue.submit([t.finish()])}destroyDataResources(){this.destroyVectorLodResources(),this.vectorLodRuntime=null,this.strokeBindGroupAll=null,this.strokeBindGroupVisible=null,this.fillBindGroup=null,this.gradientFillBindGroup=null,this.gradientStrokeBindGroup=null,this.textBindGroup=null,this.textInstanceIdBuffer&&=(this.textInstanceIdBuffer.destroy(),null),this.destroyPageBackgroundResources(),this.destroyRasterLayerResources();let e=[this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD,this.fillPathMetaTextureA,this.fillPathMetaTextureB,this.fillPathMetaTextureC,this.fillSegmentTextureA,this.fillSegmentTextureB,this.textInstanceTextureA,this.textInstanceTextureB,this.textInstanceTextureC,this.textGlyphMetaTextureA,this.textGlyphMetaTextureB,this.textGlyphRasterMetaTexture,this.textGlyphSegmentTextureA,this.textGlyphSegmentTextureB,this.textRasterAtlasTexture,...this.gradientMetaTextures,this.gradientLutTexture,...this.gradientFillTextures,...this.gradientStrokeTextures];for(let t of e)t&&t.destroy();this.segmentTextureA=null,this.segmentTextureB=null,this.segmentTextureC=null,this.segmentTextureD=null,this.fillPathMetaTextureA=null,this.fillPathMetaTextureB=null,this.fillPathMetaTextureC=null,this.fillSegmentTextureA=null,this.fillSegmentTextureB=null,this.textInstanceTextureA=null,this.textInstanceTextureB=null,this.textInstanceTextureC=null,this.textGlyphMetaTextureA=null,this.textGlyphMetaTextureB=null,this.textGlyphRasterMetaTexture=null,this.textGlyphSegmentTextureA=null,this.textGlyphSegmentTextureB=null,this.textRasterAtlasTexture=null,this.gradientMetaTextures=[],this.gradientLutTexture=null,this.gradientLutView=null,this.gradientFillTextures=[],this.gradientStrokeTextures=[],this.gradientData=null,this.gradientMeshBuffer?.destroy(),this.gradientMeshBuffer=null,this.gradientMeshRanges=new Uint32Array,this.orderedGradientPaintCommands=[],this.gradientPaintRequiresDirectRendering=!1}clientToScenePoint(e,t){return this.clientToWorld(e,t)}sceneToClientPoint(e,t){let n=this.resolveInteractionViewportRect(),r=this.resolveClientToPixelScale(n);if(r.x===0||r.y===0)return null;let i=(e-this.cameraCenterX)*this.zoom+this.canvas.width*.5,a=(t-this.cameraCenterY)*this.zoom+this.canvas.height*.5;return{x:n.left+i/r.x,y:n.bottom-a/r.y}}clientToWorld(e,t){return this.clientToWorldAt(e,t,this.cameraCenterX,this.cameraCenterY,this.zoom)}clientToWorldAt(e,t,n,r,i){let a=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(a),s=(e-a.left)*o.x,c=(a.bottom-t)*o.y;return{x:(s-this.canvas.width*.5)/i+n,y:(c-this.canvas.height*.5)/i+r}}syncCameraTargetsToCurrent(){this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.targetZoom=this.zoom,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1}updatePanReleaseVelocitySample(e){if(!this.isPanInteracting){this.lastPanFrameTimeMs=0;return}if(this.lastPanFrameTimeMs>0){let t=e-this.lastPanFrameTimeMs;if(t>.1){let n=this.cameraCenterX-this.lastPanFrameCameraX,r=this.cameraCenterY-this.lastPanFrameCameraY,i=n*1e3/t,a=r*1e3/t,o=Math.hypot(i,a);if(Number.isFinite(o)&&o>=Lt){if(o>Rt){let e=Rt/o;i*=e,a*=e}this.panVelocityWorldX=i,this.panVelocityWorldY=a,this.lastPanVelocityUpdateTimeMs=e}}}this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=e}updateCameraWithDamping(e){let t=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>R||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>R,n=Math.abs(this.targetZoom-this.zoom)>z;if(!t&&!n)return this.hasZoomAnchor=!1,this.lastCameraAnimationTimeMs=e,!1;this.lastCameraAnimationTimeMs<=0&&(this.lastCameraAnimationTimeMs=e-16);let r=Q(e-this.lastCameraAnimationTimeMs,0,Ft);this.lastCameraAnimationTimeMs=e;let i=r/1e3,a=1-Math.exp(-24*i),o=1-Math.exp(-24*i);if(n&&(this.zoom+=(this.targetZoom-this.zoom)*o,Math.abs(this.targetZoom-this.zoom)<=z&&(this.zoom=this.targetZoom)),this.hasZoomAnchor){let e=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.zoom),r=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.targetZoom);this.cameraCenterX=e.x,this.cameraCenterY=e.y,this.targetCameraCenterX=r.x,this.targetCameraCenterY=r.y,n||(this.hasZoomAnchor=!1),t=!1}else t&&(this.cameraCenterX+=(this.targetCameraCenterX-this.cameraCenterX)*a,this.cameraCenterY+=(this.targetCameraCenterY-this.cameraCenterY)*a,Math.abs(this.targetCameraCenterX-this.cameraCenterX)<=R&&(this.cameraCenterX=this.targetCameraCenterX),Math.abs(this.targetCameraCenterY-this.cameraCenterY)<=R&&(this.cameraCenterY=this.targetCameraCenterY));return this.markInteraction(),this.needsVisibleSetUpdate=!0,t=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>R||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>R,n=Math.abs(this.targetZoom-this.zoom)>z,t||n}computeCameraCenterForAnchor(e,t,n,r,i){let a=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(a),s=(e-a.left)*o.x,c=(a.bottom-t)*o.y;return{x:n-(s-this.canvas.width*.5)/i,y:r-(c-this.canvas.height*.5)/i}}resolveInteractionViewportRect(){return this.interactionViewportProvider?.()||this.canvas.getBoundingClientRect()}resolveClientToPixelScale(e){let t=e??this.resolveInteractionViewportRect(),n=Math.max(window.devicePixelRatio||1,1e-6),r=t.width>1e-6?this.canvas.width/t.width:n,i=t.height>1e-6?this.canvas.height/t.height:n;return{x:Math.max(1e-6,r),y:Math.max(1e-6,i)}}};function G(e){e.texture?.destroy(),e.coverageTexture!==e.texture&&e.coverageTexture?.destroy(),e.uniformBuffer?.destroy()}function K(e){G(e);for(let t of e.extraTiles??[])G(t)}function q(e,t,n,r=4){let i=t*n*r;if(e.length>i)throw Error(`Texture source data exceeds texture size (${e.length} > ${i}).`);let a=new Uint8Array(i);return a.set(e),a}function tn(e,t){let n=new Uint8Array(t*4),r=Math.min(e.length,n.length);for(let t=0;t<r;t+=1)n[t]=Math.round(Q(e[t],0,1)*255);return n}function nn(e,t,n){let r=[],i=Math.max(1,Math.trunc(t)),a=Math.max(1,Math.trunc(n)),o=e;for(r.push({width:i,height:a,data:o});i>1||a>1;){let e=Math.max(1,i>>1),t=Math.max(1,a>>1),n=new Uint8Array(e*t*4);for(let r=0;r<t;r+=1){let t=Math.min(a-1,r*2),s=Math.min(a-1,t+1);for(let a=0;a<e;a+=1){let c=Math.min(i-1,a*2),l=Math.min(i-1,c+1),u=(t*i+c)*4,d=(t*i+l)*4,f=(s*i+c)*4,p=(s*i+l)*4,m=(r*e+a)*4;n[m]=o[u]+o[d]+o[f]+o[p]+2>>2,n[m+1]=o[u+1]+o[d+1]+o[f+1]+o[p+1]+2>>2,n[m+2]=o[u+2]+o[d+2]+o[f+2]+o[p+2]+2>>2,n[m+3]=o[u+3]+o[d+3]+o[f+3]+o[p+3]+2>>2}}r.push({width:e,height:t,data:n}),i=e,a=t,o=n}return r}function J(e,t,n){let r=e.byteLength;if(r>t)throw Error(`${n} uniform data (${r} bytes) exceeds buffer size ${t} bytes.`)}function rn(e,t,n,r,i){let a={textInstanceA:new Float32Array(n.width*n.height*4),textInstanceB:new Float32Array(n.width*n.height*4),textInstanceC:new Float32Array(n.width*n.height*4),textGlyphMetaA:new Float32Array(r.width*r.height*4),textGlyphMetaB:new Float32Array(r.width*r.height*4),textGlyphSegmentsA:new Float32Array(i.width*i.height*4),textGlyphSegmentsB:new Float32Array(i.width*i.height*4)};if(t?C(e,t,a):(a.textInstanceA.set(e.textInstanceA),a.textInstanceB.set(e.textInstanceB),a.textInstanceC.set(e.textInstanceC),a.textGlyphMetaA.set(e.textGlyphMetaA),a.textGlyphMetaB.set(e.textGlyphMetaB),a.textGlyphSegmentsA.set(e.textGlyphSegmentsA),a.textGlyphSegmentsB.set(e.textGlyphSegmentsB)),T(e.textGlyphCount+ +!!t,a.textGlyphMetaA,a.textGlyphMetaB,a.textGlyphSegmentsA,a.textGlyphSegmentsB),Math.floor((e.textClipRects?.length??0)/4)>0){let n=e.textGlyphCount+ +!!t;a.textGlyphMetaA.set(e.textClipRects,n*4);for(let t=0;t<e.textInstanceCount;t+=1){let e=t*4+3,r=a.textInstanceB[e];r>0&&(a.textInstanceB[e]=n+r)}}return a}function Y(e,t){let n=Math.max(1,e),r=Q(Math.ceil(Math.sqrt(n)),1,t),i=Math.max(1,Math.ceil(n/r));if(i>t)throw Error(`Data texture exceeds GPU limits for this browser/GPU.`);return{width:r,height:i}}function X(e,t){return t>=1&&Math.max(1,e)/t<=t}function an(e){return e.pageRects instanceof Float32Array&&e.pageRects.length>=4?new Float32Array(e.pageRects):new Float32Array([e.pageBounds.minX,e.pageBounds.minY,e.pageBounds.maxX,e.pageBounds.maxY])}function Z(e,t){let n=null;try{typeof t?.unconfigure==`function`&&t.unconfigure()}catch(e){n=e}try{typeof e?.destroy==`function`&&e.destroy()}catch(e){n??=e}if(n!==null)throw n}function on(e,t){return t<=1?e:Math.ceil(e/t)*t}function Q(e,t,n){return e<t?t:e>n?n:e}function sn(e){return e===`off`||e===`force`?e:`auto`}function $(e,t){return e<0?0:e>=t?t-1:e}export{en as WebGpuFloorplanRenderer};