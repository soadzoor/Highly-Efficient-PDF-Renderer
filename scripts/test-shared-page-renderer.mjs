import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const hooks = registerHooks({ resolve(s,c,n) { return n(c.parentURL?.includes('/src/') && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s+'.ts' : s,c); } });
try {
  const { SharedPageRenderer }=await import('../src/sharedPageRenderer.ts');
  const { createEmptyVectorScene }=await import('../src/emptyVectorScene.ts');
  const scenes=[createEmptyVectorScene(),createEmptyVectorScene()];
  const image=value=>({width:1,height:1,data:Uint8Array.of(value,0,0,255),matrix:Float32Array.of(1,0,0,1,0,0),pageIndex:0,paintOrder:0});
  scenes.forEach((scene,i)=>scene.rasterLayers=[image(i)]);
  let active, view, colors, background, visibility, listener, pixels, lastSceneOptions, uploadView,
    uploads=0,disposals=0,serial=0,releases=0;
  const native={
    setScene(scene,options){active=scene;lastSceneOptions=options;uploadView={...view};uploads++;
      pixels=scene.rasterLayers[0].data[0];colors=[];return{textureWidth:1};},
    getSceneStats:()=>({textureWidth:1}),resize(){},dispose(){disposals++;},
    setExternalFrameDriver(){},setViewState(next){view={...next};},getViewState:()=>({...view}),getPresentedViewState:()=>({...view}),
    setFrameListener(next){listener=next;},setInteractionViewportProvider(){},
    setPageBackgroundColor(...color){background=color;},setOptionalContentVisibility(next){visibility=next;},
    setPrimitiveColorUpdates(next){colors=next;},
    prepareRasterLayerUpdates(updates){return{commit(){pixels=updates.get(0)?.data[0]??pixels;},dispose(){releases++;}};},
    renderExternalFrame(){serial++;listener?.({renderedSegments:1,totalSegments:1,usedCulling:false,zoom:view.zoom});},
    renderProjectedFrame(){this.renderExternalFrame();return{renderedSegments:1,totalSegments:1,usedCulling:false,zoom:view.zoom};},
    panByPixels(x,y){view.cameraCenterX-=x/view.zoom;view.cameraCenterY+=y/view.zoom;}
  };
  const gpuCanvas={width:1,height:1};
  const copied=[];
  const makeCanvas=tag=>({width:100,height:80,getContext(kind){assert.equal(kind,'2d');return{
    clearRect(){},drawImage(canvas){assert.equal(canvas,gpuCanvas);copied.push({tag,active,pixels,background:[...background],view:{...view},colors:[...colors],visibility});}
  };}});
  const pool=new SharedPageRenderer(native,gpuCanvas), a=pool.createView(scenes[0],makeCanvas('a')), b=pool.createView(scenes[1],makeCanvas('b'));
  const frames=[];a.setFrameListener(stats=>frames.push(['a',stats.zoom]));b.setFrameListener(stats=>frames.push(['b',stats.zoom]));
  a.setViewState({cameraCenterX:10,cameraCenterY:20,zoom:2});b.setViewState({cameraCenterX:-5,cameraCenterY:-8,zoom:3});
  a.setPageBackgroundColor(1,0,0,1);b.setPageBackgroundColor(0,0,1,.5);
  a.setOptionalContentVisibility({revision:1,layers:[],conditions:Uint8Array.of(0)});
  b.setOptionalContentVisibility({revision:1,layers:[],conditions:Uint8Array.of(1)});
  a.setPrimitiveColorUpdates([{ref:{kind:'stroke',index:0},color:[1,1,0]}]);
  const staged=a.prepareRasterLayerUpdates(new Map([[0,image(42)]]));staged.commit();staged.dispose();
  assert.equal(uploads,0,'configuring page views leaves the GPU dormant');
  a.renderExternalFrame();b.renderExternalFrame();a.renderExternalFrame();
  assert.equal(uploads,3,'switching pages replaces only the shared native scene');
  assert.deepEqual(copied.map(frame=>[frame.tag,frame.pixels,frame.view.zoom]),[['a',42,2],['b',1,3],['a',42,2]]);
  assert.deepEqual(copied.map(frame=>frame.background),[[1,0,0,1],[0,0,1,.5],[1,0,0,1]]);
  assert.deepEqual(copied.map(frame=>frame.colors.length),[1,0,1],'primitive colors never leak between pages');
  assert.deepEqual(copied.map(frame=>frame.visibility.conditions[0]),[0,1,0]);
  assert.deepEqual(frames,[['a',2],['b',3],['a',2]]);
  assert.equal(a.getPresentedFrameSerial(),2);assert.equal(b.getPresentedFrameSerial(),1);
  a.renderExternalFrame();assert.equal(uploads,3,'same-page redraw reuses the scene');
  a.panByPixels(2,4);assert.deepEqual(a.getViewState(),{cameraCenterX:9,cameraCenterY:22,zoom:2});
  assert.deepEqual(b.getViewState(),{cameraCenterX:-5,cameraCenterY:-8,zoom:3});
  assert.throws(()=>a.setExternalFrameDriver(false),/Three.js host/);
  const cancelled=b.prepareRasterLayerUpdates(new Map([[0,image(99)]]));cancelled.dispose();assert.throws(()=>cancelled.commit(),e=>e.name==='AbortError');
  const sceneOptions={preserveRasterResolution:true};
  b.setScene(scenes[1],sceneOptions);
  assert.equal(lastSceneOptions,sceneOptions,'a progressive page forwards zoom-preservation options');
  assert.deepEqual(uploadView,b.getViewState(),'progressive planning uses this page camera before uploading on the shared context');
  a.dispose();b.dispose();assert.equal(disposals,0,'views do not destroy the shared context');
  assert.throws(()=>a.renderExternalFrame(),e=>e.name==='AbortError');
  assert(releases>=2,'staged native replacements are released');
  console.log('Shared page renderer: lazy GPU use, isolated config/images/colors/visibility, per-page canvas snapshots and lifetime passed.');
}finally{hooks.deregister();}
