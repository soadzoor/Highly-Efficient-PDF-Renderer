import {
  HEPR_COLOR_SPACE_KIND,
  HEPR_DOCUMENT_DATA_VERSION,
  HEPR_FONT_KIND,
  HEPR_FUNCTION_KIND,
  HEPR_GLYPH_FLAG,
  HEPR_GRADIENT_KIND,
  HEPR_IMAGE_FORMAT,
  HEPR_MESH_KIND,
  HEPR_PAINT_KIND,
  HEPR_PATTERN_KIND,
  HEPR_PATH_FLAG,
  HEPR_PATH_VERB,
  HEPR_STROKE_FLAG,
  HEPR_VIEW_TRANSFORM_FLAG,
  type HeprCompositeGroup,
  type HeprDisplayCommand,
  type HeprDocumentData,
  type HeprPageData,
  type HeprPageStores,
  type HeprReusableProgram,
  type PdfBox,
  type PdfBlendMode,
  type PdfDiagnostic,
  type PdfPageInfo
} from "./heprDocumentData";

export const HEPR_DATA_VALIDATION_CODES = {
  InvalidShape: "hepr.invalid-shape",
  IncompatibleVersion: "hepr.incompatible-version",
  InvalidNumber: "hepr.invalid-number",
  InvalidCardinality: "hepr.invalid-cardinality",
  InvalidOffsets: "hepr.invalid-offsets",
  InvalidReference: "hepr.invalid-reference",
  ResourceCycle: "hepr.resource-cycle",
  ResourceLimit: "hepr.resource-limit",
  DuplicatePage: "hepr.duplicate-page"
} as const;

export type HeprDataValidationCode =
  (typeof HEPR_DATA_VALIDATION_CODES)[keyof typeof HEPR_DATA_VALIDATION_CODES];

export class HeprDataValidationError extends Error {
  readonly code: HeprDataValidationCode;

  readonly path: string;

  constructor(code: HeprDataValidationCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "HeprDataValidationError";
    this.code = code;
    this.path = path;
  }
}

export interface HeprDataValidationLimits {
  maxPages: number;
  maxCommandsPerPage: number;
  maxResourcesPerStore: number;
  maxTypedArrayBytesPerPage: number;
  maxTextCodeUnitsPerPage: number;
}

export const DEFAULT_HEPR_DATA_VALIDATION_LIMITS: Readonly<HeprDataValidationLimits> =
  Object.freeze({
    maxPages: 1_000_000,
    maxCommandsPerPage: 10_000_000,
    maxResourcesPerStore: 10_000_000,
    maxTypedArrayBytesPerPage: 2 * 1024 * 1024 * 1024,
    maxTextCodeUnitsPerPage: 100_000_000
  });

type TypedArray =
  | Uint8Array
  | Uint32Array
  | Int32Array
  | Float32Array;

type TypedArrayConstructor =
  | Uint8ArrayConstructor
  | Uint32ArrayConstructor
  | Int32ArrayConstructor
  | Float32ArrayConstructor;

function fail(code: HeprDataValidationCode, path: string, message: string): never {
  throw new HeprDataValidationError(code, path, message);
}

function requireRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, path, "expected an object");
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidShape,
      path,
      "contains unknown or missing page-native fields"
    );
  }
}

function requireAllowedKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  path: string
): void {
  const actual = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidShape,
      path,
      "contains unknown or missing page-native fields"
    );
  }
}

function requireTypedArray<T extends TypedArray>(
  value: unknown,
  constructor: TypedArrayConstructor,
  path: string
): asserts value is T {
  if (!(value instanceof constructor)) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidShape,
      path,
      `expected ${constructor.name}`
    );
  }
}

function requireSafeInteger(value: number, path: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidNumber,
      path,
      `expected a safe integer >= ${minimum}`
    );
  }
}

function requireFinite(value: number, path: string): void {
  if (!Number.isFinite(value)) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, path, "expected a finite number");
  }
}

function requireFiniteArray(values: Float32Array, path: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}[${index}]`,
        "expected a finite number"
      );
    }
  }
}

function requireLength(actual: number, expected: number, path: string): void {
  if (actual !== expected) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidCardinality,
      path,
      `expected length ${expected}, received ${actual}`
    );
  }
}

function requireMultiple(actual: number, stride: number, path: string): void {
  if (actual % stride !== 0) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidCardinality,
      path,
      `length ${actual} is not divisible by ${stride}`
    );
  }
}

function validateOffsets(
  offsets: Uint32Array,
  entryCount: number,
  payloadLength: number,
  path: string
): void {
  requireLength(offsets.length, entryCount + 1, path);
  if (offsets[0] !== 0) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidOffsets, `${path}[0]`, "must be zero");
  }
  for (let index = 1; index < offsets.length; index += 1) {
    if (offsets[index] < offsets[index - 1]) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidOffsets,
        `${path}[${index}]`,
        "must be monotonic"
      );
    }
  }
  if (offsets[offsets.length - 1] !== payloadLength) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidOffsets,
      `${path}[${offsets.length - 1}]`,
      `must equal payload length ${payloadLength}`
    );
  }
}

function validateOptionalIndex(value: number, count: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < -1 || value >= count) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidReference,
      path,
      `expected -1 or an index below ${count}, received ${value}`
    );
  }
}

function validateRequiredIndex(value: number, count: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= count) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidReference,
      path,
      `expected an index below ${count}, received ${value}`
    );
  }
}

function validateRange(
  first: number,
  count: number,
  total: number,
  path: string
): void {
  requireSafeInteger(first, `${path}.first`);
  requireSafeInteger(count, `${path}.count`, 1);
  if (first + count > total) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidReference,
      path,
      `range [${first}, ${first + count}) exceeds store length ${total}`
    );
  }
}

function validateBox(value: PdfBox, path: string): void {
  if (!Array.isArray(value) || value.length !== 4) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, path, "expected a four-number tuple");
  }
  value.forEach((entry, index) => requireFinite(entry, `${path}[${index}]`));
  if (value[0] > value[2] || value[1] > value[3]) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, path, "rectangle is not normalized");
  }
}

function validatePageInfo(info: PdfPageInfo, path: string): void {
  requireRecord(info, path);
  requireExactKeys(
    info,
    [
      "sourcePageIndex", "mediaBox", "cropBox", "bleedBox", "trimBox", "artBox",
      "rotation", "userUnit", "width", "height"
    ],
    path
  );
  requireSafeInteger(info.sourcePageIndex, `${path}.sourcePageIndex`);
  validateBox(info.mediaBox, `${path}.mediaBox`);
  validateBox(info.cropBox, `${path}.cropBox`);
  if (info.bleedBox !== null) validateBox(info.bleedBox, `${path}.bleedBox`);
  if (info.trimBox !== null) validateBox(info.trimBox, `${path}.trimBox`);
  if (info.artBox !== null) validateBox(info.artBox, `${path}.artBox`);
  if (info.rotation !== 0 && info.rotation !== 90 && info.rotation !== 180 && info.rotation !== 270) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidNumber,
      `${path}.rotation`,
      "expected 0, 90, 180, or 270"
    );
  }
  requireFinite(info.userUnit, `${path}.userUnit`);
  requireFinite(info.width, `${path}.width`);
  requireFinite(info.height, `${path}.height`);
  if (info.userUnit <= 0 || info.width <= 0 || info.height <= 0) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidNumber,
      path,
      "userUnit, width, and height must be positive"
    );
  }
}

function validateDiagnostics(diagnostics: readonly PdfDiagnostic[], path: string): void {
  if (!Array.isArray(diagnostics)) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, path, "expected an array");
  }
  diagnostics.forEach((diagnostic, index) => {
    const itemPath = `${path}[${index}]`;
    requireRecord(diagnostic, itemPath);
    requireAllowedKeys(
      diagnostic,
      ["code", "severity", "message"],
      ["offset", "objectNumber", "pageIndex", "details"],
      itemPath
    );
    if (typeof diagnostic.code !== "string" || diagnostic.code.length === 0) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${itemPath}.code`, "expected a code");
    }
    if (
      diagnostic.severity !== "info" &&
      diagnostic.severity !== "warning" &&
      diagnostic.severity !== "error"
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidShape,
        `${itemPath}.severity`,
        "expected info, warning, or error"
      );
    }
    if (typeof diagnostic.message !== "string") {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidShape,
        `${itemPath}.message`,
        "expected a string"
      );
    }
    for (const name of ["offset", "objectNumber", "pageIndex"] as const) {
      const field = diagnostic[name];
      if (
        field !== undefined &&
        (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0)
      ) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidNumber,
          `${itemPath}.${name}`,
          "expected a nonnegative safe integer"
        );
      }
    }
    if (diagnostic.details !== undefined) {
      requireRecord(diagnostic.details, `${itemPath}.details`);
      for (const [name, field] of Object.entries(diagnostic.details)) {
        if (
          field !== null && typeof field !== "string" && typeof field !== "number" &&
          typeof field !== "boolean"
        ) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidShape,
            `${itemPath}.details.${name}`,
            "expected a string, number, boolean, or null"
          );
        }
        if (typeof field === "number" && !Number.isFinite(field)) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidNumber,
            `${itemPath}.details.${name}`,
            "expected a finite number"
          );
        }
      }
    }
  });
}

interface StoreCounts {
  transforms: number;
  paths: number;
  fillPaths: number;
  strokeSegments: number;
  strokeStyles: number;
  glyphs: number;
  fonts: number;
  images: number;
  meshes: number;
  functions: number;
  gradients: number;
  patterns: number;
  clips: number;
  colors: number;
  paints: number;
  optionalContent: number;
  markedContent: number;
}

function ensureStoreLimit(
  count: number,
  limits: HeprDataValidationLimits,
  path: string
): void {
  if (count > limits.maxResourcesPerStore) {
    fail(
      HEPR_DATA_VALIDATION_CODES.ResourceLimit,
      path,
      `${count} resources exceed limit ${limits.maxResourcesPerStore}`
    );
  }
}

