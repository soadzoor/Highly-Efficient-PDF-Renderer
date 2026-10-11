import { PdfError, throwIfAborted } from "./nativeTypes";
import { nativeFontPostScriptIdentityMatrix, nativeFontPostScriptConcatMatrices,
  nativeFontPostScriptInvertMatrix, nativeFontPostScriptTranslation, nativeFontPostScriptScaling,
  nativeFontPostScriptRotation, nativeFontPostScriptTransform } from "./nativeFontPostScriptMatrix";
import type { NativeFontPostScriptMatrix } from "./nativeFontPostScriptMatrix";
import { createNativeFontPostScriptMemoryFile, createNativeFontPostScriptFilter,
  createNativeFontPostScriptEexecFile, cloneNativeFontPostScriptFile } from "./nativeFontPostScriptFile";
import type { NativeFontPostScriptFile, NativeFontPostScriptFilterParameters } from "./nativeFontPostScriptFile";
import { createNativeFontPostScriptProcedureFile, snapshotNativeFontPostScriptProcedureFile,
  restoreNativeFontPostScriptProcedureFile } from "./nativeFontPostScriptProcedureFile";
import type { NativeFontPostScriptGlyphContext, NativeFontPostScriptGraphicsState } from "./nativeFontPostScriptGraphics";

export interface NativeFontPostScriptName { readonly kind: "name"; readonly value: string; readonly literal: boolean; }
export interface NativeFontPostScriptProcedure { readonly kind: "procedure"; readonly tokens: readonly NativeFontPostScriptValue[]; }
interface PsOperator { readonly kind: "operator"; readonly name: string; }
interface PsFile { readonly kind: "file"; readonly reader: FontPostScriptLexer; }
interface PsMark { readonly kind: "mark"; }
interface PsSave { readonly kind: "save"; readonly owner: object; readonly snapshot: VmSnapshot; }
export type NativeFontPostScriptValue = number | boolean | null | Uint8Array |
  NativeFontPostScriptName | NativeFontPostScriptProcedure | PsOperator | PsFile | PsMark | PsSave |
  NativeFontPostScriptValue[] | Map<string, NativeFontPostScriptValue>;
type Value = NativeFontPostScriptValue;
type Dictionary = Map<string, Value>;
type Procedure = NativeFontPostScriptProcedure;

export interface NativeFontPostScriptOptions {
  readonly signal?: AbortSignal;
  readonly maxOperations?: number;
  readonly maxStack?: number;
  readonly maxStringBytes?: number;
  readonly standardEncoding?: readonly (string | null)[];
  readonly expertEncoding?: readonly (string | null)[];
  /** CFF Appendix F executes code with the completed font dictionary on top. */
  readonly initialDictionary?: Dictionary;
  /** Device-dependent matrix reads require the caller's actual context. */
  readonly initialMatrix?: NativeFontPostScriptMatrix;
  /** Glyph-space path and ordered device marks shared with the charstring. */
  readonly glyphContext?: NativeFontPostScriptGlyphContext;
}

export interface NativeFontPostScriptResult {
  readonly dictionary: Dictionary;
  /** Create independent glyph state, shared by that glyph's OtherSubr calls. */
  createOtherSubrExecutor(signal?: AbortSignal, context?: NativeFontPostScriptGlyphContext): (index: number, args: readonly number[]) => readonly number[] | null;
  /** Arguments enter the PS stack in reverse order (Type1 specification 6.4). */
  executeOtherSubr(index: number, args: readonly number[], signal?: AbortSignal): readonly number[] | null;
}

/**
 * Font-local PostScript interpreter (PLRM, chapters 3, 4 and 8). Glyph imaging
 * is captured as ordered retained vector marks. It has no host files,
 * processes, networking or printer control. Unknown operators fail explicitly
 * so the caller can retain its diagnosed font fallback.
 * https://www.adobe.com/jp/print/postscript/pdfs/PLRM.pdf
 */
export function executeNativeFontPostScript(cleartext: Uint8Array, privatePlaintext?: Uint8Array,
  options: NativeFontPostScriptOptions = {}): NativeFontPostScriptResult {
  const vm = new FontPostScriptVm(options, privatePlaintext !== undefined);
  vm.runBytes(cleartext);
  if (privatePlaintext) vm.runBytes(privatePlaintext);
  const dictionary = vm.fontDictionary();
  const createOtherSubrExecutor = (signal: AbortSignal | undefined = options.signal, context?: NativeFontPostScriptGlyphContext) => {
    // Glyphs own their mutable state, while successive calls within one glyph
    // share Private variables and arrays as required by custom OtherSubrs.
    const { dictionary: owned, vm: local } = vmForGlyph(vm, dictionary, signal, { ...options, glyphContext: context ?? options.glyphContext });
    const copiedPrivate = owned.get("Private");
    const copiedSubrs = copiedPrivate instanceof Map ? copiedPrivate.get("OtherSubrs") : owned.get("OtherSubrs");
    if (copiedPrivate instanceof Map) local.enterDictionary(copiedPrivate);
    return (index: number, args: readonly number[]): readonly number[] | null => {
      const procedure = Array.isArray(copiedSubrs) ? copiedSubrs[index] : undefined;
      if (!isProcedure(procedure)) return null;
      try {
        local.runProcedure(procedure, [...args].reverse());
        return Object.freeze([...local.stack].reverse().map(value => requireNumber(value)));
      } finally { local.finishGlyphState(); local.stack.length = 0; }
    };
  };
  return Object.freeze({ dictionary, createOtherSubrExecutor,
    executeOtherSubr(index: number, args: readonly number[], signal?: AbortSignal): readonly number[] | null {
      return createOtherSubrExecutor(signal)(index, args);
    } });
}

type Task = { kind: "input"; reader: FontPostScriptLexer; sourceFile?: boolean } |
  { kind: "tokens"; tokens: readonly Value[]; index: number } |
  { kind: "repeat"; remaining: number; procedure: Procedure } |
  { kind: "for"; current: number; increment: number; limit: number; procedure: Procedure } |
  { kind: "forall"; values: readonly (readonly Value[])[]; source?: Value[] | Uint8Array; index: number; procedure: Procedure } |
  { kind: "resourceforall"; keys: readonly string[]; scratch: Uint8Array; index: number; procedure: Procedure } |
  { kind: "pathforall"; entries: readonly { args: readonly number[]; procedure: Procedure }[]; index: number } |
  { kind: "loop"; procedure: Procedure } | { kind: "stopped" } | { kind: "source-boundary" } | { kind: "eexec-end"; dictionaryDepth: number };

interface VmSnapshot {
  readonly objects: Map<object, { readonly value: Value; readonly contents?: Value[] | Uint8Array | [string, Value][]; readonly access: Access; readonly capacity?: number }>;
  readonly matrix: NativeFontPostScriptMatrix;
  readonly matrixKnown: boolean;
  readonly graphics: readonly { matrix: NativeFontPostScriptMatrix; known: boolean; glyphState?: NativeFontPostScriptGraphicsState }[];
  readonly definedFont: Dictionary | null;
  readonly resources: readonly [string, Dictionary][];
  readonly createdCount: number;
  readonly packing: boolean;
  readonly globalMode: boolean;
  readonly glyphState?: NativeFontPostScriptGraphicsState;
}
class PostScriptStop extends Error {}
class PostScriptSourceFailure extends Error {
  readonly error: PdfError;
  readonly operands: readonly Value[];
  readonly command?: Value;
  constructor(error: PdfError, operands: readonly Value[], command?: Value) { super(error.message); this.error = error; this.operands = operands; this.command = command; }
}

class FontPostScriptVm {
  readonly stack: Value[] = [];
  private readonly options: NativeFontPostScriptOptions;
  private readonly dictionaries: Dictionary[];
  private readonly privilegedDictionaries = new Set<Dictionary>();
  private readonly created: Dictionary[] = [];
  private readonly tasks: Task[] = [];
  private system: Dictionary = new Map();
  private user: Dictionary = new Map();
  private global: Dictionary = new Map();
  private directory: Dictionary = new Map();
  private localFonts: Dictionary = new Map();
  private globalDirectory: Dictionary = new Map();
  private readonly resources = new Map<string, Dictionary>();
  private readonly globalResources = new Map<string, Dictionary>();
  private errors: Dictionary = new Map();
  private readonly saves: PsSave[] = [];
  private readonly colorSpaces = new WeakMap<readonly number[], Value>();
  private matrix: NativeFontPostScriptMatrix;
  private matrixKnown: boolean;
  private readonly graphics: { matrix: NativeFontPostScriptMatrix; known: boolean; glyphState?: NativeFontPostScriptGraphicsState }[] = [];
  private randomSeed = 1;
  private packing = false;
  private globalMode = false;
  private activeCommand: Value | undefined;
  private operations = 0;
  private definedFont: Dictionary | null = null;
  private readonly splitEexec: boolean;

  constructor(options: NativeFontPostScriptOptions, splitEexec = false) {
    this.options = options;
    this.splitEexec = splitEexec;
    this.matrix = options.initialMatrix ?? nativeFontPostScriptIdentityMatrix();
    this.matrixKnown = options.initialMatrix !== undefined || options.glyphContext !== undefined;
    for (const key of ["maxOperations", "maxStack", "maxStringBytes"] as const) {
      const value = options[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`Invalid PostScript ${key}.`);
    }
    for (const name of OPERATOR_NAMES) this.system.set(name, { kind: "operator", name });
    this.system.set("true", true); this.system.set("false", false); this.system.set("null", null);
    this.system.set("systemdict", this.system); this.system.set("userdict", this.user);
    this.system.set("FontDirectory", this.directory); this.system.set("GlobalFontDirectory", this.globalDirectory);
    this.system.set("globaldict", this.global);
    this.system.set("$error", this.errors);
    this.errors.set("newerror", false);
    this.resources.set("Font", this.localFonts); this.globalResources.set("Font", this.globalDirectory);
    this.system.set("StandardEncoding", reduceAccess(encoding(options.standardEncoding), 2));
    this.system.set("ExpertEncoding", reduceAccess(encoding(options.expertEncoding), 2));
    this.system.set("version", new TextEncoder().encode("3010"));
    this.system.set("languagelevel", 3);
    accessAttributes.set(this.system, 2);
    for (const value of [this.system, this.global, this.globalDirectory]) globalAttributes.set(value, true);
    for (const value of [this.user, this.directory, this.localFonts, this.errors]) globalAttributes.set(value, false);
    for (const name of ["StandardEncoding", "ExpertEncoding", "version"]) globalAttributes.set(storageOf(this.system.get(name)! as Value & object), true);
    accessAttributes.set(this.directory, 2); accessAttributes.set(this.globalDirectory, 2);
    this.dictionaries = [this.system, this.global, this.user];
    if (options.initialDictionary) { this.registerGraph(options.initialDictionary, false); this.dictionaries.push(options.initialDictionary); }
  }

  runBytes(bytes: Uint8Array): void {
    const reader = this.lexer(bytes);
    this.tasks.push({ kind: "input", reader });
    this.run();
  }

  runProcedure(procedure: Procedure, args: readonly Value[] = []): void {
    const depth = this.dictionaries.length;
    try { for (const value of args) this.push(value); this.schedule(procedure); this.run(); }
    catch (error) { this.unwindTasks(0); this.stack.length = 0; this.dictionaries.splice(depth); throw error; }
  }
  // Font engines can inspect an opaque Private dictionary while executing its
  // OtherSubrs. This does not grant explicit PS get/put/begin extra access.
  enterDictionary(dictionary: Dictionary): void { this.dictionaries.push(dictionary); this.privilegedDictionaries.add(dictionary); }
  finishGlyphState(): void { this.options.glyphContext?.setCurrentMatrix(this.matrix); }

  glyphEnvironment(dictionary: Dictionary): Dictionary {
    return new Map<string, Value>([["font", dictionary], ["system", this.system], ["errors", this.errors], ["user", this.user], ["global", this.global], ["directory", this.directory],
      ["localFonts", this.localFonts], ["globalDirectory", this.globalDirectory], ["resources", new Map(this.resources)], ["globalResources", new Map(this.globalResources)]]);
  }
  seedGlyphEnvironment(environment: Dictionary): void {
    // Adopt graph roots rather than copying their entries: immediately
    // evaluated //userdict, //globaldict and shared resource references must
    // alias the same dictionaries seen by name lookup in this glyph.
    this.system = environment.get("system") as Dictionary;
    this.errors = environment.get("errors") as Dictionary;
    this.user = environment.get("user") as Dictionary;
    this.global = environment.get("global") as Dictionary;
    this.directory = environment.get("directory") as Dictionary;
    this.localFonts = environment.get("localFonts") as Dictionary;
    this.globalDirectory = environment.get("globalDirectory") as Dictionary;
    this.dictionaries.splice(0, 3, this.system, this.global, this.user);
    this.resources.clear(); for (const [key, value] of environment.get("resources") as Dictionary) this.resources.set(key, value as Dictionary);
    this.globalResources.clear(); for (const [key, value] of environment.get("globalResources") as Dictionary) this.globalResources.set(key, value as Dictionary);
    this.system.set("FontDirectory", this.directory);
  }

