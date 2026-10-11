import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { buildType1Fixture, type1CharString as cs } from "./lib/type1Fixture.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks=registerHooks({resolve(specifier,context,next){return next(context.parentURL?.includes("/src/")&&/^\.\.?\//.test(specifier)&&!/\.[a-z0-9]+$/i.test(specifier)?specifier+".ts":specifier,context);}});
const points=[0,0,0,100/3,0,200/3,0,100,100/3,100,200/3,100,100,100,100,200/3,100,100/3,100,0,200/3,0,100/3,0];
const colors=[1,0,0,0,1,0,0,0,1,1,1,1];
const meshes=[
  {type:4,data:[0,0,0,1,0,0,0,100,0,0,1,0,0,0,100,0,0,1,2,100,100,1,1,1]},
  {type:5,data:[0,0,1,0,0,100,0,0,1,0,0,100,0,0,1,100,100,1,1,1]},
  {type:6,data:[0,...points,...colors]},
  {type:7,data:[0,...points,100/3,100/3,100/3,200/3,200/3,200/3,200/3,100/3,...colors]}
];
const dictionary = mesh => `<< /ShadingType ${mesh.type} /ColorSpace /DeviceRGB /BBox [0 0 100 100]
  /VerticesPerRow 2 /BitsPerCoordinate 3 /BitsPerComponent 3 /Decode [999 -999] /DataSource [${mesh.data.join(" ")}] >>`;
const axial = space => `<< /ShadingType 2 /ColorSpace ${space} /BBox [0 0 100 100] /Coords [0 0 100 0]
  /Function << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >> >>`;