function validateStores(
  stores: HeprPageStores,
  limits: HeprDataValidationLimits,
  path: string
): StoreCounts {
  requireRecord(stores, path);
  requireExactKeys(
    stores,
    [
      "transforms", "paths", "strokes", "glyphs", "fonts", "images", "meshes",
      "functions", "gradients", "patterns", "clips", "colors", "paints",
      "optionalContent", "markedContent"
    ],
    path
  );

  const transforms = stores.transforms;
  requireRecord(transforms, `${path}.transforms`);
  requireExactKeys(transforms, ["values"], `${path}.transforms`);
  requireTypedArray<Float32Array>(
    transforms.values,
    Float32Array,
    `${path}.transforms.values`
  );
  requireMultiple(transforms.values.length, 6, `${path}.transforms.values`);
  requireFiniteArray(transforms.values, `${path}.transforms.values`);
  const transformCount = transforms.values.length / 6;
  if (transformCount === 0) {
    fail(
      HEPR_DATA_VALIDATION_CODES.InvalidCardinality,
      `${path}.transforms.values`,
      "at least the identity transform is required"
    );
  }

  const paths = stores.paths;
  requireRecord(paths, `${path}.paths`);
  requireExactKeys(
    paths,
    [
      "pathVerbOffsets", "verbs", "verbCoordinateOffsets", "coordinates", "bounds",
      "flags", "fillPathMetaA", "fillPathMetaB", "fillPathMetaC", "fillSegmentsA",
      "fillSegmentsB"
    ],
    `${path}.paths`
  );
  requireTypedArray<Uint32Array>(paths.pathVerbOffsets, Uint32Array, `${path}.paths.pathVerbOffsets`);
  requireTypedArray<Uint8Array>(paths.verbs, Uint8Array, `${path}.paths.verbs`);
  requireTypedArray<Uint32Array>(
    paths.verbCoordinateOffsets,
    Uint32Array,
    `${path}.paths.verbCoordinateOffsets`
  );
  requireTypedArray<Float32Array>(paths.coordinates, Float32Array, `${path}.paths.coordinates`);
  requireTypedArray<Float32Array>(paths.bounds, Float32Array, `${path}.paths.bounds`);
  requireTypedArray<Uint8Array>(paths.flags, Uint8Array, `${path}.paths.flags`);
  const pathCount = Math.max(0, paths.pathVerbOffsets.length - 1);
  validateOffsets(paths.pathVerbOffsets, pathCount, paths.verbs.length, `${path}.paths.pathVerbOffsets`);
  validateOffsets(
    paths.verbCoordinateOffsets,
    paths.verbs.length,
    paths.coordinates.length,
    `${path}.paths.verbCoordinateOffsets`
  );
  requireLength(paths.bounds.length, pathCount * 4, `${path}.paths.bounds`);
  requireLength(paths.flags.length, pathCount, `${path}.paths.flags`);
  requireFiniteArray(paths.coordinates, `${path}.paths.coordinates`);
  requireFiniteArray(paths.bounds, `${path}.paths.bounds`);
  for (let index = 0; index < pathCount; index += 1) {
    const offset = index * 4;
    if (
      paths.bounds[offset + 2] < paths.bounds[offset] ||
      paths.bounds[offset + 3] < paths.bounds[offset + 1]
    ) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.paths.bounds[${offset}]`, "inverted path bounds");
    }
    if ((paths.flags[index] & ~(HEPR_PATH_FLAG.Closed | HEPR_PATH_FLAG.Rectangle)) !== 0) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.paths.flags[${index}]`, "unknown path flag");
    }
  }
  const verbCoordinateCounts = [2, 2, 4, 6, 0];
  for (let index = 0; index < paths.verbs.length; index += 1) {
    const verb = paths.verbs[index];
    if (verb > HEPR_PATH_VERB.Close) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.paths.verbs[${index}]`, "unknown verb");
    }
    const coordinateCount = paths.verbCoordinateOffsets[index + 1] - paths.verbCoordinateOffsets[index];
    if (coordinateCount !== verbCoordinateCounts[verb]) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidCardinality,
        `${path}.paths.verbCoordinateOffsets[${index}]`,
        `verb ${verb} requires ${verbCoordinateCounts[verb]} coordinates`
      );
    }
  }
  requireTypedArray<Float32Array>(paths.fillPathMetaA, Float32Array, `${path}.paths.fillPathMetaA`);
  requireTypedArray<Float32Array>(paths.fillPathMetaB, Float32Array, `${path}.paths.fillPathMetaB`);
  requireTypedArray<Float32Array>(paths.fillPathMetaC, Float32Array, `${path}.paths.fillPathMetaC`);
  requireTypedArray<Float32Array>(paths.fillSegmentsA, Float32Array, `${path}.paths.fillSegmentsA`);
  requireTypedArray<Float32Array>(paths.fillSegmentsB, Float32Array, `${path}.paths.fillSegmentsB`);
  requireMultiple(paths.fillPathMetaA.length, 4, `${path}.paths.fillPathMetaA`);
  requireLength(paths.fillPathMetaB.length, paths.fillPathMetaA.length, `${path}.paths.fillPathMetaB`);
  requireLength(paths.fillPathMetaC.length, paths.fillPathMetaA.length, `${path}.paths.fillPathMetaC`);
  requireMultiple(paths.fillSegmentsA.length, 4, `${path}.paths.fillSegmentsA`);
  requireLength(paths.fillSegmentsB.length, paths.fillSegmentsA.length, `${path}.paths.fillSegmentsB`);
  requireFiniteArray(paths.fillPathMetaA, `${path}.paths.fillPathMetaA`);
  requireFiniteArray(paths.fillPathMetaB, `${path}.paths.fillPathMetaB`);
  requireFiniteArray(paths.fillPathMetaC, `${path}.paths.fillPathMetaC`);
  requireFiniteArray(paths.fillSegmentsA, `${path}.paths.fillSegmentsA`);
  requireFiniteArray(paths.fillSegmentsB, `${path}.paths.fillSegmentsB`);
  const fillPathCount = paths.fillPathMetaA.length / 4;

  const strokes = stores.strokes;
  requireRecord(strokes, `${path}.strokes`);
  requireExactKeys(
    strokes,
    [
      "endpoints", "primitiveMeta", "primitiveBounds", "styles", "lineWidths",
      "miterLimits", "lineCaps", "lineJoins", "flags", "dashOffsets", "dashValues",
      "dashPhases"
    ],
    `${path}.strokes`
  );
  for (const [name, array] of [
    ["endpoints", strokes.endpoints],
    ["primitiveMeta", strokes.primitiveMeta],
    ["primitiveBounds", strokes.primitiveBounds],
    ["styles", strokes.styles]
  ] as const) {
    requireTypedArray<Float32Array>(array, Float32Array, `${path}.strokes.${name}`);
    requireMultiple(array.length, 4, `${path}.strokes.${name}`);
    requireFiniteArray(array, `${path}.strokes.${name}`);
  }
  requireLength(strokes.primitiveMeta.length, strokes.endpoints.length, `${path}.strokes.primitiveMeta`);
  requireLength(strokes.primitiveBounds.length, strokes.endpoints.length, `${path}.strokes.primitiveBounds`);
  requireLength(strokes.styles.length, strokes.endpoints.length, `${path}.strokes.styles`);
  const strokeSegmentCount = strokes.endpoints.length / 4;
  for (const [name, array, constructor] of [
    ["lineWidths", strokes.lineWidths, Float32Array],
    ["miterLimits", strokes.miterLimits, Float32Array],
    ["lineCaps", strokes.lineCaps, Uint8Array],
    ["lineJoins", strokes.lineJoins, Uint8Array],
    ["flags", strokes.flags, Uint8Array],
    ["dashPhases", strokes.dashPhases, Float32Array]
  ] as const) {
    requireTypedArray(array, constructor, `${path}.strokes.${name}`);
  }
  const strokeStyleCount = strokes.lineWidths.length;
  requireLength(strokes.miterLimits.length, strokeStyleCount, `${path}.strokes.miterLimits`);
  requireLength(strokes.lineCaps.length, strokeStyleCount, `${path}.strokes.lineCaps`);
  requireLength(strokes.lineJoins.length, strokeStyleCount, `${path}.strokes.lineJoins`);
  requireLength(strokes.flags.length, strokeStyleCount, `${path}.strokes.flags`);
  requireLength(strokes.dashPhases.length, strokeStyleCount, `${path}.strokes.dashPhases`);
  requireTypedArray<Uint32Array>(strokes.dashOffsets, Uint32Array, `${path}.strokes.dashOffsets`);
  requireTypedArray<Float32Array>(strokes.dashValues, Float32Array, `${path}.strokes.dashValues`);
  validateOffsets(strokes.dashOffsets, strokeStyleCount, strokes.dashValues.length, `${path}.strokes.dashOffsets`);
  requireFiniteArray(strokes.lineWidths, `${path}.strokes.lineWidths`);
  requireFiniteArray(strokes.miterLimits, `${path}.strokes.miterLimits`);
  requireFiniteArray(strokes.dashValues, `${path}.strokes.dashValues`);
  requireFiniteArray(strokes.dashPhases, `${path}.strokes.dashPhases`);
  for (let index = 0; index < strokeStyleCount; index += 1) {
    if (strokes.lineWidths[index] < 0) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.strokes.lineWidths[${index}]`, "negative line width");
    }
    if (strokes.miterLimits[index] < 1) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.strokes.miterLimits[${index}]`, "miter limit below one");
    }
    if (strokes.lineCaps[index] > 2 || strokes.lineJoins[index] > 2) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.strokes.lineCaps[${index}]`, "unknown cap or join");
    }
    if ((strokes.flags[index] & ~(HEPR_STROKE_FLAG.Hairline | HEPR_STROKE_FLAG.StrokeAdjust)) !== 0) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.strokes.flags[${index}]`, "unknown stroke flag");
    }
    const hairline = (strokes.flags[index] & HEPR_STROKE_FLAG.Hairline) !== 0;
    if (hairline !== (strokes.lineWidths[index] === 0)) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.strokes.flags[${index}]`, "hairline flag and width disagree");
    }
    const dashStart = strokes.dashOffsets[index];
    const dashEnd = strokes.dashOffsets[index + 1];
    let dashTotal = 0;
    for (let dashIndex = dashStart; dashIndex < dashEnd; dashIndex += 1) {
      if (strokes.dashValues[dashIndex] < 0) {
        fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.strokes.dashValues[${dashIndex}]`, "negative dash length");
      }
      dashTotal += strokes.dashValues[dashIndex];
    }
    if (dashEnd > dashStart && dashTotal === 0) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.strokes.dashOffsets[${index}]`, "all-zero dash array");
    }
  }

  const glyphs = stores.glyphs;
  requireRecord(glyphs, `${path}.glyphs`);
  requireExactKeys(
    glyphs,
    ["fontIndices", "characterCodes", "glyphIds", "transformIndices", "advances", "flags"],
    `${path}.glyphs`
  );
  requireTypedArray<Uint32Array>(glyphs.fontIndices, Uint32Array, `${path}.glyphs.fontIndices`);
  const glyphCount = glyphs.fontIndices.length;
  for (const [name, array, constructor, multiplier] of [
    ["characterCodes", glyphs.characterCodes, Uint32Array, 1],
    ["glyphIds", glyphs.glyphIds, Uint32Array, 1],
    ["transformIndices", glyphs.transformIndices, Uint32Array, 1],
    ["advances", glyphs.advances, Float32Array, 2],
    ["flags", glyphs.flags, Uint8Array, 1]
  ] as const) {
    requireTypedArray(array, constructor, `${path}.glyphs.${name}`);
    requireLength(array.length, glyphCount * multiplier, `${path}.glyphs.${name}`);
  }
  requireFiniteArray(glyphs.advances, `${path}.glyphs.advances`);

  const fonts = stores.fonts;
  requireRecord(fonts, `${path}.fonts`);
  requireExactKeys(
    fonts,
    [
      "names", "kinds", "unitsPerEm", "ascents", "descents", "glyphOffsets",
      "glyphIds", "outlinePathStarts", "outlinePathCounts", "type3ProgramIndices"
    ],
    `${path}.fonts`
  );
  if (!Array.isArray(fonts.names) || fonts.names.some((name) => typeof name !== "string")) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${path}.fonts.names`, "expected strings");
  }
  requireTypedArray<Uint8Array>(fonts.kinds, Uint8Array, `${path}.fonts.kinds`);
  const fontCount = fonts.names.length;
  for (const [name, array, constructor] of [
    ["kinds", fonts.kinds, Uint8Array],
    ["unitsPerEm", fonts.unitsPerEm, Uint32Array],
    ["ascents", fonts.ascents, Float32Array],
    ["descents", fonts.descents, Float32Array]
  ] as const) {
    requireTypedArray(array, constructor, `${path}.fonts.${name}`);
    requireLength(array.length, fontCount, `${path}.fonts.${name}`);
  }
  requireTypedArray<Uint32Array>(fonts.glyphOffsets, Uint32Array, `${path}.fonts.glyphOffsets`);
  requireTypedArray<Uint32Array>(fonts.glyphIds, Uint32Array, `${path}.fonts.glyphIds`);
  validateOffsets(fonts.glyphOffsets, fontCount, fonts.glyphIds.length, `${path}.fonts.glyphOffsets`);
  for (const [name, array, constructor] of [
    ["outlinePathStarts", fonts.outlinePathStarts, Uint32Array],
    ["outlinePathCounts", fonts.outlinePathCounts, Uint32Array],
    ["type3ProgramIndices", fonts.type3ProgramIndices, Int32Array]
  ] as const) {
    requireTypedArray(array, constructor, `${path}.fonts.${name}`);
    requireLength(array.length, fonts.glyphIds.length, `${path}.fonts.${name}`);
  }
  requireFiniteArray(fonts.ascents, `${path}.fonts.ascents`);
  requireFiniteArray(fonts.descents, `${path}.fonts.descents`);
  for (let fontIndex = 0; fontIndex < fontCount; fontIndex += 1) {
    if (fonts.kinds[fontIndex] > HEPR_FONT_KIND.Type3) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.fonts.kinds[${fontIndex}]`,
        "unknown font kind"
      );
    }
    if (fonts.unitsPerEm[fontIndex] === 0) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.fonts.unitsPerEm[${fontIndex}]`,
        "font units-per-em must be positive"
      );
    }
  }
  for (let index = 0; index < glyphCount; index += 1) {
    const fontIndex = glyphs.fontIndices[index];
    validateRequiredIndex(fontIndex, fontCount, `${path}.glyphs.fontIndices[${index}]`);
    validateRequiredIndex(
      glyphs.transformIndices[index],
      transformCount,
      `${path}.glyphs.transformIndices[${index}]`
    );
    const knownGlyphFlags = HEPR_GLYPH_FLAG.Invisible | HEPR_GLYPH_FLAG.ClipOnly |
      HEPR_GLYPH_FLAG.Vertical | HEPR_GLYPH_FLAG.Type3;
    if ((glyphs.flags[index] & ~knownGlyphFlags) !== 0) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.glyphs.flags[${index}]`,
        "unknown glyph flag"
      );
    }
    const type3Flag = (glyphs.flags[index] & HEPR_GLYPH_FLAG.Type3) !== 0;
    if (type3Flag !== (fonts.kinds[fontIndex] === HEPR_FONT_KIND.Type3)) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.glyphs.flags[${index}]`,
        "Type3 glyph flag and font kind disagree"
      );
    }
    const first = fonts.glyphOffsets[fontIndex];
    const end = fonts.glyphOffsets[fontIndex + 1];
    const glyphId = glyphs.glyphIds[index];
    let low = first;
    let high = end;
    while (low < high) {
      const middle = low + ((high - low) >> 1);
      if (fonts.glyphIds[middle] < glyphId) low = middle + 1;
      else high = middle;
    }
    if (low >= end || fonts.glyphIds[low] !== glyphId) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.glyphs.glyphIds[${index}]`,
        "glyph instance has no self-contained font record"
      );
    }
    const invisible = (glyphs.flags[index] & HEPR_GLYPH_FLAG.Invisible) !== 0;
    if (type3Flag && !invisible && fonts.type3ProgramIndices[low] < 0) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.fonts.type3ProgramIndices[${low}]`,
        "visible Type3 glyph has no self-contained CharProc program"
      );
    }
  }
  for (let index = 0; index < fonts.glyphIds.length; index += 1) {
    const first = fonts.outlinePathStarts[index];
    const count = fonts.outlinePathCounts[index];
    if (first + count > pathCount) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.fonts.outlinePathStarts[${index}]`,
        "outline path span exceeds the path store"
      );
    }
  }
  for (let fontIndex = 0; fontIndex < fontCount; fontIndex += 1) {
    const first = fonts.glyphOffsets[fontIndex];
    const end = fonts.glyphOffsets[fontIndex + 1];
    const type3 = fonts.kinds[fontIndex] === HEPR_FONT_KIND.Type3;
    for (let index = first + 1; index < end; index += 1) {
      if (fonts.glyphIds[index - 1] >= fonts.glyphIds[index]) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidNumber,
          `${path}.fonts.glyphIds[${index}]`,
          "font glyph identifiers must be strictly increasing"
        );
      }
    }
    for (let index = first; index < end; index += 1) {
      if (!type3 && fonts.type3ProgramIndices[index] >= 0) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.fonts.type3ProgramIndices[${index}]`,
          "ordinary outline glyph references a Type3 program"
        );
      }
      if (type3 && fonts.outlinePathCounts[index] !== 0) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.fonts.outlinePathCounts[${index}]`,
          "Type3 glyph paint must be retained as a reusable program"
        );
      }
    }
  }

  const images = stores.images;
  requireRecord(images, `${path}.images`);
  requireExactKeys(
    images,
    [
      "widths", "heights", "bitsPerComponent", "formats", "colorSpaceIndices",
      "interpolate", "imageMask", "softMaskImageIndices", "colorKeyMaskOffsets",
      "colorKeyMaskValues", "decodeOffsets", "decodeValues", "matteOffsets",
      "matteValues", "dataOffsets", "data"
    ],
    `${path}.images`
  );
  requireTypedArray<Uint32Array>(images.widths, Uint32Array, `${path}.images.widths`);
  const imageCount = images.widths.length;
  for (const [name, array, constructor] of [
    ["heights", images.heights, Uint32Array],
    ["bitsPerComponent", images.bitsPerComponent, Uint8Array],
    ["formats", images.formats, Uint8Array],
    ["colorSpaceIndices", images.colorSpaceIndices, Int32Array],
    ["interpolate", images.interpolate, Uint8Array],
    ["imageMask", images.imageMask, Uint8Array],
    ["softMaskImageIndices", images.softMaskImageIndices, Int32Array]
  ] as const) {
    requireTypedArray(array, constructor, `${path}.images.${name}`);
    requireLength(array.length, imageCount, `${path}.images.${name}`);
  }
  requireTypedArray<Uint32Array>(images.colorKeyMaskOffsets, Uint32Array, `${path}.images.colorKeyMaskOffsets`);
  requireTypedArray<Int32Array>(images.colorKeyMaskValues, Int32Array, `${path}.images.colorKeyMaskValues`);
  requireTypedArray<Uint32Array>(images.decodeOffsets, Uint32Array, `${path}.images.decodeOffsets`);
  requireTypedArray<Float32Array>(images.decodeValues, Float32Array, `${path}.images.decodeValues`);
  requireTypedArray<Uint32Array>(images.matteOffsets, Uint32Array, `${path}.images.matteOffsets`);
  requireTypedArray<Float32Array>(images.matteValues, Float32Array, `${path}.images.matteValues`);
  requireTypedArray<Uint32Array>(images.dataOffsets, Uint32Array, `${path}.images.dataOffsets`);
  requireTypedArray<Uint8Array>(images.data, Uint8Array, `${path}.images.data`);
  validateOffsets(images.colorKeyMaskOffsets, imageCount, images.colorKeyMaskValues.length, `${path}.images.colorKeyMaskOffsets`);
  validateOffsets(images.decodeOffsets, imageCount, images.decodeValues.length, `${path}.images.decodeOffsets`);
  validateOffsets(images.matteOffsets, imageCount, images.matteValues.length, `${path}.images.matteOffsets`);
  validateOffsets(images.dataOffsets, imageCount, images.data.length, `${path}.images.dataOffsets`);
  requireFiniteArray(images.decodeValues, `${path}.images.decodeValues`);
  requireFiniteArray(images.matteValues, `${path}.images.matteValues`);
  for (let index = 0; index < imageCount; index += 1) {
    if (images.widths[index] === 0 || images.heights[index] === 0) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.images[${index}]`, "dimensions must be positive");
    }
    if (images.formats[index] > HEPR_IMAGE_FORMAT.Ccitt) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.images.formats[${index}]`, "unknown format");
    }
    const bitsPerComponent = images.bitsPerComponent[index];
    if (
      ![1, 2, 4, 8, 16].includes(bitsPerComponent) &&
      !(bitsPerComponent === 0 && images.formats[index] === HEPR_IMAGE_FORMAT.Jpeg2000)
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.images.bitsPerComponent[${index}]`,
        "unsupported image component precision"
      );
    }
    if (images.interpolate[index] > 1 || images.imageMask[index] > 1) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.images[${index}]`,
        "image flags must be zero or one"
      );
    }
    validateOptionalIndex(images.softMaskImageIndices[index], imageCount, `${path}.images.softMaskImageIndices[${index}]`);
    const storedBytes = images.dataOffsets[index + 1] - images.dataOffsets[index];
    const bytesPerPixel = images.formats[index] === HEPR_IMAGE_FORMAT.Gray8
      ? 1
      : images.formats[index] === HEPR_IMAGE_FORMAT.GrayAlpha8
        ? 2
        : images.formats[index] === HEPR_IMAGE_FORMAT.Rgba8
          ? 4
          : images.formats[index] === HEPR_IMAGE_FORMAT.Rgba16
            ? 8
            : 0;
    if (bytesPerPixel !== 0) {
      const expectedBytes = images.widths[index] * images.heights[index] * bytesPerPixel;
      if (!Number.isSafeInteger(expectedBytes) || storedBytes !== expectedBytes) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidCardinality,
          `${path}.images.dataOffsets[${index}]`,
          `raw image payload must contain exactly ${expectedBytes} bytes`
        );
      }
    } else if (storedBytes === 0) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidCardinality,
        `${path}.images.dataOffsets[${index}]`,
        "encoded image payload must not be empty"
      );
    }
  }
  validateParentForest(images.softMaskImageIndices, `${path}.images.softMaskImageIndices`);

  const meshes = stores.meshes;
  requireRecord(meshes, `${path}.meshes`);
  requireExactKeys(
    meshes,
    [
      "kinds", "vertexOffsets", "indexOffsets", "positions", "colors", "indices",
      "colorSpaceIndices"
    ],
    `${path}.meshes`
  );
  requireTypedArray<Uint8Array>(meshes.kinds, Uint8Array, `${path}.meshes.kinds`);
  const meshCount = meshes.kinds.length;
  requireTypedArray<Uint32Array>(meshes.vertexOffsets, Uint32Array, `${path}.meshes.vertexOffsets`);
  requireTypedArray<Uint32Array>(meshes.indexOffsets, Uint32Array, `${path}.meshes.indexOffsets`);
  requireTypedArray<Float32Array>(meshes.positions, Float32Array, `${path}.meshes.positions`);
  requireTypedArray<Float32Array>(meshes.colors, Float32Array, `${path}.meshes.colors`);
  requireTypedArray<Uint32Array>(meshes.indices, Uint32Array, `${path}.meshes.indices`);
  requireTypedArray<Int32Array>(meshes.colorSpaceIndices, Int32Array, `${path}.meshes.colorSpaceIndices`);
  requireMultiple(meshes.positions.length, 2, `${path}.meshes.positions`);
  const vertexCount = meshes.positions.length / 2;
  requireLength(meshes.colors.length, vertexCount * 4, `${path}.meshes.colors`);
  validateOffsets(meshes.vertexOffsets, meshCount, vertexCount, `${path}.meshes.vertexOffsets`);
  validateOffsets(meshes.indexOffsets, meshCount, meshes.indices.length, `${path}.meshes.indexOffsets`);
  requireLength(meshes.colorSpaceIndices.length, meshCount, `${path}.meshes.colorSpaceIndices`);
  requireFiniteArray(meshes.positions, `${path}.meshes.positions`);
  requireFiniteArray(meshes.colors, `${path}.meshes.colors`);
  for (let meshIndex = 0; meshIndex < meshCount; meshIndex += 1) {
    const kind = meshes.kinds[meshIndex];
    const vertexStart: number = meshes.vertexOffsets[meshIndex];
    const vertexEnd: number = meshes.vertexOffsets[meshIndex + 1];
    const indexStart: number = meshes.indexOffsets[meshIndex];
    const indexEnd: number = meshes.indexOffsets[meshIndex + 1];
    const meshVertexCount = vertexEnd - vertexStart;
    const meshIndexCount = indexEnd - indexStart;
    for (let index = indexStart; index < indexEnd; index += 1) {
      if (meshes.indices[index] < vertexStart || meshes.indices[index] >= vertexEnd) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.meshes.indices[${index}]`,
          "vertex index is outside its mesh"
        );
      }
    }
    if (kind === HEPR_MESH_KIND.Triangles) {
      requireMultiple(meshIndexCount, 3, `${path}.meshes.indices[${meshIndex}]`);
      continue;
    }
    const controlsPerPatch = kind === HEPR_MESH_KIND.CoonsPatch
      ? 12
      : kind === HEPR_MESH_KIND.TensorPatch
        ? 16
        : 0;
    if (controlsPerPatch === 0) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.meshes.kinds[${meshIndex}]`,
        "unknown mesh kind"
      );
    }
    if (meshVertexCount === 0) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidCardinality,
        `${path}.meshes.vertexOffsets[${meshIndex}]`,
        "a patch mesh must contain at least one complete patch"
      );
    }
    requireMultiple(
      meshVertexCount,
      controlsPerPatch,
      `${path}.meshes.vertexOffsets[${meshIndex}]`
    );
    requireLength(
      meshIndexCount,
      meshVertexCount,
      `${path}.meshes.indexOffsets[${meshIndex}]`
    );
    for (let localIndex = 0; localIndex < meshIndexCount; localIndex += 1) {
      const index = indexStart + localIndex;
      if (meshes.indices[index] !== vertexStart + localIndex) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.meshes.indices[${index}]`,
          "patch controls must retain source order"
        );
      }
      const controlIndex = localIndex % controlsPerPatch;
      if (controlIndex === 0 || controlIndex === 3 || controlIndex === 6 || controlIndex === 9) {
        continue;
      }
      const colorOffset = (vertexStart + localIndex) * 4;
      if (
        meshes.colors[colorOffset] !== 0 ||
        meshes.colors[colorOffset + 1] !== 0 ||
        meshes.colors[colorOffset + 2] !== 0 ||
        meshes.colors[colorOffset + 3] !== 0
      ) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidNumber,
          `${path}.meshes.colors[${colorOffset}]`,
          "non-corner patch controls must have zero color payloads"
        );
      }
    }
  }

  const functions = stores.functions;
  requireRecord(functions, `${path}.functions`);
  requireExactKeys(
    functions,
    [
      "kinds", "domainOffsets", "domains", "rangeOffsets", "ranges",
      "parameterOffsets", "parameters", "sampleOffsets", "samples",
      "calculatorOffsets", "calculatorBytecode"
    ],
    `${path}.functions`
  );
  requireTypedArray<Uint8Array>(functions.kinds, Uint8Array, `${path}.functions.kinds`);
  const functionCount = functions.kinds.length;
  for (const [offsetName, payloadName, payload, constructor] of [
    ["domainOffsets", "domains", functions.domains, Float32Array],
    ["rangeOffsets", "ranges", functions.ranges, Float32Array],
    ["parameterOffsets", "parameters", functions.parameters, Float32Array],
    ["sampleOffsets", "samples", functions.samples, Float32Array],
    ["calculatorOffsets", "calculatorBytecode", functions.calculatorBytecode, Uint8Array]
  ] as const) {
    const offsets: Uint32Array = functions[offsetName];
    requireTypedArray<Uint32Array>(offsets, Uint32Array, `${path}.functions.${offsetName}`);
    requireTypedArray(payload, constructor, `${path}.functions.${payloadName}`);
    validateOffsets(offsets, functionCount, payload.length, `${path}.functions.${offsetName}`);
    if (payload instanceof Float32Array) requireFiniteArray(payload, `${path}.functions.${payloadName}`);
  }
  for (let index = 0; index < functionCount; index += 1) {
    const kind = functions.kinds[index];
    if (
      kind !== HEPR_FUNCTION_KIND.Sampled && kind !== HEPR_FUNCTION_KIND.Exponential &&
      kind !== HEPR_FUNCTION_KIND.Stitching && kind !== HEPR_FUNCTION_KIND.Calculator
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.functions.kinds[${index}]`,
        "unknown PDF function kind"
      );
    }
  }

  const gradients = stores.gradients;
  requireRecord(gradients, `${path}.gradients`);
  requireExactKeys(
    gradients,
    [
      "kinds", "colorSpaceIndices", "functionIndices", "coordinateOffsets",
      "coordinates", "stopOffsets", "stopPositions", "stopPaintIndices", "meshIndices",
      "extendFlags"
    ],
    `${path}.gradients`
  );
  requireTypedArray<Uint8Array>(gradients.kinds, Uint8Array, `${path}.gradients.kinds`);
  const gradientCount = gradients.kinds.length;
  for (const [name, array, constructor] of [
    ["colorSpaceIndices", gradients.colorSpaceIndices, Int32Array],
    ["functionIndices", gradients.functionIndices, Int32Array],
    ["meshIndices", gradients.meshIndices, Int32Array],
    ["extendFlags", gradients.extendFlags, Uint8Array]
  ] as const) {
    requireTypedArray(array, constructor, `${path}.gradients.${name}`);
    requireLength(array.length, gradientCount, `${path}.gradients.${name}`);
  }
  requireTypedArray<Uint32Array>(gradients.coordinateOffsets, Uint32Array, `${path}.gradients.coordinateOffsets`);
  requireTypedArray<Float32Array>(gradients.coordinates, Float32Array, `${path}.gradients.coordinates`);
  requireTypedArray<Uint32Array>(gradients.stopOffsets, Uint32Array, `${path}.gradients.stopOffsets`);
  requireTypedArray<Float32Array>(gradients.stopPositions, Float32Array, `${path}.gradients.stopPositions`);
  requireTypedArray<Uint32Array>(gradients.stopPaintIndices, Uint32Array, `${path}.gradients.stopPaintIndices`);
  validateOffsets(gradients.coordinateOffsets, gradientCount, gradients.coordinates.length, `${path}.gradients.coordinateOffsets`);
  validateOffsets(gradients.stopOffsets, gradientCount, gradients.stopPositions.length, `${path}.gradients.stopOffsets`);
  requireLength(gradients.stopPaintIndices.length, gradients.stopPositions.length, `${path}.gradients.stopPaintIndices`);
  requireFiniteArray(gradients.coordinates, `${path}.gradients.coordinates`);
  requireFiniteArray(gradients.stopPositions, `${path}.gradients.stopPositions`);

  const patterns = stores.patterns;
  requireRecord(patterns, `${path}.patterns`);
  requireExactKeys(
    patterns,
    [
      "kinds", "paintTypes", "tilingTypes", "bounds", "xSteps", "ySteps",
      "matrixIndices", "programIndices", "gradientIndices", "underlyingColorSpaceIndices"
    ],
    `${path}.patterns`
  );
  requireTypedArray<Uint8Array>(patterns.kinds, Uint8Array, `${path}.patterns.kinds`);
  const patternCount = patterns.kinds.length;
  for (const [name, array, constructor, multiplier] of [
    ["paintTypes", patterns.paintTypes, Uint8Array, 1],
    ["tilingTypes", patterns.tilingTypes, Uint8Array, 1],
    ["bounds", patterns.bounds, Float32Array, 4],
    ["xSteps", patterns.xSteps, Float32Array, 1],
    ["ySteps", patterns.ySteps, Float32Array, 1],
    ["matrixIndices", patterns.matrixIndices, Uint32Array, 1],
    ["programIndices", patterns.programIndices, Int32Array, 1],
    ["gradientIndices", patterns.gradientIndices, Int32Array, 1],
    ["underlyingColorSpaceIndices", patterns.underlyingColorSpaceIndices, Int32Array, 1]
  ] as const) {
    requireTypedArray(array, constructor, `${path}.patterns.${name}`);
    requireLength(array.length, patternCount * multiplier, `${path}.patterns.${name}`);
  }
  requireFiniteArray(patterns.bounds, `${path}.patterns.bounds`);
  requireFiniteArray(patterns.xSteps, `${path}.patterns.xSteps`);
  requireFiniteArray(patterns.ySteps, `${path}.patterns.ySteps`);
  for (let index = 0; index < patternCount; index += 1) {
    validateRequiredIndex(patterns.matrixIndices[index], transformCount, `${path}.patterns.matrixIndices[${index}]`);
    const kind = patterns.kinds[index];
    if (
      kind !== HEPR_PATTERN_KIND.ColoredTiling &&
      kind !== HEPR_PATTERN_KIND.UncoloredTiling &&
      kind !== HEPR_PATTERN_KIND.Shading
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.patterns.kinds[${index}]`,
        "unknown pattern kind"
      );
    }
    if (
      (kind === HEPR_PATTERN_KIND.ColoredTiling && patterns.paintTypes[index] !== 1) ||
      (kind === HEPR_PATTERN_KIND.UncoloredTiling && patterns.paintTypes[index] !== 2)
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.patterns.paintTypes[${index}]`,
        "tiling-pattern kind and PaintType disagree"
      );
    }
  }

  const clips = stores.clips;
  requireRecord(clips, `${path}.clips`);
  requireExactKeys(
    clips,
    [
      "parentIndices", "firstPaths", "pathCounts", "firstGlyphs", "glyphCounts",
      "fillRules", "transformIndices"
    ],
    `${path}.clips`
  );
  requireTypedArray<Int32Array>(clips.parentIndices, Int32Array, `${path}.clips.parentIndices`);
  const clipCount = clips.parentIndices.length;
  for (const [name, array, constructor] of [
    ["firstPaths", clips.firstPaths, Uint32Array],
    ["pathCounts", clips.pathCounts, Uint32Array],
    ["firstGlyphs", clips.firstGlyphs, Uint32Array],
    ["glyphCounts", clips.glyphCounts, Uint32Array],
    ["fillRules", clips.fillRules, Uint8Array],
    ["transformIndices", clips.transformIndices, Uint32Array]
  ] as const) {
    requireTypedArray(array, constructor, `${path}.clips.${name}`);
    requireLength(array.length, clipCount, `${path}.clips.${name}`);
  }
  const clippingGlyphCoverage = new Uint8Array(glyphCount);
  for (let index = 0; index < clipCount; index += 1) {
    validateOptionalIndex(clips.parentIndices[index], clipCount, `${path}.clips.parentIndices[${index}]`);
    if (clips.parentIndices[index] >= index) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidReference, `${path}.clips.parentIndices[${index}]`, "persistent clip parent must precede its child");
    }
    if (clips.firstPaths[index] + clips.pathCounts[index] > pathCount) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidReference, `${path}.clips.firstPaths[${index}]`, "path span is out of range");
    }
    if (clips.firstGlyphs[index] + clips.glyphCounts[index] > glyphCount) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidReference, `${path}.clips.firstGlyphs[${index}]`, "glyph span is out of range");
    }
    const hasPaths = clips.pathCounts[index] > 0;
    const hasGlyphs = clips.glyphCounts[index] > 0;
    if (hasPaths && hasGlyphs) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.clips.pathCounts[${index}]`,
        "clip node cannot mix path and glyph unions"
      );
    }
    if (hasGlyphs && clips.fillRules[index] !== 0) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.clips.fillRules[${index}]`,
        "glyph clipping unions use the nonzero fill rule"
      );
    }
    if (hasGlyphs) {
      const firstGlyph = clips.firstGlyphs[index];
      const endGlyph = firstGlyph + clips.glyphCounts[index];
      for (let glyphIndex = firstGlyph; glyphIndex < endGlyph; glyphIndex += 1) {
        const flags = glyphs.flags[glyphIndex];
        if ((flags & HEPR_GLYPH_FLAG.ClipOnly) === 0) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidReference,
            `${path}.clips.firstGlyphs[${index}]`,
            "text clip references a glyph without the clipping flag"
          );
        }
        if ((flags & HEPR_GLYPH_FLAG.Type3) !== 0) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidReference,
            `${path}.clips.firstGlyphs[${index}]`,
            "Type3 glyph clipping has no exact outline contract"
          );
        }
        if (clippingGlyphCoverage[glyphIndex] !== 0) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidReference,
            `${path}.clips.firstGlyphs[${index}]`,
            "clipping glyph is referenced by more than one text clip"
          );
        }
        clippingGlyphCoverage[glyphIndex] = 1;
        const fontIndex = glyphs.fontIndices[glyphIndex];
        const glyphId = glyphs.glyphIds[glyphIndex];
        const firstFontGlyph = fonts.glyphOffsets[fontIndex];
        const endFontGlyph = fonts.glyphOffsets[fontIndex + 1];
        let low = firstFontGlyph;
        let high = endFontGlyph;
        while (low < high) {
          const middle = low + ((high - low) >> 1);
          if (fonts.glyphIds[middle] < glyphId) low = middle + 1;
          else high = middle;
        }
        if (low >= endFontGlyph || fonts.glyphIds[low] !== glyphId) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidReference,
            `${path}.clips.firstGlyphs[${index}]`,
            "clipping glyph has no font-outline record"
          );
        }
      }
    }
    validateRequiredIndex(clips.transformIndices[index], transformCount, `${path}.clips.transformIndices[${index}]`);
    if (clips.fillRules[index] > 1) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.clips.fillRules[${index}]`, "unknown fill rule");
    }
  }
  for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
    const clipping = (glyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.ClipOnly) !== 0;
    if (clipping !== (clippingGlyphCoverage[glyphIndex] !== 0)) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.glyphs.flags[${glyphIndex}]`,
        "clipping glyph must belong to exactly one persistent text clip"
      );
    }
  }
  validateParentForest(clips.parentIndices, `${path}.clips.parentIndices`);

  const colors = stores.colors;
  requireRecord(colors, `${path}.colors`);
  requireExactKeys(
    colors,
    [
      "spaceKinds", "componentCounts", "alternateSpaceIndices", "functionIndices",
      "parameterOffsets", "parameters", "nameOffsets", "names", "profileOffsets",
      "profiles", "lookupOffsets", "lookupBytes"
    ],
    `${path}.colors`
  );
  requireTypedArray<Uint8Array>(colors.spaceKinds, Uint8Array, `${path}.colors.spaceKinds`);
  const colorCount = colors.spaceKinds.length;
  for (const [name, array, constructor] of [
    ["componentCounts", colors.componentCounts, Uint8Array],
    ["alternateSpaceIndices", colors.alternateSpaceIndices, Int32Array],
    ["functionIndices", colors.functionIndices, Int32Array]
  ] as const) {
    requireTypedArray(array, constructor, `${path}.colors.${name}`);
    requireLength(array.length, colorCount, `${path}.colors.${name}`);
  }
  if (!Array.isArray(colors.names) || colors.names.some((name) => typeof name !== "string")) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${path}.colors.names`, "expected strings");
  }
  for (const [offsetName, payloadName, payload, constructor] of [
    ["parameterOffsets", "parameters", colors.parameters, Float32Array],
    ["profileOffsets", "profiles", colors.profiles, Uint8Array],
    ["lookupOffsets", "lookupBytes", colors.lookupBytes, Uint8Array]
  ] as const) {
    const offsets: Uint32Array = colors[offsetName];
    requireTypedArray<Uint32Array>(offsets, Uint32Array, `${path}.colors.${offsetName}`);
    requireTypedArray(payload, constructor, `${path}.colors.${payloadName}`);
    validateOffsets(offsets, colorCount, payload.length, `${path}.colors.${offsetName}`);
  }
  requireTypedArray<Uint32Array>(colors.nameOffsets, Uint32Array, `${path}.colors.nameOffsets`);
  validateOffsets(colors.nameOffsets, colorCount, colors.names.length, `${path}.colors.nameOffsets`);
  requireFiniteArray(colors.parameters, `${path}.colors.parameters`);

  const paints = stores.paints;
  requireRecord(paints, `${path}.paints`);
  requireExactKeys(
    paints,
    [
      "kinds", "resourceIndices", "alphas", "overprint", "overprintModes",
      "patternTransformIndices", "patternBasePaintIndices"
    ],
    `${path}.paints`
  );
  requireTypedArray<Uint8Array>(paints.kinds, Uint8Array, `${path}.paints.kinds`);
  const paintCount = paints.kinds.length;
  for (const [name, array, constructor] of [
    ["resourceIndices", paints.resourceIndices, Uint32Array],
    ["alphas", paints.alphas, Float32Array],
    ["overprint", paints.overprint, Uint8Array],
    ["overprintModes", paints.overprintModes, Uint8Array],
    ["patternTransformIndices", paints.patternTransformIndices, Int32Array],
    ["patternBasePaintIndices", paints.patternBasePaintIndices, Int32Array]
  ] as const) {
    requireTypedArray(array, constructor, `${path}.paints.${name}`);
    requireLength(array.length, paintCount, `${path}.paints.${name}`);
  }
  requireFiniteArray(paints.alphas, `${path}.paints.alphas`);

  const optionalContent = stores.optionalContent;
  requireRecord(optionalContent, `${path}.optionalContent`);
  requireExactKeys(optionalContent, ["names", "defaultVisible"], `${path}.optionalContent`);
  if (
    !Array.isArray(optionalContent.names) ||
    optionalContent.names.some((name) => typeof name !== "string")
  ) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${path}.optionalContent.names`, "expected strings");
  }
  requireTypedArray<Uint8Array>(
    optionalContent.defaultVisible,
    Uint8Array,
    `${path}.optionalContent.defaultVisible`
  );
  const optionalContentCount = optionalContent.names.length;
  requireLength(
    optionalContent.defaultVisible.length,
    optionalContentCount,
    `${path}.optionalContent.defaultVisible`
  );
  for (let index = 0; index < optionalContentCount; index += 1) {
    if (optionalContent.defaultVisible[index] > 1) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.optionalContent.defaultVisible[${index}]`,
        "expected zero or one"
      );
    }
  }

  const markedContent = stores.markedContent;
  requireRecord(markedContent, `${path}.markedContent`);
  requireExactKeys(
    markedContent,
    ["tags", "propertyNames", "mcids", "parentIndices"],
    `${path}.markedContent`
  );
  if (!Array.isArray(markedContent.tags) || markedContent.tags.some((tag) => typeof tag !== "string")) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${path}.markedContent.tags`, "expected strings");
  }
  const markedContentCount = markedContent.tags.length;
  if (
    !Array.isArray(markedContent.propertyNames) ||
    markedContent.propertyNames.some((name) => name !== null && typeof name !== "string")
  ) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${path}.markedContent.propertyNames`, "expected strings or null");
  }
  requireLength(markedContent.propertyNames.length, markedContentCount, `${path}.markedContent.propertyNames`);
  requireTypedArray<Int32Array>(markedContent.mcids, Int32Array, `${path}.markedContent.mcids`);
  requireTypedArray<Int32Array>(markedContent.parentIndices, Int32Array, `${path}.markedContent.parentIndices`);
  requireLength(markedContent.mcids.length, markedContentCount, `${path}.markedContent.mcids`);
  requireLength(markedContent.parentIndices.length, markedContentCount, `${path}.markedContent.parentIndices`);
  for (let index = 0; index < markedContentCount; index += 1) {
    validateOptionalIndex(markedContent.parentIndices[index], markedContentCount, `${path}.markedContent.parentIndices[${index}]`);
  }
  validateParentForest(markedContent.parentIndices, `${path}.markedContent.parentIndices`);

  const counts: StoreCounts = {
    transforms: transformCount,
    paths: pathCount,
    fillPaths: fillPathCount,
    strokeSegments: strokeSegmentCount,
    strokeStyles: strokeStyleCount,
    glyphs: glyphCount,
    fonts: fontCount,
    images: imageCount,
    meshes: meshCount,
    functions: functionCount,
    gradients: gradientCount,
    patterns: patternCount,
    clips: clipCount,
    colors: colorCount,
    paints: paintCount,
    optionalContent: optionalContentCount,
    markedContent: markedContentCount
  };
  for (const [name, count] of Object.entries(counts)) {
    ensureStoreLimit(count, limits, `${path}.${name}`);
  }

  for (let index = 0; index < colorCount; index += 1) {
    const kind = colors.spaceKinds[index];
    if (kind > HEPR_COLOR_SPACE_KIND.DeviceN || colors.componentCounts[index] === 0) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.colors.spaceKinds[${index}]`,
        "unknown or zero-component color space"
      );
    }
    const fixedComponents = kind === HEPR_COLOR_SPACE_KIND.DeviceGray ||
        kind === HEPR_COLOR_SPACE_KIND.CalGray || kind === HEPR_COLOR_SPACE_KIND.Indexed ||
        kind === HEPR_COLOR_SPACE_KIND.Separation
      ? 1
      : kind === HEPR_COLOR_SPACE_KIND.DeviceRgb || kind === HEPR_COLOR_SPACE_KIND.CalRgb ||
          kind === HEPR_COLOR_SPACE_KIND.Lab
        ? 3
        : kind === HEPR_COLOR_SPACE_KIND.DeviceCmyk
          ? 4
          : 0;
    if (fixedComponents !== 0 && colors.componentCounts[index] !== fixedComponents) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidCardinality,
        `${path}.colors.componentCounts[${index}]`,
        `color space requires ${fixedComponents} components`
      );
    }
    validateOptionalIndex(colors.alternateSpaceIndices[index], colorCount, `${path}.colors.alternateSpaceIndices[${index}]`);
    validateOptionalIndex(colors.functionIndices[index], functionCount, `${path}.colors.functionIndices[${index}]`);
  }
  validateParentForest(colors.alternateSpaceIndices, `${path}.colors.alternateSpaceIndices`);
  for (let index = 0; index < imageCount; index += 1) {
    validateOptionalIndex(
      images.colorSpaceIndices[index],
      colorCount,
      `${path}.images.colorSpaceIndices[${index}]`
    );
    if (images.imageMask[index] !== 0) {
      if (
        images.colorSpaceIndices[index] >= 0 ||
        images.formats[index] !== HEPR_IMAGE_FORMAT.Gray8
      ) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.images[${index}]`,
          "stencil image must use self-contained Gray8 coverage without a color space"
        );
      }
    } else if (
      images.colorSpaceIndices[index] < 0 &&
      images.formats[index] !== HEPR_IMAGE_FORMAT.Jpeg2000 &&
      images.formats[index] !== HEPR_IMAGE_FORMAT.Gray8 &&
      images.formats[index] !== HEPR_IMAGE_FORMAT.GrayAlpha8 &&
      images.formats[index] !== HEPR_IMAGE_FORMAT.Rgba8 &&
      images.formats[index] !== HEPR_IMAGE_FORMAT.Rgba16
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.images.colorSpaceIndices[${index}]`,
        "encoded image has no self-contained PDF color space"
      );
    }
  }
  for (let index = 0; index < meshCount; index += 1) {
    validateRequiredIndex(
      meshes.colorSpaceIndices[index],
      colorCount,
      `${path}.meshes.colorSpaceIndices[${index}]`
    );
  }
  for (let index = 0; index < gradients.stopPaintIndices.length; index += 1) {
    validateRequiredIndex(
      gradients.stopPaintIndices[index],
      paintCount,
      `${path}.gradients.stopPaintIndices[${index}]`
    );
  }
  for (let index = 0; index < patternCount; index += 1) {
    validateOptionalIndex(
      patterns.underlyingColorSpaceIndices[index],
      colorCount,
      `${path}.patterns.underlyingColorSpaceIndices[${index}]`
    );
  }
  for (let index = 0; index < gradientCount; index += 1) {
    validateOptionalIndex(gradients.colorSpaceIndices[index], colorCount, `${path}.gradients.colorSpaceIndices[${index}]`);
    validateOptionalIndex(gradients.functionIndices[index], functionCount, `${path}.gradients.functionIndices[${index}]`);
    validateOptionalIndex(gradients.meshIndices[index], meshCount, `${path}.gradients.meshIndices[${index}]`);
    const kind = gradients.kinds[index];
    const expectedMeshKind = kind === HEPR_GRADIENT_KIND.FreeFormMesh || kind === HEPR_GRADIENT_KIND.LatticeMesh
      ? HEPR_MESH_KIND.Triangles
      : kind === HEPR_GRADIENT_KIND.CoonsPatchMesh
        ? HEPR_MESH_KIND.CoonsPatch
        : kind === HEPR_GRADIENT_KIND.TensorPatchMesh
          ? HEPR_MESH_KIND.TensorPatch
          : -1;
    const isKnownNonMesh =
      kind === HEPR_GRADIENT_KIND.Axial ||
      kind === HEPR_GRADIENT_KIND.Radial ||
      kind === HEPR_GRADIENT_KIND.Function;
    if (expectedMeshKind < 0 && !isKnownNonMesh) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.gradients.kinds[${index}]`,
        "unknown gradient kind"
      );
    }
    const meshIndex = gradients.meshIndices[index];
    if (expectedMeshKind >= 0) {
      validateRequiredIndex(meshIndex, meshCount, `${path}.gradients.meshIndices[${index}]`);
      if (meshes.kinds[meshIndex] !== expectedMeshKind) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.gradients.meshIndices[${index}]`,
          "gradient and mesh kinds disagree"
        );
      }
      if (meshes.colorSpaceIndices[meshIndex] !== gradients.colorSpaceIndices[index]) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.gradients.colorSpaceIndices[${index}]`,
          "gradient and mesh color spaces disagree"
        );
      }
    } else if (meshIndex >= 0) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.gradients.meshIndices[${index}]`,
        "a non-mesh gradient must not reference a mesh"
      );
    }
  }
  for (let index = 0; index < paintCount; index += 1) {
    const kind = paints.kinds[index];
    const resourceCount =
      kind === HEPR_PAINT_KIND.SolidColor
        ? colorCount
        : kind === HEPR_PAINT_KIND.Gradient
          ? gradientCount
          : kind === HEPR_PAINT_KIND.Pattern
            ? patternCount
            : -1;
    if (resourceCount < 0) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.paints.kinds[${index}]`, "unknown paint kind");
    }
    validateRequiredIndex(paints.resourceIndices[index], resourceCount, `${path}.paints.resourceIndices[${index}]`);
    validateOptionalIndex(
      paints.patternTransformIndices[index],
      transformCount,
      `${path}.paints.patternTransformIndices[${index}]`
    );
    validateOptionalIndex(
      paints.patternBasePaintIndices[index],
      paintCount,
      `${path}.paints.patternBasePaintIndices[${index}]`
    );
    if (kind === HEPR_PAINT_KIND.Pattern) {
      if (paints.patternTransformIndices[index] < 0) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.paints.patternTransformIndices[${index}]`,
          "pattern paint requires its use-time transform"
        );
      }
      const patternKind = patterns.kinds[paints.resourceIndices[index]];
      const patternIndex = paints.resourceIndices[index];
      const basePaintIndex = paints.patternBasePaintIndices[index];
      if (patternKind === HEPR_PATTERN_KIND.UncoloredTiling) {
        if (
          basePaintIndex < 0 || basePaintIndex >= index ||
          paints.kinds[basePaintIndex] !== HEPR_PAINT_KIND.SolidColor ||
          paints.alphas[basePaintIndex] !== 1 ||
          paints.overprint[basePaintIndex] !== 0 ||
          paints.overprintModes[basePaintIndex] !== 0
        ) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidReference,
            `${path}.paints.patternBasePaintIndices[${index}]`,
            "uncolored tiling pattern requires a preceding opaque solid base-color paint"
          );
        }
      } else if (basePaintIndex >= 0) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.paints.patternBasePaintIndices[${index}]`,
          "colored or shading pattern must not carry a base-color binding"
        );
      }
      if (patternKind === HEPR_PATTERN_KIND.Shading) {
        if (patterns.gradientIndices[patternIndex] < 0) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidReference,
            `${path}.patterns.gradientIndices[${patternIndex}]`,
            "a used shading pattern requires a gradient resource"
          );
        }
        if (patterns.programIndices[patternIndex] >= 0) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidReference,
            `${path}.patterns.programIndices[${patternIndex}]`,
            "a shading pattern must not reference a tiling-cell program"
          );
        }
      } else {
        if (patterns.programIndices[patternIndex] < 0) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidReference,
            `${path}.patterns.programIndices[${patternIndex}]`,
            "a used tiling pattern requires a reusable cell program"
          );
        }
        if (patterns.gradientIndices[patternIndex] >= 0) {
          fail(
            HEPR_DATA_VALIDATION_CODES.InvalidReference,
            `${path}.patterns.gradientIndices[${patternIndex}]`,
            "a tiling pattern must not reference a shading gradient"
          );
        }
      }
    } else if (
      paints.patternTransformIndices[index] >= 0 ||
      paints.patternBasePaintIndices[index] >= 0
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.paints[${index}]`,
        "non-pattern paint carries pattern-only metadata"
      );
    }
    if (paints.alphas[index] < 0 || paints.alphas[index] > 1) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.paints.alphas[${index}]`, "alpha must be in [0, 1]");
    }
    if (paints.overprint[index] > 1) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.paints.overprint[${index}]`,
        "expected 0 or 1"
      );
    }
    if (paints.overprintModes[index] > 1) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.paints.overprintModes[${index}]`,
        "expected PDF overprint mode 0 or 1"
      );
    }
  }

  return counts;
}

function validateParentForest(parents: Int32Array, path: string): void {
  const state = new Uint8Array(parents.length);
  for (let start = 0; start < parents.length; start += 1) {
    if (state[start] !== 0) continue;
    let index = start;
    while (index >= 0 && state[index] === 0) {
      state[index] = 1;
      index = parents[index];
    }
    if (index >= 0 && state[index] === 1) {
      fail(HEPR_DATA_VALIDATION_CODES.ResourceCycle, `${path}[${index}]`, "cycle detected");
    }
    index = start;
    while (index >= 0 && state[index] === 1) {
      state[index] = 2;
      index = parents[index];
    }
  }
}

function validateCommandState(command: HeprDisplayCommand, counts: StoreCounts, path: string): void {
  validateRequiredIndex(command.transformIndex, counts.transforms, `${path}.transformIndex`);
  validateOptionalIndex(command.clipIndex, counts.clips, `${path}.clipIndex`);
  validateOptionalIndex(
    command.optionalContentIndex,
    counts.optionalContent,
    `${path}.optionalContentIndex`
  );
  validateOptionalIndex(
    command.markedContentIndex,
    counts.markedContent,
    `${path}.markedContentIndex`
  );
  if (!Number.isSafeInteger(command.sourceOffset) || command.sourceOffset < -1) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.sourceOffset`, "expected -1 or a safe integer");
  }
  if (!Number.isSafeInteger(command.sourceLength) || command.sourceLength < -1) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.sourceLength`, "expected -1 or a safe integer");
  }
}

function validateCommand(
  command: HeprDisplayCommand,
  counts: StoreCounts,
  imageMasks: Uint8Array,
  glyphFlags: Uint8Array,
  groupCount: number,
  programCount: number,
  path: string,
  allowInheritedProgramPaint = false
): void {
  requireRecord(command, path);
  const stateKeys = [
    "kind", "transformIndex", "clipIndex", "optionalContentIndex", "markedContentIndex",
    "sourceOffset", "sourceLength"
  ];
  if (command.kind === "invoke-group") {
    requireExactKeys(command, [...stateKeys, "groupIndex"], path);
  } else if (command.kind === "invoke-program") {
    requireExactKeys(
      command,
      [...stateKeys, "programIndex", "type3PaintIndex", "viewTransformFlags"],
      path
    );
  } else if (command.kind === "draw") {
    const drawKeys = [...stateKeys, "source", "first", "count"];
    if (command.source === "paths") {
      requireAllowedKeys(
        command,
        [...drawKeys, "fillPaintIndex", "strokePaintIndex", "strokeStyleIndex", "fillRule"],
        ["fillPaintInherited", "strokePaintInherited"],
        path
      );
    } else if (command.source === "fill-paths" || command.source === "stroke-segments") {
      requireExactKeys(command, [...drawKeys, "paintIndex"], path);
    } else if (command.source === "glyphs") {
      requireExactKeys(
        command,
        [...drawKeys, "fillPaintIndex", "strokePaintIndex", "strokeStyleIndex", "renderingMode"],
        path
      );
    } else if (command.source === "images") {
      requireExactKeys(command, [...drawKeys, "paintIndex"], path);
    } else if (
      command.source === "meshes" || command.source === "gradients" ||
      command.source === "patterns"
    ) {
      requireExactKeys(command, drawKeys, path);
    }
  } else {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${path}.kind`, "unknown command kind");
  }
  validateCommandState(command, counts, path);
  if (command.kind === "invoke-group") {
    validateRequiredIndex(command.groupIndex, groupCount, `${path}.groupIndex`);
    return;
  }
  if (command.kind === "invoke-program") {
    validateRequiredIndex(command.programIndex, programCount, `${path}.programIndex`);
    validateOptionalIndex(command.type3PaintIndex, counts.paints, `${path}.type3PaintIndex`);
    if (
      !Number.isSafeInteger(command.viewTransformFlags) || command.viewTransformFlags < 0 ||
      (command.viewTransformFlags & ~(
        HEPR_VIEW_TRANSFORM_FLAG.NoZoom | HEPR_VIEW_TRANSFORM_FLAG.NoRotate
      )) !== 0
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidNumber,
        `${path}.viewTransformFlags`,
        "unknown view-transform flag"
      );
    }
    return;
  }
  const total =
    command.source === "paths"
      ? counts.paths
      : command.source === "fill-paths"
        ? counts.fillPaths
        : command.source === "stroke-segments"
          ? counts.strokeSegments
          : command.source === "glyphs"
            ? counts.glyphs
            : command.source === "images"
              ? counts.images
              : command.source === "meshes"
                ? counts.meshes
                : command.source === "gradients"
                  ? counts.gradients
                  : command.source === "patterns"
                    ? counts.patterns
                    : -1;
  if (total < 0) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${path}.source`, "unknown draw source");
  }
  validateRange(command.first, command.count, total, path);
  if (command.source === "fill-paths" || command.source === "stroke-segments") {
    validateOptionalIndex(command.paintIndex, counts.paints, `${path}.paintIndex`);
    if (command.paintIndex < 0 && !allowInheritedProgramPaint) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.paintIndex`,
        "inherited paint requires an uncolored reusable program"
      );
    }
  } else if (command.source === "paths") {
    validateOptionalIndex(command.fillPaintIndex, counts.paints, `${path}.fillPaintIndex`);
    validateOptionalIndex(command.strokePaintIndex, counts.paints, `${path}.strokePaintIndex`);
    validateOptionalIndex(command.strokeStyleIndex, counts.strokeStyles, `${path}.strokeStyleIndex`);
    if (
      (command.fillPaintInherited !== undefined && typeof command.fillPaintInherited !== "boolean") ||
      (command.strokePaintInherited !== undefined && typeof command.strokePaintInherited !== "boolean")
    ) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, path, "path inheritance flags must be boolean");
    }
    const fillInherited = command.fillPaintInherited === true;
    const strokeInherited = command.strokePaintInherited === true;
    if ((fillInherited || strokeInherited) && !allowInheritedProgramPaint) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        path,
        "inherited path paint requires an uncolored reusable program"
      );
    }
    if (
      (fillInherited && command.fillPaintIndex >= 0) ||
      (strokeInherited && command.strokePaintIndex >= 0)
    ) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidReference, path, "path paint cannot be both explicit and inherited");
    }
    const hasFill = command.fillPaintIndex >= 0 || fillInherited;
    const hasStroke = command.strokePaintIndex >= 0 || strokeInherited;
    if (!hasFill && !hasStroke) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidReference, path, "path run has no paint");
    }
    if (hasStroke && command.strokeStyleIndex < 0) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidReference, `${path}.strokeStyleIndex`, "painted stroke needs a style");
    }
    if (!hasStroke && command.strokeStyleIndex >= 0) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidReference, `${path}.strokeStyleIndex`, "fill-only path must not carry a stroke style");
    }
    if (command.fillRule !== 0 && command.fillRule !== 1) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.fillRule`, "unknown fill rule");
    }
  } else if (command.source === "glyphs") {
    validateOptionalIndex(command.fillPaintIndex, counts.paints, `${path}.fillPaintIndex`);
    validateOptionalIndex(command.strokePaintIndex, counts.paints, `${path}.strokePaintIndex`);
    validateOptionalIndex(command.strokeStyleIndex, counts.strokeStyles, `${path}.strokeStyleIndex`);
    if (!Number.isInteger(command.renderingMode) || command.renderingMode < 0 || command.renderingMode > 7) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${path}.renderingMode`, "expected PDF text mode 0..7");
    }
    const expectsFill = command.renderingMode === 0 || command.renderingMode === 2 ||
      command.renderingMode === 4 || command.renderingMode === 6;
    const expectsStroke = command.renderingMode === 1 || command.renderingMode === 2 ||
      command.renderingMode === 5 || command.renderingMode === 6;
    const hasFillPaint = command.fillPaintIndex >= 0 ||
      (allowInheritedProgramPaint && expectsFill);
    const hasStrokePaint = command.strokePaintIndex >= 0 ||
      (allowInheritedProgramPaint && expectsStroke);
    if (hasFillPaint !== expectsFill) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.fillPaintIndex`,
        "fill paint does not match the PDF text rendering mode"
      );
    }
    if (hasStrokePaint !== expectsStroke) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.strokePaintIndex`,
        "stroke paint does not match the PDF text rendering mode"
      );
    }
    if ((command.strokeStyleIndex >= 0) !== expectsStroke) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.strokeStyleIndex`,
        "stroke style does not match the PDF text rendering mode"
      );
    }
    const expectsInvisible = command.renderingMode === 3 || command.renderingMode === 7;
    const expectsClipping = command.renderingMode >= 4;
    for (let index = command.first; index < command.first + command.count; index += 1) {
      const flags = glyphFlags[index];
      if (
        (flags & HEPR_GLYPH_FLAG.Type3) !== 0 &&
        (flags & HEPR_GLYPH_FLAG.Invisible) === 0
      ) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.first`,
          "visible Type3 glyph paint must use its reusable CharProc program"
        );
      }
      if (((flags & HEPR_GLYPH_FLAG.Invisible) !== 0) !== expectsInvisible) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.renderingMode`,
          "glyph invisibility flag does not match the PDF text rendering mode"
        );
      }
      if (((flags & HEPR_GLYPH_FLAG.ClipOnly) !== 0) !== expectsClipping) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.renderingMode`,
          "glyph clipping flag does not match the PDF text rendering mode"
        );
      }
    }
  } else if (command.source === "images") {
    validateOptionalIndex(command.paintIndex, counts.paints, `${path}.paintIndex`);
    for (let index = command.first; index < command.first + command.count; index += 1) {
      const isMask = imageMasks[index] !== 0;
      if (isMask && command.paintIndex < 0 && !allowInheritedProgramPaint) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.paintIndex`,
          "stencil image mask requires the current nonstroking paint"
        );
      }
      if (!isMask && command.paintIndex >= 0) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.paintIndex`,
          "ordinary image must not carry a stencil paint"
        );
      }
    }
  }
}

