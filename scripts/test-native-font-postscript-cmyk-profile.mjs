import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { buildType1Fixture, type1CharString as cs } from "./lib/type1Fixture.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const profile = new Uint8Array(await readFile(new URL("./fixtures/icc/synthetic-cmyk.icc", import.meta.url)));
  const crd = `<< /ColorRenderingType 1 /WhitePoint [1 1 1] /TransformPQR [{5 1 roll pop pop pop pop} dup dup]
    /RenderTable [2 2 2 [<3366991A3366991A3366991A3366991A> <3366991A3366991A3366991A3366991A>] 4 {} {} {} {}] >> setcolorrendering
    [/CIEBasedABC << /WhitePoint [1 1 1] >>] setcolorspace .2 .4 .6 setcolor`;
  const font = buildType1Fixture({ privateExtra: `/OtherSubrs [{} {} {} {} { 10 dict begin ${crd}
    0 0 400 400 rectfill 30 setlinewidth 500 0 400 400 rectstroke
    gsave 500 500 translate 400 400 scale 2 1 true [2 0 0 -1 0 1] <80> imagemask grestore
    /p << /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 100 100] /XStep 100 /YStep 100
      /PaintProc {pop .2 .4 .6 ${26/255} setcmykcolor 0 0 100 100 rectfill} >> matrix makepattern def
    /u << /PatternType 1 /PaintType 2 /TilingType 1 /BBox [0 0 100 100] /XStep 100 /YStep 100
      /PaintProc {pop 0 0 100 100 rectfill} >> matrix makepattern def
    gsave p setpattern 0 1000 400 100 rectfill grestore
    gsave /DeviceCMYK setcolorspace .2 .4 .6 ${26/255} u setpattern 500 1000 400 100 rectfill grestore
    << /ShadingType 2 /ColorSpace [/CIEBasedA << /WhitePoint [1 1 1] >>] /Coords [1000 0 1100 0] /BBox [1000 0 1100 400]
      /Function << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >> /Extend [true true] >> shfill
    .4 .2 .6 .1 setcmykcolor end }] def`, glyphs: [[".notdef", cs(0,1000,"hsbw","endchar")],
      ["A", cs(0,1000,"hsbw",0,500,"rmoveto",400,0,"rlineto",0,400,"rlineto",-400,0,"rlineto","closepath",0,4,"callothersubr","endchar")]] });
  const fixture = (reference, calibrated = true, outputIntent = "") => writeTinyPdf({objects:[
    {number:1,body:`<< /Type /Catalog /Pages 2 0 R ${outputIntent ? `/OutputIntents [${outputIntent}]` : ""} >>`}, {number:2,body:"<< /Type /Pages /Count 1 /Kids [3 0 R] >>"},
    {number:3,body:`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 70 70] /Resources << /Font << /F 5 0 R >> ${calibrated ? "/ColorSpace << /DefaultCMYK [/ICCBased 8 0 R] >>" : ""} >> /Contents 4 0 R >>`},
    {number:4,body:tinyPdfStream("",reference ? `q .05 0 0 .05 10 10 cm .2 .4 .6 ${26/255} k .2 .4 .6 ${26/255} K 0 0 400 400 re f
      30 w 500 0 400 400 re S 500 500 200 400 re f 0 1000 400 100 re f 500 1000 400 100 re f 1000 0 100 400 re f .4 .2 .6 .1 k 0 500 400 400 re f Q` : "BT /F 50 Tf 10 10 Td (A) Tj ET")},
    {number:5,body:"<< /Type /Font /Subtype /Type1 /BaseFont /FixtureType1 /FirstChar 65 /LastChar 65 /Widths [1000] /Encoding << /Differences [65 /A] >> /FontDescriptor 6 0 R >>"},
    {number:6,body:"<< /Type /FontDescriptor /FontName /FixtureType1 /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 1000 /StemV 80 /FontFile 7 0 R >>"},
    {number:7,body:tinyPdfStream(`/Length1 ${font.length1} /Length2 ${font.length2}`,font.bytes)},
    {number:8,body:tinyPdfStream("/N 4 /Alternate /DeviceCMYK",profile)}
  ]});
  const compile = async bytes => {const session=await openPdf({kind:"bytes",bytes});try {return await session.compilePage(0,{optimization:"none"});} finally {await session.close();}};
  const render = page => renderHeprPageToCanvas2d(page,{scale:3,background:[1,1,1,1],surfaceFactory:(w,h)=>{const canvas=createCanvas(w,h);return {canvas,context:canvas.getContext("2d")};}});
  const pixels = result => result.surface.context.getImageData(0,0,210,210).data;
  const difference = (a,b) => {let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/(a.length*255);};
  const page=await compile(fixture(false)), expected=await compile(fixture(true));
  const actualPixels=pixels(await render(page)), expectedPixels=pixels(await render(expected));
  const delta=difference(actualPixels,expectedPixels);
  assert(delta < 1e-7, `CRD, patterns/shadings, explicit stroke/stencil and final CMYK fill must match profiled ordinary PDF paints: ${delta}`);
  const unprofiled=pixels(await render(await compile(fixture(false,false))));
  assert(difference(actualPixels,unprofiled)>.001,"the supplied profile actually changes visible output");
  const intent="<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (Synthetic) /DestOutputProfile 8 0 R >>";
  for(const reference of [false,true]){
    const profiled=pixels(await render(await compile(fixture(reference,false,intent))));
    assert(difference(profiled,actualPixels)<1e-7,"embedded output intent supplies CMYK calibration to fonts and ordinary PDF paints");
  }
  const ignored="<< /S /GTS_PDFX /DestOutputProfile 42 >>";
  assert(difference(pixels(await render(await compile(fixture(false,false,ignored)))),unprofiled)<1e-7,"unusable intent retains ordinary device rendering");
  assert(difference(pixels(await render(await compile(fixture(false,true,ignored)))),actualPixels)<1e-7,"explicit DefaultCMYK takes precedence over output intents");
  const retryIntent="<< /S /GTS_PDFX /DestOutputProfile << /N 4 >> >> "+intent;
  assert(difference(pixels(await render(await compile(fixture(false,false,retryIntent)))),actualPixels)<1e-7,"skip unusable candidates before a usable intent");
  const {NativePdfDocument}=await import("../src/pdf/nativeDocument.ts"),{NativePdfColorRegistry}=await import("../src/pdf/nativeColor.ts");
  const intentDocument=await NativePdfDocument.open({kind:"bytes",bytes:fixture(false,false,intent)}),diagnostics=[];
  const registry=new NativePdfColorRegistry(intentDocument,undefined,{onDiagnostic:value=>diagnostics.push(value)}),device={kind:"name",value:"DeviceCMYK"};
  const color=await registry.add(device);assert.equal(registry.describe(color).kind,"ICCBased");
  assert.equal(await registry.add(device),color);assert.equal(diagnostics.filter(value=>value.code==="color.output-intent-profile").length,1);
  const limited=new NativePdfColorRegistry(intentDocument,undefined,{maxIccProfileBytes:128});
  await assert.rejects(limited.add(device),error=>error.code==="resource-limit","output intents retain ICC byte limits");
  intentDocument.catalog.set("OutputIntents",42);
  const brokenDiagnostics=[],broken=new NativePdfColorRegistry(intentDocument,undefined,{onDiagnostic:value=>brokenDiagnostics.push(value)});
  assert.equal(broken.describe(await broken.add(device)).kind,"DeviceCMYK");assert(brokenDiagnostics.some(value=>value.code==="color.output-intent-ignored"));
  const blob=await buildHep(fixture(false,false,intent),{compression:"deflate",withTextLod:true,withVectorLod:true}), bytes=new Uint8Array(await blob.arrayBuffer());
  const scene=await loadSceneFromHep(bytes);assert.equal(scene.rasterLayers.length,0);assert(scene.fillPathCount>0);
  console.log(`PostScript CMYK profile passed: CRD/device paints, patterns/shadings, explicit strokes/stencils and final fill match ordinary DefaultCMYK PDF output; vector HEP ${bytes.length} bytes.`);
} finally {hooks.deregister();}
