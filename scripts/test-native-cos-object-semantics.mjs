import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const {
  PdfCosParser,
  PdfNeedMoreDataError,
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  isPdfString
} = await import("../src/pdf/nativeCos.ts");
const { readIndirectObjectAt } = await import("../src/pdf/nativeObjects.ts");
const { PdfError, mergePdfLimits } = await import("../src/pdf/nativeTypes.ts");

const encoder = new TextEncoder();

function testWhitespaceCommentsAndPrimitiveTokens() {
  const binaryHeader = concatenate([
    bytes("%PDF-1.7\r\n%"),
    Uint8Array.of(0x80, 0x81, 0xfe, 0xff),
    bytes("\r\n\0\t\f % ordinary comment\r\n true")
  ]);
  const parser = new PdfCosParser(binaryHeader);
  assert.equal(parser.parseValue(), true);
  assert.equal(parser.remaining, 0);

  assert.deepEqual(parseAll("false% comment\nnull /Name"), [false, null, ["name", "Name"]]);
  assert.equal(parseOne("true").value, true);
  assert.equal(parseOne("false").value, false);
  assert.equal(parseOne("null").value, null);
  assert.throws(() => parseOne("tru"), isNeedMore);
  assert.throws(() => parseOne("fals"), isNeedMore);
  assert.throws(() => parseOne("nul"), isNeedMore);
  assert.throws(() => parseOne("trueX"), hasPdfError("invalid-object"));
  assert.throws(() => parseOne("false0"), hasPdfError("invalid-object"));
  assert.throws(() => parseOne("nullName"), hasPdfError("invalid-object"));

  assert.throws(
    () => new PdfCosParser(bytes("0"), { baseOffset: Number.MAX_SAFE_INTEGER }).parseValue(),
    RangeError
  );
  assert.throws(() => new PdfCosParser(bytes("0"), { position: 2 }), RangeError);
  assert.throws(() => new PdfCosParser(bytes("0"), { maxDepth: -1 }), RangeError);
  assert.throws(() => new PdfCosParser(bytes("0"), { maxContainerEntries: -1 }), RangeError);
}

function testNumbersAndReferenceLookahead() {
  for (const [source, expected] of [
    ["0", 0], ["+17", 17], ["-42", -42], [".5", 0.5], ["-.25", -0.25],
    ["1.", 1], ["+0.0", 0]
  ]) assert.equal(parseOne(source).value, expected, source);

  const ref = parseOne("12 % object\r\n 34 % generation\n R").value;
  assert.equal(isPdfRef(ref), true);
  assert.deepEqual(ref, { kind: "ref", objectNumber: 12, generation: 34 });
  assert.deepEqual(canonical(parseOne("1 65535 R").value), ["ref", 1, 65_535]);
  assert.deepEqual(parseAll("[12 0]"), [[12, 0]]);
  assert.deepEqual(parseAll("[12 0 /R]"), [[12, 0, ["name", "R"]]]);

  for (const malformed of ["1e2", "1x", "--1", "1..2", "+-1", "1 0R"]) {
    assert.throws(() => parseOne(malformed), hasPdfError("invalid-object"), malformed);
  }
  for (const truncated of ["+", "-", ".", "+.", "-."]) {
    assert.throws(() => parseOne(truncated), isNeedMore, truncated);
  }
  assert.throws(() => parseOne("NaN"), hasPdfError("invalid-object"));
  assert.throws(() => parseOne("Infinity"), hasPdfError("invalid-object"));
  assert.throws(
    () => parseOne("9007199254740992"),
    hasPdfError("invalid-object", /safe integer range/)
  );
  assert.throws(
    () => parseOne(`1${"0".repeat(309)}.0`),
    hasPdfError("invalid-object", /Non-finite number/)
  );
  assert.throws(() => parseOne("[0 0 R]"), hasPdfError("invalid-object"));
  assert.throws(() => parseOne("[1 65536 R]"), hasPdfError("invalid-object"));
  assert.throws(() => parseOne("[1.0 0 R]"), hasPdfError("invalid-object"));
  assert.throws(() => parseOne("[1 0.0 R]"), hasPdfError("invalid-object"));

  const splitLookahead = new PdfCosParser(bytes("12 0"));
  assert.equal(splitLookahead.parseValue(), 12);
  assert.equal(splitLookahead.parseValue(), 0);
  assert.equal(splitLookahead.remaining, 0);
}

