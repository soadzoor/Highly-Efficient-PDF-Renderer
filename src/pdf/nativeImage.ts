import {
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfString,
  isPdfStream,
  pdfRefKey,
  type PdfDictionary,
  type PdfRef,
  type PdfStream,
  type PdfValue
} from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import { NativePdfColorRegistry } from "./nativeColor";
import { convertDeviceCmykToSrgb } from "./deviceCmyk";
import {
  decodePdfFilterChain,
  readDecodeParameters,
  readFilterNames
} from "./nativeFilters";
import {
  decodeNativeCcittFax,
  type NativeCcittLimits,
  type NativeCcittParameters
} from "./nativeCcitt";
import {
  PdfError,
  throwIfAborted,
  type PdfResourceLimits
} from "./nativeTypes";
import {
  HEPR_IMAGE_FORMAT,
  type HeprImageStore
} from "../heprDocumentData";

export type NativeImageCodec = "jpeg" | "jpeg2000" | "jbig2" | "ccitt";
export type NativeImageMaskKind = "none" | "color-key" | "explicit" | "soft";

export interface CodecMetadataRecord {
  readonly [key: string]: CodecMetadataValue;
}

export type CodecMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly CodecMetadataValue[]
  | CodecMetadataRecord;

export interface NativePackedImageCodecPayload {
  readonly codec: NativeImageCodec;
  readonly encoded: Uint8Array;
  readonly globals: Uint8Array;
  readonly decodeParameters: Readonly<Record<string, CodecMetadataValue>>;
  /** Self-contained stable envelope suitable for the HEPR image byte store. */
  readonly payload: Uint8Array;
}

export interface NativeImageCodecRequest {
  readonly codec: NativeImageCodec;
  /** Expected Image XObject width. Codec output must match exactly. */
  readonly width: number;
  /** Expected Image XObject height. Codec output must match exactly. */
  readonly height: number;
  /**
   * Expected decoded component count. For JPX with `SMaskInData=1`, this
   * includes the final opacity component. A value of zero means the PDF omitted
   * the JPX color space and the current raw-sample contract cannot accept it.
   */
  readonly components: number;
  /** Expected sample precision, or zero when JPX owns the precision. */
  readonly bitsPerComponent: number;
  readonly imageMask: boolean;
  readonly encoded: Uint8Array;
  readonly globals: Uint8Array;
  readonly decodeParameters: Readonly<Record<string, CodecMetadataValue>>;
}

/**
 * Raw codec output in PDF packed-scanline layout. Every row is byte-aligned;
 * 1/2/4-bit samples are most-significant-bit first and 16-bit samples are
 * big-endian. The byte length must be exactly
 * `ceil(width * components * bitsPerComponent / 8) * height`.
 *
 * A JPX resolver must apply codestream palette/channel mapping and return
 * components in the explicit PDF `/ColorSpace` order. If `SMaskInData=1`, the
 * final component is straight opacity. Signed or heterogeneous-precision JPX
 * components must be normalized to the single unsigned precision reported by
 * the result. `SMaskInData=2` is intentionally rejected until the bridge can
 * represent its premultiplication semantics.
 */
export interface NativeImageCodecResult {
  readonly samples: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly components: number;
  readonly bitsPerComponent: number;
}

export type NativeImageCodecResolver = (
  request: Readonly<NativeImageCodecRequest>,
  signal?: AbortSignal
) => NativeImageCodecResult | Promise<NativeImageCodecResult>;

export interface NativePdfImageOptions {
  /**
   * `request` preserves payloads for external codecs; `error` fails instead.
   * Fully supported CCITT payloads are always decoded by the native kernel.
   */
  readonly codecPolicy?: "request" | "error";
  readonly onCodecRequest?: (request: Readonly<NativeImageCodecRequest>) => void;
  /** Validated, asynchronous bridge to focused JPEG/JPX/JBIG2/CCITT kernels. */
  readonly codecResolver?: NativeImageCodecResolver;
  /** Internal: preserve stable errors emitted by a package-owned codec. */
  readonly trustedCodecResolver?: boolean;
  /** Per-compilation ceilings, which may only lower the session limits. */
  readonly limits?: Partial<Pick<PdfResourceLimits, "maxDecodedStreamBytes">>;
}

export interface NativePdfImageDescription {
  readonly width: number;
  readonly height: number;
  readonly sourceBitsPerComponent: number;
  readonly format: number;
  readonly colorSpaceIndex: number;
  readonly interpolate: boolean;
  readonly imageMask: boolean;
  readonly softMaskImageIndex: number;
  readonly maskKind: NativeImageMaskKind;
  readonly colorKeyMask: readonly number[];
  readonly decode: readonly number[];
  readonly matte: readonly number[];
  readonly data: Uint8Array;
  readonly codecRequest: Readonly<NativeImageCodecRequest> | null;
}

interface ImageParseStack {
  readonly refs: ReadonlySet<string>;
  readonly objects: ReadonlySet<object>;
  readonly depth: number;
}

interface EmbeddedSoftMask {
  readonly present: boolean;
  readonly value: 0 | 1 | 2;
}

const CODEC_ENVELOPE_MAGIC = Uint8Array.of(0x48, 0x49, 0x43, 0x31); // HIC1
const MAX_CODEC_METADATA_BYTES = 1024 * 1024;
const CODEC_IDS: Readonly<Record<NativeImageCodec, number>> = {
  jpeg: 1,
  jpeg2000: 2,
  jbig2: 3,
  ccitt: 4
};
const CODECS_BY_ID: Readonly<Record<number, NativeImageCodec>> = {
  1: "jpeg",
  2: "jpeg2000",
  3: "jbig2",
  4: "ccitt"
};

/** Parses and deduplicates Image XObjects into the HEPR v7 image ABI. */
export class NativePdfImageRegistry {
  readonly colors: NativePdfColorRegistry;

  private readonly document: NativePdfDocument;
  private readonly codecPolicy: "request" | "error";
  private readonly onCodecRequest?: (request: Readonly<NativeImageCodecRequest>) => void;
  private readonly codecResolver?: NativeImageCodecResolver;
  private readonly trustedCodecResolver: boolean;
  private readonly codecDecodedByteLimit: number;
  private readonly records: NativePdfImageDescription[] = [];
  private readonly requests: NativeImageCodecRequest[] = [];
  private readonly refCache = new Map<string, Promise<number>>();
  private readonly objectCache = new WeakMap<object, Map<number, Promise<number>>>();
  private readonly scopeIds = new WeakMap<PdfDictionary, number>();
  private nextScopeId = 1;

  constructor(
    document: NativePdfDocument,
    colors?: NativePdfColorRegistry,
    options: NativePdfImageOptions = {}
  ) {
    this.document = document;
    this.colors = colors ?? new NativePdfColorRegistry(document);
    this.codecPolicy = options.codecPolicy ?? "request";
    this.onCodecRequest = options.onCodecRequest;
    this.codecResolver = options.codecResolver;
    this.trustedCodecResolver = options.trustedCodecResolver === true;
    this.codecDecodedByteLimit = Math.min(
      document.limits.maxDecodedStreamBytes,
      options.limits?.maxDecodedStreamBytes ?? document.limits.maxDecodedStreamBytes
    );
  }

  get size(): number {
    return this.records.length;
  }

  async add(
    value: PdfValue,
    colorSpaceResources?: PdfDictionary,
    signal?: AbortSignal
  ): Promise<number> {
    return await this.addInternal(
      value,
      colorSpaceResources,
      { refs: new Set(), objects: new Set(), depth: 0 },
      signal
    );
  }

  describe(index: number): Readonly<NativePdfImageDescription> {
    return this.getRecord(index);
  }

  getCodecRequests(): readonly Readonly<NativeImageCodecRequest>[] {
    return Object.freeze([...this.requests]);
  }

