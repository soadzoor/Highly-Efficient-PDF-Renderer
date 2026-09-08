import type {
  NativeGlyphOutline,
  NativeGlyphPathCommand
} from "./nativeFont";
import { PdfError } from "./nativeTypes";

/** Independent ceilings for the object-heavy CFF and Type 2 interpreters. */
export interface NativeCffParserLimits {
  readonly maxCffBytes: number;
  readonly maxCffIndexEntries: number;
  readonly maxCffStringBytes: number;
  readonly maxType2CharStringBytes: number;
  readonly maxType2Operators: number;
  readonly maxType2SubrDepth: number;
  readonly maxType2SubrCalls: number;
  readonly maxType2PathCommands: number;
}

export const DEFAULT_NATIVE_CFF_PARSER_LIMITS: Readonly<NativeCffParserLimits> = Object.freeze({
  maxCffBytes: 64 * 1024 * 1024,
  maxCffIndexEntries: 1_000_000,
  maxCffStringBytes: 16 * 1024 * 1024,
  maxType2CharStringBytes: 16 * 1024 * 1024,
  maxType2Operators: 1_000_000,
  maxType2SubrDepth: 32,
  maxType2SubrCalls: 4_096,
  maxType2PathCommands: 1_000_000
});

interface CffIndex {
  readonly objects: readonly Uint8Array[];
  readonly end: number;
}

interface RawGlyphOutline {
  readonly commands: readonly NativeGlyphPathCommand[];
  readonly advanceWidth: number;
}

interface Type2Budget {
  executedBytes: number;
  operators: number;
  subrCalls: number;
}

interface Type2Seac {
  readonly accentX: number;
  readonly accentY: number;
  readonly baseCode: number;
  readonly accentCode: number;
}

/**
 * Bounds-checked CFF v1, name-keyed Type 2 outline provider.
 *
 * CID-keyed CFF, CFF2, Multiple Master blend programs, and deterministicly
 * unsafe Type 2 operations fail with typed errors instead of being omitted.
 */
export class NativeCffFont {
  readonly unitsPerEm = 1000;
  readonly numGlyphs: number;
  readonly glyphNames: readonly string[];
  readonly builtInGlyphNames: readonly (string | null)[];

  private readonly charStrings: readonly Uint8Array[];
  private readonly localSubrs: readonly Uint8Array[];
  private readonly globalSubrs: readonly Uint8Array[];
  private readonly defaultWidthX: number;
  private readonly nominalWidthX: number;
  private readonly fontMatrix: readonly [number, number, number, number, number, number];
  private readonly limits: Readonly<NativeCffParserLimits>;
  private readonly glyphIdsByName: ReadonlyMap<string, number>;
  private readonly rawOutlineCache = new Map<number, RawGlyphOutline>();
  private readonly outlineCache = new Map<number, NativeGlyphOutline>();

  private constructor(options: {
    readonly charStrings: readonly Uint8Array[];
    readonly localSubrs: readonly Uint8Array[];
    readonly globalSubrs: readonly Uint8Array[];
    readonly glyphNames: readonly string[];
    readonly builtInGlyphNames: readonly (string | null)[];
    readonly defaultWidthX: number;
    readonly nominalWidthX: number;
    readonly fontMatrix: readonly [number, number, number, number, number, number];
    readonly limits: Readonly<NativeCffParserLimits>;
  }) {
    this.charStrings = options.charStrings;
    this.localSubrs = options.localSubrs;
    this.globalSubrs = options.globalSubrs;
    this.glyphNames = options.glyphNames;
    this.builtInGlyphNames = options.builtInGlyphNames;
    this.defaultWidthX = options.defaultWidthX;
    this.nominalWidthX = options.nominalWidthX;
    this.fontMatrix = options.fontMatrix;
    this.limits = options.limits;
    this.numGlyphs = options.charStrings.length;
    const glyphIds = new Map<string, number>();
    for (let glyphId = 0; glyphId < options.glyphNames.length; glyphId += 1) {
      const name = options.glyphNames[glyphId];
      if (glyphIds.has(name)) {
        throw cffUnsupported(`The CFF charset contains duplicate glyph name /${name}.`,
          "cff-charset-duplicate-name");
      }
      glyphIds.set(name, glyphId);
    }
    this.glyphIdsByName = glyphIds;
  }

  static parse(
    sourceBytes: Uint8Array,
    limitOverrides: Partial<NativeCffParserLimits> = {}
  ): NativeCffFont {
    const limits = mergeCffLimits(limitOverrides);
    if (!(sourceBytes instanceof Uint8Array)) {
      throw new TypeError("CFF source must be a Uint8Array.");
    }
    if (sourceBytes.length > limits.maxCffBytes) {
      throw cffLimit("The CFF program exceeds the configured byte limit.",
        "cff-byte-limit", limits.maxCffBytes);
    }
    if (sourceBytes.length < 4) {
      throw cffUnsupported("The CFF header is truncated.", "cff-header-truncated");
    }
    if (sourceBytes[0] !== 1) {
      throw cffUnsupported(
        sourceBytes[0] === 2
          ? "CFF2 outlines require the native CFF2 engine, which is not available."
          : `CFF major version ${sourceBytes[0]} is not supported.`,
        sourceBytes[0] === 2 ? "cff2-not-supported" : "cff-version"
      );
    }
    const headerSize = sourceBytes[2];
    const headerOffSize = sourceBytes[3];
    if (headerSize < 4 || headerSize > sourceBytes.length || headerOffSize < 1 || headerOffSize > 4) {
      throw cffUnsupported("The CFF header has invalid bounds.", "cff-header-bounds");
    }

    const reader = new CffReader(sourceBytes, limits);
    const names = reader.readIndex(headerSize, "Name INDEX");
    if (names.objects.length !== 1) {
      throw cffUnsupported(
        "A PDF Type1C font must contain exactly one name-keyed CFF font.",
        "cff-font-count"
      );
    }
    readCffName(names.objects[0], "CFF font name");
    const topIndexes = reader.readIndex(names.end, "Top DICT INDEX");
    if (topIndexes.objects.length !== 1) {
      throw cffUnsupported(
        "A PDF Type1C font must contain exactly one Top DICT.",
        "cff-top-dict-count"
      );
    }
    const stringsIndex = reader.readIndex(topIndexes.end, "String INDEX");
    let stringBytes = 0;
    const customStrings = stringsIndex.objects.map((bytes, index) => {
      stringBytes = checkedAdd(stringBytes, bytes.length, "CFF String INDEX bytes");
      if (stringBytes > limits.maxCffStringBytes) {
        throw cffLimit("The CFF String INDEX exceeds the configured byte limit.",
          "cff-string-byte-limit", limits.maxCffStringBytes);
      }
      return readCffString(bytes, `CFF String INDEX entry ${index}`);
    });
    const globalSubrsIndex = reader.readIndex(stringsIndex.end, "Global Subrs INDEX");
    const top = parseCffDict(topIndexes.objects[0], "Top DICT", TOP_DICT_OPERATORS);

    if (top.has(dictOperator(12, 30)) || top.has(dictOperator(12, 36)) || top.has(dictOperator(12, 37))) {
      throw cffUnsupported(
        "CID-keyed CFF outlines require the native CID CFF engine, which is not available.",
        "cff-cid-not-supported"
      );
    }
    // 12 20 is SyntheticBase: those glyphs are defined against another font and
    // cannot be read from this CharStrings INDEX alone. 12 23 is BaseFontBlend,
    // a delta left behind by Multiple Master tooling that carries no blend axes
    // and no interpolation state, so a font holding it is read normally.
    if (top.has(dictOperator(12, 20))) {
      throw cffUnsupported(
        "Synthetic CFF fonts are not supported.",
        "cff-synthetic-not-supported"
      );
    }
    const charStringType = readOptionalSingleton(top, dictOperator(12, 6), 2, "CharstringType");
    if (charStringType !== 2) {
      throw cffUnsupported(
        `CFF CharstringType ${charStringType} is not supported.`,
        "cff-charstring-type"
      );
    }
    const charStringsOffset = readRequiredOffset(top, dictOperator(17), "CharStrings");
    const charStringsIndex = reader.readIndex(charStringsOffset, "CharStrings INDEX");
    if (charStringsIndex.objects.length === 0) {
      throw cffUnsupported("The CFF CharStrings INDEX is empty.", "cff-charstrings-empty");
    }

    const privateOperands = top.get(dictOperator(18));
    if (!privateOperands || privateOperands.length !== 2) {
      throw cffUnsupported("The CFF Top DICT has no valid Private DICT range.",
        "cff-private-range");
    }
    const privateSize = requireNonnegativeInteger(privateOperands[0], "CFF Private DICT size");
    const privateOffset = requireNonnegativeInteger(privateOperands[1], "CFF Private DICT offset");
    const privateBytes = reader.slice(privateOffset, privateSize, "Private DICT");
    const privateDictionary = parseCffDict(privateBytes, "Private DICT", PRIVATE_DICT_OPERATORS);
    const defaultWidthX = readOptionalSingleton(
      privateDictionary, dictOperator(20), 0, "defaultWidthX"
    );
    const nominalWidthX = readOptionalSingleton(
      privateDictionary, dictOperator(21), 0, "nominalWidthX"
    );
    const localSubrOperands = privateDictionary.get(dictOperator(19));
    let localSubrs: readonly Uint8Array[] = Object.freeze([]);
    if (localSubrOperands) {
      if (localSubrOperands.length !== 1) {
        throw cffUnsupported("The CFF Private DICT /Subrs offset is invalid.",
          "cff-local-subrs-offset");
      }
      const relativeOffset = requireNonnegativeInteger(
        localSubrOperands[0], "CFF local Subrs offset"
      );
      const absoluteOffset = checkedAdd(privateOffset, relativeOffset, "CFF local Subrs offset");
      localSubrs = reader.readIndex(absoluteOffset, "Local Subrs INDEX").objects;
    }

    const glyphNames = readCffCharset(
      reader,
      readOptionalOffset(top, dictOperator(15), 0, "charset"),
      charStringsIndex.objects.length,
      customStrings
    );
    const glyphIds = new Map(glyphNames.map((name, glyphId) => [name, glyphId] as const));
    const builtInGlyphNames = readCffEncoding(
      reader,
      readOptionalOffset(top, dictOperator(16), 0, "Encoding"),
      glyphNames,
      glyphIds,
      customStrings
    );
    const fontMatrixValues = top.get(dictOperator(12, 7)) ?? [0.001, 0, 0, 0.001, 0, 0];
    if (fontMatrixValues.length !== 6 || fontMatrixValues.some((value) => !Number.isFinite(value))) {
      throw cffUnsupported("The CFF FontMatrix is invalid.", "cff-font-matrix");
    }
    const determinant = fontMatrixValues[0] * fontMatrixValues[3] -
      fontMatrixValues[1] * fontMatrixValues[2];
    if (!Number.isFinite(determinant) || determinant === 0) {
      throw cffUnsupported("The CFF FontMatrix is singular.", "cff-font-matrix");
    }

    return new NativeCffFont({
      charStrings: charStringsIndex.objects,
      localSubrs,
      globalSubrs: globalSubrsIndex.objects,
      glyphNames,
      builtInGlyphNames,
      defaultWidthX,
      nominalWidthX,
      fontMatrix: Object.freeze(fontMatrixValues.slice()) as unknown as readonly [
        number, number, number, number, number, number
      ],
      limits
    });
  }

