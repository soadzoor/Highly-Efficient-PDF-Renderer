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

try {
  const [
    { createPdfRandomAccessReader, PDF_SOURCE_BLOCK_BYTES },
    { readIndirectObjectAt },
    { PdfError, mergePdfLimits }
  ] = await Promise.all([
    import("../src/pdf/nativeSource.ts"),
    import("../src/pdf/nativeObjects.ts"),
    import("../src/pdf/nativeTypes.ts")
  ]);

  await testMemoryOwnershipAndZeroCopy(createPdfRandomAccessReader, PDF_SOURCE_BLOCK_BYTES);
  await testGrowingObjectUsesSourceViews(
    createPdfRandomAccessReader,
    readIndirectObjectAt,
    mergePdfLimits,
    PDF_SOURCE_BLOCK_BYTES
  );
  await testAlignedCoalescingAndDedup(createPdfRandomAccessReader, PDF_SOURCE_BLOCK_BYTES);
  await testByteExactLru(createPdfRandomAccessReader, PDF_SOURCE_BLOCK_BYTES);
  await testRangeOversizedBackingIsolation(createPdfRandomAccessReader, PDF_SOURCE_BLOCK_BYTES);
  await testRangeOversizedBackingIsolation(createPdfRandomAccessReader, PDF_SOURCE_BLOCK_BYTES, Buffer);
  await testRangeCountsAndCloseRace(createPdfRandomAccessReader);
  await testHttpRangeIdentity(createPdfRandomAccessReader, PDF_SOURCE_BLOCK_BYTES, PdfError);
  await testHttpFallbacksAndLimits(createPdfRandomAccessReader, PdfError);
  await testHttpAbortAndCloseRaces(createPdfRandomAccessReader, PDF_SOURCE_BLOCK_BYTES, PdfError);

  console.log("Native PDF source/range edge-case tests passed.");
} finally {
  hooks.deregister();
}

async function testMemoryOwnershipAndZeroCopy(createReader, blockBytes) {
  const copiedInput = patternedBytes(blockBytes * 3 + 29);
  const copiedExpected = copiedInput.slice();
  const copied = await createReader({
    kind: "bytes",
    bytes: copiedInput,
    ownership: "copy"
  });
  const shortView = await copied.read(7, 31);
  const spanningView = await copied.read(blockBytes - 5, blockBytes + 17);
  const cachedView = await copied.read(blockBytes + 3, 19);
  assert.notEqual(shortView.buffer, copiedInput.buffer,
    "copy ownership must isolate the parser's stable source buffer");
  assert.equal(shortView.buffer.byteLength, copiedExpected.byteLength,
    "a memory read must view the one owned source allocation, not allocate a requested-size copy");
  assert.equal(spanningView.buffer, shortView.buffer,
    "a multi-block memory read must remain one contiguous source view");
  assert.equal(cachedView.buffer, shortView.buffer,
    "a cached memory read must reuse the same owned source allocation");
  copiedInput.fill(0);
  assert.deepEqual(shortView, copiedExpected.subarray(7, 38));
  assert.deepEqual(
    spanningView,
    copiedExpected.subarray(blockBytes - 5, blockBytes * 2 + 12)
  );
  const cancelledRead = new AbortController();
  cancelledRead.abort("cancel memory view read");
  await assert.rejects(
    copied.read(0, 1, cancelledRead.signal),
    (error) => error?.code === "aborted",
    "the stable-view path must retain per-read cancellation"
  );
  await copied.close();

  const transferredInput = patternedBytes(blockBytes * 2 + 11);
  const transferredExpected = transferredInput.slice();
  const transferredLength = transferredInput.byteLength;
  const transferred = await createReader({
    kind: "bytes",
    bytes: transferredInput,
    ownership: "transfer"
  }, { limits: { maxSourceCacheBytes: blockBytes } });
  assert.equal(transferredInput.byteLength, 0,
    "transfer ownership must still detach an ordinary source ArrayBuffer");
  const transferredSpan = await transferred.read(blockBytes - 3, blockBytes + 7);
  const afterLruEviction = await transferred.read(2, 13);
  assert.equal(transferredSpan.buffer, afterLruEviction.buffer,
    "LRU eviction must not introduce copies for a memory-owned source");
  assert.equal(transferredSpan.buffer.byteLength, transferredLength,
    "transferred memory reads must view the transferred allocation directly");
  assert.deepEqual(
    transferredSpan,
    transferredExpected.subarray(blockBytes - 3, blockBytes * 2 + 4)
  );
  await transferred.close();
}