  buildStore(): HeprImageStore {
    const count = this.records.length;
    const colorKeyLength = sumStoreLengths(this.records, "color-key mask", (record) => record.colorKeyMask.length);
    const decodeLength = sumStoreLengths(this.records, "decode", (record) => record.decode.length);
    const matteLength = sumStoreLengths(this.records, "matte", (record) => record.matte.length);
    const dataLength = sumStoreLengths(this.records, "image data", (record) => record.data.length);
    const widths = allocateTypedArray(Uint32Array, count, "image widths");
    const heights = allocateTypedArray(Uint32Array, count, "image heights");
    const bitsPerComponent = allocateTypedArray(Uint8Array, count, "image bit depths");
    const formats = allocateTypedArray(Uint8Array, count, "image formats");
    const colorSpaceIndices = allocateTypedArray(Int32Array, count, "image color-space indices");
    const interpolateValues = allocateTypedArray(Uint8Array, count, "image interpolation flags");
    const imageMaskValues = allocateTypedArray(Uint8Array, count, "image-mask flags");
    const softMaskImageIndices = allocateTypedArray(Int32Array, count, "soft-mask image indices");
    const colorKeyMaskOffsets = allocateTypedArray(Uint32Array, count + 1, "color-key mask offsets");
    const decodeOffsets = allocateTypedArray(Uint32Array, count + 1, "image decode offsets");
    const matteOffsets = allocateTypedArray(Uint32Array, count + 1, "image matte offsets");
    const dataOffsets = allocateTypedArray(Uint32Array, count + 1, "image data offsets");
    const colorKeyMaskValues = allocateTypedArray(Int32Array, colorKeyLength, "color-key mask values");
    const decodeValues = allocateTypedArray(Float32Array, decodeLength, "image decode values");
    const matteValues = allocateTypedArray(Float32Array, matteLength, "image matte values");
    const data = allocateTypedArray(Uint8Array, dataLength, "image data");
    let colorKeyOffset = 0;
    let decodeOffset = 0;
    let matteOffset = 0;
    let dataOffset = 0;
    for (let index = 0; index < count; index += 1) {
      const record = this.records[index];
      widths[index] = record.width;
      heights[index] = record.height;
      bitsPerComponent[index] = record.sourceBitsPerComponent;
      formats[index] = record.format;
      colorSpaceIndices[index] = record.colorSpaceIndex;
      interpolateValues[index] = record.interpolate ? 1 : 0;
      imageMaskValues[index] = record.imageMask ? 1 : 0;
      softMaskImageIndices[index] = record.softMaskImageIndex;
      colorKeyMaskValues.set(record.colorKeyMask, colorKeyOffset);
      decodeValues.set(record.decode, decodeOffset);
      matteValues.set(record.matte, matteOffset);
      data.set(record.data, dataOffset);
      colorKeyOffset += record.colorKeyMask.length;
      decodeOffset += record.decode.length;
      matteOffset += record.matte.length;
      dataOffset += record.data.length;
      colorKeyMaskOffsets[index + 1] = colorKeyOffset;
      decodeOffsets[index + 1] = decodeOffset;
      matteOffsets[index + 1] = matteOffset;
      dataOffsets[index + 1] = dataOffset;
    }
    return {
      widths,
      heights,
      bitsPerComponent,
      formats,
      colorSpaceIndices,
      interpolate: interpolateValues,
      imageMask: imageMaskValues,
      softMaskImageIndices,
      colorKeyMaskOffsets,
      colorKeyMaskValues,
      decodeOffsets,
      decodeValues,
      matteOffsets,
      matteValues,
      dataOffsets,
      data
    };
  }

  private async addInternal(
    value: PdfValue,
    colorSpaceResources: PdfDictionary | undefined,
    stack: ImageParseStack,
    signal?: AbortSignal
  ): Promise<number> {
    throwIfAborted(signal);
    const depth = stack.depth + 1;
    if (depth > this.document.limits.maxRecursionDepth) {
      throw new PdfError("resource-limit", "An image-mask graph exceeds the recursion limit.", {
        details: { depth, limit: this.document.limits.maxRecursionDepth }
      });
    }
    if (isPdfRef(value)) {
      const identity = pdfRefKey(value);
      if (stack.refs.has(identity)) {
        throw new PdfError("unsupported-image", "An image-mask graph contains a cycle.", {
          objectNumber: value.objectNumber
        });
      }
      const key = `${identity}@${this.scopeId(colorSpaceResources)}`;
      const cached = this.refCache.get(key);
      if (cached) return await cached;
      const refs = new Set(stack.refs);
      refs.add(identity);
      const promise = this.document.resolveObject(value, signal)
        .then((resolved) => this.parseAndAppend(
          resolved,
          colorSpaceResources,
          { ...stack, refs, depth },
          signal
        ));
      this.refCache.set(key, promise);
      try {
        return await promise;
      } catch (error) {
        this.refCache.delete(key);
        throw error;
      }
    }
    if (!isPdfStream(value)) throw new PdfError("unsupported-image", "An Image XObject is not a stream.");
    if (stack.objects.has(value)) throw new PdfError("unsupported-image", "A direct image-mask graph contains a cycle.");
    const scopeId = this.scopeId(colorSpaceResources);
    let scopedCache = this.objectCache.get(value);
    if (!scopedCache) {
      scopedCache = new Map();
      this.objectCache.set(value, scopedCache);
    }
    const cached = scopedCache.get(scopeId);
    if (cached) return await cached;
    const objects = new Set(stack.objects);
    objects.add(value);
    const promise = this.parseAndAppend(
      value,
      colorSpaceResources,
      { ...stack, objects, depth },
      signal
    );
    scopedCache.set(scopeId, promise);
    try {
      return await promise;
    } catch (error) {
      scopedCache.delete(scopeId);
      throw error;
    }
  }

  private scopeId(resources: PdfDictionary | undefined): number {
    if (!resources) return 0;
    const existing = this.scopeIds.get(resources);
    if (existing !== undefined) return existing;
    const next = this.nextScopeId++;
    this.scopeIds.set(resources, next);
    return next;
  }

