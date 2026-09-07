import {
  HEPR_FONT_KIND,
  HEPR_GLYPH_FLAG,
  HEPR_PATH_FLAG,
  HEPR_PATH_VERB,
  type HeprFontStore,
  type HeprPathStore,
  type HeprTextIndex
} from "../heprDocumentData";
import type {
  NativeGlyphOutline,
  NativePdfFont,
  NativeGlyphPathCommand
} from "./nativeFont";
import type {
  NativeTextCompilation,
  NativeTextFontResource
} from "./nativeText";
import {
  DEFAULT_PDF_RESOURCE_LIMITS,
  PdfError,
  throwIfAborted
} from "./nativeTypes";

const MAX_INT32 = 0x7fff_ffff;
const MAX_UINT32 = 0xffff_ffff;
const MAX_TEXT_CODE_UNITS = 100_000_000;

export interface NativePageTextResourceOptions {
  readonly maxPaths: number;
  readonly maxGlyphs?: number;
  readonly maxFonts?: number;
  readonly maxTransforms?: number;
  readonly maxPathVerbs?: number;
  readonly maxPathCoordinates?: number;
  readonly maxFallbackQuads?: number;
  readonly maxTextCodeUnits?: number;
  readonly signal?: AbortSignal;
  /** Canonical page-local Type3 program indexes keyed by `fontIndex:glyphId`. */
  readonly type3ProgramIndices?: ReadonlyMap<string, number>;
}

export interface NativePageTextResources extends NativeTextCompilation {
  readonly fonts: HeprFontStore;
  /** Generic paths containing only derived glyph outlines. */
  readonly outlinePaths: Pick<
    HeprPathStore,
    "pathVerbOffsets" | "verbs" | "verbCoordinateOffsets" |
    "coordinates" | "bounds" | "flags"
  >;
}

interface ResolvedPageTextLimits {
  readonly maxPaths: number;
  readonly maxGlyphs: number;
  readonly maxFonts: number;
  readonly maxTransforms: number;
  readonly maxPathVerbs: number;
  readonly maxPathCoordinates: number;
  readonly maxFallbackQuads: number;
  readonly maxTextCodeUnits: number;
}

/**
 * Make the text result self-contained by deriving every visible outline used
 * on this page. Invisible OCR glyphs remain indexed without forcing a font
 * program to be present. Type3 entries bind already-compiled CharProc
 * programs. Fill, stroke, fill-stroke, and clipping modes retain their ordered
 * run semantics; clipping glyphs always derive exact outlines.
 */
