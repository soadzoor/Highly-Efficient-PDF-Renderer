import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import * as THREE from "three";
const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { buildCompactMonochromeAtlas, buildCompactMonochromeAtlasAsync } = await import("../src/compactMonochromeRaster.ts");
  const { buildPackedMonochromeMipAtlas, monochromeRasterTile } = await import("../src/monochromeRaster.ts");
  const { packedMonochromeCoverageLayout, buildPackedCoverageMipAtlas } = await import("../src/packedMonochromeCoverage.ts");
  const { createThreeRasterTileTextures, threeRasterTextureInfo } = await import("../src/threeRasterTextures.ts");
  const { planRasterTiles } = await import("../src/rasterTiles.ts");
  const { planSceneRasterMemory } = await import("../src/rasterMemoryBudget.ts");
  const { buildPreparedRasterPixels, buildPreparedRasterPixelsAsync } = await import("../src/rasterPreparationCore.ts");
  const { COMPACT_MONOCHROME_GLSL } = await import("../src/compactMonochromeShaders.ts");
  const shaderSampler = compactShaderSampler(COMPACT_MONOCHROME_GLSL);
  const colors = Uint8Array.of(0,0,0,255,255,255,255,255);
  function check(source, width, height, reduced) {
    const mips = reduced ? buildPackedCoverageMipAtlas(reduced, width, height) : buildPackedMonochromeMipAtlas(source, width, height);
    const atlas = buildCompactMonochromeAtlas(source, width, height, mips, reduced);
    assert(atlas, "compressible content must select compact storage");
    assert(atlas.data.length < (reduced?.length ?? source.data.length) + mips.data.length);
    const layout = packedMonochromeCoverageLayout(width, height);
    const shader = shaderSampler(atlas);
    for (const [level, size] of [{ width, height }, ...layout.levels].entries()) {
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
        const expected = level === 0 ? reduced ? reduced[y * width + x] / 255
          : ((source.data[y * Math.ceil(width / 8) + (x >> 3)] >> (7 - (x & 7))) & 1)
          : ((mips.data[size.byteOffset + y * size.rowBytes + (x >> 1)] >> ((x & 1) ? 0 : 4)) & 15) / 15;
        assert.equal(sample(atlas, level, x, y), expected, `level ${level}, (${x},${y})`);
      }
      // Include ink/background in the symbol fixtures, block boundaries, and out-of-bounds mip edges.
      for (const [x,y] of [[0,0],[1,1],[29,28],[30,28],[31,31],[32,32],
        [size.width-1,size.height-1],[-1,-1],[size.width,-1],[-1,size.height],[size.width,size.height]]) {
        assert.equal(shader(size, level, x, y), sample(atlas, level, x, y), `GLSL level ${level}, (${x},${y})`);
      }
    }
    return { atlas, mips };
  }
  const blank = { data: new Uint8Array(Math.ceil(257 / 8) * 65).fill(255), colors };
  const { atlas: white, mips: whiteMips } = check(blank,257,65);
  snapshot(white,"c7b004de55a448f310802659a574ed9dec721c817e1b10079bb4be8c2c81fc2a");
  assert(white.uniformBlocks > 0); assert.equal(white.symbolBlocks,0);
  assert.deepEqual(await buildCompactMonochromeAtlasAsync(blank,257,65,whiteMips),white);
  let seed = 43;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const repeated = { data: new Uint8Array(512 * 256 / 8), colors };
  const rows = Array.from({ length:32 }, () => Uint8Array.from({ length:4 }, random));
  for (let y=0;y<256;y++) for (let x=0;x<64;x++) repeated.data[y*64+x] = rows[y&31][x&3];
  const { atlas: shared } = check(repeated,512,256);
  snapshot(shared,"bd99af15a5221771072c57a495aad819be16e323628c762f7b15d24ae32ace79");
  assert(shared.reusedBlocks > 0);
  const allBytes = { data:Uint8Array.from({ length:512*256/8 }, (_,i) => ((Math.floor(i/64)&63)*4+(i&3))&255), colors };
  snapshot(check(allBytes,512,256).atlas,"9b18d477809b68debb11ab135070a05bee6862246fa2f64371ff39da1ba33c53");
  // Full base/mip blocks also support odd byte strides: 17 and 33 bytes per row.
  const oddStride = { data:Uint8Array.from({ length:17*130 }, (_,i) => ((Math.floor(i/17)&31)*53+((i%17)&3)*97)&255), colors };
  snapshot(check(oddStride,130,130).atlas,"e36d035984efb7682a7542f3adace90999a77336accd8557a2f1466295169dab");
  const noise = { data: Uint8Array.from({ length:512*256/8 }, random), colors };
  assert.equal(buildCompactMonochromeAtlas(noise,512,256,buildPackedMonochromeMipAtlas(noise,512,256)),undefined,
    "incompressible content keeps the packed bitmap rather than increasing storage");
  const reduced = Uint8Array.from({ length:65*67 }, (_, i) => (i % 65) < 32 ? 45 : 187);
  snapshot(check(blank,65,67,reduced).atlas,"c32baf315804e67b4225ff80168d702862a427296e4a80316219462515ec3b50");
  const texturedReduced = Uint8Array.from({ length:97*99 }, (_,i) => (((i%97)&31)*53+((Math.floor(i/97)&31)*97))&255);
  snapshot(check(blank,97,99,texturedReduced).atlas,"01f3b08cb412d48a1e99620bc0cef2e973bc9b71d2765b95e1e03ad85ebd6cc5");
  const glyph = { width:9, height:7, data:Uint8Array.from({ length:14 }, (_,i) => i&1 ? 128 : 0xaa) };
  const source = { data:new Uint8Array(512*256/8).fill(255), colors,
    symbols:{ symbols:[glyph], placements:Int32Array.of(29,28,0,137,74,0,253,134,0,400,219,0) } };
  for(let i=0;i<source.symbols.placements.length;i+=3) {
    const x=source.symbols.placements[i],y=source.symbols.placements[i+1];
    for(let sy=0;sy<glyph.height;sy++)for(let sx=0;sx<glyph.width;sx++)
      if(glyph.data[sy*2+(sx>>3)]&(128>>(sx&7)))source.data[(y+sy)*64+((x+sx)>>3)] &= ~(128>>((x+sx)&7));
  }
  const {atlas:symbolAtlas}=check(source,512,256);assert(symbolAtlas.symbolBlocks>0);
  snapshot(symbolAtlas,"b20ef9e94e6f50adcde9f76de613adb0a63ce4a8def8e6f4f006fa6e356dd828");
  const tile = monochromeRasterTile(source,512,256,{x:30,y:29,width:129,height:99});
  const {atlas:tileAtlas}=check(tile,129,99);assert(tileAtlas.symbolBlocks>0,"cropped symbols retain their pixels across tile edges");
  snapshot(tileAtlas,"44c5ac55006268a99e0b5742bf3e4e47595c266615f823fbe9be9ef78c43d027");
  const mismatched = {...source,symbols:{...source.symbols,placements:Int32Array.of(0,0,0)}};
  const {atlas:canonical}=check(mismatched,512,256);
  assert.equal(canonical.symbolBlocks,0,"inconsistent traces cannot alter canonical pixels");
  snapshot(canonical,"e60bb65832c7e3d525b0c64c174b4cd4898cb9dc8b460fd279dd59b8c389d600");
  const plan=planRasterTiles(512,256,1024),input={width:512,height:256,monochrome:source,get data(){assert.fail("RGBA expansion");}};
  const prepared=buildPreparedRasterPixels(input,plan);
  assert.deepEqual(await buildPreparedRasterPixelsAsync(input,plan),prepared);
  const [texture]=createThreeRasterTileTextures(input,plan,undefined,null,prepared),info=threeRasterTextureInfo(texture);
  assert.equal(info.mode,3);assert.equal(texture.format,THREE.RGBAFormat);assert.equal(info.coverage,texture);
  assert.equal(info.estimatedBytes,texture.image.data.length);assert.equal(texture.generateMipmaps,false);
  const memorySource={width:512,height:256,monochrome:source,displayWidth:512,displayHeight:256,reducedMonochrome:true};
  const learned=planSceneRasterMemory([memorySource],1024,info.estimatedBytes+16);
  assert.equal(learned.plans[0].width,512);assert.equal(learned.estimatedBytes,info.estimatedBytes);
  const unknown={...memorySource,monochrome:{...source,data:source.data.slice()}};
  assert(planSceneRasterMemory([unknown],1024,info.estimatedBytes+16).plans[0].width<512,"unknown contents retain a safe upper bound");
  let disposals=0;texture.addEventListener("dispose",()=>disposals++);texture.dispose();assert.equal(disposals,1);
  console.log(`Compact monochrome: exhaustive base/mip parity, GLSL sampling/clamping parity, byte-identical atlas snapshots, blank/repeated blocks, symbol/tile composition, fallback, async preparation and Three accounting passed. Blank fixture: ${white.data.length} bytes.`);
} finally { hooks.deregister(); }

