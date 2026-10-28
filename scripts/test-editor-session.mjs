import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { bakeEditorSourceScene, composeEditorPage, compactEditorScene, getEditorAnnotationTransform } = await import("../src/editorScene.ts");
  const { compileEditorObjectGeometry } = await import("../src/editorSceneObjects.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { composeOverlappingVectorScenes } = await import("../src/pdfVectorExtractor.ts");
  const { validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const { validatePagePrimitiveRanges } = await import("../src/scenePageViews.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { createEmptyHeprPageData } = await import("../src/heprDocumentData.ts");
  const { createEditorSignatureLibrary, normalizeEditorSignature } = await import("../src/editorSignatures.ts");
  const identity = [1, 0, 0, 1, 0, 0];
  const scene = buildStrokeScene([{ points: [[10, 20], [60, 20]], width: 2, color: "red" }, { points: [[10, 70], [60, 70]], width: 2 }]);
  scene.pageRects = Float32Array.of(0, 0, 100, 100); scene.pageBounds = scene.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const original = structuredClone(scene), session = await openEditorSession(scene);
  assert.equal(await session.getScene(), scene, "opening an editor preserves the renderer's no-edit fast path");
  assert.equal(session.getState().dirty, false);
  assert.equal(session.getObjects().length, 0, "original objects and indexes are lazy");
  session.selectPrimitives([{ kind: "stroke", index: 0 }]);
  session.transaction("Drag", () => {
    session.transformSelection([1, 0, 0, 1, 5, 0]); session.transformSelection([1, 0, 0, 1, 5, 3]);
  });
  assert.deepEqual(session.getSelectionBounds(), { minX: 19, minY: 22, maxX: 71, maxY: 24 });
  const moved = await session.getScene();
  assert.deepEqual([...moved.endpoints.subarray(0, 4)], [20, 23, 60, 20]);
  assert.deepEqual([...moved.primitiveMeta.subarray(0, 2)], [70, 23]);
  assert.deepEqual(scene, original, "baking never edits canonical caller data");
  assert(session.undo()); assert.equal(await session.getScene(), scene, "a transaction is one undo step");
  assert.equal(session.getState().dirty, false); assert(session.redo());
  assert.equal(session.getSourceEdits().length, 1);
  session.selectArea({ minX: 15, minY: 15, maxX: 80, maxY: 30 }); assert.equal(session.getSelection().length, 1);
  const duplicates = session.cloneSelection([0, 20]); assert.equal(duplicates.length, 1);
  const duplicated = await session.getScene(); assert.equal(duplicated.segmentCount, 3);
  assert.equal(duplicated.pageCount, 1); validateVectorDrawRuns(duplicated); validatePagePrimitiveRanges(duplicated);
  session.deleteSelection(); assert.equal((await session.getScene()).segmentCount, 2); session.undo();
  session.selectPrimitives([{ kind: "stroke", index: 1 }]); session.deleteSelection();
  assert.equal((await session.getScene()).segmentCount, 2, "deletion compacts an original primitive while retaining a cloned object");
  session.undo();
  const beforeFailure = session.revision;
  assert.throws(() => session.transaction("Atomic", () => {
    session.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 1, y: 1, width: 10, height: 10 });
    session.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: NaN, y: 0, width: 1, height: 1 });
  }));
  assert.equal(session.revision, beforeFailure, "failed transactions do not enter history");
  const rectangle = session.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 5, y: 5, width: 20, height: 10, fill: "blue", color: "red", strokeWidth: 2 });
  const rectScene = await session.getScene(); assert(rectScene.fillPathCount > 0); assert.equal(rectScene.pageCount, 1);
  validateVectorDrawRuns(rectScene); validateScenePaintGraph(rectScene);
  const blob = await session.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false });
  const reopened = await loadSceneFromHep(await blob.arrayBuffer());
  assert.equal(reopened.fillPathCount, rectScene.fillPathCount); assert.equal(reopened.segmentCount, rectScene.segmentCount);
  assert.equal(reopened.pageCount, 1); assert.equal(session.getState().dirty, false);
  assert(!("editor" in reopened)); assert(!("sourcePdf" in reopened));
  session.select([rectangle, duplicates[0]]); const group = session.groupSelection(); assert(group);
  session.transformSelection([0, 1, -1, 0, 100, 0]); assert.equal(session.getSelection().length, 1);
  session.ungroupSelection(); assert.equal(session.getSelection().length, 2);
  assert.throws(() => session.transformSelection([0, 0, 0, 0, 0, 0]), /invertible/);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(session.getScene({ signal: aborted.signal }), { name: "AbortError" });
  session.dispose(); assert.throws(() => session.addObject({}), /disposed/);

  let previewCompiles=0;
  const previews=await openEditorSession(scene,{compileObject:async(object,signal)=>{previewCompiles++;return compileEditorObjectGeometry(object,signal);}});
  const previewId=previews.addObject({kind:"shape",pageIndex:0,shape:"rectangle",x:5,y:5,width:10,height:10,fill:"blue"});
  const committedPreview=await previews.getScene();previews.markSaved();const previewRevision=previews.revision;
  assert.equal((await previews.getScene({includeObjects:false,preview:false})).fillPathCount,0,"base-only snapshots exclude new objects");
  assert.equal(await previews.getScene(),committedPreview,"base-only snapshots do not replace the full-scene cache");
  previews.setPreviewTransform([1,0,0,1,10,20]);const firstPreview=await previews.getScene();
  assert.equal(previews.revision,previewRevision);assert.equal(previews.getState().dirty,false);assert.equal(previews.getState().previewing,true);
  assert.equal(firstPreview.fillPathMetaA[2],15);assert.equal(firstPreview.fillPathMetaA[3],25);
  previews.setPreviewTransform([1,0,0,1,20,30]);const secondPreview=await previews.getScene();
  assert.equal(secondPreview.fillPathMetaA[2],25);assert.equal(previewCompiles,1,"transform previews reuse compiled local geometry");
  const committedDuringPreview=await previews.getScene({preview:false});assert.equal(committedDuringPreview.fillPathMetaA[2],5);
  const previewHep=await previews.saveHep({withVectorLod:false,withTextLod:false,encodeRasterImages:false});
  const committedHep=await loadSceneFromHep(await previewHep.arrayBuffer());assert.equal(committedHep.fillPathMetaA[2],5,"uncommitted previews never enter saved files");
  previews.setPreviewTransform(null);assert.equal((await previews.getScene()).fillPathMetaA[2],5);
  previews.transformSelection([1,0,0,1,20,30]);assert.equal(previews.revision,previewRevision+1);assert.equal((await previews.getScene()).fillPathMetaA[2],25);
  previews.undo();assert.equal((await previews.getScene()).fillPathMetaA[2],5,"committing a preview creates one undo entry");
  previews.selectPrimitives([{kind:"stroke",index:0}]);previews.setPreviewTransform([1,0,0,1,8,0]);
  assert.equal((await previews.getScene()).endpoints[0],18);previews.setPreviewTransform(null);assert.equal((await previews.getScene()).endpoints[0],10);
  previews.dispose();
  const nested=await openEditorSession(scene),members=[];
  for(let i=0;i<3;i++)members.push(nested.addObject({kind:"shape",pageIndex:0,shape:"rectangle",x:i*20,y:0,width:10,height:10,fill:"red"}));
  nested.select(members.slice(0,2));const inner=nested.groupSelection();nested.select([inner,members[2]]);nested.groupSelection();nested.deleteSelection();
  assert.equal(nested.getObjects().length,0,"deleting nested groups leaves no dangling child groups");nested.undo();assert.equal((await nested.getScene()).fillPathCount,3);nested.dispose();

  const anisotropic = bakeEditorSourceScene(scene, [{ ref: { kind: "stroke", index: 0 }, transform: [2, 0, 0, 1, 0, 0], deleted: false }]);
  assert.equal(anisotropic.segmentCount, 1); assert.equal(anisotropic.fillPathCount, 1, "anisotropic pens stay vector through outline expansion");
  const outline = getScenePrimitive(anisotropic, { kind: "fill", index: 0 }); assert(Math.abs(outline.bounds.minX - 18) < 0.02); assert(Math.abs(outline.bounds.maxX - 122) < 0.02);
  assert.equal(anisotropic.drawRuns[0].kind, "fill", "replacement keeps the source paint position");
  validateVectorDrawRuns(anisotropic);
  const clipped = structuredClone(scene);
  clipped.textClipRects = undefined;
  clipped.clipPaths = [{ parent: -1, fillRule: 0, edges: Float32Array.of(0,0,80,0, 80,0,80,80, 80,80,0,80, 0,80,0,0) }];
  clipped.drawRuns = [{ kind: "stroke", first: 0, count: 2, clipIndex: 0 }];
  const rotated = bakeEditorSourceScene(clipped, [{ ref: { kind: "stroke", index: 0 }, transform: [0, 1, -1, 0, 100, 0], deleted: false }]);
  assert.equal(rotated.drawRuns.length, 2); assert.notEqual(rotated.drawRuns[0].clipIndex, rotated.drawRuns[1].clipIndex);
  assert.deepEqual([...rotated.clipPaths[rotated.drawRuns[1].clipIndex].edges], [...clipped.clipPaths[0].edges]);
  assert.deepEqual([...rotated.clipPaths[rotated.drawRuns[0].clipIndex].edges.subarray(0, 4)], [100,0,100,80]);

  // Shared glyph geometry remains shared while only the selected instance moves.
  const textScene = structuredClone(scene);
  Object.assign(textScene, { textInstanceCount: 2, textGlyphCount: 1, textGlyphSegmentCount: 3,
    textInstanceA: Float32Array.of(1,0,0,1, 1,0,0,1), textInstanceB: Float32Array.of(10,30,0,0, 30,30,0,0), textInstanceC: Float32Array.of(0,0,0,1, 0,0,0,1),
    textGlyphMetaA: Float32Array.of(0,3,0,0), textGlyphMetaB: Float32Array.of(5,8,0,0),
    textGlyphSegmentsA: Float32Array.of(0,0,0,0, 5,0,0,0, 0,8,0,0), textGlyphSegmentsB: Float32Array.of(5,0,0,0, 0,8,0,0, 0,0,0,0),
    pageTextRanges: Uint32Array.of(0,2), textIndex: { version: 2, pages: [{ text: "AA", charInstance: Int32Array.of(0,1), fallbackQuads: new Float32Array() }] } });
  const textMoved = bakeEditorSourceScene(textScene, [{ ref: { kind: "text", index: 0 }, transform: [1,0,0,1,4,5], deleted: false }]);
  assert.equal(textMoved.textGlyphSegmentsA, textScene.textGlyphSegmentsA); assert.equal(textMoved.textInstanceB[0], 14); assert.equal(textMoved.textInstanceB[4], 30);
  const textDeleted = bakeEditorSourceScene(textScene, [{ ref: { kind: "text", index: 0 }, transform: identity, deleted: true }]);
  assert.equal(textDeleted.textIndex.pages[0].text, "A"); assert.equal(textDeleted.textIndex.pages[0].charInstance[0], 0);

  const gradientScene = createEmptyVectorScene();
  Object.assign(gradientScene, { pageCount: 1, pageRects: Float32Array.of(0,0,100,100), pageTextRanges: Uint32Array.of(0,0),
    gradientCount: 1, gradientMetaA: Float32Array.of(0,0,0,0), gradientMetaB: Float32Array.of(1,0,0,1), gradientMetaC: new Float32Array(4),
    gradientMetaD: Float32Array.of(100,0,0,0), gradientMetaE: new Float32Array(4), gradientLut: new Uint8Array(4096),
    gradientFillPathCount: 2, gradientFillSegmentCount: 6,
    gradientFillPathMetaA: Float32Array.of(0,3,0,0, 3,3,20,0), gradientFillPathMetaB: Float32Array.of(10,10,1,0, 30,10,1,0),
    gradientFillPathMetaC: Float32Array.of(0,0,0,1, 0,0,0,1), gradientFillPaintMeta: Float32Array.of(0,-1,0,0, 0,-1,1,0),
    gradientFillSegmentsA: Float32Array.of(0,0,0,0, 10,0,0,0, 0,10,0,0, 20,0,0,0, 30,0,0,0, 20,10,0,0),
    gradientFillSegmentsB: Float32Array.of(10,0,0,0, 0,10,0,0, 0,0,0,0, 30,0,0,0, 20,10,0,0, 20,0,0,0),
    drawRuns: [{kind:"gradient-fill",first:0,count:2}] });
  const changedGradient = bakeEditorSourceScene(gradientScene,[{ref:{kind:"gradient-fill",index:0},transform:[2,0,0,1,10,0],deleted:false}]);
  assert.equal(changedGradient.gradientCount, 2); assert.equal(changedGradient.gradientFillPaintMeta[0],1); assert.equal(changedGradient.gradientFillPaintMeta[4],0);
  assert.equal(changedGradient.gradientMetaB[4],.5); assert.equal(changedGradient.gradientMetaC[4],-5);
  assert.equal(gradientScene.gradientCount,1,"a shared gradient is cloned only for the transformed paint");

  // A retained fallback's replay source follows its current displayed placement.
  const retainedScene = createEmptyVectorScene(), retainedPage = createEmptyHeprPageData({sourcePageIndex:0,width:100,height:100,rotation:0});
  retainedPage.displayProgram.groups[0].commands = [{kind:"draw",source:"images",first:0,count:0,transformIndex:0,clipIndex:-1,optionalContentIndex:-1,markedContentIndex:-1,sourceOffset:-1,sourceLength:-1,paintIndex:-1}];
  Object.assign(retainedScene,{pageCount:1,pageRects:Float32Array.of(0,0,100,100),pageTextRanges:Uint32Array.of(0,0),
    rasterLayers:[{width:1,height:1,data:Uint8Array.of(255,0,0,255),matrix:Float32Array.of(100,0,0,100,0,0),paintOrder:0,pageIndex:0},
      {width:1,height:1,data:Uint8Array.of(0,0,255,255),matrix:Float32Array.of(100,0,0,100,0,0),paintOrder:1,pageIndex:0}],
    retainedPages:[{page:retainedPage,matrix:Float32Array.from(identity),optionalContentConditions:new Int32Array()}],
    drawRuns:[{kind:"raster",first:0,count:1},{kind:"raster",first:1,count:1}],
    paintGraph:{roots:[{kind:"retained",retainedPage:0,firstCommand:0,count:1,rasterIndex:0},{kind:"retained",retainedPage:0,firstCommand:0,count:1,rasterIndex:1}]}});
  const retainedMoved=bakeEditorSourceScene(retainedScene,[{ref:{kind:"raster",index:0},transform:[1,0,0,1,12,4],deleted:false}]);
  assert.notEqual(retainedMoved.paintGraph.roots[0].retainedPage,retainedMoved.paintGraph.roots[1].retainedPage);
  assert.equal(retainedMoved.retainedPages[retainedMoved.paintGraph.roots[0].retainedPage].matrix[4],12);
  assert.equal(retainedMoved.retainedPages[retainedMoved.paintGraph.roots[1].retainedPage].matrix[4],0); assert.equal(retainedMoved.rasterLayers[0].matrix[4],12);
  assert.equal(retainedMoved.retainedPages[0].page,retainedPage,"retained program bytes remain shared");

  const annotationScene = structuredClone(scene);
  annotationScene.optionalContent={groups:[{id:"annotation:a",name:"Annotation",defaultVisible:true,locked:true,usedInView:false,annotationId:"a"}],conditions:[{kind:"group",groupId:"annotation:a"}],order:[],radioGroups:[]};
  annotationScene.drawRuns=[{kind:"stroke",first:0,count:2,optionalContent:0}];
  annotationScene.annotations=[{id:"a",sourcePageIndex:0,annotationIndex:0,subtype:"Ink",pdfGeometry:{rect:[0,0,50,50],inkList:[[0,0,50,50]]},bounds:{minX:10,minY:20,maxX:60,maxY:70},inkList:[[10,20,60,70]],flags:0,visibleInDefaultView:true,hasAppearance:true,pageIndex:0}];
  annotationScene.pdfPages=[{pageIndex:0,sourcePageIndex:0,pdfToScene:[1,0,0,1,10,20]}];
  const annotationSession=await openEditorSession(annotationScene);annotationSession.selectPrimitives([{kind:"stroke",index:0}]);
  assert.equal(annotationSession.getSelection()[0],"annotation:a");annotationSession.transformSelection([1,0,0,1,5,3]);
  const annotationMoved=await annotationSession.getScene();assert.deepEqual(annotationMoved.annotations[0].bounds,{minX:15,minY:23,maxX:65,maxY:73});
  assert.deepEqual(annotationMoved.annotations[0].pdfGeometry.rect,[5,3,55,53]);assert.deepEqual(annotationMoved.annotations[0].inkList,[[15,23,65,73]]);
  annotationSession.deleteSelection();assert.equal((await annotationSession.getScene()).annotations.length,0);annotationSession.dispose();

  const masked=structuredClone(scene);masked.drawRuns=[{kind:"stroke",first:0,count:1},{kind:"stroke",first:1,count:1}];
  masked.paintGraph={roots:[{kind:"group",alpha:1,isolated:true,knockout:false,blendMode:"Normal",children:[{kind:"draw",runIndex:0}],softMask:{subtype:"Alpha",children:[{kind:"draw",runIndex:1}]}}]};
  const maskSession=await openEditorSession(masked);maskSession.selectPrimitives([{kind:"stroke",index:0}]);maskSession.transformSelection([1,0,0,1,5,0]);
  assert.equal(maskSession.getSourceEdits().length,2,"atomic masked selections move mask and contents together");
  const maskMoved=await maskSession.getScene();validateScenePaintGraph(maskMoved);assert.equal(maskMoved.endpoints[0],15);assert.equal(maskMoved.endpoints[4],15);maskSession.dispose();

  const second = structuredClone(scene); second.pageRects = Float32Array.of(150,0,250,100);
  for (let i = 0; i < second.endpoints.length; i += 2) second.endpoints[i] += 150;
  for (let i = 0; i < second.primitiveMeta.length; i += 4) second.primitiveMeta[i] += 150;
  for (let i = 0; i < second.primitiveBounds.length; i += 2) second.primitiveBounds[i] += 150;
  second.bounds = second.pageBounds = { minX: 150, minY: 0, maxX: 250, maxY: 100 };
  const twoPages = composeOverlappingVectorScenes([scene, second]), multi = await openEditorSession(twoPages);
  multi.selectPrimitives([{kind:"stroke",index:0}]); multi.transformSelection([1,0,0,1,300,0]);
  const outside = await multi.getScene(); validatePagePrimitiveRanges(outside);
  assert.equal(outside.pagePrimitiveRanges[1], 2, "moving outside a page does not change page ownership");
  multi.addObject({ kind: "shape", pageIndex: 1, shape: "rectangle", x: 10, y: 10, width: 10, height: 10, fill: "red" });
  const pages = await multi.getScene(); assert.equal(pages.pageCount, 2); validatePagePrimitiveRanges(pages);
  assert(getScenePrimitive(pages, {kind:"fill",index:0}).bounds.minX >= 160);
  multi.dispose();

  const fields = structuredClone(scene); fields.annotations = [{ id:"field:1",sourcePageIndex:0,annotationIndex:0,subtype:"Widget",pdfGeometry:{rect:[0,0,10,10]},bounds:{minX:0,minY:0,maxX:10,maxY:10},flags:0,visibleInDefaultView:true,hasAppearance:false,pageIndex:0,field:{name:"Name",type:"Tx",flags:0,value:"Old"}}];
  let values;
  const form = await openEditorSession(fields, { compileFields: async (current, entries) => { values = entries; return current; } });
  form.setFieldValue("Name", "New"); await form.getScene(); assert.equal(values.get("Name"), "New"); assert.equal(fields.annotations[0].field.value, "Old");
  assert.throws(() => form.setFieldValue("Unknown", "x"), /Unknown/); form.undo(); assert.equal(form.getFieldValues().size, 0);
  form.selectAnnotations(["field:1"]);assert.deepEqual(form.getObjectBounds("annotation:field:1"),fields.annotations[0].bounds);
  const metadataDelta=[1,0,0,1,8,9];form.setPreviewTransform(metadataDelta);
  assert.deepEqual((await form.getScene()).annotations[0].bounds,{minX:8,minY:9,maxX:18,maxY:19});assert.equal(form.getAnnotationEdits().length,0);
  form.setPreviewTransform(null);form.transformSelection(metadataDelta);assert.equal(form.getSourceEdits().length,0);
  assert.deepEqual(form.getAnnotationEdits(),[{id:"field:1",transform:metadataDelta,deleted:false}]);
  assert.deepEqual(getEditorAnnotationTransform(await form.getScene(),"field:1"),metadataDelta);
  form.deleteSelection();assert.equal((await form.getScene()).annotations.length,0);form.undo();
  assert.deepEqual(form.getObjectBounds("annotation:field:1"),{minX:8,minY:9,maxX:18,maxY:19});form.dispose();

  const enriched=structuredClone(fields);Object.assign(enriched.annotations[0].field,{maxLength:20,options:[{value:"A",label:"Alpha"}],selectedIndices:[0],alignment:1,onValue:"Yes",appearanceState:"Off"});
  const compactForm=await openEditorSession(enriched),compactFormHep=await compactForm.saveHep({withVectorLod:false,withTextLod:false,encodeRasterImages:false});
  const compactMetadata=await loadSceneFromHep(await compactFormHep.arrayBuffer());
  assert.deepEqual(compactMetadata.annotations[0].field,{name:"Name",type:"Tx",flags:0,value:"Old"},"HEP never grows with additional editor-only form metadata");compactForm.dispose();
  const namedSource=structuredClone(fields);namedSource.annotations[0].name="editor:1";
  namedSource.annotations.push({...structuredClone(namedSource.annotations[0]),id:"old:2",name:"editor:2",annotationIndex:1});
  const names=await openEditorSession(namedSource),shapeInput={kind:"shape",pageIndex:0,shape:"rectangle",x:1,y:1,width:5,height:5};
  names.addObject({...shapeInput,id:"editor:3"});const generated=names.addObject(shapeInput);
  assert.equal(generated,"editor:4","generated IDs skip saved annotation names and current object IDs");
  assert.deepEqual(names.cloneSelection(),["editor:5"],"clones share the same collision-free ID allocator");
  assert.throws(()=>names.addObject({...shapeInput,id:"editor:1"}),/exists or is reserved/);names.dispose();

  let releaseSave,beginSave,laterObject;
  const saveGate=new Promise(resolve=>{releaseSave=resolve;}),saveStarted=new Promise(resolve=>{beginSave=resolve;});
  const concurrent=await openEditorSession(fields,{
    compileFields:async(current,entries)=>({...current,annotations:current.annotations.map(annotation=>annotation.field
      ?{...annotation,field:{...annotation.field,value:entries.get(annotation.field.name)??annotation.field.value}}:annotation)}),
    savePdf:async(compiledScene,owner)=>{
      beginSave();await saveGate;
      assert.equal(owner.getFieldValues().get("Name"),"A","PDF writer reads field values from the captured revision");
      assert.equal(owner.getObjects().filter(object=>object.kind==="shape").length,1);
      assert(!owner.getObjects().some(object=>object.id===laterObject));
      assert.equal(owner.getObjectBounds(exportedObject).minX,exportedBounds.minX);assert.equal(owner.getSelectionBounds().minX,exportedBounds.minX);
      assert.deepEqual(owner.getSelection(),[exportedObject]);
      assert.equal(owner.getSourceEdits().length,1);assert.equal(owner.getSourceEdits()[0].transform[4],4);
      assert.equal(owner.getAnnotationEdits().length,1);assert.equal(owner.getAnnotationEdits()[0].transform[4],2);
      assert.equal(owner.revision,exportedRevision);assert.equal(owner.getState().revision,exportedRevision);
      assert.equal(await owner.getScene(),compiledScene,"full export scene and metadata share one captured revision");
      const capturedBase=await owner.getScene({includeObjects:false});
      assert.equal(capturedBase.fillPathCount,0);assert.equal(capturedBase.endpoints[0],14);
      assert.equal(capturedBase.annotations[0].field.value,"A");assert.equal(capturedBase.annotations[0].bounds.minX,2);
      assert.throws(()=>owner.deleteSelection(),/read-only/);
      return new Blob([JSON.stringify({field:owner.getFieldValues().get("Name"),x:owner.getObjectBounds(exportedObject).minX,sourceX:compiledScene.endpoints[0]})],{type:"application/pdf"});
    }
  });
  const exportedObject=concurrent.addObject({...shapeInput,x:5,fill:"blue"});
  concurrent.selectPrimitives([{kind:"stroke",index:0}]);concurrent.transformSelection([1,0,0,1,4,0]);
  concurrent.selectAnnotations(["field:1"]);concurrent.transformSelection([1,0,0,1,2,0]);
  concurrent.setFieldValue("Name","A");concurrent.select([exportedObject]);const exportedRevision=concurrent.revision,exportedBounds=concurrent.getObjectBounds(exportedObject);
  const pendingSave=concurrent.savePdf();await saveStarted;
  concurrent.updateObject(exportedObject,{x:30});concurrent.undo();concurrent.updateObject(exportedObject,{x:40});
  concurrent.setFieldValue("Name","B");concurrent.selectPrimitives([{kind:"stroke",index:1}]);concurrent.transformSelection([1,0,0,1,0,9]);
  concurrent.selectAnnotations(["field:1"]);concurrent.transformSelection([1,0,0,1,3,0]);
  laterObject=concurrent.addObject({...shapeInput,x:60,fill:"red"});releaseSave();
  assert.deepEqual(JSON.parse(await(await pendingSave).text()),{field:"A",x:exportedBounds.minX,sourceX:14});
  assert.equal(concurrent.getFieldValues().get("Name"),"B");assert.equal(concurrent.getObject(exportedObject).x,40);
  assert.equal(concurrent.getState().dirty,true,"saving an older snapshot never marks later edits saved");concurrent.dispose();

  let releaseCompile,beginCompile,compileSignal,sharedCompiles=0;
  const compileGate=new Promise(resolve=>{releaseCompile=resolve;}),compileStarted=new Promise(resolve=>{beginCompile=resolve;});
  const sharing=await openEditorSession(scene,{compileObject:async(object,signal)=>{
    sharedCompiles++;compileSignal=signal;beginCompile();await compileGate;signal?.throwIfAborted();return compileEditorObjectGeometry(object,signal);
  }});
  sharing.addObject({...shapeInput,fill:"blue"});const canceledRender=new AbortController();
  const oldRender=sharing.getScene({signal:canceledRender.signal});await compileStarted;
  const newSave=sharing.getScene();canceledRender.abort();const canceledWait=assert.rejects(oldRender,{name:"AbortError"});releaseCompile();
  await canceledWait;assert.equal((await newSave).fillPathCount,1,"canceling a preview cannot abort a save sharing its object compile");
  assert.equal(sharedCompiles,1);assert.equal(compileSignal.aborted,false,"shared compilation belongs to the session lifetime");
  sharing.dispose();assert.equal(compileSignal.aborted,true);

  const paintedBounds=await openEditorSession(scene);
  const horizontal=paintedBounds.addObject({kind:"shape",pageIndex:0,shape:"line",x:10,y:20,width:30,height:0,strokeWidth:4});
  assert.deepEqual(paintedBounds.getObjectBounds(horizontal),{minX:8,minY:18,maxX:42,maxY:22},"horizontal line bounds include round-cap stroke coverage");
  const vertical=paintedBounds.addObject({kind:"shape",pageIndex:0,shape:"line",x:30,y:10,width:0,height:40,points:[[30,50],[30,10]],strokeWidth:4});
  assert.deepEqual(paintedBounds.getObjectBounds(vertical),{minX:28,minY:8,maxX:32,maxY:52});
  const arrow=paintedBounds.addObject({kind:"shape",pageIndex:0,shape:"arrow",x:0,y:0,width:20,height:0,points:[[20,0],[0,0]],strokeWidth:2});
  const arrowBounds=paintedBounds.getObjectBounds(arrow);assert.equal(arrowBounds.minX,-1);assert.equal(arrowBounds.maxX,21);
  assert(Math.abs(arrowBounds.minY+4)<1e-8&&Math.abs(arrowBounds.maxY-4)<1e-8,"arrowhead bounds include the entire filled triangle");
  const ink=paintedBounds.addObject({kind:"ink",pageIndex:0,paths:[[[10,20],[40,20]]],strokeWidth:4});
  assert.deepEqual(paintedBounds.getObjectBounds(ink),paintedBounds.getObjectBounds(horizontal),"line and ink round-cap extents agree");paintedBounds.dispose();

  const reporting=await openEditorSession(scene,{savePdf:async(_scene,_owner,options)=>{
    options.onProgress?.({value:0,stage:"pdf-page",sourceType:"scene"});
    options.onProgress?.({value:.5,stage:"pdf-page",sourceType:"scene",unit:"pages",processed:1,total:1});
    options.onProgress?.({value:1,stage:"complete",sourceType:"scene"});return new Blob(["export"],{type:"application/pdf"});
  }});
  reporting.addObject({...shapeInput,fill:"blue"});
  const monotonic=events=>{assert(events.length>=2);assert.equal(events.at(-1).value,1);assert.equal(events.at(-1).stage,"complete");
    assert(events.every((event,index)=>event.value>=0&&event.value<=1&&(!index||event.value>=events[index-1].value)));};
  const compilation=[];await reporting.getScene({onProgress:event=>compilation.push(event)});monotonic(compilation);
  assert(compilation.some(event=>event.stage==="compile"&&event.value>0&&event.value<1));
  const cachedProgress=[];await reporting.getScene({onProgress:event=>cachedProgress.push(event)});monotonic(cachedProgress);
  const pdfProgress=[];await reporting.savePdf({onProgress:event=>pdfProgress.push(event)});monotonic(pdfProgress);
  assert(pdfProgress.some(event=>event.stage==="compile"&&event.value<=.4));assert(pdfProgress.some(event=>event.stage==="pdf-page"&&event.value>.4&&event.value<1));
  assert(!pdfProgress.some(event=>event.stage==="complete"&&event.value<1),"compile completion is not reported as completion of the entire PDF save");
  const hepProgress=[];await reporting.saveHep({withVectorLod:false,withTextLod:false,encodeRasterImages:false,onProgress:event=>hepProgress.push(event)});monotonic(hepProgress);
  assert(hepProgress.some(event=>event.stage==="compile"&&event.value<=.3));assert(hepProgress.some(event=>event.stage==="hep-build"&&event.value>=.3));
  const canceledProgress=[],cancelCompile=new AbortController();
  await assert.rejects(reporting.getScene({signal:cancelCompile.signal,onProgress:event=>{canceledProgress.push(event);cancelCompile.abort();}}),{name:"AbortError"});
  assert(!canceledProgress.some(event=>event.value===1),"canceled compilation never reports completion");
  const cancelPdf=new AbortController(),canceledPdfProgress=[];
  await assert.rejects(reporting.savePdf({signal:cancelPdf.signal,onProgress:event=>{canceledPdfProgress.push(event);if(event.stage==="pdf-page")cancelPdf.abort();}}),{name:"AbortError"});
  assert(!canceledPdfProgress.some(event=>event.value===1),"canceled persistence never reports completion");reporting.dispose();

  const {createEditorInteractionController}=await import("../src/editorApi.ts");
  const gestures=await openEditorSession(scene),controls=await createEditorInteractionController(gestures);
  const firstGesture=gestures.addObject({...shapeInput,x:5,y:5,width:10,height:10,fill:"red"});
  const secondGesture=gestures.addObject({...shapeInput,x:35,y:5,width:10,height:10,fill:"blue"});
  controls.selectHit(firstGesture);controls.selectHit(secondGesture,{shiftKey:true});assert.deepEqual(gestures.getSelection(),[firstGesture,secondGesture]);
  controls.selectHit(firstGesture,{ctrlKey:true});assert.deepEqual(gestures.getSelection(),[secondGesture]);
  controls.selectHit(secondGesture,{metaKey:true});assert.deepEqual(gestures.getSelection(),[]);
  controls.selectHit(firstGesture);controls.selectHit(null,{shiftKey:true});assert.deepEqual(gestures.getSelection(),[firstGesture]);controls.selectHit(null);assert.deepEqual(gestures.getSelection(),[]);
  controls.selectArea({minX:5,minY:5,maxX:15,maxY:15});assert.deepEqual(gestures.getSelection(),[],"interaction marquee never selects partially contained painted bounds");
  controls.selectArea({minX:4,minY:4,maxX:16,maxY:16});assert.deepEqual(gestures.getSelection(),[firstGesture]);
  controls.selectArea({minX:34,minY:4,maxX:46,maxY:16},{shiftKey:true});assert.deepEqual(gestures.getSelection(),[firstGesture,secondGesture]);
  controls.selectHit(null);controls.selectHit(firstGesture);const gestureRevision=gestures.revision;
  controls.previewTransform([1,0,0,1,10,0]);assert.equal((await gestures.getScene()).fillPathMetaA[2],15);assert.equal(gestures.revision,gestureRevision);
  controls.cancelTransform();assert.equal((await gestures.getScene()).fillPathMetaA[2],5);
  controls.previewTransform([1,0,0,1,20,0]);controls.applyTransform();assert.equal((await gestures.getScene()).fillPathMetaA[2],25);assert.equal(gestures.revision,gestureRevision+1);
  gestures.undo();assert.equal((await gestures.getScene()).fillPathMetaA[2],5,"shared interaction commit is one undo step");
  controls.nudge(3,-2);assert.deepEqual(gestures.getObject(firstGesture).transform,[1,0,0,1,3,-2]);gestures.undo();
  controls.previewTransform([1,0,0,1,10,0]);gestures.select([secondGesture]);controls.applyTransform();
  assert.deepEqual(gestures.getObject(secondGesture).transform,[1,0,0,1,0,0],"stale previews cannot transform a different selection");
  controls.dispose();assert.throws(()=>controls.nudge(1,0),/disposed/);assert.equal((await gestures.getScene()).fillPathCount,2,"interaction disposal does not close its session");gestures.dispose();

  let saved = null;
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } }, library = createEditorSignatureLibrary(storage);
  for (let i = 0; i < 25; i++) library.save(normalizeEditorSignature([[10,20,30,40]], `Signature ${i}`, String(i)));
  assert.equal(library.list().length, 25); library.remove("0"); assert.equal(library.list().length, 24);
  const beforeQuota = saved, quota = createEditorSignatureLibrary({ getItem: () => saved, setItem: () => { throw new Error("quota"); } });
  assert.throws(() => quota.save(normalizeEditorSignature([[0,0,1,1]], "new", "new")), /quota/); assert.equal(saved, beforeQuota);
  saved = "{}"; assert.throws(() => library.list(), /could not be read/);
  assert.deepEqual(scene, original);
  console.log("Editor session, canonical transforms, immutable scenes, HEP baking, grouping, forms, and reusable signatures passed.");
} finally { hooks.deregister(); }
