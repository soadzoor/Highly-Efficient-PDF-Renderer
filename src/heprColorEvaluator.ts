import { HEPR_COLOR_SPACE_KIND, type HeprColorStore, type HeprPageData } from "./heprDocumentData";
import { NATIVE_ICC_GRID_POINTS, normalizeIccComponents, sampleNativeIccTransform,
  type NativeIccComponentCount } from "./pdf/nativeIcc";
import { convertDeviceCmykToSrgb } from "./pdf/deviceCmyk";
import { PdfError } from "./pdf/nativeTypes";

const D65_WHITE_POINT = [0.95047, 1, 1.08883] as const;

/** Shared retained color conversion for vector lowering and Canvas reference rendering. */
export class HeprColorEvaluator {
  private readonly colors: HeprColorStore;
  private readonly evaluateFunctions: (indices: readonly number[], inputs: readonly number[], path: string) => readonly number[];
  private readonly signal?: AbortSignal;
  constructor(colors: HeprColorStore,
    evaluateFunctions: (indices: readonly number[], inputs: readonly number[], path: string) => readonly number[],
    signal?: AbortSignal) { this.colors = colors; this.evaluateFunctions = evaluateFunctions; this.signal = signal; }
  convert(
    index: number,
    components: ArrayLike<number>,
    path: string,
    active: ReadonlySet<number> = new Set(),
    depth = 0
  ): readonly [number, number, number] {
    this.signal?.throwIfAborted();
    const colors = this.colors;
    if (depth >= 64 || active.has(index)) {
      throw colorError(
        "The page-native color-space graph is recursive or too deep.",
        path
      );
    }
    const componentCount = colors.componentCounts[index];
    const values = Array.from(components);
    if (values.length !== componentCount || values.some((value) => !Number.isFinite(value))) {
      throw colorError(
        `Color space ${index} received an invalid component vector.`,
        path
      );
    }
    const parameters = colors.parameters.subarray(
      colors.parameterOffsets[index],
      colors.parameterOffsets[index + 1]
    );
    let rgb: readonly [number, number, number];
    switch (colors.spaceKinds[index]) {
      case HEPR_COLOR_SPACE_KIND.DeviceGray: {
        const gray = clamp01(values[0]);
        rgb = [gray, gray, gray];
        break;
      }
      case HEPR_COLOR_SPACE_KIND.DeviceRgb:
        rgb = [clamp01(values[0]), clamp01(values[1]), clamp01(values[2])];
        break;
      case HEPR_COLOR_SPACE_KIND.DeviceCmyk: {
        const [cyan, magenta, yellow, black] = values.map(clamp01);
        rgb = convertDeviceCmykToSrgb(cyan, magenta, yellow, black);
        break;
      }
      case HEPR_COLOR_SPACE_KIND.CalGray: {
        if (parameters.length !== 7) return this.unsupportedColorMetadata(index, path);
        const gray = Math.pow(clamp01(values[0]), parameters[6]);
        rgb = xyzToSrgb(
          [parameters[0] * gray, parameters[1] * gray, parameters[2] * gray],
          parameters.subarray(0, 3)
        );
        break;
      }
      case HEPR_COLOR_SPACE_KIND.CalRgb: {
        if (parameters.length !== 18) return this.unsupportedColorMetadata(index, path);
        const first = Math.pow(clamp01(values[0]), parameters[6]);
        const second = Math.pow(clamp01(values[1]), parameters[7]);
        const third = Math.pow(clamp01(values[2]), parameters[8]);
        const matrix = parameters.subarray(9, 18);
        rgb = xyzToSrgb([
          matrix[0] * first + matrix[3] * second + matrix[6] * third,
          matrix[1] * first + matrix[4] * second + matrix[7] * third,
          matrix[2] * first + matrix[5] * second + matrix[8] * third
        ], parameters.subarray(0, 3));
        break;
      }
      case HEPR_COLOR_SPACE_KIND.Lab: {
        if (parameters.length !== 10) return this.unsupportedColorMetadata(index, path);
        const lightness = clampRange(values[0], 0, 100);
        const first = clampRange(values[1], parameters[6], parameters[7]);
        const second = clampRange(values[2], parameters[8], parameters[9]);
        const middle = (lightness + 16) / 116;
        rgb = xyzToSrgb([
          parameters[0] * labInverse(middle + first / 500),
          parameters[1] * labInverse(middle),
          parameters[2] * labInverse(middle - second / 200)
        ], parameters.subarray(0, 3));
        break;
      }
      case HEPR_COLOR_SPACE_KIND.IccBased: {
        const mode = colors.iccModes[index];
        if (parameters.length !== componentCount * 2) return this.unsupportedColorMetadata(index, path);
        if (mode === 1) {
          const next = new Set(active);
          next.add(index);
          return this.convert(colors.alternateSpaceIndices[index], values.map((value, component) =>
            clampRange(value, parameters[component * 2], parameters[component * 2 + 1])), path, next, depth + 1);
        }
        if (mode >= 2 && mode <= 4 && [1, 3, 4].includes(componentCount)) {
          const samples = colors.iccTransformSamples.subarray(colors.iccTransformOffsets[index], colors.iccTransformOffsets[index + 1]);
          if (samples.length !== 3 * NATIVE_ICC_GRID_POINTS[componentCount as NativeIccComponentCount] ** componentCount) {
            return this.unsupportedColorMetadata(index, path);
          }
          rgb = sampleNativeIccTransform({ samples, sampleCount: samples.length / 3, outputComponents: 3, bitsPerComponent: 8 },
            componentCount as NativeIccComponentCount, normalizeIccComponents(values, parameters, mode), this.signal);
          break;
        }
        throw colorError(
          "ICCBased shading has no prepared transform or permitted fallback.", path);
      }
      case HEPR_COLOR_SPACE_KIND.Indexed: {
        if (parameters.length !== 1) return this.unsupportedColorMetadata(index, path);
        const alternate = colors.alternateSpaceIndices[index];
        const alternateCount = colors.componentCounts[alternate];
        const highValue = Math.trunc(parameters[0]);
        const item = Math.round(clampRange(values[0], 0, highValue));
        const lookupStart = colors.lookupOffsets[index] + item * alternateCount;
        const lookupEnd = lookupStart + alternateCount;
        if (lookupEnd > colors.lookupOffsets[index + 1]) {
          return this.unsupportedColorMetadata(index, path);
        }
        const alternateValues = Array.from(
          colors.lookupBytes.subarray(lookupStart, lookupEnd),
          (entry, component) => {
            const [low, high] = defaultColorDecode(colors, alternate, component);
            return low + (entry / 255) * (high - low);
          }
        );
        const next = new Set(active);
        next.add(index);
        return this.convert(alternate, alternateValues, path, next, depth + 1);
      }
      case HEPR_COLOR_SPACE_KIND.Separation:
      case HEPR_COLOR_SPACE_KIND.DeviceN: {
        const names = colors.names.slice(colors.nameOffsets[index], colors.nameOffsets[index + 1]);
        // /All is displayed through its tint transform; /None never paints.
        if (names.every((name) => name === "None")) {
          throw colorError(
            "A special /None colorant has no backdrop-independent sRGB value.",
            path
          );
        }
        const alternate = colors.alternateSpaceIndices[index];
        const transformed = this.evaluateFunctions(
          [colors.functionIndices[index]],
          values.map(clamp01),
          path
        );
        const next = new Set(active);
        next.add(index);
        return this.convert(alternate, transformed, path, next, depth + 1);
      }
      default:
        throw colorError(
          `Cannot convert color-space kind ${colors.spaceKinds[index]}.`,
          path
        );
    }
    return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
  }