async function testGrowingObjectUsesSourceViews(
  createReader,
  readIndirectObjectAt,
  mergePdfLimits,
  blockBytes
) {
  const encoder = new TextEncoder();
  const prefix = encoder.encode("% source-view object fixture\n");
  const payload = "a".repeat(blockBytes + 137);
  const objectBytes = encoder.encode(`42 7 obj\n<< /Payload (${payload}) >>\nendobj\n`);
  const source = new Uint8Array(prefix.length + objectBytes.length);
  source.set(prefix);
  source.set(objectBytes, prefix.length);
  const sourceSnapshot = source.slice();
  const owned = await createReader({ kind: "bytes", bytes: source, ownership: "copy" });
  const windows = [];
  const windowSnapshots = [];
  const observedReader = {
    byteLength: owned.byteLength,
    async read(offset, length, signal) {
      const bytes = await owned.read(offset, length, signal);
      windows.push(bytes);
      windowSnapshots.push(bytes.slice());
      return bytes;
    },
    close() { return owned.close(); }
  };
  const object = await readIndirectObjectAt(
    observedReader,
    prefix.length,
    mergePdfLimits({ maxDecodedStreamBytes: source.length })
  );
  assert.equal(object.ref.objectNumber, 42);
  assert.equal(object.ref.generation, 7);
  assert.ok(windows.length >= 2, "the object reader fixture must grow past its initial window");
  assert.equal(windows[0].byteLength, blockBytes);
  assert.ok(windows.every((window) => window.buffer === windows[0].buffer),
    "every growing object window must be a view of the same owned source allocation");
  assert.equal(windows[0].buffer.byteLength, source.length,
    "growing object reads must allocate no window-sized byte copies");
  for (let index = 0; index < windows.length; index += 1) {
    assert.deepEqual(windows[index], windowSnapshots[index],
      "the COS object reader must treat zero-copy input windows as immutable");
  }
  assert.deepEqual(source, sourceSnapshot, "copy ownership must preserve the caller's source bytes");
  await observedReader.close();
}

async function testAlignedCoalescingAndDedup(createReader, blockBytes) {
  const input = patternedBytes(blockBytes * 3);
  const reads = [];
  const gates = [];
  const reader = await createReader({
    kind: "range",
    byteLength: input.length,
    read(offset, length) {
      reads.push([offset, length]);
      return new Promise((resolve) => gates.push(() => resolve(input.slice(offset, offset + length))));
    }
  });

  const first = reader.read(1, blockBytes);
  const second = reader.read(blockBytes + 1, blockBytes * 2 - 2);
  assert.deepEqual(reads, [
    [0, blockBytes * 2],
    [blockBytes * 2, blockBytes]
  ], "overlap must reuse pending 64 KiB blocks without duplicate byte requests");
  for (const release of gates) release();
  assert.deepEqual(await first, input.slice(1, blockBytes + 1));
  assert.deepEqual(
    await second,
    input.slice(blockBytes + 1, blockBytes * 3 - 1)
  );
  await reader.close();
}

async function testByteExactLru(createReader, blockBytes) {
  const input = patternedBytes(blockBytes + 13);
  let exactReads = 0;
  const exact = await createReader({
    kind: "range",
    byteLength: input.length,
    async read(offset, length) {
      exactReads += 1;
      return input.slice(offset, offset + length);
    }
  }, { limits: { maxSourceCacheBytes: blockBytes + 13 } });
  await exact.read(0, blockBytes);
  await exact.read(blockBytes, 13);
  await exact.read(0, blockBytes);
  assert.equal(exactReads, 2, "a full block plus a short tail must fit an exact byte ceiling");
  await exact.close();

  let undersizedReads = 0;
  const undersized = await createReader({
    kind: "range",
    byteLength: input.length,
    async read(offset, length) {
      undersizedReads += 1;
      return input.slice(offset, offset + length);
    }
  }, { limits: { maxSourceCacheBytes: blockBytes - 1 } });
  await undersized.read(0, 1);
  await undersized.read(0, 1);
  assert.equal(undersizedReads, 2, "the LRU must not round a byte limit up to one full block");
  await undersized.close();
}

