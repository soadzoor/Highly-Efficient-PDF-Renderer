import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s,c,next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s,c);
} });
const previousMedia = Object.getOwnPropertyDescriptor(globalThis,"matchMedia");
let reduced = false;
Object.defineProperty(globalThis,"matchMedia",{ configurable:true,value:() => ({ matches:reduced }) });
try {
  const { PdfPageDemandLoader } = await import("../src/pdfPageDemand.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { hasVisiblePagePlaceholders, pagePlaceholderTime, pagePlaceholderAnimationEnabled } = await import("../src/pageLoadingPlaceholder.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const view = { width:400,height:500,cameraCenterX:300,cameraCenterY:400,zoom:1 };
  const session = { info:{ pages:[0,1].map(index => ({ index,width:600,height:800 })) },
    async compileVectorPage() {
      const blank = createEmptyVectorScene();
      Object.assign(blank,{ pageCount:1,pageRects:Float32Array.of(0,0,600,800),
        pageBounds:{ minX:0,minY:0,maxX:600,maxY:800 },bounds:{ minX:0,minY:0,maxX:600,maxY:800 } });
      return blank;
    },async close() {} };
  const loader = new PdfPageDemandLoader(session,()=>{});
  try {
    const scene = composeVectorScenesInGrid(loader.pageScenes,2);
    view.cameraCenterX = (scene.pageRects[0]+scene.pageRects[2])/2;
    view.cameraCenterY = (scene.pageRects[1]+scene.pageRects[3])/2;
    assert.deepEqual(scene.pendingPagePreviews,Uint8Array.of(1,1));
    assert.equal(scene.segmentCount,0,"placeholder bars do not create document strokes, picking targets or export content");
    assert.equal(scene.rasterLayers.length,0,"page skeletons need no raster image allocation");
    const partition = new ScenePageViews(scene);
    assert.deepEqual(partition.extract(1).scene.pendingPagePreviews,Uint8Array.of(1));
    assert(hasVisiblePagePlaceholders(scene,view));
    assert(!hasVisiblePagePlaceholders(scene,{ ...view,cameraCenterX:100000 }));
    assert(!hasVisiblePagePlaceholders(scene,{ ...view,projection:()=>null }),"hidden independent pages do not animate");
    const projection = [2/600,0,0,0, 0,2/800,0,0, 0,0,1,0,
      -1-2*scene.pageRects[0]/600,-1-2*scene.pageRects[1]/800,0,1];
    assert(hasVisiblePagePlaceholders(scene,{ ...view,localToClip:projection }));
    assert(!hasVisiblePagePlaceholders(scene,{ ...view,localToClip:projection.map((x,i)=>i===12 ? 100:x) }));
    assert(!hasVisiblePagePlaceholders(scene,{ ...view,localToClip:projection.map((x,i)=>i===15 ? -1:x) }));
    assert(!hasVisiblePagePlaceholders(scene,{ ...view,localToClip:projection.map((x,i)=>i===14 ? 4:x) }),"depth-clipped pages do not animate");
    assert(!hasVisiblePagePlaceholders(scene,{ ...view,clipDepth:0,localToClip:projection.map((x,i)=>i===14 ? -.5:x) }),
      "WebGPU cameras use zero as the near depth boundary");

    loader.update({ ...view,cameraCenterX:300,cameraCenterY:400 },Float32Array.of(0,0,600,800, 2000,0,2600,800));
    await loader.whenIdle();
    const loaded = composeVectorScenesInGrid(loader.pageScenes,2);
    assert.deepEqual(loaded.pendingPagePreviews,Uint8Array.of(0,1));
    assert(!hasVisiblePagePlaceholders(loaded,view),"a successfully compiled blank page stays blank");
    assert.equal(new ScenePageViews(loaded).extract(0).scene.pendingPagePreviews[0],0);
    const complete = composeVectorScenesInGrid([loader.pageScenes[0],loader.pageScenes[0]],2);
    assert.equal(complete.pendingPagePreviews,undefined,"completed scenes retain no loading flags");

    assert.notEqual(pagePlaceholderTime(200),pagePlaceholderTime(700));
    assert(Math.abs(pagePlaceholderTime(2600)-pagePlaceholderTime(200)) < 1e-12,"shader time wraps without precision loss");
    for (const Renderer of [WebGlFloorplanRenderer,WebGpuFloorplanRenderer]) {
      let frames = 0;
      const renderer = Object.assign(Object.create(Renderer.prototype), {
        canvas:{ width:400,height:500 },scene,rasterRenderingEnabled:true,pageRects:scene.pageRects,pageBackgroundColor:[1,1,1,1],
        segmentCount:0,fillPathCount:0,textInstanceCount:0,rasterLayers:[],rasterLayerResources:[],pageBackgroundResources:[{}],
        getViewState:()=>view,updateCameraWithDamping:()=>false,updatePanReleaseVelocitySample() {},
        ensureRenderState() {},updateRasterResolution() {},renderDirectToScreen:()=>({}),
        hasNativeRenderingEnabled:()=>true,drawSearchHighlights() {},capturePresentedFrameState() {},emitFrameStats() {},
        requestFrame() { frames++; }
      });
      renderer.renderFrame(100,null);
      assert.equal(frames,1,`${Renderer.name}: visible pending overviews continue animation after the camera settles`);
      renderer.getViewState = () => ({ ...view,cameraCenterX:100000 });
      renderer.renderFrame(100,null); assert.equal(frames,1,"offscreen skeletons stop requesting frames");
      renderer.getViewState = () => view; renderer.scene = complete;
      renderer.renderFrame(100,null); assert.equal(frames,1,"completed previews stop requesting frames");
      renderer.scene = scene; reduced = true;
      renderer.renderFrame(100,null); assert.equal(frames,1,"reduced motion stops animation frames");
      reduced = false;
      renderer.pageBackgroundColor[3] = 0;
      renderer.renderFrame(100,null); assert.equal(frames,1,"invisible backgrounds do not animate");
    }
    reduced = true;
    assert(!pagePlaceholderAnimationEnabled());
    assert.equal(pagePlaceholderTime(200),pagePlaceholderTime(700),"reduced motion retains a static book-page skeleton");
    reduced = false;
  } finally { await loader.close(); }

  const failed = new PdfPageDemandLoader({ ...session,async compileVectorPage() { throw new Error("unreadable preview"); } },()=>{});
  const warn = console.warn;
  console.warn = () => {};
  try {
    failed.update({ ...view,cameraCenterX:300,cameraCenterY:400 },Float32Array.of(0,0,600,800, 2000,0,2600,800)); await failed.whenIdle();
    assert.equal(failed.pageScenes[0].pendingPagePreviews[0],0,"failed pages do not keep showing a busy animation");
  } finally { console.warn = warn; await failed.close(); }
  console.log("Page loading skeletons: explicit pending flags, page composition, independent views, blank/failed completion, visibility, reduced motion and native frame scheduling passed.");
} finally {
  if (previousMedia) Object.defineProperty(globalThis,"matchMedia",previousMedia); else delete globalThis.matchMedia;
  hooks.deregister();
}