  fontDictionary(): Dictionary {
    if (this.definedFont) return this.definedFont;
    if (this.options.initialDictionary) return this.options.initialDictionary;
    const candidates = [...this.created, ...this.dictionaries, ...this.stack.filter(value => value instanceof Map)] as Dictionary[];
    const font = [...candidates].reverse().find(value => value.has("CharStrings")) ?? [...candidates].reverse().find(value => value.has("FontType"));
    if (!font) throw unsupported("The PostScript program did not construct a font dictionary.");
    return font;
  }

  private run(boundary?: Task): void {
    const floor = boundary ? this.tasks.indexOf(boundary) : -1;
    while (this.tasks.length) {
      throwIfAborted(this.options.signal);
      if (++this.operations > (this.options.maxOperations ?? Number.MAX_SAFE_INTEGER)) throw limited("operation");
      const task = this.tasks.at(-1)!;
      if (task === boundary) { this.tasks.pop(); return; }
      const operands = boundary || this.tasks.some(item => item.kind === "stopped") ? this.stack.slice() : [];
      let value: Value | undefined;
      this.activeCommand = undefined;
      try {
        if (task.kind === "input") {
          const token = task.reader.next();
          if (token === undefined) { this.tasks.pop(); continue; }
          value = token;
        } else if (task.kind === "tokens") {
          if (task.index === task.tokens.length) { this.tasks.pop(); continue; }
          value = task.tokens[task.index++];
        } else if (task.kind === "repeat") {
          if (task.remaining-- <= 0) { this.tasks.pop(); continue; }
          this.schedule(task.procedure); continue;
        } else if (task.kind === "for") {
          if (task.increment > 0 ? task.current > task.limit : task.current < task.limit) { this.tasks.pop(); continue; }
          this.push(task.current); task.current = finite(task.current + task.increment); this.schedule(task.procedure); continue;
        } else if (task.kind === "forall") {
          if (task.index === task.values.length) { this.tasks.pop(); continue; }
          const items = task.source ? [task.source[task.index++]] : task.values[task.index++];
          for (const item of items) this.push(item);
          this.schedule(task.procedure); continue;
        } else if (task.kind === "resourceforall") {
          if (task.index === task.keys.length) { this.tasks.pop(); continue; }
          const name = task.keys[task.index++];
          if (name.length > task.scratch.length) throw unsupported("PostScript resourceforall scratch string is too small.", "resourceforall", "rangecheck");
          for (let i = 0; i < name.length; i++) task.scratch[i] = name.charCodeAt(i);
          this.push(byteView(task.scratch, 0, name.length)); this.schedule(task.procedure); continue;
        } else if (task.kind === "pathforall") {
          if (task.index === task.entries.length) { this.tasks.pop(); continue; }
          const entry = task.entries[task.index++];
          for (const item of entry.args) this.push(item);
          this.schedule(entry.procedure); continue;
        } else if (task.kind === "stopped") { this.tasks.pop(); this.push(false); continue; }
        else if (task.kind === "eexec-end") { this.tasks.pop(); this.dictionaries.splice(task.dictionaryDepth); continue; }
        else if (task.kind === "source-boundary") throw unsupported("An unexpected procedure-source execution boundary was encountered.");
        else { this.schedule(task.procedure); continue; }
        if (isName(value) && !value.literal) this.execute(this.lookup(value.value), value.value);
        else if (isOperator(value)) { this.activeCommand = value; this.operator(value.name); }
        else this.push(value);
      } catch (caught) {
        const failure = caught instanceof PostScriptSourceFailure ? caught : undefined;
        const sourceError = failure?.error ?? caught;
        const command = isName(value) ? value.value : isOperator(value) ? value.name : undefined;
        // Low-level graphics/stream helpers know the language error; the VM
        // knows which resolved operator caused it. Preserve both facts.
        const error = sourceError instanceof PdfError && typeof sourceError.details?.operator === "string" &&
          POST_SCRIPT_ERROR_NAMES.has(sourceError.details.operator)
          ? new PdfError(sourceError.code, sourceError.message, { cause: sourceError, details: {
            ...sourceError.details, postScriptError: sourceError.details.operator,
            operator: isOperator(this.activeCommand) ? this.activeCommand.name : command ?? sourceError.details.operator
          } }) : sourceError;
        const catchable = error instanceof PdfError && error.code === "unsupported-font" &&
          (error.details?.reason === "font-postscript-unsupported" || error.details?.reason === "font-postscript-file");
        const barrier = lastIndex(this.tasks, item => item.kind === "stopped");
        if (barrier <= floor || (!(error instanceof PostScriptStop) && !catchable)) {
          if (boundary && catchable) throw failure ?? new PostScriptSourceFailure(error, operands, this.activeCommand ?? value);
          if (boundary && error instanceof PostScriptStop) throw error;
          if (catchable && command && !error.details?.operator) throw new PdfError(error.code, error.message, { cause: error, details: { ...error.details, operator: command } });
          if (error instanceof PostScriptStop) throw unsupported("PostScript stop occurs outside stopped.", "stop");
          throw error;
        }
        if (!(error instanceof PostScriptStop)) {
          this.setGlobal(false);
          this.stack.length = 0; for (const operand of failure?.operands ?? operands) this.push(operand);
          this.errors.set("newerror", true);
          this.errors.set("errorname", literalName(postScriptErrorName(error)));
          if (failure?.command ?? this.activeCommand ?? value) this.errors.set("command", failure?.command ?? this.activeCommand ?? value!);
        }
        this.unwindTasks(barrier);
        this.push(true);
      }
    }
  }

  private execute(value: Value | undefined, name?: string): void {
    const aliases = new Set<string>();
    while (isName(value) && !value.literal) {
      if (aliases.has(value.value)) throw unsupported("Cyclic executable PostScript name aliases were encountered.", value.value);
      aliases.add(value.value); name = value.value; value = this.lookup(value.value);
    }
    if (value === undefined) throw unsupported(`PostScript operator/name ${name ?? "(missing)"} is unavailable.`, name);
    if (isProcedure(value)) this.schedule(value);
    else if (isOperator(value)) { this.activeCommand = value; this.operator(value.name); }
    else if ((value instanceof Uint8Array || tagged(value, "file")) && isExecutable(value)) {
      requireAccess(value, 1);
      this.tasks.push({ kind: "input", reader: value instanceof Uint8Array
        ? this.lexer(value) : (value as PsFile).reader, sourceFile: !(value instanceof Uint8Array) });
    }
    else this.push(value);
  }

  private schedule(procedure: Procedure): void {
    requireAccess(procedure, 1);
    this.tasks.push({ kind: "tokens", tokens: procedure.tokens, index: 0 });
  }
  private push(value: Value): void {
    if (this.stack.length >= (this.options.maxStack ?? Number.MAX_SAFE_INTEGER)) throw limited("operand-stack");
    if (typeof value === "number") finite(value);
    this.register(value, this.globalMode); this.stack.push(value);
  }
  private register(value: Value, global: boolean): void {
    if (!isComposite(value)) return;
    const storage = storageOf(value);
    if (globalAttributes.has(storage)) return;
    globalAttributes.set(storage, global);
    if (isProcedure(value)) this.register(value.tokens as Value[], global);
    if (global) {
      if (value instanceof Map) for (const item of value.values()) requireGlobalReference(value, item);
      else if (arraySequence(value)) for (const item of arraySequence(value)!) requireGlobalReference(value, item);
    }
  }
  private registerGraph(root: Value, global: boolean): void {
    const pending = [root], seen = new Set<object>();
    while (pending.length) {
      throwIfAborted(this.options.signal); const value = pending.pop()!;
      if (!isComposite(value) || seen.has(value)) continue;
      seen.add(value); if (!globalAttributes.has(storageOf(value))) globalAttributes.set(storageOf(value), global);
      if (value instanceof Map) for (const item of value.values()) pending.push(item);
      else if (sequence(value)) for (const item of sequence(value)!) pending.push(item);
    }
  }
  lexer(bytes: Uint8Array | NativeFontPostScriptFile): FontPostScriptLexer {
    const lexer = new FontPostScriptLexer(bytes, this.options.signal, this.options.maxStringBytes, name => this.lookup(name), value => this.register(value, this.globalMode));
    if (!globalAttributes.has(lexer.file)) globalAttributes.set(lexer.file, this.globalMode);
    return lexer;
  }
  private setGlobal(global: boolean): void {
    this.globalMode = global;
    this.system.set("FontDirectory", global ? this.globalDirectory : this.directory);
  }
  private pop(): Value { if (!this.stack.length) throw unsupported("PostScript operand stack underflow."); return this.stack.pop()!; }
  private number(): number { return requireNumber(this.pop()); }
  private integer(): number { const n = this.number(); if (!Number.isSafeInteger(n)) throw unsupported("An integer PostScript operand is required."); return n; }
  private count(): number { const n = this.integer(); if (n < 0) throw unsupported("A nonnegative PostScript count is required.", undefined, "rangecheck"); return n; }
  private procedure(): Procedure { const value = this.pop(); if (!isProcedure(value)) throw unsupported("A PostScript procedure is required."); return value; }
  private dictionary(): Dictionary { const value = this.pop(); if (!(value instanceof Map)) throw unsupported("A PostScript dictionary is required."); return value; }
  private name(): string { return key(this.pop()); }
  private lookup(name: string): Value | undefined {
    for (let i = this.dictionaries.length - 1; i >= 0; i--) {
      this.requireDictionaryLookup(this.dictionaries[i]);
      if (this.dictionaries[i].has(name)) return this.dictionaries[i].get(name);
    }
    return undefined;
  }
  private requireDictionaryLookup(dictionary: Dictionary): void {
    if (!this.privilegedDictionaries.has(dictionary)) requireAccess(dictionary, 2);
  }
  private marked(): Value[] {
    const index = lastIndex(this.stack, value => tagged(value, "mark"));
    if (index < 0) throw unsupported("A PostScript mark is missing.");
    return this.stack.splice(index).slice(1);
  }