export function buildNativePageTextResources(
  compilation: NativeTextCompilation,
  fontResources: readonly NativeTextFontResource[],
  options: NativePageTextResourceOptions
): NativePageTextResources {
  const limits = resolveLimits(options);
  throwIfAborted(options.signal);
  validateCompilation(compilation, limits, options.signal);

  if (fontResources.length > limits.maxFonts) {
    throw resourceLimit("Page text exceeds the configured font limit.", {
      maxFonts: limits.maxFonts
    });
  }
  const byIndex = new Array<NativePdfFont | undefined>(fontResources.length);
  for (const resource of fontResources) {
    throwIfAborted(options.signal);
    if (
      !Number.isSafeInteger(resource.fontIndex) || resource.fontIndex < 0 ||
      resource.fontIndex >= byIndex.length || byIndex[resource.fontIndex]
    ) {
      throw new PdfError("invalid-object", "Page font resources have invalid local indexes.");
    }
    validateFont(resource.font, resource.fontIndex);
    byIndex[resource.fontIndex] = resource.font;
  }
  if (byIndex.some((font) => font === undefined)) {
    throw new PdfError("invalid-object", "Page font resource indexes are not contiguous.");
  }

  const used = byIndex.map(() => new Map<number, boolean>());
  const clippingGlyphs = byIndex.map(() => new Set<number>());
  for (let index = 0; index < compilation.glyphs.glyphIds.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(options.signal);
    const fontIndex = compilation.glyphs.fontIndices[index];
    const glyphId = compilation.glyphs.glyphIds[index];
    const fontUsed = used[fontIndex];
    if (!fontUsed) {
      throw new PdfError("invalid-object", "A native glyph references a missing page font.");
    }
    const font = byIndex[fontIndex]!;
    const glyphFlags = compilation.glyphs.flags[index];
    if (((glyphFlags & HEPR_GLYPH_FLAG.Vertical) !== 0) !== (font.writingMode === 1)) {
      throw new PdfError("invalid-object", "A native glyph writing-mode flag does not match its font.");
    }
    if (((glyphFlags & HEPR_GLYPH_FLAG.Type3) !== 0) !== (font.subtype === "Type3")) {
      throw new PdfError("invalid-object", "A native glyph Type3 flag does not match its font.");
    }
    const clipping = (glyphFlags & HEPR_GLYPH_FLAG.ClipOnly) !== 0;
    const outlineRequired = (glyphFlags & HEPR_GLYPH_FLAG.Invisible) === 0 || clipping;
    fontUsed.set(glyphId, outlineRequired || fontUsed.get(glyphId) === true);
    if (clipping) clippingGlyphs[fontIndex].add(glyphId);
  }

  for (const run of compilation.runs) {
    for (let index = run.first; index < run.first + run.count; index += 1) {
      if ((index & 0x3fff) === 0) throwIfAborted(options.signal);
      if (compilation.glyphs.fontIndices[index] !== run.fontIndex) {
        throw new PdfError("invalid-object", "A native text run spans a glyph from another font.");
      }
    }
  }

  const pathVerbOffsets: number[] = [0];
  const verbs: number[] = [];
  const verbCoordinateOffsets: number[] = [0];
  const coordinates: number[] = [];
  const bounds: number[] = [];
  const flags: number[] = [];
  const glyphOffsets: number[] = [0];
  const glyphIds: number[] = [];
  const outlinePathStarts: number[] = [];
  const outlinePathCounts: number[] = [];
  const type3ProgramIndices: number[] = [];

  // Font-store encoding is deterministic and page-local: glyphOffsets spans
  // ascending glyphIds for each contiguous font index. An ordinary outline is
  // one generic path (possibly containing several closed contours); a Type3
  // glyph instead owns a reusable-program index, and invisible-only glyphs own
  // neither. All path spans below are relative to outlinePaths path zero.
  for (let fontIndex = 0; fontIndex < byIndex.length; fontIndex += 1) {
    throwIfAborted(options.signal);
    const font = byIndex[fontIndex]!;
    const glyphs = [...used[fontIndex].entries()].sort((left, right) => left[0] - right[0]);
    for (const [glyphId, visible] of glyphs) {
      throwIfAborted(options.signal);
      glyphIds.push(glyphId);
      const pathStart = pathVerbOffsets.length - 1;
      if (!visible) {
        outlinePathStarts.push(pathStart);
        outlinePathCounts.push(0);
        type3ProgramIndices.push(-1);
        continue;
      }
      if (font.subtype === "Type3") {
        if (clippingGlyphs[fontIndex].has(glyphId)) {
          throw new PdfError(
            "unsupported-content",
            `Type3 clipping glyph ${glyphId} cannot be reduced to an exact outline.`,
            { details: { reason: "type3-text-clip", fontIndex, glyphId } }
          );
        }
        const programIndex = options.type3ProgramIndices?.get(`${fontIndex}:${glyphId}`);
        if (
          programIndex === undefined || !Number.isSafeInteger(programIndex) ||
          programIndex < 0 || programIndex > MAX_INT32
        ) {
          throw new PdfError(
            "unsupported-font",
            `Visible Type3 glyph ${glyphId} in font ${font.baseFont || "(unnamed)"} has no compiled CharProc program.`,
            { details: { reason: "type3-program-missing", fontIndex, glyphId } }
          );
        }
        outlinePathStarts.push(pathStart);
        outlinePathCounts.push(0);
        type3ProgramIndices.push(programIndex);
        continue;
      }
      const outline = font.getGlyphOutline(glyphId);
      throwIfAborted(options.signal);
      validateOutline(
        outline,
        glyphId,
        limits,
        verbs.length,
        coordinates.length,
        options.signal
      );
      if (outline.commands.length === 0) {
        outlinePathStarts.push(pathStart);
        outlinePathCounts.push(0);
        type3ProgramIndices.push(-1);
        continue;
      }
      if (pathStart >= limits.maxPaths) {
        throw resourceLimit("Page glyph outlines exceed the configured path limit.", {
          maxPaths: limits.maxPaths
        });
      }
      appendOutline(
        outline.commands,
        outline.bounds,
        pathVerbOffsets,
        verbs,
        verbCoordinateOffsets,
        coordinates,
        bounds,
        flags,
        options.signal
      );
      outlinePathStarts.push(pathStart);
      outlinePathCounts.push(1);
      type3ProgramIndices.push(-1);
    }
    glyphOffsets.push(glyphIds.length);
  }

  const fonts = byIndex as NativePdfFont[];
  const textIndex = buildPageTextIndex(compilation, fonts, limits, options.signal);
  return Object.freeze({
    ...compilation,
    textIndex,
    fonts: {
      names: Object.freeze(fonts.map((font) => font.baseFont)),
      kinds: Uint8Array.from(fonts.map(fontKind)),
      unitsPerEm: Uint32Array.from(fonts.map((font) => font.unitsPerEm)),
      ascents: Float32Array.from(fonts.map((font) =>
        font.descriptor.ascent * font.unitsPerEm / 1000
      )),
      descents: Float32Array.from(fonts.map((font) =>
        font.descriptor.descent * font.unitsPerEm / 1000
      )),
      glyphOffsets: Uint32Array.from(glyphOffsets),
      glyphIds: Uint32Array.from(glyphIds),
      outlinePathStarts: Uint32Array.from(outlinePathStarts),
      outlinePathCounts: Uint32Array.from(outlinePathCounts),
      type3ProgramIndices: Int32Array.from(type3ProgramIndices)
    },
    outlinePaths: {
      pathVerbOffsets: Uint32Array.from(pathVerbOffsets),
      verbs: Uint8Array.from(verbs),
      verbCoordinateOffsets: Uint32Array.from(verbCoordinateOffsets),
      coordinates: Float32Array.from(coordinates),
      bounds: Float32Array.from(bounds),
      flags: Uint8Array.from(flags)
    }
  });
}