  glyphIdForName(name: string | null): number {
    return name === null ? 0 : this.glyphIdsByName.get(name) ?? 0;
  }

  getGlyphOutline(glyphId: number): NativeGlyphOutline {
    if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId >= this.numGlyphs) {
      throw cffUnsupported(`CFF glyph ${glyphId} is outside the CharStrings INDEX.`,
        "cff-glyph-index");
    }
    const cached = this.outlineCache.get(glyphId);
    if (cached) return cached;
    const budget: Type2Budget = { executedBytes: 0, operators: 0, subrCalls: 0 };
    const raw = this.evaluateRawGlyph(glyphId, new Set(), 0, budget);
    const commands = Object.freeze(raw.commands.map((command) =>
      Object.freeze(transformCommand(command, this.fontMatrix))
    ));
    const bounds = measureCommands(commands);
    const advanceWidth = transformWidth(raw.advanceWidth, this.fontMatrix);
    const outline: NativeGlyphOutline = Object.freeze({
      glyphId,
      commands,
      bounds,
      advanceWidth,
      leftSideBearing: bounds[0]
    });
    this.outlineCache.set(glyphId, outline);
    return outline;
  }

  private evaluateRawGlyph(
    glyphId: number,
    glyphAncestry: Set<number>,
    glyphDepth: number,
    budget: Type2Budget
  ): RawGlyphOutline {
    const cached = this.rawOutlineCache.get(glyphId);
    if (cached) return cached;
    if (glyphDepth > this.limits.maxType2SubrDepth) {
      throw cffLimit("CFF composite glyph depth exceeds the configured limit.",
        "type2-glyph-depth-limit", this.limits.maxType2SubrDepth);
    }
    if (glyphAncestry.has(glyphId)) {
      throw cffUnsupported("A CFF endchar composite contains a glyph cycle.",
        "type2-glyph-cycle");
    }
    glyphAncestry.add(glyphId);
    try {
      const interpreter = new Type2Interpreter({
        glyphId,
        charString: this.charStrings[glyphId],
        localSubrs: this.localSubrs,
        globalSubrs: this.globalSubrs,
        defaultWidthX: this.defaultWidthX,
        nominalWidthX: this.nominalWidthX,
        limits: this.limits,
        budget
      });
      const interpreted = interpreter.run();
      let commands = [...interpreted.commands];
      if (interpreted.seac) {
        const baseName = standardEncodingGlyphName(interpreted.seac.baseCode);
        const accentName = standardEncodingGlyphName(interpreted.seac.accentCode);
        const baseGlyphId = baseName === null ? undefined : this.glyphIdsByName.get(baseName);
        const accentGlyphId = accentName === null ? undefined : this.glyphIdsByName.get(accentName);
        if (baseGlyphId === undefined || accentGlyphId === undefined) {
          throw cffUnsupported(
            "A CFF endchar composite references a missing StandardEncoding glyph.",
            "type2-seac-missing-glyph"
          );
        }
        if (commands.length !== 0) {
          throw cffUnsupported(
            "A CFF endchar composite also contains an explicit outline.",
            "type2-seac-explicit-outline"
          );
        }
        const base = this.evaluateRawGlyph(baseGlyphId, glyphAncestry, glyphDepth + 1, budget);
        const accent = this.evaluateRawGlyph(accentGlyphId, glyphAncestry, glyphDepth + 1, budget);
        commands = [
          ...base.commands,
          ...accent.commands.map((command) => translateCommand(
            command,
            interpreted.seac!.accentX,
            interpreted.seac!.accentY
          ))
        ];
        if (commands.length > this.limits.maxType2PathCommands) {
          throw cffLimit("CFF composite glyph path commands exceed the configured limit.",
            "type2-path-command-limit", this.limits.maxType2PathCommands);
        }
      }
      const result: RawGlyphOutline = Object.freeze({
        commands: Object.freeze(commands),
        advanceWidth: interpreted.advanceWidth
      });
      this.rawOutlineCache.set(glyphId, result);
      return result;
    } finally {
      glyphAncestry.delete(glyphId);
    }
  }
}

class CffReader {
  private readonly bytes: Uint8Array;
  private readonly limits: Readonly<NativeCffParserLimits>;
  private indexEntryCount = 0;

  constructor(bytes: Uint8Array, limits: Readonly<NativeCffParserLimits>) {
    this.bytes = bytes;
    this.limits = limits;
  }

  readIndex(offset: number, label: string): CffIndex {
    const count = this.u16(offset, label);
    if (count === 0) return Object.freeze({ objects: Object.freeze([]), end: offset + 2 });
    this.indexEntryCount = checkedAdd(this.indexEntryCount, count, "CFF INDEX entry count");
    if (this.indexEntryCount > this.limits.maxCffIndexEntries) {
      throw cffLimit("CFF INDEX entries exceed the configured limit.",
        "cff-index-entry-limit", this.limits.maxCffIndexEntries);
    }
    const offSizePosition = checkedAdd(offset, 2, `${label} OffSize position`);
    const offSize = this.u8(offSizePosition, label);
    if (offSize < 1 || offSize > 4) {
      throw cffUnsupported(`${label} has an invalid OffSize.`, "cff-index-offsize");
    }
    const offsetsStart = checkedAdd(offSizePosition, 1, `${label} offsets start`);
    const offsetCount = checkedAdd(count, 1, `${label} offset count`);
    const offsetBytes = checkedMultiply(offsetCount, offSize, `${label} offsets`);
    this.requireRange(offsetsStart, offsetBytes, label);
    const offsets = new Array<number>(offsetCount);
    for (let index = 0; index < offsetCount; index += 1) {
      offsets[index] = this.variableOffset(offsetsStart + index * offSize, offSize, label);
      if (offsets[index] < 1 || (index > 0 && offsets[index] < offsets[index - 1])) {
        throw cffUnsupported(`${label} offsets are invalid or unsorted.`,
          "cff-index-offsets");
      }
    }
    if (offsets[0] !== 1) {
      throw cffUnsupported(`${label} must begin at one-based offset 1.`,
        "cff-index-first-offset");
    }
    const dataStart = checkedAdd(offsetsStart, offsetBytes, `${label} data start`);
    const dataLength = offsets[offsets.length - 1] - 1;
    this.requireRange(dataStart, dataLength, label);
    const objects = new Array<Uint8Array>(count);
    for (let index = 0; index < count; index += 1) {
      const start = checkedAdd(dataStart, offsets[index] - 1, `${label} object start`);
      const length = offsets[index + 1] - offsets[index];
      objects[index] = this.bytes.subarray(start, start + length);
    }
    return Object.freeze({
      objects: Object.freeze(objects),
      end: checkedAdd(dataStart, dataLength, `${label} end`)
    });
  }

