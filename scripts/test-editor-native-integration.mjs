import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfFormAppearanceRegistry, decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { getScenePrimitive, getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const { scenePrimitiveCounts, PAGE_PRIMITIVE_KINDS } = await import("../src/scenePageViews.ts");
  const { editorTransformBounds, editorUnionBounds, editorPoint, multiplyEditorMatrices, invertEditorMatrix } = await import("../src/editorScene.ts");
  const { computeNativePdfPageGeometry } = await import("../src/pdf/nativePageGeometry.ts");
  const { computeNativePdfAnnotationPlacement } = await import("../src/pdf/nativeFormGeometry.ts");
  const { scanDensePdfResourceReferences } = await import("../src/pdf/nativeContentCompiler.ts");
  const { validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const compile = async bytes => { const parser = await openPdf({kind:"bytes",bytes}); try { return await parser.compileVectorPage(0,{optimization:"none"}); } finally { await parser.close(); } };
  const appearanceRefs = (scene,id) => (getSceneAnnotationRuns(scene).get(id) ?? []).flatMap(run => Array.from({length:run.count},(_,i)=>({kind:run.kind,index:run.first+i})));
  // Instance bounds can include unpainted glyph-box corners. Compare the
  // retained contours so source-preserving and rebuilt glyphs are comparable.
  const geometryBounds = (scene,refs,matrix=[1,0,0,1,0,0]) => {
    let bounds=null;
    for(const ref of refs){const primitive=getScenePrimitive(scene,ref);
      for(let i=0;i<primitive.segmentCount;i++){
        const segment=primitive.getSegment(i),style=primitive.getSegmentStyle(i),margin=(style.strokeWidth??0)/2*Math.hypot(matrix[0],matrix[1]);
        for(const point of [segment.start,segment.end,...(segment.control?[segment.control]:[])]){const[x,y]=editorPoint(matrix,point.x,point.y);bounds=editorUnionBounds(bounds,{minX:x-margin,minY:y-margin,maxX:x+margin,maxY:y+margin});}
      }
    }return bounds;
  };
  const appearanceBounds = (scene,id,matrix) => geometryBounds(scene,appearanceRefs(scene,id),matrix);
  const close = (actual,expected,message) => {
    assert(actual, message + ": appearance exists");
    for(const key of ["minX","minY","maxX","maxY"]) assert(Math.abs(actual[key]-expected[key])<.03,`${message}: ${key}: ${actual[key]} vs ${expected[key]}`);
  };
  for (const rotation of [0,90,180,270]) {
    const bytes = fixture(rotation), original = bytes.slice(), scene = await compile(bytes);
    const services = await createEditorAppServices({sourcePdf:bytes,loadFontAsset:async url=>new Uint8Array(await readFile(url))});
    const baseline = await openEditorSession(scene,services.sessionOptions), editor = await openEditorSession(scene,services.sessionOptions);
    try {
      const field = scene.annotations.find(annotation=>annotation.field?.name==="Text"), mark = scene.annotations.find(annotation=>annotation.subtype==="Square");
      assert(field); assert(mark); assert(appearanceRefs(scene,field.id).length>0);
      baseline.setFieldValue("Text","B");const filled=await baseline.getScene();
      editor.setFieldValue("Text","B");editor.selectPrimitives(appearanceRefs(scene,field.id));
      const delta=[.9,.2,-.1,1.1,12,-7];editor.transformSelection(delta);
      const preview=await editor.getScene();
      close(appearanceBounds(preview,field.id),appearanceBounds(filled,field.id,delta),`rotation ${rotation}: field value plus transform`);
      close(preview.annotations.find(annotation=>annotation.id===field.id).bounds,editorTransformBounds(field.bounds,delta),`rotation ${rotation}: field bounds`);
      const warnings=[],saved=new Uint8Array(await(await editor.savePdf({onWarning:message=>warnings.push(message)})).arrayBuffer()),reopened=await compile(saved);
      const reloadedField=reopened.annotations.find(annotation=>annotation.field?.name==="Text");
      assert.equal(reloadedField.field.value,"B");close(appearanceBounds(reopened,reloadedField.id),appearanceBounds(preview,field.id),`rotation ${rotation}: saved moved field appearance`);
      close(reloadedField.bounds,preview.annotations.find(annotation=>annotation.id===field.id).bounds,`rotation ${rotation}: saved field bounds`);
      const document=await NativePdfDocument.open({kind:"bytes",bytes:saved},{repair:"off"});
      try { assert.deepEqual(document.getPage(0).cropBox,[20,30,180,130]);assert.equal(document.getPage(0).rotation,rotation); }
      finally {await document.close();}
      const hep=await editor.saveHep({withVectorLod:false,withTextLod:false,encodeRasterImages:false}),hepScene=await loadSceneFromHep(await hep.arrayBuffer());
      close(appearanceBounds(hepScene,field.id),appearanceBounds(preview,field.id),`rotation ${rotation}: compact HEP field appearance`);
      // Original annotation deletion must not remove unrelated fields.
      editor.selectPrimitives(appearanceRefs(scene,mark.id));editor.deleteSelection();
      const deleted=await compile(new Uint8Array(await(await editor.savePdf()).arrayBuffer()));
      assert(!deleted.annotations.some(annotation=>annotation.subtype==="Square"));assert(deleted.annotations.some(annotation=>annotation.field?.name==="Text"));
      const shape=editor.addObject({kind:"shape",pageIndex:0,shape:"rectangle",x:5,y:5,width:20,height:10,color:"green",fill:"green",strokeWidth:2});
      const angle=Math.PI/9,c=Math.cos(angle),s=Math.sin(angle);editor.transformSelection([c,s,-s,c,10,5]);
      const ink=editor.addObject({kind:"ink",pageIndex:0,paths:[[[30,5],[40,15],[50,5]]],color:"blue",strokeWidth:2});
      editor.transformSelection([c,s,-s,c,5,10]);
      const marked=await compile(new Uint8Array(await(await editor.savePdf()).arrayBuffer()));
      for(const id of [shape,ink]){
        const object=editor.getObject(id),compiled=await services.sessionOptions.compileObject(object);
        const refs=[],counts=scenePrimitiveCounts(compiled);
        for(const kind of PAGE_PRIMITIVE_KINDS)for(let index=0;index<counts[kind];index++)refs.push({kind,index});
        const annotation=marked.annotations.find(annotation=>annotation.name===id);assert(annotation,`rotation ${rotation}: ${object.kind} metadata survives`);
        close(appearanceBounds(marked,annotation.id),geometryBounds(compiled,refs,object.transform),`rotation ${rotation}: rotated ${object.kind} appearance`);
      }
      assert.deepEqual(bytes,original,"incremental editor saves do not mutate source bytes");
    } finally {baseline.dispose();editor.dispose();services.dispose();}
  }
  {
    const bytes=fixture(90),scene=await compile(bytes),services=await createEditorAppServices({sourcePdf:bytes,loadFontAsset:async url=>new Uint8Array(await readFile(url))});
    const editor=await openEditorSession(scene,services.sessionOptions);
    try {
      const counts=scenePrimitiveCounts(scene);let sourceRef;
      for(const kind of PAGE_PRIMITIVE_KINDS)for(let index=0;index<counts[kind];index++){const ref={kind,index};if(!getScenePrimitive(scene,ref).annotationId&&kind==="fill"){sourceRef=ref;break;}}
      assert(sourceRef);editor.selectPrimitives([sourceRef]);editor.transformSelection([1,0,0,1,5,3]);
      editor.addObject({kind:"text",pageIndex:0,x:5,y:5,width:70,height:25,fontSize:8,text:"A Ω",runs:[{text:"A "},{text:"Ω",fontWeight:"bold",underline:true,color:"red"}]});
      const preview=await editor.getScene(),warnings=[],saved=await editor.savePdf({onWarning:warning=>warnings.push(warning)}),reopened=await compile(new Uint8Array(await saved.arrayBuffer()));
      assert(warnings.some(warning=>/rebuilt as vectors/.test(warning)));assert(reopened.annotations.some(annotation=>annotation.subtype==="FreeText"));
      assert(reopened.textIndex.pages[0].text.includes("Ω"));assert.equal(reopened.rasterLayers.length,0);
      validateVectorDrawRuns(preview);validateScenePaintGraph(preview);validateVectorDrawRuns(reopened);validateScenePaintGraph(reopened);
      // A copied original source object is a visible new object in native PDF saves.
      const cloneEditor=await openEditorSession(scene,services.sessionOptions);
      try {
        cloneEditor.selectPrimitives([sourceRef]);const ids=cloneEditor.cloneSelection([20,0]);assert(cloneEditor.getObject(ids[0]).isClone);
        const cloned=await compile(new Uint8Array(await(await cloneEditor.savePdf()).arrayBuffer()));
        assert(cloned.fillPathCount>scene.fillPathCount,"native PDF save retains cloned original content");
      }finally{cloneEditor.dispose();}
    }finally{editor.dispose();services.dispose();}
  }
  {
    const bytes=fixture(90,true),scene=await compile(bytes),services=await createEditorAppServices({sourcePdf:bytes,loadFontAsset:async url=>new Uint8Array(await readFile(url))});
    const editor=await openEditorSession(scene,services.sessionOptions);
    try{
      const field=scene.annotations.find(annotation=>annotation.field?.name==="Text");assert.equal(appearanceRefs(scene,field.id).length,0,"blank widgets can have no painted primitives");
      editor.selectAnnotations([field.id]);const delta=[1,0,0,1,8,6];editor.transformSelection(delta);
      assert.equal(editor.getSourceEdits().length,0);assert.equal(editor.getAnnotationEdits().length,1);
      let reopened=await compile(new Uint8Array(await(await editor.savePdf()).arrayBuffer()));
      close(reopened.annotations.find(annotation=>annotation.field?.name==="Text").bounds,editorTransformBounds(field.bounds,delta),"blank field native movement");
      editor.setFieldValue("Text","B");const preview=await editor.getScene();
      reopened=await compile(new Uint8Array(await(await editor.savePdf()).arrayBuffer()));
      close(appearanceBounds(reopened,reopened.annotations.find(annotation=>annotation.field?.name==="Text").id),appearanceBounds(preview,field.id),"blank field filled after movement");
      editor.selectAnnotations([field.id]);editor.deleteSelection();const deleted=new Uint8Array(await(await editor.savePdf()).arrayBuffer());
      const document=await NativePdfDocument.open({kind:"bytes",bytes:deleted},{repair:"off"});
      try{const registry=new NativePdfFormAppearanceRegistry(document);assert(!(await registry.listPageAnnotations(0)).some(annotation=>annotation.widget?.fullyQualifiedName==="Text"));assert.equal((await registry.getAcroFormMetadata()).fields.length,0,"deleted widgets are removed from the field tree");}
      finally{await document.close();}
    }finally{editor.dispose();services.dispose();}
  }
  {
    // HEP-only sources still save newly authored content as standard editable annotations.
    const scene=await compile(fixture(270)),editor=await openEditorSession(scene,{loadFontAsset:async url=>new Uint8Array(await readFile(url))});
    try{
      const text=editor.addObject({kind:"text",pageIndex:0,x:5,y:5,width:70,height:25,fontSize:8,text:"HEP Ω",color:"blue"});
      const shape=editor.addObject({kind:"shape",pageIndex:0,shape:"rectangle",x:10,y:45,width:15,height:10,color:"red",fill:"red",strokeWidth:2});
      const originalCount=scene.fillPathCount,base=await editor.getScene({includeObjects:false,preview:false});assert.equal(base.fillPathCount,originalCount);
      const saved=await editor.savePdf(),reopened=await compile(new Uint8Array(await saved.arrayBuffer()));
      assert(reopened.annotations.some(annotation=>annotation.name===text&&annotation.subtype==="FreeText"),"source-free PDFs preserve new editable text annotations");
      assert(reopened.annotations.some(annotation=>annotation.name===shape&&annotation.subtype==="Square"),"source-free PDFs preserve new editable shape annotations");
      assert(reopened.textIndex.pages[0].text.includes("HEP"));assert.equal(reopened.rasterLayers.length,0);
      const resumed=await openEditorSession(reopened);
      try{
        const next=resumed.addObject({kind:"shape",pageIndex:0,shape:"rectangle",x:30,y:45,width:10,height:10});
        assert(!reopened.annotations.some(annotation=>annotation.name===next),"reopening a saved PDF cannot reuse an existing annotation name");
        const[clone]=resumed.cloneSelection();assert.notEqual(clone,next);assert(!reopened.annotations.some(annotation=>annotation.name===clone));
      }finally{resumed.dispose();}
      const flattened=await compile(new Uint8Array(await(await editor.savePdf({flatten:true})).arrayBuffer()));assert.equal(flattened.annotations?.length??0,0);
    }finally{editor.dispose();}
  }
  {
    const bytes=fixture(90),scene=await compile(bytes),services=await createEditorAppServices({sourcePdf:bytes,loadFontAsset:async url=>new Uint8Array(await readFile(url))});
    const editor=await openEditorSession(scene,services.sessionOptions),paths=[Array.from({length:121},(_,index)=>{
      const t=index/120;return[20+80*t,15+140*t*(1-t)];
    })],matrix=[1.7,.35,.2,.75,8,5];
    try{
      const ink=editor.addObject({kind:"ink",pageIndex:0,paths,smoothing:.25,strokeWidth:2,color:"blue"});
      editor.transformSelection(matrix);const movedBounds=editor.getObjectBounds(ink);editor.undo();editor.redo();
      assert.deepEqual(editor.getObjectBounds(ink),movedBounds);assert.deepEqual(editor.getObject(ink).paths,paths,"smoothing retains the captured authoring points");
      const signature=editor.addObject({kind:"signature",pageIndex:0,paths,smoothing:.25,strokeWidth:1.5,color:"red"});
      const raw=editor.addObject({kind:"ink",pageIndex:0,paths,strokeWidth:.5,color:"green"});
      const largePaths=[Array.from({length:97},(_,index)=>{const t=index/96;return[20.123456789+80.345678901*t,15.1234567+140.234567*t*(1-t)];})];
      const large=editor.addObject({kind:"ink",pageIndex:0,paths:largePaths,smoothing:.25,strokeWidth:2,color:"blue"});
      editor.transformSelection([100000,35000,20000,75000,80,50]);
      const dotPaths=[[[61.125,42.75]]],dot=editor.addObject({kind:"signature",pageIndex:0,paths:dotPaths,smoothing:.25,strokeWidth:2});
      const compiled=await editor.getScene();
      assert(Array.from({length:compiled.segmentCount},(_,i)=>compiled.primitiveMeta[i*4+2]).some(kind=>kind>.5),"smoothed handwriting is ordinary quadratic scene geometry");
      validateVectorDrawRuns(compiled);validateScenePaintGraph(compiled);
      const saved=await NativePdfDocument.open({kind:"bytes",bytes:new Uint8Array(await(await editor.savePdf()).arrayBuffer())},{repair:"off"});
      try{
        const registry=new NativePdfFormAppearanceRegistry(saved),annotations=await registry.listPageAnnotations(0);
        for(const id of [ink,signature,raw,large,dot]){
          const annotation=annotations.find(item=>{const name=item.dictionary.get("NM");return name?.kind==="string"&&decodePdfString(name,0,item.annotationIndex)===id;});
          assert(annotation);assert.equal(annotation.subtype,"Ink");
          const inkList=await saved.resolveValue(annotation.dictionary.get("InkList"));assert.equal(inkList.length,1);
          if(id===raw)assert.equal(inkList[0].length,paths[0].length*2,"default ink preserves every captured InkList sample");
          else if(id===large)assert(inkList[0].length>largePaths[0].length*2,"large affine scales sample curves in PDF space instead of amplifying a local tolerance");
          else if(id===dot)assert([2,4].includes(inkList[0].length),"a single-point pen dot remains a valid InkList");
          else assert(inkList[0].length<paths[0].length*2,"InkList uses a bounded sampling of the fitted curve instead of every raw pointer sample");
          const appearance=await registry.resolveAnnotationAppearance(annotation);assert(appearance);
          const form=appearance.normalAppearance.form,content=await registry.decodeFormContent(form);
          const initial=multiplyEditorMatrices(computeNativePdfAnnotationPlacement(annotation,form,[1,0,0,1,0,0]).invocationMatrix,form.matrix);
          let transform=initial,point,cubics=0;const stack=[],segments=[],curves=[],lines=[];
          scanDensePdfResourceReferences(content,{onOperator(operator,operands){
            if(operator==="q")stack.push(transform);
            else if(operator==="Q")transform=stack.pop();
            else if(operator==="cm")transform=multiplyEditorMatrices(transform,operands);
            else if(operator==="m")point=editorPoint(transform,...operands);
            else if(operator==="l"){const end=editorPoint(transform,...operands);segments.push([point,end]);lines.push([point,end]);point=end;}
            else if(operator==="c"){
              cubics++;const start=point,c1=editorPoint(transform,operands[0],operands[1]),c2=editorPoint(transform,operands[2],operands[3]),end=editorPoint(transform,operands[4],operands[5]);
              curves.push([start,c1,c2,end]);
              for(let sample=1;sample<=128;sample++){const t=sample/128,u=1-t,next=[0,1].map(axis=>u*u*u*start[axis]+3*u*u*t*c1[axis]+3*u*t*t*c2[axis]+t*t*t*end[axis]);segments.push([point,next]);point=next;}
            }
          }});
          if(id===raw||id===dot)assert.equal(cubics,0,"raw polylines and pen dots do not require cubic segments");
          else assert(cubics>0,"the explicit appearance retains fitted curves as PDF cubic operators");
          const distance=(point,start,end)=>{const dx=end[0]-start[0],dy=end[1]-start[1],length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point[0]-start[0])*dx+(point[1]-start[1])*dy)/length)):0;
            return Math.hypot(point[0]-start[0]-t*dx,point[1]-start[1]-t*dy);};
          const curveDistance=(point,[start,c1,c2,end])=>{
            const at=t=>{const u=1-t;return[0,1].map(axis=>u*u*u*start[axis]+3*u*u*t*c1[axis]+3*u*t*t*c2[axis]+t*t*t*end[axis]);};
            const squared=t=>{const p=at(t);return(p[0]-point[0])**2+(p[1]-point[1])**2;};
            let best=0,error=Infinity;for(let i=0;i<=128;i++){const value=squared(i/128);if(value<error){best=i;error=value;}}
            let left=Math.max(0,(best-1)/128),right=Math.min(1,(best+1)/128);
            for(let i=0;i<48;i++){const a=(2*left+right)/3,b=(left+2*right)/3;if(squared(a)<squared(b))right=b;else left=a;}
            return Math.sqrt(Math.min(error,squared((left+right)/2)));
          };
          for(let i=0;i<inkList[0].length;i+=2){const point=inkList[0].slice(i,i+2),error=id===large?Math.min(...curves.map(curve=>curveDistance(point,curve)),...lines.map(([start,end])=>distance(point,start,end))):Math.min(...segments.map(([start,end])=>distance(point,start,end)));
            assert(error<(id === large ? .06 : .15),`InkList samples follow the visible transformed appearance (${id}: ${error})`);}
          if(id===large){
            const fallback=Array.from({length:inkList[0].length/2-1},(_,i)=>[inkList[0].slice(i*2,i*2+2),inkList[0].slice(i*2+2,i*2+4)]);
            for(const [start,c1,c2,end]of curves)for(let sample=0;sample<=128;sample++){
              const t=sample/128,u=1-t,point=[0,1].map(axis=>u*u*u*start[axis]+3*u*u*t*c1[axis]+3*u*t*t*c2[axis]+t*t*t*end[axis]);
              const error=Math.min(...fallback.map(([a,b])=>distance(point,a,b)));
              assert(error<.06,`the InkList polyline stays within 0.06 PDF units of the scaled visible curve (${error})`);
            }
          }
          const localToPdf=multiplyEditorMatrices(invertEditorMatrix(computeNativePdfPageGeometry(saved.getPage(0)).pageMatrix),editor.getObject(id).transform);
          if(id!==raw){
            const canonical=await services.sessionOptions.compileObject(editor.getObject(id)),box=canonical.pageRects;
            const expected=editorTransformBounds({minX:Math.min(box[0],box[2]),minY:Math.min(box[1],box[3]),maxX:Math.max(box[0],box[2]),maxY:Math.max(box[1],box[3])},localToPdf);
            assert.deepEqual(annotation.rectangle,[expected.minX,expected.minY,expected.maxX,expected.maxY],"smoothed annotation rectangles use the same canonical Float32 bounds as their appearance BBox");
          }
          const input=id===large?largePaths:id===dot?dotPaths:paths;
          for(const [index,point]of [[0,input[0][0]],[inkList[0].length-2,input[0].at(-1)]]){
            const expected=editorPoint(localToPdf,...(id===raw?point:point.map(Math.fround)));assert(Math.hypot(inkList[0][index]-expected[0],inkList[0][index+1]-expected[1])<1e-5,"canonical pen endpoints survive curve fitting and PDF coordinate transforms");
          }
        }
      }finally{await saved.close();}
      const hep=await editor.saveHep({withVectorLod:false,withTextLod:false,encodeRasterImages:false,compression:"store"}),reopened=await loadSceneFromHep(await hep.arrayBuffer());
      const quadratic=Array.from({length:reopened.segmentCount},(_,i)=>i).find(i=>reopened.primitiveMeta[i*4+2]>.5);assert.notEqual(quadratic,undefined);
      assert.equal(Buffer.from(await hep.arrayBuffer()).includes(Buffer.from('"smoothing"')),false,"HEP bakes ordinary curves without ink authoring metadata");
      const resumed=await openEditorSession(reopened);
      try{const original=[...reopened.endpoints.slice(quadratic*4,quadratic*4+4)];resumed.selectPrimitives([{kind:"stroke",index:quadratic}]);resumed.transformSelection([1,0,0,1,3,2]);
        const moved=await resumed.getScene();assert(Math.abs(moved.endpoints[quadratic*4]-original[0]-3)<1e-5);assert(Math.abs(moved.endpoints[quadratic*4+1]-original[1]-2)<1e-5);resumed.undo();assert.deepEqual([...((await resumed.getScene()).endpoints.slice(quadratic*4,quadratic*4+4))],original);
      }finally{resumed.dispose();}
    }finally{editor.dispose();services.dispose();}
  }
  console.log("Native editing integration: rotated/cropped forms, combined field transforms, annotations, HEP, rich text, content edits, clones and fitted ink passed.");
} finally {hooks.deregister();}