function resolveLimits(options: NativePageTextResourceOptions): ResolvedPageTextLimits {
  const maxGlyphs = readLimit(
    options.maxGlyphs ?? DEFAULT_PDF_RESOURCE_LIMITS.maxGlyphsPerPage,
    "maxGlyphs",
    MAX_INT32
  );
  return {
    maxPaths: readLimit(options.maxPaths, "maxPaths", MAX_UINT32),
    maxGlyphs,
    maxFonts: readLimit(options.maxFonts ?? 1_000_000, "maxFonts", MAX_UINT32),
    maxTransforms: readLimit(options.maxTransforms ?? maxGlyphs + 1, "maxTransforms", MAX_UINT32),
    maxPathVerbs: readLimit(
      options.maxPathVerbs ?? DEFAULT_PDF_RESOURCE_LIMITS.maxPathVerbsPerPage,
      "maxPathVerbs",
      MAX_UINT32
    ),
    maxPathCoordinates: readLimit(
      options.maxPathCoordinates ?? DEFAULT_PDF_RESOURCE_LIMITS.maxPathCoordinatesPerPage,
      "maxPathCoordinates",
      MAX_UINT32
    ),
    maxFallbackQuads: readLimit(
      options.maxFallbackQuads ?? maxGlyphs,
      "maxFallbackQuads",
      MAX_INT32 - 1
    ),
    maxTextCodeUnits: readLimit(
      options.maxTextCodeUnits ?? MAX_TEXT_CODE_UNITS,
      "maxTextCodeUnits",
      MAX_INT32
    )
  };
}