  slice(offset: number, length: number, label: string): Uint8Array {
    this.requireRange(offset, length, label);
    return this.bytes.subarray(offset, offset + length);
  }

  u8(offset: number, label: string): number {
    this.requireRange(offset, 1, label);
    return this.bytes[offset];
  }

  u16(offset: number, label: string): number {
    this.requireRange(offset, 2, label);
    return this.bytes[offset] * 256 + this.bytes[offset + 1];
  }

  private variableOffset(offset: number, size: number, label: string): number {
    this.requireRange(offset, size, label);
    let value = 0;
    for (let index = 0; index < size; index += 1) value = value * 256 + this.bytes[offset + index];
    return value;
  }

  private requireRange(offset: number, length: number, label: string): void {
    if (!rangeFits(offset, length, this.bytes.length)) {
      throw cffUnsupported(`${label} is out of bounds.`, "cff-bounds");
    }
  }
}

class Type2Interpreter {
  private readonly glyphId: number;
  private readonly charString: Uint8Array;
  private readonly localSubrs: readonly Uint8Array[];
  private readonly globalSubrs: readonly Uint8Array[];
  private readonly nominalWidthX: number;
  private readonly limits: Readonly<NativeCffParserLimits>;
  private readonly budget: Type2Budget;
  private readonly commands: NativeGlyphPathCommand[] = [];
  private readonly stack: number[] = [];
  private readonly transient = new Float64Array(32);
  private readonly activeSubrs = new Set<string>();
  private x = 0;
  private y = 0;
  private contourOpen = false;
  private stemCount = 0;
  private widthResolved = false;
  private advanceWidth: number;
  private seac: Type2Seac | null = null;

  constructor(options: {
    readonly glyphId: number;
    readonly charString: Uint8Array;
    readonly localSubrs: readonly Uint8Array[];
    readonly globalSubrs: readonly Uint8Array[];
    readonly defaultWidthX: number;
    readonly nominalWidthX: number;
    readonly limits: Readonly<NativeCffParserLimits>;
    readonly budget: Type2Budget;
  }) {
    this.glyphId = options.glyphId;
    this.charString = options.charString;
    this.localSubrs = options.localSubrs;
    this.globalSubrs = options.globalSubrs;
    this.nominalWidthX = options.nominalWidthX;
    this.limits = options.limits;
    this.budget = options.budget;
    this.advanceWidth = options.defaultWidthX;
  }

  run(): {
    readonly commands: readonly NativeGlyphPathCommand[];
    readonly advanceWidth: number;
    readonly seac: Type2Seac | null;
  } {
    const status = this.execute(this.charString, 0, true);
    if (status !== "endchar") {
      throw cffUnsupported(`CFF glyph ${this.glyphId} has no endchar operator.`,
        "type2-missing-endchar");
    }
    return Object.freeze({
      commands: Object.freeze(this.commands),
      advanceWidth: this.advanceWidth,
      seac: this.seac
    });
  }

