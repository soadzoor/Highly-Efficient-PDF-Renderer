import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { threeVectorDrawRunsOf } = await import("../src/threeVectorDrawRuns.ts");
  const { ThreePaintCompositor } = await import("../src/threePaintCompositor.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { ThreePageTransforms } = await import("../src/threePageTransforms.ts");
  const { RenderPerformanceProfiler } = await import("../src/renderPerformance.ts");
  const { withThreeRenderPerformance } = await import("../src/threeRenderPerformance.ts");
  const { OptionalContentController } = await import("../src/optionalContent.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const webGpu = await import("../src/threeWebGpuBackend.ts");
  const rect = (x, y, w, h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map((p,i,points) =>
    ({ p, q: points[(i+1)%points.length] }));
  function sceneOf() {
    const paths = [[...rect(0,0,1,1),...rect(4,0,1,1),...rect(1000,0,1,1)],rect(20,20,1,1)];
    const a=[],b=[],ma=[],mb=[],mc=[];
    for(const path of paths){
      const xs=path.flatMap(s=>[s.p[0],s.q[0]]),ys=path.flatMap(s=>[s.p[1],s.q[1]]);
      ma.push(a.length/4,path.length,Math.min(...xs),Math.min(...ys));
      mb.push(Math.max(...xs),Math.max(...ys),.2,.3);mc.push(1,0,.4,.5);
      for(const s of path){a.push(...s.p,...s.p);b.push(...s.q,0,0);}
    }
    const bounds={minX:0,minY:0,maxX:1100,maxY:40};
    return Object.assign(createEmptyVectorScene(),{fillPathCount:paths.length,fillSegmentCount:a.length/4,
      fillSegmentsA:Float32Array.from(a),fillSegmentsB:Float32Array.from(b),fillPathMetaA:Float32Array.from(ma),
      fillPathMetaB:Float32Array.from(mb),fillPathMetaC:Float32Array.from(mc),bounds,pageBounds:bounds,
      pageCount:1,pageRects:Float32Array.of(0,0,1100,40),pageTextRanges:Uint32Array.of(0,0),
      drawRuns:[{kind:"fill",first:0,count:1,clipIndex:0,optionalContent:0},{kind:"fill",first:1,count:1,clipIndex:1}],
      optionalContent:{groups:[{id:"sparse",name:"Sparse",defaultVisible:true,locked:false,usedInView:true}],
        conditions:[{kind:"group",groupId:"sparse"}],order:[],radioGroups:[]},
      clipPaths:[0,1].map(()=>({parent:-1,fillRule:0,edges:Float32Array.from(rect(-10,-10,1120,60).flatMap(s=>[...s.p,...s.q]))}))});
  }
  const values = geometry => Array.from({length:geometry.instanceCount},(_,i)=>geometry.getAttribute("aFillPathIndex").getX(i));
  const meshes = layer => layer.mesh.children.filter(mesh=>mesh.visible);
  const ids = layer => meshes(layer).flatMap(mesh=>values(mesh.geometry));
  const viewport={width:2200,height:120},view={cameraCenterX:500,cameraCenterY:20,zoom:1};
  const full={minX:-10,minY:-10,maxX:1110,maxY:50};
  function assertFootprint(layer,projection,pixels,label){
    layer.setLocalToClipTransform(projection);
    const units=layer.fillUnitsPerPixel(view,pixels);
    assert(units!==null,`${label}: a finite inverse footprint is established`);
    const m=projection.elements.map(Math.fround),inverse=new THREE.Matrix3().set(
      m[0]*pixels.width/2,m[4]*pixels.width/2,m[12]*pixels.width/2,
      m[1]*pixels.height/2,m[5]*pixels.height/2,m[13]*pixels.height/2,m[3],m[7],m[15]).invert();
    const local=(x,y)=>{const p=new THREE.Vector3(x,y,1).applyMatrix3(inverse);return p.multiplyScalar(1/p.z);};
    for(let ix=0;ix<=8;ix++)for(let iy=0;iy<=8;iy++){
      const x=pixels.width*(ix/8-.5),y=pixels.height*(iy/8-.5);
      const p=local(x,y),dx=local(x+1,y).sub(p),dy=local(x,y+1).sub(p);
      assert(units>=Math.max(Math.hypot(dx.x,dy.x),Math.hypot(dx.y,dy.y)),
        `${label}: the bound covers inverse pixel differences across the viewport`);
    }
    return units;
  }

  for(const backend of ["webgl","webgpu"]){
    const scene=sceneOf(),canonical=structuredClone(scene);
    const layer=new ThreeMaterialFillLayer(scene,{materialBackend:backend,webGpu,vectorOverride:[0,0,0,0]});
    const refresh = (zoom=1) => layer.updateFrame({...view,zoom},viewport,full);
    refresh();
    const data=layer.fillData,origin=id=>id<data.canonicalCount?id:data.origins[id-data.canonicalCount];
    assert.deepEqual(ids(layer).map(origin),[0,0,1],`${backend}: coarser safe contour groups retain canonical paint order`);
    const batch=meshes(layer)[0],attribute=batch.geometry.getAttribute("aFillPathIndex");
    assert.equal(meshes(layer).length,1,"contour groups share the original compatible draw");
    assert.deepEqual(Array.from({length:batch.geometry.instanceCount},(_,i)=>batch.geometry.getAttribute("aVectorClipIndex").getX(i)),[1,1,2]);
    assert.equal(batch.userData.heprDrawRun.count,2,"canonical metadata counts source fills, not spare capacity");
    const version=attribute.version;refresh();
    assert.equal(attribute.version,version,"stable selections retain their uploaded instances");

    const compositor=new ThreePaintCompositor(backend,webGpu);
    compositor.collect([layer.mesh]);
    const proxy=compositor.proxies.get(batch);
    const subset=compositor.geometryForRuns(proxy,[scene.drawRuns[0]],0);
    assert.deepEqual(values(subset).map(origin),[0,0],"compositor subsets retain every contour of the requested paint");
    const folded=compositor.foldGeometry(proxy,scene.drawRuns[0]);
    assert.deepEqual(values(folded),values(subset),"folded opacity/masks draw every selected contour");
    assert.equal(compositor.foldGeometry(proxy,scene.drawRuns[0]),folded,"stable folded paints reuse geometry");
    refresh(8);
    assert.deepEqual(ids(layer).map(origin),[0,0,0,1],"zooming selects the finer independent contours");
    compositor.collect([layer.mesh]);
    const finer=compositor.foldGeometry(proxy,scene.drawRuns[0]);
    assert.equal(finer.instanceCount,3,"a fold refreshes when its contour selection changes");
    assert.notEqual(finer,folded);

    const owner=threeVectorDrawRunsOf(layer.mesh);
    owner.deferInstanceWrites(true);refresh(1);
    const packed=new Float32Array(4*ids(layer).length+16);
    const count=owner.writeMixedInstances(batch,packed,0,1,undefined)/4;
    const mixedIds=Array.from({length:count},(_,i)=>packed[i*4]);
    assert.deepEqual(mixedIds.map(origin),[0,0,1],"deferred mixed writes use the current contour selection");
    assert.equal(count,batch.geometry.instanceCount,"mixed capacity/counts agree with the ordinary draw");
    owner.deferInstanceWrites(false);
    assert.deepEqual(ids(layer),mixedIds,"leaving mixed mode restores the same ordinary instances");
    const controller=new OptionalContentController(scene);
    await controller.setLayerVisibility("sparse",false);
    layer.setOptionalContentVisibility(controller.getSnapshot());
    assert.deepEqual(ids(layer),[1],"hiding a canonical paint hides every selected contour");
    assert.equal(compositor.foldGeometry(proxy,scene.drawRuns[0]),null,"hidden paints leave no stale folded contours");
    await controller.setLayerVisibility("sparse",true);
    layer.setOptionalContentVisibility(controller.getSnapshot());
    assert.deepEqual(ids(layer).map(origin),[0,0,1]);
    controller.dispose();
    layer.updateFrame({...view,cameraCenterX:0}, {width:20,height:20},{minX:-10,minY:-10,maxX:10,maxY:10});
    assert.deepEqual(ids(layer).map(origin),[0],"a visible canonical run can retain just its on-screen contour group");
    refresh();

    refresh(1/1024);assert.deepEqual(ids(layer),[0,1],"large footprints retain the whole compound fill");
    layer.setLocalToClipTransform(new THREE.Matrix4().makeScale(2/viewport.width,2/viewport.height,1));
    refresh();assert.deepEqual(ids(layer).map(origin),[0,0,1],"affine projected fills use an exact pixel scale");
    layer.setLocalToClipTransform(new THREE.Matrix4().makeScale(2/(viewport.width*1024),2/viewport.height,1));
    refresh();assert.deepEqual(ids(layer),[0,1],"the larger inverse axis controls anisotropic projection safety");

    // Real top-down captures have tiny, nonzero camera rotation after orbiting.
    // Exact-zero matrix checks must not disable the sparse-fill optimization.
    const capturedViewport={width:2018,height:1774};
    for(const [x,y,qx,far] of [[129.74270959902802,1.4640036452007263,-3.061883813295319e-17,11386.259654616897],
      [35.886543134872376,18.244684082625025,-3.055299116922641e-17,11073.03451948705]]){
      const camera=new THREE.PerspectiveCamera(45,2018/1774,1090.9181362670774,far);
      camera.position.set(x,y,3372.131262518975);camera.quaternion.set(qx,0,0,1);camera.updateMatrixWorld();
      const projection=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
        .multiply(new THREE.Matrix4().makeTranslation(-550,-20,0));
      assert.notEqual(projection.elements[7],0,"the capture exercises nonzero clip-W residue");
      layer.setLocalToClipTransform(projection);layer.updateFrame(view,capturedViewport,full);
      assert.deepEqual(ids(layer).map(origin),[0,0,1],`${backend}: captured top-down cameras select tighter contours`);
      assert(layer.fillUnitsPerPixel(view,capturedViewport)>=2*camera.position.z*Math.tan(Math.PI/8)/capturedViewport.height,
        "the footprint includes Float32 rounding and residual perspective");
      const revision=layer.orderedRuns.revision;
      layer.updateFrame(view,capturedViewport,full);
      assert.equal(layer.orderedRuns.revision,revision,"camera residue does not cause stable-frame instance uploads");
    }

    const nearAffine=new THREE.Matrix4().set(2/viewport.width,.5/viewport.width,0,-.8,
      .2/viewport.height,2/viewport.height,0,.25,0,0,1,0,1e-10,-2e-10,0,1);
    assertFootprint(layer,nearAffine,viewport,"small perspective terms");refresh();
    const widerView=nearAffine.clone();
    for(const component of [0,1,4,5])widerView.elements[component]*=1e-8;
    layer.setLocalToClipTransform(widerView);
    assert.equal(layer.fillUnitsPerPixel(view,viewport),null,
      "the same W slopes fall back when a wider view puts the horizon inside the viewport");

    const dataToLocal=new THREE.Matrix4().makeTranslation(-550,-20,0);
    for(const tilt of [15,30,45,60]){
      const angle=tilt*Math.PI/180,azimuth=tilt===60?0:.4;
      const camera=new THREE.PerspectiveCamera(45,capturedViewport.width/capturedViewport.height,1,5000);
      camera.position.set(1000*Math.sin(angle)*Math.sin(azimuth),1000*Math.sin(angle)*Math.cos(azimuth),1000*Math.cos(angle));
      camera.lookAt(0,0,0);camera.updateMatrixWorld();
      const projection=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(dataToLocal);
      assertFootprint(layer,projection,capturedViewport,`${backend}: ${tilt}-degree perspective`);
      layer.updateFrame(view,capturedViewport,full);
      assert(ids(layer).some(id=>id>=data.canonicalCount),"tilted perspective views retain safe contour splitting");
      const revision=layer.orderedRuns.revision;layer.updateFrame(view,capturedViewport,full);
      assert.equal(layer.orderedRuns.revision,revision,"stable tilted views reuse their instances");
    }
    const ortho=new THREE.OrthographicCamera(-700,700,500,-500,1,5000);
    ortho.zoom=2;ortho.updateProjectionMatrix();
    ortho.position.set(800,400,300);ortho.lookAt(0,0,0);ortho.updateMatrixWorld();
    const objectTransform=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.3,-.2,.5))
      .scale(new THREE.Vector3(-1.3,.8,1));
    objectTransform.multiply(new THREE.Matrix4().set(1,.3,0,0,.15,1,0,0,0,0,1,0,0,0,0,1));
    const transformed=new THREE.Matrix4().multiplyMatrices(ortho.projectionMatrix,ortho.matrixWorldInverse)
      .multiply(objectTransform).multiply(dataToLocal);
    assertFootprint(layer,transformed,capturedViewport,`${backend}: tilted orthographic, reflected/scaled/sheared PDF`);
    layer.updateFrame(view,capturedViewport,full);
    assert(ids(layer).some(id=>id>=data.canonicalCount));
    const projective=nearAffine.clone();projective.elements[3]=2e-4;projective.elements[7]=-.001;
    assertFootprint(layer,projective,viewport,`${backend}: arbitrary projective matrix`);refresh();
    assert(ids(layer).some(id=>id>=data.canonicalCount));
    const behindOrigin=new THREE.Matrix4().set(.001,0,0,-20,0,.01,0,0,0,0,1,0,.0001,0,0,-1);
    assertFootprint(layer,behindOrigin,viewport,"positive on-screen W with a behind-eye data origin");
    const grazing=new THREE.PerspectiveCamera(45,capturedViewport.width/capturedViewport.height,1,5000);
    grazing.position.set(0,1000,100);grazing.lookAt(0,0,0);grazing.updateMatrixWorld();
    layer.setLocalToClipTransform(new THREE.Matrix4().multiplyMatrices(grazing.projectionMatrix,grazing.matrixWorldInverse).multiply(dataToLocal));
    layer.updateFrame(view,capturedViewport,full);
    assert.deepEqual(ids(layer),[0,1],"a grazing camera whose horizon crosses the viewport retains whole fills");

    layer.setLocalToClipTransform(nearAffine);

    const profile=new RenderPerformanceProfiler();profile.start({gpu:false,maxFrames:2});
    profile.beginFrame();withThreeRenderPerformance(profile,()=>refresh());profile.endFrame();
    const perspective=new THREE.Matrix4().makeScale(2/viewport.width,2/viewport.height,1);perspective.elements[3]=.001;
    layer.setLocalToClipTransform(perspective);
    profile.beginFrame();withThreeRenderPerformance(profile,()=>refresh());profile.endFrame();
    assert.deepEqual(ids(layer),[0,1],"horizon-crossing perspective projections retain canonical fills");
    const counters=profile.getReport().counters;
    assert.equal(counters["three.fillSelectionActive"].total,1,"captures distinguish active selection from fallback");
    assert.equal(counters["three.fillSplitPaths"].total,1,"captures expose selected sparse canonical paths");
    for(const matrix of [new THREE.Matrix4().makeScale(0,1,1),new THREE.Matrix4().makeScale(1,1,1).setPosition(Infinity,0,0),
      new THREE.Matrix4().set(1,1,0,0,1,1+1e-8,0,0,0,0,1,0,0,0,0,1),
      new THREE.Matrix4().set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,-1)]){
      layer.setLocalToClipTransform(matrix);refresh();
      assert.deepEqual(ids(layer),[0,1],"invalid, singular and behind-eye projections retain original fills");
    }
    layer.setScreenSpaceTransform();refresh();

    const b=layer.fillPathMetaTextureB.image.data,c=layer.fillPathMetaTextureC.image.data;
    for(const color of [[.8,.7,.6],null]){
      layer.setPrimitiveColorUpdates([{ref:{kind:"fill",index:0},color}],scene);
      for(const variants of [data.parts.get(0)])for(const part of variants)for(let id=part.first;id<part.first+part.count;id++){
        assert.equal(b[id*4+2],Math.fround(color?.[0]??scene.fillPathMetaB[2]));
        assert.equal(c[id*4+2],Math.fround(color?.[2]??scene.fillPathMetaC[2]));
        assert.equal(c[id*4],data.pathMetaC[id*4],"color changes preserve the exact fill-rule dispatch");
      }
    }
    const previousScale=globalThis.HEPR_DEBUG_COMPOSITE_SCALE;
    try{
      globalThis.HEPR_DEBUG_COMPOSITE_SCALE=.25;
      layer.updateFrame(view,viewport,full,true);
      assert.deepEqual(ids(layer),[0,1],"reduced compositor resolution retains the original coverage domain");
    }finally{
      if(previousScale===undefined)delete globalThis.HEPR_DEBUG_COMPOSITE_SCALE;else globalThis.HEPR_DEBUG_COMPOSITE_SCALE=previousScale;
    }
    assert.deepEqual(scene,canonical,"Three uploads, grouping and colors do not change canonical scene data");
    compositor.dispose();layer.dispose();

    const document=composeVectorScenesInGrid([sceneOf(),sceneOf()],2);
    const partition=new ScenePageViews(document),pages=new ThreePageTransforms(partition);
    for(let page=0;page<2;page++)pages.setPage(page,new THREE.Matrix4(),new THREE.Matrix4().makeScale(.001,.01,1),true,1,true);
    pages.finishUpdate();
    const paged=new ThreeMaterialFillLayer(document,{pageTransforms:pages,materialBackend:backend,webGpu,vectorOverride:[0,0,0,0]});
    paged.setLocalToClipTransform(new THREE.Matrix4());
    paged.updateFrame(view,viewport,{minX:-100,minY:-100,maxX:10000,maxY:10000});
    const pageData=paged.fillData,owners=paged.getMixedVectorResources().pageBinding.owners.image.data;
    for(let id=0;id<pageData.pathCount;id++){
      const canonicalId=id<pageData.canonicalCount?id:pageData.origins[id-pageData.canonicalCount];
      assert.equal(owners[id],partition.owners.fill[canonicalId],"all derived contours inherit their canonical page");
    }
    assert(ids(paged).some(id=>id>=pageData.canonicalCount),"affine page batches use tighter contours");
    pages.projections[1].elements[7]=-6.123767626590638e-20;
    paged.updateFrame(view,viewport,{minX:-100,minY:-100,maxX:10000,maxY:10000});
    assert(ids(paged).some(id=>id>=pageData.canonicalCount),"page tables also accept bounded top-down rotation residue");
    pages.projections[1].elements[3]=.0001;
    assertFootprint(paged,pages.projections[0],viewport,"independently projected pages");
    paged.updateFrame(view,viewport,{minX:-100,minY:-100,maxX:10000,maxY:10000});
    assert(ids(paged).some(id=>id>=pageData.canonicalCount),"bounded perspective page tables also select tighter contours");
    pages.projections[1].elements[3]=.001;
    paged.updateFrame(view,viewport,{minX:-100,minY:-100,maxX:10000,maxY:10000});
    assert(ids(paged).every(id=>id<pageData.canonicalCount),"one uncertain page projection restores safe canonical paths");
    paged.dispose();pages.dispose();
  }
  console.log("Three WebGL/WebGPU contour selection preserves batching, clips, mixed writes, folds, page ownership, color IDs and projection/resolution fallback.");
} finally { hooks.deregister(); }
