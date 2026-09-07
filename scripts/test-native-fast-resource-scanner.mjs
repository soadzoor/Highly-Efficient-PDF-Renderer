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

const { scanDensePdfPreparedResourceReferences } =
  await import("../src/pdf/nativeContentCompiler.ts");
const {
  scanPreparedResourceReferencesFastOrExact,
  tryScanFastPreparedResourceReferences
} = await import("../src/pdf/nativeFastResourceScanner.ts");

const encoder = new TextEncoder();

testRepresentativeResourceSemantics();
testSinglePassNumericValidation();
testSimpleTierAndConservativeFallback();
testPreparedInlineImageBoundary();
testUnpreparedInlineImageProof();
testDeterministicDifferentialMutations();
testConservativeExactFallbacks();
testCancellation();
testLargePathDoesNotMaterializeNumbers();

console.log("Native fast prepared-resource scanner tests passed.");
hooks.deregister();

function testRepresentativeResourceSemantics() {
  const content = [
    "% fake /Ignored Do /IgnoredFont 9 Tf",
    "q 0 0 m 100 100 l S",
    "[(fake /Ignored Do) 20 <2f49676e6f72656420446f>] TJ",
    "/Im#20One Do /Im#20One Do /FormA Do",
    "/F#31 12 Tf /GS1 gs",
    "0 G 0.1 g 1 0 0 RG 0 1 0 rg 0 0 0 1 K 0 0 0 0 k",
    "/Cal#52GB CS /Spot cs /Shade#31 sh",
    "0.1 0.2 /Pattern#31 SCN 0.3 /Pattern2 scn",
    "/OC /Layer#20One BDC EMC",
    "/Span << /ActualText (hello) /Nested [true false null /NotAnOperator] >> BDC EMC",
    "/OC /Layer2 DP",
    "Q"
  ].join("\n");
  const segments = contentSegments(content);
  const exact = scanDensePdfPreparedResourceReferences(segments);
  const fast = tryScanFastPreparedResourceReferences(segments);

  assert.equal(fast.kind, "complete");
  assert.deepEqual(fast.references, exact);
  assert.deepEqual(fast.references.xObjects, ["Im One", "FormA"]);
  assert.deepEqual(fast.references.fonts, ["F1"]);
  assert.deepEqual(fast.references.extGStates, ["GS1"]);
  assert.deepEqual(fast.references.colorSpaces, [
    "DeviceGray",
    "DeviceRGB",
    "DeviceCMYK",
    "CalRGB",
    "Spot"
  ]);
  assert.deepEqual(fast.references.shadings, ["Shade1"]);
  assert.deepEqual(fast.references.patterns, ["Pattern1", "Pattern2"]);
  assert.deepEqual(fast.references.properties, ["Layer One", "Layer2"]);
  assert.deepEqual(fast.references.optionalContentProperties, ["Layer One", "Layer2"]);
  assert.equal(
    fast.references.xObjects.filter((name) => name === "Im One").length,
    1,
    "duplicate resource names remain first-use ordered and unique"
  );
  assert.equal(fast.stats.numericValueConversions, 0);
  assert.ok(
    fast.stats.decodedNameCount >
      fast.references.xObjects.length + fast.references.fonts.length,
    "stats count duplicate resource uses even though the result de-duplicates names"
  );

  const resolved = scanPreparedResourceReferencesFastOrExact(segments);
  assert.equal(resolved.strategy, "fast");
  assert.strictEqual(resolved.references, resolved.fastScan.references);
}

function testSinglePassNumericValidation() {
  const valid = contentSegments("+1 pop -2 pop .3 pop 4. pop 0.0 pop");
  const fast = tryScanFastPreparedResourceReferences(valid);
  assert.equal(fast.kind, "complete");
  assert.equal(fast.stats.scannerTier, "simple");
  assert.equal(fast.stats.numericTokenCount, 5);
  assert.deepEqual(fast.references, scanDensePdfPreparedResourceReferences(valid));

  for (const token of ["+", "-", ".", "1.2.3", "1e2", "--1", "1+2"]) {
    const malformed = tryScanFastPreparedResourceReferences(contentSegments(`${token} pop`));
    assert.equal(malformed.kind, "fallback", token);
    assert.equal(malformed.reason, "malformed-token", token);
  }

  const overlong = "1".repeat(301);
  const overlongMalformed = `1x${"0".repeat(299)}`;
  for (const token of [overlong, overlongMalformed]) {
    const limited = tryScanFastPreparedResourceReferences(contentSegments(`${token} pop`));
    assert.equal(limited.kind, "fallback");
    assert.equal(
      limited.reason,
      "numeric-token-limit",
      "the length limit must retain precedence over numeric grammar validation"
    );
  }

  const splitOverlong = tryScanFastPreparedResourceReferences(
    splitContentSegments(overlong, "2 pop")
  );
  assert.equal(splitOverlong.kind, "fallback");
  assert.equal(
    splitOverlong.reason,
    "cross-segment-token",
    "cross-segment fallback must retain precedence over the numeric length limit"
  );
}