function validateCompilation(
  compilation: NativeTextCompilation,
  limits: ResolvedPageTextLimits,
  signal?: AbortSignal
): void {
  const { transforms, glyphs, textIndex, runs } = compilation;
  if (!(transforms.values instanceof Float32Array) || transforms.values.length < 6 ||
      transforms.values.length % 6 !== 0) {
    throw invalidObject("Native text transforms must contain complete affine matrices.");
  }
  const transformCount = transforms.values.length / 6;
  if (transformCount > limits.maxTransforms) {
    throw resourceLimit("Page text exceeds the configured transform limit.", {
      maxTransforms: limits.maxTransforms
    });
  }
  for (let index = 0; index < transforms.values.length; index += 1) {
    if ((index & 0xffff) === 0) throwIfAborted(signal);
    const value = transforms.values[index];
    if (!Number.isFinite(value)) throw invalidObject("Native text transforms must be finite.");
  }

  if (
    !(glyphs.fontIndices instanceof Uint32Array) ||
    !(glyphs.characterCodes instanceof Uint32Array) ||
    !(glyphs.glyphIds instanceof Uint32Array) ||
    !(glyphs.transformIndices instanceof Uint32Array) ||
    !(glyphs.advances instanceof Float32Array) ||
    !(glyphs.flags instanceof Uint8Array)
  ) {
    throw invalidObject("Native text glyph stores use invalid typed-array encodings.");
  }
  const glyphCount = glyphs.glyphIds.length;
  if (
    glyphs.fontIndices.length !== glyphCount ||
    glyphs.characterCodes.length !== glyphCount ||
    glyphs.transformIndices.length !== glyphCount ||
    glyphs.advances.length !== glyphCount * 2 ||
    glyphs.flags.length !== glyphCount
  ) {
    throw invalidObject("Native text glyph stores have inconsistent lengths.");
  }
  if (glyphCount > limits.maxGlyphs) {
    throw resourceLimit("Page text exceeds the configured glyph limit.", {
      maxGlyphs: limits.maxGlyphs
    });
  }
  const knownGlyphFlags = HEPR_GLYPH_FLAG.Vertical | HEPR_GLYPH_FLAG.Invisible |
    HEPR_GLYPH_FLAG.Type3 | HEPR_GLYPH_FLAG.ClipOnly;
  for (let index = 0; index < glyphCount; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    if (glyphs.transformIndices[index] >= transformCount) {
      throw invalidObject("A native glyph references a missing transform.");
    }
    if ((glyphs.flags[index] & ~knownGlyphFlags) !== 0) {
      throw invalidObject("A native glyph uses unknown glyph flags.");
    }
    if (!Number.isFinite(glyphs.advances[index * 2]) ||
        !Number.isFinite(glyphs.advances[index * 2 + 1])) {
      throw invalidObject("Native glyph advances must be finite.");
    }
  }

  if (
    textIndex.version !== 1 || typeof textIndex.text !== "string" ||
    !(textIndex.charGlyphIndices instanceof Int32Array) ||
    !(textIndex.fallbackQuads instanceof Float32Array)
  ) {
    throw invalidObject("Native text index has an invalid encoding.");
  }
  if (textIndex.text.length !== textIndex.charGlyphIndices.length) {
    throw invalidObject("Native text and character geometry mappings have different lengths.");
  }
  if (textIndex.text.length > limits.maxTextCodeUnits) {
    throw resourceLimit("Page text exceeds the configured Unicode-index limit.", {
      maxTextCodeUnits: limits.maxTextCodeUnits
    });
  }
  if (textIndex.fallbackQuads.length % 4 !== 0) {
    throw invalidObject("Native fallback text geometry must contain complete bounds.");
  }
  const fallbackCount = textIndex.fallbackQuads.length / 4;
  if (fallbackCount > limits.maxFallbackQuads) {
    throw resourceLimit("Page text exceeds the configured fallback-quad limit.", {
      maxFallbackQuads: limits.maxFallbackQuads
    });
  }
  for (let index = 0; index < fallbackCount; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    const offset = index * 4;
    const minX = textIndex.fallbackQuads[offset];
    const minY = textIndex.fallbackQuads[offset + 1];
    const maxX = textIndex.fallbackQuads[offset + 2];
    const maxY = textIndex.fallbackQuads[offset + 3];
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX > maxX || minY > maxY) {
      throw invalidObject("Native fallback text bounds must be finite and ordered.");
    }
  }
  for (let index = 0; index < textIndex.charGlyphIndices.length; index += 1) {
    if ((index & 0xffff) === 0) throwIfAborted(signal);
    const reference = textIndex.charGlyphIndices[index];
    if (reference >= glyphCount || (reference <= -2 && -reference - 2 >= fallbackCount)) {
      throw invalidObject("Native text index contains an out-of-range geometry reference.");
    }
  }

  let nextGlyph = 0;
  for (const run of runs) {
    throwIfAborted(signal);
    if (
      !Number.isSafeInteger(run.first) || !Number.isSafeInteger(run.count) ||
      !Number.isSafeInteger(run.fontIndex) || !Number.isInteger(run.renderingMode) ||
      run.first !== nextGlyph || run.count <= 0 || run.fontIndex < 0 ||
      run.renderingMode < 0 || run.renderingMode > 7 ||
      run.first > glyphCount - run.count
    ) {
      throw invalidObject("Native text runs are not a complete ordered glyph partition.");
    }
    for (let index = run.first; index < run.first + run.count; index += 1) {
      if ((index & 0x3fff) === 0) throwIfAborted(signal);
      const flags = glyphs.flags[index];
      const expectedInvisible = run.renderingMode === 3 || run.renderingMode === 7;
      const expectedClipping = run.renderingMode >= 4;
      if (((flags & HEPR_GLYPH_FLAG.Invisible) !== 0) !== expectedInvisible) {
        throw invalidObject("Text invisibility flags do not match the rendering mode.");
      }
      if (((flags & HEPR_GLYPH_FLAG.ClipOnly) !== 0) !== expectedClipping) {
        throw invalidObject("Text clipping flags do not match the rendering mode.");
      }
    }
    nextGlyph += run.count;
  }
  if (nextGlyph !== glyphCount) {
    throw invalidObject("Native text runs do not cover every glyph exactly once.");
  }
}