async function testRangeOversizedBackingIsolation(createReader, blockBytes, Bytes = Uint8Array) {
  const input = patternedBytes(blockBytes + 23);
  const oversizedBacking = Bytes.from(new Uint8Array(blockBytes * 8));
  let rangeReads = 0;
  const reader = await createReader({
    kind: "range",
    byteLength: input.length,
    async read(offset, length) {
      rangeReads += 1;
      const backingOffset = blockBytes * 3 + 17;
      oversizedBacking.set(input.subarray(offset, offset + length), backingOffset);
      return oversizedBacking.subarray(backingOffset, backingOffset + length);
    }
  });
  const first = await reader.read(5, 19);
  oversizedBacking.fill(0);
  const cached = await reader.read(5, 19);
  assert.equal(rangeReads, 1, "an isolated range block must still be served by the cache");
  assert.notEqual(first.buffer, oversizedBacking.buffer,
    "the cache must not retain an oversized range-provider backing allocation");
  assert.equal(first.buffer.byteLength, first.byteLength,
    "range read results retain their exact requested-size copy semantics");
  assert.deepEqual(cached, input.subarray(5, 24),
    "later range-provider mutation must not change the isolated cached block");
  await reader.close();
}

async function testRangeCountsAndCloseRace(createReader) {
  for (const delta of [-1, 1]) {
    const reader = await createReader({
      kind: "range",
      byteLength: 10,
      async read(_offset, length) {
        return new Uint8Array(length + delta);
      }
    });
    await assert.rejects(
      reader.read(0, 1),
      (error) => error?.code === "source-read" && error.details?.receivedLength === 10 + delta
    );
    await reader.close();
  }

  let release;
  let closeCount = 0;
  const reader = await createReader({
    kind: "range",
    byteLength: 16,
    read() {
      return new Promise((resolve) => { release = resolve; });
    },
    close() {
      closeCount += 1;
    }
  });
  const pending = reader.read(0, 1);
  await Promise.resolve();
  await reader.close();
  await assert.rejects(pending, (error) => error?.code === "closed");
  release(new Uint8Array(16));
  await Promise.resolve();
  await reader.close();
  assert.equal(closeCount, 1);
}

