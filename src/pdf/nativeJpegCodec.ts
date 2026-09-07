import type {
  CodecMetadataValue,
  NativeImageCodecRequest,
  NativeImageCodecResolver,
  NativeImageCodecResult
} from "./nativeImage";
import { PdfError, throwIfAborted } from "./nativeTypes";

export interface BundledJpegCodecAsset {
  readonly url: URL;
  readonly byteLength: number;
  readonly sha256: string;
  readonly sourcePackage: "@cwasm/jpeg-turbo@0.1.3";
  readonly sourceCommit: string;
  readonly codec: "libjpeg-turbo 2.0.4";
}

export const BUNDLED_JPEG_CODEC_ASSET: Readonly<BundledJpegCodecAsset> =
  Object.freeze({
    url: new URL(
      "../assets/codecs/jpeg/libjpeg-turbo-2.0.4.wasm?no-inline",
      import.meta.url
    ),
    byteLength: 139_151,
    sha256: "80ed55eef2d0ff276f837ef521fad8181ccdfa6f298f652f6e45aed7fbbbc871",
    sourcePackage: "@cwasm/jpeg-turbo@0.1.3",
    sourceCommit: "61bcc6c3fa933c796ee9b64c5ea9821966ef8e42",
    codec: "libjpeg-turbo 2.0.4"
  });

interface TurboJpegExports extends WebAssembly.Exports {
  readonly memory: WebAssembly.Memory;
  readonly malloc: (byteLength: number) => number;
  readonly free: (pointer: number) => void;
  readonly tjInitDecompress: () => number;
  readonly tjDecompressHeader3: (
    handle: number,
    jpegPointer: number,
    jpegLength: number,
    widthPointer: number,
    heightPointer: number,
    subsamplingPointer: number,
    colorSpacePointer: number
  ) => number;
  readonly tjDecompress2: (
    handle: number,
    jpegPointer: number,
    jpegLength: number,
    outputPointer: number,
    width: number,
    pitch: number,
    height: number,
    pixelFormat: number,
    flags: number
  ) => number;
  readonly tjDestroy: (handle: number) => number;
}

interface NodeFsPromises {
  readFile(path: string | URL): Promise<Uint8Array>;
}

interface JpegMarkerMetadata {
  readonly width: number;
  readonly height: number;
  readonly components: number;
  readonly precision: number;
  readonly frameMarker: number;
  readonly progressive: boolean;
  readonly scanCount: number;
  readonly adobeTransform: 0 | 1 | 2 | null;
}

interface JpegDecodePlan {
  readonly markers: JpegMarkerMetadata;
  readonly colorTransform: 0 | 1;
  readonly invertCmyk: boolean;
}

interface JpegMarkerCursor {
  readonly code: number;
  readonly markerOffset: number;
  readonly afterCode: number;
}

const TJPF_RGB = 0;
const TJPF_GRAY = 6;
const TJPF_CMYK = 11;
const TJCS_RGB = 0;
const TJCS_YCBCR = 1;
const TJCS_GRAY = 2;
const TJCS_CMYK = 3;
const TJCS_YCCK = 4;
const TJFLAG_ACCURATEDCT = 4096;
const TJFLAG_STOPONWARNING = 8192;
const JPEG_DECODE_FLAGS = TJFLAG_ACCURATEDCT | TJFLAG_STOPONWARNING;
const MAX_JPEG_INPUT_BYTES = 512 * 1024 * 1024;
const MAX_JPEG_OUTPUT_BYTES = 512 * 1024 * 1024;
// libjpeg-turbo 2.1's TJFLAG_LIMITSCANS uses 500. Normal encoders emit only
// a small fraction of this, while the cap blocks progressive scan-amplification
// attacks before entering this older synchronous codec kernel.
const MAX_JPEG_SCANS = 500;
// Real JPEGs generally contain tens of markers (or a few hundred ICC chunks).
// Keep the structural walk itself bounded independently of the byte ceiling.
const MAX_JPEG_MARKERS = 4096;
const WASM_PAGE_BYTES = 64 * 1024;
const WASM_INITIAL_MEMORY_BYTES = 2 * WASM_PAGE_BYTES;
// Reserve space for libjpeg state, Huffman/quantization tables, row buffers,
// and dlmalloc metadata that are not represented by the encoded/raw sample
// terms below. Keep this deliberately larger than the module's initial heap.
const JPEG_CODEC_OVERHEAD_BYTES = 1024 * 1024;
const JPEG_COEFFICIENT_BYTES = 2;

let compiledModulePromise: Promise<WebAssembly.Module> | undefined;