function validateFont(font: NativePdfFont, fontIndex: number): void {
  if (
    typeof font !== "object" || font === null ||
    typeof font.descriptor !== "object" || font.descriptor === null ||
    typeof font.getGlyphOutline !== "function" ||
    typeof font.baseFont !== "string" || (font.writingMode !== 0 && font.writingMode !== 1)
  ) {
    throw new PdfError("unsupported-font", "A native page font has invalid metadata.", {
      details: { fontIndex }
    });
  }
  if (!Number.isSafeInteger(font.unitsPerEm) || font.unitsPerEm <= 0 ||
      font.unitsPerEm > MAX_UINT32) {
    throw new PdfError("unsupported-font", "A native page font has invalid unitsPerEm.", {
      details: { fontIndex, unitsPerEm: font.unitsPerEm }
    });
  }
  storeFloat32(font.descriptor.ascent * font.unitsPerEm / 1000, "font ascent");
  storeFloat32(font.descriptor.descent * font.unitsPerEm / 1000, "font descent");
  const bbox = font.descriptor.fontBBox;
  if (bbox !== null) {
    const values = bbox.map((value) => storeFloat32(value, "font bounding-box value"));
    if (values[0] > values[2] || values[1] > values[3]) {
      throw new PdfError("unsupported-font", "A native page font has an unordered bounding box.", {
        details: { fontIndex }
      });
    }
  }
}