function validateDisplayProgram(
  page: HeprPageData,
  counts: StoreCounts,
  limits: HeprDataValidationLimits,
  path: string
): void {
  const display = page.displayProgram;
  requireRecord(display, path);
  requireExactKeys(display, ["rootGroupIndex", "groups", "programs"], path);
  if (!Array.isArray(display.groups) || !Array.isArray(display.programs)) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, path, "groups and programs must be arrays");
  }
  validateRequiredIndex(display.rootGroupIndex, display.groups.length, `${path}.rootGroupIndex`);
  const uncoloredPatternPrograms = new Set<number>();
  for (let patternIndex = 0; patternIndex < page.stores.patterns.kinds.length; patternIndex += 1) {
    if (page.stores.patterns.kinds[patternIndex] !== HEPR_PATTERN_KIND.UncoloredTiling) continue;
    const programIndex = page.stores.patterns.programIndices[patternIndex];
    if (programIndex >= 0 && programIndex < display.programs.length) {
      uncoloredPatternPrograms.add(programIndex);
    }
  }
  // Composite wrappers preserve their caller's inherited paint. Work out
  // whether a group is reachable exclusively from Type3/PaintType 2 programs
  // before accepting a negative packed paint inside it. A group shared with
  // the root or a colored program must remain self-contained.
  const { groupModes: groupPaintModes, programModes } = computeGroupPaintModes(
    page,
    uncoloredPatternPrograms
  );
  let commandCount = 0;
  display.groups.forEach((group, groupIndex) => {
    const groupPath = `${path}.groups[${groupIndex}]`;
    requireRecord(group, groupPath);
    requireExactKeys(
      group,
      [
        "commands", "isolated", "knockout", "blendMode", "alpha", "alphaIsShape",
        "softMaskGroupIndex",
        "softMaskSubtype", "softMaskTransferFunctionIndex", "backdropPaintIndex",
        "blendingColorSpaceIndex", "clipIndex"
      ],
      groupPath
    );
    const typedGroup = group as unknown as HeprCompositeGroup;
    if (!Array.isArray(typedGroup.commands)) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${groupPath}.commands`, "expected an array");
    }
    commandCount += typedGroup.commands.length;
    typedGroup.commands.forEach((command, commandIndex) =>
      validateCommand(
        command,
        counts,
        page.stores.images.imageMask,
        page.stores.glyphs.flags,
        display.groups.length,
        display.programs.length,
        `${groupPath}.commands[${commandIndex}]`,
        groupPaintModes[groupIndex] === 2
      )
    );
    if (
      typeof typedGroup.isolated !== "boolean" ||
      typeof typedGroup.knockout !== "boolean" ||
      typeof typedGroup.alphaIsShape !== "boolean"
    ) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, groupPath, "group flags must be boolean");
    }
    requireFinite(typedGroup.alpha, `${groupPath}.alpha`);
    if (typedGroup.alpha < 0 || typedGroup.alpha > 1) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidNumber, `${groupPath}.alpha`, "expected [0, 1]");
    }
    if (!isPdfBlendMode(typedGroup.blendMode)) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidShape,
        `${groupPath}.blendMode`,
        "unknown PDF blend mode"
      );
    }
    validateOptionalIndex(typedGroup.softMaskGroupIndex, display.groups.length, `${groupPath}.softMaskGroupIndex`);
    if (
      typedGroup.softMaskSubtype !== null && typedGroup.softMaskSubtype !== "Alpha" &&
      typedGroup.softMaskSubtype !== "Luminosity"
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidShape,
        `${groupPath}.softMaskSubtype`,
        "expected Alpha, Luminosity, or null"
      );
    }
    validateOptionalIndex(
      typedGroup.softMaskTransferFunctionIndex,
      counts.functions,
      `${groupPath}.softMaskTransferFunctionIndex`
    );
    if (
      typedGroup.softMaskGroupIndex < 0 &&
      (typedGroup.softMaskSubtype !== null || typedGroup.softMaskTransferFunctionIndex >= 0)
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        groupPath,
        "soft-mask metadata requires a soft-mask group"
      );
    }
    if (typedGroup.softMaskGroupIndex >= 0 && typedGroup.softMaskSubtype === null) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${groupPath}.softMaskSubtype`,
        "a referenced soft-mask group requires Alpha or Luminosity semantics"
      );
    }
    validateOptionalIndex(typedGroup.backdropPaintIndex, counts.paints, `${groupPath}.backdropPaintIndex`);
    validateOptionalIndex(typedGroup.blendingColorSpaceIndex, counts.colors, `${groupPath}.blendingColorSpaceIndex`);
    validateOptionalIndex(typedGroup.clipIndex, counts.clips, `${groupPath}.clipIndex`);
  });
  display.programs.forEach((program, programIndex) => {
    const programPath = `${path}.programs[${programIndex}]`;
    requireRecord(program, programPath);
    requireExactKeys(
      program,
      ["kind", "commands", "matrixIndex", "bounds", "clipToBounds", "resourceName"],
      programPath
    );
    const typedProgram = program as unknown as HeprReusableProgram;
    if (
      typedProgram.kind !== "form" && typedProgram.kind !== "type3" &&
      typedProgram.kind !== "pattern"
    ) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidShape,
        `${programPath}.kind`,
        "expected form, type3, or pattern"
      );
    }
    if (!Array.isArray(typedProgram.commands)) {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${programPath}.commands`, "expected an array");
    }
    commandCount += typedProgram.commands.length;
    typedProgram.commands.forEach((command, commandIndex) => {
      const commandPath = `${programPath}.commands[${commandIndex}]`;
      validateCommand(
        command,
        counts,
        page.stores.images.imageMask,
        page.stores.glyphs.flags,
        display.groups.length,
        display.programs.length,
        commandPath,
        programModes[programIndex] === 2
      );
      if (
        command.kind === "invoke-program" && command.type3PaintIndex >= 0 &&
        display.programs[command.programIndex]?.kind !== "type3"
      ) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${commandPath}.type3PaintIndex`,
          "inherited Type3 paint requires a Type3 target program"
        );
      }
    });
    validateRequiredIndex(typedProgram.matrixIndex, counts.transforms, `${programPath}.matrixIndex`);
    if (typedProgram.bounds !== null) validateBox(typedProgram.bounds, `${programPath}.bounds`);
    if (typeof typedProgram.clipToBounds !== "boolean") {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${programPath}.clipToBounds`, "expected boolean");
    }
    if (typedProgram.resourceName !== null && typeof typedProgram.resourceName !== "string") {
      fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${programPath}.resourceName`, "expected string or null");
    }
  });
  display.groups.forEach((group, groupIndex) => {
    const typedGroup = group as unknown as HeprCompositeGroup;
    typedGroup.commands.forEach((command: HeprDisplayCommand, commandIndex: number) => {
      if (
        command.kind === "invoke-program" && command.type3PaintIndex >= 0 &&
        display.programs[command.programIndex]?.kind !== "type3"
      ) {
        fail(
          HEPR_DATA_VALIDATION_CODES.InvalidReference,
          `${path}.groups[${groupIndex}].commands[${commandIndex}].type3PaintIndex`,
          "inherited Type3 paint requires a Type3 target program"
        );
      }
    });
  });
  if (commandCount > limits.maxCommandsPerPage) {
    fail(
      HEPR_DATA_VALIDATION_CODES.ResourceLimit,
      path,
      `${commandCount} commands exceed limit ${limits.maxCommandsPerPage}`
    );
  }
  for (let index = 0; index < page.stores.fonts.type3ProgramIndices.length; index += 1) {
    const programIndex = page.stores.fonts.type3ProgramIndices[index];
    validateOptionalIndex(
      programIndex,
      display.programs.length,
      `stores.fonts.type3ProgramIndices[${index}]`
    );
    if (programIndex >= 0 && display.programs[programIndex].kind !== "type3") {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `stores.fonts.type3ProgramIndices[${index}]`,
        "Type3 glyph must reference a Type3 reusable program"
      );
    }
  }
  for (let index = 0; index < page.stores.patterns.programIndices.length; index += 1) {
    validateOptionalIndex(
      page.stores.patterns.programIndices[index],
      display.programs.length,
      `stores.patterns.programIndices[${index}]`
    );
    const patternProgramIndex = page.stores.patterns.programIndices[index];
    if (patternProgramIndex >= 0 && display.programs[patternProgramIndex].kind !== "pattern") {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `stores.patterns.programIndices[${index}]`,
        "tiling pattern must reference a Pattern reusable program"
      );
    }
    validateOptionalIndex(
      page.stores.patterns.gradientIndices[index],
      counts.gradients,
      `stores.patterns.gradientIndices[${index}]`
    );
  }
  validateProgramGraph(page, path);
}