  private readMatrix(value: Value): NativeFontPostScriptMatrix {
    requireAccess(value, 2);
    const items = arraySequence(value);
    if (!items || items.length !== 6) throw unsupported("A six-element PostScript matrix is required.");
    return items.map(requireNumber) as unknown as NativeFontPostScriptMatrix;
  }
  private writeMatrix(value: Value, matrix: NativeFontPostScriptMatrix): void {
    requireAccess(value, 3);
    if (arraySequence(value)?.length !== 6) throw unsupported("A six-element PostScript matrix is required.");
    matrix.forEach((item, index) => put(value, index, item)); this.push(value);
  }
  private contextMatrix(operator: string): NativeFontPostScriptMatrix {
    if (!this.matrixKnown) throw unsupported("Device-dependent PostScript matrix reads require an explicit font context.", operator);
    return this.matrix;
  }
  private glyphContext(operator: string): NativeFontPostScriptGlyphContext {
    if (!this.options.glyphContext) throw unsupported("PostScript painting requires a glyph graphics context.", operator);
    return this.options.glyphContext;
  }
  private currentColorSpace(): Value {
    const context = this.glyphContext("currentcolorspace"), values = context.sourceColorValues, space = context.sourceColorSpace;
    if (!values || !space) throw unsupported("The enclosing PDF glyph color space is unavailable during cached font execution.", "currentcolorspace");
    let array = this.colorSpaces.get(values);
    if (!array) { array = reduceAccess([literalName(space)], 2); this.register(array, true); this.colorSpaces.set(values, array); }
    return array;
  }
  private imageSource(value: Value): NativeFontPostScriptFile {
    if (value instanceof Uint8Array) {
      requireAccess(value, 2);
      // Image strings repeat; filter strings instead end when exhausted.
      return createNativeFontPostScriptProcedureFile({ kind: "procedure", tokens: [] }, () => value, this.fileOptions());
    }
    if (isProcedure(value)) { requireAccess(value, 1); return createNativeFontPostScriptProcedureFile(value, procedure => this.executeSource(procedure), this.fileOptions()); }
    return this.file(value).reader.file;
  }
  private image(name: "image" | "imagemask" | "colorimage"): void {
    const context = this.glyphContext(name), ctm = this.contextMatrix(name);
    let width: number, height: number, bits: number, matrix: NativeFontPostScriptMatrix;
    let components: 1 | 3 | 4 = 1, sources: Value[], decode: number[] | undefined, interpolate = false, polarity = true;
    const dictionary = this.stack.at(-1);
    if (dictionary instanceof Map && name !== "colorimage") {
      this.pop(); requireAccess(dictionary, 2);
      if (dictionary.get("ImageType") !== 1) throw unsupported("Only sampled Type 1 PostScript image dictionaries are supported.", name);
      width = requireNumber(dictionary.get("Width") ?? null); height = requireNumber(dictionary.get("Height") ?? null);
      bits = requireNumber(dictionary.get("BitsPerComponent") ?? (name === "imagemask" ? 1 : null));
      matrix = this.readMatrix(dictionary.get("ImageMatrix") ?? null);
      const decodeValue = dictionary.get("Decode");
      if (decodeValue === undefined) throw unsupported("A PostScript image dictionary requires Decode.", name);
      requireAccess(decodeValue, 2); const decodeArray = arraySequence(decodeValue);
      if (!decodeArray) throw unsupported("PostScript image Decode requires an array.", name); decode = decodeArray.map(requireNumber);
      if (name === "imagemask") {
        if (decode.length !== 2 || !((decode[0] === 0 && decode[1] === 1) || (decode[0] === 1 && decode[1] === 0))) throw unsupported("PostScript imagemask Decode must be [0 1] or [1 0].", name, "rangecheck");
        polarity = decode[0] === 1;
      } else {
        const space = context.sourceColorSpace;
        if (!space) throw unsupported("PostScript image needs an explicit DeviceGray, DeviceRGB or DeviceCMYK color space.", name);
        components = space === "DeviceGray" ? 1 : space === "DeviceRGB" ? 3 : 4;
      }
      const interpolation = dictionary.get("Interpolate") ?? false;
      if (typeof interpolation !== "boolean") throw unsupported("PostScript image Interpolate requires a boolean.", name); interpolate = interpolation;
      const multiple = dictionary.get("MultipleDataSources") ?? false;
      if (typeof multiple !== "boolean" || (name === "imagemask" && multiple)) throw unsupported("Invalid PostScript MultipleDataSources.", name);
      const source = dictionary.get("DataSource") ?? null;
      if (multiple) { requireAccess(source, 2); const array = arraySequence(source); if (!array || array.length !== components) throw unsupported("PostScript image needs one data source per color component.", name); sources = [...array]; }
      else sources = [source];
    } else {
      if (name === "colorimage") {
        const count = this.integer(), multiple = this.pop();
        if (![1, 3, 4].includes(count) || typeof multiple !== "boolean") throw unsupported("Invalid PostScript colorimage components or source organization.", name);
        components = count as 1 | 3 | 4; sources = [];
        for (let i = 0; i < (multiple ? count : 1); i++) sources.unshift(this.pop());
      } else sources = [this.pop()];
      matrix = this.readMatrix(this.pop());
      if (name === "imagemask") { const value = this.pop(); if (typeof value !== "boolean") throw unsupported("PostScript imagemask polarity requires a boolean.", name); polarity = value; bits = 1; }
      else bits = this.integer();
      height = this.integer(); width = this.integer();
    }
    if (!Number.isSafeInteger(width) || width < 0 || !Number.isSafeInteger(height) || height < 0 || ![1, 2, 4, 8, 12].includes(bits) || (name === "imagemask" && bits !== 1)) throw unsupported("Invalid PostScript image dimensions or bit depth.", name, "rangecheck");
    // Validate the matrix before consuming inline bytes from currentfile.
    nativeFontPostScriptInvertMatrix(matrix);
    if (width === 0 || height === 0) return;
    const rowBytes = Math.ceil(width * components * bits / 8), length = rowBytes * height;
    const data = allocatedBytes(length, this.options.maxStringBytes), readers = sources.map(source => this.imageSource(source));
    let used = 0;
    if (readers.length === 1) used = readers[0].readInto(data);
    else {
      const planeRowBytes = Math.ceil(width * bits / 8), planes = readers.map(() => allocatedBytes(planeRowBytes, this.options.maxStringBytes));
      rows: for (let y = 0; y < height; y++) {
        throwIfAborted(this.options.signal);
        // Round-robin byte reads preserve procedure call order when component
        // procedures obtain successive same-size strings from one input file.
        for (let byte = 0; byte < planeRowBytes; byte++) for (let component = 0; component < readers.length; component++) {
          const value = readers[component].readByte(); if (value < 0) break rows;
          planes[component][byte] = value;
        }
        for (let x = 0; x < width; x++) {
          if ((x & 255) === 0) throwIfAborted(this.options.signal);
          for (let component = 0; component < components; component++) for (let bit = 0; bit < bits; bit++) {
            const sourceBit = x * bits + bit, destinationBit = y * rowBytes * 8 + (x * components + component) * bits + bit;
            data[Math.floor(destinationBit / 8)] |= ((planes[component][Math.floor(sourceBit / 8)] >>> (7 - sourceBit % 8)) & 1) << (7 - destinationBit % 8);
          }
        }
        used += rowBytes;
      }
    }
    context.image({ width, height, bitsPerComponent: bits as 1 | 2 | 4 | 8 | 12, components,
      data: data.subarray(0, used), imageMatrix: matrix, ctm, decode, mask: name === "imagemask", polarity, interpolate });
  }
  private resource(category: string, global = this.globalMode): Dictionary {
    const resources = global ? this.globalResources : this.resources;
    let directory = resources.get(category);
    if (!directory) { directory = new Map(); globalAttributes.set(directory, global); resources.set(category, directory); }
    return directory;
  }
  private findResource(category: string, key: string): Value | undefined {
    return (!this.globalMode ? this.resources.get(category)?.get(key) : undefined) ?? this.globalResources.get(category)?.get(key);
  }
  private resourceKeys(category: string): readonly string[] {
    return [...new Set([...(this.globalResources.get(category)?.keys() ?? []), ...(!this.globalMode ? this.resources.get(category)?.keys() ?? [] : [])])];
  }
  private defineResource(category: string, key: string, instance: Value): void {
    if (this.globalMode && !isGlobal(instance)) throw unsupported("A local PostScript resource cannot be registered globally.", "invalidaccess");
    if (this.globalMode) this.resource(category, false).delete(key);
    this.resource(category).set(key, instance);
    if (category === "Font") this.rebuildFontDirectory();
  }
  private rebuildFontDirectory(): void {
    this.directory.clear();
    for (const [key, value] of this.globalDirectory) this.directory.set(key, value);
    for (const [key, value] of this.localFonts) this.directory.set(key, value);
  }
  private unwindTasks(index: number): void {
    for (let i = this.tasks.length - 1; i >= index; i--) {
      const task = this.tasks[i]; if (task.kind === "eexec-end") this.dictionaries.splice(task.dictionaryDepth);
    }
    this.tasks.splice(index);
  }
  private file(value: Value): PsFile {
    if (!tagged(value, "file")) throw unsupported("A font-local PostScript input file is required.");
    requireAccess(value, 2); return value as PsFile;
  }
  private fileOptions() { return { signal: this.options.signal, maxDecodedBytes: this.options.maxStringBytes }; }
  executeSource(procedure: Procedure): Uint8Array {
    const boundary: Task = { kind: "source-boundary" }, depth = this.tasks.length;
    const command = this.activeCommand;
    this.tasks.push(boundary);
    try {
      this.schedule(procedure); this.run(boundary);
      const result = this.pop(); if (!(result instanceof Uint8Array)) throw unsupported("A PostScript data source must return a string.", undefined, "typecheck");
      requireAccess(result, 2); return result;
    } catch (error) {
      if (error instanceof RangeError && /call stack/i.test(error.message)) throw new PdfError("resource-limit", "The host stack cannot execute this nested PostScript stream chain.", { cause: error });
      throw error;
    } finally { this.unwindTasks(depth); this.activeCommand = command; }
  }
  private save(): PsSave {
    const objects: VmSnapshot["objects"] = new Map();
    const pending: Value[] = [...this.dictionaries, this.directory, this.localFonts, this.globalDirectory, this.errors, ...this.resources.values(), ...this.globalResources.values(), ...this.stack];
    for (const values of [this.options.glyphContext?.sourceColorValues,
      ...this.graphics.map(state => state.glyphState?.sourceColor?.values)]) {
      const space = values ? this.colorSpaces.get(values) : undefined;
      if (space) pending.push(space);
    }
    for (const task of this.tasks) {
      if (task.kind === "tokens") pending.push(task.tokens as Value[]);
      if ("procedure" in task) pending.push(task.procedure);
      if (task.kind === "forall") { if (task.source) pending.push(task.source); else for (const values of task.values) for (const value of values) pending.push(value); }
      if (task.kind === "resourceforall") pending.push(task.scratch);
      if (task.kind === "pathforall") for (const entry of task.entries) pending.push(entry.procedure);
    }
    while (pending.length) {
      throwIfAborted(this.options.signal);
      const value = pending.pop()!;
      if (!isComposite(value) || objects.has(value)) continue;
      let contents: Value[] | Uint8Array | [string, Value][] | undefined;
      if (value instanceof Map) { contents = [...value]; for (const item of value.values()) pending.push(item); }
      else if (value instanceof Uint8Array) { const parent = byteViews.get(value); if (parent) pending.push(parent.source); }
      else if (Array.isArray(value)) { contents = [...value]; for (const item of value) pending.push(item); const parent = arrayViews.get(value); if (parent) pending.push(parent.source); }
      else if (isProcedure(value)) pending.push(value.tokens as Value[]);
      objects.set(value, { value, contents, access: accessOf(value), capacity: value instanceof Map ? dictionaryCapacities.get(value) : undefined });
    }
    const save: PsSave = { kind: "save", owner: this, snapshot: { objects, matrix: this.matrix, matrixKnown: this.matrixKnown, graphics: [...this.graphics], definedFont: this.definedFont, resources: [...this.resources], createdCount: this.created.length, packing: this.packing, globalMode: this.globalMode, glyphState: this.options.glyphContext?.captureState() } };
    this.saves.push(save); return save;
  }
  private restore(value: Value): void {
    if (!tagged(value, "save")) throw unsupported("PostScript restore requires a save object.", "restore");
    const save = value as PsSave, index = this.saves.indexOf(save);
    if (save.owner !== this || index < 0) throw unsupported("The PostScript save object is no longer valid.", "invalidrestore");
    const { objects } = save.snapshot;
    for (const reference of [...this.stack, ...this.dictionaries]) {
      if (isComposite(reference) && !isGlobal(reference) && !objects.has(storageOf(reference))) throw unsupported("A newer composite object remains on a PostScript stack.", "invalidrestore");
    }
    for (const task of this.tasks) if (task.kind === "tokens" && !isGlobal(task.tokens as Value[]) && !objects.has(storageOf(task.tokens as Value[]))) throw unsupported("A newer procedure remains on the PostScript execution stack.", "invalidrestore");
    for (const { value: target, contents, access, capacity } of objects.values()) {
      throwIfAborted(this.options.signal);
      if (isGlobal(target)) continue;
      if (target instanceof Map) { target.clear(); for (const [key, item] of contents as [string, Value][]) target.set(key, item); }
      else if (Array.isArray(target)) for (let i = 0; i < target.length; i++) target[i] = (contents as Value[])[i];
      accessAttributes.set(target as object, access);
      if (target instanceof Map) { if (capacity === undefined) dictionaryCapacities.delete(target); else dictionaryCapacities.set(target, capacity); }
    }
    this.matrix = save.snapshot.matrix;
    this.matrixKnown = save.snapshot.matrixKnown;
    this.graphics.splice(0, this.graphics.length, ...save.snapshot.graphics);
    if (save.snapshot.glyphState) this.options.glyphContext?.restoreState(save.snapshot.glyphState);
    // A globally registered font survives local VM rollback, including the
    // font engine's result pointer. Merely allocating its dictionary globally
    // does not make a registration in the local Font resource survive.
    if (!this.definedFont || ![...this.globalDirectory.values()].includes(this.definedFont)) {
      this.definedFont = save.snapshot.definedFont;
    }
    this.created.length = save.snapshot.createdCount;
    this.packing = save.snapshot.packing;
    this.setGlobal(save.snapshot.globalMode);
    this.resources.clear(); for (const [key, directory] of save.snapshot.resources) this.resources.set(key, directory);
    this.rebuildFontDirectory();
    this.saves.splice(index);
  }