function testNamesAndStrings() {
  assert.deepEqual(parseAll("/A#20B /#23 /slash#2Fname /"), [
    ["name", "A B"], ["name", "#"], ["name", "slash/name"], ["name", ""]
  ]);
  const binaryName = parseOne(concatenate([bytes("/A"), Uint8Array.of(0x80), bytes("#00")])).value;
  assert.equal(isPdfName(binaryName), true);
  assert.deepEqual([...binaryName.value].map((character) => character.charCodeAt(0)), [0x41, 0x80, 0]);
  assert.throws(() => parseOne("/#"), isNeedMore);
  assert.throws(() => parseOne("/#2"), isNeedMore);
  assert.throws(() => parseOne("/#GG"), hasPdfError("invalid-object", /Malformed name escape/));

  assert.deepEqual(stringBytes("(a(b(c)d)e)"), bytes("a(b(c)d)e"));
  assert.deepEqual(
    stringBytes("(\\(\\)\\\\\\n\\r\\t\\b\\f\\q)"),
    Uint8Array.of(0x28, 0x29, 0x5c, 0x0a, 0x0d, 0x09, 0x08, 0x0c, 0x71)
  );
  assert.deepEqual(stringBytes("(\\101\\12\\377\\400)"), Uint8Array.of(65, 10, 255, 0));
  assert.deepEqual(stringBytes("(a\\\r\nb\\\nc\\\rd)"), bytes("abcd"));
  assert.deepEqual(stringBytes("(a\rb\r\nc\nd)"), bytes("a\nb\nc\nd"));
  assert.deepEqual(stringBytes(concatenate([bytes("(A"), Uint8Array.of(0), bytes("B)")])), Uint8Array.of(65, 0, 66));
  assert.throws(() => parseOne("("), isNeedMore);
  assert.throws(() => parseOne("(unterminated"), isNeedMore);
  assert.throws(() => parseOne("(trailing\\"), isNeedMore);

  assert.deepEqual(stringBytes("<4865 7072>"), bytes("Hepr"));
  assert.deepEqual(stringBytes("<A>"), Uint8Array.of(0xa0));
  assert.deepEqual(stringBytes("<>"), new Uint8Array());
  assert.throws(() => parseOne("<0G>"), hasPdfError("invalid-object"));
  assert.throws(() => parseOne("<00"), isNeedMore);
}