function fixture(rotation,blankField=false) {
  return writeTinyPdf({objects:[
    {number:1,body:"<< /Type /Catalog /Pages 2 0 R /AcroForm 10 0 R >>"},
    {number:2,body:"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"},
    {number:3,body:`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 160] /CropBox [20 30 180 130] /Rotate ${rotation} /Contents 4 0 R /Resources << /Font << /F 5 0 R >> >> /Annots [11 0 R 12 0 R] >>`},
    {number:4,body:tinyPdfStream("","1 0 0 rg 40 50 20 10 re f")},
    {number:5,body:"<< /Type /Font /Subtype /TrueType /BaseFont /Tiny /FirstChar 65 /LastChar 66 /Widths [600 700] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>"},
    {number:6,body:"<< /Type /FontDescriptor /FontName /Tiny /Flags 32 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>"},
    {number:7,body:tinyPdfStream("",buildTinySfnt())},
    {number:8,body:tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 20] /Resources << /Font << /F 5 0 R >> >>",blankField?"":"BT /F 10 Tf 2 5 Td (A) Tj ET")},
    {number:9,body:tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>","0 0 1 rg 0 0 20 20 re f")},
    {number:10,body:"<< /Fields [11 0 R] /NeedAppearances false /DR << /Font << /F 5 0 R >> >> /DA (/F 10 Tf 0 g) >>"},
    {number:11,body:`<< /Type /Annot /Subtype /Widget /FT /Tx /T (Text) /V (${blankField?"":"A"}) /Rect [70 70 110 90] /AP << /N 8 0 R >> >>`},
    {number:12,body:"<< /Type /Annot /Subtype /Square /Rect [130 50 150 70] /Contents (mark) /F 4 /AP << /N 9 0 R >> >>"}
  ]});
}