/** Bit 0 = ordinary caller; bit 1 = caller supplies an inherited paint. */
function computeGroupPaintModes(
  page: HeprPageData,
  uncoloredPatternPrograms: ReadonlySet<number>
): { readonly groupModes: Uint8Array; readonly programModes: Uint8Array } {
  const { groups, programs, rootGroupIndex } = page.displayProgram;
  const groupModes = new Uint8Array(groups.length);
  const programModes = new Uint8Array(programs.length);
  const pending: Array<{ kind: "group" | "program"; index: number; mode: 1 | 2 }> = [];
  const enqueue = (kind: "group" | "program", index: number, mode: 1 | 2): void => {
    const modes = kind === "group" ? groupModes : programModes;
    if ((modes[index] & mode) !== 0) return;
    modes[index] |= mode;
    pending.push({ kind, index, mode });
  };

  enqueue("group", rootGroupIndex, 1);
  for (let index = 0; index < programs.length; index += 1) {
    if (programs[index].kind === "type3" || uncoloredPatternPrograms.has(index)) {
      enqueue("program", index, 2);
    } else if (programs[index].kind === "pattern") {
      enqueue("program", index, 1);
    }
  }

  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const { kind, index, mode } = pending[cursor];
    const container = kind === "group" ? groups[index] : programs[index];
    if (kind === "group" && groups[index].softMaskGroupIndex >= 0) {
      enqueue("group", groups[index].softMaskGroupIndex, mode);
    }
    for (const command of container.commands) {
      if (command.kind === "invoke-group") {
        enqueue("group", command.groupIndex, mode);
      } else if (command.kind === "invoke-program") {
        enqueue(
          "program",
          command.programIndex,
          command.type3PaintIndex >= 0 ? 2 : mode
        );
      }
    }
  }
  return { groupModes, programModes };
}