  private execute(
    bytes: Uint8Array,
    depth: number,
    topLevel: boolean
  ): "endchar" | "return" | "eof" {
    if (depth > this.limits.maxType2SubrDepth) {
      throw cffLimit("Type 2 subroutine depth exceeds the configured limit.",
        "type2-subr-depth-limit", this.limits.maxType2SubrDepth);
    }
    this.budget.executedBytes = checkedAdd(
      this.budget.executedBytes,
      bytes.length,
      "Type 2 executed charstring bytes"
    );
    if (this.budget.executedBytes > this.limits.maxType2CharStringBytes) {
      throw cffLimit("Type 2 executed charstring bytes exceed the configured limit.",
        "type2-charstring-byte-limit", this.limits.maxType2CharStringBytes);
    }

    let offset = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      if (isType2NumberByte(byte)) {
        const number = readType2Number(bytes, offset - 1);
        offset = number.next;
        this.push(number.value);
        continue;
      }
      this.countOperator();
      switch (byte) {
        case 1: // hstem
        case 3: // vstem
        case 18: // hstemhm
        case 23: // vstemhm
          this.consumeStemArguments(false);
          break;
        case 4: { // vmoveto
          const [dy] = this.consumeMoveArguments(1, "vmoveto");
          this.moveTo(0, dy);
          break;
        }
        case 5: { // rlineto
          const values = this.consumeMultiple(2, "rlineto");
          if (values.length % 2 !== 0) this.invalid("rlineto requires coordinate pairs.");
          for (let index = 0; index < values.length; index += 2) {
            this.lineTo(values[index], values[index + 1]);
          }
          break;
        }
        case 6:
        case 7: { // hlineto / vlineto
          const values = this.consumeMultiple(1, byte === 6 ? "hlineto" : "vlineto");
          let horizontal = byte === 6;
          for (const value of values) {
            this.lineTo(horizontal ? value : 0, horizontal ? 0 : value);
            horizontal = !horizontal;
          }
          break;
        }
        case 8: { // rrcurveto
          const values = this.consumeMultiple(6, "rrcurveto");
          if (values.length % 6 !== 0) this.invalid("rrcurveto requires groups of six operands.");
          for (let index = 0; index < values.length; index += 6) {
            this.curveTo(...values.slice(index, index + 6) as [number, number, number, number, number, number]);
          }
          break;
        }
        case 10: { // callsubr
          const rawIndex = this.popInteger("callsubr index");
          const status = this.callSubroutine(
            this.localSubrs,
            rawIndex,
            "local",
            depth + 1
          );
          if (status === "endchar") return status;
          break;
        }
        case 11: // return
          if (topLevel) this.invalid("return is not valid in a top-level charstring.");
          return "return";
        case 12: {
          if (offset >= bytes.length) this.invalid("An escaped Type 2 operator is truncated.");
          const escaped = bytes[offset++];
          this.executeEscaped(escaped);
          break;
        }
        case 14: // endchar
          if (!topLevel) {
            // An endchar reached through a subroutine terminates the glyph, not
            // merely that subroutine.
          }
          this.finishEndChar();
          return "endchar";
        case 19:
        case 20: { // hintmask / cntrmask
          this.consumeStemArguments(true);
          const maskLength = Math.ceil(this.stemCount / 8);
          if (!rangeFits(offset, maskLength, bytes.length)) {
            this.invalid(`${byte === 19 ? "hintmask" : "cntrmask"} bytes are truncated.`);
          }
          offset += maskLength;
          break;
        }
        case 21: { // rmoveto
          const [dx, dy] = this.consumeMoveArguments(2, "rmoveto");
          this.moveTo(dx, dy);
          break;
        }
        case 22: { // hmoveto
          const [dx] = this.consumeMoveArguments(1, "hmoveto");
          this.moveTo(dx, 0);
          break;
        }
        case 24: { // rcurveline
          const values = this.consumeMultiple(8, "rcurveline");
          if ((values.length - 2) % 6 !== 0) {
            this.invalid("rcurveline has invalid curve/line operands.");
          }
          let index = 0;
          while (index < values.length - 2) {
            this.curveTo(...values.slice(index, index + 6) as [number, number, number, number, number, number]);
            index += 6;
          }
          this.lineTo(values[index], values[index + 1]);
          break;
        }
        case 25: { // rlinecurve
          const values = this.consumeMultiple(8, "rlinecurve");
          if ((values.length - 6) % 2 !== 0) {
            this.invalid("rlinecurve has invalid line/curve operands.");
          }
          let index = 0;
          while (index < values.length - 6) {
            this.lineTo(values[index], values[index + 1]);
            index += 2;
          }
          this.curveTo(...values.slice(index, index + 6) as [number, number, number, number, number, number]);
          break;
        }
        case 26: { // vvcurveto
          const values = this.consumeMultiple(4, "vvcurveto");
          const odd = values.length % 4;
          if (odd !== 0 && odd !== 1) this.invalid("vvcurveto has invalid operands.");
          let index = 0;
          let firstX = 0;
          if (odd === 1) firstX = values[index++];
          while (index < values.length) {
            this.curveTo(
              firstX, values[index],
              values[index + 1], values[index + 2],
              0, values[index + 3]
            );
            firstX = 0;
            index += 4;
          }
          break;
        }
        case 27: { // hhcurveto
          const values = this.consumeMultiple(4, "hhcurveto");
          const odd = values.length % 4;
          if (odd !== 0 && odd !== 1) this.invalid("hhcurveto has invalid operands.");
          let index = 0;
          let firstY = 0;
          if (odd === 1) firstY = values[index++];
          while (index < values.length) {
            this.curveTo(
              values[index], firstY,
              values[index + 1], values[index + 2],
              values[index + 3], 0
            );
            firstY = 0;
            index += 4;
          }
          break;
        }
        case 29: { // callgsubr
          const rawIndex = this.popInteger("callgsubr index");
          const status = this.callSubroutine(
            this.globalSubrs,
            rawIndex,
            "global",
            depth + 1
          );
          if (status === "endchar") return status;
          break;
        }
        case 30:
        case 31: { // vhcurveto / hvcurveto
          const values = this.consumeMultiple(4, byte === 30 ? "vhcurveto" : "hvcurveto");
          if (values.length % 4 !== 0 && values.length % 4 !== 1) {
            this.invalid(`${byte === 30 ? "vhcurveto" : "hvcurveto"} has invalid operands.`);
          }
          let index = 0;
          let verticalFirst = byte === 30;
          while (index < values.length) {
            const remaining = values.length - index;
            if (remaining < 4) this.invalid("Alternating curve operands are truncated.");
            const optionalLast = remaining === 5 ? values[index + 4] : 0;
            if (verticalFirst) {
              this.curveTo(
                0, values[index],
                values[index + 1], values[index + 2],
                values[index + 3], optionalLast
              );
            } else {
              this.curveTo(
                values[index], 0,
                values[index + 1], values[index + 2],
                optionalLast, values[index + 3]
              );
            }
            index += remaining === 5 ? 5 : 4;
            verticalFirst = !verticalFirst;
          }
          break;
        }
        default:
          this.invalid(`Type 2 operator ${byte} is reserved or unsupported.`);
      }
    }
    return "eof";
  }

  private executeEscaped(operator: number): void {
    switch (operator) {
      case 0: // dotsection
        // Adobe Type 2 Appendix C requires PDF-capable processors to accept
        // this deprecated hint-suspension operator. Adobe renderers have
        // always treated it as a no-op, so it has no outline or stack effect.
        break;
      case 3: { // and
        const [left, right] = this.popBinary("and");
        this.push(left !== 0 && right !== 0 ? 1 : 0);
        break;
      }
      case 4: { // or
        const [left, right] = this.popBinary("or");
        this.push(left !== 0 || right !== 0 ? 1 : 0);
        break;
      }
      case 5: // not
        this.push(this.pop("not") === 0 ? 1 : 0);
        break;
      case 9: // abs
        this.push(Math.abs(this.pop("abs")));
        break;
      case 10: { // add
        const [left, right] = this.popBinary("add");
        this.pushFinite(left + right, "add");
        break;
      }
      case 11: { // sub
        const [left, right] = this.popBinary("sub");
        this.pushFinite(left - right, "sub");
        break;
      }
      case 12: { // div
        const [left, right] = this.popBinary("div");
        if (right === 0) this.invalid("Type 2 div divides by zero.");
        this.pushFinite(left / right, "div");
        break;
      }
      case 14: // neg
        this.pushFinite(-this.pop("neg"), "neg");
        break;
      case 15: { // eq
        const [left, right] = this.popBinary("eq");
        this.push(left === right ? 1 : 0);
        break;
      }
      case 18: // drop
        this.pop("drop");
        break;
      case 20: { // put
        const index = this.popInteger("put index");
        const value = this.pop("put value");
        if (index < 0 || index >= this.transient.length) {
          this.invalid("Type 2 put index is outside the transient array.");
        }
        this.transient[index] = value;
        break;
      }
      case 21: { // get
        const index = this.popInteger("get index");
        if (index < 0 || index >= this.transient.length) {
          this.invalid("Type 2 get index is outside the transient array.");
        }
        this.push(this.transient[index]);
        break;
      }
      case 22: { // ifelse
        const comparisonRight = this.pop("ifelse comparison");
        const comparisonLeft = this.pop("ifelse comparison");
        const falseValue = this.pop("ifelse false value");
        const trueValue = this.pop("ifelse true value");
        this.push(comparisonLeft <= comparisonRight ? trueValue : falseValue);
        break;
      }
      case 23:
        this.invalid("Type 2 random is not deterministic and is not supported.");
        break;
      case 24: { // mul
        const [left, right] = this.popBinary("mul");
        this.pushFinite(left * right, "mul");
        break;
      }
      case 26: { // sqrt
        const value = this.pop("sqrt");
        if (value < 0) this.invalid("Type 2 sqrt received a negative operand.");
        this.pushFinite(Math.sqrt(value), "sqrt");
        break;
      }
      case 27: { // dup
        const value = this.pop("dup");
        this.push(value);
        this.push(value);
        break;
      }
      case 28: { // exch
        const right = this.pop("exch");
        const left = this.pop("exch");
        this.push(right);
        this.push(left);
        break;
      }
      case 29: { // index
        const index = this.popInteger("index operand");
        if (index < 0 || index >= this.stack.length) {
          this.invalid("Type 2 index operand is outside the argument stack.");
        }
        this.push(this.stack[this.stack.length - 1 - index]);
        break;
      }
      case 30: { // roll
        const shiftValue = this.popInteger("roll shift");
        const count = this.popInteger("roll count");
        if (count < 0 || count > this.stack.length) {
          this.invalid("Type 2 roll count is outside the argument stack.");
        }
        if (count > 1) {
          const shift = ((shiftValue % count) + count) % count;
          if (shift !== 0) {
            const start = this.stack.length - count;
            const values = this.stack.splice(start, count);
            this.stack.push(...values.slice(count - shift), ...values.slice(0, count - shift));
          }
        }
        break;
      }
      case 34: { // hflex
        const values = this.consumeExact(7, "hflex");
        this.curveTo(values[0], 0, values[1], values[2], values[3], 0);
        this.curveTo(values[4], 0, values[5], -values[2], values[6], 0);
        break;
      }
      case 35: { // flex
        const values = this.consumeExact(13, "flex");
        this.curveTo(...values.slice(0, 6) as [number, number, number, number, number, number]);
        this.curveTo(...values.slice(6, 12) as [number, number, number, number, number, number]);
        // flex depth (values[12]) influences raster hinting, not the exact path.
        break;
      }
      case 36: { // hflex1
        const values = this.consumeExact(9, "hflex1");
        this.curveTo(values[0], values[1], values[2], values[3], values[4], 0);
        this.curveTo(values[5], 0, values[6], values[7], values[8],
          -(values[1] + values[3] + values[7]));
        break;
      }
      case 37: { // flex1
        const values = this.consumeExact(11, "flex1");
        const sumX = values[0] + values[2] + values[4] + values[6] + values[8];
        const sumY = values[1] + values[3] + values[5] + values[7] + values[9];
        const lastX = Math.abs(sumX) > Math.abs(sumY) ? values[10] : -sumX;
        const lastY = Math.abs(sumX) > Math.abs(sumY) ? -sumY : values[10];
        this.curveTo(...values.slice(0, 6) as [number, number, number, number, number, number]);
        this.curveTo(values[6], values[7], values[8], values[9], lastX, lastY);
        break;
      }
      default:
        this.invalid(`Escaped Type 2 operator 12 ${operator} is reserved or unsupported.`);
    }
  }

  private callSubroutine(
    subrs: readonly Uint8Array[],
    rawIndex: number,
    kind: "local" | "global",
    depth: number
  ): "endchar" | "return" | "eof" {
    this.budget.subrCalls += 1;
    if (this.budget.subrCalls > this.limits.maxType2SubrCalls) {
      throw cffLimit("Type 2 subroutine calls exceed the configured limit.",
        "type2-subr-call-limit", this.limits.maxType2SubrCalls);
    }
    const index = rawIndex + type2SubrBias(subrs.length);
    if (!Number.isSafeInteger(index) || index < 0 || index >= subrs.length) {
      this.invalid(`Type 2 ${kind} subroutine index ${rawIndex} is out of bounds.`);
    }
    const key = `${kind}:${index}`;
    if (this.activeSubrs.has(key)) {
      this.invalid(`Type 2 ${kind} subroutine ${index} contains a call cycle.`);
    }
    this.activeSubrs.add(key);
    try {
      const status = this.execute(subrs[index], depth, false);
      if (status === "eof") {
        this.invalid(`Type 2 ${kind} subroutine ${index} has no return operator.`);
      }
      return status;
    } finally {
      this.activeSubrs.delete(key);
    }
  }

  private consumeStemArguments(allowEmpty: boolean): void {
    if (!this.widthResolved) {
      if (this.stack.length % 2 === 1) this.resolveWidth(this.stack.shift()!);
      else this.widthResolved = true;
    }
    if (this.stack.length % 2 !== 0 || (!allowEmpty && this.stack.length === 0)) {
      this.invalid("A Type 2 stem operator has invalid operands.");
    }
    this.stemCount = checkedAdd(this.stemCount, this.stack.length / 2, "Type 2 stem count");
    if (this.stemCount > 96) {
      this.invalid("A Type 2 glyph declares more than 96 hint stems.");
    }
    this.stack.length = 0;
  }

  private consumeMoveArguments(count: number, label: string): number[] {
    if (!this.widthResolved) {
      if (this.stack.length === count + 1) this.resolveWidth(this.stack.shift()!);
      else this.widthResolved = true;
    }
    return this.consumeExact(count, label);
  }

  private finishEndChar(): void {
    if (!this.widthResolved) {
      if (this.stack.length === 1 || this.stack.length === 5) this.resolveWidth(this.stack.shift()!);
      else this.widthResolved = true;
    }
    if (this.stack.length === 4) {
      const [accentX, accentY, baseCode, accentCode] = this.stack;
      if (
        !Number.isSafeInteger(baseCode) || baseCode < 0 || baseCode > 255 ||
        !Number.isSafeInteger(accentCode) || accentCode < 0 || accentCode > 255
      ) {
        this.invalid("Type 2 endchar composite character codes are invalid.");
      }
      this.seac = Object.freeze({ accentX, accentY, baseCode, accentCode });
    } else if (this.stack.length !== 0) {
      this.invalid("Type 2 endchar has invalid operands.");
    }
    this.stack.length = 0;
    this.closeContour();
  }

  private resolveWidth(delta: number): void {
    this.advanceWidth = finiteResult(this.nominalWidthX + delta, "Type 2 glyph width");
    this.widthResolved = true;
  }

  private moveTo(dx: number, dy: number): void {
    this.closeContour();
    this.x = finiteResult(this.x + dx, "Type 2 move x");
    this.y = finiteResult(this.y + dy, "Type 2 move y");
    this.emit({ kind: "move", x: this.x, y: this.y });
    this.contourOpen = true;
  }

  private lineTo(dx: number, dy: number): void {
    this.requireContour("line");
    this.x = finiteResult(this.x + dx, "Type 2 line x");
    this.y = finiteResult(this.y + dy, "Type 2 line y");
    this.emit({ kind: "line", x: this.x, y: this.y });
  }

  private curveTo(
    dx1: number,
    dy1: number,
    dx2: number,
    dy2: number,
    dx3: number,
    dy3: number
  ): void {
    this.requireContour("curve");
    const control1X = finiteResult(this.x + dx1, "Type 2 cubic control x");
    const control1Y = finiteResult(this.y + dy1, "Type 2 cubic control y");
    const control2X = finiteResult(control1X + dx2, "Type 2 cubic control x");
    const control2Y = finiteResult(control1Y + dy2, "Type 2 cubic control y");
    this.x = finiteResult(control2X + dx3, "Type 2 cubic x");
    this.y = finiteResult(control2Y + dy3, "Type 2 cubic y");
    this.emit({
      kind: "cubic",
      control1X,
      control1Y,
      control2X,
      control2Y,
      x: this.x,
      y: this.y
    });
  }

  private closeContour(): void {
    if (!this.contourOpen) return;
    this.emit({ kind: "close" });
    this.contourOpen = false;
  }

  private requireContour(label: string): void {
    if (!this.contourOpen) this.invalid(`A Type 2 ${label} appears before moveto.`);
  }

  private emit(command: NativeGlyphPathCommand): void {
    if (this.commands.length >= this.limits.maxType2PathCommands) {
      throw cffLimit("Type 2 path commands exceed the configured limit.",
        "type2-path-command-limit", this.limits.maxType2PathCommands);
    }
    this.commands.push(command);
  }

  private consumeMultiple(minimum: number, label: string): number[] {
    if (this.stack.length < minimum) this.invalid(`Type 2 ${label} has too few operands.`);
    const values = this.stack.slice();
    this.stack.length = 0;
    return values;
  }

  private consumeExact(count: number, label: string): number[] {
    if (this.stack.length !== count) {
      this.invalid(`Type 2 ${label} requires exactly ${count} operands.`);
    }
    const values = this.stack.slice();
    this.stack.length = 0;
    return values;
  }

  private push(value: number): void {
    if (!Number.isFinite(value)) this.invalid("A Type 2 operand is not finite.");
    if (this.stack.length >= 48) this.invalid("The Type 2 argument stack exceeds 48 operands.");
    this.stack.push(Object.is(value, -0) ? 0 : value);
  }

  private pushFinite(value: number, label: string): void {
    this.push(finiteResult(value, `Type 2 ${label} result`));
  }

  private pop(label: string): number {
    const value = this.stack.pop();
    if (value === undefined) this.invalid(`Type 2 ${label} underflows the argument stack.`);
    return value;
  }

  private popInteger(label: string): number {
    const value = this.pop(label);
    if (!Number.isSafeInteger(value)) this.invalid(`Type 2 ${label} is not an integer.`);
    return value;
  }

  private popBinary(label: string): readonly [number, number] {
    const right = this.pop(label);
    const left = this.pop(label);
    return [left, right];
  }

  private countOperator(): void {
    this.budget.operators += 1;
    if (this.budget.operators > this.limits.maxType2Operators) {
      throw cffLimit("Type 2 operators exceed the configured limit.",
        "type2-operator-limit", this.limits.maxType2Operators);
    }
  }

  private invalid(message: string): never {
    throw cffUnsupported(`CFF glyph ${this.glyphId}: ${message}`, "type2-invalid-charstring");
  }
}

