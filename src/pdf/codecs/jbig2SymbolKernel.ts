// @ts-nocheck
// Adapted from PDF.js ef6ecee34c24069a3935cde968e23360d54fd872; metered symbol-preserving subset.
/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ArithmeticDecoder } from "./jbig2ArithmeticDecoder";
import { decodeNativeCcittFax } from "../nativeCcitt";
import { jbig2ResourceError } from "./jbig2Preflight";
import { throwIfAborted } from "../nativeTypes";

let budget = null;
const MAX_INT_32 = 2147483647, MIN_INT_32 = -2147483648;
const log2 = x => x > 0 ? Math.ceil(Math.log2(x)) : 0;
const readInt8 = (data, offset) => (data[offset] << 24) >> 24;
const readUint16 = (data, offset) => (data[offset] << 8) | data[offset + 1];
const readUint32 = (data, offset) => ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
const shadow = (object, name, value) => { tick();  Object.defineProperty(object, name, { value }); return value; };
class BaseException extends Error { constructor(message, name) { tick();  super(message); this.name = name; } }

class Jbig2Error extends BaseException {
  constructor(msg) { tick();
    super(msg, "Jbig2Error");
  }
}

// Utility data structures
class ContextCache {
  getContexts(id) { tick();
    if (id in this) {
      return this[id];
    }
    return (this[id] = allocate(Int8Array, 1 << 16));
  }
}

class DecodingContext {
  constructor(data, start, end) { tick();
    this.data = data;
    this.start = start;
    this.end = end;
  }

  get decoder() { tick();
    const decoder = (reserve(64), new ArithmeticDecoder(this.data, this.start, this.end));
    return shadow(this, "decoder", decoder);
  }

  get contextCache() { tick();
    const cache = (reserve(64), new ContextCache());
    return shadow(this, "contextCache", cache);
  }
}

// Annex A. Arithmetic Integer Decoding Procedure
// A.2 Procedure for decoding values
function decodeInteger(contextCache, procedure, decoder) { tick();
  const contexts = contextCache.getContexts(procedure);
  let prev = 1;

  function readBits(length) { tick();
    let v = 0;
    for (let i = 0; i < length; i++) { tick();
      const bit = decoder.readBit(contexts, prev);
      prev = prev < 256 ? (prev << 1) | bit : (((prev << 1) | bit) & 511) | 256;
      v = (v << 1) | bit;
    }
    return v >>> 0;
  }

  const sign = readBits(1);
  // prettier-ignore
  /* eslint-disable no-nested-ternary */
  const value = readBits(1) ?
                  (readBits(1) ?
                    (readBits(1) ?
                      (readBits(1) ?
                        (readBits(1) ?
                          (readBits(32) + 4436) :
                        readBits(12) + 340) :
                      readBits(8) + 84) :
                    readBits(6) + 20) :
                  readBits(4) + 4) :
                readBits(2);
  /* eslint-enable no-nested-ternary */
  let signedValue;
  if (sign === 0) {
    signedValue = value;
  } else if (value > 0) {
    signedValue = -value;
  }
  // Ensure that the integer value doesn't underflow or overflow.
  if (signedValue >= MIN_INT_32 && signedValue <= MAX_INT_32) {
    return signedValue;
  }
  return null;
}

// A.3 The IAID decoding procedure
function decodeIAID(contextCache, decoder, codeLength) { tick();
  const contexts = contextCache.getContexts("IAID");

  let prev = 1;
  for (let i = 0; i < codeLength; i++) { tick();
    const bit = decoder.readBit(contexts, prev);
    prev = (prev << 1) | bit;
  }
  if (codeLength < 31) {
    return prev & ((1 << codeLength) - 1);
  }
  return prev & 0x7fffffff;
}

// 7.3 Segment types
const SegmentTypes = array([
  "SymbolDictionary",
  null,
  null,
  null,
  "IntermediateTextRegion",
  null,
  "ImmediateTextRegion",
  "ImmediateLosslessTextRegion",
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  "PatternDictionary",
  null,
  null,
  null,
  "IntermediateHalftoneRegion",
  null,
  "ImmediateHalftoneRegion",
  "ImmediateLosslessHalftoneRegion",
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  "IntermediateGenericRegion",
  null,
  "ImmediateGenericRegion",
  "ImmediateLosslessGenericRegion",
  "IntermediateGenericRefinementRegion",
  null,
  "ImmediateGenericRefinementRegion",
  "ImmediateLosslessGenericRefinementRegion",
  null,
  null,
  null,
  null,
  "PageInformation",
  "EndOfPage",
  "EndOfStripe",
  "EndOfFile",
  "Profiles",
  "Tables",
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  "Extension",
]);