  private async parseAndAppend(
    value: PdfValue,
    colorSpaceResources: PdfDictionary | undefined,
    stack: ImageParseStack,
    signal?: AbortSignal
  ): Promise<number> {
    if (!isPdfStream(value)) {
      throw new PdfError("unsupported-image", "An XObject is not an /Image stream.");
    }
    const dictionary = value.dictionary;
    await validateImageObjectType(this.document, dictionary, signal);
    const width = await requiredPositiveInteger(this.document, dictionary, "Width", signal);
    const height = await requiredPositiveInteger(this.document, dictionary, "Height", signal);
    validateImageDimensions(this.document, width, height);
    const imageMask = await optionalBoolean(this.document, dictionary, "ImageMask", false, signal);
    const interpolate = await optionalBoolean(this.document, dictionary, "Interpolate", false, signal);
    validateLocalImageStream(dictionary, imageMask);
    const filters = await resolveFilters(this.document, dictionary.get("Filter"), signal);
    const decodeParameters = await resolveDecodeParameters(
      this.document,
      dictionary.get("DecodeParms"),
      filters.length,
      signal
    );
    const terminalIndex = filters.findIndex((filter) => codecForFilter(filter) !== null);
    if (terminalIndex >= 0 && terminalIndex !== filters.length - 1) {
      throw new PdfError("unsupported-image", "An image codec filter must be last in its decode chain.", {
        details: { filter: filters[terminalIndex] }
      });
    }
    const terminalCodec = terminalIndex >= 0 ? codecForFilter(filters[terminalIndex]) : null;
    const embeddedSoftMask = await readEmbeddedSoftMask(
      this.document,
      dictionary,
      terminalCodec,
      signal
    );
    const bitsPerComponent = await readBitsPerComponent(
      this.document,
      dictionary,
      imageMask,
      terminalCodec,
      signal
    );
    let sourceBitsPerComponent = bitsPerComponent;
    validateImageSampleFilterConsistency(filters, decodeParameters, bitsPerComponent);
    let colorSpaceIndex = -1;
    let componentCount = 1;
    if (!imageMask && dictionary.has("ColorSpace")) {
      colorSpaceIndex = await this.colors.add(dictionary.get("ColorSpace")!, colorSpaceResources, signal);
      componentCount = this.colors.describe(colorSpaceIndex).componentCount;
    } else if (!imageMask && terminalCodec !== "jpeg2000") {
      throw new PdfError("unsupported-image", "An image has no ColorSpace.");
    } else if (!imageMask) {
      componentCount = 0;
    }
    const decode = await readImageDecode(
      this.document,
      dictionary,
      imageMask,
      terminalCodec,
      colorSpaceIndex,
      componentCount,
      this.colors,
      signal
    );
    const mask = await this.readMask(
      dictionary,
      colorSpaceResources,
      stack,
      componentCount,
      width,
      height,
      embeddedSoftMask.value !== 0,
      signal
    );
    const colorKeyMask = mask.kind === "color-key"
      ? await readColorKeyMask(
          this.document,
          dictionary,
          componentCount,
          bitsPerComponent,
          signal
        )
      : [];
    let data: Uint8Array | null = null;
    let format: number | null = null;
    let codecRequest: NativeImageCodecRequest | null = null;
    if (terminalCodec) {
      const encoded = terminalIndex === 0
        ? value.bytes
        : await decodePdfFilterChain(
            value.bytes,
            filters.slice(0, terminalIndex),
            decodeParameters.slice(0, terminalIndex),
            { limits: this.document.limits, signal }
          );
      let nativeCcittDecoded = false;
      if (terminalCodec === "ccitt") {
        try {
          if (!imageMask && componentCount !== 1) {
            throw new PdfError(
              "unsupported-image",
              "CCITTFaxDecode image data requires a one-component color space.",
              { details: { componentCount } }
            );
          }
          validateImageWorkingSet(
            this.document,
            width,
            height,
            1,
            bitsPerComponent
          );
          const ccittParameters = normalizeCcittDecodeParameters(
            decodeParameters[terminalIndex]
          );
          validateCcittImageDimensions(
            this.document,
            ccittParameters,
            width,
            height
          );
          const ccitt = decodeNativeCcittFax(
            encoded,
            ccittParameters,
            {
              signal,
              limits: imageCcittLimits(this.document, width, height)
            }
          );
          if (ccitt.columns !== width || ccitt.rows !== height) {
            throw new PdfError(
              "unsupported-image",
              "CCITTFaxDecode dimensions disagree with the Image XObject.",
              {
                details: {
                  imageWidth: width,
                  imageHeight: height,
                  decodedColumns: ccitt.columns,
                  decodedRows: ccitt.rows
                }
              }
            );
          }
          const normalizedBytes = normalizeCcittBlackPolarity(
            ccitt.bytes,
            ccitt.columns,
            ccitt.rows,
            ccitt.blackIs1,
            signal
          );
          const samples = unpackImageSamples(
            normalizedBytes,
            width,
            height,
            1,
            1,
            signal
          );
          if (imageMask) {
            data = convertStencilMask(samples, decode, 1, signal);
            format = HEPR_IMAGE_FORMAT.Gray8;
          } else {
            const converted = convertSamplesToSrgb(
              samples,
              width,
              height,
              1,
              decode,
              colorKeyMask,
              colorSpaceIndex,
              this.colors,
              signal
            );
            data = converted.data;
            format = converted.format;
          }
          nativeCcittDecoded = true;
        } catch (cause) {
          if (!isUnsupportedCcittCapability(cause)) throw cause;
          if (this.codecPolicy === "error") throw cause;
        }
      }
      if (!nativeCcittDecoded) {
        if (this.codecPolicy === "error") {
          throw new PdfError("unsupported-image", `${terminalCodec} image data requires its pinned codec kernel.`, {
            details: { codec: terminalCodec, filter: filters[terminalIndex] }
          });
        }
        const globals = terminalCodec === "jbig2"
          ? await readJbig2Globals(this.document, decodeParameters[terminalIndex], signal)
          : new Uint8Array(0);
        const metadata = await serializableDecodeParameters(
          this.document,
          decodeParameters[terminalIndex],
          terminalCodec,
          embeddedSoftMask,
          signal
        );
        throwIfAborted(signal);
        const embeddedOpacityComponents = embeddedSoftMask.value === 0 ? 0 : 1;
        const codecInputBytes = encoded.byteLength + globals.byteLength;
        if (
          !Number.isSafeInteger(codecInputBytes) ||
          codecInputBytes > this.document.limits.maxDecodedStreamBytes
        ) {
          throw new PdfError(
            "resource-limit",
            "Image codec input exceeds the configured stream limit.",
            {
              details: {
                codec: terminalCodec,
                bytes: codecInputBytes,
                limit: this.document.limits.maxDecodedStreamBytes
              }
            }
          );
        }
        const requestEncoded = copyBytes(encoded, "owned image codec input");
        const requestGlobals = copyBytes(globals, "owned image codec globals");
        codecRequest = Object.freeze({
          codec: terminalCodec,
          width,
          height,
          components: componentCount === 0
            ? 0
            : componentCount + embeddedOpacityComponents,
          bitsPerComponent,
          imageMask,
          encoded: requestEncoded,
          globals: requestGlobals,
          decodeParameters: metadata
        });
        let unresolvedPayload: Uint8Array | null = null;
        if (!this.codecResolver) {
          unresolvedPayload = packNativeImageCodecRequest(
            terminalCodec,
            requestEncoded,
            requestGlobals,
            metadata
          );
          if (unresolvedPayload.byteLength > this.document.limits.maxDecodedStreamBytes) {
            throw new PdfError(
              "resource-limit",
              "Image codec envelope exceeds the configured stream limit.",
              {
                details: {
                  codec: terminalCodec,
                  bytes: unresolvedPayload.byteLength,
                  limit: this.document.limits.maxDecodedStreamBytes
                }
              }
            );
          }
        }
        this.requests.push(codecRequest);
        this.onCodecRequest?.(codecRequest);
        if (this.codecResolver) {
          // Enforce the document's lowered image/stream ceilings before a
          // focused codec is allowed to allocate native or WASM output. JPX
          // may own its sample layout (zero components/precision), so its
          // result receives the same validation after resolution below.
          if (codecRequest.components > 0 && codecRequest.bitsPerComponent > 0) {
            validateImageWorkingSet(
              this.document,
              codecRequest.width,
              codecRequest.height,
              codecRequest.components,
              codecRequest.bitsPerComponent,
              this.codecDecodedByteLimit
            );
          }
          if (terminalCodec === "jpeg2000" && colorSpaceIndex < 0) {
            throw new PdfError(
              "unsupported-image",
              "A raw JPX codec result requires an explicit PDF ColorSpace.",
              { details: { codec: terminalCodec, reason: "jpx-codec-defined-color-space" } }
            );
          }
          if (embeddedSoftMask.value === 2) {
            throw new PdfError(
              "unsupported-image",
              "JPX SMaskInData=2 requires premultiplication metadata not represented by the raw-sample codec bridge.",
              { details: { codec: terminalCodec, reason: "jpx-premultiplied-opacity" } }
            );
          }
          const resolved = await resolveCodecThroughCaller(
            this.codecResolver,
            codecRequest,
            this.document,
            this.codecDecodedByteLimit,
            this.trustedCodecResolver,
            signal
          );
          sourceBitsPerComponent = resolved.bitsPerComponent;
          const decodedSamples = unpackImageSamples(
            resolved.samples,
            width,
            height,
            resolved.components,
            resolved.bitsPerComponent,
            signal
          );
          if (imageMask) {
            data = convertStencilMask(
              decodedSamples,
              decode,
              resolved.bitsPerComponent,
              signal
            );
            format = HEPR_IMAGE_FORMAT.Gray8;
          } else {
            const separated = embeddedSoftMask.value === 1
              ? separateEmbeddedOpacity(
                  decodedSamples,
                  width,
                  height,
                  componentCount,
                  signal
                )
              : { colors: decodedSamples, opacity: null };
            validateColorKeyMaskPrecision(colorKeyMask, resolved.bitsPerComponent);
            const effectiveDecode = terminalCodec === "jpeg2000" && decode.length === 0
              ? this.colors.defaultDecode(colorSpaceIndex)
              : decode;
            const converted = convertSamplesToSrgb(
              separated.colors,
              width,
              height,
              resolved.bitsPerComponent,
              effectiveDecode,
              colorKeyMask,
              colorSpaceIndex,
              this.colors,
              signal
            );
            if (separated.opacity) {
              applyEmbeddedOpacity(
                converted.data,
                separated.opacity,
                resolved.bitsPerComponent,
                signal
              );
            }
            data = converted.data;
            format = converted.format;
          }
          codecRequest = null;
        } else {
          data = unresolvedPayload!;
          format = codecFormat(terminalCodec);
        }
      }
    } else {
      validateImageWorkingSet(
        this.document,
        width,
        height,
        componentCount,
        bitsPerComponent
      );
      const decoded = await this.document.decodeStream(value, signal);
      const samples = unpackImageSamples(
        decoded,
        width,
        height,
        componentCount,
        bitsPerComponent,
        signal
      );
      if (imageMask) {
        data = convertStencilMask(samples, decode, bitsPerComponent, signal);
        format = HEPR_IMAGE_FORMAT.Gray8;
      } else {
        const converted = convertSamplesToSrgb(
          samples,
          width,
          height,
          bitsPerComponent,
          decode,
          colorKeyMask,
          colorSpaceIndex,
          this.colors,
          signal
        );
        data = converted.data;
        format = converted.format;
      }
    }
    if (data === null || format === null) {
      throw new PdfError("invalid-object", "Image decoding produced no pixel payload.");
    }
    const record: NativePdfImageDescription = Object.freeze({
      width,
      height,
      sourceBitsPerComponent,
      format,
      colorSpaceIndex,
      interpolate,
      imageMask,
      softMaskImageIndex: mask.imageIndex,
      maskKind: mask.kind,
      colorKeyMask,
      decode,
      matte: mask.matte,
      data,
      codecRequest
    });
    const index = this.records.length;
    this.records.push(record);
    return index;
  }

  private async readMask(
    dictionary: PdfDictionary,
    colorSpaceResources: PdfDictionary | undefined,
    stack: ImageParseStack,
    baseComponentCount: number,
    baseWidth: number,
    baseHeight: number,
    hasEmbeddedSoftMask: boolean,
    signal?: AbortSignal
  ): Promise<{ imageIndex: number; kind: NativeImageMaskKind; matte: readonly number[] }> {
    // An opacity channel embedded in JPX data overrides both dictionary mask
    // entries. Do not resolve an overridden entry: it is not visible content.
    if (hasEmbeddedSoftMask) return { imageIndex: -1, kind: "none", matte: [] };
    const softRaw = dictionary.get("SMask");
    const soft = await this.document.resolveValue(softRaw, signal);
    if (soft !== undefined && soft !== null && !isPdfName(soft, "None")) {
      if (!isPdfStream(soft)) throw new PdfError("unsupported-image", "An image SMask is not an image stream.");
      await validateSoftMaskDictionary(this.document, soft.dictionary, signal);
      const hasMatte = soft.dictionary.has("Matte");
      const matte = hasMatte
        ? await resolveNumberArray(this.document, soft.dictionary.get("Matte"), signal)
        : [];
      if (hasMatte && matte.length === 0) {
        throw new PdfError("unsupported-image", "An image SMask Matte array must not be empty.");
      }
      if (hasMatte && baseComponentCount > 0 && matte.length !== baseComponentCount) {
        throw new PdfError(
          "unsupported-image",
          "An image SMask Matte array has incompatible arity.",
          { details: { expected: baseComponentCount, actual: matte.length } }
        );
      }
      // Soft-mask samples are opacity, not page colour. DeviceGray defaults in
      // the caller resource dictionary therefore must not remap them.
      const imageIndex = await this.addInternal(softRaw!, undefined, stack, signal);
      const softImage = this.getRecord(imageIndex);
      if (
        softImage.imageMask ||
        softImage.colorSpaceIndex < 0 ||
        this.colors.describe(softImage.colorSpaceIndex).kind !== "DeviceGray" ||
        softImage.maskKind !== "none"
      ) {
        throw new PdfError(
          "unsupported-image",
          "An image SMask must be a non-stencil DeviceGray image."
        );
      }
      if (hasMatte && (softImage.width !== baseWidth || softImage.height !== baseHeight)) {
        throw new PdfError(
          "unsupported-image",
          "A matte image SMask must have the same dimensions as its parent image.",
          {
            details: {
              parentWidth: baseWidth,
              parentHeight: baseHeight,
              maskWidth: softImage.width,
              maskHeight: softImage.height
            }
          }
        );
      }
      return { imageIndex, kind: "soft", matte: Object.freeze([...matte]) };
    }
    const maskRaw = dictionary.get("Mask");
    const mask = await this.document.resolveValue(maskRaw, signal);
    if (isPdfStream(mask)) {
      const imageIndex = await this.addInternal(maskRaw!, colorSpaceResources, stack, signal);
      if (!this.getRecord(imageIndex).imageMask) {
        throw new PdfError(
          "unsupported-image",
          "An explicit image Mask stream must have /ImageMask true."
        );
      }
      return { imageIndex, kind: "explicit", matte: [] };
    }
    if (Array.isArray(mask)) return { imageIndex: -1, kind: "color-key", matte: [] };
    if (mask !== undefined && mask !== null) {
      throw new PdfError("unsupported-image", "An image Mask is neither an image stream nor a color-key array.");
    }
    return { imageIndex: -1, kind: "none", matte: [] };
  }