function validateOutline(
  outline: NativeGlyphOutline,
  expectedGlyphId: number,
  limits: ResolvedPageTextLimits,
  currentVerbs: number,
  currentCoordinates: number,
  signal?: AbortSignal
): void {
  if (
    typeof outline !== "object" || outline === null ||
    outline.glyphId !== expectedGlyphId || !Array.isArray(outline.commands) ||
    !Array.isArray(outline.bounds) || outline.bounds.length !== 4
  ) {
    throw new PdfError("unsupported-font", "A native font returned an outline for the wrong glyph.");
  }
  storeFloat32(outline.advanceWidth, "glyph outline advance");
  storeFloat32(outline.leftSideBearing, "glyph outline side bearing");
  const outlineBounds = outline.bounds.map((value) => storeFloat32(value, "glyph outline bound"));
  if (outlineBounds[0] > outlineBounds[2] || outlineBounds[1] > outlineBounds[3]) {
    throw new PdfError("unsupported-font", "A native font returned unordered glyph bounds.");
  }
  if (outline.commands.length > limits.maxPathVerbs - currentVerbs) {
    throw resourceLimit("Page glyph outlines exceed the configured path-verb limit.", {
      maxPathVerbs: limits.maxPathVerbs
    });
  }
  let coordinateCount = 0;
  let contourOpen = false;
  for (let index = 0; index < outline.commands.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    const command = outline.commands[index];
    switch (command.kind) {
      case "move":
        if (contourOpen) {
          throw new PdfError("unsupported-font", "A glyph outline starts a contour before closing the prior contour.");
        }
        storeFloat32(command.x, "glyph move x");
        storeFloat32(command.y, "glyph move y");
        coordinateCount += 2;
        contourOpen = true;
        break;
      case "line":
        if (!contourOpen) throw new PdfError("unsupported-font", "A glyph line occurs outside a contour.");
        storeFloat32(command.x, "glyph line x");
        storeFloat32(command.y, "glyph line y");
        coordinateCount += 2;
        break;
      case "quadratic":
        if (!contourOpen) throw new PdfError("unsupported-font", "A glyph curve occurs outside a contour.");
        storeFloat32(command.controlX, "glyph quadratic control x");
        storeFloat32(command.controlY, "glyph quadratic control y");
        storeFloat32(command.x, "glyph quadratic x");
        storeFloat32(command.y, "glyph quadratic y");
        coordinateCount += 4;
        break;
      case "cubic":
        if (!contourOpen) throw new PdfError("unsupported-font", "A glyph curve occurs outside a contour.");
        storeFloat32(command.control1X, "glyph cubic first control x");
        storeFloat32(command.control1Y, "glyph cubic first control y");
        storeFloat32(command.control2X, "glyph cubic second control x");
        storeFloat32(command.control2Y, "glyph cubic second control y");
        storeFloat32(command.x, "glyph cubic x");
        storeFloat32(command.y, "glyph cubic y");
        coordinateCount += 6;
        break;
      case "close":
        if (!contourOpen) throw new PdfError("unsupported-font", "A glyph contour is closed without a start.");
        contourOpen = false;
        break;
      default:
        throw new PdfError("unsupported-font", "A native font returned an unsupported outline command.");
    }
  }
  if (contourOpen) throw new PdfError("unsupported-font", "A native font returned an open glyph contour.");
  if (coordinateCount > limits.maxPathCoordinates - currentCoordinates) {
    throw resourceLimit("Page glyph outlines exceed the configured path-coordinate limit.", {
      maxPathCoordinates: limits.maxPathCoordinates
    });
  }
}