  private operator(name: string): void {
    switch (name) {
      case "[": case "mark": this.push({ kind: "mark" }); break;
      case "]": this.push(this.marked()); break;
      case "<<": this.push({ kind: "mark" }); break;
      case ">>": {
        const items = this.marked(); if (items.length % 2) throw unsupported("An inline PostScript dictionary has an unmatched key.");
        const dict = new Map<string, Value>(); for (let i = 0; i < items.length; i += 2) dict.set(key(items[i]), items[i + 1]);
        this.created.push(dict); this.push(dict); break;
      }
      case "pop": this.pop(); break;
      case "dup": { const value = this.pop(); this.push(value); this.push(value); break; }
      case "exch": { const b = this.pop(), a = this.pop(); this.push(b); this.push(a); break; }
      case "index": { const n = this.count(); if (n >= this.stack.length) throw unsupported("PostScript index is outside the operand stack."); this.push(this.stack[this.stack.length - 1 - n]); break; }
      case "roll": {
        const j = this.integer(), n = this.count(); if (n > this.stack.length) throw unsupported("PostScript roll exceeds the operand stack.");
        if (n) { const shift = ((j % n) + n) % n, values = this.stack.splice(this.stack.length - n); for (const value of values.slice(n - shift)) this.push(value); for (const value of values.slice(0, n - shift)) this.push(value); } break;
      }
      case "clear": this.stack.length = 0; break;
      case "count": this.push(this.stack.length); break;
      case "cleartomark": this.marked(); break;
      case "counttomark": { const i = lastIndex(this.stack, value => tagged(value, "mark")); if (i < 0) throw unsupported("A PostScript mark is missing."); this.push(this.stack.length - i - 1); break; }
      case "array": this.push(allocatedArray(this.count())); break;
      case "string": this.push(allocatedBytes(this.count(), this.options.maxStringBytes)); break;
      case "dict": { const capacity = this.count(), dict = new Map<string, Value>(); dictionaryCapacities.set(dict, capacity); this.created.push(dict); this.push(dict); break; }
      case "begin": { const dict = this.dictionary(); requireAccess(dict, 2); this.dictionaries.push(dict); break; }
      case "end": if (this.dictionaries.length <= 3) throw unsupported("PostScript dictionary stack underflow."); else this.dictionaries.pop(); break;
      case "currentdict": this.push(this.dictionaries.at(-1)!); break;
      case "countdictstack": this.push(this.dictionaries.length); break;
      case "dictstack": {
        const target = this.pop(); requireAccess(target, 3);
        if (!arraySequence(target) || arraySequence(target)!.length < this.dictionaries.length) throw unsupported("PostScript dictstack destination is too small.");
        this.dictionaries.forEach((dict, i) => put(target, i, dict)); this.push(sequenceView(target, 0, this.dictionaries.length)); break;
      }
      case "cleardictstack": this.dictionaries.splice(3); break;
      case "maxlength": { const dict = this.dictionary(); requireAccess(dict, 2); this.push(Math.max(dictionaryCapacities.get(dict) ?? 0, dict.size)); break; }
      case "def": { const value = this.pop(), k = this.name(), dict = this.dictionaries.at(-1)!; requireAccess(dict, 3); requireGlobalReference(dict, value); dict.set(k, value); break; }
      case "store": { const value = this.pop(), k = this.name(); const dict = [...this.dictionaries].reverse().find(d => { this.requireDictionaryLookup(d); return d.has(k); }) ?? this.dictionaries.at(-1)!; requireAccess(dict, 3); requireGlobalReference(dict, value); dict.set(k, value); break; }
      case "load": { const k = this.name(), value = this.lookup(k); if (value === undefined) throw unsupported(`PostScript name ${k} is undefined.`, k); this.push(value); break; }
      case "where": { const k = this.name(), dict = [...this.dictionaries].reverse().find(d => { this.requireDictionaryLookup(d); return d.has(k); }); if (dict) this.push(dict); this.push(dict !== undefined); break; }
      case "known": { const k = this.name(), dict = this.dictionary(); requireAccess(dict, 2); this.push(dict.has(k)); break; }
      case "undef": { const k = this.name(), dict = this.dictionary(); requireAccess(dict, 3); dict.delete(k); break; }
      case "get": { const index = this.pop(), source = this.pop(); this.push(get(source, index)); break; }
      case "put": { const value = this.pop(), index = this.pop(), source = this.pop(); put(source, index, value); break; }
      case "length": { const value = this.pop(); if (isComposite(value)) requireAccess(value, 2); if (value instanceof Map) this.push(value.size); else if (Array.isArray(value) || value instanceof Uint8Array) this.push(value.length); else if (isProcedure(value)) this.push(value.tokens.length); else if (isName(value)) this.push(value.value.length); else throw unsupported("PostScript length requires a composite value."); break; }
      case "getinterval": {
        const count = this.count(), start = this.count(), source = this.pop();
        requireAccess(source, 2);
        const items = sequence(source);
        if (!items || start + count > items.length) throw unsupported("PostScript getinterval is outside its source.");
        this.push(sequenceView(source, start, count)); break;
      }
      case "putinterval": {
        const source = this.pop(), start = this.count(), target = this.pop();
        requireAccess(source, 2); requireAccess(target, 3);
        const sourceItems = sequence(source), targetItems = sequence(target);
        if (!sourceItems || !targetItems || (source instanceof Uint8Array) !== (target instanceof Uint8Array) || start + sourceItems.length > targetItems.length) throw unsupported("PostScript putinterval has invalid ranges.");
        const values = Array.from(sourceItems); for (const item of values) requireGlobalReference(target, item);
        for (let i = 0; i < values.length; i++) put(target, start + i, values[i]); break;
      }
      case "aload": { const value = this.pop(); requireAccess(value, 2); const items = arraySequence(value); if (!items) throw unsupported("PostScript aload requires an array."); for (const item of items) this.push(item); this.push(value); break; }
      case "astore": { const value = this.pop(); requireAccess(value, 3); const array = arraySequence(value); if (!array || array.length > this.stack.length) throw unsupported("PostScript astore has invalid operands."); const items = this.stack.slice(this.stack.length - array.length); for (const item of items) requireGlobalReference(value, item); this.stack.length -= array.length; for (let i = 0; i < items.length; i++) array[i] = items[i]; this.push(value); break; }
      case "copy": {
        const target = this.pop();
        if (typeof target === "number") { if (!Number.isSafeInteger(target) || target < 0 || target > this.stack.length) throw unsupported("PostScript copy count is invalid."); for (const item of this.stack.slice(this.stack.length - target)) this.push(item); }
        else { const source = this.pop(); requireAccess(source, 2); requireAccess(target, 3); if (target instanceof Map && source instanceof Map) { for (const value of source.values()) requireGlobalReference(target, value); for (const [k, value] of source) target.set(k, value); this.push(target); }
          else if (sequence(target) && sequence(source) && (target instanceof Uint8Array) === (source instanceof Uint8Array) && sequence(source)!.length <= sequence(target)!.length) { const items = Array.from(sequence(source)!); for (const item of items) requireGlobalReference(target, item); for (let i = 0; i < items.length; i++) put(target, i, items[i]); this.push(sequenceView(target, 0, items.length)); }
          else throw unsupported("PostScript copy operands are incompatible."); } break;
      }
      case "add": case "sub": case "mul": case "div": case "idiv": case "mod": case "exp": case "atan": {
        const b = this.number(), a = this.number();
        if ((name === "idiv" || name === "mod") && (!Number.isInteger(a) || !Number.isInteger(b))) throw unsupported(`PostScript ${name} requires integer operands.`);
        this.push(name === "add" ? a + b : name === "sub" ? a - b : name === "mul" ? a * b : name === "div" ? a / b : name === "idiv" ? Math.trunc(a / b) : name === "mod" ? a % b : name === "exp" ? a ** b : ((Math.atan2(a, b) * 180 / Math.PI) + 360) % 360); break;
      }
      case "cvi": case "cvr": {
        const value = this.pop(); let number: number;
        if (value instanceof Uint8Array) {
          requireAccess(value, 2); const lexer = new FontPostScriptLexer(value, this.options.signal, this.options.maxStringBytes);
          const token = lexer.next(); if (typeof token !== "number") throw unsupported("The PostScript string is not a number."); number = token;
        } else number = requireNumber(value);
        this.push(name === "cvi" ? Math.trunc(number) : number); break;
      }
      case "cvs": case "cvrs": {
        const target = this.pop(); const radix = name === "cvrs" ? this.integer() : 10; const value = this.pop();
        if (!(target instanceof Uint8Array)) throw unsupported("PostScript string conversion requires a destination string.");
        requireAccess(target, 3);
        if (radix < 2 || radix > 36) throw unsupported("PostScript conversion radix must be between 2 and 36.");
        if (name === "cvrs" && typeof value !== "number") throw unsupported("PostScript cvrs requires a numeric operand.");
        const text = name === "cvrs" && radix !== 10 ? (Math.trunc(requireNumber(value)) >>> 0).toString(radix).toUpperCase() : postScriptString(value);
        if (text.length > target.length) throw unsupported("PostScript conversion destination is too small.");
        for (let i = 0; i < text.length; i++) target[i] = text.charCodeAt(i); this.push(byteView(target, 0, text.length)); break;
      }
      case "search": case "anchorsearch": {
        const seek = this.pop(), source = this.pop();
        if (!(seek instanceof Uint8Array) || !(source instanceof Uint8Array)) throw unsupported("PostScript search requires strings.");
        requireAccess(seek, 2); requireAccess(source, 2);
        const found = byteString(source).indexOf(byteString(seek));
        if (found < 0 || (name === "anchorsearch" && found !== 0)) { this.push(source); this.push(false); }
        else { this.push(byteView(source, found + seek.length, source.length - found - seek.length)); this.push(byteView(source, found, seek.length)); if (name === "search") this.push(byteView(source, 0, found)); this.push(true); } break;
      }
      case "neg": case "abs": case "sqrt": case "ln": case "log": case "sin": case "cos": case "floor": case "ceiling": case "round": case "truncate": {
        const a = this.number(); this.push(name === "neg" ? -a : name === "abs" ? Math.abs(a) : name === "sqrt" ? Math.sqrt(a) : name === "ln" ? Math.log(a) : name === "log" ? Math.log10(a) : name === "sin" ? Math.sin(a * Math.PI / 180) : name === "cos" ? Math.cos(a * Math.PI / 180) : name === "floor" ? Math.floor(a) : name === "ceiling" ? Math.ceil(a) : name === "round" ? Math.floor(a + 0.5) : Math.trunc(a)); break;
      }
      case "eq": case "ne": case "lt": case "le": case "gt": case "ge": {
        const b = this.pop(), a = this.pop(); const equal = equalValue(a, b);
        if (name === "eq" || name === "ne") this.push(name === "eq" ? equal : !equal);
        else { let order: number;
          if (typeof a === "number" && typeof b === "number") order = a - b;
          else if (a instanceof Uint8Array && b instanceof Uint8Array) { requireAccess(a, 2); requireAccess(b, 2); const left = byteString(a), right = byteString(b); order = left < right ? -1 : left > right ? 1 : 0; }
          else throw unsupported("Ordered PostScript comparison requires numbers or strings.");
          this.push(name === "lt" ? order < 0 : name === "le" ? order <= 0 : name === "gt" ? order > 0 : order >= 0); } break;
      }
      case "and": case "or": case "xor": {
        const b = this.pop(), a = this.pop(); if (typeof a === "boolean" && typeof b === "boolean") this.push(name === "and" ? a && b : name === "or" ? a || b : a !== b);
        else if (typeof a === "number" && typeof b === "number" && Number.isInteger(a) && Number.isInteger(b)) this.push(name === "and" ? a & b : name === "or" ? a | b : a ^ b);
        else throw unsupported("PostScript logical operands are incompatible."); break;
      }
      case "not": { const value = this.pop(); if (typeof value === "boolean") this.push(!value); else if (typeof value === "number" && Number.isInteger(value)) this.push(~value); else throw unsupported("Invalid PostScript not operand."); break; }
      case "bitshift": { const shift = this.integer(), value = this.integer(); this.push(Math.abs(shift) >= 32 ? 0 : shift < 0 ? value >>> -shift : value << shift); break; }
      case "if": { const procedure = this.procedure(), condition = this.pop(); if (typeof condition !== "boolean") throw unsupported("PostScript if requires a boolean."); if (condition) this.schedule(procedure); break; }
      case "ifelse": { const no = this.procedure(), yes = this.procedure(), condition = this.pop(); if (typeof condition !== "boolean") throw unsupported("PostScript ifelse requires a boolean."); this.schedule(condition ? yes : no); break; }
      case "repeat": { const procedure = this.procedure(), remaining = this.count(); this.tasks.push({ kind: "repeat", procedure, remaining }); break; }
      case "for": { const procedure = this.procedure(), limit = this.number(), increment = this.number(), current = this.number(); if (!increment) throw unsupported("A zero PostScript for increment is invalid."); this.tasks.push({ kind: "for", current, increment, limit, procedure }); break; }
      case "forall": {
        const procedure = this.procedure(), source = this.pop(); let values: readonly (readonly Value[])[];
        requireAccess(source, 2);
        if (source instanceof Map) values = [...source].map(([k, value]) => [literalName(k), value]);
        else if (sequence(source)) values = Array.from(sequence(source)!, value => [value]);
        else throw unsupported("PostScript forall requires a composite value.");
        this.tasks.push({ kind: "forall", values, source: source instanceof Map ? undefined : sequence(source)!, index: 0, procedure }); break;
      }
      case "loop": this.tasks.push({ kind: "loop", procedure: this.procedure() }); break;
      case "exit": {
        const i = lastIndex(this.tasks, task => ["for", "forall", "resourceforall", "pathforall", "repeat", "loop", "stopped"].includes(task.kind) || (task.kind === "input" && task.sourceFile !== false));
        if (i < 0 || this.tasks[i].kind === "stopped" || this.tasks[i].kind === "input") throw unsupported("PostScript exit occurs outside an enclosing loop.", "invalidexit");
        this.unwindTasks(i); break;
      }
      case "stopped": { const object = this.pop(); this.tasks.push({ kind: "stopped" }); this.execute(object); break; }
      case "stop": throw new PostScriptStop();
      case "save": this.push(this.save()); break;
      case "restore": this.restore(this.pop()); break;
      case "setglobal": { const value = this.pop(); if (typeof value !== "boolean") throw unsupported("PostScript setglobal requires a boolean."); this.setGlobal(value); break; }
      case "currentglobal": this.push(this.globalMode); break;
      case "gcheck": this.push(isGlobal(this.pop())); break;
      case "rand": this.randomSeed = (this.randomSeed * 16807) % 2147483647; this.push(this.randomSeed); break;
      case "srand": { const seed = this.integer(); this.randomSeed = seed <= 0 ? 1 - seed : seed === 2147483647 ? 2147483646 : seed; break; }
      case "rrand": this.push(this.randomSeed); break;
      case "exec": this.execute(this.pop()); break;
      case "bind": { const procedure = this.procedure(); this.push(bindProcedure(procedure, name => this.lookup(name), this.options.signal)); break; }
      case "readonly": case "executeonly": case "noaccess": this.push(reduceAccess(this.pop(), name === "readonly" ? 2 : name === "executeonly" ? 1 : 0)); break;
      case "cvlit": case "cvx": { const value = this.pop(); this.push(changeExecution(value, name === "cvx")); break; }
      case "cvn": { const value = this.pop(); if (!(value instanceof Uint8Array)) throw unsupported("PostScript cvn requires a string."); requireAccess(value, 2); this.push(isExecutable(value) ? executableName(byteString(value)) : literalName(byteString(value))); break; }
      case "type": { const value = this.pop(); this.push(literalName(typeof value === "number" ? Number.isInteger(value) ? "integertype" : "realtype" : typeof value === "boolean" ? "booleantype" : value === null ? "nulltype" : value instanceof Map ? "dicttype" : value instanceof Uint8Array ? "stringtype" : Array.isArray(value) || isProcedure(value) ? "arraytype" : isName(value) ? "nametype" : tagged(value, "file") ? "filetype" : "operatortype")); break; }
      case "xcheck": { const value = this.pop(); this.push(isExecutable(value)); break; }
      case "rcheck": case "wcheck": { const value = this.pop(); if (!isComposite(value)) throw unsupported("PostScript access checks require an array, dictionary, string or file."); this.push(accessOf(value) >= (name === "rcheck" ? 2 : 3)); break; }
      case "matrix": this.push([...nativeFontPostScriptIdentityMatrix()]); break;
      case "identmatrix": this.writeMatrix(this.pop(), nativeFontPostScriptIdentityMatrix()); break;
      case "currentmatrix": this.writeMatrix(this.pop(), this.contextMatrix(name)); break;
      case "defaultmatrix": { if (!this.options.initialMatrix) throw unsupported("PostScript defaultmatrix requires an explicit device context.", name); this.writeMatrix(this.pop(), this.options.initialMatrix); break; }
      case "setmatrix": this.matrix = this.readMatrix(this.pop()); this.matrixKnown = true; break;
      case "initmatrix": if (!this.options.initialMatrix) throw unsupported("PostScript initmatrix requires an explicit device context.", name); else { this.matrix = this.options.initialMatrix; this.matrixKnown = true; } break;
      case "concat": this.matrix = nativeFontPostScriptConcatMatrices(this.readMatrix(this.pop()), this.matrix); break;
      case "concatmatrix": { const destination = this.pop(), second = this.readMatrix(this.pop()), first = this.readMatrix(this.pop()); this.writeMatrix(destination, nativeFontPostScriptConcatMatrices(first, second)); break; }
      case "invertmatrix": { const destination = this.pop(), source = this.readMatrix(this.pop()); this.writeMatrix(destination, nativeFontPostScriptInvertMatrix(source)); break; }
      case "translate": case "scale": case "rotate": {
        const explicit = !!arraySequence(this.stack.at(-1) ?? null), destination = explicit ? this.pop() : null;
        const b = this.number(), a = name === "rotate" ? 0 : this.number();
        const matrix = name === "translate" ? nativeFontPostScriptTranslation(a, b) : name === "scale" ? nativeFontPostScriptScaling(a, b) : nativeFontPostScriptRotation(b);
        if (destination) this.writeMatrix(destination, matrix); else this.matrix = nativeFontPostScriptConcatMatrices(matrix, this.matrix); break;
      }
      case "transform": case "dtransform": case "itransform": case "idtransform": {
        const matrix = arraySequence(this.stack.at(-1) ?? null) ? this.readMatrix(this.pop()) : this.contextMatrix(name);
        const y = this.number(), x = this.number(); const [tx, ty] = nativeFontPostScriptTransform(x, y, matrix, name === "dtransform" || name === "idtransform", name === "itransform" || name === "idtransform");
        this.push(tx); this.push(ty); break;
      }
      case "gsave": this.graphics.push({ matrix: this.matrix, known: this.matrixKnown, glyphState: this.options.glyphContext?.captureState() }); break;
      case "grestore": case "grestoreall": {
        const state = name === "grestoreall" ? this.graphics[0] : this.graphics.pop();
        if (state) { this.matrix = state.matrix; this.matrixKnown = state.known; if (state.glyphState) this.options.glyphContext?.restoreState(state.glyphState); }
        if (name === "grestoreall") this.graphics.length = 0;
        break;
      }
      case "newpath": this.glyphContext(name).newPath(); break;
      case "moveto": case "rmoveto": case "lineto": case "rlineto": {
        const y = this.number(), x = this.number(), context = this.glyphContext(name);
        if (name.endsWith("moveto")) context.moveTo(x, y, this.contextMatrix(name), name === "rmoveto");
        else context.lineTo(x, y, this.contextMatrix(name), name === "rlineto");
        break;
      }
      case "curveto": case "rcurveto": {
        const y = this.number(), x = this.number(), c2y = this.number(), c2x = this.number(), c1y = this.number(), c1x = this.number();
        this.glyphContext(name).curveTo(c1x, c1y, c2x, c2y, x, y, this.contextMatrix(name), name === "rcurveto"); break;
      }
      case "closepath": this.glyphContext(name).closePath(); break;
      case "currentpoint": for (const coordinate of this.glyphContext(name).currentPoint(this.contextMatrix(name))) this.push(coordinate); break;
      case "pathbbox": for (const coordinate of this.glyphContext(name).pathBBox(this.contextMatrix(name))) this.push(coordinate); break;
      case "arc": case "arcn": {
        const end = this.number(), start = this.number(), radius = this.number(), y = this.number(), x = this.number();
        this.glyphContext(name).arc(x, y, radius, start, end, this.contextMatrix(name), name === "arcn"); break;
      }
      case "arcto": {
        const radius = this.number(), y2 = this.number(), x2 = this.number(), y1 = this.number(), x1 = this.number();
        for (const coordinate of this.glyphContext(name).arcTo(x1, y1, x2, y2, radius, this.contextMatrix(name))) this.push(coordinate); break;
      }
      case "flattenpath": this.glyphContext(name).flattenPath(); break;
      case "reversepath": this.glyphContext(name).reversePath(); break;
      case "pathforall": {
        const close = this.procedure(), curve = this.procedure(), line = this.procedure(), move = this.procedure();
        for (const procedure of [close, curve, line, move]) requireAccess(procedure, 1);
        let x = 0, y = 0;
        const entries = this.glyphContext(name).pathElements(this.contextMatrix(name)).map(command => {
          if (command.kind === "close") return { args: [], procedure: close };
          const args = command.kind === "move" || command.kind === "line" ? [command.x, command.y]
            : command.kind === "cubic" ? [command.control1X, command.control1Y, command.control2X, command.control2Y, command.x, command.y]
            : [x + 2 / 3 * (command.controlX - x), y + 2 / 3 * (command.controlY - y),
              command.x + 2 / 3 * (command.controlX - command.x), command.y + 2 / 3 * (command.controlY - command.y), command.x, command.y];
          x = command.x; y = command.y;
          return { args, procedure: command.kind === "move" ? move : command.kind === "line" ? line : curve };
        });
        this.tasks.push({ kind: "pathforall", entries, index: 0 }); break;
      }
      case "fill": case "eofill": case "stroke": this.glyphContext(name).paint(name, this.contextMatrix(name)); break;
      case "clip": case "eoclip": this.glyphContext(name).clip(name === "clip" ? 0 : 1); break;
      case "rectclip": case "rectfill": case "rectstroke": {
        const pen = name === "rectstroke" && arraySequence(this.stack.at(-1) ?? null)?.length === 6 ? this.readMatrix(this.pop()) : null;
        const operand = this.pop(); let values: readonly number[];
        const array = arraySequence(operand);
        if (array) { requireAccess(operand, 2); values = array.map(requireNumber); }
        else if (typeof operand === "number") { const height = requireNumber(operand), width = this.number(), y = this.number(), x = this.number(); values = [x, y, width, height]; }
        else throw unsupported("PostScript rectangles require numbers or a numeric array; encoded number strings are unavailable.", name);
        if (values.length % 4) throw unsupported("PostScript rectangle arrays require groups of four numbers.", name, "rangecheck");
        const context = this.glyphContext(name), state = context.captureState(), matrix = this.contextMatrix(name);
        context.newPath();
        try {
          for (let i = 0; i < values.length; i += 4) {
            const [x, y, width, height] = values.slice(i, i + 4), left = Math.min(x, x + width), right = Math.max(x, x + width), bottom = Math.min(y, y + height), top = Math.max(y, y + height);
            context.moveTo(left, bottom, matrix); context.lineTo(right, bottom, matrix); context.lineTo(right, top, matrix); context.lineTo(left, top, matrix); context.closePath();
          }
          if (name === "rectclip") { context.clip(0); context.newPath(); }
          else context.paint(name === "rectfill" ? "fill" : "stroke", pen ? nativeFontPostScriptConcatMatrices(pen, matrix) : matrix);
        } finally { if (name !== "rectclip") context.restoreState(state); }
        break;
      }
      case "setlinewidth": this.glyphContext(name).setLineWidth(this.number()); break;
      case "setlinecap": this.glyphContext(name).setLineCap(this.integer()); break;
      case "setlinejoin": this.glyphContext(name).setLineJoin(this.integer()); break;
      case "setmiterlimit": this.glyphContext(name).setMiterLimit(this.number()); break;
      case "setdash": {
        const phase = this.number(), value = this.pop(); requireAccess(value, 2);
        const array = arraySequence(value); if (!array) throw unsupported("PostScript setdash requires an array.");
        this.glyphContext(name).setDash(array.map(requireNumber), phase); break;
      }
      case "currentlinewidth": this.push(this.glyphContext(name).strokeStyle.width); break;
      case "currentlinecap": this.push(this.glyphContext(name).strokeStyle.lineCap); break;
      case "currentlinejoin": this.push(this.glyphContext(name).strokeStyle.lineJoin); break;
      case "currentmiterlimit": this.push(this.glyphContext(name).strokeStyle.miterLimit); break;
      case "currentdash": { const style = this.glyphContext(name).strokeStyle; this.push([...style.dashArray]); this.push(style.dashPhase); break; }
      case "setgray": this.glyphContext(name).setColorGray(this.number()); break;
      case "setrgbcolor": { const b = this.number(), g = this.number(), r = this.number(); this.glyphContext(name).setColorRGB(r, g, b); break; }
      case "setcmykcolor": { const k = this.number(), y = this.number(), m = this.number(), c = this.number(); this.glyphContext(name).setColorCMYK(c, m, y, k); break; }
      case "sethsbcolor": {
        const b = this.number(), s = this.number(), h = this.number(); this.glyphContext(name).setColorHSB(h, s, b); break;
      }
      case "currentrgbcolor": for (const value of this.glyphContext(name).currentRGB) this.push(value); break;
      case "currentgray": this.push(this.glyphContext(name).currentGray); break;
      case "currentcmykcolor": for (const value of this.glyphContext(name).currentCMYK) this.push(value); break;
      case "currenthsbcolor": for (const value of this.glyphContext(name).currentHSB) this.push(value); break;
      case "setcharwidth": { const y = this.number(), x = this.number(); this.glyphContext(name).setMetrics(x, y); break; }
      case "setcachedevice": {
        const top = this.number(), right = this.number(), bottom = this.number(), left = this.number(), wy = this.number(), wx = this.number();
        this.glyphContext(name).setMetrics(wx, wy, [left, bottom, right, top]); break;
      }
      case "image": case "imagemask": case "colorimage": this.image(name); break;
      case "currentcolorspace": {
        this.push(this.currentColorSpace()); break;
      }
      case "setcolorspace": {
        const value = this.pop(); if (isComposite(value)) requireAccess(value, 2);
        const sequence = arraySequence(value), space = isName(value) ? value.value : sequence?.length === 1 && isName(sequence[0]) ? sequence[0].value : null;
        const context = this.glyphContext(name);
        if (space === "DeviceGray") context.setColorGray(0);
        else if (space === "DeviceRGB") context.setColorRGB(0, 0, 0);
        else if (space === "DeviceCMYK") context.setColorCMYK(0, 0, 0, 1);
        else throw unsupported("PostScript glyph colors support DeviceGray, DeviceRGB and DeviceCMYK.", name);
        if (sequence) this.colorSpaces.set(context.sourceColorValues!, value);
        break;
      }
      case "currentcolor": {
        const values = this.glyphContext(name).sourceColorValues;
        if (!values) throw unsupported("The enclosing PDF glyph color is unavailable during cached font execution.", name);
        for (const value of values) this.push(value); break;
      }
      case "setcolor": {
        const context = this.glyphContext(name), space = context.sourceColorSpace;
        const colorSpace = this.currentColorSpace();
        if (space === "DeviceGray") context.setColorGray(this.number());
        else if (space === "DeviceRGB") { const b = this.number(), g = this.number(), r = this.number(); context.setColorRGB(r, g, b); }
        else if (space === "DeviceCMYK") { const k = this.number(), y = this.number(), m = this.number(), c = this.number(); context.setColorCMYK(c, m, y, k); }
        else throw unsupported("PostScript setcolor requires an explicit color space in the cached glyph context.", name);
        this.colorSpaces.set(context.sourceColorValues!, colorSpace); break;
      }
      case "currentfile": {
        const active = [...this.tasks].reverse().find(task => task.kind === "input" && task.sourceFile !== false);
        if (!active || active.kind !== "input") throw unsupported("No font input file is active.");
        const file: PsFile = { kind: "file", reader: active.reader }; accessAttributes.set(file, 2); globalAttributes.set(file, globalAttributes.get(active.reader.file) ?? false); this.push(file); break;
      }
      case "read": { const byte = this.file(this.pop()).reader.file.readByte(); if (byte >= 0) this.push(byte); this.push(byte >= 0); break; }
      case "readstring": case "readhexstring": case "readline": {
        const target = this.pop(), file = this.file(this.pop());
        if (!(target instanceof Uint8Array)) throw unsupported(`PostScript ${name} requires a destination string.`);
        requireAccess(target, 3);
        if (name === "readstring" && target.length === 0) throw unsupported("PostScript readstring requires a nonempty string.", name, "rangecheck");
        const result = name === "readline" ? file.reader.file.readLineInto(target) : null;
        const length = result?.length ?? (name === "readhexstring" ? file.reader.file.readHexInto(target) : file.reader.file.readInto(target));
        this.push(byteView(target, 0, length)); this.push(result?.complete ?? length === target.length); break;
      }
      case "bytesavailable": this.push(this.file(this.pop()).reader.file.bytesAvailable()); break;
      case "fileposition": this.push(this.file(this.pop()).reader.file.tell()); break;
      case "setfileposition": { const position = this.count(), file = this.file(this.pop()); file.reader.file.seek(position); break; }
      case "resetfile": this.file(this.pop()).reader.file.seek(0); break;
      case "flushfile": this.file(this.pop()).reader.file.flush(); break;
      case "status": { const file = this.file(this.pop()); this.push(!file.reader.file.closed); break; }
      case "token": {
        const source = this.pop();
        if (source instanceof Uint8Array) {
          requireAccess(source, 2); const reader = this.lexer(source);
          const token = reader.next();
          if (token !== undefined) { const offset = reader.file.tell(); this.push(byteView(source, offset, source.length - offset)); this.push(token); this.push(true); } else this.push(false);
        } else { const token = this.file(source).reader.next(); if (token !== undefined) this.push(token); this.push(token !== undefined); } break;
      }
      case "filter": {
        const filter = this.name(); const parameters = this.stack.at(-1) instanceof Map ? this.dictionary() : null;
        const source = this.pop(); let input;
        if (source instanceof Uint8Array) { requireAccess(source, 2); input = createNativeFontPostScriptMemoryFile(source, { signal: this.options.signal }); }
        else if (isProcedure(source)) { requireAccess(source, 1); input = createNativeFontPostScriptProcedureFile(source, procedure => this.executeSource(procedure), { signal: this.options.signal }); }
        else input = this.file(source).reader.file;
        const decoded = createNativeFontPostScriptFilter(input, filter, postScriptFilterParameters(parameters), this.fileOptions());
        const eod = parameters?.get("EODString");
        globalAttributes.set(decoded, isGlobal(source) && (eod === undefined || isGlobal(eod)));
        const file: PsFile = { kind: "file", reader: this.lexer(decoded) }; globalAttributes.set(file, globalAttributes.get(decoded)!);
        accessAttributes.set(file, 2); this.push(file); break;
      }
      case "closefile": this.file(this.pop()).reader.close(); break;
      case "eexec": {
        const source = this.pop();
        if (this.splitEexec) { this.file(source).reader.close(); break; }
        const input = source instanceof Uint8Array ? (requireAccess(source, 2), createNativeFontPostScriptMemoryFile(source, { signal: this.options.signal })) : this.file(source).reader.file;
        const decoded = createNativeFontPostScriptEexecFile(input, this.fileOptions());
        globalAttributes.set(decoded, isGlobal(source));
        this.tasks.push({ kind: "eexec-end", dictionaryDepth: this.dictionaries.length }); this.dictionaries.push(this.system);
        this.tasks.push({ kind: "input", reader: this.lexer(decoded) }); break;
      }
      case "definefont": { const dict = this.dictionary(), fontName = this.name(); requireAccess(dict, 2); this.defineResource("Font", fontName, dict); reduceAccess(dict, 2); this.definedFont = dict; this.push(dict); break; }
      case "findfont": { const fontName = this.name(), dict = this.findResource("Font", fontName); if (!(dict instanceof Map)) throw unsupported(`PostScript font ${fontName} is unavailable.`); this.push(dict); break; }
      case "undefinefont": { const fontName = this.name(); this.resource("Font").delete(fontName); this.rebuildFontDirectory(); break; }
      case "defineresource": {
        const category = this.name(); let instance = this.pop(); const key = this.name();
        if (category === "Font") { if (!(instance instanceof Map)) throw unsupported("PostScript Font resources require a font dictionary."); requireAccess(instance, 2); this.definedFont = instance; }
        if (isComposite(instance)) instance = reduceAccess(instance, 2);
        this.defineResource(category, key, instance); this.push(instance); break;
      }
      case "findresource": { const category = this.name(), key = this.name(), instance = this.findResource(category, key); if (instance === undefined) throw unsupported(`PostScript ${category} resource ${key} is unavailable.`, "undefinedresource"); this.push(instance); break; }
      case "resourcestatus": { const category = this.name(), key = this.name(); if (this.findResource(category, key) !== undefined) { this.push(0); this.push(-1); this.push(true); } else this.push(false); break; }
      case "undefineresource": { const category = this.name(), key = this.name(); this.resource(category).delete(key); if (category === "Font") this.rebuildFontDirectory(); break; }
      case "resourceforall": {
        const category = this.name(), scratch = this.pop(), procedure = this.procedure(), pattern = this.pop();
        if (!(pattern instanceof Uint8Array) || !(scratch instanceof Uint8Array)) throw unsupported("PostScript resourceforall requires pattern and scratch strings.");
        requireAccess(pattern, 2); requireAccess(scratch, 3);
        const matcher = postScriptPattern(byteString(pattern), this.options.signal);
        const keys = this.resourceKeys(category).filter(key => matcher.test(key));
        this.tasks.push({ kind: "resourceforall", keys, scratch, index: 0, procedure }); break;
      }
      case "currentpacking": this.push(this.packing); break;
      case "setpacking": { const value = this.pop(); if (typeof value !== "boolean") throw unsupported("PostScript setpacking requires a boolean."); this.packing = value; break; }
      case "packedarray": { const count = this.count(); if (count > this.stack.length) throw unsupported("PostScript packedarray exceeds the operand stack."); this.push(reduceAccess(this.stack.splice(this.stack.length - count), 2)); break; }
      default: throw unsupported(`PostScript operator ${name} is unavailable in the font interpreter.`, name);
    }
  }
}