function testSimpleTierAndConservativeFallback() {
  const segments = contentSegments([
    "/Span /Layer BDC /Element BMC q",
    "1 0 0 rg /F1 12 Tf <0041>Tj",
    "/Im Do /GS gs /Named CS /Shade sh 0.5 /P SCN",
    "/OC /Layer2 DP Q"
  ].join("\n"));
  const simple = tryScanFastPreparedResourceReferences(segments);
  assert.equal(simple.kind, "complete");
  assert.equal(simple.stats.scannerTier, "simple");
  assert.deepEqual(simple.references, scanDensePdfPreparedResourceReferences(segments));

  for (const content of [
    "% comment\n0 0 m S",
    "(text) Tj",
    "[1 2] TJ",
    "/Span << /MCID 1 >> BDC"
  ]) {
    const general = tryScanFastPreparedResourceReferences(contentSegments(content));
    assert.equal(general.kind, "complete");
    assert.equal(general.stats.scannerTier, "general");
  }
  for (const [content, reason] of [
    [")", "malformed-token"],
    ["/Bad#x Do", "malformed-token"],
    ["1e2 pop", "malformed-token"],
    ["BI", "inline-image-operator"],
    ["1", "invalid-resource-operands"]
  ]) {
    const fallback = tryScanFastPreparedResourceReferences(contentSegments(content));
    assert.equal(fallback.kind, "fallback");
    assert.equal(fallback.reason, reason);
    assert.equal(fallback.stats.scannerTier, "general");
  }
  const split = tryScanFastPreparedResourceReferences(splitContentSegments("0 0", " m"));
  assert.equal(split.kind, "complete");
  assert.equal(split.stats.scannerTier, "general");
}

function testPreparedInlineImageBoundary() {
  const before = encoder.encode("q /OC /Layer BDC EMC ");
  const after = encoder.encode(" /ImageAfter Do Q");
  const segments = [
    contentSegment(before, 0),
    { kind: "image", imageIndex: 7, sourceOffset: before.length, sourceLength: 19 },
    contentSegment(after, before.length + 19)
  ];
  const fast = tryScanFastPreparedResourceReferences(segments);
  assert.equal(fast.kind, "complete");
  assert.deepEqual(fast.references, scanDensePdfPreparedResourceReferences(segments));
  assert.deepEqual(fast.references.xObjects, ["ImageAfter"]);
  assert.equal(fast.stats.inlineImageCount, 1);
  assert.equal(fast.stats.contentBytes, before.length + after.length);
}

function testUnpreparedInlineImageProof() {
  for (const operator of ["BI", "ID", "EI"]) {
    const fast = tryScanFastPreparedResourceReferences(
      contentSegments(`q ${operator} /After Do Q`)
    );
    assert.equal(fast.kind, "fallback");
    assert.equal(fast.reason, "inline-image-operator");
  }

  const lexicalFalsePositives = contentSegments([
    "q",
    "/BI pop /NameResource Do",
    "(BI ID EI) Tj",
    "<4249204944204549> Tj",
    "% BI ID EI in a comment",
    "/After Do",
    "Q"
  ].join("\n"));
  const fast = tryScanFastPreparedResourceReferences(lexicalFalsePositives);
  assert.equal(fast.kind, "complete");
  assert.deepEqual(fast.references.xObjects, ["NameResource", "After"]);
  assert.deepEqual(
    fast.references,
    scanDensePdfPreparedResourceReferences(lexicalFalsePositives),
    "a complete raw scan proves inline operators are absent without false positives"
  );
}

function testDeterministicDifferentialMutations() {
  let state = 0x7a31c0de;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const separators = [" ", "\n", "\r\n", "\t", " % harmless /Fake Do\n"];
  const resourceNames = ["A", "B#20Two", "C#23Hash", "D-4"];

  for (let iteration = 0; iteration < 256; iteration += 1) {
    const resource = resourceNames[Math.floor(random() * resourceNames.length)];
    const snippets = [
      `${iteration} ${iteration + 1} m ${iteration + 2} ${iteration + 3} l S`,
      `/Im${resource} Do`,
      `/F${resource} ${8 + (iteration % 13)} Tf`,
      `/GS${resource} gs`,
      `/CS${resource} ${iteration & 1 ? "CS" : "cs"}`,
      `/Sh${resource} sh`,
      `${random().toFixed(5)} /P${resource} ${iteration & 1 ? "SCN" : "scn"}`,
      `/OC /Layer${resource} BDC [(text \\(nested\\)) 10] TJ EMC`,
      `/Tag << /MCID ${iteration} /Data [true false null <0a0B>] >> BDC EMC`,
      iteration % 3 === 0 ? "0 G 0 0 0 rg" : "q Q"
    ];
    shuffle(snippets, random);
    const separator = separators[Math.floor(random() * separators.length)];
    const segments = contentSegments(snippets.join(separator));
    const fast = tryScanFastPreparedResourceReferences(segments);
    assert.equal(fast.kind, "complete", `mutation ${iteration} unexpectedly fell back`);
    assert.deepEqual(
      fast.references,
      scanDensePdfPreparedResourceReferences(segments),
      `mutation ${iteration} disagrees with the exact scanner`
    );
  }
}