function buildPageTextIndex(
  compilation: NativeTextCompilation,
  fonts: readonly NativePdfFont[],
  limits: ResolvedPageTextLimits,
  signal?: AbortSignal
): HeprTextIndex {
  // Preserve the compiler's UTF-16 mapping one code unit at a time. Invisible
  // glyph references are rewritten to one shared page-native AABB per glyph
  // instance so OCR remains selectable even when no outline program exists.
  const references = new Int32Array(compilation.textIndex.charGlyphIndices);
  const fallbackQuads = Array.from(compilation.textIndex.fallbackQuads);
  const fallbackByGlyph = new Map<number, number>();
  for (let position = 0; position < references.length; position += 1) {
    if ((position & 0x3fff) === 0) throwIfAborted(signal);
    const glyphIndex = references[position];
    if (glyphIndex < 0 ||
        (compilation.glyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.Invisible) === 0) {
      continue;
    }
    let fallbackIndex = fallbackByGlyph.get(glyphIndex);
    if (fallbackIndex === undefined) {
      fallbackIndex = fallbackQuads.length / 4;
      if (fallbackIndex >= limits.maxFallbackQuads) {
        throw resourceLimit("Page text exceeds the configured fallback-quad limit.", {
          maxFallbackQuads: limits.maxFallbackQuads
        });
      }
      const fontIndex = compilation.glyphs.fontIndices[glyphIndex];
      fallbackQuads.push(...invisibleGlyphBounds(compilation, glyphIndex, fonts[fontIndex]));
      fallbackByGlyph.set(glyphIndex, fallbackIndex);
    }
    references[position] = -fallbackIndex - 2;
  }
  return {
    version: 1,
    text: compilation.textIndex.text,
    charGlyphIndices: references,
    fallbackQuads: Float32Array.from(fallbackQuads)
  };
}

function invisibleGlyphBounds(
  compilation: NativeTextCompilation,
  glyphIndex: number,
  font: NativePdfFont
): [number, number, number, number] {
  const transformIndex = compilation.glyphs.transformIndices[glyphIndex];
  const offset = transformIndex * 6;
  const matrix = compilation.transforms.values.subarray(offset, offset + 6);
  const unitsPerEm = font.unitsPerEm;
  const sourceBounds = font.descriptor.fontBBox ?? [
    0,
    Math.min(font.descriptor.descent, -250),
    1000,
    Math.max(font.descriptor.ascent, 850)
  ];
  let minX = sourceBounds[0] * unitsPerEm / 1000;
  let minY = sourceBounds[1] * unitsPerEm / 1000;
  let maxX = sourceBounds[2] * unitsPerEm / 1000;
  let maxY = sourceBounds[3] * unitsPerEm / 1000;
  // A zero-area descriptor is not useful for OCR hit testing. Use one em only
  // for missing dimensions; this is indexing geometry, never painted content.
  if (minX === maxX) [minX, maxX] = [0, unitsPerEm];
  if (minY === maxY) [minY, maxY] = [-unitsPerEm / 4, unitsPerEm * 0.85];
  const corners = [
    transformPoint(matrix, minX, minY),
    transformPoint(matrix, minX, maxY),
    transformPoint(matrix, maxX, minY),
    transformPoint(matrix, maxX, maxY)
  ];
  return [
    storeFloat32(Math.min(...corners.map((point) => point[0])), "invisible text bound"),
    storeFloat32(Math.min(...corners.map((point) => point[1])), "invisible text bound"),
    storeFloat32(Math.max(...corners.map((point) => point[0])), "invisible text bound"),
    storeFloat32(Math.max(...corners.map((point) => point[1])), "invisible text bound")
  ];
}