try {
  const {executeNativeFontPostScript:execute}=await import("../src/pdf/nativeFontPostScript.ts");
  const {NativeFontPostScriptGlyphContext:Context}=await import("../src/pdf/nativeFontPostScriptGraphics.ts");
  const {NativePdfColorRegistry}=await import("../src/pdf/nativeColor.ts");
  const {NativePdfDocument}=await import("../src/pdf/nativeDocument.ts");
  const encoder=new TextEncoder();
  const run=(code,options={})=>{const context=new Context();execute(encoder.encode(code),undefined,{glyphContext:context,initialMatrix:[1,0,0,1,0,0],initialDictionary:new Map([["FontType",1]]),...options});return context;};
  for(const mesh of meshes){
    const context=run(dictionary(mesh)+" shfill"),stream=context.paintRecords[0].pattern.shading;
    assert.equal(stream.kind,"stream");assert.equal(stream.dictionary.get("BitsPerCoordinate"),32);assert.equal(stream.dictionary.get("BitsPerComponent"),16);
    assert.deepEqual(stream.dictionary.get("Decode"),[0,100,0,100,0,1,0,1,0,1]);
    assert(context.diagnostics.some(d=>d.code==="font.postscript-mesh-quantized"));
    assert.throws(()=>run(dictionary(mesh)+" shfill",{maxStringBytes:16}),e=>e.code==="resource-limit");
  }
  // Reused patch edges shorten both the geometry and color records.
  for(const type of [6,7])for(const flag of [1,2,3]){
    const base=meshes.find(x=>x.type===type),pointCount=type===6?8:12;
    const data=[...base.data,flag,...Array(pointCount).fill([100,100]).flat(),1,0,0,0,0,1];
    const stream=run(dictionary({type,data})+" shfill").paintRecords[0].pattern.shading;
    assert.equal(stream.bytes.length,(type===6?121:153)+1+pointCount*8+12);
  }
  for(const data of [[],[1,0,0,1,0,0],[0,0,0,1,0]])assert.throws(()=>run(dictionary({type:4,data})+" shfill"),e=>e.code==="unsupported-font");
  assert.throws(()=>run(dictionary(meshes[0])+" dup dup /DataSource get noaccess /DataSource exch put shfill"),e=>e.details?.postScriptError==="invalidaccess");
  const cie=axial("[/CIEBasedA << /WhitePoint [.95047 1 1.08883] /MatrixA [.95047 1 1.08883] >>]");
  const spot=axial("[/Separation /Ink /DeviceRGB {dup mul dup 1 exch sub 0}]");
  for (const shading of [dictionary(meshes[0]),spot]) {
    const loaded=execute(encoder.encode(`/P << /PatternType 2 /Shading ${shading} >> matrix makepattern def
      /Private << /OtherSubrs [{P setpattern 0 0 100 100 rectfill}] >> def`),undefined,{initialDictionary:new Map([["FontType",1]])});
    for(let glyph=0;glyph<2;glyph++){
      const context=new Context();loaded.createOtherSubrExecutor(undefined,context)(0,[]);
      assert.equal(context.paintRecords.length,1,"patterns instantiated during font loading survive glyph VM cloning");
      assert(context.diagnostics.some(d=>d.code=== (shading===spot?"font.postscript-shading-color-sampled":"font.postscript-mesh-quantized")),"deferred fidelity diagnostics are preserved");
    }
  }
  assert.throws(()=>run(spot+" shfill",{maxOperations:100}),e=>e.code==="resource-limit","sampling honors the owning VM budget");
  const cieContext=run(cie+" shfill"),spotContext=run(spot+" shfill");
  assert(cieContext.diagnostics.some(d=>d.code==="font.postscript-shading-color-sampled"));
  const stream=spotContext.paintRecords[0].pattern.shading;
  // Evaluate the retained tint function independently of rendering and verify
  // nonlinear source conversion follows interpolation of source components.
  const document=await NativePdfDocument.open({kind:"bytes",bytes:writeTinyPdf({objects:[{number:1,body:"<< /Type /Catalog /Pages 2 0 R >>"},{number:2,body:"<< /Type /Pages /Count 0 /Kids [] >>"}]})});
  const registry=new NativePdfColorRegistry(document),index=await registry.add(stream.get("ColorSpace"));
  const rgb=registry.convertToSrgb(index,[.5]);assert(Math.abs(rgb[0]-.25)<.001);assert(Math.abs(rgb[1]-.75)<.001);assert(rgb[2]<.001);
  const rangedSpace="[/CIEBasedA << /WhitePoint [.95047 1 1.08883] /RangeA [-1 1] /DecodeA {1 add 2 div} /MatrixA [.95047 1 1.08883] >>]";
  const ranged=axial(rangedSpace).replace("/C0 [0] /C1 [1]", "/C0 [-1] /C1 [1]");
  const rangedShading=run(ranged+" shfill").paintRecords[0].pattern.shading;
  assert.deepEqual(rangedShading.get("Function").get("C0"),[0]);
  assert.deepEqual(rangedShading.get("Function").get("C1"),[1]);
  const rangedIndex=await registry.add(rangedShading.get("ColorSpace"));
  const unitIndex=await registry.add(cieContext.paintRecords[0].pattern.shading.get("ColorSpace"));
  for(const t of [0,.125,.5,.875,1])assert(registry.convertToSrgb(rangedIndex,[t]).every((value,i)=>Math.abs(value-registry.convertToSrgb(unitIndex,[t])[i])<.0001));
  const rangedMesh=`<< /ShadingType 5 /BBox [0 0 100 100] /ColorSpace ${rangedSpace} /VerticesPerRow 2 /Background [-1] /DataSource [0 0 -1 100 0 1 0 100 -1 100 100 1] >>`;
  const meshDefinition=run(rangedMesh+" shfill").paintRecords[0].pattern.shading;
  assert.deepEqual(meshDefinition.dictionary.get("Decode"),[0,100,0,100,0,1]);
  assert.deepEqual(meshDefinition.dictionary.get("Background"),[0]);
  const encodedMesh=run(`<< /ShadingType 5 /BBox [0 0 100 100] /ColorSpace ${rangedSpace} /VerticesPerRow 2
    /BitsPerCoordinate 8 /BitsPerComponent 8 /Decode [0 100 0 100 -1 1] /DataSource <000000ff00ff00ff00ffffff> >> shfill`).paintRecords[0].pattern.shading;
  assert.deepEqual(encodedMesh.dictionary.get("Decode"),[0,100,0,100,0,1]);
  for(const fn of [
    "<< /FunctionType 0 /Domain [0 1] /Range [-1 1] /Size [2] /BitsPerSample 8 /DataSource <00ff> >>",
    "<< /FunctionType 3 /Domain [0 1] /Functions [<< /FunctionType 2 /Domain [0 1] /C0 [-1] /C1 [1] /N 1 >>] /Bounds [] /Encode [0 1] >>",
    "[<< /FunctionType 2 /Domain [0 1] /C0 [-1] /C1 [1] /Range [-.5 .5] /N 1 >>]"
  ]){
    const definition=ranged.replace(/<< \/FunctionType 2.*?\/N 1 >>/,fn);
    const normalized=run(definition+" shfill").paintRecords[0].pattern.shading;
    const {NativePdfFunctionRegistry}=await import("../src/pdf/nativeFunctions.ts");
    const functions=new NativePdfFunctionRegistry(document),index=await functions.add(Array.isArray(normalized.get("Function"))?normalized.get("Function")[0]:normalized.get("Function"));
    for(const t of [0,.5,1])assert(Math.abs(functions.evaluate(index,[t])[0]-(fn.startsWith("[")?Math.max(.25,Math.min(.75,t)):t))<.001);
  }
  assert.throws(()=>run(axial("[/Separation /None /DeviceRGB {pop 1 0 0}]")+" shfill"),e=>e.code==="unsupported-font");
  const pieces=[...meshes.map(dictionary),ranged,spot], marks=pieces.map((value,index)=>`gsave ${index*110} 0 translate ${value} shfill grestore`).join("\n");
  const font=buildType1Fixture({privateExtra:`/OtherSubrs [{} {} {} {} {${marks}}] def`,glyphs:[[".notdef",cs(0,700,"hsbw","endchar")],["A",cs(0,700,"hsbw",0,4,"callothersubr","endchar")]]});
  const pdf=writeTinyPdf({objects:[
    {number:1,body:"<< /Type /Catalog /Pages 2 0 R >>"},{number:2,body:"<< /Type /Pages /Count 1 /Kids [3 0 R] >>"},
    {number:3,body:"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 670 120] /Resources << /Font << /F 5 0 R >> >> /Contents 4 0 R >>"},
    {number:4,body:tinyPdfStream("","BT /F 1000 Tf 10 10 Td (A) Tj ET")},
    {number:5,body:"<< /Type /Font /Subtype /Type1 /BaseFont /FixtureType1 /FirstChar 65 /LastChar 65 /Widths [700] /Encoding << /Differences [65 /A] >> /FontDescriptor 6 0 R >>"},
    {number:6,body:"<< /Type /FontDescriptor /FontName /FixtureType1 /Flags 32 /FontBBox [0 0 700 120] /ItalicAngle 0 /Ascent 120 /Descent 0 /CapHeight 120 /StemV 10 /FontFile 7 0 R >>"},
    {number:7,body:tinyPdfStream(`/Length1 ${font.length1} /Length2 ${font.length2}`,font.bytes)}]});
  const {openPdf}=await import("../src/pdfSession.ts"),{renderHeprPageToCanvas2d}=await import("../src/heprCanvas2dRenderer.ts"),{buildHep}=await import("../src/hepBuilder.ts"),{loadSceneFromHep}=await import("../src/hepReader.ts");
  const session=await openPdf({kind:"bytes",bytes:pdf});let page;
  try{page=await session.compilePage(0,{optimization:"none"});assert(!session.getDiagnostics().some(d=>/othersubr-approximated|font-unavailable|font-substituted/.test(d.code)),JSON.stringify(session.getDiagnostics()));}finally{await session.close();}
  const rendered=await renderHeprPageToCanvas2d(page,{scale:1,background:[1,1,1,1],surfaceFactory:(w,h)=>{const canvas=createCanvas(w,h);return{canvas,context:canvas.getContext("2d")};}});
  const pixel=(x,y)=>[...rendered.surface.context.getImageData(x,120-y,1,1).data];
  assert(pixel(60,60)[0]<250,"triangle mesh is visible");assert(pixel(60+440,60)[0]>150,"CIE luminance is converted to display RGB");
  const spotPixel=pixel(60+550,60);assert(Math.abs(spotPixel[0]-64)<6&&Math.abs(spotPixel[1]-191)<6,"spot tint transform remains nonlinear");
  // Exercise an ordinary PDF shading resource path separately from font paints.
  const objects=[{number:1,body:"<< /Type /Catalog /Pages 2 0 R >>"},{number:2,body:"<< /Type /Pages /Count 1 /Kids [3 0 R] >>"}];
  let nextObject=5;
  const emit=value=>{
    if(Array.isArray(value))return "["+value.map(emit).join(" ")+"]";
    if(value instanceof Map)return "<< "+[...value].map(([k,v])=>"/"+k+" "+emit(v)).join(" ")+" >>";
    if(value?.kind==="name")return "/"+value.value;
    if(value?.kind==="string")return "<"+Buffer.from(value.bytes).toString("hex")+">";
    if(value?.kind==="stream"){const number=nextObject++;const dictionary=[...value.dictionary].map(([k,v])=>"/"+k+" "+emit(v)).join(" ");objects.push({number,body:tinyPdfStream(dictionary,value.bytes)});return number+" 0 R";}
    return String(value);
  };
  const references=pieces.map(value=>emit(run(value+" shfill").paintRecords[0].pattern.shading));
  objects.push({number:3,body:`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 670 120] /Resources << /Shading << ${references.map((ref,i)=>"/S"+i+" "+ref).join(" ")} >> >> /Contents 4 0 R >>`});
  objects.push({number:4,body:tinyPdfStream("","q 1 0 0 1 10 10 cm "+pieces.map((_,i)=>`q 1 0 0 1 ${i*110} 0 cm /S${i} sh Q`).join("\n")+" Q")});
  const referencePdf=writeTinyPdf({objects});
  const referenceSession=await openPdf({kind:"bytes",bytes:referencePdf});let referencePage;
  try{referencePage=await referenceSession.compilePage(0,{optimization:"none"});}finally{await referenceSession.close();}
  const expected=await renderHeprPageToCanvas2d(referencePage,{scale:1,background:[1,1,1,1],surfaceFactory:(w,h)=>{const canvas=createCanvas(w,h);return{canvas,context:canvas.getContext("2d")};}});
  const a=rendered.surface.context.getImageData(0,0,670,120).data,b=expected.surface.context.getImageData(0,0,670,120).data;
  assert(a.every((value,i)=>value===b[i]),"font shading must match ordinary PDF shading without pixel-array pretty-diff on failure");
  const oracle=spawnSync("gs",["--version"],{encoding:"utf8"});
  if(oracle.status===0){
    // Check both the transcode and the Canvas2D preview against the interpreter.
    const directory=await mkdtemp(join(tmpdir(),"hep-font-mesh-")),filename=join(directory,"reference.pdf");await writeFile(filename,referencePdf);
    const psFilename=join(directory,"reference.ps");await writeFile(psFilename,`<< /PageSize [670 120] >> setpagedevice 10 10 translate ${marks} showpage`);
    const args=["-q","-dBATCH","-dNOPAUSE","-sDEVICE=png16m","-r72","-sOutputFile=%stdout"];
    const ps=spawnSync("gs",[...args,psFilename],{timeout:10000,maxBuffer:5*1024*1024});
    const pdf=spawnSync("gs",[...args,filename],{timeout:10000,maxBuffer:5*1024*1024});
    for(const result of [ps,pdf])assert.equal(result.status,0,result.stderr.toString());
    const pixels=async bytes=>{const canvas=createCanvas(670,120),ctx=canvas.getContext("2d");ctx.drawImage(await loadImage(bytes),0,0);return ctx.getImageData(0,0,670,120).data;};
    const x=await pixels(ps.stdout),y=await pixels(pdf.stdout);
    for(let panel=0;panel<pieces.length;panel++){
      let sum=0;for(let row=20;row<100;row++)for(let col=20+panel*110;col<100+panel*110;col++){const i=(row*670+col)*4;for(let c=0;c<3;c++)sum+=Math.abs(x[i+c]-y[i+c]);}
      const delta=sum/(80*80*3*255);assert(delta<(panel===4?.02:.01),`PostScript-to-PDF mesh/color transcode panel ${panel} error ${delta}`);
      let previewSum=0;for(let row=20;row<100;row++)for(let col=20+panel*110;col<100+panel*110;col++){const i=(row*670+col)*4;for(let c=0;c<3;c++)previewSum+=Math.abs(x[i+c]-a[i+c]);}
      const previewDelta=previewSum/(80*80*3*255);assert(previewDelta<.02,`Canvas2D mesh/color panel ${panel} error ${previewDelta}`);
    }
  }
  const blob=await buildHep(pdf,{compression:"deflate",withTextLod:true,withVectorLod:true}),bytes=new Uint8Array(await blob.arrayBuffer()),scene=await loadSceneFromHep(bytes);
  assert.equal(scene.rasterLayers.length,0);assert(scene.gradientFillPathCount>0);
  console.log(`PostScript mesh/color passed: numeric types4–7, edge reuse, nonlinear CIE/spot sampling, GS visuals, limits/access and vector HEP ${bytes.length} bytes.`);
}finally{hooks.deregister();}
