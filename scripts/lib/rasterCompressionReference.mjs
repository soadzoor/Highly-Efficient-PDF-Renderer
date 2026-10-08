// Restricted CPU decoders for the modes emitted by the pinned GPUtex kernels.
// Adapted from library/src/bc7_ref.ts and library/src/astc4x4_ref.ts:
// https://github.com/verekia/gputex/tree/9ec9330dcf377c00e43f9fcc8ec9e6536911033c/library/src
// These test-only helpers are independent of the renderer's shader execution.
//
// MIT License
// Copyright (c) 2026 GPUtex contributors
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

const W2 = [0, 21, 43, 64];
const W3 = [0, 9, 18, 27, 37, 46, 55, 64];
const W4_BC7 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];

// A local quality yardstick: average error alone cannot hide large isolated errors.
export function measureRasterCompressionError(source, decoded) {
  if (source.length === 0 || source.length !== decoded.length || source.length % 4) {
    throw new RangeError("Compression quality comparisons require equal, nonempty RGBA images.");
  }
  let squaredError = 0, maxChannelError = 0, maxAlphaError = 0;
  for (let offset = 0; offset < source.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(source[offset + channel] - decoded[offset + channel]);
      squaredError += difference * difference;
      maxChannelError = Math.max(maxChannelError, difference);
    }
    maxAlphaError = Math.max(maxAlphaError, Math.abs(source[offset + 3] - decoded[offset + 3]));
  }
  const rgbRmse = Math.sqrt(squaredError / (source.length / 4 * 3));
  return { rgbRmse, maxChannelError, maxAlphaError,
    acceptable: rgbRmse <= 5 && maxChannelError <= 24 && maxAlphaError <= 1 };
}

export function decodeRasterCompressionBlock(format, block) {
  if (!(block instanceof Uint8Array) || block.length !== 16) throw new RangeError("A compressed block has 16 bytes.");
  if (format === "bc7") return decodeBc7(block);
  if (format === "astc-4x4") return decodeAstc(block);
  throw new RangeError("Unsupported reference compression format.");
}

function readBits(block, offset, count) {
  let value = 0;
  for (let index = 0; index < count; index++) value |= ((block[(offset + index) >> 3] >> ((offset + index) & 7)) & 1) << index;
  return value;
}

function decodeBc7(block) {
  let mode = 0;
  while (mode < 8 && !readBits(block, mode, 1)) mode++;
  if (mode !== 4 && mode !== 6) throw new RangeError("The pinned BC7 encoders emit modes 4 and 6.");
  const endpoints = [[], []];
  const out = new Uint8Array(64);
  if (mode === 6) {
    const p0 = readBits(block, 63, 1), p1 = readBits(block, 64, 1);
    for (let channel = 0; channel < 4; channel++) {
      endpoints[0][channel] = (readBits(block, 7 + channel * 14, 7) << 1) | p0;
      endpoints[1][channel] = (readBits(block, 14 + channel * 14, 7) << 1) | p1;
    }
    let position = 65;
    for (let pixel = 0; pixel < 16; pixel++) {
      const count = pixel === 0 ? 3 : 4, weight = W4_BC7[readBits(block, position, count)];
      position += count;
      for (let channel = 0; channel < 4; channel++) {
        out[pixel * 4 + channel] = ((64 - weight) * endpoints[0][channel] + weight * endpoints[1][channel] + 32) >> 6;
      }
    }
  } else {
    const rotation = readBits(block, 5, 2), selector = readBits(block, 7, 1);
    for (let channel = 0; channel < 3; channel++) {
      for (let endpoint = 0; endpoint < 2; endpoint++) {
        const code = readBits(block, 8 + channel * 10 + endpoint * 5, 5);
        endpoints[endpoint][channel] = (code << 3) | (code >> 2);
      }
    }
    for (let endpoint = 0; endpoint < 2; endpoint++) {
      const code = readBits(block, 38 + endpoint * 6, 6);
      endpoints[endpoint][3] = (code << 2) | (code >> 4);
    }
    let twoPosition = 50, threePosition = 81;
    for (let pixel = 0; pixel < 16; pixel++) {
      const twoBits = pixel === 0 ? 1 : 2, threeBits = pixel === 0 ? 2 : 3;
      const twoWeight = W2[readBits(block, twoPosition, twoBits)], threeWeight = W3[readBits(block, threePosition, threeBits)];
      twoPosition += twoBits;
      threePosition += threeBits;
      for (let channel = 0; channel < 4; channel++) {
        const weight = (channel === 3) === !!selector ? twoWeight : threeWeight;
        out[pixel * 4 + channel] = ((64 - weight) * endpoints[0][channel] + weight * endpoints[1][channel] + 32) >> 6;
      }
      if (rotation) {
        const color = pixel * 4 + rotation - 1, alpha = pixel * 4 + 3;
        const value = out[color]; out[color] = out[alpha]; out[alpha] = value;
      }
    }
  }
  return out;
}