async function testHttpRangeIdentity(createReader, blockBytes, PdfError) {
  const input = patternedBytes(blockBytes + 7);

  await withFetch(async (_url, init) => {
    const range = parseRequestRange(init);
    const headers = new Headers({ ETag: '"strong-v1"' });
    if (range.start !== 0 || range.end !== 0) {
      assert.equal(new Headers(init.headers).get("if-range"), '"strong-v1"');
    }
    return rangedResponse(input, range, headers, "https://cdn.invalid/final.pdf");
  }, async () => {
    const reader = await createReader({ kind: "url", url: "https://origin.invalid/a.pdf" });
    assert.deepEqual(await reader.read(3, 9), input.slice(3, 12));
    await reader.close();
  });

  const lastModified = "Wed, 21 Oct 2015 07:28:00 GMT";
  await withFetch(async (_url, init) => {
    const range = parseRequestRange(init);
    const headers = new Headers({ ETag: 'W/"weak-v1"', "Last-Modified": lastModified });
    if (range.start !== 0 || range.end !== 0) {
      assert.equal(new Headers(init.headers).get("if-range"), lastModified);
    }
    return rangedResponse(input, range, headers);
  }, async () => {
    const reader = await createReader({ kind: "url", url: "https://fixture.invalid/weak.pdf" });
    await reader.read(0, 1);
    await reader.close();
  });

  const diagnostics = [];
  await withFetch(async (_url, init) => {
    const range = parseRequestRange(init);
    if (range.start !== 0 || range.end !== 0) {
      assert.equal(new Headers(init.headers).has("if-range"), false);
    }
    return rangedResponse(input, range, new Headers({ ETag: 'W/"weak-only"' }));
  }, async () => {
    const reader = await createReader(
      { kind: "url", url: "https://fixture.invalid/weak-only.pdf" },
      { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }
    );
    await reader.read(0, 1);
    await reader.close();
  });
  assert.equal(diagnostics[0]?.code, "source.validator-unavailable");

  let requestCount = 0;
  await withFetch(async (_url, init) => {
    const range = parseRequestRange(init);
    requestCount += 1;
    return rangedResponse(
      input,
      range,
      requestCount === 1 ? new Headers({ ETag: '"v1"' }) : new Headers()
    );
  }, async () => {
    const reader = await createReader({ kind: "url", url: "https://fixture.invalid/gone.pdf" });
    await assert.rejects(reader.read(0, 1), sourceChanged(PdfError));
    await reader.close();
  });

  requestCount = 0;
  await withFetch(async (_url, init) => {
    const range = parseRequestRange(init);
    requestCount += 1;
    return rangedResponse(
      input,
      range,
      new Headers({ ETag: '"stable"' }),
      requestCount === 1 ? "https://cdn.invalid/a.pdf" : "https://cdn.invalid/b.pdf"
    );
  }, async () => {
    const reader = await createReader({ kind: "url", url: "https://origin.invalid/redirect.pdf" });
    await assert.rejects(reader.read(0, 1), sourceChanged(PdfError));
    await reader.close();
  });

  requestCount = 0;
  await withFetch(async (_url, init) => {
    const range = parseRequestRange(init);
    requestCount += 1;
    return rangedResponse(input, range, new Headers({
      ETag: 'W/"weak-stable"',
      "Last-Modified": requestCount === 1
        ? "Wed, 21 Oct 2015 07:28:00 GMT"
        : "Thu, 22 Oct 2015 07:28:00 GMT"
    }));
  }, async () => {
    const reader = await createReader({
      kind: "url",
      url: "https://fixture.invalid/last-modified-changed.pdf"
    });
    await assert.rejects(reader.read(0, 1), sourceChanged(PdfError));
    await reader.close();
  });

  for (const contentRange of [
    "bytes 0-0/0",
    "bytes 1-0/2",
    "bytes 0-1/1",
    "bytes 0-0/*",
    "bytes 0-0/9007199254740992"
  ]) {
    await withFetch(async () => new Response(Uint8Array.of(0), {
      status: 206,
      headers: { "Content-Range": contentRange }
    }), async () => {
      await assert.rejects(
        createReader({ kind: "url", url: "https://fixture.invalid/invalid-range.pdf" }),
        (error) => error?.code === "source-read"
      );
    });
  }

  const fallbackInput = patternedBytes(blockBytes * 2);
  let fallbackRequest = 0;
  let announceFallback;
  let releaseFallback;
  const fallbackStarted = new Promise((resolve) => { announceFallback = resolve; });
  const fallbackGate = new Promise((resolve) => { releaseFallback = resolve; });
  await withFetch(async (_url, init) => {
    fallbackRequest += 1;
    if (fallbackRequest === 1) {
      return rangedResponse(
        fallbackInput,
        parseRequestRange(init),
        new Headers({ ETag: '"fallback-v1"' })
      );
    }
    if (fallbackRequest === 2) {
      announceFallback();
      return new Response(new ReadableStream({
        async start(controller) {
          await fallbackGate;
          controller.enqueue(fallbackInput);
          controller.close();
        }
      }), { status: 200, headers: { ETag: '"fallback-v1"' } });
    }
    return new Response(fallbackInput.slice(), {
      status: 200,
      headers: { ETag: '"fallback-v2"' }
    });
  }, async () => {
    const reader = await createReader({
      kind: "url",
      url: "https://fixture.invalid/concurrent-fallback.pdf"
    });
    const first = reader.read(0, 1);
    await fallbackStarted;
    await Promise.resolve();
    await assert.rejects(reader.read(blockBytes, 1), sourceChanged(PdfError));
    releaseFallback();
    await assert.rejects(first, sourceChanged(PdfError));
    await assert.rejects(
      reader.read(0, 1),
      sourceChanged(PdfError),
      "a changed source must poison blocks that were cached before the validator failure"
    );
    await reader.close();
  });
}

