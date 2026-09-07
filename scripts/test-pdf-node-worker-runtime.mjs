import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [
    {
      openPdfInNodeWorker,
      sanitizeNodePdfWorkerExecArgv
    },
    { extractPdfPageScenes },
    { compileDensePdfInWorker }
  ] = await Promise.all([
    import("../src/pdf/workerClient.ts"),
    import("../src/pdfVectorExtractor.ts"),
    import("../src/densePdfFastWorkerClient.ts")
  ]);
  assert.deepEqual(
    sanitizeNodePdfWorkerExecArgv([
      "--trace-warnings",
      "--input-type=module",
      "--experimental-strip-types"
    ]),
    ["--trace-warnings", "--experimental-strip-types"]
  );
  assert.deepEqual(
    sanitizeNodePdfWorkerExecArgv(["--input-type", "commonjs", "--no-warnings"]),
    ["--no-warnings"]
  );
  assert.deepEqual(
    sanitizeNodePdfWorkerExecArgv([
      "--max-old-space-size=4096",
      "--max_semi_space_size",
      "32",
      "--title",
      "hepr-parent",
      "--optimize-for-size",
      "--trace-warnings"
    ]),
    ["--trace-warnings"]
  );
  const fixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 10] /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "1 0 0 rg 1 2 3 4 re f\n") }
    ]
  });
  // Node 24's test runner can forward process-wide defaults in execArgv.
  // Reproduce the publish failure on older Node versions too, without changing
  // the host's actual TLS, heap, or snapshot configuration.
  const processWideFlags = [
    "--v8-pool-size=4",
    "--trace-event-file-pattern=node_trace.${rotation}.log",
    "--secure-heap-min=2",
    "--tls-cipher-list=TLS_AES_256_GCM_SHA384",
    "--use-largepages=off",
    "--node-snapshot",
    "--secure-heap=0"
  ];
  const splitFlags = processWideFlags.flatMap((argument) => {
    const separator = argument.indexOf("=");
    return separator < 0 ? [argument] : [
      `--${argument.slice(2, separator).replaceAll("-", "_")}`,
      argument.slice(separator + 1)
    ];
  });
  for (const inheritedFlags of [processWideFlags, splitFlags]) {
    const originalExecArgv = process.execArgv.slice();
    process.execArgv.push(...inheritedFlags);
    try {
      const flagSession = await openPdfInNodeWorker({ kind: "bytes", bytes: fixture });
      try {
        const flagPage = await flagSession.compilePage(0);
        assert.ok(flagPage.stores.paths.fillPathMetaA.length > 0);
      } finally {
        await flagSession.close();
      }
      const denseResult = await compileDensePdfInWorker(fixture);
      assert.equal(denseResult.kind, "success", JSON.stringify(denseResult));
      assert.equal(denseResult.pages[0].compiled.fillPathCount, 1);
    } finally {
      process.execArgv.splice(0, process.execArgv.length, ...originalExecArgv);
    }
    const workerFlags = [
      "--trace-warnings", "--experimental-strip-types", "--inspect=0",
      "--import", "./preload.mjs", "--loader=./loader.mjs"
    ];
    assert.deepEqual(
      sanitizeNodePdfWorkerExecArgv([...inheritedFlags, ...workerFlags]),
      workerFlags,
      "filter process-wide arguments while preserving worker runtime options"
    );
  }
  const workerUrl = sourceWorkerBootstrapUrl(
    new URL("../src/pdf/pdfWorkerEntry.ts", import.meta.url)
  );
  const reads = [];
  let closeCount = 0;
  let session;
  process.execArgv.push("--max-old-space-size=4096");
  try {
    session = await openPdfInNodeWorker({
      kind: "range",
      byteLength: fixture.length,
      async read(offset, length, signal) {
        signal.throwIfAborted();
        reads.push([offset, length]);
        return fixture.slice(offset, offset + length);
      },
      close() {
        closeCount += 1;
      }
    }, { workerUrl, workerName: "hepr-range-test" });
  } finally {
    assert.equal(process.execArgv.pop(), "--max-old-space-size=4096");
  }
  assert.equal(session.info.pageCount, 1);
  const page = await session.compilePage(0);
  assert.equal(page.pageInfo.sourcePageIndex, 0);
  assert.ok(page.stores.paths.fillPathMetaA.length > 0);
  await session.close();
  await session.close();
  assert.ok(reads.length > 0);
  assert.equal(closeCount, 1);

  const extractionBytes = new Uint8Array(fixture);
  const extractionSnapshot = extractionBytes.slice();
  const extractionProgress = [];
  const [scene] = await extractPdfPageScenes(
    extractionBytes.buffer,
    {
      pdfFastPath: "off",
      enableSegmentMerge: false,
      enableInvisibleCull: true,
      onProgress: (event) => extractionProgress.push(event)
    }
  );
  assert.equal(scene.pageCount, 1);
  assert.equal(scene.fillPathCount, 1);
  assert.deepEqual(
    extractionBytes,
    extractionSnapshot,
    "full native worker extraction must preserve caller-owned bytes"
  );
  assert.ok(
    extractionProgress.some((event) => event.executionPath === "worker"),
    "full native extraction must report worker execution"
  );
  assert.ok(
    extractionProgress.every((event) => event.executionPath === "worker"),
    "the native tier must not report main-thread parsing"
  );

  const fontFixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 50] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "BT /F1 12 Tf 1 0 0 1 10 20 Tm (AB) Tj ET\n") },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /TrueType /BaseFont /FixtureSans /Encoding /WinAnsiEncoding >>"
      }
    ]
  });
  const callerFontBytes = buildTinySfnt();
  let fontRequests = 0;
  const fontSession = await openPdfInNodeWorker(
    { kind: "bytes", bytes: fontFixture },
    {
      workerUrl,
      workerName: "hepr-font-resolver-test",
      missingFontResolver(request, signal) {
        fontRequests += 1;
        assert.equal(request.baseFont, "FixtureSans");
        assert.equal(signal?.aborted, false);
        return { sfntBytes: callerFontBytes, identifier: "node-worker-fixture" };
      }
    }
  );
  const fontPage = await fontSession.compilePage(0);
  assert.equal(fontPage.textIndex.text, "AB");
  assert.equal(fontRequests, 1);
  assert.equal(callerFontBytes.byteLength, buildTinySfnt().byteLength);
  await fontSession.close();

  const imageFixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "/Im Do") },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode",
          Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
        )
      }
    ]
  });
  const callerSamples = Buffer.from([7, 8, 9]);
  let imageRequests = 0;
  const imageSession = await openPdfInNodeWorker(
    { kind: "bytes", bytes: imageFixture },
    {
      workerUrl,
      workerName: "hepr-image-codec-resolver-test",
      imageCodecResolver(request, signal) {
        imageRequests += 1;
        assert.equal(request.codec, "jpeg");
        assert.equal(request.components, 3);
        assert.equal(signal?.aborted, false);
        return {
          samples: callerSamples,
          width: 1,
          height: 1,
          components: 3,
          bitsPerComponent: 8
        };
      }
    }
  );
  const imagePage = await imageSession.compilePage(0);
  assert.equal(imageRequests, 1);
  assert.deepEqual([...imagePage.stores.images.data], [7, 8, 9, 255]);
  assert.deepEqual([...callerSamples], [7, 8, 9]);
  await imageSession.close();
  console.log("Node worker_threads PDF range, font, and image-codec runtime tests passed.");
} finally {
  hooks.deregister();
}

function sourceWorkerBootstrapUrl(entryUrl) {
  const source = `
    import { registerHooks } from "node:module";
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (context.parentURL?.includes("/src/") && /^\\.\\.?\\//.test(specifier) && !specifier.endsWith(".ts")) {
          return nextResolve(specifier + ".ts", context);
        }
        return nextResolve(specifier, context);
      }
    });
    await import(${JSON.stringify(entryUrl.href)});
  `;
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}