/**
 * HEPR's package-relative default image-codec bridge.
 *
 * A fresh WASM instance is used for every decode. The compiled 139 KiB module
 * remains cached, while an instance's grow-only linear memory becomes
 * unreachable as soon as the decode finishes. This prevents a large image
 * from permanently raising the memory floor of a direct session or worker.
 */
export function createBundledImageCodecResolver(
  maxAggregateBytes = MAX_JPEG_OUTPUT_BYTES
): NativeImageCodecResolver {
  if (!Number.isSafeInteger(maxAggregateBytes) || maxAggregateBytes <= 0) {
    throw new RangeError("The bundled JPEG aggregate byte limit must be a positive safe integer.");
  }
  return async (request, signal) => await resolveBundledImageCodecWithLimit(
    request,
    maxAggregateBytes,
    signal
  );
}

export const resolveBundledImageCodec: NativeImageCodecResolver =
  createBundledImageCodecResolver();

async function resolveBundledImageCodecWithLimit(
  request: Readonly<NativeImageCodecRequest>,
  maxAggregateBytes: number,
  signal?: AbortSignal
): Promise<NativeImageCodecResult> {
  throwIfAborted(signal);
  if (request.codec !== "jpeg") {
    throw jpegError(
      `${request.codec} image data requires its pinned codec kernel.`,
      "codec-not-bundled",
      { requestedCodec: request.codec }
    );
  }
  validateRequest(request);
  const decodePlan = preflightJpeg(request, signal);
  validateAggregateWorkingSet(request, decodePlan, maxAggregateBytes);

  let module: WebAssembly.Module;
  try {
    module = await waitForModule(loadCompiledModule(), signal);
  } catch (cause) {
    if (cause instanceof PdfError) throw cause;
    throw jpegError("Unable to load the bundled JPEG codec.", "codec-load-failed", {}, cause);
  }
  throwIfAborted(signal);

  let instance: WebAssembly.Instance;
  try {
    instance = await WebAssembly.instantiate(module, jpegImports());
  } catch (cause) {
    throw jpegError(
      "Unable to instantiate the bundled JPEG codec.",
      "codec-instantiate-failed",
      {},
      cause
    );
  }
  throwIfAborted(signal);

  return decodeJpeg(instance, request, decodePlan, signal);
}

function decodeJpeg(
  instance: WebAssembly.Instance,
  request: Readonly<NativeImageCodecRequest>,
  decodePlan: Readonly<JpegDecodePlan>,
  signal?: AbortSignal
): NativeImageCodecResult {
  const exports = readTurboJpegExports(instance);
  let inputPointer = 0;
  let metadataPointer = 0;
  let outputPointer = 0;
  let decoderHandle = 0;
  try {
    inputPointer = allocateWasm(exports, request.encoded.byteLength, "JPEG input");
    new Uint8Array(
      exports.memory.buffer,
      inputPointer,
      request.encoded.byteLength
    ).set(request.encoded);
    throwIfAborted(signal);

    decoderHandle = exports.tjInitDecompress();
    if (decoderHandle === 0) {
      throw jpegError("Unable to allocate a JPEG decoder.", "decoder-allocation-failed");
    }
    metadataPointer = allocateWasm(exports, 16, "JPEG metadata");
    const headerStatus = exports.tjDecompressHeader3(
      decoderHandle,
      inputPointer,
      request.encoded.byteLength,
      metadataPointer,
      metadataPointer + 4,
      metadataPointer + 8,
      metadataPointer + 12
    );
    if (headerStatus !== 0) {
      throw jpegError("The JPEG header is malformed.", "invalid-jpeg-header");
    }
    const metadata = new DataView(exports.memory.buffer, metadataPointer, 16);
    const width = metadata.getInt32(0, true);
    const height = metadata.getInt32(4, true);
    const colorSpace = metadata.getInt32(12, true);
    validateHeader(request, decodePlan, width, height, colorSpace);
    throwIfAborted(signal);

    const outputByteLength = checkedOutputByteLength(width, height, request.components);
    outputPointer = allocateWasm(exports, outputByteLength, "JPEG output");
    const pixelFormat = request.components === 1
      ? TJPF_GRAY
      : request.components === 3
        ? TJPF_RGB
        : TJPF_CMYK;
    const decodeStatus = exports.tjDecompress2(
      decoderHandle,
      inputPointer,
      request.encoded.byteLength,
      outputPointer,
      width,
      width * request.components,
      height,
      pixelFormat,
      JPEG_DECODE_FLAGS
    );
    if (decodeStatus !== 0) {
      throw jpegError("The JPEG sample payload is malformed.", "invalid-jpeg-payload");
    }
    throwIfAborted(signal);

    const samples = new Uint8Array(outputByteLength);
    samples.set(new Uint8Array(exports.memory.buffer, outputPointer, outputByteLength));
    if (decodePlan.invertCmyk) {
      // Adobe APP14 CMYK/YCCK uses complemented ink polarity. PDF DeviceCMYK
      // and HEPR's codec contract use 0 for no ink; an explicit PDF `/Decode`
      // is applied independently by the TypeScript image pipeline afterward.
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = 255 - samples[index];
      }
    }
    return Object.freeze({
      samples,
      width,
      height,
      components: request.components,
      bitsPerComponent: 8
    });
  } catch (cause) {
    if (cause instanceof PdfError) throw cause;
    throwIfAborted(signal);
    throw jpegError("The bundled JPEG decoder failed.", "jpeg-decoder-failed", {}, cause);
  } finally {
    // A JS exception from the imported longjmp() unwinds the WASM stack. Keep
    // every native allocation and the TurboJPEG handle on this JS-owned path.
    safeWasmCall(() => {
      if (outputPointer !== 0) exports.free(outputPointer);
    });
    safeWasmCall(() => {
      if (metadataPointer !== 0) exports.free(metadataPointer);
    });
    safeWasmCall(() => {
      if (decoderHandle !== 0) exports.tjDestroy(decoderHandle);
    });
    safeWasmCall(() => {
      if (inputPointer !== 0) exports.free(inputPointer);
    });
  }
}

