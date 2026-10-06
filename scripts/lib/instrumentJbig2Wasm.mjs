import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { limitWasmMemory } from "./limitWasmMemory.mjs";

const encode = value => {
  const result = [];
  do { const byte = value & 127; value = Math.floor(value / 128); result.push(byte | (value ? 128 : 0)); } while (value);
  return result;
};

/** Instrument the pinned PDFium module without renumbering any existing index.
 * A balanced, stack-neutral countdown precedes every function body and loop
 * body. A branch to a loop label therefore also executes the countdown. The
 * appended private global batches callbacks; imports, tables and exports keep
 * their original indices. Import a.d is () -> (), normally runtime shutdown;
 * our fresh-instance adapter provides the budget callback at that slot.
 */
export function instrumentJbig2Wasm(bytes) {
  if (createHash("sha256").update(bytes).digest("hex") !== "466f45c2a61a698152fb5400c27e56ff2ceb73dcb71fde3fc366a502308eaab0") {
    throw new Error("Unexpected upstream JBIG2 WASM: expected PDF.js v6.4.299.");
  }
  if (!WebAssembly.validate(bytes)) throw new Error("Invalid upstream JBIG2 WASM.");
  let position = 8, globalIndex, importsChecked = false, globalsSeen = false, codeSeen = false;
  const output = [...bytes.subarray(0, 8)];
  const read = (limit = bytes.length, maxBytes = 5) => {
    let value = 0, shift = 0, byte, count = 0;
    do {
      if (position >= limit || count++ >= maxBytes) throw new Error("Invalid JBIG2 WASM integer.");
      byte = bytes[position++]; value += (byte & 127) * 2 ** shift; shift += 7;
    } while (byte & 128);
    return value;
  };
  const skipLeb = (limit, maximum = 5) => { read(limit, maximum); };
  const requireEnd = end => { if (position !== end) throw new Error("Unexpected JBIG2 WASM section/body length."); };
  let functions = 0, loops = 0;
  while (position < bytes.length) {
    const id = bytes[position++], length = read(), start = position, end = start + length;
    if (id > 12 || end > bytes.length) throw new Error(`Unsupported JBIG2 WASM section ${id}.`);
    let payload;
    if (id === 2) {
      // Fail closed if a future upstream build changes the callback ABI.
      const expected = [8, 1, 97, 1, 97, 0, 12, 1, 97, 1, 98, 0, 2,
        1, 97, 1, 99, 0, 1, 1, 97, 1, 100, 0, 6, 1, 97, 1, 101, 0, 6,
        1, 97, 1, 102, 0, 9, 1, 97, 1, 103, 0, 1, 1, 97, 1, 104, 0, 5];
      if (length !== expected.length || !expected.every((value, index) => bytes[start + index] === value)) {
        throw new Error("Unexpected pinned JBIG2 WASM imports.");
      }
      importsChecked = true;
    } else if (id === 6) {
      if (globalsSeen) throw new Error("Duplicate JBIG2 WASM globals.");
      globalIndex = read(end);
      // The pinned module has one mutable i32 stack pointer and no imports of
      // globals. Retain its initializer verbatim and append our own counter.
      if (globalIndex !== 1 || bytes[position++] !== 0x7f || bytes[position++] !== 1 || bytes[position++] !== 0x41) {
        throw new Error("Unexpected pinned JBIG2 WASM globals.");
      }
      skipLeb(end);
      if (bytes[position++] !== 0x0b) throw new Error("Unexpected JBIG2 global initializer.");
      requireEnd(end);
      payload = [...encode(globalIndex + 1), ...bytes.subarray(start + 1, end), 0x7f, 1, 0x41, 0x80, 0x08, 0x0b];
      globalsSeen = true;
    } else if (id === 10) {
      if (!importsChecked || !globalsSeen || codeSeen) throw new Error("Unexpected JBIG2 WASM section order.");
      const count = read(end);
      payload = [...encode(count)];
      const tick = [0x23, ...encode(globalIndex), 0x41, 1, 0x6b, 0x24, ...encode(globalIndex),
        0x23, ...encode(globalIndex), 0x45, 0x04, 0x40, 0x10, 3,
        0x41, 0x80, 0x08, 0x24, ...encode(globalIndex), 0x0b];
      for (let index = 0; index < count; index++) {
        const bodyLength = read(end), bodyStart = position, bodyEnd = position + bodyLength;
        if (bodyEnd > end) throw new Error("Truncated JBIG2 WASM body.");
        const locals = read(bodyEnd);
        for (let local = 0; local < locals; local++) {
          read(bodyEnd);
          if (![0x7f, 0x7e, 0x7d, 0x7c, 0x7b].includes(bytes[position++])) throw new Error("Unsupported JBIG2 WASM local.");
        }
        const body = [...bytes.subarray(bodyStart, position), ...tick];
        functions++;
        while (position < bodyEnd) {
          const instructionStart = position, opcode = bytes[position++];
          if ([0x02, 0x03, 0x04].includes(opcode)) skipLeb(bodyEnd);
          else if ([0x0c, 0x0d, 0x10, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x3f, 0x40, 0xd2].includes(opcode)) skipLeb(bodyEnd);
          else if (opcode === 0x0e) { const targets = read(bodyEnd); for (let target = 0; target <= targets; target++) skipLeb(bodyEnd); }
          else if (opcode === 0x11) { skipLeb(bodyEnd); skipLeb(bodyEnd); }
          else if (opcode === 0x1c) { const types = read(bodyEnd); position += types; }
          else if (opcode >= 0x28 && opcode <= 0x3e) { skipLeb(bodyEnd); skipLeb(bodyEnd); }
          else if (opcode === 0x41) skipLeb(bodyEnd);
          else if (opcode === 0x42) skipLeb(bodyEnd, 10);
          else if (opcode === 0x43) position += 4;
          else if (opcode === 0x44) position += 8;
          else if (opcode === 0xd0) position++;
          else if (opcode === 0xfd) {
            const extension = read(bodyEnd);
            if (extension <= 11 || extension === 92 || extension === 93) { skipLeb(bodyEnd); skipLeb(bodyEnd); }
            else if (extension === 12 || extension === 13) position += 16;
            else if (extension >= 21 && extension <= 34) position++;
            else if (extension >= 84 && extension <= 91) { skipLeb(bodyEnd); skipLeb(bodyEnd); position++; }
            else if (extension > 255) throw new Error(`Unsupported JBIG2 WASM SIMD opcode ${extension}.`);
          }
          else if (opcode === 0xfc) {
            const extension = read(bodyEnd);
            if ([8, 10, 12, 14].includes(extension)) { skipLeb(bodyEnd); skipLeb(bodyEnd); }
            else if ([9, 11, 13, 15, 16, 17].includes(extension)) skipLeb(bodyEnd);
            else if (extension > 7) throw new Error(`Unsupported JBIG2 WASM extended opcode ${extension}.`);
          } else if (![0x00, 0x01, 0x05, 0x0b, 0x0f, 0x1a, 0x1b, 0xd1].includes(opcode) && !(opcode >= 0x45 && opcode <= 0xc4)) {
            throw new Error(`Unsupported JBIG2 WASM opcode ${opcode.toString(16)}.`);
          }
          if (position > bodyEnd) throw new Error("Truncated JBIG2 WASM instruction.");
          body.push(...bytes.subarray(instructionStart, position));
          if (opcode === 0x03) { body.push(...tick); loops++; }
        }
        requireEnd(bodyEnd);
        payload.push(...encode(body.length), ...body);
      }
      requireEnd(end);
      codeSeen = true;
    }
    if (!payload) payload = bytes.subarray(start, end);
    output.push(id, ...encode(payload.length));
    for (const byte of payload) output.push(byte);
    position = end;
  }
  if (!codeSeen || !globalsSeen) throw new Error("Incomplete JBIG2 WASM module.");
  const result = Uint8Array.from(output);
  if (!WebAssembly.validate(result)) throw new Error("Invalid instrumented JBIG2 WASM.");
  return { bytes: limitWasmMemory(result, 8192), functions, loops, batchSize: 1024 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: node scripts/lib/instrumentJbig2Wasm.mjs INPUT.wasm OUTPUT.wasm");
  const result = instrumentJbig2Wasm(await readFile(input));
  await writeFile(output, result.bytes);
  console.log(`Instrumented ${result.functions} functions and ${result.loops} loops; ${result.bytes.length} bytes.`);
}