function transformPoint(
  matrix: Float32Array,
  x: number,
  y: number
): readonly [number, number] {
  const transformedX = matrix[0] * x + matrix[2] * y + matrix[4];
  const transformedY = matrix[1] * x + matrix[3] * y + matrix[5];
  if (!Number.isFinite(transformedX) || !Number.isFinite(transformedY)) {
    throw invalidObject("Invisible text geometry overflows page-native coordinates.");
  }
  return [transformedX, transformedY];
}

function appendOutline(
  commands: readonly NativeGlyphPathCommand[],
  outlineBounds: readonly [number, number, number, number],
  pathVerbOffsets: number[],
  verbs: number[],
  verbCoordinateOffsets: number[],
  coordinates: number[],
  bounds: number[],
  flags: number[],
  signal?: AbortSignal
): void {
  let closed = false;
  for (let index = 0; index < commands.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    const command = commands[index];
    switch (command.kind) {
      case "move":
        verbs.push(HEPR_PATH_VERB.MoveTo);
        coordinates.push(storeFloat32(command.x, "glyph move x"), storeFloat32(command.y, "glyph move y"));
        break;
      case "line":
        verbs.push(HEPR_PATH_VERB.LineTo);
        coordinates.push(storeFloat32(command.x, "glyph line x"), storeFloat32(command.y, "glyph line y"));
        break;
      case "quadratic":
        verbs.push(HEPR_PATH_VERB.QuadraticTo);
        coordinates.push(
          storeFloat32(command.controlX, "glyph quadratic control x"),
          storeFloat32(command.controlY, "glyph quadratic control y"),
          storeFloat32(command.x, "glyph quadratic x"),
          storeFloat32(command.y, "glyph quadratic y")
        );
        break;
      case "cubic":
        verbs.push(HEPR_PATH_VERB.CubicTo);
        coordinates.push(
          storeFloat32(command.control1X, "glyph cubic first control x"),
          storeFloat32(command.control1Y, "glyph cubic first control y"),
          storeFloat32(command.control2X, "glyph cubic second control x"),
          storeFloat32(command.control2Y, "glyph cubic second control y"),
          storeFloat32(command.x, "glyph cubic x"),
          storeFloat32(command.y, "glyph cubic y")
        );
        break;
      case "close":
        verbs.push(HEPR_PATH_VERB.Close);
        closed = true;
        break;
    }
    verbCoordinateOffsets.push(coordinates.length);
  }
  pathVerbOffsets.push(verbs.length);
  bounds.push(...outlineBounds.map((value) => storeFloat32(value, "glyph outline bound")));
  flags.push(closed ? HEPR_PATH_FLAG.Closed : 0);
}

function fontKind(font: NativePdfFont): number {
  if (font.subtype === "Type3") return HEPR_FONT_KIND.Type3;
  switch (font.descriptor.embeddedKind) {
    case "opentype": return HEPR_FONT_KIND.OpenType;
    case "cff": return HEPR_FONT_KIND.Cff;
    case "cff2": return HEPR_FONT_KIND.Cff2;
    case "type1": return HEPR_FONT_KIND.Type1;
    case "truetype": return HEPR_FONT_KIND.TrueType;
    default:
      return font.subtype === "Type1" || font.subtype === "MMType1"
        ? HEPR_FONT_KIND.Type1
        : HEPR_FONT_KIND.TrueType;
  }
}

function readLimit(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`Native page text ${name} must be a positive integer no greater than ${maximum}.`);
  }
  return value;
}

function storeFloat32(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw invalidObject(`${label} must be finite.`);
  }
  const stored = Math.fround(value);
  if (!Number.isFinite(stored)) {
    throw invalidObject(`${label} exceeds Float32 storage range.`);
  }
  return Object.is(stored, -0) ? 0 : stored;
}

function invalidObject(message: string): PdfError {
  return new PdfError("invalid-object", message);
}

function resourceLimit(
  message: string,
  details: Readonly<Record<string, number>>
): PdfError {
  return new PdfError("resource-limit", message, { details });
}
