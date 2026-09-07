import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateRawSync, deflateSync } from "node:zlib";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const {
  decodePdfFilterChain,
  decodePdfFilterChainChunks,
  readDecodeParameters,
  readFilterNames
} = await import("../src/pdf/nativeFilters.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

try {
  testFilterAndParameterParsing();
  await testChainedFilters();
  await testFlate();
  await testStreamingFlateChunks();
  await testLzw();
  await testAscii85();
  await testAsciiHex();
  await testRunLength();
  await testTiffPredictor();
  await testPngPredictor();
  await testLimitsAndCancellation();
} finally {
  hooks.deregister();
}

console.log("native filter semantics tests passed");

function testFilterAndParameterParsing() {
  const dictionary = new Map([["Predictor", 1]]);
  assert.deepEqual(readFilterNames(undefined), []);
  assert.deepEqual(readFilterNames(null), []);
  assert.deepEqual(readFilterNames(name("Fl")), ["Fl"]);
  assert.deepEqual(readFilterNames([name("AHx"), name("Fl")]), ["AHx", "Fl"]);
  assert.throws(() => readFilterNames(4), hasPdfError("invalid-object", /Filter entry/));
  assert.throws(() => readFilterNames([name("Fl"), null]), hasPdfError("invalid-object", /non-name/));

  assert.deepEqual(readDecodeParameters(undefined, 2), [null, null]);
  assert.deepEqual(readDecodeParameters(null, 0), []);
  assert.deepEqual(readDecodeParameters([], 0), []);
  assert.deepEqual(readDecodeParameters(dictionary, 1), [dictionary]);
  assert.deepEqual(readDecodeParameters([null, dictionary], 2), [null, dictionary]);
  assert.throws(
    () => readDecodeParameters(dictionary, 2),
    hasPdfError("invalid-object", /exactly one/)
  );
  assert.throws(
    () => readDecodeParameters([null], 2),
    hasPdfError("invalid-object", /match its Filter array length/)
  );
  assert.throws(
    () => readDecodeParameters([null, null], 1),
    hasPdfError("invalid-object", /match its Filter array length/)
  );
  assert.throws(
    () => readDecodeParameters([name("NotADictionary")], 1),
    hasPdfError("invalid-object", /invalid value/)
  );
  assert.throws(() => readDecodeParameters(null, -1), RangeError);
  assert.throws(
    () => readDecodeParameters(null, 65),
    hasPdfError("resource-limit", /depth limit/)
  );
  assert.throws(
    () => readFilterNames(Array.from({ length: 65 }, () => name("Fl"))),
    hasPdfError("resource-limit", /depth limit/)
  );
}

async function testChainedFilters() {
  const decoded = Uint8Array.of(10, 20, 30, 40);
  const predicted = encodePngRows([decoded], [1], 1);
  const compressed = bytesOf(deflateSync(predicted));
  const encoded = asciiHexEncode(compressed);
  const predictor = new Map([
    ["Predictor", 12],
    ["Colors", 1],
    ["BitsPerComponent", 8],
    ["Columns", 4]
  ]);
  assert.deepEqual(
    await decodePdfFilterChain(encoded, ["AHx", "Fl"], [null, predictor]),
    decoded
  );
  await assert.rejects(
    decodePdfFilterChain(encoded, ["ASCIIHexDecode", "FlateDecode"], [null]),
    hasPdfError("invalid-object", /mismatched DecodeParms arity/)
  );
  await assert.rejects(
    decodePdfFilterChain(Uint8Array.of(), ["DCTDecode"], [null]),
    hasPdfError("unsupported-filter", /DCTDecode/)
  );
}

async function testFlate() {
  const decoded = new TextEncoder().encode("strict zlib and raw DEFLATE integrity");
  const zlib = bytesOf(deflateSync(decoded));
  const raw = bytesOf(deflateRawSync(decoded));
  assert.deepEqual(await decodeOne(zlib, "FlateDecode"), decoded);
  assert.deepEqual(await decodeOne(raw, "Fl"), decoded);
  assert.deepEqual(await decodeOne(bytesOf(deflateRawSync(Uint8Array.of())), "Fl"), Uint8Array.of());

  const badChecksum = zlib.slice();
  badChecksum[badChecksum.length - 1] ^= 1;
  await assert.rejects(decodeOne(badChecksum, "FlateDecode"), hasPdfError("invalid-object", /FlateDecode/));

  const badHeader = zlib.slice();
  badHeader[1] ^= 1;
  await assert.rejects(decodeOne(badHeader, "FlateDecode"), hasPdfError("invalid-object", /zlib header/));
  await assert.rejects(
    decodeOne(concat(zlib, Uint8Array.of(0)), "FlateDecode"),
    hasPdfError("invalid-object", /FlateDecode/)
  );
  await assert.rejects(
    decodeOne(concat(raw, Uint8Array.of(0)), "FlateDecode"),
    hasPdfError("invalid-object", /FlateDecode/)
  );
  await assert.rejects(
    decodeOne(raw.subarray(0, Math.max(1, Math.floor(raw.length / 2))), "FlateDecode"),
    hasPdfError("invalid-object", /FlateDecode/)
  );
  await assert.rejects(
    decodeOne(Uint8Array.of(), "FlateDecode"),
    hasPdfError("invalid-object", /empty/)
  );

  // 0x7820 has a valid FCHECK and advertises FDICT. PDF Flate streams cannot
  // supply the external dictionary, so this is a deterministic typed failure.
  await assert.rejects(
    decodeOne(Uint8Array.of(0x78, 0x20, 0, 0, 0, 0), "FlateDecode"),
    hasPdfError("unsupported-filter", /preset dictionaries/)
  );
  await assert.rejects(
    decodePdfFilterChain(zlib, ["FlateDecode"], [null], {
      limits: { maxDecodedStreamBytes: decoded.length - 1 }
    }),
    hasPdfError("resource-limit", /configured byte limit/)
  );
}

async function testStreamingFlateChunks() {
  const decoded = new Uint8Array(512 * 1024 + 37);
  for (let index = 0; index < decoded.length; index += 1) {
    decoded[index] = (index * 31 + (index >>> 7)) & 0xff;
  }
  const explicitNoPredictor = new Map([["Predictor", 1]]);
  for (const [compressed, filter, params] of [
    [bytesOf(deflateSync(decoded)), "FlateDecode", null],
    [bytesOf(deflateRawSync(decoded)), "Fl", explicitNoPredictor]
  ]) {
    const streamed = await collectFilterChunks(
      compressed,
      [filter],
      [params],
      { chunkSize: 4093 }
    );
    assert.ok(streamed.chunks.length > 1, "large Flate output must be consumable incrementally");
    assert.ok(streamed.chunks.every((chunk) => chunk.length > 0 && chunk.length <= 4093));
    assert.deepEqual(streamed.bytes, decoded);
    assert.deepEqual(
      streamed.bytes,
      await decodePdfFilterChain(compressed, [filter], [params]),
      "chunked and whole-buffer Flate decoding must remain byte-identical"
    );
  }

  // Predictors and filter chains deliberately retain the whole-buffer path.
  const predictedRow = Uint8Array.of(4, 7, 11, 16, 22, 29, 37, 46);
  const predicted = encodePngRows([predictedRow], [1], 1);
  const predictor = predictorParams(12, 1, 8, predictedRow.length);
  const fallback = await collectFilterChunks(
    bytesOf(deflateSync(predicted)),
    ["FlateDecode"],
    [predictor],
    { chunkSize: 3 }
  );
  assert.deepEqual(fallback.bytes, predictedRow);
  assert.ok(fallback.chunks.every((chunk) => chunk.length <= 3));

  const chained = await collectFilterChunks(
    asciiHexEncode(bytesOf(deflateSync(decoded.subarray(0, 257)))),
    ["ASCIIHexDecode", "FlateDecode"],
    [null, null],
    { chunkSize: 17 }
  );
  assert.deepEqual(chained.bytes, decoded.subarray(0, 257));

  await assert.rejects(
    collectFilterChunks(
      bytesOf(deflateSync(decoded)),
      ["FlateDecode"],
      [null],
      { chunkSize: 1024, limits: { maxDecodedStreamBytes: 4096 } }
    ),
    hasPdfError("resource-limit", /configured byte limit/)
  );

  const controller = new AbortController();
  const iterator = decodePdfFilterChainChunks(
    bytesOf(deflateSync(decoded)),
    ["FlateDecode"],
    [null],
    { chunkSize: 1024, signal: controller.signal }
  )[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.ok(first.value.length <= 1024);
  controller.abort(new Error("streaming fixture abort"));
  await assert.rejects(iterator.next(), hasPdfError("aborted", /aborted/));
  await iterator.return?.();

  const earlyReturn = decodePdfFilterChainChunks(
    bytesOf(deflateSync(decoded)),
    ["FlateDecode"],
    [null],
    { chunkSize: 512 }
  )[Symbol.asyncIterator]();
  assert.equal((await earlyReturn.next()).done, false);
  assert.equal((await earlyReturn.return()).done, true);

  const damaged = bytesOf(deflateRawSync(decoded.subarray(0, 8192)));
  await assert.rejects(
    collectFilterChunks(
      concat(damaged, Uint8Array.of(0)),
      ["FlateDecode"],
      [null],
      { chunkSize: 257 }
    ),
    hasPdfError("invalid-object", /FlateDecode/),
    "raw streaming must still run the strict end-of-stream validation pass"
  );

  await assert.rejects(
    decodePdfFilterChainChunks(
      bytesOf(deflateSync(decoded.subarray(0, 1))),
      ["FlateDecode"],
      [null],
      { chunkSize: 0 }
    )[Symbol.asyncIterator]().next(),
    RangeError
  );
}

async function testLzw() {
  // Adobe PDF Reference 1.7, Table 3.6/its immediately following packed-byte
  // example. Keeping the published bytes makes this test independent of the
  // local code packer used for the boundary/reset fixtures below.
  assert.deepEqual(
    await decodeOne(Uint8Array.of(0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01), "LZWDecode"),
    Uint8Array.of(45, 45, 45, 45, 45, 65, 45, 45, 45, 66)
  );
  assert.deepEqual(
    await decodeOne(packLzwCodes([256, 65, 258, 257], 1), "LZWDecode"),
    new TextEncoder().encode("AAA")
  );

  for (const earlyChange of [0, 1]) {
    const first = Array.from({ length: 700 }, (_, index) => index & 0xff);
    const second = Array.from({ length: 700 }, (_, index) => (255 - index) & 0xff);
    const codes = [256, ...first, 256, ...second, 257];
    const expected = Uint8Array.from([...first, ...second]);
    assert.deepEqual(
      await decodePdfFilterChain(packLzwCodes(codes, earlyChange), ["LZW"], [new Map([
        ["EarlyChange", earlyChange]
      ])]),
      expected,
      `EarlyChange=${earlyChange} must cross a code-width boundary and reset cleanly`
    );
  }

  const fillsTable = Array.from({ length: 3839 }, (_, index) => index & 0xff);
  assert.deepEqual(
    await decodeOne(packLzwCodes([256, ...fillsTable, 256, 65, 257], 1), "LZWDecode"),
    Uint8Array.from([...fillsTable, 65]),
    "a full LZW table must be reset before the next data code"
  );
  await assert.rejects(
    decodeOne(packLzwCodes([256, ...fillsTable, 65, 257], 1), "LZWDecode"),
    hasPdfError("invalid-object", /not cleared/)
  );

  await assert.rejects(
    decodeOne(packLzwCodes([256, 65], 1), "LZWDecode"),
    hasPdfError("invalid-object", /without an EOD/)
  );
  await assert.rejects(
    decodeOne(packLzwCodes([256, 300, 257], 1), "LZWDecode"),
    hasPdfError("invalid-object", /code sequence/)
  );
  await assert.rejects(
    decodeOne(concat(packLzwCodes([256, 65, 257], 1), Uint8Array.of(0)), "LZWDecode"),
    hasPdfError("invalid-object", /follows its EOD/)
  );
  const nonzeroPadding = packLzwCodes([256, 65, 257], 1);
  nonzeroPadding[nonzeroPadding.length - 1] |= 1;
  await assert.rejects(
    decodeOne(nonzeroPadding, "LZWDecode"),
    hasPdfError("invalid-object", /nonzero padding/)
  );
  await assert.rejects(
    decodePdfFilterChain(packLzwCodes([256, 65, 66, 257], 1), ["LZWDecode"], [null], {
      limits: { maxDecodedStreamBytes: 1 }
    }),
    hasPdfError("resource-limit", /configured byte limit/)
  );
  await assert.rejects(
    decodePdfFilterChain(packLzwCodes([256, 65, 257], 1), ["LZWDecode"], [new Map([
      ["EarlyChange", 2]
    ])]),
    hasPdfError("invalid-object", /EarlyChange/)
  );
}

async function testAscii85() {
  assert.deepEqual(await decodeOne(ascii("z~>"), "A85"), Uint8Array.of(0, 0, 0, 0));
  assert.equal(
    new TextDecoder().decode(await decodeOne(ascii("87cURD]j7BEbo80~>"), "ASCII85Decode")),
    "Hello world!"
  );
  assert.deepEqual(
    await decodeOne(ascii("z ~\u0000\t> \r\n"), "ASCII85Decode"),
    Uint8Array.of(0, 0, 0, 0)
  );
  for (let length = 1; length <= 3; length += 1) {
    const decoded = Uint8Array.from({ length }, (_, index) => 0xa0 + index);
    assert.deepEqual(await decodeOne(ascii85Encode(decoded), "ASCII85Decode"), decoded);
  }
  await assert.rejects(decodeOne(ascii("!~>"), "ASCII85Decode"), hasPdfError("invalid-object", /final/));
  await assert.rejects(decodeOne(ascii("!z~>"), "ASCII85Decode"), hasPdfError("invalid-object", /inside a group/));
  await assert.rejects(decodeOne(ascii("uuuuu~>"), "ASCII85Decode"), hasPdfError("invalid-object", /overflows/));
  await assert.rejects(decodeOne(ascii("z"), "ASCII85Decode"), hasPdfError("invalid-object", /no ~>/));
  await assert.rejects(decodeOne(ascii("z~x"), "ASCII85Decode"), hasPdfError("invalid-object", /terminator/));
  await assert.rejects(decodeOne(ascii("z~>!"), "ASCII85Decode"), hasPdfError("invalid-object", /follows/));
  await assert.rejects(
    decodePdfFilterChain(ascii("z~>"), ["ASCII85Decode"], [null], {
      limits: { maxDecodedStreamBytes: 3 }
    }),
    hasPdfError("resource-limit", /configured byte limit/)
  );
}

async function testAsciiHex() {
  assert.deepEqual(await decodeOne(ascii("61 62\u0000\t6> \r\n"), "AHx"), ascii("ab`"));
  assert.deepEqual(await decodeOne(ascii("6>"), "ASCIIHexDecode"), Uint8Array.of(0x60));
  assert.deepEqual(await decodeOne(ascii(">"), "ASCIIHexDecode"), Uint8Array.of());
  await assert.rejects(decodeOne(ascii("61"), "ASCIIHexDecode"), hasPdfError("invalid-object", /no >/));
  await assert.rejects(decodeOne(ascii("6g>"), "ASCIIHexDecode"), hasPdfError("invalid-object", /character/));
  await assert.rejects(decodeOne(ascii("61>x"), "ASCIIHexDecode"), hasPdfError("invalid-object", /follows/));
  await assert.rejects(
    decodePdfFilterChain(ascii("61>"), ["ASCIIHexDecode"], [null], {
      limits: { maxDecodedStreamBytes: 0 }
    }),
    RangeError
  );
  assert.deepEqual(
    await decodePdfFilterChain(ascii("61>"), ["ASCIIHexDecode"], [null], {
      limits: { maxDecodedStreamBytes: 1 }
    }),
    Uint8Array.of(0x61),
    "a filter output exactly at the configured ceiling is allowed"
  );
  await assert.rejects(
    decodePdfFilterChain(ascii("616>"), ["ASCIIHexDecode"], [null], {
      limits: { maxDecodedStreamBytes: 1 }
    }),
    hasPdfError("resource-limit", /configured byte limit/)
  );
}

async function testRunLength() {
  assert.deepEqual(
    await decodeOne(Uint8Array.of(2, 65, 66, 67, 254, 90, 128), "RL"),
    ascii("ABCZZZ")
  );
  assert.deepEqual(await decodeOne(Uint8Array.of(128), "RunLengthDecode"), Uint8Array.of());
  await assert.rejects(decodeOne(Uint8Array.of(), "RunLengthDecode"), hasPdfError("invalid-object", /no EOD/));
  await assert.rejects(decodeOne(Uint8Array.of(0, 65), "RunLengthDecode"), hasPdfError("invalid-object", /no EOD/));
  await assert.rejects(decodeOne(Uint8Array.of(2, 65, 66), "RunLengthDecode"), hasPdfError("invalid-object", /literal/));
  await assert.rejects(decodeOne(Uint8Array.of(254), "RunLengthDecode"), hasPdfError("invalid-object", /repeat/));
  await assert.rejects(decodeOne(Uint8Array.of(128, 0), "RunLengthDecode"), hasPdfError("invalid-object", /follows/));
  await assert.rejects(
    decodePdfFilterChain(Uint8Array.of(254, 90, 128), ["RunLengthDecode"], [null], {
      limits: { maxDecodedStreamBytes: 2 }
    }),
    hasPdfError("resource-limit", /configured byte limit/)
  );
}

async function testTiffPredictor() {
  const cases = [
    { bits: 1, colors: 1, columns: 8, encoded: [0x5d], decoded: [0x69] },
    { bits: 2, colors: 1, columns: 4, encoded: [0x15], decoded: [0x1b] },
    { bits: 4, colors: 1, columns: 3, encoded: [0x12, 0x30], decoded: [0x13, 0x60] },
    { bits: 8, colors: 3, columns: 2, encoded: [10, 20, 30, 5, 10, 15], decoded: [10, 20, 30, 15, 30, 45] },
    {
      bits: 16,
      colors: 2,
      columns: 2,
      encoded: [0x01, 0x02, 0x03, 0x04, 0x04, 0x05, 0x05, 0x06],
      decoded: [0x01, 0x02, 0x03, 0x04, 0x05, 0x07, 0x08, 0x0a]
    }
  ];
  for (const fixture of cases) {
    assert.deepEqual(
      await decodePredictor(Uint8Array.from(fixture.encoded), 2, fixture.colors, fixture.bits, fixture.columns),
      Uint8Array.from(fixture.decoded),
      `TIFF predictor ${fixture.bits}-bit fixture`
    );
  }
  assert.deepEqual(
    await decodePredictor(Uint8Array.of(1, 1, 1, 10, 1, 1), 2, 1, 8, 3),
    Uint8Array.of(1, 2, 3, 10, 11, 12),
    "TIFF horizontal state resets for each row"
  );
  await assert.rejects(
    decodePredictor(Uint8Array.of(1), 2, 1, 8, 2),
    hasPdfError("invalid-object", /Truncated TIFF/)
  );
}

async function testPngPredictor() {
  const rows = [
    Uint8Array.of(10, 20, 30, 40),
    Uint8Array.of(5, 10, 20, 40),
    Uint8Array.of(7, 12, 25, 50),
    Uint8Array.of(9, 15, 30, 60),
    Uint8Array.of(10, 20, 40, 80)
  ];
  const encoded = encodePngRows(rows, [0, 1, 2, 3, 4], 1);
  assert.deepEqual(
    await decodePredictor(encoded, 10, 1, 8, 4),
    concat(...rows),
    "every row tag controls its PNG algorithm even when /Predictor is 10"
  );

  const packedCases = [
    { bits: 1, colors: 1, columns: 8, rows: [Uint8Array.of(0x69), Uint8Array.of(0x96)] },
    { bits: 2, colors: 1, columns: 4, rows: [Uint8Array.of(0x1b), Uint8Array.of(0xe4)] },
    { bits: 4, colors: 1, columns: 2, rows: [Uint8Array.of(0x13), Uint8Array.of(0x6a)] },
    { bits: 8, colors: 3, columns: 2, rows: [Uint8Array.of(1, 2, 3, 4, 5, 6)] },
    { bits: 16, colors: 1, columns: 2, rows: [Uint8Array.of(1, 2, 3, 4)] }
  ];
  for (const fixture of packedCases) {
    const bytesPerPixel = Math.max(1, Math.ceil(fixture.colors * fixture.bits / 8));
    const filtered = encodePngRows(fixture.rows, fixture.rows.map(() => 1), bytesPerPixel);
    assert.deepEqual(
      await decodePredictor(filtered, 15, fixture.colors, fixture.bits, fixture.columns),
      concat(...fixture.rows),
      `PNG predictor ${fixture.bits}-bit fixture`
    );
  }

  await assert.rejects(
    decodePredictor(Uint8Array.of(5, 0), 15, 1, 8, 1),
    hasPdfError("invalid-object", /filter byte/)
  );
  await assert.rejects(
    decodePredictor(Uint8Array.of(0, 1), 15, 1, 8, 2),
    hasPdfError("invalid-object", /Truncated PNG/)
  );
  await assert.rejects(
    decodePredictor(Uint8Array.of(), 15, 1, 3, 1),
    hasPdfError("invalid-object", /predictor parameters/)
  );
  await assert.rejects(
    decodePredictor(Uint8Array.of(), 3, 1, 8, 1),
    hasPdfError("unsupported-filter", /predictor 3/)
  );
  await assert.rejects(
    decodePredictor(Uint8Array.of(), 15, Number.MAX_SAFE_INTEGER, 16, 2),
    hasPdfError("resource-limit", /safe allocation arithmetic/)
  );
  await assert.rejects(
    decodePdfFilterChain(ascii(">"), ["ASCIIHexDecode"], [predictorParams(15, 1, 8, 100)], {
      limits: { maxDecodedStreamBytes: 10 }
    }),
    hasPdfError("resource-limit", /row size/)
  );
  await assert.rejects(
    decodePdfFilterChain(ascii(">"), ["ASCIIHexDecode"], [new Map([
      ["Predictor", 15], ["Colors", 1.5], ["BitsPerComponent", 8], ["Columns", 1]
    ])]),
    hasPdfError("invalid-object", /not an integer/)
  );
}

async function testLimitsAndCancellation() {
  await assert.rejects(
    decodePdfFilterChain(Uint8Array.of(1, 2), [], [], {
      limits: { maxDecodedStreamBytes: 1 }
    }),
    hasPdfError("resource-limit", /configured byte limit/)
  );
  const controller = new AbortController();
  controller.abort(new Error("fixture abort"));
  await assert.rejects(
    decodePdfFilterChain(ascii("61>"), ["ASCIIHexDecode"], [null], { signal: controller.signal }),
    hasPdfError("aborted", /aborted/)
  );
}

async function decodeOne(input, filter) {
  return await decodePdfFilterChain(input, [filter], [null]);
}

async function collectFilterChunks(input, filters, parameters, options) {
  const chunks = [];
  let length = 0;
  for await (const chunk of decodePdfFilterChainChunks(
    input,
    filters,
    parameters,
    options
  )) {
    chunks.push(chunk);
    length += chunk.length;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return { chunks, bytes: output };
}

async function decodePredictor(input, predictor, colors, bits, columns) {
  return await decodePdfFilterChain(asciiHexEncode(input), ["ASCIIHexDecode"], [
    predictorParams(predictor, colors, bits, columns)
  ]);
}

function predictorParams(predictor, colors, bits, columns) {
  return new Map([
    ["Predictor", predictor],
    ["Colors", colors],
    ["BitsPerComponent", bits],
    ["Columns", columns]
  ]);
}

function packLzwCodes(codes, earlyChange) {
  const bits = [];
  let width = 9;
  let nextCode = 258;
  let hasPrevious = false;
  for (const code of codes) {
    for (let bit = width - 1; bit >= 0; bit -= 1) bits.push((code >>> bit) & 1);
    if (code === 256) {
      width = 9;
      nextCode = 258;
      hasPrevious = false;
    } else if (code !== 257) {
      if (hasPrevious && nextCode < 4096) {
        nextCode += 1;
        if (width < 12 && nextCode + earlyChange === 1 << width) width += 1;
      }
      hasPrevious = true;
    }
  }
  const output = new Uint8Array(Math.ceil(bits.length / 8));
  for (let index = 0; index < bits.length; index += 1) {
    output[index >>> 3] |= bits[index] << (7 - (index & 7));
  }
  return output;
}

function ascii85Encode(input) {
  let output = "";
  for (let offset = 0; offset < input.length; offset += 4) {
    const available = Math.min(4, input.length - offset);
    let value = 0;
    for (let index = 0; index < 4; index += 1) value = value * 256 + (input[offset + index] ?? 0);
    const digits = Array.from({ length: 5 });
    for (let index = 4; index >= 0; index -= 1) {
      digits[index] = value % 85;
      value = Math.floor(value / 85);
    }
    output += digits.slice(0, available + 1).map((digit) => String.fromCharCode(digit + 33)).join("");
  }
  return ascii(`${output}~>`);
}

function asciiHexEncode(input) {
  let output = "";
  for (const byte of input) output += byte.toString(16).padStart(2, "0");
  return ascii(`${output}>`);
}

function encodePngRows(rows, filters, bytesPerPixel) {
  const encoded = [];
  let previous = null;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const filter = filters[rowIndex];
    encoded.push(filter);
    for (let column = 0; column < row.length; column += 1) {
      const left = column >= bytesPerPixel ? row[column - bytesPerPixel] : 0;
      const up = previous?.[column] ?? 0;
      const upLeft = column >= bytesPerPixel ? previous?.[column - bytesPerPixel] ?? 0 : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upLeft);
      encoded.push((row[column] - prediction + 256) & 0xff);
    }
    previous = row;
  }
  return Uint8Array.from(encoded);
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonalDistance = Math.abs(estimate - upLeft);
  return leftDistance <= upDistance && leftDistance <= diagonalDistance ? left
    : upDistance <= diagonalDistance ? up : upLeft;
}

function name(value) {
  return { kind: "name", value };
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function bytesOf(value) {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}

function concat(...chunks) {
  const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function hasPdfError(code, message) {
  return (error) => error instanceof PdfError && error.code === code && message.test(error.message);
}