async function testHttpFallbacksAndLimits(createReader, PdfError) {
  const input = patternedBytes(77);
  let fetchCount = 0;
  const diagnostics = [];
  await withFetch(async () => {
    fetchCount += 1;
    return new Response(input.slice(), {
      status: 200,
      headers: { "Accept-Ranges": "bytes", "Content-Length": String(input.length) }
    });
  }, async () => {
    const reader = await createReader(
      { kind: "url", url: "https://fixture.invalid/lying-accept-ranges.pdf" },
      { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }
    );
    assert.deepEqual(await reader.read(5, 8), input.slice(5, 13));
    assert.equal(fetchCount, 1, "a 200 probe must become one transparent full download");
    await reader.close();
  });
  assert.equal(diagnostics[0]?.code, "source.range-full-download");

  await withFetch(async () => new Response(streamChunks([Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6)]), {
    status: 200
  }), async () => {
    await assert.rejects(
      createReader(
        { kind: "url", url: "https://fixture.invalid/unbounded.pdf" },
        { limits: { maxRepairScanBytes: 5 } }
      ),
      (error) => error instanceof PdfError && error.code === "resource-limit" &&
        error.details?.limit === 5
    );
  });

  await withFetch(async () => new Response(Uint8Array.of(1), {
    status: 200,
    headers: { "Content-Length": "6" }
  }), async () => {
    await assert.rejects(
      createReader(
        { kind: "url", url: "https://fixture.invalid/declared-too-large.pdf" },
        { limits: { maxRepairScanBytes: 5 } }
      ),
      (error) => error?.code === "resource-limit"
    );
  });

  await withFetch(async () => new Response(Uint8Array.of(1), { status: 204 }), async () => {
    await assert.rejects(
      createReader({ kind: "url", url: "https://fixture.invalid/no-content.pdf" }),
      (error) => error?.code === "source-read"
    );
  });

  await withFetch(async () => new Response(Uint8Array.of(1, 2), {
    status: 200,
    headers: { "Content-Length": "1" }
  }), async () => {
    await assert.rejects(
      createReader({ kind: "url", url: "https://fixture.invalid/overlong.pdf" }),
      (error) => error?.code === "source-read" && error.details?.receivedLength === 2
    );
  });
}

async function testHttpAbortAndCloseRaces(createReader, blockBytes, PdfError) {
  const openAbort = new AbortController();
  await withFetch(async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }), {
    status: 200
  }), async () => {
    const opening = createReader(
      { kind: "url", url: "https://fixture.invalid/slow-open.pdf" },
      { signal: openAbort.signal }
    );
    await Promise.resolve();
    openAbort.abort("stop opening");
    await assert.rejects(opening, (error) => error instanceof PdfError && error.code === "aborted");
  });

  const input = patternedBytes(blockBytes + 1);
  let requestCount = 0;
  await withFetch(async (_url, init) => {
    requestCount += 1;
    const range = parseRequestRange(init);
    if (requestCount === 1) {
      return rangedResponse(input, range, new Headers({ ETag: '"close-v1"' }));
    }
    return new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }), {
      status: 206,
      headers: {
        ETag: '"close-v1"',
        "Content-Range": `bytes ${range.start}-${range.end}/${input.length}`
      }
    });
  }, async () => {
    const reader = await createReader({ kind: "url", url: "https://fixture.invalid/slow-range.pdf" });
    const pending = reader.read(0, 1);
    await Promise.resolve();
    await reader.close();
    await assert.rejects(pending, (error) => error?.code === "closed");
  });

  const sourceAbort = new AbortController();
  await withFetch(async (_url, init) => {
    const range = parseRequestRange(init);
    return rangedResponse(input, range, new Headers({ ETag: '"source-signal"' }));
  }, async () => {
    const reader = await createReader({
      kind: "url",
      url: "https://fixture.invalid/source-signal.pdf",
      request: { signal: sourceAbort.signal }
    });
    await reader.read(0, 1);
    sourceAbort.abort("source lifetime ended");
    await assert.rejects(reader.read(0, 1), (error) => error?.code === "aborted");
    await reader.close();
  });
}

function rangedResponse(input, range, headers = new Headers(), finalUrl = "") {
  headers = new Headers(headers);
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${input.length}`);
  const response = new Response(input.slice(range.start, range.end + 1), { status: 206, headers });
  if (finalUrl) Object.defineProperty(response, "url", { configurable: true, value: finalUrl });
  return response;
}

function parseRequestRange(init) {
  const value = new Headers(init?.headers).get("range");
  const match = /^bytes=(\d+)-(\d+)$/.exec(value ?? "");
  assert.ok(match, `expected a byte range, received ${String(value)}`);
  return { start: Number(match[1]), end: Number(match[2]) };
}

function streamChunks(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
}

function patternedBytes(length) {
  return Uint8Array.from({ length }, (_, index) => (index * 29 + 17) & 255);
}

function sourceChanged(PdfError) {
  return (error) => error instanceof PdfError && error.code === "source-changed";
}

async function withFetch(fetchStub, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}