type CffDictionary = Map<number, readonly number[]>;

const TOP_DICT_OPERATORS = new Set([
  0, 1, 2, 3, 4, 5, 13, 14, 15, 16, 17, 18,
  dictOperator(12, 0), dictOperator(12, 1), dictOperator(12, 2),
  dictOperator(12, 3), dictOperator(12, 4), dictOperator(12, 5),
  dictOperator(12, 6), dictOperator(12, 7), dictOperator(12, 8),
  dictOperator(12, 20), dictOperator(12, 21), dictOperator(12, 22),
  dictOperator(12, 23), dictOperator(12, 30), dictOperator(12, 31),
  dictOperator(12, 32), dictOperator(12, 33), dictOperator(12, 34),
  dictOperator(12, 35), dictOperator(12, 36), dictOperator(12, 37),
  dictOperator(12, 38)
]);

const PRIVATE_DICT_OPERATORS = new Set([
  6, 7, 8, 9, 10, 11, 19, 20, 21,
  dictOperator(12, 9), dictOperator(12, 10), dictOperator(12, 11),
  dictOperator(12, 12), dictOperator(12, 13), dictOperator(12, 14),
  dictOperator(12, 17), dictOperator(12, 18), dictOperator(12, 19)
]);

// Adobe Technical Note #5176, Appendix A. These names are format constants,
// not data copied from another PDF implementation.
const CFF_STANDARD_STRINGS = Object.freeze((`
.notdef space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft
parenright asterisk plus comma hyphen period slash zero one two three four five six seven
eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R
S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f
g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde exclamdown cent
sterling fraction yen florin section currency quotesingle quotedblleft guillemotleft guilsinglleft
guilsinglright fi fl endash dagger daggerdbl periodcentered paragraph bullet quotesinglbase
quotedblbase quotedblright guillemotright ellipsis perthousand questiondown grave acute circumflex
tilde macron breve dotaccent dieresis ring cedilla hungarumlaut ogonek caron emdash AE ordfeminine
Lslash Oslash OE ordmasculine ae dotlessi lslash oslash oe germandbls onesuperior logicalnot mu
trademark Eth onehalf plusminus Thorn onequarter divide brokenbar degree thorn threequarters
twosuperior registered minus eth multiply threesuperior copyright Aacute Acircumflex Adieresis
Agrave Aring Atilde Ccedilla Eacute Ecircumflex Edieresis Egrave Iacute Icircumflex Idieresis
Igrave Ntilde Oacute Ocircumflex Odieresis Ograve Otilde Scaron Uacute Ucircumflex Udieresis
Ugrave Yacute Ydieresis Zcaron aacute acircumflex adieresis agrave aring atilde ccedilla eacute
ecircumflex edieresis egrave iacute icircumflex idieresis igrave ntilde oacute ocircumflex
odieresis ograve otilde scaron uacute ucircumflex udieresis ugrave yacute ydieresis zcaron
exclamsmall Hungarumlautsmall dollaroldstyle dollarsuperior ampersandsmall Acutesmall
parenleftsuperior parenrightsuperior twodotenleader onedotenleader zerooldstyle oneoldstyle
twooldstyle threeoldstyle fouroldstyle fiveoldstyle sixoldstyle sevenoldstyle eightoldstyle
nineoldstyle commasuperior threequartersemdash periodsuperior questionsmall asuperior bsuperior
centsuperior dsuperior esuperior isuperior lsuperior msuperior nsuperior osuperior rsuperior
ssuperior tsuperior ff ffi ffl parenleftinferior parenrightinferior Circumflexsmall hyphensuperior
Gravesmall Asmall Bsmall Csmall Dsmall Esmall Fsmall Gsmall Hsmall Ismall Jsmall Ksmall Lsmall
Msmall Nsmall Osmall Psmall Qsmall Rsmall Ssmall Tsmall Usmall Vsmall Wsmall Xsmall Ysmall Zsmall
colonmonetary onefitted rupiah Tildesmall exclamdownsmall centoldstyle Lslashsmall Scaronsmall
Zcaronsmall Dieresissmall Brevesmall Caronsmall Dotaccentsmall Macronsmall figuredash
hypheninferior Ogoneksmall Ringsmall Cedillasmall questiondownsmall oneeighth threeeighths
fiveeighths seveneighths onethird twothirds zerosuperior foursuperior fivesuperior sixsuperior
sevensuperior eightsuperior ninesuperior zeroinferior oneinferior twoinferior threeinferior
fourinferior fiveinferior sixinferior seveninferior eightinferior nineinferior centinferior
dollarinferior periodinferior commainferior Agravesmall Aacutesmall Acircumflexsmall Atildesmall
Adieresissmall Aringsmall AEsmall Ccedillasmall Egravesmall Eacutesmall Ecircumflexsmall
Edieresissmall Igravesmall Iacutesmall Icircumflexsmall Idieresissmall Ethsmall Ntildesmall
Ogravesmall Oacutesmall Ocircumflexsmall Otildesmall Odieresissmall OEsmall Oslashsmall
Ugravesmall Uacutesmall Ucircumflexsmall Udieresissmall Yacutesmall Thornsmall Ydieresissmall
001.000 001.001 001.002 001.003 Black Bold Book Light Medium Regular Roman Semibold
`).trim().split(/\s+/));