function validateRequest(request: Readonly<NativeImageCodecRequest>): void {
  if (
    !Number.isSafeInteger(request.width) || request.width <= 0 ||
    !Number.isSafeInteger(request.height) || request.height <= 0 ||
    ![1, 3, 4].includes(request.components) ||
    request.bitsPerComponent !== 8 ||
    request.imageMask ||
    !(request.encoded instanceof Uint8Array) || request.encoded.byteLength === 0
  ) {
    throw jpegError("The JPEG request has an unsupported sample layout.", "invalid-request", {
      width: request.width,
      height: request.height,
      components: request.components,
      bitsPerComponent: request.bitsPerComponent,
      imageMask: request.imageMask
    });
  }
  if (request.encoded.byteLength > MAX_JPEG_INPUT_BYTES) {
    throw new PdfError("resource-limit", "The JPEG input exceeds the codec limit.", {
      details: {
        codec: "jpeg",
        bytes: request.encoded.byteLength,
        limit: MAX_JPEG_INPUT_BYTES
      }
    });
  }
  const parameterNames = Object.keys(request.decodeParameters);
  for (const name of parameterNames) {
    if (name !== "ColorTransform") {
      throw jpegError(
        `JPEG DecodeParms /${name} is unsupported by the bundled codec.`,
        "unsupported-decode-parameter",
        { parameter: name }
      );
    }
  }
  const colorTransform = request.decodeParameters.ColorTransform;
  if (
    colorTransform !== undefined &&
    (typeof colorTransform !== "number" || !Number.isInteger(colorTransform) ||
      (colorTransform !== 0 && colorTransform !== 1))
  ) {
    throw jpegError(
      "JPEG /ColorTransform must be 0 or 1.",
      "invalid-color-transform"
    );
  }
}

function preflightJpeg(
  request: Readonly<NativeImageCodecRequest>,
  signal?: AbortSignal
): Readonly<JpegDecodePlan> {
  const markers = inspectJpegMarkers(request.encoded, signal);
  if (
    markers.width !== request.width ||
    markers.height !== request.height
  ) {
    throw jpegError(
      "The JPEG dimensions disagree with the Image XObject.",
      "dimension-mismatch",
      {
        expectedWidth: request.width,
        expectedHeight: request.height,
        actualWidth: markers.width,
        actualHeight: markers.height
      }
    );
  }
  if (markers.components !== request.components) {
    throw jpegError(
      "The JPEG component count disagrees with the Image XObject color space.",
      "component-mismatch",
      {
        expectedComponents: request.components,
        actualComponents: markers.components
      }
    );
  }
  if (markers.precision !== request.bitsPerComponent) {
    throw jpegError(
      "The JPEG sample precision disagrees with the Image XObject.",
      "precision-mismatch",
      {
        expectedBitsPerComponent: request.bitsPerComponent,
        actualBitsPerComponent: markers.precision
      }
    );
  }

  const colorTransform = effectivePdfColorTransform(request, markers);
  return Object.freeze({
    markers,
    colorTransform,
    // This pinned TurboJPEG build already returns TJPF_CMYK in PDF ink
    // polarity for both direct Adobe CMYK and converted YCCK. `/Decode` is
    // applied independently by the TypeScript image pipeline.
    invertCmyk: false
  });
}