function testContainersDepthCountsAndDuplicates() {
  assert.deepEqual(parseAll("[null true false /N (S) <A> [1]]"), [[
    null, true, false, ["name", "N"], ["string", false, [83]],
    ["string", true, [160]], [1]
  ]]);
  const dictionary = parseOne("<< /A 1 /B [2 3] /C << /D false >> >>").value;
  assert.equal(isPdfDictionary(dictionary), true);
  assert.deepEqual([...dictionary.keys()], ["A", "B", "C"]);
  assert.equal(dictionary.get("A"), 1);

  let duplicateError;
  assert.throws(
    () => parseOne("<< /A 1 /A 2 >>"),
    (error) => {
      duplicateError = error;
      return hasPdfError("invalid-object", /duplicate \/A keys/)(error);
    }
  );
  assert.deepEqual(duplicateError.details, {
    reason: "duplicate-dictionary-key",
    key: "A"
  });
  assert.throws(
    () => parseOne("<< /A 1 /#41 2 >>"),
    hasPdfError("invalid-object", /duplicate \/A keys/)
  );
  const duplicateEvents = [];
  const firstWins = new PdfCosParser(bytes("<< /A 1 /A 2 >>"), {
    duplicateDictionaryKeys: "keep-first",
    onDuplicateDictionaryKey(key, offset) { duplicateEvents.push([key, offset]); }
  }).parseValue();
  assert.equal(firstWins.get("A"), 1);
  const lastWins = new PdfCosParser(bytes("<< /A 1 /A 2 >>"), {
    duplicateDictionaryKeys: "keep-last"
  }).parseValue();
  assert.equal(lastWins.get("A"), 2);
  assert.deepEqual(duplicateEvents, [["A", 8]]);

  assert.deepEqual(canonical(new PdfCosParser(bytes("[1 2]"), {
    maxContainerEntries: 2
  }).parseValue()), [1, 2]);
  assert.throws(
    () => new PdfCosParser(bytes("[1 2 3]"), { maxContainerEntries: 2 }).parseValue(),
    hasPdfError("resource-limit", /array/)
  );
  assert.throws(
    () => new PdfCosParser(bytes("<< /A 1 /B 2 >>"), { maxContainerEntries: 1 }).parseValue(),
    hasPdfError("resource-limit", /dictionary/)
  );
  assert.deepEqual(canonical(new PdfCosParser(bytes("[1]"), { maxDepth: 1 }).parseValue()), [1]);
  assert.throws(
    () => new PdfCosParser(bytes("[[]]"), { maxDepth: 1 }).parseValue(),
    hasPdfError("resource-limit")
  );
  assert.equal(new PdfCosParser(bytes("1"), { maxDepth: 0 }).parseValue(), 1);
  assert.throws(
    () => new PdfCosParser(bytes("[]"), { maxDepth: 0 }).parseValue(),
    hasPdfError("resource-limit")
  );

  assert.throws(() => parseOne("[1 2"), isNeedMore);
  assert.throws(() => parseOne("<< /A 1"), isNeedMore);
  assert.throws(() => parseOne("<< /A 1 >"), isNeedMore);
  assert.throws(() => parseOne("<< x"), hasPdfError("invalid-object"));
  assert.throws(() => parseOne("<< >x"), hasPdfError("invalid-object"));
  assert.throws(() => parseOne("<< 1 /A >>"), hasPdfError("invalid-object"));
  assert.throws(() => parseOne("<< /A >>"), hasPdfError("invalid-object"));
}

function testIndirectObjectBoundariesAndOffsets() {
  const source = bytes(" \n7 2 obj % before value\r\n [1 /A] % before end\n endobj trailing");
  const baseOffset = 1000;
  const parser = new PdfCosParser(source, { baseOffset });
  const object = parser.parseIndirectObject();
  assert.deepEqual(object.ref, { kind: "ref", objectNumber: 7, generation: 2 });
  assert.deepEqual(canonical(object.value), [1, ["name", "A"]]);
  const text = new TextDecoder("latin1").decode(source);
  assert.equal(object.startOffset, baseOffset + text.indexOf("7"));
  assert.equal(object.valueStartOffset, baseOffset + text.indexOf("["));
  assert.equal(object.valueEndOffset, baseOffset + text.indexOf("]") + 1);
  assert.equal(object.endOffset, baseOffset + text.indexOf("endobj") + "endobj".length);
  assert.equal(parser.position, object.endOffset - baseOffset);
  assert.equal(new TextDecoder().decode(source.subarray(parser.position)), " trailing");

  const prefixParser = new PdfCosParser(source, { baseOffset });
  const prefix = prefixParser.parseIndirectObjectPrefix();
  assert.equal(prefix.valueStartOffset, object.valueStartOffset);
  assert.equal(prefix.valueEndOffset, object.valueEndOffset);
  assert.equal(prefixParser.absolutePosition, object.valueEndOffset);

  for (const malformed of [
    "0 0 obj null endobj",
    "-1 0 obj null endobj",
    "1.0 0 obj null endobj",
    "1 0.0 obj null endobj",
    "1 65536 obj null endobj",
    "1 0obj null endobj",
    "1 0 objtrue endobj",
    "1 0 obj true endobjX"
  ]) assert.throws(() => parseObject(malformed), hasPdfError("invalid-object"), malformed);
  assert.throws(() => parseObject("1 0 obj true endob"), isNeedMore);
  assert.throws(() => parseObject("9007199254740992 0 obj null endobj"), hasPdfError("invalid-object"));
}

