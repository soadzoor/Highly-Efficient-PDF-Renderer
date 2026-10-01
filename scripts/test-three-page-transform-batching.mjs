import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { createCanvas } from '@napi-rs/canvas';
// The builder must be the same three/webgpu module as the materials: a second
// copy keeps its own TSL stack, so clip and paint-fold assignments vanish.
import { TSL, WGSLNodeBuilder } from 'three/webgpu';
const hooks=registerHooks({resolve(s,c,n){return n(c.parentURL?.includes('/src/') && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s)?s+'.ts':s,c);}});
const previousDocument=globalThis.document;
globalThis.document={createElement:()=>Object.assign(createCanvas(1,1),{style:{}})};
try {
  const {buildStrokeScene}=await import('../src/strokeSceneBuilder.ts');
  const {composeVectorScenesInGrid}=await import('../src/pdfVectorExtractor.ts');
  const {createThreePdfObject}=await import('../src/threePdfObject.ts');
  const f=values=>Float32Array.from(values);
  const page=buildStrokeScene([{points:[[2,2],[8,8]],width:.25,color:'red'}]);
  page.pageRects=f([0,0,20,20]);page.pageBounds=page.bounds={minX:0,minY:0,maxX:20,maxY:20};
  const corners=[[10,2],[16,2],[16,6],[10,6]];
  Object.assign(page,{fillPathCount:1,fillSegmentCount:4,fillPathMetaA:f([0,4,10,2]),fillPathMetaB:f([16,6,0,0]),fillPathMetaC:f([1,0,1,.7]),
    fillSegmentsA:f(corners.flatMap(([x,y])=>[x,y,x,y])),fillSegmentsB:f(corners.flatMap((_,i)=>[...corners[(i+1)%4],0,0])),
    textInstanceCount:3,sourceTextCount:3,textInPageCount:3,textGlyphCount:1,textGlyphSegmentCount:4,
    textInstanceA:f([1,0,0,1,1,0,0,1,1,0,0,1]),textInstanceB:f([2,12,0,0,4,12,0,0,6,12,0,0]),textInstanceC:f([0,0,0,1,0,0,0,1,0,0,0,1]),
    textGlyphMetaA:f([0,4,0,0]),textGlyphMetaB:f([1,1,0,0]),
    textGlyphSegmentsA:f([0,0,0,0,1,0,1,0,1,1,1,1,0,1,0,1]),textGlyphSegmentsB:f([1,0,0,0,1,1,0,0,0,1,0,0,0,0,0,0]),
    pageTextRanges:Uint32Array.of(0,3),drawRuns:[{kind:'stroke',first:0,count:1},{kind:'fill',first:0,count:1},{kind:'text',first:0,count:3}]});
  // Cross the production threshold for coarse text without large glyph stores.
  const glyphCount=5000;
  page.textInstanceCount=page.sourceTextCount=page.textInPageCount=glyphCount;
  page.textInstanceA=new Float32Array(glyphCount*4);page.textInstanceB=new Float32Array(glyphCount*4);page.textInstanceC=new Float32Array(glyphCount*4);
  for(let i=0;i<glyphCount;i++) {
    page.textInstanceA.set([.1,0,0,.1],i*4);page.textInstanceB.set([2+i%100*.14,11+Math.floor(i/100)*.16,0,0],i*4);
    page.textInstanceC.set([0,0,0,1],i*4);
  }
  page.pageTextRanges=Uint32Array.of(0,glyphCount);page.drawRuns[2].count=glyphCount;
  page.clipPaths=[{parent:-1,fillRule:0,edges:f([0,0,20,0,20,0,20,20,20,20,0,20,0,20,0,0])}];
  page.drawRuns.forEach(run=>run.clipIndex=0);
  page.optionalContent={groups:[{id:'text',name:'Text',defaultVisible:true,locked:false,usedInView:true}],
    conditions:[{kind:'group',groupId:'text'}],order:[],radioGroups:[]};
  page.drawRuns[2].optionalContent=0;
  const source=composeVectorScenesInGrid(Array.from({length:12},()=>page),4),canonical=structuredClone(source);
  for(const backend of ['webgl','webgpu']) {
    let view={zoom:1,cameraCenterX:0,cameraCenterY:0},uploads=0,disposals=0;
    const native=new Proxy({getViewState:()=>view,getPresentedViewState:()=>view,setViewState:next=>view=next,
      getPresentedFrameSerial:()=>0,getSceneStats:()=>({}),setScene(){uploads++;return{};},dispose(){disposals++;},getRasterLayerUpdates:()=>new Map()},
      {get:(o,key)=>o[key]??(()=>{})});
    const pdf=await createThreePdfObject({scene:source,sourceKind:'hep',sourceLabel:'pages'},
      {rendererType:backend,vectorLod:'off',textLod:'off',threeColorCompositing:'display'},undefined,undefined,()=>native);
    const pages=await pdf.getPages();
    const scene=new THREE.Scene(),parent=new THREE.Group();parent.position.set(4,-3,0);parent.rotation.z=.05;parent.add(pdf);scene.add(parent);
    const viewport={width:1600,height:1000};
    const host={isWebGLRenderer:backend==='webgl',isWebGPURenderer:backend==='webgpu',outputColorSpace:THREE.LinearSRGBColorSpace,
      capabilities:{maxTextureSize:16384},backend:{device:{limits:{maxTextureDimension2D:16384}}},
      getDrawingBufferSize:v=>v.set(viewport.width,viewport.height),getPixelRatio:()=>1,
      domElement:{getBoundingClientRect:()=>({left:0,top:0,...viewport})}};
    let camera=new THREE.OrthographicCamera(-90,90,56.25,-56.25,.1,1000);camera.position.z=300;
    camera.coordinateSystem=backend==='webgpu'?THREE.WebGPUCoordinateSystem:THREE.WebGLCoordinateSystem;camera.updateProjectionMatrix();
    const frame=()=>{camera.updateMatrixWorld();scene.updateMatrixWorld(true);scene.onBeforeRender(host,scene,camera,null);};
    frame();
    assert.equal(pdf.getPageBatchingStats().mode,'document','pages in the loaded layout draw as the document itself');
    assert(pdf.materialPipelineActive && pdf.pageMesh.visible && !pdf.pageBatch.visible,'the document pipeline replaces page batches');
    assert(pages.every(p=>!p.materialPipelineActive && p.pageMesh.parent===null),'dormant pages keep depth rectangles out of the scene graph');
    pages[3].setVectorColorOverride(1,0,0,1);frame();
    assert.equal(pdf.getPageBatchingStats().reason,'page-appearance','a page-level appearance change leaves document drawing');
    pages[3].setVectorColorOverride(0,0,0,0);frame();
    assert.equal(pdf.getPageBatchingStats().mode,'document');
    const loaded=pages.map(p=>p.position.clone());
    pages[5].position.z=.001;frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-batched','any page movement uses page rendering');
    assert(!pdf.pageMesh.visible && pdf.pageBatch.visible);
    pages[5].position.copy(loaded[5]);frame();
    assert.equal(pdf.getPageBatchingStats().mode,'document','returning to the loaded layout restores document drawing');
    pdf.setSearchHighlights(pdf.searchText('page'),{currentIndex:0});frame();
    assert.equal(pdf.getPageBatchingStats().mode,'document','page overlays follow document drawing');
    pdf.setSearchHighlights(null);
    for(const [i,p] of pages.entries()) {p.rotation.set(.06*(i%3),-.04*(i%4),.02*(i%2));p.scale.set(i%2?-0.85:0.85,.9,1);p.position.z=i*.4;}
    frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-batched',JSON.stringify(pdf.getPageBatchingStats()));
    const batch=pdf.pageBatch,table=batch.pageTransforms;
    const meshes=()=>{const out=[];batch.traverseVisible(o=>{if(o.isMesh && (o.geometry.instanceCount??1)>0)out.push(o);});return out;};
    assert.equal(meshes().length,4,'12 transformed pages share one background, stroke, fill and text draw');
    assert(pages.every(p=>!p.pageMesh.visible && !p.materialPipelineActive),'independent content is dormant');
    assert.equal(pdf.pageMesh.visible,false);assert.equal(batch.pageMesh.visible,false);
    assert.equal(uploads,0,'material batching never uploads native geometry');
    const geometry=meshes().map(m=>m.geometry),ownerTextures=[...table.owned];
    for(const mesh of meshes()) {
      if(backend==='webgpu') {
        const shader=build(mesh.material,mesh.geometry);
        assert.match(shader.vertexShader,/heprPageProjection/);
        assert.match(shader.vertexShader,/heprPageClip/);
      } else {
        assert.match(mesh.material.vertexShader,/#define uLocalToClip heprPageProjection/);
        assert.equal(mesh.material.uniforms.uPageMatrices.value,table.matrices);
      }
    }
    const sourcePoint=new THREE.Vector3(...source.endpoints.slice(4,6),0);
    const cpu=sourcePoint.clone().applyMatrix4(pages[1].dataToLocalMatrix).applyMatrix4(pages[1].matrixWorld).project(camera);
    const delta=new THREE.Matrix4().fromArray(table.matrices.image.data,16);
    const gpu=sourcePoint.clone().applyMatrix4(delta).applyMatrix4(batch.clipFromDataMatrix);
    assert(cpu.distanceTo(gpu)<1e-6,'shared lookup matches the complete page/document/camera transform');
    const version=table.matrices.version,paramsVersion=table.parameters.version,ownersVersion=ownerTextures.map(t=>t.version);
    frame();assert.equal(table.matrices.version,version);assert.equal(table.parameters.version,paramsVersion);
    pages[1].position.x+=.25;frame();assert.equal(table.matrices.version,version+1);
    assert.deepEqual(meshes().map(m=>m.geometry),geometry,'moving a page retains draw geometries');
    assert.deepEqual(ownerTextures.map(t=>t.version),ownersVersion,'moving a page does not upload primitive ownership');
    const matrixVersion=table.matrices.version;camera.position.x+=1;frame();
    assert.equal(table.matrices.version,matrixVersion,'camera changes use the document projection uniform');
    parent.position.x+=.5; parent.rotation.y=.03;frame();
    assert.equal(table.matrices.version,matrixVersion,'ancestor transforms use the document projection uniform');
    const client=pdf.sceneToClientPoint(camera,source.endpoints[4],source.endpoints[5],host.domElement,1);
    const hit=await pdf.pick({camera,element:host.domElement,clientX:client.x,clientY:client.y,tolerancePx:2,kinds:['stroke']});
    assert.equal(hit?.primitive.index,1,'canonical picking follows the matrix table');
    pages[1].visible=false;frame();assert.equal(table.visibility[1],0);pages[1].visible=true;frame();assert.equal(table.visibility[1],1);
    pdf.setTextLodMode('auto');pages[2].scale.set(.05,.05,1);frame();
    const lod=pdf.getTextLodStats();
    assert(lod.coarseClusters>0 && lod.exactClusters>0,'pages select coarse and exact text independently: '+JSON.stringify(lod));
    assert.equal(pdf.getPageBatchingStats().mode,'pages-batched');
    const selected=batch.textLodLayer.runtime.selectedInstanceIds;
    const textOwners=batch.textMaterialLayer.mesh.material.uniforms?.uPageOwners?.value ?? [...table.owned].at(-1);
    assert([...selected].some(id=>id>=source.textInstanceCount && textOwners.image.data[id]===2),'coarse IDs retain their page owner');
    assert.equal(meshes().length,4,'coarse text retains cross-page paint batching');
    frame();assert.equal(batch.textLodLayer.runtime.selectedInstanceIds,selected,'unchanged page projections reuse LOD selection');
    pdf.setTextLodMode('off');pages[2].scale.set(.85,.9,1);frame();
    pages[3].setVectorColorOverride(1,0,0,1);frame();
    assert.equal(pdf.getPageBatchingStats().reason,'page-appearance');
    pages[3].setVectorColorOverride(0,0,0,0);frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-batched');
    host.capabilities.maxTextureSize=host.backend.device.limits.maxTextureDimension2D=8;frame();
    assert.equal(pdf.getPageBatchingStats().reason,'resource-capacity');
    host.capabilities.maxTextureSize=host.backend.device.limits.maxTextureDimension2D=16384;frame();
    await pdf.setLayerVisibility('text',false);frame();
    assert.equal(batch.textMaterialLayer.getRenderedTextInstanceCount(),0,'shared batches follow layer visibility');
    await pdf.setLayerVisibility('text',true);frame();
    assert(batch.textMaterialLayer.getRenderedTextInstanceCount()>0);
    const saved=pages[1].matrix.clone();
    pages[0].rotation.set(0,0,0);pages[0].scale.set(1,1,1);pages[0].position.z=0;
    pages[1].position.copy(pages[0].position);pages[1].rotation.set(0,0,0);pages[1].scale.set(1,1,1);pages[1].position.z=15;
    frame();assert.equal(pdf.getPageBatchingStats().mode,'pages-batched','opaque depth-separated pages stay batched');
    pages[1].position.z=0;frame();
    assert.equal(pdf.getPageBatchingStats().reason,'overlapping-page-paints','coplanar overlaps need page order');
    assert.equal(pdf.getPageOverlapMode(),'exact');
    pdf.setPageOverlapMode('fast');frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-batched','fast overlap mode keeps coplanar pages batched');
    assert(pdf.isPaintOrderApproximated(),'fast overlaps report approximate paint order');
    pdf.setPageOverlapMode('bogus');assert.equal(pdf.getPageOverlapMode(),'exact','unknown overlap modes are exact');
    pages[1].position.z=15;frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-batched');
    pdf.setSelection([{kind:'stroke',index:0},{kind:'stroke',index:1}]);frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-batched','interaction overlays retain content batching');
    assert(pages[0].renderOrder<pages[1].renderOrder,'overlays retain back-to-front page order');
    pdf.setSelection([]);
    pdf.setPageBackgroundColor(1,1,1,.5);frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-separate','translucent overlap needs ordered page rendering');
    pdf.setPageOverlapMode('fast');frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-separate','fast overlap mode keeps translucent page order');
    pdf.setPageOverlapMode('exact');
    assert.equal(batch.visible,false);assert(pages[0].materialPipelineActive);
    await pdf.setPageTransform(1,saved);pdf.setPageBackgroundColor(1,1,1,1);frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-batched','safe pages rejoin existing batches');
    camera=new THREE.PerspectiveCamera(32,viewport.width/viewport.height,.1,1000);
    camera.coordinateSystem=backend==='webgpu'?THREE.WebGPUCoordinateSystem:THREE.WebGLCoordinateSystem;
    camera.position.set(0,-25,300);camera.lookAt(0,0,0);camera.updateProjectionMatrix();frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-batched','tilted perspective camera supports page batches');
    const shear=new THREE.Matrix4().makeShear(.1,.05,.1,0,0,0);shear.setPosition(pages[4].position);
    await pdf.setPageTransform(4,shear);frame();
    assert.equal(pdf.getPageBatchingStats().mode,'pages-batched','explicit affine matrices retain batching');
    assert(pages[4].matrix.equals(shear));
    for(const [i,p] of pages.entries()) {p.matrixAutoUpdate=true;p.position.copy(loaded[i]);p.rotation.set(0,0,0);p.scale.set(1,1,1);}
    frame();assert.equal(pdf.getPageBatchingStats().mode,'document');
    pdf.setPrimitiveOverrides([{kind:'stroke',index:0}],{color:'yellow'});frame();
    assert.notEqual(pdf.getPageBatchingStats().mode,'document','colors applied after preparation reach only the pages');
    pdf.clearPrimitiveOverrides();
    let freed=0;table.matrices.addEventListener('dispose',()=>freed++);pdf.dispose();
    assert.equal(freed,1);assert.equal(disposals,1);
    assert.deepEqual(source,canonical);
    console.log(`${backend}: independent transforms, 12 pages in four draws, shader generation, reuse, picking, visibility and overlap fallback passed.`);
  }

  const {ScenePageViews}=await import('../src/scenePageViews.ts');
  const {ThreePageTransforms}=await import('../src/threePageTransforms.ts');
  const {ThreeMaterialRasterLayer}=await import('../src/threeMaterialRasterLayer.ts');
  const {ThreeMaterialGradientLayer}=await import('../src/threeMaterialGradientLayer.ts');
  const {updateThreePageBatchFrame}=await import('../src/threePageBatchFrame.ts');
  for(const meshGradient of [false,true]) {
    const auxiliary=structuredClone(page);
    Object.assign(auxiliary,{
      gradientCount:1,gradientMetaA:f([meshGradient?2:0,0,0,0]),gradientMetaB:f([1,0,0,1]),gradientMetaC:f([0,0,0,0]),
      gradientMetaD:f([20,0,0,0]),gradientMetaE:f([0,0,0,0]),gradientLut:new Uint8Array(4096).fill(255),
      gradientFillPathCount:1,gradientFillSegmentCount:4,gradientFillPathMetaA:page.fillPathMetaA.slice(),
      gradientFillPathMetaB:page.fillPathMetaB.slice(),gradientFillPathMetaC:f([0,0,0,1]),gradientFillPaintMeta:f([0,-1,0,0]),
      gradientFillSegmentsA:page.fillSegmentsA.slice(),gradientFillSegmentsB:page.fillSegmentsB.slice(),
      gradientStrokeRunCount:1,gradientStrokeSegmentCount:1,gradientStrokeRunMetaA:f([0,1,0,-1]),gradientStrokeRunMetaB:f([1,0,0,0]),
      gradientStrokeEndpoints:page.endpoints.slice(),gradientStrokePrimitiveMeta:page.primitiveMeta.slice(),
      gradientStrokePrimitiveBounds:page.primitiveBounds.slice(),gradientStrokeStyles:page.styles.slice(),
      rasterLayers:Array.from({length:4},(_,i)=>({width:2,height:1,data:new Uint8Array(8).fill(255),matrix:f([5,0,0,1,10,i+10]),pageIndex:0,paintOrder:i+2,opacity:1})),
      drawRuns:[...structuredClone(page.drawRuns),{kind:'gradient-fill',first:0,count:1,clipIndex:0},{kind:'gradient-stroke',first:0,count:1,clipIndex:0},
        {kind:'raster',first:0,count:4,clipIndex:0}]
    });
    if(meshGradient) Object.assign(auxiliary,{gradientMeshRanges:Uint32Array.of(0,3),gradientMeshIndices:Uint32Array.of(0,1,2),
      gradientMeshPositions:f([10,2,16,2,10,6]),gradientMeshColors:f([1,0,0,1,0,1,0,1,0,0,1,1])});
    const data=composeVectorScenesInGrid([auxiliary,auxiliary],2),partition=new ScenePageViews(data);
    for(const backend of ['webgl','webgpu']) {
      const table=new ThreePageTransforms(partition);
      const options={pageTransforms:table,materialBackend:backend,colorCompositing:'display',pageBackground:[1,1,1,1],
        vectorOverride:[0,0,0,0],strokeCurveEnabled:true};
      const raster=new ThreeMaterialRasterLayer(data,options),gradient=new ThreeMaterialGradientLayer(data,options);
      assert.equal(raster.stripEntries.length,2);
      for(const [i,entry] of raster.stripEntries.entries()) assert.deepEqual([...entry.mesh.geometry.getAttribute('aPageIndex').array],[i,i,i,i]);
      for(const entry of [...raster.entries,...gradient.entries]) {
        const material=entry.material;
        if(backend==='webgpu') assert.match(build(material,entry.mesh.geometry).vertexShader,/heprPageProjection/);
        else assert.equal(material.uniforms.uPageMatrices.value,table.matrices,'clipped material keeps the shared table');
      }
      const origins=Uint32Array.of(1,0,1),mapped=table.instances('stroke',{...data,segmentCount:3},origins);
      assert.deepEqual([...mapped.owners.image.data.slice(0,3)],[1,0,1],'stroke LOD uses canonical primitive ownership');
      const frames=Array.from({length:2},(_,i)=>{
        const view=partition.extract(i);
        return {...view,dataToDocument:new THREE.Matrix4(),dataToClip:new THREE.Matrix4().makeScale(.01,.01,1),visible:true,opaque:true};
      });
      frames.forEach((frame,i)=>frame.dataToClip.makeScale(.005,.005,1).setPosition(i*.11-frame.scene.pageBounds.minX*.005,0,0));
      assert.equal(updateThreePageBatchFrame(table,frames,{width:800,height:600}).reason,null,
        'closely spaced thumbnails stay batched when paint AA remains inside their backgrounds');
      frames[0].dataToClip.elements[14]=-.5;
      assert.equal(updateThreePageBatchFrame(table,frames,{width:800,height:600},0).reason,'unstable-projection','WebGPU near clipping uses zero');
      raster.dispose();gradient.dispose();table.dispose();
    }
  }
  {
    // Page layouts in 3D: opaque pages whose screen boxes and depth ranges
    // overlap still share batches wherever depth orders them exactly.
    const partition=new ScenePageViews(composeVectorScenesInGrid([page,page],2)),table=new ThreePageTransforms(partition);
    const viewport={width:800,height:600};
    const camera=new THREE.PerspectiveCamera(50,viewport.width/viewport.height,50,400);camera.position.z=100;camera.updateMatrixWorld();
    const views=[0,1].map(i=>partition.extract(i));
    const place=(model,{distance=100,paint,opaque=true}={})=>(view=>{
      const center=new THREE.Matrix4().makeTranslation(-(view.scene.pageBounds.minX+view.scene.pageBounds.maxX)/2,-(view.scene.pageBounds.minY+view.scene.pageBounds.maxY)/2,0);
      camera.position.z=distance;camera.updateMatrixWorld();
      const dataToDocument=model.clone().multiply(center);
      return {...view,paintBounds:paint?.(view.scene.pageBounds)??view.paintBounds,dataToDocument,opaque,visible:true,
        dataToClip:camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).multiply(dataToDocument)};
    });
    const layout=(a,b,options={},approximate=false)=>updateThreePageBatchFrame(table,[place(a,options)(views[0]),place(b,options)(views[1])],viewport,-1,approximate);
    const tilt=(angle,x=0,z=0)=>new THREE.Matrix4().makeRotationY(angle).setPosition(x,0,z);
    const normal=new THREE.Vector3(Math.sin(.6),0,Math.cos(.6));
    const behind=(offset,lateral)=>tilt(.6).setPosition(normal.clone().multiplyScalar(-offset).add(new THREE.Vector3(Math.cos(.6)*lateral,0,-Math.sin(.6)*lateral)));
    let result=layout(tilt(.6),behind(3,5));
    assert.deepEqual([result.reason,result.approximated],[null,false],'tilted stacked sheets are depth separated despite overlapping depth ranges');
    result=layout(tilt(.6),behind(0,5));
    assert.equal(result.reason,'overlapping-page-paints','coplanar overlapping sheets keep page order');
    result=layout(tilt(.6),behind(0,5),{},true);
    assert.deepEqual([result.reason,result.approximated],[null,true],'approximate overlaps batch coplanar sheets and report it');
    result=layout(tilt(.6),behind(3,5),{opaque:false},true);
    assert.equal(result.reason,'overlapping-page-paints','translucent overlaps always keep page order');
    result=layout(tilt(.7),tilt(-.7));
    assert.deepEqual([result.reason,result.approximated],[null,false],'steeply crossing sheets resolve by depth outside the crossing line');
    result=layout(tilt(0),tilt(.002));
    assert.equal(result.reason,'overlapping-page-paints','shallow crossings keep page order');
    const far=tilt(.6).setPosition(0,0,0);
    // A near plane just in front of distant content keeps their depth apart;
    // the sheets are further apart than a pixel of their depth slope.
    camera.near=19900;camera.far=20200;camera.updateProjectionMatrix();
    result=layout(far,behind(60,5),{distance:20000});
    assert.deepEqual([result.reason,result.approximated],[null,true],'thumbnail antialiasing may reach past a sheet, reported as approximate');
    camera.near=50;camera.far=400;camera.updateProjectionMatrix();
    const bleed=bounds=>({minX:bounds.minX-4,minY:bounds.minY,maxX:bounds.maxX,maxY:bounds.maxY});
    result=layout(tilt(.6),behind(3,5),{paint:bleed});
    assert.equal(result.reason,'overlapping-page-paints','paint outside an overlapping sheet keeps page order');
    result=layout(tilt(.6),behind(3,5),{paint:bleed},true);
    assert.deepEqual([result.reason,result.approximated],[null,true]);
    table.dispose();
  }
  const {ThreeVectorLodStrokeLayer}=await import('../src/vectorStrokeLod.ts');
  const {ThreeVectorDrawPlan}=await import('../src/threeVectorDrawPlan.ts');
  const densePage=structuredClone(page);
  densePage.segmentCount=densePage.sourceSegmentCount=densePage.mergedSegmentCount=400;
  densePage.drawRuns[0].count=400;
  for(const key of ['endpoints','primitiveMeta','primitiveBounds','styles']) {
    densePage[key]=new Float32Array(1600);
    for(let i=0;i<400;i++) densePage[key].set(page[key],i*4);
  }
  const dense=composeVectorScenesInGrid([densePage,densePage],2),partition=new ScenePageViews(dense);
  for(const backend of ['webgl','webgpu']) {
    const table=new ThreePageTransforms(partition),plan=new ThreeVectorDrawPlan(dense,table.runPages);
    const layer=new ThreeVectorLodStrokeLayer(dense,{pageTransforms:table,drawPlan:plan,materialBackend:backend,
      colorCompositing:'display',vectorOverride:[0,0,0,0],strokeCurveEnabled:true});
    const frame=units=>{
      layer.setLocalToClipTransform(new THREE.Matrix4().makeRotationY(.4),units);
      plan.update(units);layer.setVisible(true);layer.updateForLocalUnitsPerPixel(units);
      layer.updateFrame({cameraCenterX:20,cameraCenterY:10,zoom:1/units},{width:800,height:600},dense.bounds);
    };
    frame(10);assert(layer.getRenderedSegmentCount()>0 && layer.getRenderedSegmentCount()<dense.segmentCount);
    const texture=[...table.owned][0],drawn=[];
    layer.group.traverseVisible(mesh=>{
      if(!mesh.isMesh)return;
      const ids=mesh.geometry.getAttribute('aSegmentIndex');
      for(let i=0;i<mesh.geometry.instanceCount;i++) drawn.push(texture.image.data[ids.getX(i)]);
    });
    assert(drawn.includes(0) && drawn.includes(1),'simplified strokes retain both page owners');
    frame(.001);assert.equal(layer.getRenderedSegmentCount(),dense.segmentCount,'most magnified page tolerance can restore exact strokes');
    const projection=new THREE.Matrix4().makeScale(.01,.01,1),delta=new THREE.Matrix4();
    table.setPage(0,delta,projection,true,10);table.finishUpdate();const revision=table.revision;
    projection.elements[14]=.25;delta.elements[14]=25;table.setPage(0,delta,projection,true,10);table.finishUpdate();
    assert.equal(table.revision,revision,'depth-only motion does not invalidate text selection');
    layer.dispose();table.dispose();
  }
  console.log('Page table materials: clipped rasters/strips, axial and mesh gradients, gradient strokes, LOD owners, 3D overlap eligibility and near-plane fallback passed.');
} finally {hooks.deregister();globalThis.document=previousDocument;}
function build(material,geometry) {
  const renderer={contextNode:TSL.context({}),library:{fromMaterial:v=>v},getRenderTarget:()=>null,getMRT:()=>null,
    backend:{compatibilityMode:false,utils:{getTextureSampleData:()=>({primarySamples:1})},capabilities:{getUniformBufferLimit:()=>65536}},
    hasFeature:()=>false,hasCompatibility:()=>false,coordinateSystem:THREE.WebGPUCoordinateSystem,debug:{diagnostics:{keywords:false}}};
  const builder=new WGSLNodeBuilder(new THREE.Mesh(geometry,material),renderer);builder.scene=new THREE.Scene();builder.camera=new THREE.PerspectiveCamera();return builder.build();
}
