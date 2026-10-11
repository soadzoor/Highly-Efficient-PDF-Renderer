import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { buildType1Fixture, type1CharString as cs } from "./lib/type1Fixture.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const width = 480, height = 280, scale = 3;
const surfaceFactory = (w, h) => { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext("2d") }; };
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { HEPR_GLYPH_FLAG } = await import("../src/heprDocumentData.ts");
  const { serializeNativeGlyphPostScriptPaints } = await import("../src/pdf/nativeFontPostScriptContent.ts");
  const { compileDensePdfContent } = await import("../src/pdf/nativeContentCompiler.ts");
  const empty = serializeNativeGlyphPostScriptPaints([{kind:"fill", commands:rectangle(0, 0, 10, 10),
    fillRule:0, color:null, clips:[{commands:[],fillRule:0}]}], 1);
  assert.equal(empty.bytes.length, 0, "an empty PostScript clip suppresses the complete paint");
  const precision = serializeNativeGlyphPostScriptPaints([{kind:"fill", commands:rectangle(1e-20, -1e-20, 1e20, 1e20),
    fillRule:0, color:[1,0,0,.5], clips:[]}], .4);
  assert(!/[\de][eE][+-]?\d/.test(new TextDecoder().decode(precision.bytes)), "serialized PDF numbers never contain exponents");
  assert.equal([...precision.extGStates.values()][0].fillAlpha, .2);
  const quadratic = serializeNativeGlyphPostScriptPaints([{kind:"fill", commands:[{kind:"move",x:0,y:0},
    {kind:"quadratic",controlX:30,controlY:30,x:60,y:0},{kind:"close"}], fillRule:1,color:null,clips:[]}],1);
  const quadraticCompiled = await compileDensePdfContent(quadratic.bytes,{pageMatrix:[1,0,0,1,0,0],
    pageBounds:{minX:0,minY:0,maxX:60,maxY:30},output:"display-program",type3PaintMode:"colored"});
  assert.equal(quadraticCompiled.paintRuns.length,3,"quadratic metadata lowers to a real retained path");

  const original = fixture(false), referencePdf = fixture(true);
  const compile = async (bytes,options={}) => {
    const session = await openPdf({kind:"bytes",bytes,label:"font-local-postscript.pdf"},options);
    try { return await session.compilePage(0,{optimization:"none"}); } finally { await session.close(); }
  };
  const page = await compile(original), reference = await compile(referencePdf);
  assert.equal(page.stores.glyphs.glyphIds.length, 8, "custom paints never invent searchable Type3 glyphs");
  assert.equal(page.displayProgram.programs.length, 1, "identical glyph-local paints reuse one program across PDF rendering modes");
  assert(!page.stores.glyphs.flags.some(flags=>flags&HEPR_GLYPH_FLAG.Type3), "ordinary Type1 glyph flags remain ordinary");
  assert(page.stores.fonts.outlinePathCounts.some(count=>count>0), "the final ordinary outline is retained beside explicit paints");
  const rendered = await renderHeprPageToCanvas2d(page,{scale,background:[1,1,1,1],surfaceFactory});
  const expected = await renderHeprPageToCanvas2d(reference,{scale,background:[1,1,1,1],surfaceFactory});
  const pixels = canvas => canvas.getContext("2d").getImageData(0,0,width*scale,height*scale).data;
  const retainedDifference = difference(pixels(rendered.surface.canvas),pixels(expected.surface.canvas));
  assert(retainedDifference < .015, `font-local paints differ from equivalent PDF paths by ${retainedDifference}`);
  const sample = (mode,x,y) => {
    const origin = cell(mode); return [...rendered.surface.context.getImageData(Math.floor((origin.x+x)*scale),
      Math.floor((height-origin.y-y)*scale),1,1).data];
  };
  assert.deepEqual(sample(0,0,5),[0,255,0,255],"explicit green fill is visible outside the final implicit outline");
  assert.deepEqual(sample(0,7,5),[255,0,0,255],"the ordinary implicit red glyph fill occurs after explicit green imaging");
  assert.deepEqual(sample(0,25,5),[255,0,0,255],"null PostScript color inherits PDF text nonstroking paint");
  assert.deepEqual(sample(1,25,5),[255,255,255,255],"stroke-only PDF text uses the character outline without explicit imaging");
  assert.deepEqual(sample(2,25,5),[255,0,0,255],"fill-stroke PDF text retains both explicit imaging and its ordinary outline stroke");
  assert.deepEqual(sample(3,25,5),[255,255,255,255],"invisible text executes no imaging");
  assert.deepEqual(sample(0,5,20),[0,0,255,255],"explicit clipping preserves the selected region");
  assert.deepEqual(sample(0,15,20),[255,255,255,255],"explicit clipping prevents paint escaping the selected region");
  assert.deepEqual(sample(4,0,5),[0,255,0,255],"text clipping excludes explicit marks from the final character clipping path");
  assert.deepEqual(sample(4,7,5),[0,255,255,255],"subsequent PDF paint is clipped by the ordinary character path");
  assert.deepEqual(sample(0,42.5,7.5),[255,0,0,255],"colorimage red pixel survives font-local imaging");
  assert.deepEqual(sample(0,47.5,7.5),[0,255,0,255],"colorimage green pixel survives font-local imaging");
  assert.deepEqual(sample(0,42.5,22.5),[255,0,0,255],"imagemask inherits the PDF glyph fill");
  assert.deepEqual(sample(0,47.5,22.5),[255,255,255,255],"imagemask clear bits remain unpainted");

  const artifactFlag = process.argv.indexOf("--artifacts"),extraResults=[];
  const artifactDirectory=artifactFlag<0?null:resolve(process.argv[artifactFlag+1]);
  if(artifactDirectory)await mkdir(artifactDirectory,{recursive:true});
  for(const options of [{final:"color"},{final:"clip"},{final:"empty"},{final:"color",noExplicit:true},
    {alpha:true},{form:true},{emptyOutline:true},{inheritStroke:true},{final:"stroke",fontPaint:true},
    {interpolate:true},{interpolate:true,imageAffine:true,imageClip:true},{imageMaskInterpolate:true}]){
    const openOptions=options.fontPaint?{embeddedFontPaint:"font"}:{};
    const actualPdf=fixture(false,options),actualPage=await compile(actualPdf,openOptions),expectedPage=await compile(fixture(true,options),openOptions);
    const actualRender=await renderHeprPageToCanvas2d(actualPage,{scale,background:[1,1,1,1],surfaceFactory});
    const expectedRender=await renderHeprPageToCanvas2d(expectedPage,{scale,background:[1,1,1,1],surfaceFactory});
    const delta=difference(pixels(actualRender.surface.canvas),pixels(expectedRender.surface.canvas));
    assert(delta<.015,`lasting glyph state/nested scope ${JSON.stringify(options)} differs from ordinary PDF paths by ${delta}`);
    if(options.interpolate&&!options.imageAffine){
      const origin=cell(0),pixel=[...actualRender.surface.context.getImageData(Math.floor((origin.x+44)*scale),Math.floor((height-origin.y-7.5)*scale),1,1).data];
      assert(pixel[0]>0&&pixel[0]<255&&pixel[1]>0&&pixel[1]<255,"interpolated pixels blend adjacent source samples");
    }
    const extra={options,difference:delta};
    if((options.final==="color"&&!options.noExplicit)||options.final==="empty"||options.fontPaint||options.interpolate||options.imageMaskInterpolate||options.alpha){
      const saved=await buildHep(actualPdf,{compression:"deflate",encodeRasterImages:false,withTextLod:true,withVectorLod:true,...openOptions});
      const savedBytes=new Uint8Array(await saved.arrayBuffer()),loaded=await loadSceneFromHep(savedBytes),canvas=renderScene(loaded);
      const savedArchive=await HepArchive.loadAsync(savedBytes);for(const entry of Object.values(savedArchive.files))await entry.async("uint8array");
      extra.hepDifference=difference(pixels(canvas),pixels(actualRender.surface.canvas));extra.hepBytes=savedBytes.length;
      assert(extra.hepDifference<.04,`lasting final state ${JSON.stringify(options)} survives HEP serialization: ${extra.hepDifference}`);
      assert.equal(loaded.rasterLayers?.length??0,options.noExplicit?0:options.imageMaskInterpolate?8:4,"only source font images become raster layers");
      assert(loaded.rasterLayers.every(layer=>layer.width===2&&layer.height===2),"retained images preserve their original sample dimensions");
      if(options.interpolate||options.imageMaskInterpolate)assert(loaded.rasterLayers.some(layer=>layer.interpolate===true),"saved HEP retains explicit interpolation");
      if(artifactDirectory){const label=options.interpolate?(options.imageAffine?"interpolated-affine-image":"interpolated-image"):options.imageMaskInterpolate?"interpolated-mask":options.alpha?"image-alpha":`final-${options.final}`;await Promise.all([
        writeFile(resolve(artifactDirectory,`${label}.pdf`),actualPdf),writeFile(resolve(artifactDirectory,`${label}-reference.pdf`),fixture(true,options)),writeFile(resolve(artifactDirectory,`${label}.hep`),savedBytes),
        writeFile(resolve(artifactDirectory,`${label}-retained.png`),actualRender.surface.canvas.toBuffer("image/png")),
        writeFile(resolve(artifactDirectory,`${label}-reference.png`),expectedRender.surface.canvas.toBuffer("image/png")),
        writeFile(resolve(artifactDirectory,`${label}-hep.png`),canvas.toBuffer("image/png"))]);}
    }
    extraResults.push(extra);
  }

  const diagnostics = [];
  const hep = await buildHep(original,{compression:"deflate",withVectorLod:true,withTextLod:true,
    encodeRasterImages:false,onDiagnostic:diagnostic=>diagnostics.push(diagnostic)});
  const bytes = new Uint8Array(await hep.arrayBuffer()), archive = await HepArchive.loadAsync(bytes);
  for (const entry of Object.values(archive.files)) await entry.async("uint8array");
  const scene = await loadSceneFromHep(bytes), reloaded = renderScene(scene);
  assert.equal(scene.rasterLayers?.length??0,4,"four fill-bearing invocations retain the source color image");
  assert(scene.rasterLayers.every(layer=>layer.width===2&&layer.height===2&&layer.interpolate===false),"HEP preserves nearest sampling and source dimensions");
  assert.equal(page.stores.images.widths.length,1,"the source image asset is shared across repeated glyph invocations");
  assert(scene.fillPathCount>0&&scene.textInstanceCount>0&&scene.segmentCount>0,
    "HEP stores explicit filled paints, ordinary glyph text, and real device hairlines");
  assert(!diagnostics.some(diagnostic=>/font.*(?:substitut|unavailable|unsupported|approximat)/.test(diagnostic.code)),
    `supported glyph imaging requires no font fallback: ${JSON.stringify(diagnostics)}`);
  const hepDifference = difference(pixels(reloaded),pixels(rendered.surface.canvas));
  assert(hepDifference<.04,`saved HEP geometry differs from retained rendering by ${hepDifference}`);
  if(artifactFlag>=0){
    const directory=resolve(process.argv[artifactFlag+1]);await mkdir(directory,{recursive:true});
    await Promise.all([writeFile(resolve(directory,"original.pdf"),original),writeFile(resolve(directory,"equivalent-paths.pdf"),referencePdf),
      writeFile(resolve(directory,"converted.hep"),bytes),writeFile(resolve(directory,"retained.png"),rendered.surface.canvas.toBuffer("image/png")),
      writeFile(resolve(directory,"equivalent-paths.png"),expected.surface.canvas.toBuffer("image/png")),
      writeFile(resolve(directory,"hep-reloaded.png"),reloaded.toBuffer("image/png")),
      writeFile(resolve(directory,"evidence.json"),JSON.stringify({hepBytes:bytes.length,archiveSections:Object.keys(archive.files).length,
        glyphs:8,programs:page.displayProgram.programs.length,retainedVsEquivalentPdf:retainedDifference,retainedVsHep:hepDifference,extraResults,diagnostics},null,2))]);
  }
  console.log(`Font PostScript PDF/display/HEP roundtrip passed: modes0–7, ordered explicit/implicit paints, inherited/explicit colors, clipping, affine hairlines, colorimage/imagemask; ${bytes.length} bytes, ${Object.keys(archive.files).length} CRC-verified sections.`);
} finally { hooks.deregister(); }