const OPERATOR_NAMES = (`[ ] << >> mark pop dup exch index roll clear count cleartomark counttomark
array string dict begin end currentdict countdictstack dictstack cleardictstack maxlength def store load where known undef get put length getinterval putinterval aload astore copy
add sub mul div idiv mod exp atan neg abs sqrt ln log sin cos floor ceiling round truncate cvi cvr cvs cvrs search anchorsearch eq ne lt le gt ge
and or xor not bitshift if ifelse repeat for forall loop exit stopped stop save restore rand srand rrand exec bind readonly executeonly noaccess cvlit cvx cvn type xcheck rcheck wcheck
setglobal currentglobal gcheck
matrix identmatrix currentmatrix defaultmatrix setmatrix initmatrix concat concatmatrix invertmatrix translate scale rotate transform dtransform itransform idtransform gsave grestore grestoreall
newpath moveto rmoveto lineto rlineto curveto rcurveto closepath currentpoint pathbbox arc arcn arcto flattenpath reversepath pathforall fill eofill stroke clip eoclip rectclip rectfill rectstroke
setlinewidth setlinecap setlinejoin setmiterlimit setdash currentlinewidth currentlinecap currentlinejoin currentmiterlimit currentdash setgray setrgbcolor setcmykcolor sethsbcolor currentrgbcolor currentgray currentcmykcolor currenthsbcolor setcharwidth setcachedevice
image imagemask colorimage setcolorspace currentcolorspace setcolor currentcolor
currentfile read readstring readhexstring readline bytesavailable fileposition setfileposition resetfile flushfile status token filter closefile eexec definefont findfont undefinefont defineresource findresource resourcestatus undefineresource resourceforall currentpacking setpacking packedarray`).split(/\s+/);

