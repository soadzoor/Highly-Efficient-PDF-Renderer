import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateRawSync, deflateSync, inflateSync } from "node:zlib";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

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
const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");

try {
  testFilterAndParameterParsing();
  await testChainedFilters();
  await testFlate();
  await testFlateEolRecovery();
  await testFlateMissingChecksumEol();
  await testStreamingFlateChunks();
  await testLzw();
  await testAscii85();
  await testAsciiHex();
  await testAsciiHexTrailingData();
  await testDocumentFilterDiagnostics();
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
  assert.equal(readDecodeParameters(null, 65).length, 65, "filter parameters have no guessed chain allowance");
  assert.equal(readFilterNames(Array.from({ length: 65 }, () => name("Fl"))).length, 65);
  assert.throws(() => readDecodeParameters(null, 0x1_0000_0000),
    hasPdfError("resource-limit", /array capacity/));
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
  const chainLength = 65;
  let deeplyFiltered = decoded;
  for (let index = 0; index < chainLength; index += 1) deeplyFiltered = bytesOf(deflateSync(deeplyFiltered));
  const deepFilters = Array(chainLength).fill("FlateDecode");
  const deepParameters = readDecodeParameters(null, chainLength);
  assert.deepEqual(await decodePdfFilterChain(deeplyFiltered, deepFilters, deepParameters), decoded,
    "a small valid filter chain beyond the former depth allowance decodes completely");
  const chunked = await collectFilterChunks(deeplyFiltered, deepFilters, deepParameters, { chunkSize: 2 });
  assert.deepEqual(chunked.bytes, decoded, "chunked decoding accepts the same complete chain");
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

  // PDF 32000-1 7.3.8.1 puts an EOL marker after the stream data and excludes
  // it from /Length. Producers that count it anyway leave a stray CR, LF, or
  // CRLF after an otherwise complete zlib stream. The marker is not data, and
  // the payload it follows decodes to exactly the same bytes.
  for (const marker of [[0x0a], [0x0d], [0x0d, 0x0a]]) {
    assert.deepEqual(
      await decodeOne(concat(zlib, Uint8Array.from(marker)), "FlateDecode"),
      decoded,
      `zlib stream followed by a ${marker.length}-byte EOL marker`
    );
  }

  // Only that marker is specified to sit there. Other trailing bytes, other
  // whitespace, and more than one marker stay errors.
  for (const junk of [[0x20], [0x09], [0x0a, 0x0a], [0x0a, 0x0d], [0x0d, 0x0a, 0x0a]]) {
    await assert.rejects(
      decodeOne(concat(zlib, Uint8Array.from(junk)), "FlateDecode"),
      hasPdfError("invalid-object", /FlateDecode/),
      `zlib stream followed by ${JSON.stringify(junk)}`
    );
  }
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

async function testFlateEolRecovery() {
  const decodeModes = [
    (input, options) => decodePdfFilterChain(input, ["FlateDecode"], [null], options),
    async (input, options) => {
      const result = await collectFilterChunks(input, ["FlateDecode"], [null], { chunkSize: 4093, ...options });
      assert.ok(result.chunks.every((chunk) => chunk.length > 0 && chunk.length <= 4093));
      return result.bytes;
    }
  ];
  // The low checksum byte is CR. A following LF is padding, but that CR is
  // still part of the zlib stream: trying only a two-byte trim corrupts it.
  const checksumCrPayload = Uint8Array.of(12);
  const checksumCr = bytesOf(deflateSync(checksumCrPayload));
  assert.equal(checksumCr.at(-1), 0x0d);
  for (const decode of decodeModes) {
    for (const marker of [[], [0x0a], [0x0d], [0x0d, 0x0a]]) {
      assert.deepEqual(await decode(concat(checksumCr, Uint8Array.from(marker))), checksumCrPayload);
    }
    const damaged = checksumCr.slice();
    damaged[damaged.length - 2] ^= 1;
    for (const input of [
      concat(damaged, Uint8Array.of(0x0a)),
      concat(checksumCr.subarray(0, -2), Uint8Array.of(0x0d, 0x0a)),
      ...[[0], [32], [9], [10, 10], [10, 13], [13, 13], [13, 10, 10], [13, 10, 13, 10]]
        .map((junk) => concat(checksumCr, Uint8Array.from(junk)))
    ]) {
      await assert.rejects(decode(input), hasPdfError("invalid-object", /FlateDecode/));
    }
    assert.deepEqual(await decode(concat(bytesOf(deflateSync(Uint8Array.of())), Uint8Array.of(10))), Uint8Array.of());
  }

  const nativeDecompressionStream = globalThis.DecompressionStream;
  try {
    // Model Chromium's synchronous enqueue-then-error behavior. The actual
    // TransformStream discards queued chunks after the pending read is filled.
    // Also exercise a decoder that exposes no output until integrity succeeds.
    for (const exposePrefix of [true, false]) {
      globalThis.DecompressionStream = class {
        constructor(format) {
          assert.equal(format, "deflate");
          const stream = new TransformStream({
            transform(input, controller) {
              const { buffer, engine } = inflateSync(input, { info: true });
              const hasTrailingBytes = engine.bytesWritten < input.length;
              if (exposePrefix || !hasTrailingBytes) {
                // Different retry boundaries also exercise skipping a prefix
                // that ends partway through a chunk, after multiple chunks.
                const outputChunkSize = hasTrailingBytes ? 65536 : 32749;
                for (let offset = 0; offset < buffer.length; offset += outputChunkSize) {
                  controller.enqueue(bytesOf(buffer.subarray(offset, offset + outputChunkSize)));
                }
              }
              if (hasTrailingBytes) throw new TypeError("Junk found after end of compressed data.");
            }
          });
          this.readable = stream.readable;
          this.writable = stream.writable;
        }
      };
      for (const size of [65536, 65537, 200003]) {
        const payload = Uint8Array.from({ length: size }, (_, index) => (index * 31 + (index >>> 7)) & 255);
        for (const marker of [[10], [13], [13, 10]]) {
          const encoded = concat(bytesOf(deflateSync(payload)), Uint8Array.from(marker));
          for (const decode of decodeModes) {
            assert.deepEqual(await decode(encoded), payload, "recovery must neither lose nor duplicate output");
          }
        }
      }
      const large = concat(bytesOf(deflateSync(new Uint8Array(200003))), Uint8Array.of(10));
      for (const decode of decodeModes) {
        await assert.rejects(decode(large, { limits: { maxDecodedStreamBytes: 100000 } }),
          hasPdfError("resource-limit", /configured byte limit/));
      }
      const cancelled = new AbortController();
      const iterator = decodePdfFilterChainChunks(large, ["FlateDecode"], [null], {
        chunkSize: 4093, signal: cancelled.signal
      })[Symbol.asyncIterator]();
      let received = 0;
      while (received <= 65536) received += (await iterator.next()).value.length;
      cancelled.abort(new Error("cancel recovered output"));
      await assert.rejects(iterator.next(), hasPdfError("aborted", /aborted/));
      await iterator.return?.();
    }
    // Abort exactly when the retry starts, after the original error's abort
    // check. It must escape as cancellation, not become a malformed PDF error.
    for (const decode of decodeModes) {
      const controller = new AbortController();
      let attempts = 0;
      globalThis.DecompressionStream = class extends nativeDecompressionStream {
        constructor(format) {
          super(format);
          if (++attempts === 2) controller.abort(new Error("cancel EOL recovery"));
        }
      };
      await assert.rejects(decode(concat(checksumCr, Uint8Array.of(13)), { signal: controller.signal }),
        hasPdfError("aborted", /aborted/));
    }
  } finally {
    globalThis.DecompressionStream = nativeDecompressionStream;
  }

  // Recovery belongs to original zlib input, never to the synthetic checksum
  // used for validating the separate raw-DEFLATE compatibility path.
  const raw = bytesOf(deflateRawSync(checksumCrPayload));
  for (const decode of decodeModes) {
    for (const marker of [[0], [10], [13], [13, 10]]) {
      await assert.rejects(decode(concat(raw, Uint8Array.from(marker))), hasPdfError("invalid-object", /FlateDecode/));
    }
  }
}

async function testFlateMissingChecksumEol() {
  const decodeModes = [
    (input, options) => decodePdfFilterChain(input, ["FlateDecode"], [null], options),
    async (input, options) => (await collectFilterChunks(input, ["FlateDecode"], [null], {
      ...options, chunkSize: 3
    })).bytes
  ];
  for (const [payload, marker] of [
    [Uint8Array.of(9), [10]],
    [Uint8Array.of(12), [13]],
    [Uint8Array.from([...Array(13).fill(255), 22]), [13, 10]]
  ]) {
    const encoded = bytesOf(deflateSync(payload));
    assert.deepEqual([...encoded.subarray(-marker.length)], marker);
    const truncated = encoded.subarray(0, -marker.length);
    for (const decode of decodeModes) {
      const diagnostics = [];
      assert.deepEqual(await decode(truncated, { onDiagnostic: diagnostic => diagnostics.push(diagnostic) }), payload);
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0].code, "filter.flate-eol-recovered");
      assert.deepEqual(diagnostics[0].details, { trimmedByteCount: 0, appendedByteCount: marker.length });
      if (payload.length > 1) {
        await assert.rejects(decode(truncated, { limits: { maxDecodedStreamBytes: payload.length - 1 } }),
          hasPdfError("resource-limit", /configured byte limit/));
      }
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(decode(truncated, { signal: controller.signal }), hasPdfError("aborted", /aborted/));
      const damaged = truncated.slice();
      damaged[damaged.length - 1] ^= 1;
      await assert.rejects(decode(damaged), hasPdfError("invalid-object", /FlateDecode/));
    }
  }
  const ordinaryChecksum = bytesOf(deflateSync(Uint8Array.of(1)));
  for (const decode of decodeModes) {
    await assert.rejects(decode(ordinaryChecksum.subarray(0, -1)), hasPdfError("invalid-object", /FlateDecode/));
  }

  // Reproduce a declared /Length that puts its final checksum LF outside the
  // payload. The following stream delimiter happens to be that missing byte.
  const payload = Uint8Array.of(9);
  const truncated = bytesOf(deflateSync(payload)).subarray(0, -1);
  const fixture = writeTinyPdf({ objects: [{ number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [] /Count 0 >>" },
    { number: 3, body: tinyPdfStream("/Filter /FlateDecode", truncated) }] });
  const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture });
  try {
    const stream = await document.resolveObject({ kind: "ref", objectNumber: 3, generation: 0 });
    assert.deepEqual(await document.decodeStream(stream), payload);
    assert.ok(document.getDiagnostics().some(diagnostic => diagnostic.code === "filter.flate-eol-recovered"));
  } finally {
    await document.close();
  }
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