function isPdfBlendMode(value: unknown): value is PdfBlendMode {
  return value === "Normal" || value === "Multiply" || value === "Screen" ||
    value === "Overlay" || value === "Darken" || value === "Lighten" ||
    value === "ColorDodge" || value === "ColorBurn" || value === "HardLight" ||
    value === "SoftLight" || value === "Difference" || value === "Exclusion" ||
    value === "Hue" || value === "Saturation" || value === "Color" ||
    value === "Luminosity";
}

function validateProgramGraph(page: HeprPageData, path: string): void {
  const { groups, programs } = page.displayProgram;
  const groupCount = groups.length;
  const nodeCount = groupCount + programs.length;
  const state = new Uint8Array(nodeCount);
  const patternProgramsForCommand = (command: HeprDisplayCommand): number[] => {
    if (command.kind !== "draw") return [];
    const paintIndices = command.source === "paths"
      ? [command.fillPaintIndex, command.strokePaintIndex]
      : command.source === "fill-paths" || command.source === "stroke-segments" ||
          command.source === "images"
        ? [command.paintIndex]
        : command.source === "glyphs"
          ? [command.fillPaintIndex, command.strokePaintIndex]
          : [];
    const result: number[] = [];
    for (const paintIndex of paintIndices) {
      if (paintIndex < 0 || page.stores.paints.kinds[paintIndex] !== HEPR_PAINT_KIND.Pattern) {
        continue;
      }
      const patternIndex = page.stores.paints.resourceIndices[paintIndex];
      const programIndex = page.stores.patterns.programIndices[patternIndex];
      if (programIndex >= 0) result.push(programIndex);
    }
    return result;
  };
  const edgesFor = (node: number): number[] => {
    const edges: number[] = [];
    const commands = node < groupCount ? groups[node].commands : programs[node - groupCount].commands;
    if (node < groupCount) {
      const softMask = groups[node].softMaskGroupIndex;
      if (softMask >= 0) edges.push(softMask);
    }
    for (const command of commands) {
      if (command.kind === "invoke-group") edges.push(command.groupIndex);
      if (command.kind === "invoke-program") edges.push(groupCount + command.programIndex);
      for (const programIndex of patternProgramsForCommand(command)) {
        edges.push(groupCount + programIndex);
      }
      if (command.kind === "draw" && command.source === "patterns") {
        for (let pattern = command.first; pattern < command.first + command.count; pattern += 1) {
          const program = page.stores.patterns.programIndices[pattern];
          if (program >= 0) edges.push(groupCount + program);
        }
      }
    }
    return edges;
  };
  const stack: Array<{ node: number; edges: number[]; cursor: number }> = [];
  for (let start = 0; start < nodeCount; start += 1) {
    if (state[start] !== 0) continue;
    state[start] = 1;
    stack.push({ node: start, edges: edgesFor(start), cursor: 0 });
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.cursor >= frame.edges.length) {
        state[frame.node] = 2;
        stack.pop();
        continue;
      }
      const next = frame.edges[frame.cursor++];
      if (state[next] === 1) {
        fail(HEPR_DATA_VALIDATION_CODES.ResourceCycle, path, `display node ${next} is cyclic`);
      }
      if (state[next] === 0) {
        state[next] = 1;
        stack.push({ node: next, edges: edgesFor(next), cursor: 0 });
      }
    }
  }
}