function validateAggregateWorkingSet(
  request: Readonly<NativeImageCodecRequest>,
  decodePlan: Readonly<JpegDecodePlan>,
  limit: number
): void {
  const pixels = checkedAggregateProduct("pixels", request.width, request.height);
  const rawBytes = checkedAggregateProduct("raw samples", pixels, request.components);

  // At codec invocation the document retains the original stream and the
  // request-owned copy, then the bridge copies the latter into WASM.
  const encodedCopies = checkedAggregateProduct(
    "encoded JPEG copies",
    request.encoded.byteLength,
    3
  );
  // Peak lifetime can overlap the WASM output, the resolver-owned JS result,
  // and the registry's validated owned copy before the instance is reclaimed.
  const rawCopies = checkedAggregateProduct("raw JPEG copies", rawBytes, 3);
  const unpackedSamples = checkedAggregateProduct(
    "unpacked JPEG samples",
    rawBytes,
    Uint16Array.BYTES_PER_ELEMENT
  );
  const rgbaOutput = checkedAggregateProduct("JPEG RGBA output", pixels, 4);

  let progressiveCoefficients = 0;
  if (decodePlan.markers.progressive) {
    // Progressive decoding retains all DCT coefficients. Sampling factors are
    // at most four; adding three blocks per axis upper-bounds MCU padding for
    // every component without trusting attacker-provided sampling metadata.
    const blockColumns = Math.ceil(request.width / 8) + 3;
    const blockRows = Math.ceil(request.height / 8) + 3;
    progressiveCoefficients = checkedAggregateProduct(
      "progressive JPEG coefficients",
      blockColumns,
      blockRows,
      request.components,
      64,
      JPEG_COEFFICIENT_BYTES
    );
  }

  const aggregateBeforePageRounding = checkedAggregateSum(
    WASM_INITIAL_MEMORY_BYTES,
    JPEG_CODEC_OVERHEAD_BYTES,
    encodedCopies,
    rawCopies,
    unpackedSamples,
    rgbaOutput,
    progressiveCoefficients
  );
  const aggregateBytes = roundUpAggregate(
    aggregateBeforePageRounding,
    WASM_PAGE_BYTES
  );
  if (aggregateBytes > limit) {
    throw new PdfError(
      "resource-limit",
      "The JPEG aggregate decode working set exceeds the configured stream limit.",
      {
        details: {
          codec: "jpeg",
          reason: "jpeg-aggregate-working-set",
          bytes: aggregateBytes,
          limit,
          aggregateBeforePageRounding,
          wasmPageBytes: WASM_PAGE_BYTES,
          codecOverhead: JPEG_CODEC_OVERHEAD_BYTES,
          encodedCopies,
          rawCopies,
          unpackedSamples,
          rgbaOutput,
          progressiveCoefficients
        }
      }
    );
  }
}

function roundUpAggregate(value: number, alignment: number): number {
  const remainder = value % alignment;
  return remainder === 0
    ? value
    : checkedAggregateSum(value, alignment - remainder);
}

function checkedAggregateProduct(label: string, ...values: number[]): number {
  let result = 1;
  for (const value of values) {
    result *= value;
    if (!Number.isSafeInteger(result) || result < 0) {
      throw new PdfError("resource-limit", `Invalid ${label} estimate.`, {
        details: { codec: "jpeg", reason: "jpeg-aggregate-overflow" }
      });
    }
  }
  return result;
}

function checkedAggregateSum(...values: number[]): number {
  let result = 0;
  for (const value of values) {
    result += value;
    if (!Number.isSafeInteger(result) || result < 0) {
      throw new PdfError("resource-limit", "The JPEG aggregate estimate overflowed.", {
        details: { codec: "jpeg", reason: "jpeg-aggregate-overflow" }
      });
    }
  }
  return result;
}