/** Byte-for-byte atlas snapshots captured from the original per-pixel builder. */
function snapshot(atlas,expected) {
  const digest=createHash("sha256").update(`${atlas.width}:${atlas.height}:${atlas.uniformBlocks}:${atlas.reusedBlocks}:${atlas.symbolBlocks}:`)
    .update(atlas.data).digest("hex");
  assert.equal(digest,expected,"packed block extraction preserves the original atlas bytes and accounting");
}

/** Independent CPU interpretation of the GPU word format, including symbol overlays. */
function sample(atlas,level,x,y) {
  const view=new DataView(atlas.data.buffer,atlas.data.byteOffset,atlas.data.byteLength),word=i=>view.getUint32(i*4,true);
  let width=word(0),height=word(1);for(let i=0;i<level;i++){width=Math.max(1,width>>1);height=Math.max(1,height>>1);}
  x=Math.max(0,Math.min(width-1,x));y=Math.max(0,Math.min(height-1,y));
  const bits=level?4:word(4),entry=word(word(5+level)+(y>>5)*Math.ceil(width/32)+(x>>5));
  const block=e=>{
    if(e&0x80000000)return e&255;
    const bit=((y&31)*32+(x&31))*bits;return(word(e+(bit>>>5))>>>(bit&31))&((1<<bits)-1);
  };
  if((entry&0xc0000000)!==0x40000000)return block(entry)/((1<<bits)-1);
  const list=entry&0x3fffffff;let value=block(word(list));
  for(let i=0;i<word(list+1);i++){
    const record=list+2+i*3,glyph=word(record),px=x-(word(record+1)|0),py=y-(word(record+2)|0);
    if(px<0||py<0||px>=word(glyph)||py>=word(glyph+1))continue;
    const offset=py*Math.ceil(word(glyph)/8)+(px>>3),ink=(word(glyph+2+(offset>>2))>>>((offset&3)*8+7-(px&7)))&1;
    value=Math.min(value,1-ink);
  }
  return value;
}