function validateTextIndex(
  page: HeprPageData,
  limits: HeprDataValidationLimits,
  path: string
): void {
  const index = page.textIndex;
  requireRecord(index, path);
  requireExactKeys(index, ["version", "text", "charGlyphIndices", "fallbackQuads"], path);
  if (index.version !== 1) {
    fail(HEPR_DATA_VALIDATION_CODES.IncompatibleVersion, `${path}.version`, "expected 1");
  }
  if (typeof index.text !== "string") {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, `${path}.text`, "expected a string");
  }
  if (index.text.length > limits.maxTextCodeUnitsPerPage) {
    fail(HEPR_DATA_VALIDATION_CODES.ResourceLimit, `${path}.text`, "text limit exceeded");
  }
  requireTypedArray<Int32Array>(index.charGlyphIndices, Int32Array, `${path}.charGlyphIndices`);
  requireTypedArray<Float32Array>(index.fallbackQuads, Float32Array, `${path}.fallbackQuads`);
  requireLength(index.charGlyphIndices.length, index.text.length, `${path}.charGlyphIndices`);
  requireMultiple(index.fallbackQuads.length, 4, `${path}.fallbackQuads`);
  requireFiniteArray(index.fallbackQuads, `${path}.fallbackQuads`);
  const fallbackCount = index.fallbackQuads.length / 4;
  const glyphCount = page.stores.glyphs.glyphIds.length;
  for (let position = 0; position < index.charGlyphIndices.length; position += 1) {
    const reference = index.charGlyphIndices[position];
    if (reference >= glyphCount || (reference <= -2 && -reference - 2 >= fallbackCount)) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `${path}.charGlyphIndices[${position}]`,
        "text geometry reference is out of range"
      );
    }
  }
}