function postScriptFilterParameters(dictionary: Dictionary | null): NativeFontPostScriptFilterParameters {
  if (!dictionary) return {};
  requireAccess(dictionary, 2);
  const parameters: Record<string, unknown> = {};
  for (const [key, value] of dictionary) {
    if (key === "CloseSource") { if (typeof value !== "boolean") throw unsupported("PostScript CloseSource requires a boolean."); parameters[key] = value; }
    else if (key === "EODCount") { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw unsupported("PostScript EODCount requires a nonnegative integer."); parameters[key] = value; }
    else if (key === "EODString") { if (!(value instanceof Uint8Array)) throw unsupported("PostScript EODString requires a string."); requireAccess(value, 2); parameters[key] = value; }
    else if (["EarlyChange", "Predictor", "Colors", "BitsPerComponent", "Columns", "UnitLength"].includes(key)) { if (typeof value !== "number" || !Number.isSafeInteger(value)) throw unsupported(`PostScript ${key} requires an integer.`); parameters[key] = value; }
    else if (key === "LowBitFirst") { if (typeof value !== "boolean") throw unsupported("PostScript LowBitFirst requires a boolean."); parameters[key] = value; }
    else if (key === "Filter") { if (isName(value)) parameters[key] = value.value; else { requireAccess(value, 2); if (!Array.isArray(value)) throw unsupported("PostScript Filter requires a name or name array."); parameters[key] = value.map(item => { if (!isName(item)) throw unsupported("PostScript Filter array requires names."); return item.value; }); } }
    else if (key === "DecodeParms") { if (value instanceof Map) parameters[key] = postScriptFilterParameters(value); else { requireAccess(value, 2); if (!Array.isArray(value)) throw unsupported("PostScript DecodeParms requires a dictionary or array."); parameters[key] = value.map(item => item === null ? null : item instanceof Map ? postScriptFilterParameters(item) : (() => { throw unsupported("PostScript DecodeParms array requires dictionaries."); })()); } }
  }
  return parameters as NativeFontPostScriptFilterParameters;
}