  private getRecord(index: number): NativePdfImageDescription {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.records.length) {
      throw new RangeError(`PDF image index ${index} is out of range.`);
    }
    return this.records[index];
  }
}

/**
 * Unpack packed PDF image rows. Each row starts at a byte boundary, including
 * 1/2/4-bpc images; returned values retain their exact integer precision.
 */
export function unpackImageSamples(
  bytes: Uint8Array,
  width: number,
  height: number,
  componentCount: number,
  bitsPerComponent: number,
  signal?: AbortSignal
): Uint16Array {
  throwIfAborted(signal);
  if (
    !Number.isSafeInteger(width) || width <= 0 ||
    !Number.isSafeInteger(height) || height <= 0 ||
    !Number.isSafeInteger(componentCount) || componentCount <= 0 ||
    ![1, 2, 4, 8, 16].includes(bitsPerComponent)
  ) {
    throw new PdfError("unsupported-image", "Unsupported image sample layout.", {
      details: { width, height, componentCount, bitsPerComponent }
    });
  }
  const samplesPerRow = width * componentCount;
  const rowBytes = Math.ceil(samplesPerRow * bitsPerComponent / 8);
  const required = rowBytes * height;
  const sampleCount = width * height * componentCount;
  if (
    !Number.isSafeInteger(samplesPerRow) ||
    !Number.isSafeInteger(required) ||
    !Number.isSafeInteger(sampleCount) ||
    bytes.length !== required
  ) {
    throw new PdfError("unsupported-image", "Decoded image samples have an unexpected byte count.", {
      details: { expectedBytes: required, actualBytes: bytes.length }
    });
  }
  const output = allocateSamples(sampleCount);
  // Byte-aligned samples have no row padding. Keep exact unsigned precision
  // without visiting every bit, and bound the work between cancellation checks.
  if (bitsPerComponent === 8) {
    for (let offset = 0; offset < sampleCount; offset += 4096) {
      throwIfAborted(signal);
      output.set(bytes.subarray(offset, Math.min(offset + 4096, sampleCount)), offset);
    }
    return output;
  }
  if (bitsPerComponent === 16) {
    for (let sample = 0; sample < sampleCount; sample += 1) {
      if ((sample & 0xfff) === 0) throwIfAborted(signal);
      output[sample] = (bytes[sample * 2] << 8) | bytes[sample * 2 + 1];
    }
    return output;
  }
  let outputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    throwIfAborted(signal);
    const rowOffset = row * rowBytes;
    let bitOffset = 0;
    for (let sample = 0; sample < samplesPerRow; sample += 1) {
      if ((sample & 0xfff) === 0) throwIfAborted(signal);
      let value = 0;
      for (let bit = 0; bit < bitsPerComponent; bit += 1) {
        const absolute = rowOffset * 8 + bitOffset++;
        value = (value << 1) | ((bytes[absolute >>> 3] >>> (7 - (absolute & 7))) & 1);
      }
      output[outputOffset++] = value;
    }
  }
  return output;
}

export function packNativeImageCodecRequest(
  codec: NativeImageCodec,
  encoded: Uint8Array,
  globals: Uint8Array = new Uint8Array(0),
  decodeParameters: Readonly<Record<string, CodecMetadataValue>> = {}
): Uint8Array {
  const codecId = CODEC_IDS[codec];
  if (typeof codecId !== "number") {
    throw new PdfError("unsupported-image", "Unknown native image codec identifier.");
  }
  const canonicalMetadata = canonicalizeCodecMetadataRecord(decodeParameters);
  let metadata: Uint8Array;
  try {
    metadata = new TextEncoder().encode(JSON.stringify(canonicalMetadata));
  } catch (cause) {
    if (cause instanceof PdfError) throw cause;
    throw new PdfError("resource-limit", "Image codec metadata could not be encoded.", { cause });
  }
  if (metadata.length > MAX_CODEC_METADATA_BYTES) {
    throw new PdfError("resource-limit", "Image codec metadata exceeds its envelope limit.", {
      details: { metadataBytes: metadata.length, limit: MAX_CODEC_METADATA_BYTES }
    });
  }
  if (globals.length > 0xffff_ffff) {
    throw new PdfError("resource-limit", "Image codec globals exceed the envelope limit.");
  }
  const total = 16 + metadata.length + globals.length + encoded.length;
  if (!Number.isSafeInteger(total) || total > 0xffff_ffff) {
    throw new PdfError("resource-limit", "Image codec payload is too large.");
  }
  const output = allocateBytes(total, "image codec payload");
  output.set(CODEC_ENVELOPE_MAGIC, 0);
  output[4] = codecId;
  const view = new DataView(output.buffer);
  view.setUint32(8, metadata.length, true);
  view.setUint32(12, globals.length, true);
  output.set(metadata, 16);
  output.set(globals, 16 + metadata.length);
  output.set(encoded, 16 + metadata.length + globals.length);
  return output;
}

export function unpackNativeImageCodecRequest(payload: Uint8Array): NativePackedImageCodecPayload {
  if (payload.length < 16 || CODEC_ENVELOPE_MAGIC.some((byte, index) => payload[index] !== byte)) {
    throw new PdfError("unsupported-image", "Invalid HEPR image codec envelope.");
  }
  const codec = CODECS_BY_ID[payload[4]];
  if (!codec) throw new PdfError("unsupported-image", "Unknown HEPR image codec identifier.");
  if (payload[5] !== 0 || payload[6] !== 0 || payload[7] !== 0) {
    throw new PdfError("unsupported-image", "Invalid reserved HEPR image codec envelope bytes.");
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const metadataLength = view.getUint32(8, true);
  const globalsLength = view.getUint32(12, true);
  if (metadataLength > MAX_CODEC_METADATA_BYTES) {
    throw new PdfError("resource-limit", "HEPR image codec metadata exceeds its envelope limit.", {
      details: { metadataBytes: metadataLength, limit: MAX_CODEC_METADATA_BYTES }
    });
  }
  const globalsOffset = 16 + metadataLength;
  const encodedOffset = globalsOffset + globalsLength;
  if (
    !Number.isSafeInteger(globalsOffset) ||
    !Number.isSafeInteger(encodedOffset) ||
    globalsOffset > payload.length ||
    encodedOffset > payload.length
  ) {
    throw new PdfError("unsupported-image", "Truncated HEPR image codec envelope.");
  }
  let decodedMetadata: unknown;
  try {
    decodedMetadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      payload.subarray(16, globalsOffset)
    ));
  } catch (cause) {
    throw new PdfError("unsupported-image", "Invalid HEPR image codec metadata.", { cause });
  }
  const decodeParameters = canonicalizeCodecMetadataRecord(decodedMetadata);
  const ownedPayload = allocateBytes(payload.length, "owned image codec envelope");
  ownedPayload.set(payload);
  const globals = ownedPayload.subarray(globalsOffset, encodedOffset);
  const encoded = ownedPayload.subarray(encodedOffset);
  return { codec, encoded, globals, decodeParameters, payload: ownedPayload };
}

