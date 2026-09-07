import { PdfError, throwIfAborted } from "./nativeTypes";

export type NativeIccComponentCount = 1 | 3 | 4;

export interface NativeIccProfileMetadata {
  readonly declaredSize: number;
  readonly preferredCmm: string;
  readonly versionMajor: number;
  readonly deviceClass: string;
  readonly dataColorSpace: string;
  readonly connectionSpace: string;
}

/** Compatibility boundary for synchronous, in-process ICC kernels. */
export interface NativeIccTransformKernel {
  convertToSrgb(
    profile: Uint8Array,
    components: readonly number[],
    metadata: Readonly<NativeIccProfileMetadata>
  ): readonly [number, number, number];
}

export type NativeIccRenderingIntent = "relative-colorimetric";

/**
 * A bounded batch sent to a caller-owned ICC kernel.
 *
 * `inputSamples` contains interleaved, normalized unsigned 8-bit samples.
 * The lattice is row-major: component zero is the outermost dimension and
 * the final input component is the innermost dimension. The arrays are
 * isolated from PDF source/storage bytes, so a resolver may transfer them to
 * its own focused worker or WASM instance.
 */
export interface NativeIccTransformRequest {
  readonly profile: Uint8Array;
  readonly metadata: Readonly<NativeIccProfileMetadata>;
  readonly inputComponents: NativeIccComponentCount;
  readonly gridPointsPerComponent: number;
  readonly sampleCount: number;
  readonly inputSamples: Uint8Array;
  readonly renderingIntent: NativeIccRenderingIntent;
}

/** Packed nonlinear sRGB output corresponding one-for-one with the request. */
export interface NativeIccTransformResult {
  readonly samples: Uint8Array;
  readonly sampleCount: number;
  readonly outputComponents: number;
  readonly bitsPerComponent: number;
}

/**
 * Caller-owned boundary intended for a future pinned qcms WASM adapter. HEPR
 * itself does not bundle or imply a particular color-management library.
 */
export type NativeIccTransformResolver = (
  request: Readonly<NativeIccTransformRequest>,
  signal?: AbortSignal
) => NativeIccTransformResult | Promise<NativeIccTransformResult>;

export const NATIVE_ICC_GRID_POINTS: Readonly<Record<NativeIccComponentCount, number>> =
  Object.freeze({ 1: 256, 3: 33, 4: 17 });

export const DEFAULT_MAX_ICC_TRANSFORM_BYTES = 16 * 1024 * 1024;

interface NativeIccTransformShape {
  readonly sampleCount: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
}

/** Build an isolated, deterministic transform batch for one validated profile. */
export function createNativeIccTransformRequest(
  profile: Uint8Array,
  metadata: Readonly<NativeIccProfileMetadata>,
  inputComponents: NativeIccComponentCount,
  maxTransformBytes = DEFAULT_MAX_ICC_TRANSFORM_BYTES,
  signal?: AbortSignal
): Readonly<NativeIccTransformRequest> {
  throwIfAborted(signal);
  const gridPointsPerComponent = NATIVE_ICC_GRID_POINTS[inputComponents];
  const shape = transformShape(
    inputComponents,
    gridPointsPerComponent,
    maxTransformBytes
  );
  let ownedProfile: Uint8Array;
  let inputSamples: Uint8Array;
  try {
    ownedProfile = new Uint8Array(profile.byteLength);
    ownedProfile.set(profile);
    inputSamples = new Uint8Array(shape.inputBytes);
  } catch (cause) {
    throw new PdfError("resource-limit", "Unable to allocate an ICC transform request.", {
      cause,
      details: {
        profileBytes: profile.byteLength,
        inputBytes: shape.inputBytes
      }
    });
  }
  for (let sample = 0; sample < shape.sampleCount; sample += 1) {
    if ((sample & 0xfff) === 0) throwIfAborted(signal);
    let remainder = sample;
    const offset = sample * inputComponents;
    for (let component = inputComponents - 1; component >= 0; component -= 1) {
      const coordinate = remainder % gridPointsPerComponent;
      remainder = Math.floor(remainder / gridPointsPerComponent);
      inputSamples[offset + component] = Math.round(
        coordinate * 255 / (gridPointsPerComponent - 1)
      );
    }
  }
  throwIfAborted(signal);
  return Object.freeze({
    profile: ownedProfile,
    metadata: Object.freeze({ ...metadata }),
    inputComponents,
    gridPointsPerComponent,
    sampleCount: shape.sampleCount,
    inputSamples,
    renderingIntent: "relative-colorimetric"
  });
}