function mergeLimits(overrides?: Partial<HeprDataValidationLimits>): HeprDataValidationLimits {
  const limits = { ...DEFAULT_HEPR_DATA_VALIDATION_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

function countTypedArrayBytes(value: unknown, visited = new Set<object>()): number {
  if (typeof value !== "object" || value === null || visited.has(value)) return 0;
  visited.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + countTypedArrayBytes(entry, visited), 0);
  }
  return Object.values(value).reduce(
    (total, entry) => total + countTypedArrayBytes(entry, visited),
    0
  );
}

export function validateHeprPageData(
  value: unknown,
  limitOverrides?: Partial<HeprDataValidationLimits>
): asserts value is HeprPageData {
  const limits = mergeLimits(limitOverrides);
  requireRecord(value, "page");
  requireExactKeys(
    value,
    ["kind", "version", "pageInfo", "displayProgram", "stores", "textIndex", "diagnostics"],
    "page"
  );
  const page = value as unknown as HeprPageData;
  if (page.kind !== "hepr-page") {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, "page.kind", "expected hepr-page");
  }
  if (page.version !== HEPR_DOCUMENT_DATA_VERSION) {
    fail(
      HEPR_DATA_VALIDATION_CODES.IncompatibleVersion,
      "page.version",
      `expected ${HEPR_DOCUMENT_DATA_VERSION}; v6 and older data must be regenerated`
    );
  }
  validatePageInfo(page.pageInfo, "page.pageInfo");
  const bytes = countTypedArrayBytes(page.stores);
  if (bytes > limits.maxTypedArrayBytesPerPage) {
    fail(
      HEPR_DATA_VALIDATION_CODES.ResourceLimit,
      "page.stores",
      `${bytes} typed-array bytes exceed limit ${limits.maxTypedArrayBytesPerPage}`
    );
  }
  const counts = validateStores(page.stores, limits, "page.stores");
  validateDisplayProgram(page, counts, limits, "page.displayProgram");
  validateTextIndex(page, limits, "page.textIndex");
  validateDiagnostics(page.diagnostics, "page.diagnostics");
}