async function resolveCodecThroughCaller(
  resolver: NativeImageCodecResolver,
  request: Readonly<NativeImageCodecRequest>,
  document: NativePdfDocument,
  maxDecodedStreamBytes: number,
  trustedResolver: boolean,
  signal?: AbortSignal
): Promise<NativeImageCodecResult> {
  throwIfAborted(signal);
  let raw: NativeImageCodecResult;
  try {
    raw = await resolver(request, signal);
  } catch (cause) {
    if (cause instanceof PdfError && cause.code === "aborted") throw cause;
    if (trustedResolver && cause instanceof PdfError) throw cause;
    throwIfAborted(signal);
    throw new PdfError(
      "unsupported-image",
      `The ${request.codec} image codec resolver failed.`,
      { cause, details: { codec: request.codec, reason: "codec-resolver-failed" } }
    );
  }
  throwIfAborted(signal);
  if (!raw || typeof raw !== "object" || !(raw.samples instanceof Uint8Array)) {
    throw invalidCodecResult(request.codec, "The image codec resolver returned an invalid result.");
  }
  if (
    !Number.isSafeInteger(raw.width) || raw.width <= 0 ||
    !Number.isSafeInteger(raw.height) || raw.height <= 0 ||
    !Number.isSafeInteger(raw.components) || raw.components <= 0 ||
    !Number.isSafeInteger(raw.bitsPerComponent) ||
    ![1, 2, 4, 8, 16].includes(raw.bitsPerComponent)
  ) {
    throw invalidCodecResult(request.codec, "The image codec resolver returned invalid sample metadata.");
  }
  if (raw.width !== request.width || raw.height !== request.height) {
    throw invalidCodecResult(
      request.codec,
      "The image codec resolver returned dimensions that disagree with the Image XObject.",
      {
        expectedWidth: request.width,
        expectedHeight: request.height,
        actualWidth: raw.width,
        actualHeight: raw.height
      }
    );
  }
  if (request.components <= 0 || raw.components !== request.components) {
    throw invalidCodecResult(
      request.codec,
      "The image codec resolver returned a component count that disagrees with the Image XObject.",
      { expectedComponents: request.components, actualComponents: raw.components }
    );
  }
  if (
    request.bitsPerComponent !== 0 &&
    raw.bitsPerComponent !== request.bitsPerComponent
  ) {
    throw invalidCodecResult(
      request.codec,
      "The image codec resolver returned a sample precision that disagrees with the Image XObject.",
      {
        expectedBitsPerComponent: request.bitsPerComponent,
        actualBitsPerComponent: raw.bitsPerComponent
      }
    );
  }
  if (request.imageMask && (raw.components !== 1 || raw.bitsPerComponent !== 1)) {
    throw invalidCodecResult(
      request.codec,
      "The image codec resolver returned an invalid stencil-mask layout."
    );
  }
  validateImageWorkingSet(
    document,
    raw.width,
    raw.height,
    raw.components,
    raw.bitsPerComponent,
    maxDecodedStreamBytes
  );
  const rowBits = raw.width * raw.components * raw.bitsPerComponent;
  const expectedBytes = Math.ceil(rowBits / 8) * raw.height;
  if (
    !Number.isSafeInteger(rowBits) ||
    !Number.isSafeInteger(expectedBytes) ||
    raw.samples.byteLength !== expectedBytes
  ) {
    throw invalidCodecResult(
      request.codec,
      "The image codec resolver returned an unexpected packed sample byte count.",
      { expectedBytes, actualBytes: raw.samples.byteLength }
    );
  }
  const samples = allocateBytes(expectedBytes, "owned image codec samples");
  samples.set(raw.samples);
  throwIfAborted(signal);
  return Object.freeze({
    samples,
    width: raw.width,
    height: raw.height,
    components: raw.components,
    bitsPerComponent: raw.bitsPerComponent
  });
}

function invalidCodecResult(
  codec: NativeImageCodec,
  message: string,
  details: Readonly<Record<string, number>> = {}
): PdfError {
  return new PdfError("unsupported-image", message, {
    details: { codec, reason: "invalid-codec-result", ...details }
  });
}

function separateEmbeddedOpacity(
  samples: Uint16Array,
  width: number,
  height: number,
  colorComponents: number,
  signal?: AbortSignal
): { colors: Uint16Array; opacity: Uint16Array } {
  const pixels = width * height;
  const colors = allocateSamples(pixels * colorComponents);
  const opacity = allocateSamples(pixels);
  const sourceStride = colorComponents + 1;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if ((pixel & 0xfff) === 0) throwIfAborted(signal);
    const sourceOffset = pixel * sourceStride;
    colors.set(
      samples.subarray(sourceOffset, sourceOffset + colorComponents),
      pixel * colorComponents
    );
    opacity[pixel] = samples[sourceOffset + colorComponents];
  }
  return { colors, opacity };
}

function applyEmbeddedOpacity(
  rgba: Uint8Array,
  opacity: Uint16Array,
  bitsPerComponent: number,
  signal?: AbortSignal
): void {
  const maximum = (2 ** bitsPerComponent) - 1;
  if (bitsPerComponent === 16) {
    const view = new DataView(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    for (let pixel = 0; pixel < opacity.length; pixel += 1) {
      if ((pixel & 0xfff) === 0) throwIfAborted(signal);
      const offset = pixel * 8 + 6;
      const existing = view.getUint16(offset, false);
      view.setUint16(offset, Math.round(existing * opacity[pixel] / maximum), false);
    }
    return;
  }
  for (let pixel = 0; pixel < opacity.length; pixel += 1) {
    if ((pixel & 0xfff) === 0) throwIfAborted(signal);
    const offset = pixel * 4 + 3;
    rgba[offset] = Math.round(rgba[offset] * opacity[pixel] / maximum);
  }
}

function validateColorKeyMaskPrecision(
  colorKeyMask: readonly number[],
  bitsPerComponent: number
): void {
  const maximum = (2 ** bitsPerComponent) - 1;
  for (let index = 0; index < colorKeyMask.length; index += 2) {
    if (colorKeyMask[index + 1] > maximum) {
      throw new PdfError(
        "unsupported-image",
        "An image color-key Mask exceeds the codec-resolved sample precision.",
        {
          details: {
            reason: "color-key-precision",
            bitsPerComponent,
            maximum,
            upper: colorKeyMask[index + 1]
          }
        }
      );
    }
  }
}

function convertStencilMask(
  samples: Uint16Array,
  decode: readonly number[],
  bitsPerComponent: number,
  signal?: AbortSignal
): Uint8Array {
  const maximum = (2 ** bitsPerComponent) - 1;
  const output = allocateBytes(samples.length, "stencil image output");
  for (let index = 0; index < samples.length; index += 1) {
    if ((index & 0xfff) === 0) throwIfAborted(signal);
    const sample = samples[index];
    const decoded = interpolate(sample / maximum, 0, 1, decode[0], decode[1]);
    // In a PDF stencil image, zero selects the current paint by default.
    output[index] = Math.round((1 - clamp01(decoded)) * 255);
  }
  return output;
}

function convertSamplesToSrgb(
  samples: Uint16Array,
  width: number,
  height: number,
  bitsPerComponent: number,
  decode: readonly number[],
  colorKeyMask: readonly number[],
  colorSpaceIndex: number,
  colors: NativePdfColorRegistry,
  signal?: AbortSignal
): { data: Uint8Array; format: number } {
  const color = colors.describe(colorSpaceIndex);
  const componentCount = color.componentCount;
  const maximum = (2 ** bitsPerComponent) - 1;
  const sixteenBit = bitsPerComponent === 16;
  const bytesPerComponent = sixteenBit ? 2 : 1;
  const output = allocateBytes(width * height * 4 * bytesPerComponent, "converted image output");
  // Amortize the 256-entry Decode tables; tiny images use the scalar path.
  if (bitsPerComponent === 8 && width * height >= 256 &&
      (color.kind === "DeviceGray" || color.kind === "DeviceRGB" || color.kind === "DeviceCMYK")) {
    convertDeviceSamplesToSrgb8(samples, output, componentCount, decode, colorKeyMask, signal);
    return { data: output, format: HEPR_IMAGE_FORMAT.Rgba8 };
  }
  const view = sixteenBit ? new DataView(output.buffer) : null;
  const components = new Array<number>(componentCount);
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if ((pixel & 0xfff) === 0) throwIfAborted(signal);
    const sampleOffset = pixel * componentCount;
    let transparent = colorKeyMask.length > 0;
    for (let component = 0; component < componentCount; component += 1) {
      const raw = samples[sampleOffset + component];
      components[component] = interpolate(
        raw / maximum,
        0,
        1,
        decode[component * 2],
        decode[component * 2 + 1]
      );
      if (transparent && (raw < colorKeyMask[component * 2] || raw > colorKeyMask[component * 2 + 1])) {
        transparent = false;
      }
    }
    const rgb = colors.convertToSrgb(colorSpaceIndex, components);
    if (sixteenBit) {
      const offset = pixel * 8;
      view!.setUint16(offset, Math.round(rgb[0] * 65535), false);
      view!.setUint16(offset + 2, Math.round(rgb[1] * 65535), false);
      view!.setUint16(offset + 4, Math.round(rgb[2] * 65535), false);
      view!.setUint16(offset + 6, transparent ? 0 : 65535, false);
    } else {
      const offset = pixel * 4;
      output[offset] = Math.round(rgb[0] * 255);
      output[offset + 1] = Math.round(rgb[1] * 255);
      output[offset + 2] = Math.round(rgb[2] * 255);
      output[offset + 3] = transparent ? 0 : 255;
    }
  }
  return {
    data: output,
    format: sixteenBit ? HEPR_IMAGE_FORMAT.Rgba16 : HEPR_IMAGE_FORMAT.Rgba8
  };
}