function parseCffDict(
  bytes: Uint8Array,
  label: string,
  allowedOperators: ReadonlySet<number>
): CffDictionary {
  const dictionary: CffDictionary = new Map();
  const operands: number[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const byte = bytes[offset];
    if (isCffDictNumberByte(byte)) {
      const number = readCffDictNumber(bytes, offset);
      offset = number.next;
      if (operands.length >= 48) {
        throw cffUnsupported(`${label} exceeds the 48-operand DICT stack.`,
          "cff-dict-stack");
      }
      operands.push(number.value);
      continue;
    }
    offset += 1;
    let operator = byte;
    if (byte === 12) {
      if (offset >= bytes.length) {
        throw cffUnsupported(`${label} ends in a truncated escaped operator.`,
          "cff-dict-operator");
      }
      operator = dictOperator(12, bytes[offset++]);
    } else if (byte > 21) {
      throw cffUnsupported(`${label} contains reserved operator byte ${byte}.`,
        "cff-dict-operator");
    }
    if (!allowedOperators.has(operator)) {
      throw cffUnsupported(`${label} contains unsupported operator ${formatDictOperator(operator)}.`,
        "cff-dict-operator");
    }
    if (dictionary.has(operator)) {
      throw cffUnsupported(`${label} repeats operator ${formatDictOperator(operator)}.`,
        "cff-dict-duplicate-operator");
    }
    dictionary.set(operator, Object.freeze(operands.splice(0)));
  }
  if (operands.length !== 0) {
    throw cffUnsupported(`${label} ends with operands without an operator.`,
      "cff-dict-trailing-operands");
  }
  return dictionary;
}

function readCffCharset(
  reader: CffReader,
  charsetOffset: number,
  glyphCount: number,
  customStrings: readonly string[]
): readonly string[] {
  if (charsetOffset === 0) {
    // ISOAdobe charset is exactly SIDs 0 through 228 in GID order.
    if (glyphCount > 229) {
      throw cffUnsupported("The predefined ISOAdobe charset is shorter than the CharStrings INDEX.",
        "cff-charset-length");
    }
    return Object.freeze(CFF_STANDARD_STRINGS.slice(0, glyphCount));
  }
  if (charsetOffset === 1 || charsetOffset === 2) {
    throw cffUnsupported(
      "Predefined Expert CFF charsets are not supported by the native name-keyed engine.",
      "cff-expert-charset-not-supported"
    );
  }
  const format = reader.u8(charsetOffset, "CFF charset");
  let offset = charsetOffset + 1;
  const names = [".notdef"];
  if (format === 0) {
    while (names.length < glyphCount) {
      const sid = reader.u16(offset, "CFF format 0 charset");
      offset += 2;
      names.push(resolveCffSid(sid, customStrings));
    }
  } else if (format === 1 || format === 2) {
    while (names.length < glyphCount) {
      const firstSid = reader.u16(offset, `CFF format ${format} charset`);
      offset += 2;
      const left = format === 1
        ? reader.u8(offset++, "CFF format 1 charset")
        : reader.u16(offset, "CFF format 2 charset");
      if (format === 2) offset += 2;
      if (left + 1 > glyphCount - names.length) {
        throw cffUnsupported("A CFF charset range exceeds the CharStrings INDEX.",
          "cff-charset-length");
      }
      for (let delta = 0; delta <= left; delta += 1) {
        names.push(resolveCffSid(firstSid + delta, customStrings));
      }
    }
  } else {
    throw cffUnsupported(`CFF charset format ${format} is not supported.`,
      "cff-charset-format");
  }
  return Object.freeze(names);
}

function readCffEncoding(
  reader: CffReader,
  encodingOffset: number,
  glyphNames: readonly string[],
  glyphIds: ReadonlyMap<string, number>,
  customStrings: readonly string[]
): readonly (string | null)[] {
  const names = new Array<string | null>(256).fill(null);
  if (encodingOffset === 0) {
    for (let code = 0; code < names.length; code += 1) {
      const name = standardEncodingGlyphName(code);
      if (name !== null && glyphIds.has(name)) names[code] = name;
    }
    return Object.freeze(names);
  }
  if (encodingOffset === 1) {
    throw cffUnsupported(
      "The predefined Expert CFF encoding is not supported by the native name-keyed engine.",
      "cff-expert-encoding-not-supported"
    );
  }
  const rawFormat = reader.u8(encodingOffset, "CFF Encoding");
  const hasSupplements = (rawFormat & 0x80) !== 0;
  const format = rawFormat & 0x7f;
  let offset = encodingOffset + 1;
  let glyphId = 1;
  const assign = (code: number, name: string): void => {
    if (code < 0 || code > 255 || names[code] !== null) {
      throw cffUnsupported("The CFF Encoding assigns a character code more than once.",
        "cff-encoding-code");
    }
    names[code] = name;
  };
  if (format === 0) {
    const codeCount = reader.u8(offset++, "CFF format 0 Encoding");
    if (codeCount > glyphNames.length - 1) {
      throw cffUnsupported("The CFF Encoding exceeds the charset.", "cff-encoding-length");
    }
    for (let index = 0; index < codeCount; index += 1) {
      assign(reader.u8(offset++, "CFF format 0 Encoding"), glyphNames[glyphId++]);
    }
  } else if (format === 1) {
    const rangeCount = reader.u8(offset++, "CFF format 1 Encoding");
    for (let rangeIndex = 0; rangeIndex < rangeCount; rangeIndex += 1) {
      const firstCode = reader.u8(offset++, "CFF format 1 Encoding");
      const left = reader.u8(offset++, "CFF format 1 Encoding");
      if (left + 1 > glyphNames.length - glyphId || firstCode + left > 255) {
        throw cffUnsupported("A CFF Encoding range exceeds the charset or byte code space.",
          "cff-encoding-length");
      }
      for (let delta = 0; delta <= left; delta += 1) {
        assign(firstCode + delta, glyphNames[glyphId++]);
      }
    }
  } else {
    throw cffUnsupported(`CFF Encoding format ${format} is not supported.`,
      "cff-encoding-format");
  }
  if (hasSupplements) {
    const supplementCount = reader.u8(offset++, "CFF Encoding supplements");
    for (let index = 0; index < supplementCount; index += 1) {
      const code = reader.u8(offset++, "CFF Encoding supplement");
      const sid = reader.u16(offset, "CFF Encoding supplement");
      offset += 2;
      const name = resolveCffSid(sid, customStrings);
      if (!glyphIds.has(name)) {
        throw cffUnsupported("A CFF Encoding supplement references a glyph outside the charset.",
          "cff-encoding-supplement");
      }
      assign(code, name);
    }
  }
  return Object.freeze(names);
}

