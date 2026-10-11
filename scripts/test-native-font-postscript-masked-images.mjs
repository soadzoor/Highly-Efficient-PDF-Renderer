import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { buildType1Fixture, type1CharString as cs } from "./lib/type1Fixture.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

// Adobe PLRM3 4.10.6, tables4.22–4.25: explicit masks and raw color keys.
// https://www.adobe.com/jp/print/postscript/pdfs/PLRM.pdf
const hooks=registerHooks({resolve(specifier,context,next){return next(context.parentURL?.includes("/src/")&&/^\.\.?\//.test(specifier)&&!/\.[a-z0-9]+$/i.test(specifier)?specifier+".ts":specifier,context);}});
const encoder=new TextEncoder(), oracle=process.argv.includes("--ghostscript"), flag=process.argv.indexOf("--artifacts");
const artifactDirectory=flag<0?null:resolve(process.argv[flag+1]);
const rgb=[255,0,0,0,255,0,0,0,255,255,255,0],coverage=[255,0,255,0];
const cases=[];
for(const bits of [1,2,4,8,12]){
  const maximum=2**bits-1,colors=[0,maximum,Math.floor(maximum/2),maximum,0,Math.floor(maximum/3)],mask=[maximum,0,1,0,maximum,0];
  const packed=packRows(3,2,2,bits,mask.flatMap((m,i)=>[m,colors[i]]));
  cases.push({name:`sample-${bits}`,prefix:"/DeviceGray setcolorspace",code:type3(1,dict(3,2,bits,1,"source"),dict(3,2,bits,1,null,{decode:"[1 0]"})),
    source:packed,expectedColors:colors.flatMap(value=>{const gray=Math.round(value/maximum*255);return[gray,gray,gray,255];}),expectedMask:mask.map(value=>value?255:0),width:3,height:2});
}
cases.push({name:"sample-rgb",prefix:"/DeviceRGB setcolorspace",code:type3(1,dict(2,2,8,3,"source"),dict(2,2,8,1,null,{decode:"[1 0]"})),
  source:Uint8Array.from([255,...rgb.slice(0,3),0,...rgb.slice(3,6),1,...rgb.slice(6,9),0,...rgb.slice(9)]),expectedColors:rgba(rgb),expectedMask:coverage,width:2,height:2});
for(const [name,maskWidth,maskHeight,dataHeight,maskRows]of [["row-equal",2,2,2,[0x80,0x40]],["row-mask-taller",4,4,2,[0x80,0x40,0x20,0x10]],["row-data-taller",2,2,4,[0x80,0x40]]]){
  const data=Array.from({length:2*dataHeight*3},(_,i)=>rgb[i%rgb.length]),blocks=Math.min(maskHeight,dataHeight),bytes=[];
  for(let b=0;b<blocks;b++){bytes.push(...maskRows.slice(b*maskHeight/blocks,(b+1)*maskHeight/blocks));bytes.push(...data.slice(b*dataHeight/blocks*6,(b+1)*dataHeight/blocks*6));}
  cases.push({name,prefix:"/DeviceRGB setcolorspace",code:type3(2,dict(2,dataHeight,8,3,"source"),dict(maskWidth,maskHeight,1,1,null,{decode:"[1 0]"})),source:Uint8Array.from(bytes),expectedColors:rgba(data),
    expectedMask:maskRows.flatMap(row=>Array.from({length:maskWidth},(_,x)=>row&(128>>x)?255:0)),width:2,height:dataHeight,maskWidth,maskHeight});
}
cases.push({name:"separate-planar",prefix:`/DeviceRGB setcolorspace /state << /calls 20 array /n 0 >> def
  /record { state begin calls n 3 -1 roll put /n n 1 add def end } def
  /r <FF0000FFFF> /ReusableStreamDecode filter def /g <00FF00FFFF> /ReusableStreamDecode filter def /b <0000FF00FF> /ReusableStreamDecode filter def
  /m <8040FF> /ReusableStreamDecode filter def /one 1 string def /rbuf 2 string def /gbuf 2 string def /bbuf 2 string def`,
  code:type3(3,dict(2,2,8,3,"[{ 1 record r rbuf readstring pop } { 2 record g gbuf readstring pop } { 3 record b bbuf readstring pop }]",{multiple:true}),
    dict(2,2,1,1,"{ 4 record m one readstring pop }",{decode:"[1 0]"})),expectedColors:rgba(rgb),expectedMask:[255,0,0,255],width:2,height:2,
  suffix:"/calls state /calls get 0 state /n get getinterval def /sentinels [r read pop g read pop b read pop m read pop] def",calls:[4,4,1,2,3,1,2,3]});
cases.push({name:"separate-resolution",prefix:"/DeviceRGB setcolorspace",code:type3(3,dict(2,2,8,3,hex(rgb)),dict(4,4,1,1,"<80402010>",{decode:"[1 0]"})),expectedColors:rgba(rgb),expectedMask:Array.from({length:16},(_,i)=>i%5===0?255:0),width:2,height:2,maskWidth:4,maskHeight:4});
cases.push({name:"separate-interpolated-mask",prefix:"/DeviceRGB setcolorspace",code:type3(3,dict(4,2,8,3,hex([...rgb,...rgb])),dict(2,2,1,1,"<8040>",{decode:"[1 0]",interpolate:true})),expectedColors:rgba([...rgb,...rgb]),expectedMask:[255,0,0,255],width:4,height:2,maskWidth:2,maskHeight:2,maskInterpolate:true});
cases.push({name:"separate-matched-interpolation",prefix:"/DeviceRGB setcolorspace",code:type3(3,dict(2,2,8,3,hex(rgb),{interpolate:true}),dict(2,2,1,1,"<8040>",{decode:"[1 0]",interpolate:true})),expectedColors:rgba(rgb),expectedMask:[255,0,0,255],width:2,height:2,maskInterpolate:true});
for(const [name,colors,key,decode]of [["key-exact",[255,0,0,0,255,0,0,0,255,255,0,0],"[255 0 0]","[1 0 1 0 1 0]"],["key-range",[255,0,0,240,10,10,0,0,255,255,40,0],"[230 255 0 20 0 20]","[0 1 0 1 0 1]"]]){
  const reversed=decode==="[1 0 1 0 1 0]",expected=rgba(colors.map(value=>reversed?255-value:value));expected[3]=0;expected[7]=name==="key-range"?0:255;expected[15]=name==="key-exact"?0:255;
  cases.push({name,prefix:"/DeviceRGB setcolorspace",code:dict(2,2,8,3,"source",{type:4,extra:`/MaskColor ${key}`,decode})+" image",source:Uint8Array.from(colors),expectedColors:expected,width:2,height:2});
}
cases.push({name:"key-12",prefix:"/DeviceGray setcolorspace",code:dict(3,1,12,1,"source",{type:4,extra:"/MaskColor [2048]",decode:"[1 0]"})+" image",source:packRows(3,1,1,12,[0,2048,4095]),expectedColors:[255,255,255,255,127,127,127,0,0,0,0,255],width:3,height:1});

try{
  const {executeNativeFontPostScript}=await import("../src/pdf/nativeFontPostScript.ts");
  const {NativeFontPostScriptGlyphContext}=await import("../src/pdf/nativeFontPostScriptGraphics.ts");
  const {nativeGlyphPostScriptImageStream}=await import("../src/pdf/nativeFontPostScriptContent.ts");
  const evaluate=(code,options={},graphicsOptions={})=>{const context=new NativeFontPostScriptGlyphContext(graphicsOptions);const result=executeNativeFontPostScript(encoder.encode(code),undefined,
    {initialDictionary:new Map([["FontType",1]]),initialMatrix:[1,0,0,1,0,0],glyphContext:context,...options});return{context,result};};
  for(const fixture of cases){
    const source=fixture.source?`/source ${hex([...fixture.source,255])} /ReusableStreamDecode filter def`:"";
    const code=`${fixture.prefix} ${source} newpath 7 9 moveto ${fixture.code} /point [currentpoint] def ${fixture.source?"/nextByte source read pop def":""} ${fixture.suffix??""}`;
    const {context,result}=evaluate(code);assert.deepEqual(result.dictionary.get("point"),[7,9],fixture.name+" preserves current path");
    if(fixture.source)assert.equal(result.dictionary.get("nextByte"),255,fixture.name+" consumes exactly encoded rows");
    if(fixture.calls){assert.deepEqual(result.dictionary.get("calls"),fixture.calls);assert.deepEqual(result.dictionary.get("sentinels"),[255,255,255,255]);}
    assert.equal(context.paintRecords.length,1,fixture.name+" reuses one image asset");
    const image=context.paintRecords[0];assert.equal(image.kind,"image");assert.equal(image.width,fixture.width);assert.equal(image.height,fixture.height);
    assert.deepEqual([...image.rgba],fixture.expectedColors,fixture.name+" raw color/Decode");
    if(fixture.expectedMask){assert.deepEqual([...image.softMask.data],fixture.expectedMask,fixture.name+" mask polarity");assert.equal(image.softMask.width,fixture.maskWidth??fixture.width);assert.equal(image.softMask.height,fixture.maskHeight??fixture.height);}
    const stream=nativeGlyphPostScriptImageStream(image),smask=stream.dictionary.get("SMask");
    if(fixture.expectedMask){assert.equal(smask.dictionary.get("Width"),fixture.maskWidth??fixture.width);assert.equal(smask.dictionary.get("Interpolate"),fixture.maskInterpolate===true);assert.deepEqual([...smask.bytes],fixture.expectedMask);}
    const reduced=fixture.maskWidth&&fixture.maskWidth!==fixture.width||fixture.maskHeight&&fixture.maskHeight!==fixture.height||fixture.maskInterpolate;
    assert.equal(context.diagnostics.some(d=>d.code==="font.postscript-image-mask-resampled"),!!reduced,fixture.name+" honest edge diagnostic");
    if(oracle&&!fixture.calls){await compareGhostscript(fixture,image);}
  }
  const goodData=dict(2,2,8,3,"{ /calls calls 1 add def <FF000000FF000000FFFFFF00> }"),goodMask=dict(2,2,1,1,null,{decode:"[1 0]"});
  for(const [label,code]of [
    ["mask source prohibited",type3(1,goodData,dict(2,2,8,1,"<FFFF>",{decode:"[1 0]"}))],
    ["mask bits",type3(1,goodData,goodMask)],
    ["height ratio",type3(2,dict(2,3,8,3,"<00>"),goodMask)],
    ["mask matrix",type3(2,goodData,dict(2,2,1,1,null,{decode:"[1 0]",matrix:"[2 0 0 -2 1 2]"}))],
    ["mask multiple",type3(3,goodData,dict(2,2,1,1,"[<80>]",{decode:"[1 0]",multiple:true}))],
    ["key length",dict(2,2,8,3,"<00>",{type:4,extra:"/MaskColor [0 0]"})+" image"],
    ["key type",dict(2,2,8,3,"<00>",{type:4,extra:"/MaskColor [.5 0 0]"})+" image"],
    ["unknown type",dict(2,2,8,3,"<00>",{type:2})+" image"]]){
    const {context,result}=evaluate(`/DeviceRGB setcolorspace /calls 0 def { ${code} } stopped /failed exch def`);
    assert.equal(result.dictionary.get("failed"),true,label);assert.equal(result.dictionary.get("calls"),0,label+" validates before source calls");assert.equal(context.paintRecords.length,0,label);
  }
  assert.throws(()=>evaluate(`/DeviceRGB setcolorspace ${cases.find(x=>x.name==="separate-resolution").code}`,{maxStringBytes:15}),error=>error.code==="resource-limit");
  assert.throws(()=>evaluate(`/DeviceRGB setcolorspace ${cases.find(x=>x.name==="separate-resolution").code}`,{}, {maxImageBytes:31}),error=>error.code==="resource-limit");
  const controller=new AbortController();controller.abort();assert.throws(()=>evaluate("/DeviceGray setcolorspace",{signal:controller.signal}),error=>error.code==="aborted");
  const partial=evaluate(`/DeviceRGB setcolorspace ${type3(3,dict(2,2,8,3,hex(rgb)),dict(2,2,1,1,"<80> /ReusableStreamDecode filter",{decode:"[0 1]"}))}`).context;
  assert.deepEqual([...partial.paintRecords[0].softMask.data],[0,255,0,0],"missing explicit mask rows stay transparent under reversed polarity");
  assert(partial.diagnostics.some(d=>d.code==="font.postscript-image-truncated"));
  await roundtrip(cases.filter(x=>["sample-rgb","row-equal","separate-resolution","separate-interpolated-mask","separate-matched-interpolation","key-exact"].includes(x.name)));
  console.log(`Font PostScript masked images passed: ${cases.length} sampling/masking cases, validation, cursor/order, limits/cancellation, PDF/display/HEP roundtrips${oracle?", Ghostscript image oracle":""}.`);

  async function roundtrip(fixtures){
    const {openPdf}=await import("../src/pdfSession.ts"),{renderHeprPageToCanvas2d}=await import("../src/heprCanvas2dRenderer.ts"),{buildHep}=await import("../src/hepBuilder.ts"),{loadSceneFromHep}=await import("../src/hepReader.ts"),{HepArchive}=await import("../src/hepContainer.ts");
    const scale=3,width=300,height=100,surfaceFactory=(w,h)=>{const canvas=createCanvas(w,h);return{canvas,context:canvas.getContext("2d")};};
    if(artifactDirectory)await mkdir(artifactDirectory,{recursive:true});
    const evidence=[];
    for(const fixture of fixtures){
      const body=`gsave 10 dict begin ${fixture.prefix} 100 100 scale ${fixture.source?`/source ${hex(fixture.source)} /ReusableStreamDecode filter def`:""} ${fixture.code} end grestore`;
      const font=buildType1Fixture({privateExtra:`/OtherSubrs [{} {} {} {} {${body}}] def`,glyphs:[[".notdef",cs(0,1000,"hsbw","endchar")],["A",cs(0,1000,"hsbw",0,4,"callothersubr","endchar")]]});
      const pdf=fontPdf(font.bytes,width,height),context=evaluate(fixture.prefix+" "+(fixture.source?`/source ${hex(fixture.source)} /ReusableStreamDecode filter def`:"")+" "+fixture.code).context;
      const reference=imagePdf(context.paintRecords[0],width,height),diagnostics=[];
      const compile=async bytes=>{const s=await openPdf({kind:"bytes",bytes,label:fixture.name});try{const result=await s.compilePage(0,{optimization:"none"});diagnostics.push(...s.getDiagnostics());return result;}finally{await s.close();}};
      const page=await compile(pdf);const expected=await compile(reference);
      const rendered=await renderHeprPageToCanvas2d(page,{scale,background:[1,1,1,1],surfaceFactory});const referenceRender=await renderHeprPageToCanvas2d(expected,{scale,background:[1,1,1,1],surfaceFactory});
      const pixels=canvas=>canvas.getContext("2d").getImageData(0,0,width*scale,height*scale).data;
      const nativePixels=pixels(rendered.surface.canvas),referencePixels=pixels(referenceRender.surface.canvas),referenceDelta=pixelError(nativePixels,referencePixels);
      if(artifactDirectory)await Promise.all([writeFile(resolve(artifactDirectory,fixture.name+"-native.png"),rendered.surface.canvas.toBuffer("image/png")),writeFile(resolve(artifactDirectory,fixture.name+"-reference.png"),referenceRender.surface.canvas.toBuffer("image/png"))]);
      // Avoid Node's quadratic pretty-diff of large pixel arrays on failure.
      assert(referenceDelta===0,JSON.stringify(diagnostics)+fixture.name+" font marks differ from ordinary masked PDF image: "+referenceDelta);
      const blob=await buildHep(pdf,{compression:"deflate",encodeRasterImages:false,withTextLod:true,withVectorLod:true,onDiagnostic:d=>diagnostics.push(d)}),bytes=new Uint8Array(await blob.arrayBuffer());
      const archive=await HepArchive.loadAsync(bytes);for(const entry of Object.values(archive.files))await entry.async("uint8array");
      const scene=await loadSceneFromHep(bytes);assert.equal(scene.rasterLayers.length,2,"two invocations retain shared source image");assert.equal(page.stores.images.widths.length,2,"image and native mask assets retained");
      const reloaded=renderImageScene(scene,width,height,scale),delta=pixelError(pixels(reloaded),pixels(rendered.surface.canvas));assert(delta<.001,`${fixture.name} HEP sampling ${delta}`);
      assert(!diagnostics.some(d=>/(?:font-unavailable|substituted|selective-raster-fallback)/.test(d.code)),fixture.name+" retains reusable image without font fallback");
      evidence.push({name:fixture.name,hepBytes:bytes.length,sections:Object.keys(archive.files).length,pixelError:delta,diagnostics});
      if(artifactDirectory)await Promise.all([writeFile(resolve(artifactDirectory,fixture.name+".pdf"),pdf),writeFile(resolve(artifactDirectory,fixture.name+"-reference.pdf"),reference),writeFile(resolve(artifactDirectory,fixture.name+".hep"),bytes),writeFile(resolve(artifactDirectory,fixture.name+"-native.png"),rendered.surface.canvas.toBuffer("image/png")),writeFile(resolve(artifactDirectory,fixture.name+"-hep.png"),reloaded.toBuffer("image/png"))]);
    }
    if(artifactDirectory)await writeFile(resolve(artifactDirectory,"evidence.json"),JSON.stringify(evidence,null,2));
  }
}finally{hooks.deregister();}
function dict(width,height,bits,components,source,options={}){return`<< /ImageType ${options.type??1} /Width ${width} /Height ${height} /BitsPerComponent ${bits} /Decode ${options.decode??"["+Array.from({length:components},()=>"0 1").join(" ")+"]"} /ImageMatrix ${options.matrix??`[${width} 0 0 -${height} 0 ${height}]`} ${source===null?"":`/DataSource ${source}`} ${options.multiple?"/MultipleDataSources true":""} ${options.interpolate?"/Interpolate true":""} ${options.extra??""} >>`;}
function type3(interleave,data,mask){return`<< /ImageType 3 /InterleaveType ${interleave} /DataDict ${data} /MaskDict ${mask} >> image`;}
function hex(values){return"<"+Array.from(values,x=>x.toString(16).padStart(2,"0")).join("")+">";}
function rgba(values){return values.flatMap((v,i)=>i%3===2?[v,255]:[v]);}
function packRows(width,height,components,bits,samples){const rowBytes=Math.ceil(width*components*bits/8),result=new Uint8Array(rowBytes*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<components;c++)for(let b=0;b<bits;b++){const to=y*rowBytes*8+(x*components+c)*bits+b;result[to>>3]|=((samples[(y*width+x)*components+c]>>(bits-b-1))&1)<<(7-to%8);}return result;}
async function compareGhostscript(fixture,image){
  const width=120,height=120,scale=3,code=`%!PS\n<< /PageSize [${width} ${height}] >> setpagedevice\n10 10 translate 100 100 scale ${fixture.prefix} ${fixture.source?`/source ${hex(fixture.source)} /ReusableStreamDecode filter def`:""} ${fixture.code} showpage quit`;
  const result=spawnSync("gs",["-q","-dSAFER","-dBATCH","-dNOPAUSE","-sDEVICE=png16m","-r216","-sOutputFile=%stdout","-c",code],{maxBuffer:10*1024*1024,timeout:10000});assert.equal(result.status,0,fixture.name+": "+(result.error?.message??"")+result.stderr.toString());
  const {loadImage}=await import("@napi-rs/canvas"),source=await loadImage(result.stdout),canvas=createCanvas(width*scale,height*scale),ctx=canvas.getContext("2d");ctx.drawImage(source,0,0);
  // Only constant sample interiors are compared. Interpolation kernels and
  // downsampled independent masks intentionally have separate diagnostics.
  if(!fixture.maskInterpolate&&(!fixture.maskWidth||fixture.maskWidth===fixture.width)&&(!fixture.maskHeight||fixture.maskHeight===fixture.height))for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const offset=(y*image.width+x)*4,alpha=(image.softMask?.data[y*image.width+x]??255)*image.rgba[offset+3]/65025;
    const expected=[0,1,2].map(c=>Math.round(image.rgba[offset+c]*alpha+255*(1-alpha))),actual=[...ctx.getImageData(Math.floor((10+(x+.5)*100/image.width)*scale),Math.floor((10+(y+.5)*100/image.height)*scale),1,1).data].slice(0,3);
    assert.deepEqual(actual,expected,fixture.name+` Ghostscript sample ${x},${y}`);
  }
}
function fontPdf(font,width,height){return writeTinyPdf({objects:[{number:1,body:"<< /Type /Catalog /Pages 2 0 R >>"},{number:2,body:"<< /Type /Pages /Count 1 /Kids [3 0 R] >>"},{number:3,body:`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F 5 0 R >> >> /Contents 4 0 R >>`},{number:4,body:tinyPdfStream("","BT /F 600 Tf 1 0 0 1 20 20 Tm (A) Tj 1 0 0 1 150 20 Tm (A) Tj ET")},{number:5,body:"<< /Type /Font /Subtype /Type1 /BaseFont /FixtureType1 /FirstChar 65 /LastChar 65 /Widths [1000] /Encoding << /Type /Encoding /Differences [65 /A] >> /FontDescriptor 6 0 R >>"},{number:6,body:"<< /Type /FontDescriptor /FontName /FixtureType1 /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 1000 /StemV 80 /FontFile 7 0 R >>"},{number:7,body:tinyPdfStream("",font)}]});}
function imagePdf(image,width,height){const rgb=[],alpha=[];for(let i=0;i<image.width*image.height;i++){rgb.push(...image.rgba.subarray(i*4,i*4+3));alpha.push(image.rgba[i*4+3]);}const mask=image.softMask??{width:image.width,height:image.height,data:Uint8Array.from(alpha),interpolate:image.interpolate};return writeTinyPdf({objects:[{number:1,body:"<< /Type /Catalog /Pages 2 0 R >>"},{number:2,body:"<< /Type /Pages /Count 1 /Kids [3 0 R] >>"},{number:3,body:`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>`},{number:4,body:tinyPdfStream("","q 60 0 0 60 20 20 cm /Im Do Q q 60 0 0 60 150 20 cm /Im Do Q")},{number:5,body:tinyPdfStream(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Interpolate ${image.interpolate} /SMask 6 0 R`,Uint8Array.from(rgb))},{number:6,body:tinyPdfStream(`/Type /XObject /Subtype /Image /Width ${mask.width} /Height ${mask.height} /BitsPerComponent 8 /ColorSpace /DeviceGray /Interpolate ${mask.interpolate}`,mask.data)}]});}
function renderImageScene(scene,width,height,scale){const canvas=createCanvas(width*scale,height*scale),ctx=canvas.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,canvas.width,canvas.height);for(const layer of scene.rasterLayers){const image=createCanvas(layer.width,layer.height),ic=image.getContext("2d");const data=ic.createImageData(layer.width,layer.height);data.data.set(layer.data);ic.putImageData(data,0,0);ctx.save();ctx.setTransform(scale,0,0,-scale,0,height*scale);ctx.transform(...layer.matrix);ctx.imageSmoothingEnabled=layer.interpolate!==false;ctx.drawImage(image,0,0,1,1);ctx.restore();}return canvas;}
function pixelError(a,b){let error=0;for(let i=0;i<a.length;i++)error+=Math.abs(a[i]-b[i]);return error/(a.length*255);}
