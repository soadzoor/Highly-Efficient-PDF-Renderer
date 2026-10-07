import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { TSL, WGSLNodeBuilder } from "three/webgpu";

const hooks = registerHooks({ resolve(s,c,next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s,c);
} });
const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const deadline = setTimeout(() => assert.fail("Three raster storage did not complete within 10 seconds."),10000);
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { deviceMemory: .5 } });
try {
  const { createThreeRasterTileTextures, threeRasterTextureInfo } = await import("../src/threeRasterTextures.ts");
  const { planRasterTiles } = await import("../src/rasterTiles.ts");
  const { buildMonochromeMipChain, monochromeCoverageTilePixels } = await import("../src/monochromeRaster.ts");
  const { estimateRasterSourcePlanBytes, automaticRasterMemoryBudget } = await import("../src/rasterMemoryBudget.ts");
  const { createThreeWebGpuRasterMaterial } = await import("../src/threeWebGpuRasterMaterial.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ThreeRasterCompression } = await import("../src/threeRasterCompression.ts");
  const { WebGpuRasterCompression } = await import("../src/webGpuRasterCompression.ts");
  const { estimateCompressedRasterBytes } = await import("../src/rasterCompression.ts");
  const source = (width,height,pageIndex=0) => ({ width,height,pageIndex,
    matrix: Float32Array.of(width,0,0,height,0,0), monochrome: {
      data: new Uint8Array(Math.ceil(width/8)*height).fill(0xaa), colors: Uint8Array.of(255,240,220,255,10,20,30,128)
    }, get data() { assert.fail("Three must not materialize packed source RGBA"); } });
  const small = source(33,17), fullPlan = planRasterTiles(33,17,512), reducedPlan = planRasterTiles(16,8,512);
  const [packed] = createThreeRasterTileTextures(small,fullPlan), packedInfo = threeRasterTextureInfo(packed);
  assert.equal(packed.format,THREE.RedFormat); assert.equal(packed.image.width,5);
  assert.equal(packedInfo.mode,1); assert.equal(packed.generateMipmaps,false);
  assert.equal(packed.minFilter,THREE.NearestFilter);
  assert.equal(packedInfo.coverage.format,THREE.RedFormat);
  assert.deepEqual(packedInfo.coverage.mipmaps,buildMonochromeMipChain(small.monochrome,33,17));
  assert.equal(packedInfo.estimatedBytes,estimateRasterSourcePlanBytes({ width: small.width, height: small.height, monochrome: small.monochrome, reducedMonochrome: true },fullPlan));
  assert.equal(packedInfo.color1.w,128/255);
  assert(Math.abs(packedInfo.color1.x-10/255*128/255)<1e-12,"palette colors are premultiplied");
  const [coverage] = createThreeRasterTileTextures(small,reducedPlan), coverageInfo = threeRasterTextureInfo(coverage);
  assert.equal(coverageInfo.mode,2); assert.equal(coverageInfo.coverage,coverage);
  assert.equal(coverage.image.data.length,16*8);
  assert.deepEqual(coverage.image.data,monochromeCoverageTilePixels(small.monochrome,33,17,reducedPlan)[0]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(new Float32Array(12),3));
  geometry.setAttribute("aCorner",new THREE.BufferAttribute(Float32Array.of(-1,-1,1,-1,-1,1,1,1),2));
  geometry.setIndex([0,1,2,2,1,3]);
  for (const colorCompositing of ["display","linear"]) {
    const state = createThreeWebGpuRasterMaterial({ texture: coverage, viewport: new THREE.Vector2(800,600),
      cameraCenter: new THREE.Vector2(), localToClip: new THREE.Matrix4(), colorCompositing,
      matrixABCD: new THREE.Vector4(1,0,0,1),matrixEF: new THREE.Vector2() });
    const builder = build(state.material,geometry), shader = builder.fragmentShader;
    const bindings = builder.getBindings().flatMap(group => group.bindings);
    const textureBindings = bindings.filter(binding => binding.isSampledTexture);
    assert.equal(textureBindings.length,2,"preview tiers keep distinct binding slots without duplicating texture allocations");
    assert.match(shader,/fn heprThreeRasterBit\s*\(/);
    for (const match of shader.matchAll(/\b(nodeUniform\d+_sampler)\b/g))
      assert(shader.includes(`var ${match[1]} : sampler;`), "every function sampler argument has a real binding");
    assert.match(shader,/textureLoad\(image, vec2i\(p.x \/ 8, p.y\), 0\)/);
    assert.match(shader,/textureSampleLevel\(coverageImage, coverageSampler, uv, lod - 1.0\)/);
    assert(shader.indexOf("let dx = dpdx(uv)") < shader.indexOf("if (mode < 0.5)"));
    assert.match(shader,/heprThreeOutputColor\(straightSrgb\) \* color.a/);
    state.updateSource(packed,Float32Array.of(1,0,0,1,0,0),1);
    textureBindings.forEach(binding=>binding.update());
    assert.deepEqual(new Set(textureBindings.map(binding=>binding.texture)),new Set([packed,packedInfo.coverage]),
      "promotion updates both existing bindings without recompiling or losing coverage mips");
    state.updateSource(coverage,Float32Array.of(2,0,0,3,4,5),.5);
    const next = build(state.material,geometry);
    assert(next.getBindings().flatMap(group => group.bindings).some(binding => binding.textureNode?.value === coverage),
      "a tier replacement updates real texture/sampler bindings");
    state.material.dispose();
  }
  geometry.dispose();
  let coverageDisposed = 0;
  packedInfo.coverage.addEventListener("dispose",() => coverageDisposed++);
  packed.dispose(); assert.equal(coverageDisposed,1); coverage.dispose();

  const image = source(2048,1024), scene = createEmptyVectorScene();
  scene.rasterLayers = [image]; scene.pageRects = Float32Array.of(0,0,2048,1024);
  const layer = new ThreeMaterialRasterLayer(scene,{ pageBackground: [1,1,1,1] });
  const entry = layer.rasterEntries[0];
  assert.equal(threeRasterTextureInfo(entry.texture).mode,2,"initial previews use R8");
  layer.setTextureResidency(true);
  const view = { cameraCenterX: 1024,cameraCenterY: 512,zoom: 1 }, viewport = { width: 2048,height: 1024 };
  layer.updateFrame(view,viewport);
  assert.equal(threeRasterTextureInfo(entry.texture).mode,1,"full detail retains one bit per source pixel");
  assert.match(entry.material.fragmentShader,/heprRasterBinaryLinear/);
  assert.equal(entry.material.uniforms.uRasterMonoMips.value,threeRasterTextureInfo(entry.texture).coverage);
  layer.updateFrame({ ...view,zoom:.01 },viewport);
  assert.equal(threeRasterTextureInfo(entry.texture).mode,2,"zoom-out demotes the native Three material");
  layer.setMemoryAllowance(65536); layer.updateFrame(view,viewport);
  assert(layer.rasterImageBytes(entry) <= 65536,"replacement bytes honor the page's document allowance");
  layer.dispose();

  const pagesScene = createEmptyVectorScene();
  pagesScene.rasterLayers = Array.from({ length:4 },(_,i) => source(4096,4096,i));
  const pagesLayer = new ThreeMaterialRasterLayer(pagesScene,{ pageBackground:[1,1,1,1] });
  const projection = new THREE.Matrix4().makeScale(2/4096,2/4096,1); projection.setPosition(-1,-1,0);
  const allowances = pagesLayer.planPageMemory(Array(4).fill(projection.elements),{ width:4096,height:4096 });
  assert(allowances.reduce((a,b)=>a+b,0) <= automaticRasterMemoryBudget().bytes,
    "independent pages share one automatic document budget");
  assert(allowances.every(bytes=>bytes>0)); pagesLayer.dispose();

  const originalCreate = WebGpuRasterCompression.create;
  let creates=0, disposed=0, destroyed=0;
  WebGpuRasterCompression.create = async () => { creates++; return { format:"bc7", available:true,workspaceBytes:4096,
    setFailureListener() {}, releaseWorkspace() {}, dispose() { disposed++; },
    createTexture(width,height) { return { texture: { destroy() { destroyed++; } },estimatedBytes:400,uvScale:[width/20,height/12] }; } }; };
  try {
    const host = { isWebGPURenderer:true,backend:{ device:{} } }, a = new ThreeRasterCompression(()=>{}), b = new ThreeRasterCompression(()=>{});
    a.setHost(host); b.setHost(host); await Promise.resolve();
    assert.equal(creates,1,"page materials reuse one encoder/workspace on their host device");
    const texture = a.upload(new Uint8Array(17*11*4),17,11,"bc7");
    assert.equal(texture.isExternalTexture,true);
    assert.deepEqual(threeRasterTextureInfo(texture).uvScale,[17/20,11/12]);
    a.dispose(); assert.equal(disposed,0,"a remaining page keeps the shared encoder alive");
    texture.dispose(); texture.dispose(); assert.equal(destroyed,1,"the adapter owns each GPU handle exactly once");
    b.dispose(); assert.equal(disposed,1);

    let unavailable = false, failures = 0;
    WebGpuRasterCompression.create = async () => ({ format:"bc7", get available() { return !unavailable; }, workspaceBytes:4096,
      setFailureListener() {},releaseWorkspace() {},dispose() {},
      createTexture(width,height) {
        if (failures) { failures--; unavailable = true; return null; }
        return { texture:{ destroy() {} },estimatedBytes:estimateCompressedRasterBytes(width,height,"bc7"),uvScale:[1,1] };
      } });
    const data = new Uint8Array(1024*1024*4);
    for (let y=0;y<1024;y++) for (let x=0;x<1024;x++) {
      const offset=(y*1024+x)*4;
      data.set([x>>2,y>>2,(x+y)>>3,255],offset);
    }
    const photoScene = createEmptyVectorScene();
    photoScene.rasterLayers = Array.from({ length:6 },(_,i)=>({ width:1024,height:1024,data,pageIndex:i,
      matrix:Float32Array.of(1024,0,0,1024,0,0) }));
    const webGpu = await import("../src/threeWebGpuBackend.ts");
    const photos = new ThreeMaterialRasterLayer(photoScene,{ pageBackground:[1,1,1,1],materialBackend:"webgpu",webGpu });
    photos.setHostRenderer(host); await Promise.resolve(); photos.setTextureResidency(true);
    const view = { cameraCenterX:512,cameraCenterY:512,zoom:1 }, viewport = { width:1024,height:1024 };
    for (let i=0;i<7;i++) photos.updateFrame(view,viewport);
    assert(photos.rasterEntries.every(entry=>threeRasterTextureInfo(entry.texture).compressionFormat === "bc7"),
      "the Three material planner compresses eligible photos before reducing their resolution");
    assert(photos.rasterEntries.every(entry=>entry.image.plan.width === 1024));
    assert(photos.rasterEntries.reduce((bytes,entry)=>bytes+photos.rasterImageBytes(entry),0) <= automaticRasterMemoryBudget().bytes);
    photos.setTextureResidency(false); photos.setTextureResidency(true);
    assert(photos.rasterEntries.every(entry=>!threeRasterTextureInfo(entry.texture).compressionFormat),
      "returning from native fallback recreates released external handles as drawable textures");
    assert(photos.rasterEntries.reduce((bytes,entry)=>bytes+photos.rasterImageBytes(entry),0) <= automaticRasterMemoryBudget().bytes,
      "fallback reactivation fits uncompressed tiers before the host can upload them");
    const beforeFailure = photos.rasterEntries[0].texture;
    failures = 1;
    const originalWarn = console.warn, warnings = [];
    console.warn = (...args)=>warnings.push(args.join(" "));
    try { photos.updateFrame(view,viewport); } finally { console.warn = originalWarn; }
    assert.equal(photos.rasterEntries[0].texture,beforeFailure,"failed encoding retains a drawable previous tier");
    assert(warnings.some(warning=>warning.includes("retaining the previous display resolution")));
    for (let i=0;i<7;i++) photos.updateFrame(view,viewport);
    assert(photos.rasterEntries.every(entry=>!threeRasterTextureInfo(entry.texture).compressionFormat));
    assert(photos.rasterEntries.reduce((bytes,entry)=>bytes+photos.rasterImageBytes(entry),0) <= automaticRasterMemoryBudget().bytes,
      "encoder failure replans uncompressed textures within the same budget");
    photos.dispose();
  } finally { WebGpuRasterCompression.create = originalCreate; }
  console.log("Three raster storage: packed/R8 tiers, palette/mips, real WGSL bindings, zoom demotion, document allowances and shared external compression ownership passed.");
} finally {
  clearTimeout(deadline);
  if (oldNavigator) Object.defineProperty(globalThis,"navigator",oldNavigator); else delete globalThis.navigator;
  hooks.deregister();
}

function build(material,geometry) {
  const renderer = { contextNode:TSL.context({}),library:{ fromMaterial:value=>value },getRenderTarget:()=>null,getMRT:()=>null,
    backend:{ compatibilityMode:false,utils:{ getTextureSampleData:()=>({ primarySamples:1 }) },
      capabilities:{ getUniformBufferLimit:()=>65536 } },hasFeature:()=>false,hasCompatibility:()=>false,
    coordinateSystem:THREE.WebGPUCoordinateSystem,debug:{ diagnostics:{ keywords:false } } };
  const builder = new WGSLNodeBuilder(new THREE.Mesh(geometry,material),renderer);
  builder.scene = new THREE.Scene(); builder.camera = new THREE.PerspectiveCamera(); return builder.build();
}