function standardEncodingGlyphName(code: number): string | null {
  if (!Number.isSafeInteger(code) || code < 0 || code > 255) return null;
  if (code >= 32 && code <= 126) {
    if (code === 39) return "quoteright";
    if (code === 96) return "quoteleft";
    // Standard-string SIDs 1–95 correspond to byte codes 32–126.
    return CFF_STANDARD_STRINGS[code - 31] ?? null;
  }
  return STANDARD_ENCODING_HIGH[code] ?? null;
}

const STANDARD_ENCODING_HIGH: Readonly<Record<number, string>> = Object.freeze({
  161: "exclamdown", 162: "cent", 163: "sterling", 164: "fraction", 165: "yen",
  166: "florin", 167: "section", 168: "currency", 169: "quotesingle",
  170: "quotedblleft", 171: "guillemotleft", 172: "guilsinglleft",
  173: "guilsinglright", 174: "fi", 175: "fl", 177: "endash", 178: "dagger",
  179: "daggerdbl", 180: "periodcentered", 182: "paragraph", 183: "bullet",
  184: "quotesinglbase", 185: "quotedblbase", 186: "quotedblright",
  187: "guillemotright", 188: "ellipsis", 189: "perthousand", 191: "questiondown",
  193: "grave", 194: "acute", 195: "circumflex", 196: "tilde", 197: "macron",
  198: "breve", 199: "dotaccent", 200: "dieresis", 202: "ring", 203: "cedilla",
  205: "hungarumlaut", 206: "ogonek", 207: "caron", 208: "emdash", 225: "AE",
  227: "ordfeminine", 232: "Lslash", 233: "Oslash", 234: "OE", 235: "ordmasculine",
  241: "ae", 245: "dotlessi", 248: "lslash", 249: "oslash", 250: "oe",
  251: "germandbls"
});

function transformCommand(
  command: NativeGlyphPathCommand,
  matrix: readonly [number, number, number, number, number, number]
): NativeGlyphPathCommand {
  if (command.kind === "close") return command;
  if (command.kind === "move" || command.kind === "line") {
    const [x, y] = transformCffPoint(command.x, command.y, matrix);
    return { kind: command.kind, x, y };
  }
  if (command.kind === "quadratic") {
    const [controlX, controlY] = transformCffPoint(command.controlX, command.controlY, matrix);
    const [x, y] = transformCffPoint(command.x, command.y, matrix);
    return { kind: "quadratic", controlX, controlY, x, y };
  }
  const [control1X, control1Y] = transformCffPoint(command.control1X, command.control1Y, matrix);
  const [control2X, control2Y] = transformCffPoint(command.control2X, command.control2Y, matrix);
  const [x, y] = transformCffPoint(command.x, command.y, matrix);
  return { kind: "cubic", control1X, control1Y, control2X, control2Y, x, y };
}

function translateCommand(
  command: NativeGlyphPathCommand,
  offsetX: number,
  offsetY: number
): NativeGlyphPathCommand {
  if (command.kind === "close") return command;
  if (command.kind === "move" || command.kind === "line") {
    return { kind: command.kind, x: command.x + offsetX, y: command.y + offsetY };
  }
  if (command.kind === "quadratic") {
    return {
      kind: "quadratic",
      controlX: command.controlX + offsetX,
      controlY: command.controlY + offsetY,
      x: command.x + offsetX,
      y: command.y + offsetY
    };
  }
  return {
    kind: "cubic",
    control1X: command.control1X + offsetX,
    control1Y: command.control1Y + offsetY,
    control2X: command.control2X + offsetX,
    control2Y: command.control2Y + offsetY,
    x: command.x + offsetX,
    y: command.y + offsetY
  };
}

function transformCffPoint(
  x: number,
  y: number,
  matrix: readonly [number, number, number, number, number, number]
): readonly [number, number] {
  // Normalize FontMatrix into the retained 1000-unit ABI before applying it.
  // Apart from making that convention explicit, this keeps the ubiquitous
  // 0.001 matrix numerically identity instead of introducing avoidable
  // 350.00000000000006-style coordinate noise.
  return [
    finiteResult(matrix[0] * 1000 * x + matrix[2] * 1000 * y + matrix[4] * 1000,
      "CFF transformed x coordinate"),
    finiteResult(matrix[1] * 1000 * x + matrix[3] * 1000 * y + matrix[5] * 1000,
      "CFF transformed y coordinate")
  ];
}

function transformWidth(
  width: number,
  matrix: readonly [number, number, number, number, number, number]
): number {
  return finiteResult(matrix[0] * 1000 * width, "CFF transformed glyph width");
}

function measureCommands(
  commands: readonly NativeGlyphPathCommand[]
): readonly [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const include = (pointX: number, pointY: number): void => {
    minX = Math.min(minX, pointX);
    minY = Math.min(minY, pointY);
    maxX = Math.max(maxX, pointX);
    maxY = Math.max(maxY, pointY);
  };
  for (const command of commands) {
    if (command.kind === "move") {
      x = startX = command.x;
      y = startY = command.y;
      include(x, y);
    } else if (command.kind === "line") {
      include(x, y);
      include(command.x, command.y);
      x = command.x;
      y = command.y;
    } else if (command.kind === "quadratic") {
      includeQuadraticBounds(x, command.controlX, command.x, (value) => include(value, y));
      includeQuadraticBounds(y, command.controlY, command.y, (value) => include(x, value));
      include(x, y);
      include(command.x, command.y);
      x = command.x;
      y = command.y;
    } else if (command.kind === "cubic") {
      include(x, y);
      include(command.x, command.y);
      for (const t of cubicExtrema(x, command.control1X, command.control2X, command.x)) {
        include(cubicAt(x, command.control1X, command.control2X, command.x, t),
          cubicAt(y, command.control1Y, command.control2Y, command.y, t));
      }
      for (const t of cubicExtrema(y, command.control1Y, command.control2Y, command.y)) {
        include(cubicAt(x, command.control1X, command.control2X, command.x, t),
          cubicAt(y, command.control1Y, command.control2Y, command.y, t));
      }
      x = command.x;
      y = command.y;
    } else {
      include(startX, startY);
      x = startX;
      y = startY;
    }
  }
  if (minX === Number.POSITIVE_INFINITY) return Object.freeze([0, 0, 0, 0]);
  return Object.freeze([minX, minY, maxX, maxY]);
}

function includeQuadraticBounds(
  start: number,
  control: number,
  end: number,
  include: (value: number) => void
): void {
  const denominator = start - 2 * control + end;
  if (denominator === 0) return;
  const t = (start - control) / denominator;
  if (t > 0 && t < 1) include((1 - t) ** 2 * start + 2 * (1 - t) * t * control + t ** 2 * end);
}