/** Invoke and fully validate a direct or worker-proxied caller resolver. */
export async function resolveNativeIccTransformThroughCaller(
  resolver: NativeIccTransformResolver,
  request: Readonly<NativeIccTransformRequest>,
  maxTransformBytes = DEFAULT_MAX_ICC_TRANSFORM_BYTES,
  signal?: AbortSignal
): Promise<Readonly<NativeIccTransformResult>> {
  validateNativeIccTransformRequest(request, maxTransformBytes);
  throwIfAborted(signal);
  let result: NativeIccTransformResult;
  try {
    result = await resolver(request, signal);
  } catch (cause) {
    throwIfAborted(signal);
    if (cause instanceof PdfError) throw cause;
    throw new PdfError("unsupported-color", "The ICC transform resolver failed.", {
      cause,
      details: { reason: "icc-transform-resolver-failed" }
    });
  }
  throwIfAborted(signal);
  return normalizeNativeIccTransformResult(
    result,
    request,
    maxTransformBytes,
    signal
  );
}

/** Validate an untrusted worker request before handing it to a host callback. */
export function validateNativeIccTransformRequest(
  request: Readonly<NativeIccTransformRequest>,
  maxTransformBytes = DEFAULT_MAX_ICC_TRANSFORM_BYTES
): void {
  if (
    !request || typeof request !== "object" ||
    !(request.profile instanceof Uint8Array) ||
    !(request.inputSamples instanceof Uint8Array) ||
    !isIccComponentCount(request.inputComponents) ||
    request.renderingIntent !== "relative-colorimetric" ||
    !request.metadata || typeof request.metadata !== "object"
  ) {
    throw invalidTransform("The ICC transform request is malformed.");
  }
  const shape = transformShape(
    request.inputComponents,
    request.gridPointsPerComponent,
    maxTransformBytes
  );
  if (
    request.sampleCount !== shape.sampleCount ||
    request.inputSamples.byteLength !== shape.inputBytes
  ) {
    throw invalidTransform("The ICC transform request has an inconsistent sample layout.", {
      expectedSamples: shape.sampleCount,
      actualSamples: request.sampleCount,
      expectedBytes: shape.inputBytes,
      actualBytes: request.inputSamples.byteLength
    });
  }
  if (
    !Number.isSafeInteger(request.metadata.declaredSize) ||
    request.metadata.declaredSize !== request.profile.byteLength ||
    !Number.isSafeInteger(request.metadata.versionMajor) ||
    request.metadata.versionMajor < 0 || request.metadata.versionMajor > 255 ||
    !isSignature(request.metadata.preferredCmm) ||
    !isSignature(request.metadata.deviceClass) ||
    !isSignature(request.metadata.dataColorSpace) ||
    !isSignature(request.metadata.connectionSpace)
  ) {
    throw invalidTransform("The ICC transform request has invalid profile metadata.");
  }
}

/**
 * Validate and copy caller-owned output. The returned byte array may safely be
 * transferred or retained by HEPR without detaching/mutating the caller value.
 */
export function normalizeNativeIccTransformResult(
  result: NativeIccTransformResult,
  request: Readonly<NativeIccTransformRequest>,
  maxTransformBytes = DEFAULT_MAX_ICC_TRANSFORM_BYTES,
  signal?: AbortSignal
): Readonly<NativeIccTransformResult> {
  throwIfAborted(signal);
  const shape = transformShape(
    request.inputComponents,
    request.gridPointsPerComponent,
    maxTransformBytes
  );
  if (
    !result || typeof result !== "object" ||
    !(result.samples instanceof Uint8Array) ||
    result.sampleCount !== shape.sampleCount ||
    result.outputComponents !== 3 ||
    result.bitsPerComponent !== 8 ||
    result.samples.byteLength !== shape.outputBytes
  ) {
    throw invalidTransform(
      "The ICC transform resolver returned an invalid result.",
      {
        expectedSamples: shape.sampleCount,
        actualSamples: readFiniteInteger(result?.sampleCount),
        expectedBytes: shape.outputBytes,
        actualBytes: result?.samples instanceof Uint8Array ? result.samples.byteLength : -1
      },
      "invalid-icc-transform-result"
    );
  }
  let samples: Uint8Array;
  try {
    samples = new Uint8Array(result.samples.byteLength);
    samples.set(result.samples);
  } catch (cause) {
    throw new PdfError("resource-limit", "Unable to copy the ICC transform result.", {
      cause,
      details: { bytes: shape.outputBytes }
    });
  }
  throwIfAborted(signal);
  return Object.freeze({
    samples,
    sampleCount: shape.sampleCount,
    outputComponents: 3,
    bitsPerComponent: 8
  });
}