function inspectJpegMarkers(
  bytes: Uint8Array,
  signal?: AbortSignal
): Readonly<JpegMarkerMetadata> {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw markerError("JPEG data must begin with an SOI marker.", 0);
  }

  let cursor = 2;
  let markerCount = 1;
  let scanCount = 0;
  let frame: {
    width: number;
    height: number;
    components: number;
    precision: number;
    marker: number;
    progressive: boolean;
    componentIds: ReadonlySet<number>;
  } | null = null;
  let adobeTransform: 0 | 1 | 2 | null = null;
  let sawFirstScan = false;
  let sawEnd = false;
  let pending: JpegMarkerCursor | null = null;
  let nextAbortCheck = 0;

  const checkWork = (offset: number): void => {
    if (offset < nextAbortCheck) return;
    throwIfAborted(signal);
    nextAbortCheck = offset + 64 * 1024;
  };
  const countMarker = (markerOffset: number): void => {
    markerCount += 1;
    if (markerCount > MAX_JPEG_MARKERS) {
      throw jpegError(
        "The JPEG contains too many structural markers.",
        "jpeg-marker-limit",
        { markers: markerCount, limit: MAX_JPEG_MARKERS, markerOffset }
      );
    }
  };

  while (!sawEnd) {
    checkWork(cursor);
    const marker = pending ?? readBoundaryMarker(bytes, cursor);
    pending = null;
    cursor = marker.afterCode;
    countMarker(marker.markerOffset);

    if (marker.code === 0xd9) {
      sawEnd = true;
      break;
    }
    if (marker.code === 0xd8) {
      throw markerError("A JPEG contains more than one SOI marker.", marker.markerOffset);
    }
    if (isRestartMarker(marker.code)) {
      throw markerError("A JPEG restart marker occurs outside scan data.", marker.markerOffset);
    }
    if (marker.code === 0x01) {
      // TEM is the only parameterless marker that may occur between segments.
      continue;
    }

    const segment = readMarkerSegment(bytes, marker, signal);
    cursor = segment.end;
    checkWork(cursor);

    if (isStartOfFrameMarker(marker.code)) {
      if (frame) {
        throw markerError("A JPEG contains multiple frame headers.", marker.markerOffset);
      }
      frame = readStartOfFrame(bytes, marker, segment.payloadStart, segment.end);
      continue;
    }

    if (marker.code === 0xee && hasAdobeIdentifier(bytes, segment.payloadStart, segment.end)) {
      if (sawFirstScan) {
        throw markerError("An Adobe APP14 marker occurs after JPEG scan data.", marker.markerOffset);
      }
      if (segment.end - segment.payloadStart < 12) {
        throw markerError("An Adobe APP14 marker is truncated.", marker.markerOffset);
      }
      const rawTransform = bytes[segment.payloadStart + 11];
      if (rawTransform !== 0 && rawTransform !== 1 && rawTransform !== 2) {
        throw jpegError(
          "The Adobe APP14 JPEG color transform is unsupported.",
          "unsupported-adobe-transform",
          { adobeTransform: rawTransform, markerOffset: marker.markerOffset }
        );
      }
      if (adobeTransform !== null && adobeTransform !== rawTransform) {
        throw markerError("Adobe APP14 markers disagree on their color transform.", marker.markerOffset);
      }
      adobeTransform = rawTransform;
      continue;
    }

    if (marker.code === 0xda) {
      if (!frame) {
        throw markerError("JPEG scan data precedes its frame header.", marker.markerOffset);
      }
      validateStartOfScan(bytes, marker, segment.payloadStart, segment.end, frame.componentIds);
      sawFirstScan = true;
      scanCount += 1;
      if (scanCount > MAX_JPEG_SCANS) {
        throw jpegError(
          frame.progressive
            ? "The progressive JPEG exceeds the scan limit."
            : "The JPEG exceeds the scan limit.",
          frame.progressive ? "progressive-scan-limit" : "jpeg-scan-limit",
          {
            scans: scanCount,
            limit: MAX_JPEG_SCANS,
            progressive: frame.progressive,
            markerOffset: marker.markerOffset
          }
        );
      }
      pending = findMarkerAfterEntropyData(
        bytes,
        cursor,
        signal,
        checkWork
      );
      cursor = pending.afterCode;
      continue;
    }

    if (marker.code === 0xdc) {
      // DNL permits a zero-height frame whose final height is discovered only
      // inside entropy data. The compact TurboJPEG header ABI cannot expose
      // that safely before allocating, so reject it explicitly.
      throw jpegError(
        "Define-number-of-lines JPEG images are unsupported.",
        "unsupported-jpeg-dnl",
        { markerOffset: marker.markerOffset }
      );
    }
  }

  if (!sawEnd) {
    throw markerError("The JPEG has no EOI marker.", cursor);
  }
  if (!frame) {
    throw markerError("The JPEG has no frame header.", cursor);
  }
  if (!sawFirstScan || scanCount === 0) {
    throw markerError("The JPEG has no scan data.", cursor);
  }
  if (frame.height === 0) {
    throw jpegError(
      "Define-number-of-lines JPEG images are unsupported.",
      "unsupported-jpeg-dnl",
      { markerOffset: 0 }
    );
  }

  return Object.freeze({
    width: frame.width,
    height: frame.height,
    components: frame.components,
    precision: frame.precision,
    frameMarker: frame.marker,
    progressive: frame.progressive,
    scanCount,
    adobeTransform
  });
}