function cubicExtrema(start: number, first: number, second: number, end: number): number[] {
  const a = -start + 3 * first - 3 * second + end;
  const b = 2 * (start - 2 * first + second);
  const c = first - start;
  if (Math.abs(a) < 1e-14) {
    if (Math.abs(b) < 1e-14) return [];
    const root = -c / b;
    return root > 0 && root < 1 ? [root] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  const firstRoot = (-b + root) / (2 * a);
  const secondRoot = (-b - root) / (2 * a);
  return [firstRoot, secondRoot].filter((value, index, values) =>
    value > 0 && value < 1 && (index === 0 || Math.abs(value - values[0]) > 1e-12)
  );
}

function cubicAt(start: number, first: number, second: number, end: number, t: number): number {
  const inverse = 1 - t;
  return inverse ** 3 * start + 3 * inverse ** 2 * t * first +
    3 * inverse * t ** 2 * second + t ** 3 * end;
}

function readCffDictNumber(
  bytes: Uint8Array,
  offset: number
): { readonly value: number; readonly next: number } {
  const first = bytes[offset];
  if (first >= 32 && first <= 246) return { value: first - 139, next: offset + 1 };
  if (first >= 247 && first <= 250) {
    requireByteRange(bytes, offset, 2, "CFF DICT number");
    return { value: (first - 247) * 256 + bytes[offset + 1] + 108, next: offset + 2 };
  }
  if (first >= 251 && first <= 254) {
    requireByteRange(bytes, offset, 2, "CFF DICT number");
    return { value: -(first - 251) * 256 - bytes[offset + 1] - 108, next: offset + 2 };
  }
  if (first === 28) {
    requireByteRange(bytes, offset, 3, "CFF DICT short integer");
    let value = bytes[offset + 1] * 256 + bytes[offset + 2];
    if (value & 0x8000) value -= 0x10000;
    return { value, next: offset + 3 };
  }
  if (first === 29) {
    requireByteRange(bytes, offset, 5, "CFF DICT long integer");
    const unsigned = bytes[offset + 1] * 0x1000000 + bytes[offset + 2] * 0x10000 +
      bytes[offset + 3] * 0x100 + bytes[offset + 4];
    return { value: unsigned >= 0x80000000 ? unsigned - 0x100000000 : unsigned, next: offset + 5 };
  }
  if (first === 30) return readCffReal(bytes, offset);
  throw cffUnsupported("A CFF DICT number uses a reserved encoding.", "cff-dict-number");
}

function readCffReal(
  bytes: Uint8Array,
  offset: number
): { readonly value: number; readonly next: number } {
  let text = "";
  let position = offset + 1;
  let ended = false;
  while (position < bytes.length && !ended) {
    const byte = bytes[position++];
    for (const nibble of [byte >>> 4, byte & 0x0f]) {
      if (nibble <= 9) text += String(nibble);
      else if (nibble === 0x0a) text += ".";
      else if (nibble === 0x0b) text += "E";
      else if (nibble === 0x0c) text += "E-";
      else if (nibble === 0x0e) text += "-";
      else if (nibble === 0x0f) { ended = true; break; }
      else throw cffUnsupported("A CFF real number contains a reserved nibble.",
        "cff-dict-real");
    }
  }
  const value = Number(text);
  if (!ended || text.length === 0 || !Number.isFinite(value)) {
    throw cffUnsupported("A CFF real number is malformed or truncated.", "cff-dict-real");
  }
  return { value, next: position };
}

function readType2Number(
  bytes: Uint8Array,
  offset: number
): { readonly value: number; readonly next: number } {
  const first = bytes[offset];
  if (first >= 32 && first <= 246) return { value: first - 139, next: offset + 1 };
  if (first >= 247 && first <= 250) {
    requireByteRange(bytes, offset, 2, "Type 2 number");
    return { value: (first - 247) * 256 + bytes[offset + 1] + 108, next: offset + 2 };
  }
  if (first >= 251 && first <= 254) {
    requireByteRange(bytes, offset, 2, "Type 2 number");
    return { value: -(first - 251) * 256 - bytes[offset + 1] - 108, next: offset + 2 };
  }
  if (first === 28) {
    requireByteRange(bytes, offset, 3, "Type 2 short integer");
    let value = bytes[offset + 1] * 256 + bytes[offset + 2];
    if (value & 0x8000) value -= 0x10000;
    return { value, next: offset + 3 };
  }
  if (first === 255) {
    requireByteRange(bytes, offset, 5, "Type 2 fixed number");
    const unsigned = bytes[offset + 1] * 0x1000000 + bytes[offset + 2] * 0x10000 +
      bytes[offset + 3] * 0x100 + bytes[offset + 4];
    const signed = unsigned >= 0x80000000 ? unsigned - 0x100000000 : unsigned;
    return { value: signed / 65536, next: offset + 5 };
  }
  throw cffUnsupported("A Type 2 number uses a reserved encoding.", "type2-number");
}

function isCffDictNumberByte(byte: number): boolean {
  return byte === 28 || byte === 29 || byte === 30 || (byte >= 32 && byte <= 254);
}

function isType2NumberByte(byte: number): boolean {
  return byte === 28 || byte === 255 || (byte >= 32 && byte <= 254);
}

function readRequiredOffset(dictionary: CffDictionary, operator: number, label: string): number {
  const values = dictionary.get(operator);
  if (!values || values.length !== 1) {
    throw cffUnsupported(`The CFF Top DICT has no valid ${label} offset.`,
      "cff-required-offset");
  }
  return requireNonnegativeInteger(values[0], `CFF ${label} offset`);
}

function readOptionalOffset(
  dictionary: CffDictionary,
  operator: number,
  fallback: number,
  label: string
): number {
  const values = dictionary.get(operator);
  if (!values) return fallback;
  if (values.length !== 1) {
    throw cffUnsupported(`The CFF ${label} offset is invalid.`, "cff-offset");
  }
  return requireNonnegativeInteger(values[0], `CFF ${label} offset`);
}

function readOptionalSingleton(
  dictionary: CffDictionary,
  operator: number,
  fallback: number,
  label: string
): number {
  const values = dictionary.get(operator);
  if (!values) return fallback;
  if (values.length !== 1 || !Number.isFinite(values[0])) {
    throw cffUnsupported(`The CFF ${label} value is invalid.`, "cff-dict-value");
  }
  return values[0];
}

function resolveCffSid(sid: number, customStrings: readonly string[]): string {
  if (!Number.isSafeInteger(sid) || sid < 0 || sid > 64_999) {
    throw cffUnsupported("A CFF charset SID is outside the valid range.", "cff-charset-sid");
  }
  if (sid < CFF_STANDARD_STRINGS.length) return CFF_STANDARD_STRINGS[sid];
  const custom = customStrings[sid - CFF_STANDARD_STRINGS.length];
  if (custom === undefined) {
    throw cffUnsupported("A CFF charset SID is outside the String INDEX.", "cff-charset-sid");
  }
  return validateCffGlyphName(custom, "CFF charset glyph name");
}

function readCffName(bytes: Uint8Array, label: string): string {
  if (bytes.length === 0 || bytes.length > 127) {
    throw cffUnsupported(`${label} has an invalid length.`, "cff-name");
  }
  let result = "";
  for (const byte of bytes) {
    if (byte < 33 || byte > 126 || byte === 0x28 || byte === 0x29 || byte === 0x3c ||
        byte === 0x3e || byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d ||
        byte === 0x2f || byte === 0x25) {
      throw cffUnsupported(`${label} contains an invalid PostScript name byte.`, "cff-name");
    }
    result += String.fromCharCode(byte);
  }
  return result;
}

function readCffString(bytes: Uint8Array, label: string): string {
  let result = "";
  for (const byte of bytes) {
    if (byte < 32 || byte > 126) {
      throw cffUnsupported(`${label} contains a non-ASCII byte.`, "cff-string");
    }
    result += String.fromCharCode(byte);
  }
  return result;
}

function validateCffGlyphName(value: string, label: string): string {
  if (value.length === 0 || value.length > 127 || /[\s()[\]{}<>\/%]/.test(value)) {
    throw cffUnsupported(`${label} is not a valid PostScript name.`, "cff-name");
  }
  return value;
}

function dictOperator(first: number, second?: number): number {
  return second === undefined ? first : 0x0c00 | second;
}

function formatDictOperator(operator: number): string {
  return operator >= 0x0c00 ? `12 ${operator & 0xff}` : String(operator);
}

function type2SubrBias(count: number): number {
  return count < 1_240 ? 107 : count < 33_900 ? 1_131 : 32_768;
}

function requireNonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw cffUnsupported(`${label} is not a nonnegative integer.`, "cff-integer");
  }
  return value;
}

function finiteResult(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw cffUnsupported(`${label} is not finite.`, "cff-numeric-overflow");
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireByteRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (!rangeFits(offset, length, bytes.length)) {
    throw cffUnsupported(`${label} is truncated.`, "cff-bounds");
  }
}

function checkedAdd(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw cffUnsupported(`${label} arithmetic overflows.`, "cff-arithmetic-overflow");
  }
  return left + right;
}

function checkedMultiply(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0 ||
    (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
  ) {
    throw cffUnsupported(`${label} arithmetic overflows.`, "cff-arithmetic-overflow");
  }
  return left * right;
}

function rangeFits(offset: number, length: number, total: number): boolean {
  return Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length >= 0 &&
    Number.isSafeInteger(total) && total >= 0 && offset <= total && length <= total - offset;
}

function mergeCffLimits(
  overrides: Partial<NativeCffParserLimits>
): Readonly<NativeCffParserLimits> {
  const defaults = DEFAULT_NATIVE_CFF_PARSER_LIMITS;
  const bounded = <K extends keyof NativeCffParserLimits>(key: K): number => {
    const value = overrides[key] ?? defaults[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > defaults[key]) {
      throw new RangeError(`${key} must be a positive safe integer no greater than ${defaults[key]}.`);
    }
    return value;
  };
  return Object.freeze({
    maxCffBytes: bounded("maxCffBytes"),
    maxCffIndexEntries: bounded("maxCffIndexEntries"),
    maxCffStringBytes: bounded("maxCffStringBytes"),
    maxType2CharStringBytes: bounded("maxType2CharStringBytes"),
    maxType2Operators: bounded("maxType2Operators"),
    maxType2SubrDepth: bounded("maxType2SubrDepth"),
    maxType2SubrCalls: bounded("maxType2SubrCalls"),
    maxType2PathCommands: bounded("maxType2PathCommands")
  });
}

function cffUnsupported(message: string, reason: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason } });
}

function cffLimit(message: string, reason: string, limit: number): PdfError {
  return new PdfError("resource-limit", message, { details: { reason, limit } });
}