/** Multilinearly sample an owned 1D, 3D, or 4D normalized-sRGB lattice. */
export function sampleNativeIccTransform(
  transform: Readonly<NativeIccTransformResult>,
  inputComponents: NativeIccComponentCount,
  normalizedComponents: readonly number[],
  signal?: AbortSignal
): readonly [number, number, number] {
  throwIfAborted(signal);
  if (
    normalizedComponents.length !== inputComponents ||
    normalizedComponents.some((value) => !Number.isFinite(value))
  ) {
    throw new PdfError("unsupported-color", "The ICC transform received an invalid component vector.");
  }
  const grid = NATIVE_ICC_GRID_POINTS[inputComponents];
  const p0 = Math.max(0, Math.min(1, normalizedComponents[0])) * (grid - 1);
  const l0 = Math.floor(p0);
  const h0 = Math.min(l0 + 1, grid - 1);
  const f0 = p0 - l0;
  if (inputComponents === 1) {
    const lowOffset = l0 * 3;
    const highOffset = h0 * 3;
    return [
      (transform.samples[lowOffset] * (1 - f0) + transform.samples[highOffset] * f0) / 255,
      (transform.samples[lowOffset + 1] * (1 - f0) + transform.samples[highOffset + 1] * f0) / 255,
      (transform.samples[lowOffset + 2] * (1 - f0) + transform.samples[highOffset + 2] * f0) / 255
    ];
  }
  const p1 = Math.max(0, Math.min(1, normalizedComponents[1])) * (grid - 1);
  const l1 = Math.floor(p1);
  const h1 = Math.min(l1 + 1, grid - 1);
  const f1 = p1 - l1;
  const p2 = Math.max(0, Math.min(1, normalizedComponents[2])) * (grid - 1);
  const l2 = Math.floor(p2);
  const h2 = Math.min(l2 + 1, grid - 1);
  const f2 = p2 - l2;
  let l3 = 0;
  let h3 = 0;
  let f3 = 0;
  if (inputComponents === 4) {
    const p3 = Math.max(0, Math.min(1, normalizedComponents[3])) * (grid - 1);
    l3 = Math.floor(p3);
    h3 = Math.min(l3 + 1, grid - 1);
    f3 = p3 - l3;
  }
  let red = 0;
  let green = 0;
  let blue = 0;
  const cornerCount = 1 << inputComponents;
  for (let corner = 0; corner < cornerCount; corner += 1) {
    const upper0 = (corner & 1) !== 0;
    const upper1 = (corner & 2) !== 0;
    const upper2 = (corner & 4) !== 0;
    const c0 = upper0 ? h0 : l0;
    const c1 = upper1 ? h1 : l1;
    const c2 = upper2 ? h2 : l2;
    let sampleIndex = (c0 * grid + c1) * grid + c2;
    let weight = (upper0 ? f0 : 1 - f0) *
      (upper1 ? f1 : 1 - f1) *
      (upper2 ? f2 : 1 - f2);
    if (inputComponents === 4) {
      const upper3 = (corner & 8) !== 0;
      sampleIndex = sampleIndex * grid + (upper3 ? h3 : l3);
      weight *= upper3 ? f3 : 1 - f3;
    }
    if (weight === 0) continue;
    const offset = sampleIndex * 3;
    red += transform.samples[offset] * weight;
    green += transform.samples[offset + 1] * weight;
    blue += transform.samples[offset + 2] * weight;
  }
  throwIfAborted(signal);
  return [red / 255, green / 255, blue / 255];
}

function transformShape(
  inputComponents: NativeIccComponentCount,
  gridPointsPerComponent: number,
  maxTransformBytes: number
): NativeIccTransformShape {
  if (!isIccComponentCount(inputComponents)) {
    throw invalidTransform("The ICC transform component count is unsupported.");
  }
  if (
    !Number.isSafeInteger(gridPointsPerComponent) ||
    gridPointsPerComponent < 2 || gridPointsPerComponent > 256
  ) {
    throw invalidTransform("The ICC transform grid size is invalid.");
  }
  if (!Number.isSafeInteger(maxTransformBytes) || maxTransformBytes <= 0) {
    throw new RangeError("maxIccTransformBytes must be a positive safe integer.");
  }
  let sampleCount = 1;
  for (let index = 0; index < inputComponents; index += 1) {
    sampleCount *= gridPointsPerComponent;
    if (!Number.isSafeInteger(sampleCount)) {
      throw new PdfError("resource-limit", "The ICC transform sample count is too large.");
    }
  }
  const inputBytes = sampleCount * inputComponents;
  const outputBytes = sampleCount * 3;
  const workingBytes = inputBytes + outputBytes;
  if (
    !Number.isSafeInteger(inputBytes) ||
    !Number.isSafeInteger(outputBytes) ||
    !Number.isSafeInteger(workingBytes) ||
    workingBytes > maxTransformBytes
  ) {
    throw new PdfError("resource-limit", "An ICC transform exceeds the configured byte limit.", {
      details: { workingBytes, limit: maxTransformBytes, reason: "icc-transform-bytes" }
    });
  }
  return { sampleCount, inputBytes, outputBytes };
}

function invalidTransform(
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
  reason = "invalid-icc-transform-request"
): PdfError {
  return new PdfError("unsupported-color", message, {
    details: { reason, ...details }
  });
}

function isIccComponentCount(value: number): value is NativeIccComponentCount {
  return value === 1 || value === 3 || value === 4;
}

function isSignature(value: unknown): value is string {
  return typeof value === "string" && value.length === 4;
}

function readFiniteInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : -1;
}