function testStreamFramingAndLengths() {
  const lf = parseObject("1 0 obj\n<< /Length 3 >>\nstream\nabc\nendstream\nendobj");
  assert.equal(isPdfStream(lf.value), true);
  assert.deepEqual(lf.value.bytes, bytes("abc"));

  const crlf = parseObject("1 0 obj\r<< /Length 3 >>\rstream\r\nabc\r\nendstream\rendobj");
  assert.deepEqual(crlf.value.bytes, bytes("abc"));

  const payload = bytes("A\nendstream\nB");
  const embedded = parseObject(concatenate([
    bytes(`1 0 obj\n<< /Length ${payload.length} >>\nstream\n`),
    payload,
    bytes("\nendstream\nendobj")
  ]));
  assert.deepEqual(embedded.value.bytes, payload, "declared Length must defeat payload endstream text");

  const countedEol = parseObject("1 0 obj << /Length 4 >> stream\nabc\nendstream\nendobj");
  assert.deepEqual(countedEol.value.bytes, bytes("abc\n"));

  const indirect = parseObject(
    "1 0 obj << /Length 2 0 R >> stream\nabc\nendstream\nendobj",
    { resolveLength: (value) => isPdfRef(value) && value.objectNumber === 2 ? 3 : undefined }
  );
  assert.deepEqual(indirect.value.bytes, bytes("abc"));

  for (const malformed of [
    "1 0 obj << >> stream\nabc\nendstream\nendobj",
    "1 0 obj << /Length /Bad >> stream\nabc\nendstream\nendobj",
    "1 0 obj << /Length 3 >> stream abc\nendstream\nendobj",
    "1 0 obj << /Length 3 >> stream\nabcendstream\nendobj",
    "1 0 obj << /Length 2 >> stream\nabc\nendstream\nendobj",
    "1 0 obj << /Length 4 >> stream\nabc\nendstreamX\nendobj"
  ]) assert.throws(() => parseObject(malformed), hasPdfError("invalid-object"), malformed);

  assert.throws(
    () => parseObject("1 0 obj << /Length 2 0 R >> stream\nabc\nendstream\nendobj"),
    hasPdfError("invalid-object", /resolvable/)
  );
  assert.throws(
    () => parseObject("1 0 obj << /Length 9 >> stream\nabc"),
    isNeedMore
  );
  assert.throws(
    () => parseObject("1 0 obj << /Length 3 >> stream\nabc\nendstream\nendob"),
    isNeedMore
  );
}