/** Execute the production GLSL texel body with its integer/vector operations and atlas reads. */
function compactShaderSampler(glsl) {
  let body = glsl.match(/float heprCompactTexel\([^\n]+\) \{([\s\S]*?)\n\}/)[1];
  // These are the shader's integer divisions; JS division would retain fractional indices.
  for (const [from,to] of [
    ["p.y / 32u", "(p.y >>> 5)"], ["((uint(size.x) + 31u) / 32u)", "((uint(size.x) + 31u) >>> 5)"],
    ["p.x / 32u", "(p.x >>> 5)"], ["((uint(glyphSize.x) + 7u) / 8u)", "((uint(glyphSize.x) + 7u) >>> 3)"],
    ["uint(local.x) / 8u", "(uint(local.x) >>> 3)"], ["byteOffset / 4u", "(byteOffset >>> 2)"],
  ]) body = body.replaceAll(from,to);
  body = body.replaceAll("size - 1", "subtract(size, 1)")
    .replace(/ivec2\(p\) - (ivec2\([^\n]+\));/, "subtract(ivec2(p), $1);")
    .replace(/\b(?:uint|float|ivec2|uvec2) (\w+) =/g, "let $1 =")
    .replace(/\b(0x[\da-f]+|\d+)u\b/gi, "$1").replaceAll(" >> ", " >>> ").replace(/\bmin\(/g, "Math.min(");
  const vector = (x,y=x) => typeof x === "object" ? x : {x,y};
  const helpers = {
    heprCompactWord: (image,offset) => image.getUint32(offset*4,true),
    heprCompactBlock: (image,entry,p,bits) => {
      if (entry & 0x80000000) return entry & 255;
      const bit = ((p.y & 31)*32+(p.x & 31))*bits;
      return (image.getUint32((entry+(bit>>>5))*4,true) >>> (bit & 31)) & ((1<<bits)-1);
    },
    uint: x => x>>>0, int: x => x|0, float: Number, ivec2: vector, uvec2: vector,
    subtract: (a,b) => ({x:a.x-(typeof b === "number" ? b : b.x), y:a.y-(typeof b === "number" ? b : b.y)}),
    clamp: (p,low,high) => ({x:Math.max(low.x,Math.min(high.x,p.x)), y:Math.max(low.y,Math.min(high.y,p.y))}),
    greaterThanEqual: (a,b) => ({x:a.x>=b.x,y:a.y>=b.y}), lessThan: (a,b) => ({x:a.x<b.x,y:a.y<b.y}),
    all: v => v.x && v.y,
  };
  const run = new Function(...Object.keys(helpers), `return function(image,size,level,pixel) {${body}}`)(...Object.values(helpers));
  return atlas => {
    const image = new DataView(atlas.data.buffer,atlas.data.byteOffset,atlas.data.byteLength);
    return (size,level,x,y) => run(image,{x:size.width,y:size.height},level,{x,y});
  };
}