function imaging(options={}) { return `
  gsave newpath -100 0 moveto 100 0 lineto 100 100 lineto -100 100 lineto closepath 0 1 0 setrgbcolor fill grestore
  gsave newpath 200 0 moveto 300 0 lineto 300 100 lineto 200 100 lineto closepath fill grestore
  gsave newpath 0 150 moveto 100 150 lineto 100 250 lineto 0 250 lineto closepath clip
    newpath 0 150 moveto 300 150 lineto 300 250 lineto 0 250 lineto closepath 0 0 1 setrgbcolor fill grestore
  gsave newpath 0 0 moveto 300 0 lineto [1 .2 .4 1 0 300] concat 0 setlinewidth stroke grestore
  gsave 400 0 translate 100 100 scale ${options.imageAffine?"[1 .2 .3 1 0 0] concat":""}
    ${options.imageClip?"newpath 0 0 moveto .8 0 lineto .8 1 lineto 0 1 lineto closepath clip":""}
    ${options.interpolate?"/DeviceRGB setcolorspace << /ImageType 1 /Width 2 /Height 2 /BitsPerComponent 8 /ImageMatrix [2 0 0 -2 0 2] /Decode [0 1 0 1 0 1] /DataSource <ff000000ff000000ff000000> /Interpolate true >> image":"2 2 8 [2 0 0 -2 0 2] <ff000000ff000000ff000000> false 3 colorimage"} grestore
  gsave 400 150 translate 100 100 scale ${options.imageMaskInterpolate?"<< /ImageType 1 /Width 2 /Height 2 /BitsPerComponent 1 /ImageMatrix [2 0 0 -2 0 2] /Decode [1 0] /DataSource <8040> /Interpolate true >> imagemask":"2 2 true [2 0 0 -2 0 2] <8040> imagemask"} grestore
`; }
function fixture(reference,options={}) {
  const base = options.emptyOutline?[0,1000,"hsbw"]:[0,1000,"hsbw",50,0,"rmoveto",100,0,"rlineto",0,100,"rlineto",-100,0,"rlineto","closepath"];
  const finalCode=options.final==="color"?"0 0 1 setrgbcolor":options.final==="clip"?
    "newpath 50 0 moveto 100 0 lineto 100 100 lineto 50 100 lineto closepath clip "+
      "newpath 50 0 moveto 150 0 lineto 150 100 lineto 50 100 lineto closepath":options.final==="empty"?
      "newpath clip newpath 50 0 moveto 150 0 lineto 150 100 lineto 50 100 lineto closepath":options.final==="stroke"?"60 setlinewidth 2 setlinecap":"";
  const font = buildType1Fixture({...(options.fontPaint?{paintType:2,clearExtra:"/StrokeWidth 20 def"}:{}),
    privateExtra:reference?"":`/OtherSubrs [{} {} {} {} {${options.noExplicit?"":imaging(options)} `+
      `${options.inheritStroke?"gsave newpath 0 350 moveto 300 350 lineto stroke grestore":""} ${finalCode}}] def`,
    glyphs:[[".notdef",cs(0,1000,"hsbw","endchar")],["A",cs(...base,...(reference?[]:[0,4,"callothersubr"]),"endchar")]]});
  const content=[];
  for(let mode=0;mode<8;mode++){
    const {x,y}=cell(mode);content.push(`q ${options.alpha?"/A gs":""} 1 0 0 rg 0 0 0 RG `+
      `${options.inheritStroke?"15 w 2 J 1 j [40 20] 5 d":"1 w [] 0 d"}`);
    if(reference&&!options.noExplicit&&[0,2,4,6].includes(mode))content.push(`q .1 0 0 .1 ${x} ${y} cm `+
      "q 0 1 0 rg -100 0 200 100 re f Q 200 0 100 100 re f "+
      "q 0 150 100 100 re W n 0 0 1 rg 0 150 300 100 re f Q "+
      "q 0 0 m 300 0 l 1 .2 .4 1 0 300 cm 0 w 1 0 0 RG S Q "+
      `q 100 0 0 100 400 0 cm ${options.imageAffine?"1 .2 .3 1 0 0 cm":""} ${options.imageClip?"0 0 .8 1 re W n":""} /Im Do Q `+
      `${options.imageMaskInterpolate?"q 100 0 0 100 400 150 cm /Mask Do Q":"1 0 0 rg 400 200 50 50 re f 450 150 50 50 re f"} Q`);
    if(reference&&options.inheritStroke&&[0,2,4,6].includes(mode))content.push(`q .1 0 0 .1 ${x} ${y} cm 1 0 0 RG 0 350 m 300 350 l S Q`);
    let normalMode=mode;
    if(reference&&options.final&&[0,2,4,6].includes(mode)){
      if(options.final!=="empty")content.push(`q .1 0 0 .1 ${x} ${y} cm `+
        `${options.final==="color"?"0 0 1 rg 0 0 1 RG":options.final==="clip"?"50 0 50 100 re W n":""} `+
        `50 0 100 100 re ${options.fontPaint?`${options.final==="stroke"?"60 w 2 J":"20 w"} 1 0 0 RG S`:"f"} Q`);
      normalMode=mode===0?3:mode===2?1:mode===4?7:5;
    }
    content.push(`BT /F 100 Tf ${normalMode} Tr 1 0 0 1 ${x} ${y} Tm (A) Tj ET`);
    if(mode>=4)content.push("0 1 1 rg 0 0 480 280 re f");
    content.push("Q");
  }
  const images=reference?"/XObject << /Im 9 0 R /Mask 10 0 R >>":"";
  const graphics=options.alpha?"/ExtGState << /A << /ca .5 /CA .75 >> >>":"";
  return writeTinyPdf({objects:[
    {number:1,body:"<< /Type /Catalog /Pages 2 0 R >>"},
    {number:2,body:"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"},
    {number:3,body:`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F 5 0 R >> ${graphics} ${options.form?"/XObject << /Fm 8 0 R >>":images} >> /Contents 4 0 R >>`},
    {number:4,body:tinyPdfStream("",options.form?"/Fm Do":content.join("\n"))},
    {number:5,body:"<< /Type /Font /Subtype /Type1 /BaseFont /FixtureType1 /FirstChar 65 /LastChar 65 /Widths [1000] /Encoding << /Differences [65 /A] >> /FontDescriptor 6 0 R >>"},
    {number:6,body:"<< /Type /FontDescriptor /FontName /FixtureType1 /Flags 4 /FontBBox [-100 0 500 400] /ItalicAngle 0 /Ascent 400 /Descent 0 /CapHeight 400 /StemV 10 /FontFile 7 0 R >>"},
    {number:7,body:tinyPdfStream(`/Length1 ${font.length1} /Length2 ${font.length2} /Length3 ${font.length3}`,font.bytes)},
    ...(options.form?[{number:8,body:tinyPdfStream(`/Type /XObject /Subtype /Form /BBox [0 0 ${width} ${height}] /Resources << /Font << /F 5 0 R >> ${graphics} ${images} >>`,content.join("\n"))}]:[]),
    {number:9,body:tinyPdfStream(`/Type /XObject /Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Interpolate ${!!options.interpolate}`,
      Uint8Array.of(255,0,0,0,255,0,0,0,255,0,0,0))},
    {number:10,body:tinyPdfStream(`/Type /XObject /Subtype /Image /Width 2 /Height 2 /BitsPerComponent 1 /ImageMask true /Decode [1 0] /Interpolate ${!!options.imageMaskInterpolate}`,Uint8Array.of(0x80,0x40))}
  ]});
}
function cell(mode){return{x:30+(mode%4)*110,y:mode<4?200:80};}
function rectangle(x,y,w,h){return[{kind:"move",x,y},{kind:"line",x:x+w,y},{kind:"line",x:x+w,y:y+h},{kind:"line",x,y:y+h},{kind:"close"}];}
function difference(actual,expected){let delta=0,ink=0;for(let i=0;i<actual.length;i+=4)for(let c=0;c<3;c++){
  delta+=Math.abs(actual[i+c]-expected[i+c]);ink+=255-expected[i+c];}return delta/Math.max(1,ink);}