async function testGrowingObjectReaderAndCancellation() {
  const prefix = bytes("prefix-junk\n");
  const literalBytes = new Uint8Array(70_000).fill(0x61);
  const objectBytes = concatenate([
    bytes("7 0 obj\n("), literalBytes, bytes(")\nendobj\n")
  ]);
  const source = concatenate([prefix, objectBytes, bytes("tail")]);
  const reader = new MemoryReader(source);
  const object = await readIndirectObjectAt(
    reader,
    prefix.length,
    mergePdfLimits({ maxDecodedStreamBytes: 200_000 })
  );
  assert.equal(isPdfString(object.value), true);
  assert.equal(object.value.bytes.length, literalBytes.length);
  assert.equal(object.startOffset, prefix.length);
  assert.equal(object.endOffset, prefix.length + objectBytes.length - 1);
  assert.ok(reader.reads.length >= 2, "the reader must grow beyond its initial 64 KiB window");

  const largeStreamPayload = new Uint8Array(300_000).fill(0x62);
  const largeStreamBytes = concatenate([
    bytes(`8 0 obj\n<< /Length ${largeStreamPayload.length} >>\nstream\n`),
    largeStreamPayload,
    bytes("\nendstream\nendobj")
  ]);
  const largeStreamReader = new MemoryReader(largeStreamBytes);
  const largeStream = await readIndirectObjectAt(
    largeStreamReader,
    0,
    mergePdfLimits({ maxDecodedStreamBytes: 400_000 }),
    undefined,
    { async resolveLength() { return undefined; } }
  );
  assert.equal(isPdfStream(largeStream.value), true);
  assert.equal(largeStream.value.bytes.length, largeStreamPayload.length);
  assert.equal(
    largeStreamReader.reads.length,
    2,
    "a direct stream Length must jump from the initial window to the required object window"
  );

  const indirectLengthBytes = bytes(
    "1 0 obj << /Length 2 0 R >> stream\nabc\nendstream\nendobj"
  );
  let resolutions = 0;
  const indirectStream = await readIndirectObjectAt(
    new MemoryReader(indirectLengthBytes),
    0,
    mergePdfLimits(),
    undefined,
    {
      async resolveLength(value) {
        assert.equal(isPdfRef(value), true);
        resolutions += 1;
        return 3;
      }
    }
  );
  assert.deepEqual(indirectStream.value.bytes, bytes("abc"));
  assert.equal(resolutions, 1, "indirect Length resolution must be deduplicated across window retries");

  await assert.rejects(
    readIndirectObjectAt(new MemoryReader(indirectLengthBytes), 0, mergePdfLimits(), undefined, {
      async resolveLength() { return undefined; }
    }),
    hasPdfError("invalid-object", /non-negative integer/)
  );
  await assert.rejects(
    readIndirectObjectAt(new MemoryReader(bytes("1 0 obj (truncated")), 0, mergePdfLimits()),
    hasPdfError("unexpected-eof")
  );
  await assert.rejects(
    readIndirectObjectAt(new MemoryReader(objectBytes), 0, mergePdfLimits({ maxDecodedStreamBytes: 1024 })),
    hasPdfError("resource-limit")
  );
  await assert.rejects(
    readIndirectObjectAt(new MemoryReader(objectBytes), -1, mergePdfLimits()),
    hasPdfError("invalid-xref")
  );

  const invalidLengthReader = new MemoryReader(objectBytes);
  invalidLengthReader.byteLength = Number.NaN;
  await assert.rejects(
    readIndirectObjectAt(invalidLengthReader, 0, mergePdfLimits()),
    hasPdfError("source-read")
  );

  await assert.rejects(
    readIndirectObjectAt(new MemoryReader(bytes("1 0 obj null endobj"), (value) => value.subarray(0, -1)), 0, mergePdfLimits()),
    hasPdfError("source-read")
  );
  await assert.rejects(
    readIndirectObjectAt(new MemoryReader(bytes("1 0 obj null endobj"), (value) => concatenate([value, Uint8Array.of(0)])), 0, mergePdfLimits()),
    hasPdfError("source-read")
  );
  await assert.rejects(
    readIndirectObjectAt(new MemoryReader(bytes("1 0 obj null endobj"), (value) => [...value]), 0, mergePdfLimits()),
    hasPdfError("source-read")
  );

  const preAborted = new AbortController();
  preAborted.abort("pre-aborted object read");
  await assert.rejects(
    readIndirectObjectAt(new MemoryReader(bytes("1 0 obj null endobj")), 0, mergePdfLimits(), preAborted.signal),
    hasPdfError("aborted")
  );

  const duringRead = new AbortController();
  await assert.rejects(
    readIndirectObjectAt(
      new MemoryReader(bytes("1 0 obj null endobj"), (value) => {
        duringRead.abort("abort after source read");
        return value;
      }),
      0,
      mergePdfLimits(),
      duringRead.signal
    ),
    hasPdfError("aborted")
  );

  const duringResolve = new AbortController();
  await assert.rejects(
    readIndirectObjectAt(
      new MemoryReader(indirectLengthBytes),
      0,
      mergePdfLimits(),
      duringResolve.signal,
      {
        async resolveLength() {
          duringResolve.abort("abort during Length resolution");
          return 3;
        }
      }
    ),
    hasPdfError("aborted")
  );
}

function testDeterministicMutationSeeds() {
  const corpus = [
    bytes("<< /Type /Page /Kids [1 0 R] /Name /A#20B /Text (a\\(b\\)) >>"),
    bytes("[null true false -1.25 12 0 R <48657072>]"),
    bytes("7 2 obj\n<< /Length 3 >>\nstream\nabc\nendstream\nendobj"),
    bytes("9 0 obj\n[(nested) <00ff> /Name]\nendobj")
  ];
  for (const seed of [0x434f5301, 0x434f5307, 0x0badc0de, 0x7fffffff]) {
    const random = xorshift(seed);
    for (let index = 0; index < 48; index += 1) {
      const source = corpus[random() % corpus.length];
      const mutated = mutate(source, random);
      const indirect = mutated.length > 5 && /\d/.test(String.fromCharCode(mutated[0]));
      assert.deepEqual(
        captureParse(mutated, indirect),
        captureParse(mutated, indirect),
        `COS mutation seed ${seed.toString(16)} case ${index} was non-deterministic`
      );
    }
  }
}