function vmForGlyph(vm: FontPostScriptVm, dictionary: Dictionary, signal: AbortSignal | undefined, options: NativeFontPostScriptOptions): { dictionary: Dictionary; vm: FontPostScriptVm } {
  let local: FontPostScriptVm;
  const environment = cloneValue(vm.glyphEnvironment(dictionary), signal, options.maxStringBytes,
    procedure => local.executeSource(procedure), file => local.lexer(file)) as Dictionary;
  const owned = environment.get("font") as Dictionary;
  local = new FontPostScriptVm({ ...options, signal, initialDictionary: owned });
  local.seedGlyphEnvironment(environment);
  return { dictionary: owned, vm: local };
}
function postScriptString(value: Value): string {
  if (value instanceof Uint8Array) { requireAccess(value, 2); return byteString(value); }
  if (isName(value)) return value.value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value === null) return "--nostringval--";
  return "--nostringval--";
}
function postScriptPattern(pattern: string, signal?: AbortSignal): { test(value: string): boolean } {
  const star = Symbol("star"), any = Symbol("any");
  const tokens: (string | typeof star | typeof any)[] = [];
  for (let i = 0; i < pattern.length; i++) {
    throwIfAborted(signal);
    const char = pattern[i];
    if (char === "*") { if (tokens.at(-1) !== star) tokens.push(star); }
    else if (char === "?") tokens.push(any);
    else tokens.push(char === "\\" && i + 1 < pattern.length ? pattern[++i] : char);
  }
  return { test(value) {
    let input = 0, token = 0, lastStar = -1, restart = 0;
    while (input < value.length) {
      throwIfAborted(signal);
      if (tokens[token] === any || tokens[token] === value[input]) { token++; input++; }
      else if (tokens[token] === star) { lastStar = token++; restart = input; }
      else if (lastStar >= 0) { token = lastStar + 1; input = ++restart; }
      else return false;
    }
    while (tokens[token] === star) token++;
    return token === tokens.length;
  } };
}
const POST_SCRIPT_ERROR_NAMES = new Set(["invalidaccess", "invalidrestore", "invalidexit", "undefinedresource",
  "nocurrentpoint", "rangecheck", "undefinedresult", "typecheck", "ioerror", "limitcheck", "stackunderflow", "undefined"]);
function postScriptErrorName(error: PdfError): string {
  if (typeof error.details?.postScriptError === "string") return error.details.postScriptError;
  const operator = error.details?.operator;
  if (typeof operator === "string" && POST_SCRIPT_ERROR_NAMES.has(operator)) return operator;
  if (/underflow/.test(error.message)) return "stackunderflow";
  if (/nonfinite|zero|arithmetic/.test(error.message)) return "undefinedresult";
  if (/unavailable|undefined/.test(error.message)) return "undefined";
  if (/outside|invalid|too small|between/.test(error.message)) return "rangecheck";
  return "typecheck";
}

class FontPostScriptLexer {
  readonly file: NativeFontPostScriptFile;
  private readonly signal?: AbortSignal;
  private readonly maxStringBytes?: number;
  private readonly resolveImmediate?: (name: string) => Value | undefined;
  private readonly allocated?: (value: Value) => void;
  private readonly procedureDelimiters = new WeakSet<object>();