function readBoundaryMarker(bytes: Uint8Array, offset: number): JpegMarkerCursor {
  if (offset >= bytes.length) {
    throw markerError("The JPEG marker stream is truncated.", offset);
  }
  const markerOffset = offset;
  if (bytes[offset] !== 0xff) {
    throw markerError("Expected a JPEG marker prefix.", offset);
  }
  while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
  if (offset >= bytes.length) {
    throw markerError("The JPEG marker code is truncated.", markerOffset);
  }
  const code = bytes[offset];
  if (code === 0x00) {
    throw markerError("A stuffed zero occurs outside JPEG scan data.", markerOffset);
  }
  return { code, markerOffset, afterCode: offset + 1 };
}

function readMarkerSegment(
  bytes: Uint8Array,
  marker: Readonly<JpegMarkerCursor>,
  signal?: AbortSignal
): { payloadStart: number; end: number } {
  throwIfAborted(signal);
  if (marker.afterCode + 2 > bytes.length) {
    throw markerError("A JPEG marker length is truncated.", marker.markerOffset);
  }
  const length = readUint16(bytes, marker.afterCode);
  if (length < 2) {
    throw markerError("A JPEG marker has an invalid length.", marker.markerOffset);
  }
  const end = marker.afterCode + length;
  if (end > bytes.length) {
    throw markerError("A JPEG marker payload is truncated.", marker.markerOffset);
  }
  return { payloadStart: marker.afterCode + 2, end };
}

function readStartOfFrame(
  bytes: Uint8Array,
  marker: Readonly<JpegMarkerCursor>,
  payloadStart: number,
  end: number
): {
  width: number;
  height: number;
  components: number;
  precision: number;
  marker: number;
  progressive: boolean;
  componentIds: ReadonlySet<number>;
} {
  if (marker.code !== 0xc0 && marker.code !== 0xc1 && marker.code !== 0xc2) {
    throw jpegError(
      "The JPEG frame process is unsupported by the bundled DCT kernel.",
      "unsupported-jpeg-frame",
      { frameMarker: marker.code, markerOffset: marker.markerOffset }
    );
  }
  if (end - payloadStart < 6) {
    throw markerError("The JPEG frame header is truncated.", marker.markerOffset);
  }
  const precision = bytes[payloadStart];
  const height = readUint16(bytes, payloadStart + 1);
  const width = readUint16(bytes, payloadStart + 3);
  const components = bytes[payloadStart + 5];
  const expectedPayloadBytes = 6 + components * 3;
  if (
    width === 0 || components === 0 ||
    expectedPayloadBytes !== end - payloadStart
  ) {
    throw markerError("The JPEG frame header has an invalid layout.", marker.markerOffset);
  }
  const componentIds = new Set<number>();
  for (let index = 0; index < components; index += 1) {
    const componentId = bytes[payloadStart + 6 + index * 3];
    if (componentIds.has(componentId)) {
      throw markerError("The JPEG frame repeats a component identifier.", marker.markerOffset);
    }
    componentIds.add(componentId);
  }
  return {
    width,
    height,
    components,
    precision,
    marker: marker.code,
    progressive: isProgressiveFrameMarker(marker.code),
    componentIds
  };
}

function validateStartOfScan(
  bytes: Uint8Array,
  marker: Readonly<JpegMarkerCursor>,
  payloadStart: number,
  end: number,
  frameComponentIds: ReadonlySet<number>
): void {
  if (end - payloadStart < 4) {
    throw markerError("The JPEG scan header is truncated.", marker.markerOffset);
  }
  const components = bytes[payloadStart];
  if (components === 0 || end - payloadStart !== 4 + components * 2) {
    throw markerError("The JPEG scan header has an invalid layout.", marker.markerOffset);
  }
  const seen = new Set<number>();
  for (let index = 0; index < components; index += 1) {
    const componentId = bytes[payloadStart + 1 + index * 2];
    if (!frameComponentIds.has(componentId) || seen.has(componentId)) {
      throw markerError("The JPEG scan references an invalid component.", marker.markerOffset);
    }
    seen.add(componentId);
  }
}

function findMarkerAfterEntropyData(
  bytes: Uint8Array,
  start: number,
  signal: AbortSignal | undefined,
  checkWork: (offset: number) => void
): JpegMarkerCursor {
  let offset = start;
  while (offset < bytes.length) {
    checkWork(offset);
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const markerOffset = offset;
    offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) {
      throw markerError("JPEG scan data ends in a truncated marker.", markerOffset);
    }
    const code = bytes[offset];
    offset += 1;
    if (code === 0x00) continue;
    if (isRestartMarker(code) || code === 0x01) {
      // Restart markers may legitimately occur once per MCU. They are scan
      // delimiters, not structural segments, and must not consume the marker
      // structure budget.
      throwIfAborted(signal);
      continue;
    }
    if (code === 0xdc) {
      throw jpegError(
        "Define-number-of-lines JPEG images are unsupported.",
        "unsupported-jpeg-dnl",
        { markerOffset }
      );
    }
    return { code, markerOffset, afterCode: offset };
  }
  throw markerError("The JPEG scan data is truncated before EOI.", bytes.length);
}