class MemoryReader {
  label = "COS fixture";
  reads = [];

  constructor(value, transform = (bytesValue) => bytesValue) {
    this.value = value;
    this.byteLength = value.length;
    this.transform = transform;
  }

  async read(offset, length, signal) {
    if (signal?.aborted) throw new PdfError("aborted", "fixture read aborted");
    this.reads.push({ offset, length });
    return this.transform(this.value.slice(offset, offset + length));
  }

  async close() {}
}

function parseOne(source, options) {
  const parser = new PdfCosParser(bytes(source), options);
  return { value: parser.parseValue(), position: parser.position };
}

function parseAll(source) {
  const parser = new PdfCosParser(bytes(source));
  const values = [];
  while (true) {
    parser.skipWhitespaceAndComments();
    if (parser.remaining === 0) return values.map(canonical);
    values.push(parser.parseValue());
  }
}

function parseObject(source, options) {
  return new PdfCosParser(bytes(source)).parseIndirectObject(options);
}

function stringBytes(source) {
  const value = parseOne(source).value;
  assert.equal(isPdfString(value), true);
  return value.bytes;
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Map) return ["dictionary", [...value].map(([key, entry]) => [key, canonical(entry)])];
  if (isPdfName(value)) return ["name", value.value];
  if (isPdfString(value)) return ["string", value.hex, [...value.bytes]];
  if (isPdfRef(value)) return ["ref", value.objectNumber, value.generation];
  if (isPdfStream(value)) return ["stream", canonical(value.dictionary), [...value.bytes]];
  throw new Error(`unknown COS value ${String(value)}`);
}

function captureParse(value, indirect) {
  try {
    const parser = new PdfCosParser(value, { maxDepth: 8, maxContainerEntries: 64 });
    const parsed = indirect ? parser.parseIndirectObject() : parser.parseValue();
    return {
      kind: "success",
      position: parser.position,
      value: indirect
        ? [parsed.ref.objectNumber, parsed.ref.generation, canonical(parsed.value)]
        : canonical(parsed)
    };
  } catch (error) {
    assert.ok(error instanceof PdfError || error instanceof PdfNeedMoreDataError);
    return {
      kind: "error",
      name: error.name,
      code: error.code ?? "need-more-data",
      message: error.message,
      offset: error.offset ?? null,
      details: error.details ?? null
    };
  }
}

function mutate(source, random) {
  let output = source.slice();
  const operations = 1 + (random() % 3);
  for (let operation = 0; operation < operations; operation += 1) {
    const mode = random() % 3;
    if (mode === 0 && output.length > 0) {
      output[random() % output.length] ^= 1 << (random() % 8);
    } else if (mode === 1 && output.length > 1) {
      output = output.slice(0, random() % output.length);
    } else {
      const position = output.length === 0 ? 0 : random() % (output.length + 1);
      output = concatenate([
        output.subarray(0, position),
        Uint8Array.of(random() & 0xff),
        output.subarray(position)
      ]);
    }
  }
  return output;
}

function xorshift(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function isNeedMore(error) {
  return error instanceof PdfNeedMoreDataError;
}

function hasPdfError(code, message) {
  return (error) => error instanceof PdfError && error.code === code &&
    (message === undefined || message.test(error.message));
}

function bytes(value) {
  return typeof value === "string" ? encoder.encode(value) : value;
}

function concatenate(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

try {
  testWhitespaceCommentsAndPrimitiveTokens();
  testNumbersAndReferenceLookahead();
  testNamesAndStrings();
  testContainersDepthCountsAndDuplicates();
  testIndirectObjectBoundariesAndOffsets();
  testStreamFramingAndLengths();
  await testGrowingObjectReaderAndCancellation();
  testDeterministicMutationSeeds();
} finally {
  hooks.deregister();
}

console.log("native COS/object semantic tests passed");