function testConservativeExactFallbacks() {
  const splitName = splitContentSegments("q /Im", "0 Do Q");
  let fast = tryScanFastPreparedResourceReferences(splitName);
  assert.equal(fast.kind, "fallback");
  assert.equal(fast.reason, "cross-segment-token");
  let resolved = scanPreparedResourceReferencesFastOrExact(splitName);
  assert.equal(resolved.strategy, "exact");
  assert.deepEqual(resolved.references.xObjects, ["Im0"]);

  const splitString = splitContentSegments("[(hel", "lo)] TJ /Im1 Do");
  fast = tryScanFastPreparedResourceReferences(splitString);
  assert.equal(fast.kind, "fallback");
  assert.equal(fast.reason, "cross-segment-token");
  resolved = scanPreparedResourceReferencesFastOrExact(splitString);
  assert.equal(resolved.strategy, "exact");
  assert.deepEqual(resolved.references.xObjects, ["Im1"]);

  const nested = `${"[".repeat(257)}null${"]".repeat(257)} pop /Deep Do`;
  const nestedSegments = contentSegments(nested);
  fast = tryScanFastPreparedResourceReferences(nestedSegments);
  assert.equal(fast.kind, "fallback");
  assert.equal(fast.reason, "nesting-limit");
  resolved = scanPreparedResourceReferencesFastOrExact(nestedSegments);
  assert.equal(resolved.strategy, "exact");
  assert.deepEqual(resolved.references.xObjects, ["Deep"]);

  const invalidTf = contentSegments("/F1 /Bad Tf");
  fast = tryScanFastPreparedResourceReferences(invalidTf);
  assert.equal(fast.kind, "fallback");
  assert.equal(fast.reason, "invalid-resource-operands");
  assert.throws(
    () => scanPreparedResourceReferencesFastOrExact(invalidTf),
    /Tf requires a numeric font-size operand/
  );

  const pendingBeforeImage = [
    contentSegment(encoder.encode("/Pending"), 0),
    { kind: "image", imageIndex: 0, sourceOffset: 8, sourceLength: 10 }
  ];
  fast = tryScanFastPreparedResourceReferences(pendingBeforeImage);
  assert.equal(fast.kind, "fallback");
  assert.equal(fast.reason, "inline-image-boundary");
  assert.throws(
    () => scanPreparedResourceReferencesFastOrExact(pendingBeforeImage),
    /Inline image interrupts/
  );
}

function testCancellation() {
  const controller = new AbortController();
  controller.abort(new Error("cancel fast resource scan"));
  assert.throws(
    () => tryScanFastPreparedResourceReferences(contentSegments("0 0 m"), {
      signal: controller.signal
    }),
    /cancel fast resource scan/
  );

  const fallbackController = new AbortController();
  const first = contentSegment(encoder.encode("/Im"), 0);
  const second = contentSegment(encoder.encode("0 Do"), first.sourceLength);
  let firstSegmentReads = 0;
  const cancelAtExactFallback = [first, second];
  Object.defineProperty(cancelAtExactFallback, 0, {
    configurable: true,
    enumerable: true,
    get() {
      firstSegmentReads += 1;
      if (firstSegmentReads === 2) {
        fallbackController.abort(new Error("cancel exact resource scan fallback"));
      }
      return first;
    }
  });
  assert.throws(
    () => scanPreparedResourceReferencesFastOrExact(cancelAtExactFallback, {
      signal: fallbackController.signal
    }),
    /cancel exact resource scan fallback/
  );
  assert.equal(firstSegmentReads, 2, "the cancellation must occur in the exact fallback");
}

function testLargePathDoesNotMaterializeNumbers() {
  const pathCount = 100_000;
  const content = encoder.encode("0 0 m 1 1 l\n".repeat(pathCount));
  const fast = tryScanFastPreparedResourceReferences([contentSegment(content, 0)]);
  assert.equal(fast.kind, "complete");
  assert.equal(fast.stats.scannerTier, "simple");
  assert.equal(fast.stats.numericTokenCount, pathCount * 4);
  assert.equal(fast.stats.operatorTokenCount, pathCount * 2);
  assert.equal(fast.stats.numericValueConversions, 0);
  assert.equal(fast.stats.maxOperandCount, 2);
  assert.equal(fast.stats.maxRetainedOperandSlots, 2);
  assert.equal(fast.stats.decodedNameCount, 0);
  assert.deepEqual(fast.references.xObjects, []);
}

function contentSegments(content) {
  const bytes = typeof content === "string" ? encoder.encode(content) : content;
  return [contentSegment(bytes, 0)];
}

function splitContentSegments(...chunks) {
  let sourceOffset = 0;
  return chunks.map((chunk) => {
    const bytes = encoder.encode(chunk);
    const segment = contentSegment(bytes, sourceOffset);
    sourceOffset += bytes.length;
    return segment;
  });
}

function contentSegment(bytes, sourceOffset) {
  return { kind: "content", bytes, sourceOffset, sourceLength: bytes.length };
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
}