function decodeAstc(block) {
  const mode = readBits(block, 0, 11), cem = readBits(block, 13, 4);
  if (readBits(block, 11, 2) !== 0) throw new RangeError("The pinned ASTC encoders use a single partition.");
  const weightBits = mode === 0x253 && cem === 0 ? 5 : mode === 0x053 && cem === 8 ? 3 :
    mode === 0x242 && cem === 8 ? 4 : mode === 0x042 && cem === 12 ? 2 : 0;
  if (!weightBits) throw new RangeError("Unsupported ASTC mode/CEM combination.");
  const count = cem === 0 ? 2 : cem === 8 ? 6 : 8;
  const values = [];
  if (mode === 0x242) {
    const slices = [[0, 2], [2, 2], [4, 1], [5, 2], [7, 1]];
    let position = 17;
    for (let group = 0; group < count; group += 5) {
      const codes = [];
      let tritField = 0;
      for (let index = 0; index < Math.min(5, count - group); index++) {
        codes.push(readBits(block, position, 6)); position += 6;
        const [start, size] = slices[index];
        tritField |= readBits(block, position, size) << start; position += size;
      }
      const trits = decodeTrits(tritField);
      for (let index = 0; index < codes.length; index++) {
        const code = codes[index], a = code & 1 ? 0x1ff : 0;
        const b = (((code >> 1) & 31) << 4) | (code >> 5);
        const value = ((trits[index] * 5 + b) ^ a) & 0x1ff;
        values.push(((a & 0x80) | (value >> 2)) & 255);
      }
    }
  } else for (let index = 0; index < count; index++) values.push(readBits(block, 17 + index * 8, 8));
  let low = cem === 0 ? [values[0], values[0], values[0], 255] : [values[0], values[2], values[4], cem === 12 ? values[6] : 255];
  let high = cem === 0 ? [values[1], values[1], values[1], 255] : [values[1], values[3], values[5], cem === 12 ? values[7] : 255];
  if (cem !== 0 && low[0] + low[1] + low[2] > high[0] + high[1] + high[2]) {
    const contract = value => [(value[0] + value[2]) >> 1, (value[1] + value[2]) >> 1, value[2], value[3]];
    const originalLow = low;
    low = contract(high); high = contract(originalLow);
  }
  const out = new Uint8Array(64);
  for (let pixel = 0; pixel < 16; pixel++) {
    let weight = 0;
    for (let bit = 0; bit < weightBits; bit++) weight |= readBits(block, 127 - weightBits * pixel - bit, 1) << bit;
    let unquantized;
    if (weightBits === 2) unquantized = W2[weight];
    else if (weightBits === 3) unquantized = W3[weight];
    else if (weightBits === 4) { const value = (weight << 2) | (weight >> 2); unquantized = value > 32 ? value + 1 : value; }
    else unquantized = weight < 16 ? weight * 2 : weight * 2 + 2;
    for (let channel = 0; channel < 4; channel++) {
      const value16 = ((64 - unquantized) * low[channel] * 257 + unquantized * high[channel] * 257 + 32) >> 6;
      out[pixel * 4 + channel] = Math.round(value16 / 257);
    }
  }
  return out;
}

function decodeTrits(value) {
  let c, t3, t4;
  if (((value >> 2) & 7) === 7) {
    c = (((value >> 5) & 7) << 2) | (value & 3); t3 = 2; t4 = 2;
  } else {
    c = value & 31;
    if (((value >> 5) & 3) === 3) { t4 = 2; t3 = (value >> 7) & 1; }
    else { t4 = (value >> 7) & 1; t3 = (value >> 5) & 3; }
  }
  let t0, t1, t2;
  if ((c & 3) === 3) {
    t2 = 2; t1 = (c >> 4) & 1; t0 = (((c >> 3) & 1) << 1) | (((c >> 2) & 1) & ~((c >> 3) & 1) & 1);
  } else if (((c >> 2) & 3) === 3) { t2 = 2; t1 = 2; t0 = c & 3; }
  else { t2 = (c >> 4) & 1; t1 = (c >> 2) & 3; t0 = (((c >> 1) & 1) << 1) | ((c & 1) & ~((c >> 1) & 1) & 1); }
  return [t0, t1, t2, t3, t4];
}