  constructor(bytes: Uint8Array | NativeFontPostScriptFile, signal?: AbortSignal, maxStringBytes?: number,
    resolveImmediate?: (name: string) => Value | undefined, allocated?: (value: Value) => void) {
    this.file = bytes instanceof Uint8Array ? createNativeFontPostScriptMemoryFile(bytes, { signal }) : bytes;
    this.signal = signal;
    this.maxStringBytes = maxStringBytes;
    this.resolveImmediate = resolveImmediate;
    this.allocated = allocated;
  }
  close(): void { this.file.close(); }
  raw(length: number): Uint8Array {
    const target = allocatedBytes(length, this.maxStringBytes);
    return target.subarray(0, this.file.readInto(target));
  }
  next(): Value | undefined {
    const first = this.token();
    if (this.isProcedureDelimiter(first, "{")) {
      const frames: Value[][] = [[]];
      while (frames.length) {
        const value = this.token(); if (value === undefined) throw unsupported("An unterminated PostScript procedure was encountered.");
        if (this.isProcedureDelimiter(value, "{")) frames.push([]);
        else if (this.isProcedureDelimiter(value, "}")) {
          const procedure: Procedure = { kind: "procedure", tokens: frames.pop()! }; this.allocated?.(procedure);
          if (!frames.length) return procedure;
          frames.at(-1)!.push(procedure);
        } else frames.at(-1)!.push(value);
      }
    }
    if (this.isProcedureDelimiter(first, "}")) throw unsupported("An unmatched PostScript procedure delimiter was encountered.");
    return first;
  }
  private isProcedureDelimiter(value: Value | undefined, token: string): boolean {
    return isName(value) && value.value === token && this.procedureDelimiters.has(value);
  }
  private token(): Value | undefined {
    const value = this.readToken(); if (value !== undefined) this.allocated?.(value); return value;
  }
  private readToken(): Value | undefined {
    const file = this.file;
    while (true) {
      throwIfAborted(this.signal);
      const value = file.peekByte();
      if (value < 0) return undefined;
      if (white(value)) { file.readByte(); continue; }
      if (value === 37) { while (file.peekByte() >= 0 && file.peekByte() !== 10 && file.peekByte() !== 13) file.readByte(); continue; }
      break;
    }
    const byte = file.readByte();
    if (byte === 40) {
      const output: number[] = []; let depth = 1;
      while (true) {
        throwIfAborted(this.signal);
        let value = file.readByte();
        if (value < 0) break;
        if (value === 92) {
          value = file.readByte();
          if (value < 0) break;
          if (value === 10 || value === 13) { if (value === 13 && file.peekByte() === 10) file.readByte(); continue; }
          if (value >= 48 && value <= 55) {
            let octal = value - 48;
            for (let i = 0; i < 2 && file.peekByte() >= 48 && file.peekByte() <= 55; i++) octal = octal * 8 + file.readByte() - 48;
            checkStringLength(output.length + 1, this.maxStringBytes); output.push(octal & 255); continue;
          }
          value = ({ 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 } as Record<number, number>)[value] ?? value;
        } else if (value === 40) depth++;
        else if (value === 41 && --depth === 0) return Uint8Array.from(output);
        else if (value === 13) { if (file.peekByte() === 10) file.readByte(); value = 10; }
        checkStringLength(output.length + 1, this.maxStringBytes); output.push(value);
      }
      throw unsupported("A PostScript literal string is truncated.");
    }
    if (byte === 60 && file.peekByte() === 126) { file.readByte(); return this.ascii85String(); }
    if (byte === 60 && file.peekByte() !== 60) {
      const output: number[] = []; let high = -1;
      while (true) {
        throwIfAborted(this.signal);
        const value = file.readByte(); if (value < 0) break;
        if (value === 62) { if (high >= 0) { checkStringLength(output.length + 1, this.maxStringBytes); output.push(high * 16); } return Uint8Array.from(output); }
        if (white(value)) continue;
        const digit = hex(value); if (digit < 0) throw unsupported("A PostScript hexadecimal string has an invalid digit.");
        if (high < 0) high = digit;
        else { checkStringLength(output.length + 1, this.maxStringBytes); output.push(high * 16 + digit); high = -1; }
      }
      throw unsupported("A PostScript hexadecimal string is truncated.");
    }
    if ((byte === 60 || byte === 62) && file.peekByte() === byte) { file.readByte(); return executableName(byte === 60 ? "<<" : ">>"); }
    if ([91, 93, 123, 125].includes(byte)) {
      const name = executableName(String.fromCharCode(byte));
      if (byte === 123 || byte === 125) this.procedureDelimiters.add(name);
      return name;
    }
    const literal = byte === 47, immediate = literal && file.peekByte() === 47;
    if (immediate) file.readByte();
    const characters: number[] = literal ? [] : [byte];
    while (file.peekByte() >= 0 && !delimiter(file.peekByte())) { throwIfAborted(this.signal); characters.push(file.readByte()); }
    if (!literal && (characters.length === 0 || delimiter(byte))) throw unsupported("An invalid PostScript token was encountered.");
    const text = byteString(Uint8Array.from(characters));
    // RD/readstring sees the first binary byte immediately after one separator.
    if (white(file.peekByte())) { if (file.readByte() === 13 && file.peekByte() === 10) file.readByte(); }
    if (immediate) {
      const value = this.resolveImmediate?.(text);
      if (value === undefined) throw unsupported(`Immediately evaluated PostScript name ${text} is undefined.`, text);
      return value;
    }
    if (literal) return literalName(text);
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return finite(Number(text));
    const radix = /^(\d+)#([0-9a-z]+)$/i.exec(text);
    if (radix) { const base = Number(radix[1]); if (base < 2 || base > 36 || [...radix[2]].some(c => parseInt(c, 36) >= base)) throw unsupported("Invalid PostScript radix number."); return finite(parseInt(radix[2], base)); }
    return executableName(text);
  }
  private ascii85String(): Uint8Array {
    const output: number[] = [], group: number[] = [];
    const append = (length: number): void => {
      while (group.length < 5) group.push(84);
      let packed = 0; for (const digit of group) packed = packed * 85 + digit;
      if (packed > 0xffff_ffff) throw unsupported("A PostScript ASCII85 string group overflows 32 bits.");
      const decoded = [packed >>> 24, (packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255];
      checkStringLength(output.length + length, this.maxStringBytes); output.push(...decoded.slice(0, length)); group.length = 0;
    };
    while (true) {
      throwIfAborted(this.signal);
      const byte = this.file.readByte();
      if (byte < 0) throw unsupported("A PostScript ASCII85 string is truncated.");
      if (white(byte)) continue;
      if (byte === 126) {
        if (this.file.readByte() !== 62 || group.length === 1) throw unsupported("A PostScript ASCII85 string has an invalid terminator or final group.");
        if (group.length) append(group.length - 1);
        return Uint8Array.from(output);
      }
      if (byte === 122) {
        if (group.length) throw unsupported("A PostScript ASCII85 z occurs inside a group.");
        checkStringLength(output.length + 4, this.maxStringBytes); output.push(0, 0, 0, 0); continue;
      }
      if (byte < 33 || byte > 117) throw unsupported("A PostScript ASCII85 string contains an invalid character.");
      group.push(byte - 33); if (group.length === 5) append(4);
    }
  }
}

// PLRM 3.3.2: access belongs to an array/string/file reference, while a
// dictionary's access belongs to its shared value. Views retain storage aliases
// without changing another reference's access attribute.
type Access = 0 | 1 | 2 | 3;
const accessAttributes = new WeakMap<object, Access>();
const executableReferences = new WeakMap<object, boolean>();
const dictionaryCapacities = new WeakMap<Dictionary, number>();
const globalAttributes = new WeakMap<object, boolean>();
function isGlobal(value: Value): boolean { return !isComposite(value) || globalAttributes.get(storageOf(value)) === true; }
function requireGlobalReference(target: Value, value: Value): void {
  if (isGlobal(target) && !isGlobal(value)) throw unsupported("A local composite cannot be stored in global PostScript VM.", "invalidaccess");
}
function isComposite(value: Value): value is Value & object {
  return value instanceof Map || Array.isArray(value) || value instanceof Uint8Array || isProcedure(value) || tagged(value, "file");
}
function accessOf(value: Value & object): Access { return accessAttributes.get(value) ?? 3; }
function requireAccess(value: Value, minimum: Access): void {
  if (!isComposite(value)) throw unsupported("A composite PostScript operand is required.");
  if (accessOf(value) < minimum) throw unsupported("PostScript composite access is not permitted.", "invalidaccess");
}
function copyAttributes(source: Value & object, target: Value & object): void {
  accessAttributes.set(target, accessOf(source));
  if (globalAttributes.has(storageOf(source))) globalAttributes.set(storageOf(target), globalAttributes.get(storageOf(source))!);
  if (source instanceof Map && target instanceof Map && dictionaryCapacities.has(source)) dictionaryCapacities.set(target, dictionaryCapacities.get(source)!);
  if (executableReferences.has(source)) executableReferences.set(target, executableReferences.get(source)!);
}
function arraySequence(value: Value): Value[] | null { return isProcedure(value) ? value.tokens as Value[] : Array.isArray(value) ? value : null; }
function sequence(value: Value): Value[] | Uint8Array | null { return value instanceof Uint8Array ? value : arraySequence(value); }
function sequenceView(source: Value, start: number, length: number): Value {
  let view: Value;
  if (source instanceof Uint8Array) view = byteView(source, start, length);
  else if (isProcedure(source)) view = { kind: "procedure", tokens: arrayView(source.tokens as Value[], start, length) };
  else if (Array.isArray(source)) view = arrayView(source, start, length);
  else throw unsupported("A PostScript interval requires an array or string.");
  copyAttributes(source as Value & object, view as Value & object);
  return view;
}
function reduceAccess(value: Value, access: Access): Value {
  if (!isComposite(value) || (access === 1 && value instanceof Map)) throw unsupported("PostScript access reduction has an invalid operand.");
  if (access > accessOf(value)) throw unsupported("PostScript access cannot be increased.", "invalidaccess");
  let result: Value & object = value;
  if (sequence(value)) result = sequenceView(value, 0, sequence(value)!.length) as Value & object;
  else if (tagged(value, "file")) result = { ...(value as PsFile) };
  copyAttributes(value, result);
  accessAttributes.set(result, access);
  return result;
}
function changeExecution(value: Value, executable: boolean): Value {
  if (isName(value)) return { ...value, literal: !executable };
  if (executable && Array.isArray(value)) {
    const procedure: Procedure = { kind: "procedure", tokens: value };
    copyAttributes(value, procedure); return procedure;
  }
  if (!executable && isProcedure(value)) {
    const array = arrayView(value.tokens as Value[], 0, value.tokens.length);
    copyAttributes(value, array); return array;
  }
  if (value instanceof Uint8Array || tagged(value, "file")) {
    const result = value instanceof Uint8Array ? byteView(value, 0, value.length) : { ...(value as PsFile) };
    copyAttributes(value as Value & object, result);
    executableReferences.set(result, executable); return result;
  }
  return value;
}
function isExecutable(value: Value): boolean {
  return isProcedure(value) || isOperator(value) || (isName(value) && !value.literal) ||
    (isComposite(value) && executableReferences.get(value) === true);
}

function get(source: Value, index: Value): Value {
  requireAccess(source, 2);
  if (source instanceof Map) { const value = source.get(key(index)); if (value === undefined) throw unsupported("A PostScript dictionary key is undefined."); return value; }
  const items = isProcedure(source) ? source.tokens : source;
  if ((!Array.isArray(items) && !(items instanceof Uint8Array)) || typeof index !== "number" || !Number.isSafeInteger(index)) throw unsupported("A PostScript get index requires an integer.", undefined, "typecheck");
  if (index < 0 || index >= items.length) throw unsupported("A PostScript get index is invalid.", undefined, "rangecheck");
  return items[index];
}
function put(target: Value, index: Value, value: Value): void {
  requireAccess(target, 3);
  requireGlobalReference(target, value);
  if (target instanceof Map) { target.set(key(index), value); return; }
  const items = sequence(target);
  if (!items || typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= items.length) throw unsupported("A PostScript put index is invalid.");
  if (target instanceof Uint8Array) { if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) throw unsupported("A PostScript string byte is invalid."); target[index] = value; } else (items as Value[])[index] = value;
}
function encoding(names?: readonly (string | null)[]): Value[] { return Array.from({ length: 256 }, (_, code) => literalName(names?.[code] ?? ".notdef")); }
function key(value: Value): string { if (isName(value)) return value.value; if (value instanceof Uint8Array) { requireAccess(value, 2); return byteString(value); } throw unsupported("A PostScript name or string key is required."); }
function literalName(value: string): NativeFontPostScriptName { return { kind: "name", value, literal: true }; }
function executableName(value: string): NativeFontPostScriptName { return { kind: "name", value, literal: false }; }
function tagged(value: unknown, kind: string): boolean { return typeof value === "object" && value !== null && "kind" in value && value.kind === kind; }
function isName(value: unknown): value is NativeFontPostScriptName { return tagged(value, "name"); }
function isProcedure(value: unknown): value is Procedure { return tagged(value, "procedure"); }
function isOperator(value: unknown): value is PsOperator { return tagged(value, "operator"); }
function requireNumber(value: Value): number { if (typeof value !== "number") throw unsupported("A numeric PostScript operand is required."); return finite(value); }
function finite(value: number): number { if (!Number.isFinite(value)) throw unsupported("PostScript arithmetic produced a nonfinite value."); return value; }
function equalValue(a: Value, b: Value): boolean {
  if (tagged(a, "file") && tagged(b, "file")) return (a as PsFile).reader.file === (b as PsFile).reader.file;
  if (isName(a) && isName(b)) return a.value === b.value;
  if (isName(a) && b instanceof Uint8Array) { requireAccess(b, 2); return a.value === byteString(b); }
  if (a instanceof Uint8Array && isName(b)) { requireAccess(a, 2); return byteString(a) === b.value; }
  if (a instanceof Uint8Array && b instanceof Uint8Array) { requireAccess(a, 2); requireAccess(b, 2); return a.length === b.length && a.every((value, i) => value === b[i]); }
  const first = arraySequence(a), second = arraySequence(b);
  if (first && second) {
    const parentA = arrayViews.get(first), parentB = arrayViews.get(second);
    return (parentA?.source ?? first) === (parentB?.source ?? second) &&
      (parentA?.start ?? 0) === (parentB?.start ?? 0) && first.length === second.length;
  }
  return a === b;
}
function white(value: number | undefined): boolean { return value !== undefined && [0, 9, 10, 12, 13, 32].includes(value); }
function delimiter(value: number): boolean { return white(value) || [37, 40, 41, 60, 62, 91, 93, 123, 125, 47].includes(value); }
function hex(value: number): number { return value >= 48 && value <= 57 ? value - 48 : value >= 65 && value <= 70 ? value - 55 : value >= 97 && value <= 102 ? value - 87 : -1; }
function byteString(bytes: Uint8Array): string { let output = ""; for (const byte of bytes) output += String.fromCharCode(byte); return output; }
function allocatedArray(length: number): Value[] { try { return Array<Value>(length).fill(null); } catch (cause) { throw new PdfError("resource-limit", "PostScript array allocation failed.", { cause }); } }
function checkStringLength(length: number, maximum: number | undefined): void { if (length > (maximum ?? Number.MAX_SAFE_INTEGER)) throw limited("string-byte"); }
function allocatedBytes(length: number, maximum?: number): Uint8Array { checkStringLength(length, maximum); try { return new Uint8Array(length); } catch (cause) { throw new PdfError("resource-limit", "PostScript string allocation failed.", { cause }); } }
function lastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number { for (let i = values.length - 1; i >= 0; i--) if (predicate(values[i])) return i; return -1; }
const arrayViews = new WeakMap<Value[], { source: Value[]; start: number }>();
const byteViews = new WeakMap<Uint8Array, { source: Uint8Array; start: number }>();
function storageOf(value: Value & object): object {
  if (isProcedure(value)) return storageOf(value.tokens as Value[]);
  if (Array.isArray(value)) return arrayViews.get(value)?.source ?? value;
  if (value instanceof Uint8Array) return byteViews.get(value)?.source ?? value;
  return value;
}
function byteView(source: Uint8Array, start: number, length: number): Uint8Array {
  const attributes = source;
  const parent = byteViews.get(source);
  if (parent) { start += parent.start; source = parent.source; }
  const view = source.subarray(start, start + length);
  byteViews.set(view, { source, start }); copyAttributes(attributes, view); return view;
}
function arrayView(source: Value[], start: number, length: number): Value[] {
  const attributes = source;
  const parent = arrayViews.get(source);
  if (parent) { start += parent.start; source = parent.source; }
  const view = new Proxy(source.slice(start, start + length), {
    get(target, property, receiver) {
      if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property) && Number(property) < length) return source[start + Number(property)];
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property) && Number(property) < length) source[start + Number(property)] = value;
      return Reflect.set(target, property, value, receiver);
    }
  });
  arrayViews.set(view, { source, start }); copyAttributes(attributes, view); return view;
}
function unsupported(message: string, operator?: string, postScriptError?: string): PdfError { return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-unsupported", ...(operator ? { operator } : {}), ...(postScriptError ? { postScriptError } : {}) } }); }
function limited(kind: string): PdfError { return new PdfError("resource-limit", `Font PostScript exceeds the configured ${kind} limit.`, { details: { reason: `font-postscript-${kind}-limit` } }); }
function bindProcedure(procedure: Procedure, lookup: (name: string) => Value | undefined, signal?: AbortSignal): Procedure {
  const seen = new Set<Procedure>();
  const pending = [procedure];
  while (pending.length) {
    throwIfAborted(signal);
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (accessOf(current) < 3) continue;
    const tokens = current.tokens as Value[];
    for (let i = 0; i < tokens.length; i++) {
      throwIfAborted(signal);
      const value = tokens[i];
      if (isProcedure(value)) {
        pending.push(value);
        if (accessOf(value) >= 2) tokens[i] = reduceAccess(value, 2);
      }
      else if (isName(value) && !value.literal && isOperator(lookup(value.value))) tokens[i] = lookup(value.value)!;
    }
  }
  return procedure;
}
function cloneValue(root: Value, signal: AbortSignal | undefined, maxStringBytes: number | undefined,
  executeSource: (procedure: Procedure) => Uint8Array,
  lexer: (file: NativeFontPostScriptFile) => FontPostScriptLexer): Value {
  const seen = new Map<object, Value>(), pending: { source: Value; target: Value }[] = [];
  const files = new Map<NativeFontPostScriptFile, NativeFontPostScriptFile>();
  const cloneFile = (source: NativeFontPostScriptFile): NativeFontPostScriptFile => {
    const cached = files.get(source); if (cached) return cached;
    let target = cloneNativeFontPostScriptFile(source, cloneFile, bytes => create(bytes) as Uint8Array,
      { signal, maxDecodedBytes: maxStringBytes });
    if (!target) {
      const snapshot = snapshotNativeFontPostScriptProcedureFile(source);
      if (!snapshot) throw unsupported("An unknown PostScript file cannot be isolated for glyph execution.", "currentfile");
      target = restoreNativeFontPostScriptProcedureFile({ ...snapshot,
        procedure: create(snapshot.procedure) as Procedure, chunk: create(snapshot.chunk) as Uint8Array },
        executeSource, { signal, maxDecodedBytes: maxStringBytes });
    }
    files.set(source, target);
    globalAttributes.set(target, globalAttributes.get(source) ?? false);
    return target;
  };
  const create = (source: Value): Value => {
    throwIfAborted(signal);
    if (source === null || typeof source !== "object") return source;
    const cached = seen.get(source); if (cached) return cached;
    let target: Value;
    if (source instanceof Uint8Array) {
      checkStringLength(source.length, maxStringBytes);
      const parent = byteViews.get(source);
      target = parent ? byteView(create(parent.source) as Uint8Array, parent.start, source.length) : source.slice();
    }
    else if (source instanceof Map) target = new Map();
    else if (Array.isArray(source)) {
      const parent = arrayViews.get(source);
      target = parent ? arrayView(create(parent.source) as Value[], parent.start, source.length) : allocatedArray(source.length);
    }
    else if (isProcedure(source)) target = { kind: "procedure", tokens: create(source.tokens as Value[]) as Value[] };
    else if (tagged(source, "file")) {
      // Bind cloned readers lazily: the complete environment must exist before
      // a procedure source can execute against its new glyph VM.
      let file: NativeFontPostScriptFile;
      let reader: FontPostScriptLexer | undefined;
      target = { kind: "file", get reader() { return reader ??= lexer(file); } };
      seen.set(source, target);
      file = cloneFile((source as PsFile).reader.file);
    }
    else target = source;
    seen.set(source, target);
    if (isComposite(source) && isComposite(target)) copyAttributes(source, target);
    if (target !== source && !isProcedure(source) && !(Array.isArray(source) && arrayViews.has(source))) pending.push({ source, target });
    return target;
  };
  const result = create(root);
  while (pending.length) {
    throwIfAborted(signal);
    const { source, target } = pending.pop()!;
    if (source instanceof Map) for (const [k, value] of source) (target as Dictionary).set(k, create(value));
    else if (Array.isArray(source)) for (let i = 0; i < source.length; i++) (target as Value[])[i] = create(source[i]);
    else if (isProcedure(source)) for (const value of source.tokens) ((target as Procedure).tokens as Value[]).push(create(value));
  }
  return result;
}
