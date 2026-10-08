import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { parseAst } from "vite";
import { tinySymbolJbig2, imagePdf } from "./lib/imageCodecFixtures.mjs";
const hooks = registerHooks({ resolve(s,c,next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s,c);
} });
try {
  const { decodeBundledJbig2 } = await import("../src/pdf/nativeJbig2Codec.ts");
  const { decodePdfiumJbig2 } = await import("../src/pdf/codecs/jbig2Wasm.ts");
  const { tryDecodeJbig2Symbols } = await import("../src/pdf/codecs/jbig2SymbolKernel.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { buildPreparedRasterPixels } = await import("../src/rasterPreparationCore.ts");
  const { planRasterTiles } = await import("../src/rasterTiles.ts");
  const { prepareMonochromeSceneTransfer } = await import("../src/monochromeRaster.ts");
  const { collectPdfTransferables } = await import("../src/pdf/workerProtocol.ts");
  const limit = 32 * 1024 * 1024;
  for (const useGlobals of [false,true]) {
    const fixture=tinySymbolJbig2({useGlobals,placements:[[29,28],[137,74],[-1,0],[255,255],[300,300]]});
    const request={codec:"jbig2",...fixture,width:256,height:256,components:1,bitsPerComponent:1,imageMask:false,decodeParameters:{}};
    const result=await decodeBundledJbig2(request,limit);
    assert(result.jbig2Symbols);assert.equal(result.jbig2Symbols.symbols.length,1);
    assert.deepEqual([...result.jbig2Symbols.placements],[29,28,0,137,74,0,255,255,0]);
    assert.deepEqual(result.jbig2Symbols.symbols[0],{width:1,height:1,data:Uint8Array.of(128)});
    assert.deepEqual(result.samples,await decodePdfiumJbig2(fixture.encoded,fixture.globals,256,256,limit),
      "symbol reconstruction matches PDFium, including negative and out-of-page placements");
    for (const extra of ["","/Decode [1 0]"]) {
      const session=await openPdf({kind:"bytes",bytes:imagePdf(fixture.encoded,{filter:"JBIG2Decode",width:256,height:256,
        colorSpace:"/DeviceGray",bitsPerComponent:1,extra,globals:useGlobals?fixture.globals:undefined})});
      try {
        const scene=await session.compileVectorPage(0,{optimization:"none",vectorFallback:"error"});
        const layer=scene.rasterLayers[0];assert(layer.monochrome);
        if(extra){assert.equal(layer.monochrome.symbols,undefined);continue;}
        assert.deepEqual(layer.monochrome.symbols,result.jbig2Symbols,"native lowering retains decoded symbol metadata");
        const prepared=buildPreparedRasterPixels(layer,planRasterTiles(256,256,512));
        assert(prepared.compactAtlases[0].symbolBlocks>0,"decoded symbols feed the same block/mip atlas");
        const transport=prepareMonochromeSceneTransfer(scene),buffers=collectPdfTransferables(transport);
        const transferred=structuredClone(transport,{transfer:buffers});
        assert.deepEqual(transferred.rasterLayers[0].monochrome.symbols,result.jbig2Symbols);
        assert(layer.monochrome.symbols.symbols[0].data.byteLength>0,"transfers never detach cached dictionary bitmaps");
      } finally {await session.close();}
    }
  }
  const fixture=tinySymbolJbig2();
  const retainedContext=fixture.encoded.slice();
  // Page segment is 30 bytes; dictionary payload follows its 11-byte header.
  retainedContext[41] |= 1;
  assert.equal(tryDecodeJbig2Symbols(retainedContext,fixture.globals,256,256,limit,undefined,200000000).result,undefined,
    "retained arithmetic contexts use PDFium rather than an independently reset JS context");
  assert.throws(()=>tryDecodeJbig2Symbols(fixture.encoded,fixture.globals,256,256,limit,undefined,10),
    error=>error.code==="resource-limit"&&error.details.reason==="jbig2-work");
  assert.equal(tryDecodeJbig2Symbols(fixture.encoded,fixture.globals,256,256,128,undefined,200000000).result,undefined,
    "JS allocations are bounded before constructing symbol rows or output arrays");
  const controller=new AbortController();controller.abort();
  assert.throws(()=>tryDecodeJbig2Symbols(fixture.encoded,fixture.globals,256,256,limit,controller.signal,200000000),
    error=>error.code==="aborted");
  const transposed=tinySymbolJbig2({textFlags:17|64});
  const fallback=await decodeBundledJbig2({codec:"jbig2",...transposed,width:256,height:256,components:1,
    bitsPerComponent:1,imageMask:false,decodeParameters:{}},limit);
  assert.equal(fallback.jbig2Symbols,undefined,"unsupported placement falls back to the metered bitmap decoder");
  assert.deepEqual(fallback.samples,await decodePdfiumJbig2(transposed.encoded,transposed.globals,256,256,limit));
  const source=await readFile(new URL("../src/pdf/codecs/jbig2SymbolKernel.ts",import.meta.url),"utf8");
  const boundary=source.indexOf("// HEPR operation-local accounting.");let loops=0;
  function visit(node){
    if(!node||typeof node!=="object"||node.start>=boundary)return;
    if(["ForStatement","ForOfStatement","ForInStatement","WhileStatement","DoWhileStatement"].includes(node.type)){
      loops++;assert.equal(node.body.type,"BlockStatement");
      assert.equal(node.body.body[0]?.expression?.callee?.name,"tick","every vendored loop checks the operation work budget");
    }
    if(node.type==="NewExpression")assert(!/^((U?Int|Uint|Float)\d+|Uint8Clamped)Array$/.test(node.callee.name),"typed decoder allocations use the bounded allocator");
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==="object")visit(value);
  }
  visit(parseAst(source));assert(loops>80);
  console.log("JBIG2 symbol storage: bitmap parity, globals, clipping, native lowering, GPU preparation, Decode fallback, transfer ownership and decoder work/allocation guards passed.");
} finally {hooks.deregister();}
