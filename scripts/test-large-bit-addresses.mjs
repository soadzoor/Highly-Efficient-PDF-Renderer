import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Evaluate the actual byte-address expressions without allocating multi-GB
// image/sample buffers. Bitwise shifts would wrap these valid wire offsets.
const sites = [
  { file: "hepShared.ts", label: "stroke metadata decode", pattern: /const isQuad = \(metaBytes\[([^\]]+)\]/, parameters: ["i"] },
  { file: "hepShared.ts", label: "stroke metadata encode", pattern: /bitset\[([^\]]+)\] \|=/, parameters: ["i"] },
  { file: "heprDocumentData.ts", label: "retained Gray1 expansion", pattern: /const value = \(\(data\[([^\]]+)\]/, parameters: ["x", "y", "rowBytes"], rows: true },
  { file: "heprCanvas2dRenderer.ts", label: "Canvas Gray1 expansion", pattern: /const value = \(\(data\[([^\]]+)\]/, parameters: ["x", "y", "stride"], rows: true },
  { file: "pdf/nativeVectorPage.ts", label: "Gray1 image mask", pattern: /return \(image\.data\[([^\]]+)\]/, parameters: ["x", "y", "image"], rows: true, image: true },
  { file: "pdf/nativeFunctions.ts", label: "sampled function bits", pattern: /value = value \* 2 \+ \(\(bytes\[([^\]]+)\]/, parameters: ["bitOffset"], sample: true }
];
const width = 0xffffffff;
const rowBytes = Math.ceil(width / 8);
for (const site of sites) {
  const source = await readFile(new URL(`../src/${site.file}`, import.meta.url), "utf8");
  const match = source.match(site.pattern);
  assert.ok(match, `${site.label}: byte-address expression is present`);
  const address = new Function(...site.parameters, `return ${match[1]};`);
  for (const index of [0, 7, 8, 0x7fffffff, 0x80000000, 0x80000001, 0xfffffffe,
    ...(site.sample ? [0x100000000, 0x100000007] : [])]) {
    const args = site.rows ? [index, 2, site.image ? { width } : rowBytes] : [index];
    assert.equal(address(...args), (site.rows ? 2 * rowBytes : 0) + Number(BigInt(index) >> 3n),
      `${site.label}: bit ${index} keeps its full byte address`);
  }
}

console.log("Large bit-address regressions passed.");