  private unsupportedColorMetadata(index: number, path: string): never {
    throw colorError(
      `Color space ${index} has invalid self-contained conversion metadata.`,
      path
    );
  }

}

function xyzToSrgb(
  xyz: readonly number[],
  sourceWhite: ArrayLike<number>
): readonly [number, number, number] {
  const adapted = adaptBradford(xyz, sourceWhite, D65_WHITE_POINT);
  return [
    srgbCompand(3.2404542 * adapted[0] - 1.5371385 * adapted[1] - 0.4985314 * adapted[2]),
    srgbCompand(-0.969266 * adapted[0] + 1.8760108 * adapted[1] + 0.041556 * adapted[2]),
    srgbCompand(0.0556434 * adapted[0] - 0.2040259 * adapted[1] + 1.0572252 * adapted[2])
  ];
}

function adaptBradford(
  xyz: readonly number[],
  sourceWhite: ArrayLike<number>,
  targetWhite: ArrayLike<number>
): readonly [number, number, number] {
  const forward = [
    0.8951, 0.2664, -0.1614,
    -0.7502, 1.7135, 0.0367,
    0.0389, -0.0685, 1.0296
  ];
  const inverse = [
    0.9869929, -0.1470543, 0.1599627,
    0.4323053, 0.5183603, 0.0492912,
    -0.0085287, 0.0400428, 0.9684867
  ];
  const sourceCone = multiplyColorMatrix(forward, sourceWhite);
  const targetCone = multiplyColorMatrix(forward, targetWhite);
  const cone = multiplyColorMatrix(forward, xyz);
  if (sourceCone.some((value) => value === 0 || !Number.isFinite(value))) {
    return [0, 0, 0];
  }
  return multiplyColorMatrix(inverse, [
    cone[0] * targetCone[0] / sourceCone[0],
    cone[1] * targetCone[1] / sourceCone[1],
    cone[2] * targetCone[2] / sourceCone[2]
  ]);
}

function multiplyColorMatrix(
  matrix: readonly number[],
  vector: ArrayLike<number>
): [number, number, number] {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2]
  ];
}

function labInverse(value: number): number {
  const delta = 6 / 29;
  return value >= delta ? value ** 3 : 3 * delta * delta * (value - 4 / 29);
}

function srgbCompand(value: number): number {
  return clamp01(value <= 0.0031308
    ? 12.92 * value
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055);
}

function defaultColorDecode(
  colors: HeprPageData["stores"]["colors"],
  colorSpaceIndex: number,
  component: number
): readonly [number, number] {
  const kind = colors.spaceKinds[colorSpaceIndex];
  const parameters = colors.parameters.subarray(
    colors.parameterOffsets[colorSpaceIndex],
    colors.parameterOffsets[colorSpaceIndex + 1]
  );
  if (kind === HEPR_COLOR_SPACE_KIND.Indexed) return [0, parameters[0]];
  if (kind === HEPR_COLOR_SPACE_KIND.Lab) {
    if (component === 0) return [0, 100];
    return component === 1 ? [parameters[6], parameters[7]] : [parameters[8], parameters[9]];
  }
  if (kind === HEPR_COLOR_SPACE_KIND.IccBased && parameters.length >= component * 2 + 2) {
    return [parameters[component * 2], parameters[component * 2 + 1]];
  }
  return [0, 1];
}


function clampRange(value: number, minimum: number, maximum: number): number {
  return Math.max(Math.min(minimum, maximum), Math.min(Math.max(minimum, maximum), value));
}
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function colorError(message: string, path: string): PdfError {
  return new PdfError("unsupported-content", message, { details: { reason: "retained-color", path } });
}
