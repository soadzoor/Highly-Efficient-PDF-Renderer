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
  createInternalBorrowedPdfByteSource,
  createPdfRandomAccessReader
} = await import("../src/pdf/nativeSource.ts");
const {
  openNativePdfDocumentFromBorrowedBytes
} = await import("../src/pdf/nativeBorrowedSource.ts");
const publicNativePdf = await import("../src/pdf/nativePdf.ts");
const { writeTinyPdf, tinyPdfStream } = await import("./lib/tinyPdfWriter.mjs");

try {
  await testZeroCopyReaderAndOneShotOwnership();
  await testNativeDocumentLifecycleAndImmutability();
  await testCancellationLeavesBorrowedBytesReusable();
  testBorrowingRejectsSharedMemory();
  testInternalEntryPointsStayPrivate();
  console.log("Native borrowed-byte source tests passed.");
} finally {
  hooks.deregister();
}

async function testZeroCopyReaderAndOneShotOwnership() {
  const pdf = fixture();
  const storage = new Uint8Array(pdf.length + 23);
  storage.fill(0xa5);
  const input = storage.subarray(11, 11 + pdf.length);
  input.set(pdf);
  const before = storage.slice();
  const source = createInternalBorrowedPdfByteSource(input, "borrowed-reader.pdf");

  const reader = await createPdfRandomAccessReader(source);
  const whole = await reader.read(0, input.length);
  assert.equal(whole.buffer, input.buffer, "the first borrowed reader must retain the exact backing buffer");
  assert.equal(whole.byteOffset, input.byteOffset);
  assert.deepEqual(whole, pdf);
  assert.equal(reader.label, "borrowed-reader.pdf");
  await reader.close();
  await reader.close();
  await assert.rejects(reader.read(0, 1), hasPdfError("closed"));
  assert.deepEqual(storage, before, "reading and closing must not modify borrowed storage");

  // The marker is deliberately consumed by reader 1. Reusing the same source
  // falls back to the public copy contract instead of creating two borrowers.
  const secondReader = await createPdfRandomAccessReader(source);
  const copied = await secondReader.read(0, input.length);
  assert.notEqual(copied.buffer, input.buffer);
  assert.deepEqual(copied, pdf);
  await secondReader.close();

  const publicCopyReader = await createPdfRandomAccessReader({
    kind: "bytes",
    bytes: input,
    ownership: "copy"
  });
  const publicCopy = await publicCopyReader.read(0, input.length);
  assert.notEqual(publicCopy.buffer, input.buffer, "public copy ownership must remain unchanged");
  await publicCopyReader.close();
}

async function testNativeDocumentLifecycleAndImmutability() {
  const input = fixture();
  const before = input.slice();
  const originalBuffer = input.buffer;
  const originalBufferLength = originalBuffer.byteLength;
  const document = await openNativePdfDocumentFromBorrowedBytes(input, {
    label: "borrowed-document.pdf",
    repair: "off"
  });

  assert.equal(document.info.pageCount, 1);
  assert.equal(document.info.label, "borrowed-document.pdf");
  const decoded = await document.getDecodedPageContents(0);
  assert.equal(decoded.length, 1);
  assert.equal(new TextDecoder().decode(decoded[0]), "q\n0 0 10 10 re W n\nQ");
  assert.deepEqual(input, before, "native parsing and stream decoding must not mutate input bytes");

  await document.close();
  await document.close();
  assert.equal(input.buffer, originalBuffer, "close must not detach borrowed input");
  assert.equal(input.buffer.byteLength, originalBufferLength);
  assert.deepEqual(input, before, "close must not clear or overwrite borrowed input");
  assert.throws(() => document.getPage(0), hasPdfError("closed"));
  await assert.rejects(document.resolveValue(null), hasPdfError("closed"));
}

async function testCancellationLeavesBorrowedBytesReusable() {
  const input = fixture();
  const before = input.slice();
  const openController = new AbortController();
  openController.abort(new Error("test open cancellation"));
  await assert.rejects(
    openNativePdfDocumentFromBorrowedBytes(input, {
      repair: "off",
      signal: openController.signal
    }),
    hasPdfError("aborted")
  );
  assert.deepEqual(input, before);

  const document = await openNativePdfDocumentFromBorrowedBytes(input, { repair: "off" });
  const operationController = new AbortController();
  operationController.abort(new Error("test operation cancellation"));
  await assert.rejects(
    document.getDecodedPageContents(0, operationController.signal),
    hasPdfError("aborted")
  );
  assert.equal((await document.getDecodedPageContents(0)).length, 1,
    "cancelling one operation must leave the document reusable");
  await document.close();
  assert.deepEqual(input, before);
}

function testBorrowingRejectsSharedMemory() {
  if (typeof SharedArrayBuffer !== "function") return;
  const shared = new Uint8Array(new SharedArrayBuffer(16));
  assert.throws(
    () => createInternalBorrowedPdfByteSource(shared),
    /exclusively owned ArrayBuffer/
  );
}

function testInternalEntryPointsStayPrivate() {
  assert.equal("createInternalBorrowedPdfByteSource" in publicNativePdf, false);
  assert.equal("openNativePdfDocumentFromBorrowedBytes" in publicNativePdf, false);
}

function fixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", "q\n0 0 10 10 re W n\nQ")
      }
    ]
  });
}

function hasPdfError(code) {
  return (error) => error?.name === "PdfError" && error?.code === code;
}