/** Validated device-image samples need no per-pixel graph traversal or allocation. */
function convertDeviceSamplesToSrgb8(
  samples: Uint16Array,
  output: Uint8Array,
  componentCount: number,
  decode: readonly number[],
  colorKeyMask: readonly number[],
  signal?: AbortSignal
): void {
  // Preserve the general converter's Decode interpolation and rounding exactly.
  // A byte has only 256 possible values, so Decode is evaluated once per value.
  const decoded = new Float64Array(componentCount * 256);
  for (let component = 0; component < componentCount; component += 1) {
    for (let sample = 0; sample < 256; sample += 1) {
      decoded[component * 256 + sample] = clamp01(interpolate(
        sample / 255, 0, 1, decode[component * 2], decode[component * 2 + 1]
      ));
    }
  }
  const rgb: [number, number, number] = [0, 0, 0];
  for (let pixel = 0, sampleOffset = 0; pixel < output.length / 4;
    pixel += 1, sampleOffset += componentCount) {
    if ((pixel & 0xfff) === 0) throwIfAborted(signal);
    const offset = pixel * 4;
    const first = decoded[samples[sampleOffset]];
    if (componentCount === 4) {
      convertDeviceCmykToSrgb(
        first,
        decoded[256 + samples[sampleOffset + 1]],
        decoded[512 + samples[sampleOffset + 2]],
        decoded[768 + samples[sampleOffset + 3]],
        rgb
      );
      output[offset] = Math.round(rgb[0] * 255);
      output[offset + 1] = Math.round(rgb[1] * 255);
      output[offset + 2] = Math.round(rgb[2] * 255);
    } else {
      output[offset] = Math.round(first * 255);
      output[offset + 1] = Math.round((componentCount === 1
        ? first : decoded[256 + samples[sampleOffset + 1]]) * 255);
      output[offset + 2] = Math.round((componentCount === 1
        ? first : decoded[512 + samples[sampleOffset + 2]]) * 255);
    }
    let transparent = colorKeyMask.length > 0;
    for (let component = 0; transparent && component < componentCount; component += 1) {
      const raw = samples[sampleOffset + component];
      if (raw < colorKeyMask[component * 2] || raw > colorKeyMask[component * 2 + 1]) {
        transparent = false;
      }
    }
    output[offset + 3] = transparent ? 0 : 255;
  }
}

async function resolveFilters(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  signal?: AbortSignal
): Promise<string[]> {
  const resolved = await document.resolveValue(value, signal);
  if (!Array.isArray(resolved)) return readFilterNames(resolved);
  const values: PdfValue[] = [];
  for (const item of resolved) values.push((await document.resolveValue(item, signal)) ?? null);
  return readFilterNames(values);
}

async function resolveDecodeParameters(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  filterCount: number,
  signal?: AbortSignal
): Promise<(PdfDictionary | null)[]> {
  const resolved = await document.resolveValue(value, signal);
  const values = Array.isArray(resolved)
    ? await Promise.all(resolved.map((item) => document.resolveValue(item, signal))) as PdfValue[]
    : resolved;
  const parsed = readDecodeParameters(values, filterCount);
  const output: (PdfDictionary | null)[] = [];
  for (const dictionary of parsed) {
    if (!dictionary) {
      output.push(null);
      continue;
    }
    const entries = new Map<string, PdfValue>();
    for (const [key, raw] of dictionary) {
      entries.set(key, (await document.resolveValue(raw, signal)) ?? null);
    }
    output.push(entries);
  }
  return output;
}

function codecForFilter(filter: string): NativeImageCodec | null {
  switch (filter) {
    case "DCTDecode":
    case "DCT": return "jpeg";
    case "JPXDecode": return "jpeg2000";
    case "JBIG2Decode": return "jbig2";
    case "CCITTFaxDecode":
    case "CCF": return "ccitt";
    default: return null;
  }
}

/**
 * CCITTFaxDecode has its own parameter namespace. Keeping this conversion
 * explicit prevents image dictionaries or predictor parameters from leaking
 * into the fax kernel and gives unsupported TIFF-only extensions a stable
 * capability error instead of silently ignoring them.
 */
function normalizeCcittDecodeParameters(
  parameters: PdfDictionary | null
): NativeCcittParameters {
  if (!parameters) return {};
  let K: number | undefined;
  let Columns: number | undefined;
  let Rows: number | undefined;
  let EndOfLine: boolean | undefined;
  let EncodedByteAlign: boolean | undefined;
  let EndOfBlock: boolean | undefined;
  let BlackIs1: boolean | undefined;
  let DamagedRowsBeforeError: number | undefined;
  for (const [name, value] of parameters) {
    // A null DecodeParms entry has the same effect as an omitted parameter.
    if (value === null) continue;
    switch (name) {
      case "K": K = requireCcittInteger(name, value); break;
      case "Columns": Columns = requireCcittInteger(name, value); break;
      case "Rows": Rows = requireCcittInteger(name, value); break;
      case "EndOfLine": EndOfLine = requireCcittBoolean(name, value); break;
      case "EncodedByteAlign": EncodedByteAlign = requireCcittBoolean(name, value); break;
      case "EndOfBlock": EndOfBlock = requireCcittBoolean(name, value); break;
      case "BlackIs1": BlackIs1 = requireCcittBoolean(name, value); break;
      case "DamagedRowsBeforeError":
        DamagedRowsBeforeError = requireCcittInteger(name, value);
        break;
      default:
        throw new PdfError(
          "unsupported-filter",
          `Unsupported CCITTFaxDecode parameter /${name}.`,
          { details: { reason: "ccitt-unsupported-parameter", parameter: name } }
        );
    }
  }
  return {
    K,
    Columns,
    Rows,
    EndOfLine,
    EncodedByteAlign,
    EndOfBlock,
    BlackIs1,
    DamagedRowsBeforeError
  };
}

function requireCcittInteger(name: string, value: PdfValue): number {
  if (!Number.isSafeInteger(value)) {
    throw new PdfError(
      "invalid-object",
      `CCITTFaxDecode /${name} must be an integer.`,
      { details: { parameter: name } }
    );
  }
  return value as number;
}

function requireCcittBoolean(name: string, value: PdfValue): boolean {
  if (typeof value !== "boolean") {
    throw new PdfError(
      "invalid-object",
      `CCITTFaxDecode /${name} must be a boolean.`,
      { details: { parameter: name } }
    );
  }
  return value;
}

function validateCcittImageDimensions(
  document: NativePdfDocument,
  parameters: NativeCcittParameters,
  width: number,
  height: number
): void {
  const columns = parameters.Columns ?? 1728;
  const rows = parameters.Rows ?? 0;
  // Leave invalid signs to the kernel so malformed DecodeParms keep their
  // precise `invalid-object` error rather than becoming a dimension mismatch.
  if (columns > document.limits.maxImageDimension || rows > document.limits.maxImageDimension) {
    throw new PdfError("resource-limit", "CCITTFaxDecode dimensions exceed the configured image limit.", {
      details: {
        columns,
        rows,
        limit: document.limits.maxImageDimension
      }
    });
  }
  if (columns > 0 && columns !== width) {
    throw new PdfError("unsupported-image", "CCITTFaxDecode /Columns disagrees with Image /Width.", {
      details: { columns, width }
    });
  }
  // Rows=0 means unknown and is resolved from RTC/EOFB or physical EOD. A
  // positive Rows value is an exact encoded height and must match /Height.
  if (rows > 0 && rows !== height) {
    throw new PdfError("unsupported-image", "CCITTFaxDecode /Rows disagrees with Image /Height.", {
      details: { rows, height }
    });
  }
}

function imageCcittLimits(
  document: NativePdfDocument,
  width: number,
  height: number
): NativeCcittLimits {
  const maxDecodedBytes = document.limits.maxDecodedStreamBytes;
  const maxPixels = width * height;
  const maxPackedBytes = Math.ceil(width / 8) * height;
  return {
    maxColumns: width,
    maxRows: height,
    maxPixels,
    maxOutputBytes: Math.min(maxDecodedBytes, maxPackedBytes),
    maxScanBits: saturatingMultiply(maxDecodedBytes, 8),
    // Alternating pixels need one run and changing element per pixel. Four
    // operations per allowed pixel leaves room for 2-D mode bookkeeping while
    // keeping hostile streams bounded by the document's image ceiling.
    maxTransitions: saturatingMultiply(maxPixels, 4),
    maxDamagedRows: height
  };
}

function saturatingMultiply(left: number, right: number): number {
  if (left <= Math.floor(Number.MAX_SAFE_INTEGER / right)) return left * right;
  return Number.MAX_SAFE_INTEGER;
}

function isUnsupportedCcittCapability(cause: unknown): cause is PdfError {
  if (!(cause instanceof PdfError) || cause.code !== "unsupported-filter") return false;
  const reason = cause.details?.reason;
  return reason === "ccitt-extension-mode" ||
    reason === "ccitt-1d-extension-mode" ||
    reason === "ccitt-unsupported-parameter";
}

/**
 * The fax kernel preserves /BlackIs1 in its packed result. The generic image
 * sample pipeline uses PDF DeviceGray convention (zero black, one white), so
 * normalize fax polarity before applying the Image XObject's /Decode array.
 * This deliberately keeps /BlackIs1 and /Decode as two independent steps.
 */
function normalizeCcittBlackPolarity(
  bytes: Uint8Array,
  columns: number,
  rows: number,
  blackIs1: boolean,
  signal?: AbortSignal
): Uint8Array {
  if (!blackIs1) return bytes;
  const rowStride = Math.ceil(columns / 8);
  const tailBits = columns & 7;
  const tailMask = tailBits === 0 ? 0xff : (0xff << (8 - tailBits)) & 0xff;
  for (let row = 0; row < rows; row += 1) {
    if ((row & 0x3ff) === 0) throwIfAborted(signal);
    const rowStart = row * rowStride;
    const rowEnd = rowStart + rowStride;
    for (let offset = rowStart; offset < rowEnd; offset += 1) {
      bytes[offset] ^= 0xff;
    }
    bytes[rowEnd - 1] &= tailMask;
  }
  return bytes;
}