// Reads the real HEP geometry; it never calls Canvas fillText or substitutes
// fonts. Fixture paths are lines; all packed types still preserve quadratic
// segments, subpaths, colors, source ordering and persistent clipping.
function renderScene(scene){
  const canvas=createCanvas(width*scale,height*scale);let ctx=canvas.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(scale,0,0,-scale,0,height*scale);
  const color=(r,g,b,a)=>`rgba(${r*255},${g*255},${b*255},${a})`;
  const path=(a,b,first,count)=>{ctx.beginPath();let x=NaN,y=NaN;for(let i=first;i<first+count;i++){
    const o=i*4;if(a[o]!==x||a[o+1]!==y)ctx.moveTo(a[o],a[o+1]);
    if(b[o+2]>=.5)ctx.quadraticCurveTo(a[o+2],a[o+3],b[o],b[o+1]);else ctx.lineTo(b[o],b[o+1]);x=b[o];y=b[o+1];}};
  const drawRun=run=>{ctx.save();
    for(let index=run.clipIndex;index!==undefined&&index>=0;){const clip=scene.clipPaths[index];ctx.beginPath();let x=NaN,y=NaN;
      for(let o=0;o<clip.edges.length;o+=4){const e=clip.edges;if(e[o]!==x||e[o+1]!==y)ctx.moveTo(e[o],e[o+1]);ctx.lineTo(e[o+2],e[o+3]);x=e[o+2];y=e[o+3];}
      ctx.clip(clip.fillRule?"evenodd":"nonzero");index=clip.parent;}
    for(let i=run.first;i<run.first+run.count;i++){const o=i*4;
      if(run.kind==="fill"){const a=scene.fillPathMetaA,b=scene.fillPathMetaB,c=scene.fillPathMetaC;
        path(scene.fillSegmentsA,scene.fillSegmentsB,a[o],a[o+1]);ctx.fillStyle=color(b[o+2],b[o+3],c[o+2],c[o+3]);ctx.fill(c[o]?"evenodd":"nonzero");
      }else if(run.kind==="text"){const a=scene.textInstanceA,b=scene.textInstanceB,c=scene.textInstanceC;ctx.save();
        if(b[o+3]>0){const k=(b[o+3]-1)*4,r=scene.textClipRects;ctx.beginPath();ctx.rect(r[k],r[k+1],r[k+2]-r[k],r[k+3]-r[k+1]);ctx.clip();}
        ctx.transform(a[o],a[o+1],a[o+2],a[o+3],b[o],b[o+1]);const g=b[o+2]*4;
        path(scene.textGlyphSegmentsA,scene.textGlyphSegmentsB,scene.textGlyphMetaA[g],scene.textGlyphMetaA[g+1]);ctx.fillStyle=color(c[o],c[o+1],c[o+2],c[o+3]);ctx.fill();ctx.restore();
      }else if(run.kind==="stroke"){const packed=scene.primitiveMeta[o+3],flags=Math.trunc(packed/2);
        ctx.strokeStyle=color(scene.styles[o+1],scene.styles[o+2],scene.styles[o+3],packed-flags*2);
        ctx.lineWidth=scene.styles[o]===0?1/scale:scene.styles[o]*2;ctx.lineCap=flags&2?"round":"butt";ctx.setLineDash([]);
        path(scene.endpoints,scene.primitiveMeta,i,1);ctx.stroke();
      }else if(run.kind==="raster"){const layer=scene.rasterLayers[i],surface=createCanvas(layer.width,layer.height),image=surface.getContext("2d").createImageData(layer.width,layer.height);
        image.data.set(layer.data);surface.getContext("2d").putImageData(image,0,0);ctx.save();ctx.transform(...layer.matrix);
        ctx.imageSmoothingEnabled=layer.interpolate!==false;ctx.globalAlpha=layer.opacity??1;ctx.drawImage(surface,0,0,1,1);ctx.restore();
      }else throw new Error(`Unexpected HEP fixture draw kind ${run.kind}`);
    }ctx.restore();
  };
  const visit=nodes=>{for(const node of nodes){if(node.kind==="draw")drawRun(scene.drawRuns[node.runIndex]);else{
    assert(!node.softMask&&!node.knockout&&node.blendMode==="Normal","fixture graph uses ordinary source-over opacity");
    const parent=ctx,surface=createCanvas(width*scale,height*scale);ctx=surface.getContext("2d");ctx.setTransform(scale,0,0,-scale,0,height*scale);
    visit(node.children);ctx=parent;ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=node.alpha;ctx.drawImage(surface,0,0);ctx.restore();
  }}};
  if(scene.paintGraph)visit(scene.paintGraph.roots);else for(const run of scene.drawRuns)drawRun(run);
  return canvas;
}
