import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/pdf/codecs/openJpegKernel.ts", import.meta.url), "utf8");
function hostFunction(name, dependencies) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} is present`);
  const body = source.indexOf("{", start);
  let end = body + 1, depth = 1;
  while (depth && end < source.length) {
    const character = source[end++];
    if (character === "{") depth++;
    if (character === "}") depth--;
  }
  assert.equal(depth, 0);
  return new Function(...Object.keys(dependencies), `return (${source.slice(start, end)});`)(...Object.values(dependencies));
}
function hostArrow(name, following, dependencies) {
  const prefix = `var ${name}=`;
  const start = source.indexOf(prefix) + prefix.length;
  assert(start >= prefix.length, `${name} is present`);
  const end = source.indexOf(following, start);
  assert(end > start, `${name} has its expected boundary`);
  return new Function(...Object.keys(dependencies), `return (${source.slice(start, end)});`)(...Object.values(dependencies));
}
const unsigned = pointer => Number(BigInt.asUintN(32, BigInt(pointer)));
const pointers = [-2147483648, -2147483644, -4, -2147483640];
for (const [name, components, expected] of [
  ["_copy_pixels_1", 1, [64]],
  ["_copy_pixels_3", 3, [64, 80, 96]],
  ["_copy_pixels_4", 4, [64, 80, 96, 112]],
  ["_gray_to_rgba", 1, [64, 64, 64, 255]],
  ["_graya_to_rgba", 2, [64, 64, 64, 80]],
  ["_rgb_to_rgba", 3, [64, 80, 96, 255]]
]) {
  const Module = {}, addresses = [];
  const copy = hostFunction(name, { Module, HEAP32: {
    subarray(start, end) {
      addresses.push([start, end]);
      return Int32Array.of(64 + 16 * (addresses.length - 1));
    }
  } });
  copy(...pointers.slice(0, components), 1);
  assert.deepEqual(addresses, pointers.slice(0, components).map(pointer => [unsigned(pointer) / 4, unsigned(pointer) / 4 + 1]),
    `${name} reads high Wasm32 component pointers`);
  assert.deepEqual([...Module.imageData], expected);
}

let observedPointer;
const stringToUTF8 = hostArrow("stringToUTF8", ";var HEAPU32", {
  HEAPU8: {}, stringToUTF8Array: (_string, _heap, pointer) => { observedPointer = pointer; return 3; }
});
assert.equal(stringToUTF8("A=B", -4, Infinity), 3);
assert.equal(observedPointer, 0xfffffffc);
const UTF8ToString = hostArrow("UTF8ToString", ";var _fd_write", {
  HEAPU8: {}, UTF8ArrayToString: (_heap, pointer) => { observedPointer = pointer; return "A=B"; }
});
assert.equal(UTF8ToString(-4), "A=B");
assert.equal(observedPointer, 0xfffffffc);
const writeArrayToMemory = hostArrow("writeArrayToMemory", ";{if(Module", {
  HEAP8: { set(_array, pointer) { observedPointer = pointer; } }
});
writeArrayToMemory(Uint8Array.of(1), -4);
assert.equal(observedPointer, 0xfffffffc);

const environment = {}, environmentDependencies = {
  HEAPU32: environment, getEnvStrings: () => ["A=B"], stringToUTF8,
  lengthBytesUTF8: string => string.length
};
hostArrow("_environ_get", ";var lengthBytesUTF8", environmentDependencies)(-2147483648, -4);
assert.equal(environment[0x20000000], 0xfffffffc);
hostArrow("_environ_sizes_get", ";var INT53_MAX", environmentDependencies)(-2147483648, -4);
assert.equal(environment[0x20000000], 1);
assert.equal(environment[0x3fffffff], 4);
const words = { [0x20000000]: 0xfffffffe, [0x20000001]: 2 }, printed = [];
const fdWrite = hostArrow("_fd_write", ";function _gray_to_rgba", {
  HEAPU32: words, HEAPU8: { [0xfffffffe]: 65, [0xffffffff]: 66 },
  printChar: (stream, character) => printed.push([stream, character])
});
assert.equal(fdWrite(1, -2147483648, 1, -4), 0);
assert.deepEqual(printed, [[1, 65], [1, 66]]);
assert.equal(words[0x3fffffff], 2);

const getHeapMax = hostArrow("getHeapMax", ";var alignMemory", {});
assert.equal(getHeapMax(), 65536 * 65536, "heap growth uses the full Wasm32 address capacity");
const growth = [];
const resizeHeap = hostArrow("_emscripten_resize_heap", ";var ENV", {
  HEAPU8: { length: 16 * 1024 * 1024 }, getHeapMax,
  alignMemory: (size, alignment) => Math.ceil(size / alignment) * alignment,
  growMemory: size => { growth.push(size); return 1; }
});
assert.equal(resizeHeap(-1), true, "unsigned requests above 2 GiB reach actual memory growth");
assert.deepEqual(growth, [4294967296]);

console.log("OpenJPEG host addresses passed: component planes, UTF8, WASI, input writes and Wasm32 heap growth.");