export function validateHeprDocumentData(
  value: unknown,
  limitOverrides?: Partial<HeprDataValidationLimits>
): asserts value is HeprDocumentData {
  const limits = mergeLimits(limitOverrides);
  requireRecord(value, "document");
  requireExactKeys(value, ["kind", "version", "info", "pages", "diagnostics"], "document");
  const document = value as unknown as HeprDocumentData;
  if (document.kind !== "hepr-document") {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, "document.kind", "expected hepr-document");
  }
  if (document.version !== HEPR_DOCUMENT_DATA_VERSION) {
    fail(
      HEPR_DATA_VALIDATION_CODES.IncompatibleVersion,
      "document.version",
      `expected ${HEPR_DOCUMENT_DATA_VERSION}; v6 and older data must be regenerated`
    );
  }
  requireRecord(document.info, "document.info");
  requireExactKeys(
    document.info,
    [
      "pdfVersion", "byteLength", "pageCount", "pages", "label", "fingerprint",
      "linearized", "repaired", "tagged", "language", "metadata"
    ],
    "document.info"
  );
  requireSafeInteger(document.info.pageCount, "document.info.pageCount");
  requireSafeInteger(document.info.byteLength, "document.info.byteLength");
  for (const [name, field] of [
    ["pdfVersion", document.info.pdfVersion],
    ["label", document.info.label],
    ["fingerprint", document.info.fingerprint],
    ["language", document.info.language]
  ] as const) {
    if (field !== null && typeof field !== "string") {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidShape,
        `document.info.${name}`,
        "expected a string or null"
      );
    }
  }
  for (const [name, field] of [
    ["linearized", document.info.linearized],
    ["repaired", document.info.repaired],
    ["tagged", document.info.tagged]
  ] as const) {
    if (typeof field !== "boolean") {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidShape,
        `document.info.${name}`,
        "expected a boolean"
      );
    }
  }
  requireRecord(document.info.metadata, "document.info.metadata");
  for (const [name, field] of Object.entries(document.info.metadata)) {
    if (typeof field !== "string") {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidShape,
        `document.info.metadata.${name}`,
        "expected a string"
      );
    }
  }
  if (!Array.isArray(document.info.pages)) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, "document.info.pages", "expected an array");
  }
  requireLength(document.info.pages.length, document.info.pageCount, "document.info.pages");
  if (!Array.isArray(document.pages)) {
    fail(HEPR_DATA_VALIDATION_CODES.InvalidShape, "document.pages", "expected an array");
  }
  if (document.pages.length > limits.maxPages) {
    fail(HEPR_DATA_VALIDATION_CODES.ResourceLimit, "document.pages", "page limit exceeded");
  }
  document.info.pages.forEach((pageInfo, index) => {
    validatePageInfo(pageInfo, `document.info.pages[${index}]`);
    if (pageInfo.sourcePageIndex !== index) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `document.info.pages[${index}].sourcePageIndex`,
        "document page metadata must use its zero-based source-page index"
      );
    }
  });
  const indexes = new Set<number>();
  document.pages.forEach((page, index) => {
    validateHeprPageData(page, limits);
    const sourcePageIndex = page.pageInfo.sourcePageIndex;
    if (sourcePageIndex >= document.info.pageCount) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `document.pages[${index}].pageInfo.sourcePageIndex`,
        "source page index exceeds document page count"
      );
    }
    if (indexes.has(sourcePageIndex)) {
      fail(
        HEPR_DATA_VALIDATION_CODES.DuplicatePage,
        `document.pages[${index}].pageInfo.sourcePageIndex`,
        "duplicate compiled source page"
      );
    }
    if (!pageInfoEquals(page.pageInfo, document.info.pages[sourcePageIndex])) {
      fail(
        HEPR_DATA_VALIDATION_CODES.InvalidReference,
        `document.pages[${index}].pageInfo`,
        "compiled page geometry disagrees with document page metadata"
      );
    }
    indexes.add(sourcePageIndex);
  });
  validateDiagnostics(document.diagnostics, "document.diagnostics");
}

function pageInfoEquals(left: PdfPageInfo, right: PdfPageInfo): boolean {
  return left.sourcePageIndex === right.sourcePageIndex &&
    boxEquals(left.mediaBox, right.mediaBox) &&
    boxEquals(left.cropBox, right.cropBox) &&
    nullableBoxEquals(left.bleedBox, right.bleedBox) &&
    nullableBoxEquals(left.trimBox, right.trimBox) &&
    nullableBoxEquals(left.artBox, right.artBox) &&
    left.rotation === right.rotation &&
    left.userUnit === right.userUnit &&
    left.width === right.width &&
    left.height === right.height;
}

function nullableBoxEquals(left: PdfBox | null, right: PdfBox | null): boolean {
  return left === null ? right === null : right !== null && boxEquals(left, right);
}

function boxEquals(left: PdfBox, right: PdfBox): boolean {
  return left[0] === right[0] && left[1] === right[1] &&
    left[2] === right[2] && left[3] === right[3];
}