function effectivePdfColorTransform(
  request: Readonly<NativeImageCodecRequest>,
  markers: Readonly<JpegMarkerMetadata>
): 0 | 1 {
  if (markers.adobeTransform !== null) {
    if (
      (request.components === 1 && markers.adobeTransform !== 0) ||
      (request.components === 3 && markers.adobeTransform === 2) ||
      (request.components === 4 && markers.adobeTransform === 1)
    ) {
      throw jpegError(
        "The Adobe APP14 transform is incompatible with the JPEG component count.",
        "adobe-transform-component-mismatch",
        {
          components: request.components,
          adobeTransform: markers.adobeTransform
        }
      );
    }
    // ISO 32000: an Adobe APP14 marker takes precedence over DecodeParms.
    return markers.adobeTransform === 0 ? 0 : 1;
  }
  const requested = request.decodeParameters.ColorTransform;
  if (requested === 0 || requested === 1) return requested;
  return request.components === 3 ? 1 : 0;
}

function hasAdobeIdentifier(bytes: Uint8Array, start: number, end: number): boolean {
  return end - start >= 5 &&
    bytes[start] === 0x41 && bytes[start + 1] === 0x64 &&
    bytes[start + 2] === 0x6f && bytes[start + 3] === 0x62 &&
    bytes[start + 4] === 0x65;
}

function isRestartMarker(code: number): boolean {
  return code >= 0xd0 && code <= 0xd7;
}

function isStartOfFrameMarker(code: number): boolean {
  return code >= 0xc0 && code <= 0xcf &&
    code !== 0xc4 && code !== 0xc8 && code !== 0xcc;
}

function isProgressiveFrameMarker(code: number): boolean {
  return code === 0xc2 || code === 0xc6 || code === 0xca || code === 0xce;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function markerError(message: string, markerOffset: number): PdfError {
  return jpegError(message, "invalid-jpeg-markers", { markerOffset });
}

function validateHeader(
  request: Readonly<NativeImageCodecRequest>,
  decodePlan: Readonly<JpegDecodePlan>,
  width: number,
  height: number,
  colorSpace: number
): void {
  if (width !== request.width || height !== request.height) {
    throw jpegError(
      "The JPEG dimensions disagree with the Image XObject.",
      "dimension-mismatch",
      {
        expectedWidth: request.width,
        expectedHeight: request.height,
        actualWidth: width,
        actualHeight: height
      }
    );
  }
  const encodedComponents = jpegColorSpaceComponents(colorSpace);
  if (encodedComponents !== request.components) {
    throw jpegError(
      "The JPEG component count disagrees with the Image XObject color space.",
      "component-mismatch",
      {
        expectedComponents: request.components,
        actualComponents: encodedComponents,
        jpegColorSpace: colorSpace
      }
    );
  }
  const canHonorTransform = request.components === 1
    ? colorSpace === TJCS_GRAY && decodePlan.colorTransform === 0
    : request.components === 3
      ? colorSpace === (decodePlan.colorTransform === 1 ? TJCS_YCBCR : TJCS_RGB)
      : colorSpace === (decodePlan.colorTransform === 1 ? TJCS_YCCK : TJCS_CMYK);
  if (!canHonorTransform) {
    // TurboJPEG's compact 2.x API cannot force jpeg_color_space after header
    // parsing. Fail visibly when its marker-derived interpretation cannot
    // implement the effective PDF transform.
    throw jpegError(
      "The bundled JPEG codec cannot apply the effective PDF color transform.",
      "color-transform-unavailable",
      {
        effectiveColorTransform: decodePlan.colorTransform,
        jpegColorSpace: colorSpace,
        adobeTransform: decodePlan.markers.adobeTransform
      }
    );
  }
}

function jpegColorSpaceComponents(colorSpace: number): 1 | 3 | 4 {
  switch (colorSpace) {
    case TJCS_GRAY: return 1;
    case TJCS_RGB:
    case TJCS_YCBCR: return 3;
    case TJCS_CMYK:
    case TJCS_YCCK: return 4;
    default:
      throw jpegError("The JPEG uses an unsupported encoded color space.", "unsupported-colorspace", {
        jpegColorSpace: colorSpace
      });
  }
}

function checkedOutputByteLength(width: number, height: number, components: number): number {
  const byteLength = width * height * components;
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > MAX_JPEG_OUTPUT_BYTES) {
    throw new PdfError("resource-limit", "The JPEG output exceeds the codec limit.", {
      details: { codec: "jpeg", bytes: byteLength, limit: MAX_JPEG_OUTPUT_BYTES }
    });
  }
  return byteLength;
}