function validateImageSampleFilterConsistency(
  filters: readonly string[],
  decodeParameters: readonly (PdfDictionary | null)[],
  bitsPerComponent: number
): void {
  if (bitsPerComponent === 0 || filters.length === 0) return;
  const terminalFilter = filters[filters.length - 1];
  const parameters = decodeParameters[decodeParameters.length - 1];
  const predictor = parameters?.get("Predictor") ?? 1;
  if (Number.isSafeInteger(predictor) && (predictor as number) !== 1) {
    const predictorBits = parameters?.get("BitsPerComponent") ?? 8;
    if (Number.isSafeInteger(predictorBits) && predictorBits !== bitsPerComponent) {
      throw new PdfError(
        "unsupported-image",
        "Image BitsPerComponent disagrees with its terminal filter predictor.",
        { details: { bitsPerComponent, predictorBits: predictorBits as number } }
      );
    }
    return;
  }
  if ((terminalFilter === "RunLengthDecode" || terminalFilter === "RL") && bitsPerComponent !== 8) {
    throw new PdfError("unsupported-image", "A RunLengthDecode image must use eight-bit samples.");
  }
}

function codecFormat(codec: NativeImageCodec): number {
  switch (codec) {
    case "jpeg": return HEPR_IMAGE_FORMAT.Jpeg;
    case "jpeg2000": return HEPR_IMAGE_FORMAT.Jpeg2000;
    case "jbig2": return HEPR_IMAGE_FORMAT.Jbig2;
    case "ccitt": return HEPR_IMAGE_FORMAT.Ccitt;
  }
}

async function readJbig2Globals(
  document: NativePdfDocument,
  parameters: PdfDictionary | null,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!parameters?.has("JBIG2Globals")) return new Uint8Array(0);
  const resolved = await document.resolveValue(parameters.get("JBIG2Globals"), signal);
  if (!isPdfStream(resolved)) throw new PdfError("unsupported-image", "JBIG2Globals is not a stream.");
  return await document.decodeStream(resolved, signal);
}

async function serializableDecodeParameters(
  document: NativePdfDocument,
  parameters: PdfDictionary | null,
  codec: NativeImageCodec,
  embeddedSoftMask: EmbeddedSoftMask,
  signal?: AbortSignal
): Promise<Readonly<Record<string, CodecMetadataValue>>> {
  throwIfAborted(signal);
  const entries: [string, CodecMetadataValue][] = [];
  if (parameters) {
    const keys = [...parameters.keys()]
      .filter((key) => codec !== "jbig2" || key !== "JBIG2Globals")
      .sort();
    for (const key of keys) {
      throwIfAborted(signal);
      entries.push([
        key,
        await serializablePdfValue(
          document,
          parameters.get(key)!,
          new Set(),
          new Set(),
          0,
          signal
        )
      ]);
    }
  }
  if (embeddedSoftMask.present) {
    if (parameters?.has("SMaskInData")) {
      throw new PdfError(
        "unsupported-image",
        "Image SMaskInData conflicts with a codec DecodeParms entry of the same name."
      );
    }
    entries.push(["SMaskInData", embeddedSoftMask.value]);
    entries.sort(([left], [right]) => left.localeCompare(right));
  }
  throwIfAborted(signal);
  return Object.freeze(Object.fromEntries(entries));
}

async function serializablePdfValue(
  document: NativePdfDocument,
  value: PdfValue,
  refs: Set<string>,
  objects: Set<object>,
  depth: number,
  signal?: AbortSignal
): Promise<CodecMetadataValue> {
  throwIfAborted(signal);
  if (depth > document.limits.maxRecursionDepth) {
    throw new PdfError("resource-limit", "Image codec parameters exceed the recursion limit.", {
      details: { depth, limit: document.limits.maxRecursionDepth }
    });
  }
  if (isPdfRef(value)) {
    const key = pdfRefKey(value);
    if (refs.has(key)) {
      throw new PdfError("unsupported-image", "Image codec parameters contain an indirect cycle.", {
        objectNumber: value.objectNumber
      });
    }
    refs.add(key);
    try {
      return await serializablePdfValue(
        document,
        await document.resolveObject(value, signal),
        refs,
        objects,
        depth + 1,
        signal
      );
    } finally {
      refs.delete(key);
    }
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PdfError("unsupported-image", "Image codec parameters contain a non-finite number.");
    }
    return value;
  }
  if (isPdfName(value)) return `/${value.value}`;
  if (isPdfString(value)) {
    return Object.freeze({ $pdfStringHex: bytesToHex(value.bytes) });
  }
  if (isPdfStream(value)) {
    throw new PdfError(
      "unsupported-image",
      "An image codec parameter stream is unsupported outside JBIG2Globals."
    );
  }
  if (!Array.isArray(value) && !isPdfDictionary(value)) {
    throw new PdfError("unsupported-image", "An image codec parameter has an unsupported value.");
  }
  if (objects.has(value)) {
    throw new PdfError("unsupported-image", "Image codec parameters contain a direct cycle.");
  }
  objects.add(value);
  try {
    if (Array.isArray(value)) {
      const output: CodecMetadataValue[] = [];
      for (const item of value) {
        output.push(await serializablePdfValue(
          document,
          item,
          refs,
          objects,
          depth + 1,
          signal
        ));
      }
      return Object.freeze(output);
    }
    const entries: [string, CodecMetadataValue][] = [];
    for (const key of [...value.keys()].sort()) {
      entries.push([
        key,
        await serializablePdfValue(
          document,
          value.get(key)!,
          refs,
          objects,
          depth + 1,
          signal
        )
      ]);
    }
    return Object.freeze(Object.fromEntries(entries));
  } finally {
    objects.delete(value);
  }
}

async function validateImageObjectType(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  signal?: AbortSignal
): Promise<void> {
  const subtype = await document.resolveValue(dictionary.get("Subtype"), signal);
  if (!isPdfName(subtype, "Image")) {
    throw new PdfError("unsupported-image", "An XObject stream is not an /Image.");
  }
  if (dictionary.has("Type")) {
    const type = await document.resolveValue(dictionary.get("Type"), signal);
    if (!isPdfName(type, "XObject")) {
      throw new PdfError("unsupported-image", "An image stream has an invalid /Type.");
    }
  }
}

function validateLocalImageStream(dictionary: PdfDictionary, imageMask: boolean): void {
  // /F, /FFilter, and /FDecodeParms select an external stream file. PDF input
  // never initiates an external fetch, so a visible external-data image fails.
  for (const key of ["F", "FFilter", "FDecodeParms"]) {
    if (dictionary.has(key)) {
      throw new PdfError("unsupported-image", `External image stream entry /${key} is unsupported.`);
    }
  }
  // /DP is an inline-image abbreviation, not an Image XObject dictionary key.
  if (dictionary.has("DP")) {
    throw new PdfError("unsupported-image", "Image XObjects must use /DecodeParms rather than /DP.");
  }
  if (imageMask && dictionary.has("ColorSpace")) {
    throw new PdfError("unsupported-image", "An image mask must not specify ColorSpace.");
  }
  if (imageMask && dictionary.has("Mask")) {
    throw new PdfError("unsupported-image", "An image mask must not specify another Mask.");
  }
  // Alternates is print-only, while OPI and Metadata do not affect the static
  // default-view pixels. Deliberately leave those values lazy and unresolved.
}

async function readEmbeddedSoftMask(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  codec: NativeImageCodec | null,
  signal?: AbortSignal
): Promise<EmbeddedSoftMask> {
  // SMaskInData is defined only for JPXDecode. On other codecs it has no
  // imaging semantics, so do not resolve a potentially malformed unused value.
  if (codec !== "jpeg2000" || !dictionary.has("SMaskInData")) {
    return { present: false, value: 0 };
  }
  const value = await document.resolveValue(dictionary.get("SMaskInData"), signal);
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new PdfError("unsupported-image", "JPX SMaskInData must be 0, 1, or 2.");
  }
  return { present: true, value };
}

async function validateSoftMaskDictionary(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  signal?: AbortSignal
): Promise<void> {
  await validateImageObjectType(document, dictionary, signal);
  if (!dictionary.has("BitsPerComponent")) {
    throw new PdfError("unsupported-image", "An image SMask must specify BitsPerComponent.");
  }
  const colorSpace = await document.resolveValue(dictionary.get("ColorSpace"), signal);
  if (!isPdfName(colorSpace, "DeviceGray")) {
    throw new PdfError("unsupported-image", "An image SMask ColorSpace must be DeviceGray.");
  }
  if (dictionary.has("ImageMask")) {
    const imageMask = await document.resolveValue(dictionary.get("ImageMask"), signal);
    if (imageMask !== false) {
      throw new PdfError("unsupported-image", "An image SMask must not be a stencil image.");
    }
  }
  if (dictionary.has("Mask") || dictionary.has("SMask")) {
    throw new PdfError("unsupported-image", "An image SMask must not specify Mask or SMask.");
  }
  const filters = await resolveFilters(document, dictionary.get("Filter"), signal);
  const terminalCodec = filters.length > 0 ? codecForFilter(filters[filters.length - 1]) : null;
  const embedded = await readEmbeddedSoftMask(document, dictionary, terminalCodec, signal);
  if (embedded.value !== 0) {
    throw new PdfError("unsupported-image", "An image SMask must not contain embedded opacity.");
  }
}

async function requiredPositiveInteger(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  signal?: AbortSignal
): Promise<number> {
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new PdfError("unsupported-image", `Image /${key} must be a positive integer.`);
  }
  return value;
}

async function optionalBoolean(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  fallback: boolean,
  signal?: AbortSignal
): Promise<boolean> {
  if (!dictionary.has(key)) return fallback;
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (typeof value !== "boolean") throw new PdfError("unsupported-image", `Image /${key} must be boolean.`);
  return value;
}

