import assert from "node:assert/strict";
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
  const colors = Uint8Array.of(0,0,0,255,255,255,255,255);
  function check(source, width, height, reduced) {
    const mips = reduced ? buildPackedCoverageMipAtlas(reduced, width, height) : buildPackedMonochromeMipAtlas(source, width, height);
    const atlas = buildCompactMonochromeAtlas(source, width, height, mips, reduced);
    assert(atlas, "compressible content must select compact storage");
    assert(atlas.data.length < (reduced?.length ?? source.data.length) + mips.data.length);
    const layout = packedMonochromeCoverageLayout(width, height);
    for (const [level, size] of [{ width, height }, ...layout.levels].entries()) {
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
        const expected = level === 0 ? reduced ? reduced[y * width + x] / 255
          : ((source.data[y * Math.ceil(width / 8) + (x >> 3)] >> (7 - (x & 7))) & 1)
          : ((mips.data[size.byteOffset + y * size.rowBytes + (x >> 1)] >> ((x & 1) ? 0 : 4)) & 15) / 15;
        assert.equal(sample(atlas, level, x, y), expected, `level ${level}, (${x},${y})`);
      }
    }
    return { atlas, mips };
  }
  const blank = { data: new Uint8Array(Math.ceil(257 / 8) * 65).fill(255), colors };
  const { atlas: white, mips: whiteMips } = check(blank,257,65);
  assert(white.uniformBlocks > 0); assert.equal(white.symbolBlocks,0);
  assert.deepEqual(await buildCompactMonochromeAtlasAsync(blank,257,65,whiteMips),white);
  let seed = 43;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const repeated = { data: new Uint8Array(512 * 256 / 8), colors };
  const rows = Array.from({ length:32 }, () => Uint8Array.from({ length:4 }, random));
  for (let y=0;y<256;y++) for (let x=0;x<64;x++) repeated.data[y*64+x] = rows[y&31][x&3];
  const { atlas: shared } = check(repeated,512,256);
  assert(shared.reusedBlocks > 0);
  const noise = { data: Uint8Array.from({ length:512*256/8 }, random), colors };
  assert.equal(buildCompactMonochromeAtlas(noise,512,256,buildPackedMonochromeMipAtlas(noise,512,256)),undefined,
    "incompressible content keeps the packed bitmap rather than increasing storage");
  const reduced = Uint8Array.from({ length:65*67 }, (_, i) => (i % 65) < 32 ? 45 : 187);
  check(blank,65,67,reduced);
  const glyph = { width:9, height:7, data:Uint8Array.from({ length:14 }, (_,i) => i&1 ? 128 : 0xaa) };
  const source = { data:new Uint8Array(512*256/8).fill(255), colors,
    symbols:{ symbols:[glyph], placements:Int32Array.of(29,28,0,137,74,0,253,134,0,400,219,0) } };
  for(let i=0;i<source.symbols.placements.length;i+=3) {
    const x=source.symbols.placements[i],y=source.symbols.placements[i+1];
    for(let sy=0;sy<glyph.height;sy++)for(let sx=0;sx<glyph.width;sx++)
      if(glyph.data[sy*2+(sx>>3)]&(128>>(sx&7)))source.data[(y+sy)*64+((x+sx)>>3)] &= ~(128>>((x+sx)&7));
  }
  const {atlas:symbolAtlas}=check(source,512,256);assert(symbolAtlas.symbolBlocks>0);
  const tile = monochromeRasterTile(source,512,256,{x:30,y:29,width:129,height:99});
  const {atlas:tileAtlas}=check(tile,129,99);assert(tileAtlas.symbolBlocks>0,"cropped symbols retain their pixels across tile edges");
  const mismatched = {...source,symbols:{...source.symbols,placements:Int32Array.of(0,0,0)}};
  assert.equal(check(mismatched,512,256).atlas.symbolBlocks,0,"inconsistent traces cannot alter canonical pixels");
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
  console.log(`Compact monochrome: exhaustive base/mip parity, blank/repeated blocks, symbol/tile composition, fallback, async preparation and Three accounting passed. Blank fixture: ${white.data.length} bytes.`);
} finally { hooks.deregister(); }

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