const CodingTemplates = array([
  array([
    { x: -1, y: -2 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
    { x: -2, y: -1 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 2, y: -1 },
    { x: -4, y: 0 },
    { x: -3, y: 0 },
    { x: -2, y: 0 },
    { x: -1, y: 0 },
  ]),
  array([
    { x: -1, y: -2 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
    { x: 2, y: -2 },
    { x: -2, y: -1 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 2, y: -1 },
    { x: -3, y: 0 },
    { x: -2, y: 0 },
    { x: -1, y: 0 },
  ]),
  array([
    { x: -1, y: -2 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
    { x: -2, y: -1 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -2, y: 0 },
    { x: -1, y: 0 },
  ]),
  array([
    { x: -3, y: -1 },
    { x: -2, y: -1 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -4, y: 0 },
    { x: -3, y: 0 },
    { x: -2, y: 0 },
    { x: -1, y: 0 },
  ]),
]);

const RefinementTemplates = array([
  {
    coding: array([
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
    ]),
    reference: array([
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]),
  },
  {
    coding: array([
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
    ]),
    reference: array([
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]),
  },
]);

// See 6.2.5.7 Decoding the bitmap.
const ReusedContexts = array([
  0x9b25, // 10011 0110010 0101
  0x0795, // 0011 110010 101
  0x00e5, // 001 11001 01
  0x0195, // 011001 0101
]);

const RefinementReusedContexts = array([
  0x0020, // '000' + '0' (coding) + '00010000' + '0' (reference)
  0x0008, // '0000' + '001000'
]);

function decodeBitmapTemplate0(width, height, decodingContext) { tick();
  const decoder = decodingContext.decoder;
  const contexts = decodingContext.contextCache.getContexts("GB");
  const bitmap = array([]);
  let contextLabel, i, j, pixel, row, row1, row2;

  // ...ooooo....
  // ..ooooooo... Context template for current pixel (X)
  // .ooooX...... (concatenate values of 'o'-pixels to get contextLabel)
  const OLD_PIXEL_MASK = 0x7bf7; // 01111 0111111 0111

  for (i = 0; i < height; i++) { tick();
    row = bitmap[i] = allocate(Uint8Array, width);
    row1 = i < 1 ? row : bitmap[i - 1];
    row2 = i < 2 ? row : bitmap[i - 2];

    // At the beginning of each row:
    // Fill contextLabel with pixels that are above/right of (X)
    contextLabel =
      (row2[0] << 13) |
      (row2[1] << 12) |
      (row2[2] << 11) |
      (row1[0] << 7) |
      (row1[1] << 6) |
      (row1[2] << 5) |
      (row1[3] << 4);

    for (j = 0; j < width; j++) { tick();
      row[j] = pixel = decoder.readBit(contexts, contextLabel);

      // At each pixel: Clear contextLabel pixels that are shifted
      // out of the context, then add new ones.
      contextLabel =
        ((contextLabel & OLD_PIXEL_MASK) << 1) |
        (j + 3 < width ? row2[j + 3] << 11 : 0) |
        (j + 4 < width ? row1[j + 4] << 4 : 0) |
        pixel;
    }
  }

  return bitmap;
}

// 6.2 Generic Region Decoding Procedure
function decodeBitmap(
  mmr,
  width,
  height,
  templateIndex,
  prediction,
  skip,
  at,
  decodingContext
) { tick();
  if (mmr) {
    const input = (reserve(64), new Reader(
      decodingContext.data,
      decodingContext.start,
      decodingContext.end
    ));
    return decodeMMRBitmap(input, width, height, false);
  }

  // Use optimized version for the most common case
  if (
    templateIndex === 0 &&
    !skip &&
    !prediction &&
    at.length === 4 &&
    at[0].x === 3 &&
    at[0].y === -1 &&
    at[1].x === -3 &&
    at[1].y === -1 &&
    at[2].x === 2 &&
    at[2].y === -2 &&
    at[3].x === -2 &&
    at[3].y === -2
  ) {
    return decodeBitmapTemplate0(width, height, decodingContext);
  }

  const useskip = !!skip;
  const template = concatenate(CodingTemplates[templateIndex], at);

  // Sorting is non-standard, and it is not required. But sorting increases
  // the number of template bits that can be reused from the previous
  // contextLabel in the main loop.
  template.sort(function (a, b) { tick();
    return a.y - b.y || a.x - b.x;
  });

  const templateLength = template.length;
  const templateX = allocate(Int8Array, templateLength);
  const templateY = allocate(Int8Array, templateLength);
  const changingTemplateEntries = array([]);
  let reuseMask = 0,
    minX = 0,
    maxX = 0,
    minY = 0;
  let c, k;

  for (k = 0; k < templateLength; k++) { tick();
    templateX[k] = template[k].x;
    templateY[k] = template[k].y;
    minX = Math.min(minX, template[k].x);
    maxX = Math.max(maxX, template[k].x);
    minY = Math.min(minY, template[k].y);
    // Check if the template pixel appears in two consecutive context labels,
    // so it can be reused. Otherwise, we add it to the list of changing
    // template entries.
    if (
      k < templateLength - 1 &&
      template[k].y === template[k + 1].y &&
      template[k].x === template[k + 1].x - 1
    ) {
      reuseMask |= 1 << (templateLength - 1 - k);
    } else {
      grow(changingTemplateEntries, k);
    }
  }
  const changingEntriesLength = changingTemplateEntries.length;

  const changingTemplateX = allocate(Int8Array, changingEntriesLength);
  const changingTemplateY = allocate(Int8Array, changingEntriesLength);
  const changingTemplateBit = (reserve(64), allocate(Uint16Array, changingEntriesLength));
  for (c = 0; c < changingEntriesLength; c++) { tick();
    k = changingTemplateEntries[c];
    changingTemplateX[c] = template[k].x;
    changingTemplateY[c] = template[k].y;
    changingTemplateBit[c] = 1 << (templateLength - 1 - k);
  }

  // Get the safe bounding box edges from the width, height, minX, maxX, minY
  const sbb_left = -minX;
  const sbb_top = -minY;
  const sbb_right = width - maxX;

  const pseudoPixelContext = ReusedContexts[templateIndex];
  let row = allocate(Uint8Array, width);
  const bitmap = array([]);

  const decoder = decodingContext.decoder;
  const contexts = decodingContext.contextCache.getContexts("GB");

  let ltp = 0,
    j,
    i0,
    j0,
    contextLabel = 0,
    bit,
    shift;
  for (let i = 0; i < height; i++) { tick();
    if (prediction) {
      const sltp = decoder.readBit(contexts, pseudoPixelContext);
      ltp ^= sltp;
      if (ltp) {
        grow(bitmap, row); // duplicate previous row
        continue;
      }
    }
    row = allocate(Uint8Array, row);
    grow(bitmap, row);
    for (j = 0; j < width; j++) { tick();
      if (useskip && skip[i][j]) {
        row[j] = 0;
        continue;
      }
      // Are we in the middle of a scanline, so we can reuse contextLabel
      // bits?
      if (j >= sbb_left && j < sbb_right && i >= sbb_top) {
        // If yes, we can just shift the bits that are reusable and only
        // fetch the remaining ones.
        contextLabel = (contextLabel << 1) & reuseMask;
        for (k = 0; k < changingEntriesLength; k++) { tick();
          i0 = i + changingTemplateY[k];
          j0 = j + changingTemplateX[k];
          bit = bitmap[i0][j0];
          if (bit) {
            bit = changingTemplateBit[k];
            contextLabel |= bit;
          }
        }
      } else {
        // compute the contextLabel from scratch
        contextLabel = 0;
        shift = templateLength - 1;
        for (k = 0; k < templateLength; k++, shift--) { tick();
          j0 = j + templateX[k];
          if (j0 >= 0 && j0 < width) {
            i0 = i + templateY[k];
            if (i0 >= 0) {
              bit = bitmap[i0][j0];
              if (bit) {
                contextLabel |= bit << shift;
              }
            }
          }
        }
      }
      const pixel = decoder.readBit(contexts, contextLabel);
      row[j] = pixel;
    }
  }
  return bitmap;
}

// 6.3.2 Generic Refinement Region Decoding Procedure
function decodeRefinement(
  width,
  height,
  templateIndex,
  referenceBitmap,
  offsetX,
  offsetY,
  prediction,
  at,
  decodingContext
) { tick();
  let codingTemplate = RefinementTemplates[templateIndex].coding;
  if (templateIndex === 0) {
    reserve((codingTemplate.length + 1) * 16);
    codingTemplate = codingTemplate.concat(array([at[0]]));
  }
  const codingTemplateLength = codingTemplate.length;
  const codingTemplateX = allocate(Int32Array, codingTemplateLength);
  const codingTemplateY = allocate(Int32Array, codingTemplateLength);
  let k;
  for (k = 0; k < codingTemplateLength; k++) { tick();
    codingTemplateX[k] = codingTemplate[k].x;
    codingTemplateY[k] = codingTemplate[k].y;
  }

  let referenceTemplate = RefinementTemplates[templateIndex].reference;
  if (templateIndex === 0) {
    reserve((referenceTemplate.length + 1) * 16);
    referenceTemplate = referenceTemplate.concat(array([at[1]]));
  }
  const referenceTemplateLength = referenceTemplate.length;
  const referenceTemplateX = allocate(Int32Array, referenceTemplateLength);
  const referenceTemplateY = allocate(Int32Array, referenceTemplateLength);
  for (k = 0; k < referenceTemplateLength; k++) { tick();
    referenceTemplateX[k] = referenceTemplate[k].x;
    referenceTemplateY[k] = referenceTemplate[k].y;
  }
  const referenceWidth = referenceBitmap[0].length;
  const referenceHeight = referenceBitmap.length;

  const pseudoPixelContext = RefinementReusedContexts[templateIndex];
  const bitmap = array([]);

  const decoder = decodingContext.decoder;
  const contexts = decodingContext.contextCache.getContexts("GR");

  let ltp = 0;
  for (let i = 0; i < height; i++) { tick();
    if (prediction) {
      const sltp = decoder.readBit(contexts, pseudoPixelContext);
      ltp ^= sltp;
      if (ltp) {
        throw (reserve(64), new Jbig2Error("prediction is not supported"));
      }
    }
    const row = allocate(Uint8Array, width);
    grow(bitmap, row);
    for (let j = 0; j < width; j++) { tick();
      let i0, j0;
      let contextLabel = 0;
      for (k = 0; k < codingTemplateLength; k++) { tick();
        i0 = i + codingTemplateY[k];
        j0 = j + codingTemplateX[k];
        if (i0 < 0 || j0 < 0 || j0 >= width) {
          contextLabel <<= 1; // out of bound pixel
        } else {
          contextLabel = (contextLabel << 1) | bitmap[i0][j0];
        }
      }
      for (k = 0; k < referenceTemplateLength; k++) { tick();
        i0 = i + referenceTemplateY[k] - offsetY;
        j0 = j + referenceTemplateX[k] - offsetX;
        if (i0 < 0 || i0 >= referenceHeight || j0 < 0 || j0 >= referenceWidth) {
          contextLabel <<= 1; // out of bound pixel
        } else {
          contextLabel = (contextLabel << 1) | referenceBitmap[i0][j0];
        }
      }
      const pixel = decoder.readBit(contexts, contextLabel);
      row[j] = pixel;
    }
  }

  return bitmap;
}

// 6.5.5 Decoding the symbol dictionary
function decodeSymbolDictionary(
  huffman,
  refinement,
  symbols,
  numberOfNewSymbols,
  numberOfExportedSymbols,
  huffmanTables,
  templateIndex,
  at,
  refinementTemplateIndex,
  refinementAt,
  decodingContext,
  huffmanInput
) { tick();
  if (huffman && refinement) {
    throw (reserve(64), new Jbig2Error("symbol refinement with Huffman is not supported"));
  }

  const newSymbols = array([]);
  let currentHeight = 0;
  let symbolCodeLength = log2(symbols.length + numberOfNewSymbols);

  const decoder = decodingContext.decoder;
  const contextCache = decodingContext.contextCache;
  let tableB1, symbolWidths;
  if (huffman) {
    tableB1 = getStandardTable(1); // standard table B.1
    symbolWidths = array([]);
    symbolCodeLength = Math.max(symbolCodeLength, 1); // 6.5.8.2.3
  }

  while (newSymbols.length < numberOfNewSymbols) { tick();
    const deltaHeight = huffman
      ? huffmanTables.tableDeltaHeight.decode(huffmanInput)
      : decodeInteger(contextCache, "IADH", decoder); // 6.5.6
    currentHeight += deltaHeight;
    let currentWidth = 0,
      totalWidth = 0;
    const firstSymbol = huffman ? symbolWidths.length : 0;
    while (true) { tick();
      const deltaWidth = huffman
        ? huffmanTables.tableDeltaWidth.decode(huffmanInput)
        : decodeInteger(contextCache, "IADW", decoder); // 6.5.7
      if (deltaWidth === null) {
        break; // OOB
      }
      currentWidth += deltaWidth;
      totalWidth += currentWidth;
      let bitmap;
      if (refinement) {
        // 6.5.8.2 Refinement/aggregate-coded symbol bitmap
        const numberOfInstances = decodeInteger(contextCache, "IAAI", decoder);
        if (numberOfInstances > 1) {
          bitmap = decodeTextRegion(
            huffman,
            refinement,
            currentWidth,
            currentHeight,
            0,
            numberOfInstances,
            1, // strip size
            concatenate(symbols, newSymbols),
            symbolCodeLength,
            0, // transposed
            0, // ds offset
            1, // top left 7.4.3.1.1
            0, // OR operator
            huffmanTables,
            refinementTemplateIndex,
            refinementAt,
            decodingContext,
            0,
            huffmanInput
          );
        } else {
          const symbolId = decodeIAID(contextCache, decoder, symbolCodeLength);
          const rdx = decodeInteger(contextCache, "IARDX", decoder); // 6.4.11.3
          const rdy = decodeInteger(contextCache, "IARDY", decoder); // 6.4.11.4
          const symbol =
            symbolId < symbols.length
              ? symbols[symbolId]
              : newSymbols[symbolId - symbols.length];
          bitmap = decodeRefinement(
            currentWidth,
            currentHeight,
            refinementTemplateIndex,
            symbol,
            rdx,
            rdy,
            false,
            refinementAt,
            decodingContext
          );
        }
        grow(newSymbols, bitmap);
      } else if (huffman) {
        // Store only symbol width and decode a collective bitmap when the
        // height class is done.
        grow(symbolWidths, currentWidth);
      } else {
        // 6.5.8.1 Direct-coded symbol bitmap
        bitmap = decodeBitmap(
          false,
          currentWidth,
          currentHeight,
          templateIndex,
          false,
          null,
          at,
          decodingContext
        );
        grow(newSymbols, bitmap);
      }
    }
    if (huffman && !refinement) {
      // 6.5.9 Height class collective bitmap
      const bitmapSize = huffmanTables.tableBitmapSize.decode(huffmanInput);
      huffmanInput.byteAlign();
      let collectiveBitmap;
      if (bitmapSize === 0) {
        // Uncompressed collective bitmap
        collectiveBitmap = readUncompressedBitmap(
          huffmanInput,
          totalWidth,
          currentHeight
        );
      } else {
        // MMR collective bitmap
        const originalEnd = huffmanInput.end;
        const bitmapEnd = huffmanInput.position + bitmapSize;
        huffmanInput.end = bitmapEnd;
        collectiveBitmap = decodeMMRBitmap(
          huffmanInput,
          totalWidth,
          currentHeight,
          false
        );
        huffmanInput.end = originalEnd;
        huffmanInput.position = bitmapEnd;
      }
      const numberOfSymbolsDecoded = symbolWidths.length;
      if (firstSymbol === numberOfSymbolsDecoded - 1) {
        // collectiveBitmap is a single symbol.
        grow(newSymbols, collectiveBitmap);
      } else {
        // Divide collectiveBitmap into symbols.
        let i,
          y,
          xMin = 0,
          xMax,
          bitmapWidth,
          symbolBitmap;
        for (i = firstSymbol; i < numberOfSymbolsDecoded; i++) { tick();
          bitmapWidth = symbolWidths[i];
          xMax = xMin + bitmapWidth;
          symbolBitmap = array([]);
          for (y = 0; y < currentHeight; y++) { tick();
            grow(symbolBitmap, collectiveBitmap[y].subarray(xMin, xMax));
          }
          grow(newSymbols, symbolBitmap);
          xMin = xMax;
        }
      }
    }
  }

  // 6.5.10 Exported symbols
  const exportedSymbols = array([]),
    flags = array([]);
  let currentFlag = false,
    i,
    ii;
  const totalSymbolsLength = symbols.length + numberOfNewSymbols;
  while (flags.length < totalSymbolsLength) { tick();
    let runLength = huffman
      ? tableB1.decode(huffmanInput)
      : decodeInteger(contextCache, "IAEX", decoder);
    if (!Number.isSafeInteger(runLength) || runLength < 0 || runLength > totalSymbolsLength - flags.length) throw (reserve(64), new Jbig2Error("invalid export run"));
    while (runLength--) { tick();
      grow(flags, currentFlag);
    }
    currentFlag = !currentFlag;
  }
  for (i = 0, ii = symbols.length; i < ii; i++) { tick();
    if (flags[i]) {
      grow(exportedSymbols, symbols[i]);
    }
  }
  for (let j = 0; j < numberOfNewSymbols; i++, j++) { tick();
    if (flags[i]) {
      grow(exportedSymbols, newSymbols[j]);
    }
  }
  if (newSymbols.length !== numberOfNewSymbols || exportedSymbols.length !== numberOfExportedSymbols) {
    throw (reserve(64), new Jbig2Error("symbol dictionary count mismatch"));
  }
  return exportedSymbols;
}

function decodeTextRegion(
  huffman,
  refinement,
  width,
  height,
  defaultPixelValue,
  numberOfSymbolInstances,
  stripSize,
  inputSymbols,
  symbolCodeLength,
  transposed,
  dsOffset,
  referenceCorner,
  combinationOperator,
  huffmanTables,
  refinementTemplateIndex,
  refinementAt,
  decodingContext,
  logStripSize,
  huffmanInput,
  collect
) { tick();
  if (huffman && refinement) {
    throw (reserve(64), new Jbig2Error("refinement with Huffman is not supported"));
  }

  // Prepare bitmap
  const bitmap = array([]);
  let i, row;
  for (i = 0; !collect && i < height; i++) { tick();
    row = allocate(Uint8Array, width);
    if (defaultPixelValue) {
      for (let j = 0; j < width; j++) { tick();
        row[j] = defaultPixelValue;
      }
    }
    grow(bitmap, row);
  }

  const decoder = decodingContext.decoder;
  const contextCache = decodingContext.contextCache;

  let stripT = huffman
    ? -huffmanTables.tableDeltaT.decode(huffmanInput)
    : -decodeInteger(contextCache, "IADT", decoder); // 6.4.6
  let firstS = 0;
  i = 0;
  while (i < numberOfSymbolInstances) { tick();
    const deltaT = huffman
      ? huffmanTables.tableDeltaT.decode(huffmanInput)
      : decodeInteger(contextCache, "IADT", decoder); // 6.4.6
    stripT += deltaT;

    const deltaFirstS = huffman
      ? huffmanTables.tableFirstS.decode(huffmanInput)
      : decodeInteger(contextCache, "IAFS", decoder); // 6.4.7
    firstS += deltaFirstS;
    let currentS = firstS;
    do { tick();
      if (i >= numberOfSymbolInstances) throw (reserve(64), new Jbig2Error("excess text instances"));
      let currentT = 0; // 6.4.9
      if (stripSize > 1) {
        currentT = huffman
          ? huffmanInput.readBits(logStripSize)
          : decodeInteger(contextCache, "IAIT", decoder);
      }
      const t = stripSize * stripT + currentT;
      const symbolId = huffman
        ? huffmanTables.symbolIDTable.decode(huffmanInput)
        : decodeIAID(contextCache, decoder, symbolCodeLength);
      const applyRefinement =
        refinement &&
        (huffman
          ? huffmanInput.readBit()
          : decodeInteger(contextCache, "IARI", decoder));
      let symbolBitmap = inputSymbols[symbolId];
      let symbolWidth = symbolBitmap[0].length;
      let symbolHeight = symbolBitmap.length;
      if (applyRefinement) {
        const rdw = decodeInteger(contextCache, "IARDW", decoder); // 6.4.11.1
        const rdh = decodeInteger(contextCache, "IARDH", decoder); // 6.4.11.2
        const rdx = decodeInteger(contextCache, "IARDX", decoder); // 6.4.11.3
        const rdy = decodeInteger(contextCache, "IARDY", decoder); // 6.4.11.4
        symbolWidth += rdw;
        symbolHeight += rdh;
        symbolBitmap = decodeRefinement(
          symbolWidth,
          symbolHeight,
          refinementTemplateIndex,
          symbolBitmap,
          (rdw >> 1) + rdx,
          (rdh >> 1) + rdy,
          false,
          refinementAt,
          decodingContext
        );
      }

      let increment = 0;
      if (!transposed) {
        if (referenceCorner > 1) {
          currentS += symbolWidth - 1;
        } else {
          increment = symbolWidth - 1;
        }
      } else if (!(referenceCorner & 1)) {
        currentS += symbolHeight - 1;
      } else {
        increment = symbolHeight - 1;
      }

      const offsetT = t - (referenceCorner & 1 ? 0 : symbolHeight - 1);
      const offsetS = currentS - (referenceCorner & 2 ? symbolWidth - 1 : 0);
      let s2, t2, symbolRow;
      if (collect) {
        collect(symbolBitmap, transposed ? offsetT : offsetS, transposed ? offsetS : offsetT);
      } else if (transposed) {
        // Place Symbol Bitmap from T1,S1
        for (s2 = 0; s2 < symbolHeight; s2++) { tick();
          row = bitmap[offsetS + s2];
          if (!row) {
            continue;
          }
          symbolRow = symbolBitmap[s2];
          // To ignore Parts of Symbol bitmap which goes
          // outside bitmap region
          const maxWidth = Math.min(width - offsetT, symbolWidth);
          switch (combinationOperator) {
            case 0: // OR
              for (t2 = 0; t2 < maxWidth; t2++) { tick();
                row[offsetT + t2] |= symbolRow[t2];
              }
              break;
            case 2: // XOR
              for (t2 = 0; t2 < maxWidth; t2++) { tick();
                row[offsetT + t2] ^= symbolRow[t2];
              }
              break;
            default:
              throw (reserve(64), new Jbig2Error(
                `operator ${combinationOperator} is not supported`
              ));
          }
        }
      } else {
        for (t2 = 0; t2 < symbolHeight; t2++) { tick();
          row = bitmap[offsetT + t2];
          if (!row) {
            continue;
          }
          symbolRow = symbolBitmap[t2];
          switch (combinationOperator) {
            case 0: // OR
              for (s2 = 0; s2 < symbolWidth; s2++) { tick();
                row[offsetS + s2] |= symbolRow[s2];
              }
              break;
            case 2: // XOR
              for (s2 = 0; s2 < symbolWidth; s2++) { tick();
                row[offsetS + s2] ^= symbolRow[s2];
              }
              break;
            default:
              throw (reserve(64), new Jbig2Error(
                `operator ${combinationOperator} is not supported`
              ));
          }
        }
      }
      i++;
      const deltaS = huffman
        ? huffmanTables.tableDeltaS.decode(huffmanInput)
        : decodeInteger(contextCache, "IADS", decoder); // 6.4.8
      if (deltaS === null) {
        break; // OOB
      }
      currentS += increment + deltaS + dsOffset;
    } while (true);
  }
  return bitmap;
}

function decodePatternDictionary(
  mmr,
  patternWidth,
  patternHeight,
  maxPatternIndex,
  template,
  decodingContext
) { tick();
  const at = array([]);
  if (!mmr) {
    grow(at, {
      x: -patternWidth,
      y: 0,
    });
    if (template === 0) {
      grow(at,
        {
          x: -3,
          y: -1,
        },
        {
          x: 2,
          y: -2,
        },
        {
          x: -2,
          y: -2,
        }
      );
    }
  }
  const collectiveWidth = (maxPatternIndex + 1) * patternWidth;
  const collectiveBitmap = decodeBitmap(
    mmr,
    collectiveWidth,
    patternHeight,
    template,
    false,
    null,
    at,
    decodingContext
  );
  // Divide collective bitmap into patterns.
  const patterns = array([]);
  for (let i = 0; i <= maxPatternIndex; i++) { tick();
    const patternBitmap = array([]);
    const xMin = patternWidth * i;
    const xMax = xMin + patternWidth;
    for (let y = 0; y < patternHeight; y++) { tick();
      grow(patternBitmap, collectiveBitmap[y].subarray(xMin, xMax));
    }
    grow(patterns, patternBitmap);
  }
  return patterns;
}

function decodeHalftoneRegion(
  mmr,
  patterns,
  template,
  regionWidth,
  regionHeight,
  defaultPixelValue,
  enableSkip,
  combinationOperator,
  gridWidth,
  gridHeight,
  gridOffsetX,
  gridOffsetY,
  gridVectorX,
  gridVectorY,
  decodingContext
) { tick();
  const skip = null;
  if (enableSkip) {
    throw (reserve(64), new Jbig2Error("skip is not supported"));
  }
  if (combinationOperator !== 0) {
    throw (reserve(64), new Jbig2Error(
      `operator "${combinationOperator}" is not supported in halftone region`
    ));
  }

  // Prepare bitmap.
  const regionBitmap = array([]);
  let i, j, row;
  for (i = 0; i < regionHeight; i++) { tick();
    row = allocate(Uint8Array, regionWidth);
    if (defaultPixelValue) {
      for (j = 0; j < regionWidth; j++) { tick();
        row[j] = defaultPixelValue;
      }
    }
    grow(regionBitmap, row);
  }

  const numberOfPatterns = patterns.length;
  const pattern0 = patterns[0];
  const patternWidth = pattern0[0].length,
    patternHeight = pattern0.length;
  const bitsPerValue = log2(numberOfPatterns);
  const at = array([]);
  if (!mmr) {
    grow(at, {
      x: template <= 1 ? 3 : 2,
      y: -1,
    });
    if (template === 0) {
      grow(at,
        {
          x: -3,
          y: -1,
        },
        {
          x: 2,
          y: -2,
        },
        {
          x: -2,
          y: -2,
        }
      );
    }
  }
  // Annex C. Gray-scale Image Decoding Procedure.
  const grayScaleBitPlanes = array([]);
  let mmrInput, bitmap;
  if (mmr) {
    // MMR bit planes are in one continuous stream. Only EOFB codes indicate
    // the end of each bitmap, so EOFBs must be decoded.
    mmrInput = (reserve(64), new Reader(
      decodingContext.data,
      decodingContext.start,
      decodingContext.end
    ));
  }
  for (i = bitsPerValue - 1; i >= 0; i--) { tick();
    if (mmr) {
      bitmap = decodeMMRBitmap(mmrInput, gridWidth, gridHeight, true);
    } else {
      bitmap = decodeBitmap(
        false,
        gridWidth,
        gridHeight,
        template,
        false,
        skip,
        at,
        decodingContext
      );
    }
    grayScaleBitPlanes[i] = bitmap;
  }
  // 6.6.5.2 Rendering the patterns.
  let mg, ng, bit, patternIndex, patternBitmap, x, y, patternRow, regionRow;
  for (mg = 0; mg < gridHeight; mg++) { tick();
    for (ng = 0; ng < gridWidth; ng++) { tick();
      bit = 0;
      patternIndex = 0;
      for (j = bitsPerValue - 1; j >= 0; j--) { tick();
        bit ^= grayScaleBitPlanes[j][mg][ng]; // Gray decoding
        patternIndex |= bit << j;
      }
      patternBitmap = patterns[patternIndex];
      x = (gridOffsetX + mg * gridVectorY + ng * gridVectorX) >> 8;
      y = (gridOffsetY + mg * gridVectorX - ng * gridVectorY) >> 8;
      // Draw patternBitmap at (x, y).
      if (
        x >= 0 &&
        x + patternWidth <= regionWidth &&
        y >= 0 &&
        y + patternHeight <= regionHeight
      ) {
        for (i = 0; i < patternHeight; i++) { tick();
          regionRow = regionBitmap[y + i];
          patternRow = patternBitmap[i];
          for (j = 0; j < patternWidth; j++) { tick();
            regionRow[x + j] |= patternRow[j];
          }
        }
      } else {
        let regionX, regionY;
        for (i = 0; i < patternHeight; i++) { tick();
          regionY = y + i;
          if (regionY < 0 || regionY >= regionHeight) {
            continue;
          }
          regionRow = regionBitmap[regionY];
          patternRow = patternBitmap[i];
          for (j = 0; j < patternWidth; j++) { tick();
            regionX = x + j;
            if (regionX >= 0 && regionX < regionWidth) {
              regionRow[regionX] |= patternRow[j];
            }
          }
        }
      }
    }
  }
  return regionBitmap;
}

function readSegmentHeader(data, start) { tick();
  const segmentHeader = {};
  segmentHeader.number = readUint32(data, start);
  const flags = data[start + 4];
  const segmentType = flags & 0x3f;
  if (!SegmentTypes[segmentType]) {
    throw (reserve(64), new Jbig2Error("invalid segment type: " + segmentType));
  }
  segmentHeader.type = segmentType;
  segmentHeader.typeName = SegmentTypes[segmentType];
  segmentHeader.deferredNonRetain = !!(flags & 0x80);

  const pageAssociationFieldSize = !!(flags & 0x40);
  const referredFlags = data[start + 5];
  let referredToCount = (referredFlags >> 5) & 7;
  const retainBits = array([referredFlags & 31]);
  let position = start + 6;
  if (referredToCount === 7) {
    referredToCount = readUint32(data, position - 1) & 0x1fffffff;
    position += 3;
    let bytes = Math.ceil((referredToCount + 1) / 8);
    retainBits[0] = data[position++];
    while (--bytes > 0) { tick();
      grow(retainBits, data[position++]);
    }
  } else if (referredToCount === 5 || referredToCount === 6) {
    throw (reserve(64), new Jbig2Error("invalid referred-to flags"));
  }

  segmentHeader.retainBits = retainBits;

  let referredToSegmentNumberSize = 4;
  if (segmentHeader.number <= 256) {
    referredToSegmentNumberSize = 1;
  } else if (segmentHeader.number <= 65536) {
    referredToSegmentNumberSize = 2;
  }
  const referredTo = array([]);
  let i, ii;
  for (i = 0; i < referredToCount; i++) { tick();
    let number;
    if (referredToSegmentNumberSize === 1) {
      number = data[position];
    } else if (referredToSegmentNumberSize === 2) {
      number = readUint16(data, position);
    } else {
      number = readUint32(data, position);
    }
    grow(referredTo, number);
    position += referredToSegmentNumberSize;
  }
  segmentHeader.referredTo = referredTo;
  if (!pageAssociationFieldSize) {
    segmentHeader.pageAssociation = data[position++];
  } else {
    segmentHeader.pageAssociation = readUint32(data, position);
    position += 4;
  }
  segmentHeader.length = readUint32(data, position);
  position += 4;

  if (segmentHeader.length === 0xffffffff) {
    // 7.2.7 Segment data length, unknown segment length
    if (segmentType === 38) {
      // ImmediateGenericRegion
      const genericRegionInfo = readRegionSegmentInformation(data, position);
      const genericRegionSegmentFlags =
        data[position + RegionSegmentInformationFieldLength];
      const genericRegionMmr = !!(genericRegionSegmentFlags & 1);
      // searching for the segment end
      const searchPatternLength = 6;
      const searchPattern = allocate(Uint8Array, searchPatternLength);
      if (!genericRegionMmr) {
        searchPattern[0] = 0xff;
        searchPattern[1] = 0xac;
      }
      searchPattern[2] = (genericRegionInfo.height >>> 24) & 0xff;
      searchPattern[3] = (genericRegionInfo.height >> 16) & 0xff;
      searchPattern[4] = (genericRegionInfo.height >> 8) & 0xff;
      searchPattern[5] = genericRegionInfo.height & 0xff;
      for (i = position, ii = data.length; i < ii; i++) { tick();
        let j = 0;
        while (j < searchPatternLength && searchPattern[j] === data[i + j]) { tick();
          j++;
        }
        if (j === searchPatternLength) {
          segmentHeader.length = i + searchPatternLength;
          break;
        }
      }
      if (segmentHeader.length === 0xffffffff) {
        throw (reserve(64), new Jbig2Error("segment end was not found"));
      }
    } else {
      throw (reserve(64), new Jbig2Error("invalid unknown segment length"));
    }
  }
  segmentHeader.headerEnd = position;
  return segmentHeader;
}

function readSegments(header, data, start, end) { tick();
  const segments = array([]);
  let position = start;
  while (position < end) { tick();
    const segmentHeader = readSegmentHeader(data, position);
    position = segmentHeader.headerEnd;
    const segment = {
      header: segmentHeader,
      data,
    };
    if (!header.randomAccess) {
      segment.start = position;
      position += segmentHeader.length;
      segment.end = position;
    }
    grow(segments, segment);
    if (segmentHeader.type === 51) {
      break; // end of file is found
    }
  }
  if (header.randomAccess) {
    for (let i = 0, ii = segments.length; i < ii; i++) { tick();
      segments[i].start = position;
      position += segments[i].header.length;
      segments[i].end = position;
    }
  }
  return segments;
}

// 7.4.1 Region segment information field
function readRegionSegmentInformation(data, start) { tick();
  return {
    width: readUint32(data, start),
    height: readUint32(data, start + 4),
    x: readUint32(data, start + 8),
    y: readUint32(data, start + 12),
    combinationOperator: data[start + 16] & 7,
  };
}
const RegionSegmentInformationFieldLength = 17;

function processSegment(segment, visitor) { tick();
  const header = segment.header;

  const data = segment.data,
    end = segment.end;
  let position = segment.start;
  let args, at, i, atLength;
  switch (header.type) {
    case 0: // SymbolDictionary
      // 7.4.2 Symbol dictionary segment syntax
      const dictionary = {};
      const dictionaryFlags = readUint16(data, position); // 7.4.2.1.1
      dictionary.huffman = !!(dictionaryFlags & 1);
      dictionary.refinement = !!(dictionaryFlags & 2);
      dictionary.huffmanDHSelector = (dictionaryFlags >> 2) & 3;
      dictionary.huffmanDWSelector = (dictionaryFlags >> 4) & 3;
      dictionary.bitmapSizeSelector = (dictionaryFlags >> 6) & 1;
      dictionary.aggregationInstancesSelector = (dictionaryFlags >> 7) & 1;
      dictionary.bitmapCodingContextUsed = !!(dictionaryFlags & 256);
      dictionary.bitmapCodingContextRetained = !!(dictionaryFlags & 512);
      dictionary.template = (dictionaryFlags >> 10) & 3;
      dictionary.refinementTemplate = (dictionaryFlags >> 12) & 1;
      position += 2;
      if (!dictionary.huffman) {
        atLength = dictionary.template === 0 ? 4 : 1;
        at = array([]);
        for (i = 0; i < atLength; i++) { tick();
          grow(at, {
            x: readInt8(data, position),
            y: readInt8(data, position + 1),
          });
          position += 2;
        }
        dictionary.at = at;
      }
      if (dictionary.refinement && !dictionary.refinementTemplate) {
        at = array([]);
        for (i = 0; i < 2; i++) { tick();
          grow(at, {
            x: readInt8(data, position),
            y: readInt8(data, position + 1),
          });
          position += 2;
        }
        dictionary.refinementAt = at;
      }
      dictionary.numberOfExportedSymbols = readUint32(data, position);
      position += 4;
      dictionary.numberOfNewSymbols = readUint32(data, position);
      position += 4;
      args = array([
        dictionary,
        header.number,
        header.referredTo,
        data,
        position,
        end,
      ]);
      break;
    case 6: // ImmediateTextRegion
    case 7: // ImmediateLosslessTextRegion
      const textRegion = {};
      textRegion.info = readRegionSegmentInformation(data, position);
      position += RegionSegmentInformationFieldLength;
      const textRegionSegmentFlags = readUint16(data, position);
      position += 2;
      textRegion.huffman = !!(textRegionSegmentFlags & 1);
      textRegion.refinement = !!(textRegionSegmentFlags & 2);
      textRegion.logStripSize = (textRegionSegmentFlags >> 2) & 3;
      textRegion.stripSize = 1 << textRegion.logStripSize;
      textRegion.referenceCorner = (textRegionSegmentFlags >> 4) & 3;
      textRegion.transposed = !!(textRegionSegmentFlags & 64);
      textRegion.combinationOperator = (textRegionSegmentFlags >> 7) & 3;
      textRegion.defaultPixelValue = (textRegionSegmentFlags >> 9) & 1;
      textRegion.dsOffset = (textRegionSegmentFlags << 17) >> 27;
      textRegion.refinementTemplate = (textRegionSegmentFlags >> 15) & 1;
      if (textRegion.huffman) {
        const textRegionHuffmanFlags = readUint16(data, position);
        position += 2;
        textRegion.huffmanFS = textRegionHuffmanFlags & 3;
        textRegion.huffmanDS = (textRegionHuffmanFlags >> 2) & 3;
        textRegion.huffmanDT = (textRegionHuffmanFlags >> 4) & 3;
        textRegion.huffmanRefinementDW = (textRegionHuffmanFlags >> 6) & 3;
        textRegion.huffmanRefinementDH = (textRegionHuffmanFlags >> 8) & 3;
        textRegion.huffmanRefinementDX = (textRegionHuffmanFlags >> 10) & 3;
        textRegion.huffmanRefinementDY = (textRegionHuffmanFlags >> 12) & 3;
        textRegion.huffmanRefinementSizeSelector = !!(
          textRegionHuffmanFlags & 0x4000
        );
      }
      if (textRegion.refinement && !textRegion.refinementTemplate) {
        at = array([]);
        for (i = 0; i < 2; i++) { tick();
          grow(at, {
            x: readInt8(data, position),
            y: readInt8(data, position + 1),
          });
          position += 2;
        }
        textRegion.refinementAt = at;
      }
      textRegion.numberOfSymbolInstances = readUint32(data, position);
      position += 4;
      args = array([textRegion, header.referredTo, data, position, end]);
      break;
    case 16: // PatternDictionary
      // 7.4.4. Pattern dictionary segment syntax
      const patternDictionary = {};
      const patternDictionaryFlags = data[position++];
      patternDictionary.mmr = !!(patternDictionaryFlags & 1);
      patternDictionary.template = (patternDictionaryFlags >> 1) & 3;
      patternDictionary.patternWidth = data[position++];
      patternDictionary.patternHeight = data[position++];
      patternDictionary.maxPatternIndex = readUint32(data, position);
      position += 4;
      args = array([patternDictionary, header.number, data, position, end]);
      break;
    case 22: // ImmediateHalftoneRegion
    case 23: // ImmediateLosslessHalftoneRegion
      // 7.4.5 Halftone region segment syntax
      const halftoneRegion = {};
      halftoneRegion.info = readRegionSegmentInformation(data, position);
      position += RegionSegmentInformationFieldLength;
      const halftoneRegionFlags = data[position++];
      halftoneRegion.mmr = !!(halftoneRegionFlags & 1);
      halftoneRegion.template = (halftoneRegionFlags >> 1) & 3;
      halftoneRegion.enableSkip = !!(halftoneRegionFlags & 8);
      halftoneRegion.combinationOperator = (halftoneRegionFlags >> 4) & 7;
      halftoneRegion.defaultPixelValue = (halftoneRegionFlags >> 7) & 1;
      halftoneRegion.gridWidth = readUint32(data, position);
      position += 4;
      halftoneRegion.gridHeight = readUint32(data, position);
      position += 4;
      halftoneRegion.gridOffsetX = readUint32(data, position) & 0xffffffff;
      position += 4;
      halftoneRegion.gridOffsetY = readUint32(data, position) & 0xffffffff;
      position += 4;
      halftoneRegion.gridVectorX = readUint16(data, position);
      position += 2;
      halftoneRegion.gridVectorY = readUint16(data, position);
      position += 2;
      args = array([halftoneRegion, header.referredTo, data, position, end]);
      break;
    case 38: // ImmediateGenericRegion
    case 39: // ImmediateLosslessGenericRegion
      const genericRegion = {};
      genericRegion.info = readRegionSegmentInformation(data, position);
      position += RegionSegmentInformationFieldLength;
      const genericRegionSegmentFlags = data[position++];
      genericRegion.mmr = !!(genericRegionSegmentFlags & 1);
      genericRegion.template = (genericRegionSegmentFlags >> 1) & 3;
      genericRegion.prediction = !!(genericRegionSegmentFlags & 8);
      if (!genericRegion.mmr) {
        atLength = genericRegion.template === 0 ? 4 : 1;
        at = array([]);
        for (i = 0; i < atLength; i++) { tick();
          grow(at, {
            x: readInt8(data, position),
            y: readInt8(data, position + 1),
          });
          position += 2;
        }
        genericRegion.at = at;
      }
      args = array([genericRegion, data, position, end]);
      break;
    case 48: // PageInformation
      const pageInfo = {
        width: readUint32(data, position),
        height: readUint32(data, position + 4),
        resolutionX: readUint32(data, position + 8),
        resolutionY: readUint32(data, position + 12),
      };
      if (pageInfo.height === 0xffffffff) {
        delete pageInfo.height;
      }
      const pageSegmentFlags = data[position + 16];
      readUint16(data, position + 17); // pageStripingInformation
      pageInfo.lossless = !!(pageSegmentFlags & 1);
      pageInfo.refinement = !!(pageSegmentFlags & 2);
      pageInfo.defaultPixelValue = (pageSegmentFlags >> 2) & 1;
      pageInfo.combinationOperator = (pageSegmentFlags >> 3) & 3;
      pageInfo.requiresBuffer = !!(pageSegmentFlags & 32);
      pageInfo.combinationOperatorOverride = !!(pageSegmentFlags & 64);
      args = array([pageInfo]);
      break;
    case 49: // EndOfPage
      break;
    case 50: // EndOfStripe
      break;
    case 51: // EndOfFile
      break;
    case 53: // Tables
      args = array([header.number, data, position, end]);
      break;
    case 62: // 7.4.15 defines 2 extension types which
      // are comments and can be ignored.
      break;
    default:
      throw (reserve(64), new Jbig2Error(
        `segment type ${header.typeName}(${header.type}) is not implemented`
      ));
  }
  const callbackName = "on" + header.typeName;
  if (callbackName in visitor) {
    // eslint-disable-next-line prefer-spread
    visitor[callbackName].apply(visitor, args);
  }
}

function processSegments(segments, visitor) { tick();
  for (let i = 0, ii = segments.length; i < ii; i++) { tick();
    processSegment(segments[i], visitor);
  }
}

class SimpleSegmentVisitor {
  onPageInformation(info) { tick();
    this.currentPageInfo = info;
    const rowSize = (info.width + 7) >> 3;
    const buffer = allocate(Uint8ClampedArray, rowSize * info.height);
    // The contents of ArrayBuffers are initialized to 0.
    // Fill the buffer with 0xFF only if info.defaultPixelValue is set
    if (info.defaultPixelValue) {
      buffer.fill(0xff);
    }
    this.buffer = buffer;
  }

  checkComposition(info) { tick();
    const page = this.currentPageInfo;
    if (!page || page.defaultPixelValue || (page.combinationOperatorOverride ? info.combinationOperator : page.combinationOperator) !== 0)
      throw (reserve(64), new Jbig2Error("unsupported page composition"));
  }

  drawBitmap(info, bitmap) { tick();
    this.checkComposition(info);
    const page = this.currentPageInfo, stride = Math.ceil(page.width / 8);
    const x = info.x | 0, y = info.y | 0;
    for (let sy = Math.max(0, -y); sy < Math.min(info.height, page.height - y); sy++) { tick();
      for (let sx = Math.max(0, -x); sx < Math.min(info.width, page.width - x); sx++) { tick();
        if (bitmap[sy][sx]) this.buffer[(y + sy) * stride + ((x + sx) >> 3)] |= 128 >> ((x + sx) & 7);
      }
    }
  }

  collectSymbol(info, bitmap, x, y) { tick();
    const page = this.currentPageInfo, ox = info.x | 0, oy = info.y | 0;
    if (!array([x, y]).every(Number.isSafeInteger)) throw (reserve(64), new Jbig2Error("invalid symbol position"));
    const left = Math.max(0, -x, -ox - x), top = Math.max(0, -y, -oy - y);
    const width = Math.min(bitmap[0].length, info.width - x, page.width - ox - x) - left;
    const height = Math.min(bitmap.length, info.height - y, page.height - oy - y) - top;
    if (width <= 0 || height <= 0) return;
    const key = `${left}:${top}:${width}:${height}`;
    let variants = this.symbolIds.get(bitmap);
    if (!variants) { variants = (reserve(64), new Map()); this.symbolIds.set(bitmap, variants); }
    let id = variants.get(key);
    if (id === undefined) {
      const stride = Math.ceil(width / 8), data = allocate(Uint8Array, stride * height);
      for (let sy = 0; sy < height; sy++) { tick(); for (let sx = 0; sx < width; sx++) { tick();
        if (bitmap[top + sy][left + sx]) data[sy * stride + (sx >> 3)] |= 128 >> (sx & 7);
      } }
      id = this.retainedSymbols.length; variants.set(key, id);
      grow(this.retainedSymbols, { width, height, data });
    }
    const symbol = this.retainedSymbols[id], px = ox + x + left, py = oy + y + top;
    grow(this.placements, px, py, id);
    const stride = Math.ceil(page.width / 8), glyphStride = Math.ceil(width / 8);
    for (let sy = 0; sy < height; sy++) { tick(); for (let sx = 0; sx < width; sx++) { tick();
      if (symbol.data[sy * glyphStride + (sx >> 3)] & (128 >> (sx & 7))) this.buffer[(py + sy) * stride + ((px + sx) >> 3)] |= 128 >> ((px + sx) & 7);
    } }
  }

  onImmediateGenericRegion(region, data, start, end) { tick();
    this.checkComposition(region.info);
    const info = region.info, page = this.currentPageInfo;
    if (!region.mmr) {
      if (info.width * info.height > 1_048_576) throw (reserve(64), new Jbig2Error("large arithmetic generic region"));
      return this.drawBitmap(info, decodeBitmap(false, info.width, info.height, region.template, region.prediction, null, region.at, (reserve(64), new DecodingContext(data, start, end))));
    }
    const result = decodeFax(data.subarray(start, end), info.width, info.height, false);
    const x = info.x | 0, y = info.y | 0, stride = Math.ceil(page.width / 8);
    for (let sy = Math.max(0, -y); sy < Math.min(info.height, page.height - y); sy++) { tick();
      for (let sx = Math.max(0, -x); sx < Math.min(info.width, page.width - x); sx++) { tick();
        if (result.bytes[sy * result.rowStride + (sx >> 3)] & (128 >> (sx & 7))) this.buffer[(y + sy) * stride + ((x + sx) >> 3)] |= 128 >> ((x + sx) & 7);
      }
    }
  }

  onImmediateLosslessGenericRegion() { tick();
    this.onImmediateGenericRegion(...arguments);
  }

  onSymbolDictionary(
    dictionary,
    currentSegment,
    referredSegments,
    data,
    start,
    end
  ) { tick();
    // Reused arithmetic bitmap contexts require PDFium's retained context state.
    if (dictionary.bitmapCodingContextUsed) throw (reserve(64), new Jbig2Error("retained bitmap coding context"));
    let huffmanTables, huffmanInput;
    if (dictionary.huffman) {
      huffmanTables = getSymbolDictionaryHuffmanTables(
        dictionary,
        referredSegments,
        this.customTables
      );
      huffmanInput = (reserve(64), new Reader(data, start, end));
    }

    // Combines exported symbols from all referred segments
    let symbols = this.symbols;
    if (!symbols) {
      this.symbols = symbols = {};
    }

    const inputSymbols = array([]);
    for (const referredSegment of referredSegments) { tick();
      const referredSymbols = symbols[referredSegment];
      // referredSymbols is undefined when we have a reference to a Tables
      // segment instead of a SymbolDictionary.
      if (referredSymbols) {
        grow(inputSymbols, ...referredSymbols);
      }
    }

    const decodingContext = (reserve(64), new DecodingContext(data, start, end));
    symbols[currentSegment] = decodeSymbolDictionary(
      dictionary.huffman,
      dictionary.refinement,
      inputSymbols,
      dictionary.numberOfNewSymbols,
      dictionary.numberOfExportedSymbols,
      huffmanTables,
      dictionary.template,
      dictionary.at,
      dictionary.refinementTemplate,
      dictionary.refinementAt,
      decodingContext,
      huffmanInput
    );
  }

  onImmediateTextRegion(region, referredSegments, data, start, end) { tick();
    const regionInfo = region.info;
    this.checkComposition(regionInfo);
    if (region.defaultPixelValue || region.transposed || region.combinationOperator !== 0) throw (reserve(64), new Jbig2Error("unsupported text composition"));
    let huffmanTables, huffmanInput;

    // Combines exported symbols from all referred segments
    const symbols = this.symbols;
    const inputSymbols = array([]);
    for (const referredSegment of referredSegments) { tick();
      const referredSymbols = symbols[referredSegment];
      // referredSymbols is undefined when we have a reference to a Tables
      // segment instead of a SymbolDictionary.
      if (referredSymbols) {
        grow(inputSymbols, ...referredSymbols);
      }
    }
    const symbolCodeLength = log2(inputSymbols.length);
    if (region.huffman) {
      huffmanInput = (reserve(64), new Reader(data, start, end));
      huffmanTables = getTextRegionHuffmanTables(
        region,
        referredSegments,
        this.customTables,
        inputSymbols.length,
        huffmanInput
      );
    }

    const decodingContext = (reserve(64), new DecodingContext(data, start, end));
    const bitmap = decodeTextRegion(
      region.huffman,
      region.refinement,
      regionInfo.width,
      regionInfo.height,
      region.defaultPixelValue,
      region.numberOfSymbolInstances,
      region.stripSize,
      inputSymbols,
      symbolCodeLength,
      region.transposed,
      region.dsOffset,
      region.referenceCorner,
      region.combinationOperator,
      huffmanTables,
      region.refinementTemplate,
      region.refinementAt,
      decodingContext,
      region.logStripSize,
      huffmanInput,
      (symbol, x, y) => this.collectSymbol(regionInfo, symbol, x, y)
    );
  }

  onImmediateLosslessTextRegion() { tick();
    this.onImmediateTextRegion(...arguments);
  }

  onPatternDictionary(dictionary, currentSegment, data, start, end) { tick();
    let patterns = this.patterns;
    if (!patterns) {
      this.patterns = patterns = {};
    }
    const decodingContext = (reserve(64), new DecodingContext(data, start, end));
    patterns[currentSegment] = decodePatternDictionary(
      dictionary.mmr,
      dictionary.patternWidth,
      dictionary.patternHeight,
      dictionary.maxPatternIndex,
      dictionary.template,
      decodingContext
    );
  }

  onImmediateHalftoneRegion(region, referredSegments, data, start, end) { tick();
    // HalftoneRegion refers to exactly one PatternDictionary.
    const patterns = this.patterns[referredSegments[0]];
    const regionInfo = region.info;
    const decodingContext = (reserve(64), new DecodingContext(data, start, end));
    const bitmap = decodeHalftoneRegion(
      region.mmr,
      patterns,
      region.template,
      regionInfo.width,
      regionInfo.height,
      region.defaultPixelValue,
      region.enableSkip,
      region.combinationOperator,
      region.gridWidth,
      region.gridHeight,
      region.gridOffsetX,
      region.gridOffsetY,
      region.gridVectorX,
      region.gridVectorY,
      decodingContext
    );
    this.drawBitmap(regionInfo, bitmap);
  }

  onImmediateLosslessHalftoneRegion() { tick();
    this.onImmediateHalftoneRegion(...arguments);
  }

  onTables(currentSegment, data, start, end) { tick();
    let customTables = this.customTables;
    if (!customTables) {
      this.customTables = customTables = {};
    }
    customTables[currentSegment] = decodeTablesSegment(data, start, end);
  }
}

class HuffmanLine {
  constructor(lineData) { tick();
    if (lineData.length === 2) {
      // OOB line.
      this.isOOB = true;
      this.rangeLow = 0;
      this.prefixLength = lineData[0];
      this.rangeLength = 0;
      this.prefixCode = lineData[1];
      this.isLowerRange = false;
    } else {
      // Normal, upper range or lower range line.
      // Upper range lines are processed like normal lines.
      this.isOOB = false;
      this.rangeLow = lineData[0];
      this.prefixLength = lineData[1];
      this.rangeLength = lineData[2];
      this.prefixCode = lineData[3];
      this.isLowerRange = lineData[4] === "lower";
    }
  }
}

class HuffmanTreeNode {
  constructor(line) { tick();
    this.children = array([]);
    if (line) {
      // Leaf node
      this.isLeaf = true;
      this.rangeLength = line.rangeLength;
      this.rangeLow = line.rangeLow;
      this.isLowerRange = line.isLowerRange;
      this.isOOB = line.isOOB;
    } else {
      // Intermediate or root node
      this.isLeaf = false;
    }
  }

  buildTree(line, shift) { tick();
    const bit = (line.prefixCode >> shift) & 1;
    if (shift <= 0) {
      // Create a leaf node.
      this.children[bit] = (reserve(64), new HuffmanTreeNode(line));
    } else {
      // Create an intermediate node and continue recursively.
      let node = this.children[bit];
      if (!node) {
        this.children[bit] = node = (reserve(64), new HuffmanTreeNode(null));
      }
      node.buildTree(line, shift - 1);
    }
  }

  decodeNode(reader) { tick();
    if (this.isLeaf) {
      if (this.isOOB) {
        return null;
      }
      const htOffset = reader.readBits(this.rangeLength);
      return this.rangeLow + (this.isLowerRange ? -htOffset : htOffset);
    }
    const node = this.children[reader.readBit()];
    if (!node) {
      throw (reserve(64), new Jbig2Error("invalid Huffman data"));
    }
    return node.decodeNode(reader);
  }
}

class HuffmanTable {
  constructor(lines, prefixCodesDone) { tick();
    if (!prefixCodesDone) {
      this.assignPrefixCodes(lines);
    }
    // Create Huffman tree.
    this.rootNode = (reserve(64), new HuffmanTreeNode(null));
    for (let i = 0, ii = lines.length; i < ii; i++) { tick();
      const line = lines[i];
      if (line.prefixLength > 32 || line.rangeLength > 32) throw (reserve(64), new Jbig2Error("invalid Huffman prefix"));
      if (line.prefixLength > 0) {
        this.rootNode.buildTree(line, line.prefixLength - 1);
      }
    }
  }

  decode(reader) { tick();
    return this.rootNode.decodeNode(reader);
  }

  assignPrefixCodes(lines) { tick();
    // Annex B.3 Assigning the prefix codes.
    const linesLength = lines.length;
    let prefixLengthMax = 0;
    for (let i = 0; i < linesLength; i++) { tick();
      prefixLengthMax = Math.max(prefixLengthMax, lines[i].prefixLength);
    }

    const histogram = allocate(Uint32Array, prefixLengthMax + 1);
    for (let i = 0; i < linesLength; i++) { tick();
      histogram[lines[i].prefixLength]++;
    }
    let currentLength = 1,
      firstCode = 0,
      currentCode,
      currentTemp,
      line;
    histogram[0] = 0;

    while (currentLength <= prefixLengthMax) { tick();
      firstCode = (firstCode + histogram[currentLength - 1]) << 1;
      currentCode = firstCode;
      currentTemp = 0;
      while (currentTemp < linesLength) { tick();
        line = lines[currentTemp];
        if (line.prefixLength === currentLength) {
          line.prefixCode = currentCode;
          currentCode++;
        }
        currentTemp++;
      }
      currentLength++;
    }
  }
}

function decodeTablesSegment(data, start, end) { tick();
  // Decodes a Tables segment, i.e., a custom Huffman table.
  // Annex B.2 Code table structure.
  const flags = data[start];
  const lowestValue = readUint32(data, start + 1) & 0xffffffff;
  const highestValue = readUint32(data, start + 5) & 0xffffffff;
  const reader = (reserve(64), new Reader(data, start + 9, end));

  const prefixSizeBits = ((flags >> 1) & 7) + 1;
  const rangeSizeBits = ((flags >> 4) & 7) + 1;
  const lines = array([]);
  let prefixLength,
    rangeLength,
    currentRangeLow = lowestValue;

  // Normal table lines
  do { tick();
    prefixLength = reader.readBits(prefixSizeBits);
    rangeLength = reader.readBits(rangeSizeBits);
    grow(lines,
      (reserve(64), new HuffmanLine(array([currentRangeLow, prefixLength, rangeLength, 0])))
    );
    currentRangeLow += 1 << rangeLength;
  } while (currentRangeLow < highestValue);

  // Lower range table line
  prefixLength = reader.readBits(prefixSizeBits);
  grow(lines, (reserve(64), new HuffmanLine(array([lowestValue - 1, prefixLength, 32, 0, "lower"]))));

  // Upper range table line
  prefixLength = reader.readBits(prefixSizeBits);
  grow(lines, (reserve(64), new HuffmanLine(array([highestValue, prefixLength, 32, 0]))));

  if (flags & 1) {
    // Out-of-band table line
    prefixLength = reader.readBits(prefixSizeBits);
    grow(lines, (reserve(64), new HuffmanLine(array([prefixLength, 0]))));
  }

  return (reserve(64), new HuffmanTable(lines, false));
}

const standardTablesCache = {};

function getStandardTable(number) { tick();
  // Annex B.5 Standard Huffman tables.
  let table = standardTablesCache[number];
  if (table) {
    return table;
  }
  let lines;
  switch (number) {
    case 1:
      lines = array([
        array([0, 1, 4, 0x0]),
        array([16, 2, 8, 0x2]),
        array([272, 3, 16, 0x6]),
        array([65808, 3, 32, 0x7]), // upper
      ]);
      break;
    case 2:
      lines = array([
        array([0, 1, 0, 0x0]),
        array([1, 2, 0, 0x2]),
        array([2, 3, 0, 0x6]),
        array([3, 4, 3, 0xe]),
        array([11, 5, 6, 0x1e]),
        array([75, 6, 32, 0x3e]), // upper
        array([6, 0x3f]), // OOB
      ]);
      break;
    case 3:
      lines = array([
        array([-256, 8, 8, 0xfe]),
        array([0, 1, 0, 0x0]),
        array([1, 2, 0, 0x2]),
        array([2, 3, 0, 0x6]),
        array([3, 4, 3, 0xe]),
        array([11, 5, 6, 0x1e]),
        array([-257, 8, 32, 0xff, "lower"]),
        array([75, 7, 32, 0x7e]), // upper
        array([6, 0x3e]), // OOB
      ]);
      break;
    case 4:
      lines = array([
        array([1, 1, 0, 0x0]),
        array([2, 2, 0, 0x2]),
        array([3, 3, 0, 0x6]),
        array([4, 4, 3, 0xe]),
        array([12, 5, 6, 0x1e]),
        array([76, 5, 32, 0x1f]), // upper
      ]);
      break;
    case 5:
      lines = array([
        array([-255, 7, 8, 0x7e]),
        array([1, 1, 0, 0x0]),
        array([2, 2, 0, 0x2]),
        array([3, 3, 0, 0x6]),
        array([4, 4, 3, 0xe]),
        array([12, 5, 6, 0x1e]),
        array([-256, 7, 32, 0x7f, "lower"]),
        array([76, 6, 32, 0x3e]), // upper
      ]);
      break;
    case 6:
      lines = array([
        array([-2048, 5, 10, 0x1c]),
        array([-1024, 4, 9, 0x8]),
        array([-512, 4, 8, 0x9]),
        array([-256, 4, 7, 0xa]),
        array([-128, 5, 6, 0x1d]),
        array([-64, 5, 5, 0x1e]),
        array([-32, 4, 5, 0xb]),
        array([0, 2, 7, 0x0]),
        array([128, 3, 7, 0x2]),
        array([256, 3, 8, 0x3]),
        array([512, 4, 9, 0xc]),
        array([1024, 4, 10, 0xd]),
        array([-2049, 6, 32, 0x3e, "lower"]),
        array([2048, 6, 32, 0x3f]), // upper
      ]);
      break;
    case 7:
      lines = array([
        array([-1024, 4, 9, 0x8]),
        array([-512, 3, 8, 0x0]),
        array([-256, 4, 7, 0x9]),
        array([-128, 5, 6, 0x1a]),
        array([-64, 5, 5, 0x1b]),
        array([-32, 4, 5, 0xa]),
        array([0, 4, 5, 0xb]),
        array([32, 5, 5, 0x1c]),
        array([64, 5, 6, 0x1d]),
        array([128, 4, 7, 0xc]),
        array([256, 3, 8, 0x1]),
        array([512, 3, 9, 0x2]),
        array([1024, 3, 10, 0x3]),
        array([-1025, 5, 32, 0x1e, "lower"]),
        array([2048, 5, 32, 0x1f]), // upper
      ]);
      break;
    case 8:
      lines = array([
        array([-15, 8, 3, 0xfc]),
        array([-7, 9, 1, 0x1fc]),
        array([-5, 8, 1, 0xfd]),
        array([-3, 9, 0, 0x1fd]),
        array([-2, 7, 0, 0x7c]),
        array([-1, 4, 0, 0xa]),
        array([0, 2, 1, 0x0]),
        array([2, 5, 0, 0x1a]),
        array([3, 6, 0, 0x3a]),
        array([4, 3, 4, 0x4]),
        array([20, 6, 1, 0x3b]),
        array([22, 4, 4, 0xb]),
        array([38, 4, 5, 0xc]),
        array([70, 5, 6, 0x1b]),
        array([134, 5, 7, 0x1c]),
        array([262, 6, 7, 0x3c]),
        array([390, 7, 8, 0x7d]),
        array([646, 6, 10, 0x3d]),
        array([-16, 9, 32, 0x1fe, "lower"]),
        array([1670, 9, 32, 0x1ff]), // upper
        array([2, 0x1]), // OOB
      ]);
      break;
    case 9:
      lines = array([
        array([-31, 8, 4, 0xfc]),
        array([-15, 9, 2, 0x1fc]),
        array([-11, 8, 2, 0xfd]),
        array([-7, 9, 1, 0x1fd]),
        array([-5, 7, 1, 0x7c]),
        array([-3, 4, 1, 0xa]),
        array([-1, 3, 1, 0x2]),
        array([1, 3, 1, 0x3]),
        array([3, 5, 1, 0x1a]),
        array([5, 6, 1, 0x3a]),
        array([7, 3, 5, 0x4]),
        array([39, 6, 2, 0x3b]),
        array([43, 4, 5, 0xb]),
        array([75, 4, 6, 0xc]),
        array([139, 5, 7, 0x1b]),
        array([267, 5, 8, 0x1c]),
        array([523, 6, 8, 0x3c]),
        array([779, 7, 9, 0x7d]),
        array([1291, 6, 11, 0x3d]),
        array([-32, 9, 32, 0x1fe, "lower"]),
        array([3339, 9, 32, 0x1ff]), // upper
        array([2, 0x0]), // OOB
      ]);
      break;
    case 10:
      lines = array([
        array([-21, 7, 4, 0x7a]),
        array([-5, 8, 0, 0xfc]),
        array([-4, 7, 0, 0x7b]),
        array([-3, 5, 0, 0x18]),
        array([-2, 2, 2, 0x0]),
        array([2, 5, 0, 0x19]),
        array([3, 6, 0, 0x36]),
        array([4, 7, 0, 0x7c]),
        array([5, 8, 0, 0xfd]),
        array([6, 2, 6, 0x1]),
        array([70, 5, 5, 0x1a]),
        array([102, 6, 5, 0x37]),
        array([134, 6, 6, 0x38]),
        array([198, 6, 7, 0x39]),
        array([326, 6, 8, 0x3a]),
        array([582, 6, 9, 0x3b]),
        array([1094, 6, 10, 0x3c]),
        array([2118, 7, 11, 0x7d]),
        array([-22, 8, 32, 0xfe, "lower"]),
        array([4166, 8, 32, 0xff]), // upper
        array([2, 0x2]), // OOB
      ]);
      break;
    case 11:
      lines = array([
        array([1, 1, 0, 0x0]),
        array([2, 2, 1, 0x2]),
        array([4, 4, 0, 0xc]),
        array([5, 4, 1, 0xd]),
        array([7, 5, 1, 0x1c]),
        array([9, 5, 2, 0x1d]),
        array([13, 6, 2, 0x3c]),
        array([17, 7, 2, 0x7a]),
        array([21, 7, 3, 0x7b]),
        array([29, 7, 4, 0x7c]),
        array([45, 7, 5, 0x7d]),
        array([77, 7, 6, 0x7e]),
        array([141, 7, 32, 0x7f]), // upper
      ]);
      break;
    case 12:
      lines = array([
        array([1, 1, 0, 0x0]),
        array([2, 2, 0, 0x2]),
        array([3, 3, 1, 0x6]),
        array([5, 5, 0, 0x1c]),
        array([6, 5, 1, 0x1d]),
        array([8, 6, 1, 0x3c]),
        array([10, 7, 0, 0x7a]),
        array([11, 7, 1, 0x7b]),
        array([13, 7, 2, 0x7c]),
        array([17, 7, 3, 0x7d]),
        array([25, 7, 4, 0x7e]),
        array([41, 8, 5, 0xfe]),
        array([73, 8, 32, 0xff]), // upper
      ]);
      break;
    case 13:
      lines = array([
        array([1, 1, 0, 0x0]),
        array([2, 3, 0, 0x4]),
        array([3, 4, 0, 0xc]),
        array([4, 5, 0, 0x1c]),
        array([5, 4, 1, 0xd]),
        array([7, 3, 3, 0x5]),
        array([15, 6, 1, 0x3a]),
        array([17, 6, 2, 0x3b]),
        array([21, 6, 3, 0x3c]),
        array([29, 6, 4, 0x3d]),
        array([45, 6, 5, 0x3e]),
        array([77, 7, 6, 0x7e]),
        array([141, 7, 32, 0x7f]), // upper
      ]);
      break;
    case 14:
      lines = array([
        array([-2, 3, 0, 0x4]),
        array([-1, 3, 0, 0x5]),
        array([0, 1, 0, 0x0]),
        array([1, 3, 0, 0x6]),
        array([2, 3, 0, 0x7]),
      ]);
      break;
    case 15:
      lines = array([
        array([-24, 7, 4, 0x7c]),
        array([-8, 6, 2, 0x3c]),
        array([-4, 5, 1, 0x1c]),
        array([-2, 4, 0, 0xc]),
        array([-1, 3, 0, 0x4]),
        array([0, 1, 0, 0x0]),
        array([1, 3, 0, 0x5]),
        array([2, 4, 0, 0xd]),
        array([3, 5, 1, 0x1d]),
        array([5, 6, 2, 0x3d]),
        array([9, 7, 4, 0x7d]),
        array([-25, 7, 32, 0x7e, "lower"]),
        array([25, 7, 32, 0x7f]), // upper
      ]);
      break;
    default:
      throw (reserve(64), new Jbig2Error(`standard table B.${number} does not exist`));
  }

  for (let i = 0, ii = lines.length; i < ii; i++) { tick();
    lines[i] = (reserve(64), new HuffmanLine(lines[i]));
  }
  table = (reserve(64), new HuffmanTable(lines, true));
  standardTablesCache[number] = table;
  return table;
}

class Reader {
  constructor(data, start, end) { tick();
    this.data = data;
    this.start = start;
    this.end = end;
    this.position = start;
    this.shift = -1;
    this.currentByte = 0;
  }

  readBit() { tick();
    if (this.shift < 0) {
      if (this.position >= this.end) {
        throw (reserve(64), new Jbig2Error("end of data while reading bit"));
      }
      this.currentByte = this.data[this.position++];
      this.shift = 7;
    }
    const bit = (this.currentByte >> this.shift) & 1;
    this.shift--;
    return bit;
  }

  readBits(numBits) { tick();
    let result = 0,
      i;
    for (i = numBits - 1; i >= 0; i--) { tick();
      result |= this.readBit() << i;
    }
    return result;
  }

  byteAlign() { tick();
    this.shift = -1;
  }

  next() { tick();
    if (this.position >= this.end) {
      return -1;
    }
    return this.data[this.position++];
  }
}

function getCustomHuffmanTable(index, referredTo, customTables) { tick();
  // Returns a Tables segment that has been earlier decoded.
  // See 7.4.2.1.6 (symbol dictionary) or 7.4.3.1.6 (text region).
  let currentIndex = 0;
  for (let i = 0, ii = referredTo.length; i < ii; i++) { tick();
    const table = customTables[referredTo[i]];
    if (table) {
      if (index === currentIndex) {
        return table;
      }
      currentIndex++;
    }
  }
  throw (reserve(64), new Jbig2Error("can't find custom Huffman table"));
}

function getTextRegionHuffmanTables(
  textRegion,
  referredTo,
  customTables,
  numberOfSymbols,
  reader
) { tick();
  // 7.4.3.1.7 Symbol ID Huffman table decoding

  // Read code lengths for RUNCODEs 0...34.
  const codes = array([]);
  for (let i = 0; i <= 34; i++) { tick();
    const codeLength = reader.readBits(4);
    grow(codes, (reserve(64), new HuffmanLine(array([i, codeLength, 0, 0]))));
  }
  // Assign Huffman codes for RUNCODEs.
  const runCodesTable = (reserve(64), new HuffmanTable(codes, false));

  // Read a Huffman code using the assignment above.
  // Interpret the RUNCODE codes and the additional bits (if any).
  codes.length = 0;
  for (let i = 0; i < numberOfSymbols; ) { tick();
    const codeLength = runCodesTable.decode(reader);
    if (codeLength >= 32) {
      let repeatedLength, numberOfRepeats, j;
      switch (codeLength) {
        case 32:
          if (i === 0) {
            throw (reserve(64), new Jbig2Error("no previous value in symbol ID table"));
          }
          numberOfRepeats = reader.readBits(2) + 3;
          repeatedLength = codes[i - 1].prefixLength;
          break;
        case 33:
          numberOfRepeats = reader.readBits(3) + 3;
          repeatedLength = 0;
          break;
        case 34:
          numberOfRepeats = reader.readBits(7) + 11;
          repeatedLength = 0;
          break;
        default:
          throw (reserve(64), new Jbig2Error("invalid code length in symbol ID table"));
      }
      for (j = 0; j < numberOfRepeats; j++) { tick();
        grow(codes, (reserve(64), new HuffmanLine(array([i, repeatedLength, 0, 0]))));
        i++;
      }
    } else {
      grow(codes, (reserve(64), new HuffmanLine(array([i, codeLength, 0, 0]))));
      i++;
    }
  }
  reader.byteAlign();
  const symbolIDTable = (reserve(64), new HuffmanTable(codes, false));

  // 7.4.3.1.6 Text region segment Huffman table selection

  let customIndex = 0,
    tableFirstS,
    tableDeltaS,
    tableDeltaT;

  switch (textRegion.huffmanFS) {
    case 0:
    case 1:
      tableFirstS = getStandardTable(textRegion.huffmanFS + 6);
      break;
    case 3:
      tableFirstS = getCustomHuffmanTable(
        customIndex,
        referredTo,
        customTables
      );
      customIndex++;
      break;
    default:
      throw (reserve(64), new Jbig2Error("invalid Huffman FS selector"));
  }

  switch (textRegion.huffmanDS) {
    case 0:
    case 1:
    case 2:
      tableDeltaS = getStandardTable(textRegion.huffmanDS + 8);
      break;
    case 3:
      tableDeltaS = getCustomHuffmanTable(
        customIndex,
        referredTo,
        customTables
      );
      customIndex++;
      break;
    default:
      throw (reserve(64), new Jbig2Error("invalid Huffman DS selector"));
  }

  switch (textRegion.huffmanDT) {
    case 0:
    case 1:
    case 2:
      tableDeltaT = getStandardTable(textRegion.huffmanDT + 11);
      break;
    case 3:
      tableDeltaT = getCustomHuffmanTable(
        customIndex,
        referredTo,
        customTables
      );
      customIndex++;
      break;
    default:
      throw (reserve(64), new Jbig2Error("invalid Huffman DT selector"));
  }

  if (textRegion.refinement) {
    // Load tables RDW, RDH, RDX and RDY.
    throw (reserve(64), new Jbig2Error("refinement with Huffman is not supported"));
  }

  return {
    symbolIDTable,
    tableFirstS,
    tableDeltaS,
    tableDeltaT,
  };
}

function getSymbolDictionaryHuffmanTables(
  dictionary,
  referredTo,
  customTables
) { tick();
  // 7.4.2.1.6 Symbol dictionary segment Huffman table selection

  let customIndex = 0,
    tableDeltaHeight,
    tableDeltaWidth;
  switch (dictionary.huffmanDHSelector) {
    case 0:
    case 1:
      tableDeltaHeight = getStandardTable(dictionary.huffmanDHSelector + 4);
      break;
    case 3:
      tableDeltaHeight = getCustomHuffmanTable(
        customIndex,
        referredTo,
        customTables
      );
      customIndex++;
      break;
    default:
      throw (reserve(64), new Jbig2Error("invalid Huffman DH selector"));
  }

  switch (dictionary.huffmanDWSelector) {
    case 0:
    case 1:
      tableDeltaWidth = getStandardTable(dictionary.huffmanDWSelector + 2);
      break;
    case 3:
      tableDeltaWidth = getCustomHuffmanTable(
        customIndex,
        referredTo,
        customTables
      );
      customIndex++;
      break;
    default:
      throw (reserve(64), new Jbig2Error("invalid Huffman DW selector"));
  }

  let tableBitmapSize, tableAggregateInstances;
  if (dictionary.bitmapSizeSelector) {
    tableBitmapSize = getCustomHuffmanTable(
      customIndex,
      referredTo,
      customTables
    );
    customIndex++;
  } else {
    tableBitmapSize = getStandardTable(1);
  }

  if (dictionary.aggregationInstancesSelector) {
    tableAggregateInstances = getCustomHuffmanTable(
      customIndex,
      referredTo,
      customTables
    );
  } else {
    tableAggregateInstances = getStandardTable(1);
  }

  return {
    tableDeltaHeight,
    tableDeltaWidth,
    tableBitmapSize,
    tableAggregateInstances,
  };
}

function readUncompressedBitmap(reader, width, height) { tick();
  const bitmap = array([]);
  for (let y = 0; y < height; y++) { tick();
    const row = allocate(Uint8Array, width);
    grow(bitmap, row);
    for (let x = 0; x < width; x++) { tick();
      row[x] = reader.readBit();
    }
    reader.byteAlign();
  }
  return bitmap;
}

function decodeMMRBitmap(input, width, height, endOfBlock) { tick();
  const result = decodeFax(input.data.subarray(input.position, input.end), width, height, endOfBlock);
  input.position += result.bytesConsumed;
  const bitmap = array([]);
  for (let y = 0; y < height; y++) { tick();
    const row = allocate(Uint8Array, width);
    for (let x = 0; x < width; x++) { tick(); row[x] = (result.bytes[y * result.rowStride + (x >> 3)] >> (7 - (x & 7))) & 1; }
    grow(bitmap, row);
  }
  return bitmap;
}

// HEPR operation-local accounting. All decoder entries, loops, allocations and
// growing row/symbol arrays below are metered by the vendoring transform.
export function tick() {
  if (!budget) return;
  if (++budget.work > budget.maximumWork) throw jbig2ResourceError("jbig2-work");
  if ((budget.work & 1023) === 0) throwIfAborted(budget.signal);
}
function reserve(size) {
  if (!budget) return;
  if (!Number.isSafeInteger(size) || size < 0 || (budget.bytes += size) > budget.maxBytes) throw jbig2ResourceError("jbig2-working-set");
}
function allocate(Type, count) {
  reserve((typeof count === "number" ? count : count.length) * Type.BYTES_PER_ELEMENT + 64);
  return new Type(count);
}
function grow(array, ...values) { reserve(values.length * 16); return array.push(...values); }
function array(values) { reserve(values.length * 16 + 32); return values; }
function concatenate(first, second) { reserve((first.length + second.length) * 16 + 32); return first.concat(second); }
function decodeFax(encoded, width, height, endOfBlock) {
  reserve(Math.ceil(width / 8) * height * 3 + height * 32 + width * 64);
  const remaining = Math.max(1, budget.maximumWork - budget.work);
  const result = decodeNativeCcittFax(encoded, { K: -1, Columns: width, Rows: height, BlackIs1: true, EndOfBlock: endOfBlock },
    { signal: budget.signal, limits: { maxOutputBytes: Math.max(1, budget.maxBytes - budget.bytes), maxScanBits: Math.max(1, Math.floor(remaining / 2)), maxTransitions: Math.max(1, Math.floor(remaining / 2)) } });
  budget.work += result.work;
  if (budget.work > budget.maximumWork) throw jbig2ResourceError("jbig2-work");
  return result;
}

/** Unsupported composition is retried using PDFium, within the remaining work allowance. */
export function tryDecodeJbig2Symbols(encoded, globals, width, height, maxBytes, signal, maximumWork) {
  throwIfAborted(signal);
  const previous = budget;
  budget = { bytes: encoded.length + globals.length, work: 0, maximumWork, maxBytes, signal };
  try {
    const groups = [globals, encoded].map(data => readSegments({}, data, 0, data.length));
    if (!groups.some(segments => segments.some(segment => segment.header.type === 6 || segment.header.type === 7))) return { work: budget.work };
    const allowed = new Set([0, 6, 7, 38, 39, 48, 49, 50, 51, 53, 62]);
    if (groups.some(segments => segments.some(segment => !allowed.has(segment.header.type)))) return { work: budget.work };
    const visitor = new SimpleSegmentVisitor();
    visitor.symbolIds = new WeakMap(); visitor.retainedSymbols = []; visitor.placements = [];
    for (const segments of groups) processSegments(segments, visitor);
    if (!visitor.buffer || visitor.currentPageInfo.width !== width || visitor.currentPageInfo.height !== height) throw new Jbig2Error("dimension mismatch");
    const samples = allocate(Uint8Array, visitor.buffer.length);
    for (let i = 0; i < samples.length; i++) { tick(); samples[i] = visitor.buffer[i] ^ 255; }
    const symbols = { symbols: visitor.retainedSymbols, placements: allocate(Int32Array, visitor.placements) };
    return { work: budget.work, result: { samples, jbig2Symbols: symbols } };
  } catch (error) {
    throwIfAborted(signal);
    if (error.details?.scannedBits || error.details?.transitions || error.details?.encodedBits) budget.work = maximumWork;
    if (budget.work >= maximumWork) throw jbig2ResourceError("jbig2-work");
    return { work: budget.work, reason: error.message };
  } finally { budget = previous; }
}