async function readBitsPerComponent(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  imageMask: boolean,
  codec: NativeImageCodec | null,
  signal?: AbortSignal
): Promise<number> {
  // JPEG 2000 carries its own precision; the dictionary value is explicitly
  // ignored by ISO 32000 even when present.
  if (codec === "jpeg2000") return 0;
  let value: PdfValue | undefined;
  if (!dictionary.has("BitsPerComponent")) {
    if (!imageMask) throw new PdfError("unsupported-image", "An image has no BitsPerComponent.");
    value = 1;
  } else {
    value = await document.resolveValue(dictionary.get("BitsPerComponent"), signal);
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    ![1, 2, 4, 8, 16].includes(value)
  ) {
    throw new PdfError("unsupported-image", "Image BitsPerComponent must be 1, 2, 4, 8, or 16.");
  }
  if (imageMask && value !== 1) throw new PdfError("unsupported-image", "An image mask must use one bit per component.");
  if (codec === "jpeg" && value !== 8) {
    throw new PdfError("unsupported-image", "A DCTDecode image must use eight-bit samples.");
  }
  if ((codec === "jbig2" || codec === "ccitt") && value !== 1) {
    throw new PdfError("unsupported-image", `${codec} image data must use one-bit samples.`, {
      details: { codec, bitsPerComponent: value }
    });
  }
  return value;
}

async function readImageDecode(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  imageMask: boolean,
  codec: NativeImageCodec | null,
  colorSpaceIndex: number,
  componentCount: number,
  colors: NativePdfColorRegistry,
  signal?: AbortSignal
): Promise<number[]> {
  const fallback = imageMask
    ? [0, 1]
    : colorSpaceIndex >= 0
      ? [...colors.defaultDecode(colorSpaceIndex)]
      : [];
  // Non-stencil JPEG 2000 images carry their decode mapping internally.
  if (codec === "jpeg2000" && !imageMask) return [];
  if (!dictionary.has("Decode")) return fallback;
  const values = await resolveNumberArray(document, dictionary.get("Decode"), signal);
  if (values.length !== componentCount * 2) {
    throw new PdfError("unsupported-image", "An image Decode array has incompatible arity.");
  }
  if (
    imageMask &&
    !(
      (values[0] === 0 && values[1] === 1) ||
      (values[0] === 1 && values[1] === 0)
    )
  ) {
    throw new PdfError("unsupported-image", "An image-mask Decode array must be [0 1] or [1 0].");
  }
  return values;
}

async function readColorKeyMask(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  componentCount: number,
  bitsPerComponent: number,
  signal?: AbortSignal
): Promise<number[]> {
  const raw = await document.resolveValue(dictionary.get("Mask"), signal);
  if (!Array.isArray(raw)) return [];
  const values = await resolveNumberArray(document, raw, signal);
  if (
    (componentCount > 0 && values.length !== componentCount * 2) ||
    (componentCount === 0 && (values.length === 0 || (values.length & 1) !== 0))
  ) {
    throw new PdfError("unsupported-image", "An image color-key Mask has incompatible arity.");
  }
  // JPX precision is known only after codec parsing. Preserve any range that
  // fits the signed HEPR mask store and let the pinned codec validate it.
  const maximum = bitsPerComponent === 0 ? 0x7fffffff : (2 ** bitsPerComponent) - 1;
  for (let index = 0; index < values.length; index += 2) {
    if (
      !Number.isSafeInteger(values[index]) || !Number.isSafeInteger(values[index + 1]) ||
      values[index] < 0 || values[index] > values[index + 1] || values[index + 1] > maximum
    ) {
      throw new PdfError("unsupported-image", "An image color-key Mask contains an invalid range.");
    }
  }
  return values;
}

async function resolveNumberArray(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  signal?: AbortSignal
): Promise<number[]> {
  const resolved = Array.isArray(value) ? value : await document.resolveValue(value, signal);
  if (!Array.isArray(resolved)) throw new PdfError("unsupported-image", "Expected an image numeric array.");
  const output: number[] = [];
  for (const raw of resolved) {
    const item = await document.resolveValue(raw, signal);
    if (
      typeof item !== "number" ||
      !Number.isFinite(item) ||
      !Number.isFinite(Math.fround(item))
    ) {
      throw new PdfError("unsupported-image", "An image numeric array contains an invalid value.");
    }
    output.push(item);
  }
  return output;
}

function validateImageDimensions(document: NativePdfDocument, width: number, height: number): void {
  if (width > 0xffff_ffff || height > 0xffff_ffff) {
    throw new PdfError("resource-limit", "Image dimensions exceed the HEPR 32-bit store limit.", {
      details: { width, height, limit: 0xffff_ffff }
    });
  }
  if (width > document.limits.maxImageDimension || height > document.limits.maxImageDimension) {
    throw new PdfError("resource-limit", "Image dimensions exceed the configured limit.", {
      details: { width, height, limit: document.limits.maxImageDimension }
    });
  }
  if (width > Math.floor(document.limits.maxImagePixels / height)) {
    throw new PdfError("resource-limit", "Image pixel count exceeds the configured limit.", {
      details: { width, height, limit: document.limits.maxImagePixels }
    });
  }
}

function validateImageWorkingSet(
  document: NativePdfDocument,
  width: number,
  height: number,
  componentCount: number,
  bitsPerComponent: number,
  maxDecodedStreamBytes = document.limits.maxDecodedStreamBytes
): void {
  const pixels = width * height;
  const rowBytes = Math.ceil(width * componentCount * bitsPerComponent / 8);
  const packedBytes = rowBytes * height;
  const sampleBytes = pixels * componentCount * 2;
  const outputBytes = pixels * 4 * (bitsPerComponent === 16 ? 2 : 1);
  const limit = maxDecodedStreamBytes;
  if (
    !Number.isSafeInteger(sampleBytes) ||
    !Number.isSafeInteger(outputBytes) ||
    !Number.isSafeInteger(packedBytes) ||
    packedBytes > limit ||
    sampleBytes > limit ||
    outputBytes > limit
  ) {
    throw new PdfError("resource-limit", "Image decode working storage exceeds the configured stream limit.", {
      details: { packedBytes, sampleBytes, outputBytes, limit }
    });
  }
}

interface TypedArrayConstructor<T> {
  new(length: number): T;
}

function allocateTypedArray<T>(
  constructor: TypedArrayConstructor<T>,
  length: number,
  label: string
): T {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new PdfError("resource-limit", `Invalid ${label} length.`, { details: { length } });
  }
  try {
    return new constructor(length);
  } catch (cause) {
    throw new PdfError("resource-limit", `Unable to allocate ${label}.`, {
      cause,
      details: { length }
    });
  }
}

function allocateSamples(length: number): Uint16Array {
  return allocateTypedArray(Uint16Array, length, "unpacked image samples");
}

function allocateBytes(length: number, label: string): Uint8Array {
  return allocateTypedArray(Uint8Array, length, label);
}

function copyBytes(bytes: Uint8Array, label: string): Uint8Array {
  const copy = allocateBytes(bytes.byteLength, label);
  copy.set(bytes);
  return copy;
}

function sumStoreLengths<T>(
  records: readonly T[],
  label: string,
  lengthOf: (record: T) => number
): number {
  let total = 0;
  for (const record of records) {
    const length = lengthOf(record);
    if (!Number.isSafeInteger(length) || length < 0 || total > 0xffff_ffff - length) {
      throw new PdfError("resource-limit", `The HEPR ${label} store exceeds its 32-bit offset limit.`);
    }
    total += length;
  }
  return total;
}

function canonicalizeCodecMetadataRecord(
  value: unknown
): Readonly<Record<string, CodecMetadataValue>> {
  if (!isPlainRecord(value)) {
    throw new PdfError("unsupported-image", "Image codec metadata must be an object.");
  }
  const converted = canonicalizeCodecMetadataValue(value, new Set(), 0);
  if (!isPlainRecord(converted)) {
    throw new PdfError("unsupported-image", "Image codec metadata must be an object.");
  }
  return converted as Readonly<Record<string, CodecMetadataValue>>;
}

function canonicalizeCodecMetadataValue(
  value: unknown,
  objects: Set<object>,
  depth: number
): CodecMetadataValue {
  if (depth > 64) {
    throw new PdfError("resource-limit", "Image codec metadata exceeds the envelope recursion limit.");
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PdfError("unsupported-image", "Image codec metadata contains a non-finite number.");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new PdfError("unsupported-image", "Image codec metadata contains an unsupported value.");
  }
  if (objects.has(value)) {
    throw new PdfError("unsupported-image", "Image codec metadata contains a cycle.");
  }
  objects.add(value);
  try {
    if (Array.isArray(value)) {
      const output: CodecMetadataValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new PdfError("unsupported-image", "Image codec metadata contains a sparse array.");
        }
        output.push(canonicalizeCodecMetadataValue(value[index], objects, depth + 1));
      }
      return Object.freeze(output);
    }
    if (!isPlainRecord(value)) {
      throw new PdfError("unsupported-image", "Image codec metadata contains a non-plain object.");
    }
    const entries: [string, CodecMetadataValue][] = [];
    for (const key of Object.keys(value).sort()) {
      entries.push([
        key,
        canonicalizeCodecMetadataValue(
          (value as Record<string, unknown>)[key],
          objects,
          depth + 1
        )
      ]);
    }
    return Object.freeze(Object.fromEntries(entries));
  } finally {
    objects.delete(value);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function bytesToHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function interpolate(value: number, x0: number, x1: number, y0: number, y1: number): number {
  return y0 + (value - x0) * (y1 - y0) / (x1 - x0);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