async function testAsciiHexTrailingData() {
  const decodeModes = [
    (input, options) => decodePdfFilterChain(input, ["AHx"], [null], options),
    async (input, options) => (await collectFilterChunks(input, ["ASCIIHexDecode"], [null], {
      ...options, chunkSize: 1
    })).bytes
  ];
  for (const decode of decodeModes) {
    const diagnostics = [];
    const onDiagnostic = diagnostic => diagnostics.push(diagnostic);
    assert.deepEqual(await decode(ascii("61 62 6>\r\nendstr"), { onDiagnostic }), ascii("ab`"));
    assert.equal(diagnostics.length, 1, "trailing data produces one warning per decode");
    assert.equal(diagnostics[0].code, "filter.asciihex-trailing-data");
    assert.equal(diagnostics[0].severity, "warning");
    assert.deepEqual(diagnostics[0].details, { trailingByteCount: 8, nonWhitespaceByteCount: 6 });

    diagnostics.length = 0;
    assert.deepEqual(await decode(ascii("61>\u0000\t\r\n "), { onDiagnostic }), ascii("a"));
    assert.equal(diagnostics.length, 0, "trailing whitespace stays quiet");
    for (const payload of ["6162>\r\nendstr", "616>\r\nendstr"]) {
      await assert.rejects(
        decode(ascii(payload), { limits: { maxDecodedStreamBytes: 1 }, onDiagnostic }),
        hasPdfError("resource-limit", /configured byte limit/)
      );
    }
    await assert.rejects(
      decode(ascii("6g>\r\nendstr"), { onDiagnostic }),
      hasPdfError("invalid-object", /character/)
    );
    await assert.rejects(
      decode(ascii("6162"), { onDiagnostic }),
      hasPdfError("invalid-object", /no >/)
    );
    const controller = new AbortController();
    controller.abort(new Error("ASCIIHex trailing-data cancellation"));
    await assert.rejects(
      decode(ascii("61>\r\nendstr"), { signal: controller.signal, onDiagnostic }),
      hasPdfError("aborted", /aborted/)
    );
    assert.equal(diagnostics.length, 0, "failed or cancelled decodes do not report recovery");
  }

  const diagnostics = [];
  const payload = ascii("preserved filter chain");
  const chained = await collectFilterChunks(
    concat(asciiHexEncode(bytesOf(deflateSync(payload))), ascii("\r\nendstr")),
    ["ASCIIHexDecode", "FlateDecode"],
    [null, null],
    { chunkSize: 3, onDiagnostic: diagnostic => diagnostics.push(diagnostic) }
  );
  assert.deepEqual(chained.bytes, payload);
  assert.equal(diagnostics.length, 1, "chunk fallback forwards filter diagnostics");

  const controller = new AbortController();
  const iterator = decodePdfFilterChainChunks(ascii("616263>\r\nendstr"), ["AHx"], [null], {
    chunkSize: 1, signal: controller.signal
  })[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, ascii("a"));
  controller.abort(new Error("ASCIIHex chunk cancellation"));
  await assert.rejects(iterator.next(), hasPdfError("aborted", /aborted/));
  await iterator.return?.();
}