function allocateWasm(exports: TurboJpegExports, byteLength: number, label: string): number {
  let pointer: number;
  try {
    pointer = exports.malloc(byteLength);
  } catch (cause) {
    throw jpegError(`Unable to allocate ${label}.`, "wasm-allocation-failed", {
      bytes: byteLength
    }, cause);
  }
  if (!Number.isSafeInteger(pointer) || pointer <= 0) {
    throw jpegError(`Unable to allocate ${label}.`, "wasm-allocation-failed", {
      bytes: byteLength
    });
  }
  return pointer;
}

function readTurboJpegExports(instance: WebAssembly.Instance): TurboJpegExports {
  const value = instance.exports as Partial<TurboJpegExports>;
  if (
    !(value.memory instanceof WebAssembly.Memory) ||
    typeof value.malloc !== "function" ||
    typeof value.free !== "function" ||
    typeof value.tjInitDecompress !== "function" ||
    typeof value.tjDecompressHeader3 !== "function" ||
    typeof value.tjDecompress2 !== "function" ||
    typeof value.tjDestroy !== "function"
  ) {
    throw jpegError("The bundled JPEG module has an invalid ABI.", "invalid-codec-abi");
  }
  return value as TurboJpegExports;
}

function loadCompiledModule(): Promise<WebAssembly.Module> {
  if (compiledModulePromise) return compiledModulePromise;
  const pending = (async (): Promise<WebAssembly.Module> => {
    const bytes = await loadAssetBytes(BUNDLED_JPEG_CODEC_ASSET.url);
    if (bytes.byteLength !== BUNDLED_JPEG_CODEC_ASSET.byteLength) {
      throw new Error(
        `Bundled JPEG codec length ${bytes.byteLength} does not match ` +
        `${BUNDLED_JPEG_CODEC_ASSET.byteLength}.`
      );
    }
    return await WebAssembly.compile(bytes);
  })();
  compiledModulePromise = pending;
  void pending.catch(() => {
    if (compiledModulePromise === pending) compiledModulePromise = undefined;
  });
  return pending;
}

async function loadAssetBytes(url: URL): Promise<Uint8Array<ArrayBuffer>> {
  const nodeProcess = (globalThis as {
    readonly process?: { readonly versions?: { readonly node?: string } };
  }).process;
  if (url.protocol === "file:" && nodeProcess?.versions?.node) {
    const moduleName = "node:fs/promises";
    const fs = await import(/* @vite-ignore */ moduleName) as unknown as NodeFsPromises;
    const bytes = await fs.readFile(url);
    return copyBytes(bytes);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch JPEG codec asset (${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function waitForModule(
  promise: Promise<WebAssembly.Module>,
  signal?: AbortSignal
): Promise<WebAssembly.Module> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new PdfError("aborted", "JPEG codec loading was aborted.", {
      cause: signal.reason
    }));
  }
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new PdfError(
      "aborted",
      "JPEG codec loading was aborted.",
      { cause: signal.reason }
    ));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (module) => {
        signal.removeEventListener("abort", abort);
        resolve(module);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

function jpegImports(): WebAssembly.Imports {
  const unsupportedRuntimeCall = (name: string): never => {
    throw new Error(`JPEG WASM attempted unsupported runtime call ${name}.`);
  };
  return {
    env: {
      setjmp: () => 0,
      longjmp: () => unsupportedRuntimeCall("longjmp")
    },
    wasi_snapshot_preview1: {
      environ_sizes_get: () => 0,
      environ_get: () => unsupportedRuntimeCall("environ_get"),
      proc_exit: () => unsupportedRuntimeCall("proc_exit"),
      fd_close: () => unsupportedRuntimeCall("fd_close"),
      fd_seek: () => unsupportedRuntimeCall("fd_seek"),
      fd_write: () => unsupportedRuntimeCall("fd_write")
    }
  };
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  output.set(bytes);
  return output;
}

function safeWasmCall(callback: () => void): void {
  try {
    callback();
  } catch {
    // The primary typed decode error remains authoritative. The per-decode
    // instance and its entire linear memory are discarded after this frame.
  }
}

function jpegError(
  message: string,
  reason: string,
  details: Readonly<Record<string, CodecMetadataValue>> = {},
  cause?: unknown
): PdfError {
  const scalarDetails: Record<string, string | number | boolean | null> = {
    codec: "jpeg",
    reason
  };
  for (const [key, value] of Object.entries(details)) {
    if (
      value === null || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean"
    ) {
      scalarDetails[key] = value;
    }
  }
  return new PdfError("unsupported-image", message, {
    cause,
    details: Object.freeze(scalarDetails)
  });
}
