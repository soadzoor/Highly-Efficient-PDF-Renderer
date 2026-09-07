import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import {
  DeterministicRng,
  fingerprintBytes,
  mutateBytes,
  withTimeout
} from "./lib/deterministicMutations.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [nativePdf, sessionApi] = await Promise.all([
    import("../src/pdf/nativePdf.ts"),
    import("../src/pdfSession.ts")
  ]);
  const {
    PdfCosParser,
    PdfError,
    PdfNeedMoreDataError,
    decodePdfFilterChain,
    openNativePdfDocument
  } = nativePdf;
  const { openPdf } = sessionApi;
  const encoder = new TextEncoder();

  const assertTypedPdfError = (error, label) => {
    assert.ok(
      error instanceof PdfError || error instanceof PdfNeedMoreDataError,
      `${label} leaked an untyped ${error?.constructor?.name ?? typeof error}: ${error?.message ?? error}`
    );
  };

  const pdfErrorOutcome = (error) => ({
    kind: "error",
    name: error.name,
    code: error.code ?? "need-more-data",
    message: error.message,
    offset: error.offset ?? null,
    objectNumber: error.objectNumber ?? null,
    pageIndex: error.pageIndex ?? null,
    details: error.details ?? null
  });

  const canonicalCos = (value) => {
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (Array.isArray(value)) return value.map(canonicalCos);
    if (value instanceof Map) {
      return ["dictionary", [...value].sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalCos(entry)])];
    }
    if (value?.kind === "name") return ["name", value.value];
    if (value?.kind === "string") return ["string", value.hex, fingerprintBytes(value.bytes)];
    if (value?.kind === "ref") return ["ref", value.objectNumber, value.generation];
    if (value?.kind === "stream") {
      return ["stream", canonicalCos(value.dictionary), fingerprintBytes(value.bytes)];
    }
    throw new Error(`Unexpected successful COS value ${String(value)}.`);
  };

  function captureCos(bytes, indirect) {
    try {
      const parser = new PdfCosParser(bytes, { maxDepth: 12 });
      const value = indirect ? parser.parseIndirectObject() : parser.parseValue();
      return {
        kind: "success",
        position: parser.position,
        value: indirect
          ? [value.ref.objectNumber, value.ref.generation, canonicalCos(value.value)]
          : canonicalCos(value)
      };
    } catch (error) {
      assertTypedPdfError(error, "COS mutation");
      return pdfErrorOutcome(error);
    }
  }

  function testCosMutations() {
    const corpus = [
      { indirect: false, bytes: encoder.encode("<< /Type /Page /Kids [1 0 R] /Name /A#20B /Text (a\\(b\\)) >>") },
      { indirect: false, bytes: encoder.encode("[null true false -1.25 12 0 R <48657072>]") },
      { indirect: false, bytes: encoder.encode("<< /Nested << /A [1 [2 [3]]] >> /Escaped /x#2Fy >>") },
      { indirect: true, bytes: encoder.encode("7 2 obj\n<< /Length 3 >>\nstream\nabc\nendstream\nendobj") },
      { indirect: true, bytes: encoder.encode("9 0 obj\n[(nested) <00ff> /Name]\nendobj") }
    ];
    const rng = new DeterministicRng(0x434f5307);
    for (let index = 0; index < 120; index += 1) {
      const source = corpus[rng.integer(corpus.length)];
      const mutated = mutateBytes(source.bytes, rng);
      assert.deepEqual(
        captureCos(mutated, source.indirect),
        captureCos(mutated, source.indirect),
        `COS mutation ${index} was not deterministic`
      );
    }

    const nested = encoder.encode(`${"[".repeat(20)}0${"]".repeat(20)}`);
    assert.throws(
      () => new PdfCosParser(nested, { maxDepth: 4 }).parseValue(),
      (error) => error instanceof PdfError && error.code === "resource-limit"
    );
  }

  async function captureFilter(input, filter, parameters) {
    try {
      const output = await withTimeout(
        decodePdfFilterChain(input, [filter], [parameters]),
        1_000,
        `${filter} mutation`
      );
      return { kind: "success", output: fingerprintBytes(output) };
    } catch (error) {
      assert.ok(error instanceof PdfError, `${filter} leaked an untyped filter failure: ${error}`);
      return pdfErrorOutcome(error);
    }
  }

  async function testFilterMutations() {
    const compressed = new Uint8Array(await new Response(
      new Blob([encoder.encode("small deterministic flate payload")])
        .stream()
        .pipeThrough(new CompressionStream("deflate"))
    ).arrayBuffer());
    const corpus = [
      { filter: "ASCIIHexDecode", bytes: encoder.encode("48656c6c6f>") },
      { filter: "ASCII85Decode", bytes: encoder.encode("z87cURD]j7BEbo80~>") },
      { filter: "RunLengthDecode", bytes: Uint8Array.of(2, 65, 66, 67, 254, 90, 128) },
      { filter: "LZWDecode", bytes: packNineBitCodes([256, 65, 66, 67, 257]) },
      { filter: "FlateDecode", bytes: compressed },
      {
        filter: "ASCIIHexDecode",
        bytes: encoder.encode("01 0A 0A 0A>"),
        parameters: new Map([
          ["Predictor", 12], ["Colors", 1], ["BitsPerComponent", 8], ["Columns", 3]
        ])
      }
    ];
    const rng = new DeterministicRng(0x46494c54);
    for (let index = 0; index < 84; index += 1) {
      const source = corpus[rng.integer(corpus.length)];
      const input = mutateBytes(source.bytes, rng);
      const filter = index % 17 === 0 ? `Unknown${rng.integer(8)}` : source.filter;
      const first = await captureFilter(input, filter, source.parameters ?? null);
      const second = await captureFilter(input, filter, source.parameters ?? null);
      assert.deepEqual(first, second, `filter mutation ${index} was not deterministic`);
    }

    await assert.rejects(
      decodePdfFilterChain(
        Uint8Array.of(129, 65, 128),
        ["RunLengthDecode"],
        [null],
        { limits: { maxDecodedStreamBytes: 8 } }
      ),
      (error) => error instanceof PdfError && error.code === "resource-limit"
    );
    await assert.rejects(
      decodePdfFilterChain(
        encoder.encode("00>"),
        ["ASCIIHexDecode"],
        [new Map([
          ["Predictor", 2],
          ["Colors", 2],
          ["BitsPerComponent", 16],
          ["Columns", Number.MAX_SAFE_INTEGER]
        ])]
      ),
      (error) => error instanceof PdfError && error.code === "resource-limit"
    );
    const controller = new AbortController();
    controller.abort("deterministic filter cancellation");
    await assert.rejects(
      decodePdfFilterChain(encoder.encode("00>"), ["ASCIIHexDecode"], [null], {
        signal: controller.signal
      }),
      (error) => error instanceof PdfError && error.code === "aborted"
    );
  }

  const pdfFixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "0 0 10 10 re f") }
    ]
  });

  async function capturePdfOpen(bytes, repair, limits) {
    try {
      const document = await withTimeout(
        openNativePdfDocument({ kind: "bytes", bytes, ownership: "copy" }, { repair, limits }),
        1_000,
        "xref mutation"
      );
      try {
        return {
          kind: "success",
          version: document.info.version,
          pageCount: document.info.pageCount,
          repaired: document.info.repaired,
          diagnostics: document.getDiagnostics()
        };
      } finally {
        await document.close();
      }
    } catch (error) {
      assert.ok(error instanceof PdfError, `xref mutation leaked an untyped failure: ${error}`);
      return pdfErrorOutcome(error);
    }
  }

  async function testXrefMutations() {
    const text = new TextDecoder("latin1").decode(pdfFixture);
    const xrefOffset = text.lastIndexOf("\nxref\n") + 1;
    assert.ok(xrefOffset > 0);
    const prefix = pdfFixture.slice(0, xrefOffset);
    const suffix = pdfFixture.slice(xrefOffset);
    const rng = new DeterministicRng(0x58524546);
    for (let index = 0; index < 60; index += 1) {
      const mutatedSuffix = mutateBytes(suffix, rng);
      const mutated = concatenate(prefix, mutatedSuffix);
      const repair = rng.integer(2) === 0 ? "off" : "safe";
      assert.deepEqual(
        await capturePdfOpen(mutated, repair),
        await capturePdfOpen(mutated, repair),
        `xref mutation ${index} was not deterministic`
      );
    }

    await assert.rejects(
      openNativePdfDocument(
        { kind: "bytes", bytes: pdfFixture },
        { repair: "off", limits: { maxRepairCandidates: 4 } }
      ),
      (error) => error instanceof PdfError && error.code === "resource-limit"
    );

    const brokenStartXref = pdfFixture.slice();
    const brokenText = new TextDecoder("latin1").decode(brokenStartXref);
    const numberStart = brokenText.lastIndexOf("startxref\n") + "startxref\n".length;
    const numberEnd = brokenText.indexOf("\n", numberStart);
    brokenStartXref.fill(0x39, numberStart, numberEnd);
    await assert.rejects(
      openNativePdfDocument(
        { kind: "bytes", bytes: brokenStartXref },
        { repair: "safe", limits: { maxRepairCandidates: 1 } }
      ),
      (error) => error instanceof PdfError && error.code === "resource-limit"
    );
    await assert.rejects(
      openNativePdfDocument(
        { kind: "bytes", bytes: brokenStartXref },
        { repair: "safe", limits: { maxRepairScanBytes: 64 } }
      ),
      (error) => error instanceof PdfError && error.code === "resource-limit"
    );
  }

  const sessionFixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 6 0 R >>"
      },
      {
        number: 4,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 6 0 R >>"
      },
      {
        number: 5,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 6 0 R >>"
      },
      { number: 6, body: tinyPdfStream("", "0 0 10 10 re f 20 0 10 10 re f") }
    ]
  });

  async function exerciseSession(seed) {
    const session = await withTimeout(
      openPdf({ kind: "bytes", bytes: sessionFixture }),
      1_000,
      "session open"
    );
    const outcomes = [];
    const rng = new DeterministicRng(seed);
    try {
      for (let index = 0; index < 18; index += 1) {
        const pageIndex = rng.integer(3);
        if (rng.integer(3) === 0) {
          const controller = new AbortController();
          controller.abort(new PdfError("aborted", `seeded compile cancellation ${index}`));
          await assert.rejects(
            withTimeout(
              session.compilePage(pageIndex, { signal: controller.signal }),
              1_000,
              "cancelled compilePage"
            ),
            (error) => error instanceof PdfError && error.code === "aborted"
          );
          outcomes.push(["compile-aborted", pageIndex]);
        } else {
          const order = [pageIndex, (pageIndex + 1) % 3, (pageIndex + 2) % 3];
          const iterator = session.compilePages({ sourcePageIndexes: order })[Symbol.asyncIterator]();
          const first = await withTimeout(iterator.next(), 1_000, "compilePages next");
          assert.equal(first.done, false);
          await withTimeout(iterator.return(), 1_000, "compilePages return");
          const reusable = await withTimeout(session.compilePage(pageIndex), 1_000, "session reuse");
          outcomes.push([
            "iterator-returned",
            pageIndex,
            first.value.displayProgram.groups[0].commands.length,
            reusable.displayProgram.groups[0].commands.length
          ]);
        }
      }
      await assert.rejects(
        session.compilePage(0, { limits: { maxCommandsPerPage: 1 } }),
        (error) => error instanceof PdfError && error.code === "resource-limit"
      );
      return outcomes;
    } finally {
      await session.close();
      await session.close();
    }
  }

  async function testSessionCancellation() {
    assert.deepEqual(
      await exerciseSession(0x53455353),
      await exerciseSession(0x53455353),
      "seeded session cancellation/early-return outcomes changed"
    );

    const rng = new DeterministicRng(0x43414e43);
    for (let index = 0; index < 10; index += 1) {
      const controller = new AbortController();
      let closeCalls = 0;
      const delay = 12 + rng.integer(8);
      const source = {
        kind: "range",
        byteLength: sessionFixture.length,
        async read(offset, length, signal) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          signal.throwIfAborted();
          return sessionFixture.slice(offset, offset + length);
        },
        close() {
          closeCalls += 1;
        }
      };
      const opening = openPdf(source, { signal: controller.signal });
      setTimeout(
        () => controller.abort(`seeded open cancellation ${index}`),
        rng.integer(Math.max(1, delay - 2))
      );
      await assert.rejects(
        withTimeout(opening, 1_000, "cancelled session open"),
        (error) => error instanceof PdfError && error.code === "aborted"
      );
      assert.equal(closeCalls, 1, "a cancelled session open must close its range source exactly once");
    }
  }

  testCosMutations();
  await testFilterMutations();
  await testXrefMutations();
  await testSessionCancellation();
  console.log("bounded deterministic native parser mutation tests passed (COS, filters, xref, session cancellation)");
} finally {
  hooks.deregister();
}

function packNineBitCodes(codes) {
  const output = new Uint8Array(Math.ceil(codes.length * 9 / 8));
  let bitOffset = 0;
  for (const code of codes) {
    for (let bit = 8; bit >= 0; bit -= 1) {
      if (code & (1 << bit)) output[bitOffset >>> 3] |= 1 << (7 - (bitOffset & 7));
      bitOffset += 1;
    }
  }
  return output;
}

function concatenate(...parts) {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