async function testDocumentFilterDiagnostics() {
  const document = await openNativePdfDocument({ kind: "bytes", bytes: writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("/Filter /ASCIIHexDecode", "712051>\r\nendstr") }
    ]
  }) });
  try {
    const [stream] = await document.getPageContentStreams(0);
    assert.deepEqual(await document.decodeStream(stream), ascii("q Q"));
    assert.deepEqual(await document.decodeStream(stream), ascii("q Q"));
    const chunks = [];
    for await (const chunk of document.decodeStreamChunks(stream, { chunkSize: 1 })) chunks.push(chunk);
    assert.deepEqual(concat(...chunks), ascii("q Q"));
    const diagnostics = document.getDiagnostics().filter(diagnostic => diagnostic.code === "filter.asciihex-trailing-data");
    assert.equal(diagnostics.length, 1, "document warnings deduplicate repeated whole/chunk stream decoding");
    assert.deepEqual(diagnostics[0].details, { trailingByteCount: 8, nonWhitespaceByteCount: 6 });
  } finally {
    await document.close();
  }
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
  for (const filter of [0, 1, 2, 3, 4]) {
    const partialRows = [Uint8Array.of(10, 20, 30, 40), Uint8Array.of(5, 15)];
    const encoded = bytesOf(deflateSync(encodePngRows(partialRows, [filter, filter], 1)));
    const params = predictorParams(15, 1, 8, 4);
    for (const chunked of [false, true]) {
      const diagnostics = [];
      const options = { onDiagnostic: diagnostic => diagnostics.push(diagnostic) };
      const result = chunked
        ? (await collectFilterChunks(encoded, ["FlateDecode"], [params], { ...options, chunkSize: 3 })).bytes
        : await decodePdfFilterChain(encoded, ["FlateDecode"], [params], options);
      assert.deepEqual(result, concat(...partialRows), `a partial final PNG block preserves filter ${filter} samples`);
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0].code, "filter.png-predictor-partial-row");
      assert.deepEqual(diagnostics[0].details, { rowBytes: 4, finalRowBytes: 2, decodedBytes: 6 });
      await assert.rejects(decodePdfFilterChain(encoded, ["FlateDecode"], [params], {
        limits: { maxDecodedStreamBytes: 7 }
      }), hasPdfError("resource-limit", /configured byte limit/));
    }
  }
  await assert.rejects(decodePredictor(Uint8Array.of(0), 15, 1, 8, 2),
    hasPdfError("invalid-object", /without samples/));
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
