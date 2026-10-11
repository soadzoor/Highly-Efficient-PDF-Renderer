import { PdfError, throwIfAborted } from "./nativeTypes";

export interface NativeFontPostScriptName { readonly kind: "name"; readonly value: string; readonly literal: boolean; }
export interface NativeFontPostScriptProcedure { readonly kind: "procedure"; readonly tokens: readonly NativeFontPostScriptValue[]; }
interface PsOperator { readonly kind: "operator"; readonly name: string; }
interface PsFile { readonly kind: "file"; readonly reader: FontPostScriptLexer; }
interface PsMark { readonly kind: "mark"; }
export type NativeFontPostScriptValue = number | boolean | null | Uint8Array |
  NativeFontPostScriptName | NativeFontPostScriptProcedure | PsOperator | PsFile | PsMark |
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
}

export interface NativeFontPostScriptResult {
  readonly dictionary: Dictionary;
  /** Create independent glyph state, shared by that glyph's OtherSubr calls. */
  createOtherSubrExecutor(signal?: AbortSignal): (index: number, args: readonly number[]) => readonly number[] | null;
  /** Arguments enter the PS stack in reverse order (Type1 specification 6.4). */
  executeOtherSubr(index: number, args: readonly number[], signal?: AbortSignal): readonly number[] | null;
}

/**
 * Font-local PostScript data interpreter (PLRM, chapters 3 and 8). It has no
 * host files, processes, networking or device operators. Unknown operators
 * fail explicitly so the caller can retain its diagnosed font fallback.
 * https://www.adobe.com/jp/print/postscript/pdfs/PLRM.pdf
 */
export function executeNativeFontPostScript(cleartext: Uint8Array, privatePlaintext?: Uint8Array,
  options: NativeFontPostScriptOptions = {}): NativeFontPostScriptResult {
  const vm = new FontPostScriptVm(options);
  vm.runBytes(cleartext);
  if (privatePlaintext) vm.runBytes(privatePlaintext);
  const dictionary = vm.fontDictionary();
  const createOtherSubrExecutor = (signal: AbortSignal | undefined = options.signal) => {
    // Glyphs own their mutable state, while successive calls within one glyph
    // share Private variables and arrays as required by custom OtherSubrs.
    const owned = cloneValue(dictionary, signal, options.maxStringBytes) as Dictionary;
    const local = new FontPostScriptVm({ ...options, signal, initialDictionary: owned });
    const copiedPrivate = owned.get("Private");
    const copiedSubrs = copiedPrivate instanceof Map ? copiedPrivate.get("OtherSubrs") : owned.get("OtherSubrs");
    if (copiedPrivate instanceof Map) local.enterDictionary(copiedPrivate);
    return (index: number, args: readonly number[]): readonly number[] | null => {
      const procedure = Array.isArray(copiedSubrs) ? copiedSubrs[index] : undefined;
      if (!isProcedure(procedure)) return null;
      local.runProcedure(procedure, [...args].reverse());
      const results = Object.freeze([...local.stack].reverse().map(value => requireNumber(value)));
      local.stack.length = 0;
      return results;
    };
  };
  return Object.freeze({ dictionary, createOtherSubrExecutor,
    executeOtherSubr(index: number, args: readonly number[], signal?: AbortSignal): readonly number[] | null {
      return createOtherSubrExecutor(signal)(index, args);
    } });
}

type Task = { kind: "input"; reader: FontPostScriptLexer } |
  { kind: "tokens"; tokens: readonly Value[]; index: number } |
  { kind: "repeat"; remaining: number; procedure: Procedure } |
  { kind: "for"; current: number; increment: number; limit: number; procedure: Procedure } |
  { kind: "forall"; values: readonly (readonly Value[])[]; index: number; procedure: Procedure } |
  { kind: "loop"; procedure: Procedure };

class FontPostScriptVm {
  readonly stack: Value[] = [];
  private readonly options: NativeFontPostScriptOptions;
  private readonly dictionaries: Dictionary[];
  private readonly privilegedDictionaries = new Set<Dictionary>();
  private readonly created: Dictionary[] = [];
  private readonly tasks: Task[] = [];
  private readonly system: Dictionary = new Map();
  private readonly user: Dictionary = new Map();
  private readonly directory: Dictionary = new Map();
  private operations = 0;
  private definedFont: Dictionary | null = null;
  private reader: FontPostScriptLexer | null = null;

  constructor(options: NativeFontPostScriptOptions) {
    this.options = options;
    for (const key of ["maxOperations", "maxStack", "maxStringBytes"] as const) {
      const value = options[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`Invalid PostScript ${key}.`);
    }
    for (const name of OPERATOR_NAMES) this.system.set(name, { kind: "operator", name });
    this.system.set("true", true); this.system.set("false", false); this.system.set("null", null);
    this.system.set("systemdict", this.system); this.system.set("userdict", this.user);
    this.system.set("FontDirectory", this.directory); this.system.set("globaldict", this.user);
    this.system.set("StandardEncoding", reduceAccess(encoding(options.standardEncoding), 2));
    this.system.set("ExpertEncoding", reduceAccess(encoding(options.expertEncoding), 2));
    this.system.set("version", new TextEncoder().encode("3010"));
    this.system.set("languagelevel", 3);
    accessAttributes.set(this.system, 2);
    this.dictionaries = [this.system, this.user];
    if (options.initialDictionary) this.dictionaries.push(options.initialDictionary);
  }

  runBytes(bytes: Uint8Array): void {
    this.reader = new FontPostScriptLexer(bytes, this.options.signal, this.options.maxStringBytes);
    this.tasks.push({ kind: "input", reader: this.reader });
    this.run();
  }

  runProcedure(procedure: Procedure, args: readonly Value[] = []): void { for (const value of args) this.push(value); this.schedule(procedure); this.run(); }
  // Font engines can inspect an opaque Private dictionary while executing its
  // OtherSubrs. This does not grant explicit PS get/put/begin extra access.
  enterDictionary(dictionary: Dictionary): void { this.dictionaries.push(dictionary); this.privilegedDictionaries.add(dictionary); }

  fontDictionary(): Dictionary {
    if (this.definedFont) return this.definedFont;
    if (this.options.initialDictionary) return this.options.initialDictionary;
    const candidates = [...this.created, ...this.dictionaries, ...this.stack.filter(value => value instanceof Map)] as Dictionary[];
    const font = [...candidates].reverse().find(value => value.has("CharStrings")) ?? [...candidates].reverse().find(value => value.has("FontType"));
    if (!font) throw unsupported("The PostScript program did not construct a font dictionary.");
    return font;
  }

  private run(): void {
    while (this.tasks.length) {
      throwIfAborted(this.options.signal);
      if (++this.operations > (this.options.maxOperations ?? Number.MAX_SAFE_INTEGER)) throw limited("operation");
      const task = this.tasks.at(-1)!;
      let value: Value | undefined;
      if (task.kind === "input") {
        this.reader = task.reader;
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
        for (const item of task.values[task.index++]) this.push(item);
        this.schedule(task.procedure); continue;
      } else { this.schedule(task.procedure); continue; }
      if (isName(value) && !value.literal) this.execute(this.lookup(value.value), value.value);
      else if (isOperator(value)) this.operator(value.name);
      else this.push(value);
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
    else if (isOperator(value)) this.operator(value.name);
    else if ((value instanceof Uint8Array || tagged(value, "file")) && isExecutable(value)) {
      requireAccess(value, 1);
      this.tasks.push({ kind: "input", reader: value instanceof Uint8Array
        ? new FontPostScriptLexer(value, this.options.signal, this.options.maxStringBytes) : (value as PsFile).reader });
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
    this.stack.push(value);
  }
  private pop(): Value { if (!this.stack.length) throw unsupported("PostScript operand stack underflow."); return this.stack.pop()!; }
  private number(): number { return requireNumber(this.pop()); }
  private integer(): number { const n = this.number(); if (!Number.isSafeInteger(n)) throw unsupported("An integer PostScript operand is required."); return n; }
  private count(): number { const n = this.integer(); if (n < 0) throw unsupported("A nonnegative PostScript count is required."); return n; }
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
      case "dict": { this.count(); const dict = new Map<string, Value>(); this.created.push(dict); this.push(dict); break; }
      case "begin": { const dict = this.dictionary(); requireAccess(dict, 2); this.dictionaries.push(dict); break; }
      case "end": if (this.dictionaries.length <= 2) throw unsupported("PostScript dictionary stack underflow."); else this.dictionaries.pop(); break;
      case "currentdict": this.push(this.dictionaries.at(-1)!); break;
      case "def": { const value = this.pop(), k = this.name(), dict = this.dictionaries.at(-1)!; requireAccess(dict, 3); dict.set(k, value); break; }
      case "store": { const value = this.pop(), k = this.name(); const dict = [...this.dictionaries].reverse().find(d => { this.requireDictionaryLookup(d); return d.has(k); }) ?? this.dictionaries.at(-1)!; requireAccess(dict, 3); dict.set(k, value); break; }
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
        const values = Array.from(sourceItems); for (let i = 0; i < values.length; i++) put(target, start + i, values[i]); break;
      }
      case "aload": { const value = this.pop(); requireAccess(value, 2); const items = arraySequence(value); if (!items) throw unsupported("PostScript aload requires an array."); for (const item of items) this.push(item); this.push(value); break; }
      case "astore": { const value = this.pop(); requireAccess(value, 3); const array = arraySequence(value); if (!array || array.length > this.stack.length) throw unsupported("PostScript astore has invalid operands."); const items = this.stack.splice(this.stack.length - array.length); for (let i = 0; i < items.length; i++) array[i] = items[i]; this.push(value); break; }
      case "copy": {
        const target = this.pop();
        if (typeof target === "number") { if (!Number.isSafeInteger(target) || target < 0 || target > this.stack.length) throw unsupported("PostScript copy count is invalid."); for (const item of this.stack.slice(this.stack.length - target)) this.push(item); }
        else { const source = this.pop(); requireAccess(source, 2); requireAccess(target, 3); if (target instanceof Map && source instanceof Map) { for (const [k, value] of source) target.set(k, value); this.push(target); }
          else if (sequence(target) && sequence(source) && (target instanceof Uint8Array) === (source instanceof Uint8Array) && sequence(source)!.length <= sequence(target)!.length) { const items = Array.from(sequence(source)!); for (let i = 0; i < items.length; i++) put(target, i, items[i]); this.push(sequenceView(target, 0, items.length)); }
          else throw unsupported("PostScript copy operands are incompatible."); } break;
      }
      case "add": case "sub": case "mul": case "div": case "idiv": case "mod": case "exp": case "atan": {
        const b = this.number(), a = this.number();
        if ((name === "idiv" || name === "mod") && (!Number.isInteger(a) || !Number.isInteger(b))) throw unsupported(`PostScript ${name} requires integer operands.`);
        this.push(name === "add" ? a + b : name === "sub" ? a - b : name === "mul" ? a * b : name === "div" ? a / b : name === "idiv" ? Math.trunc(a / b) : name === "mod" ? a % b : name === "exp" ? a ** b : ((Math.atan2(a, b) * 180 / Math.PI) + 360) % 360); break;
      }
      case "neg": case "abs": case "sqrt": case "ln": case "log": case "sin": case "cos": case "floor": case "ceiling": case "round": case "truncate": case "cvi": case "cvr": {
        const a = this.number(); this.push(name === "neg" ? -a : name === "abs" ? Math.abs(a) : name === "sqrt" ? Math.sqrt(a) : name === "ln" ? Math.log(a) : name === "log" ? Math.log10(a) : name === "sin" ? Math.sin(a * Math.PI / 180) : name === "cos" ? Math.cos(a * Math.PI / 180) : name === "floor" ? Math.floor(a) : name === "ceiling" ? Math.ceil(a) : name === "round" ? Math.floor(a + 0.5) : name === "cvr" ? a : Math.trunc(a)); break;
      }
      case "eq": case "ne": case "lt": case "le": case "gt": case "ge": {
        const b = this.pop(), a = this.pop(); const equal = equalValue(a, b);
        if (name === "eq" || name === "ne") this.push(name === "eq" ? equal : !equal);
        else { if (typeof a !== "number" || typeof b !== "number") throw unsupported("Ordered PostScript comparison requires numbers."); this.push(name === "lt" ? a < b : name === "le" ? a <= b : name === "gt" ? a > b : a >= b); } break;
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
        this.tasks.push({ kind: "forall", values, index: 0, procedure }); break;
      }
      case "loop": this.tasks.push({ kind: "loop", procedure: this.procedure() }); break;
      case "exit": { const i = lastIndex(this.tasks, task => ["for", "forall", "repeat", "loop"].includes(task.kind)); if (i < 0) throw unsupported("PostScript exit occurs outside a loop."); this.tasks.splice(i); break; }
      case "exec": this.execute(this.pop()); break;
      case "bind": { const procedure = this.procedure(); this.push(bindProcedure(procedure, name => this.lookup(name), this.options.signal)); break; }
      case "readonly": case "executeonly": case "noaccess": this.push(reduceAccess(this.pop(), name === "readonly" ? 2 : name === "executeonly" ? 1 : 0)); break;
      case "cvlit": case "cvx": { const value = this.pop(); this.push(changeExecution(value, name === "cvx")); break; }
      case "cvn": { const value = this.pop(); if (!(value instanceof Uint8Array)) throw unsupported("PostScript cvn requires a string."); requireAccess(value, 2); this.push(literalName(byteString(value))); break; }
      case "type": { const value = this.pop(); this.push(literalName(typeof value === "number" ? Number.isInteger(value) ? "integertype" : "realtype" : typeof value === "boolean" ? "booleantype" : value === null ? "nulltype" : value instanceof Map ? "dicttype" : value instanceof Uint8Array ? "stringtype" : Array.isArray(value) || isProcedure(value) ? "arraytype" : isName(value) ? "nametype" : tagged(value, "file") ? "filetype" : "operatortype")); break; }
      case "xcheck": { const value = this.pop(); this.push(isExecutable(value)); break; }
      case "rcheck": case "wcheck": { const value = this.pop(); if (!isComposite(value)) throw unsupported("PostScript access checks require an array, dictionary, string or file."); this.push(accessOf(value) >= (name === "rcheck" ? 2 : 3)); break; }
      case "currentfile": if (!this.reader) throw unsupported("No font input file is active."); else { const file: PsFile = { kind: "file", reader: this.reader }; accessAttributes.set(file, 2); this.push(file); } break;
      case "readstring": {
        const target = this.pop(), file = this.pop(); if (!(target instanceof Uint8Array) || !tagged(file, "file")) throw unsupported("PostScript readstring requires the font input and a string.");
        requireAccess(file, 2); requireAccess(target, 3);
        const source = (file as PsFile).reader.raw(target.length); target.set(source); this.push(byteView(target, 0, source.length)); this.push(source.length === target.length); break;
      }
      case "closefile": case "eexec": { const file = this.pop(); if (!tagged(file, "file")) throw unsupported("A font input file is required."); requireAccess(file, 1); (file as PsFile).reader.close(); break; }
      case "definefont": { const dict = this.dictionary(), fontName = this.name(); requireAccess(dict, 2); this.directory.set(fontName, dict); this.definedFont = dict; this.push(dict); break; }
      case "findfont": { const fontName = this.name(), dict = this.directory.get(fontName); if (!(dict instanceof Map)) throw unsupported(`PostScript font ${fontName} is unavailable.`); this.push(dict); break; }
      case "currentpacking": this.push(false); break;
      case "setpacking": this.pop(); break;
      default: throw unsupported(`PostScript operator ${name} is unavailable in the font interpreter.`, name);
    }
  }
}

const OPERATOR_NAMES = (`[ ] << >> mark pop dup exch index roll clear count cleartomark counttomark
array string dict begin end currentdict def store load where known undef get put length getinterval putinterval aload astore copy
add sub mul div idiv mod exp atan neg abs sqrt ln log sin cos floor ceiling round truncate cvi cvr eq ne lt le gt ge
and or xor not bitshift if ifelse repeat for forall loop exit exec bind readonly executeonly noaccess cvlit cvx cvn type xcheck rcheck wcheck
currentfile readstring closefile eexec definefont findfont currentpacking setpacking`).split(/\s+/);

class FontPostScriptLexer {
  private readonly bytes: Uint8Array;
  private readonly signal?: AbortSignal;
  private readonly maxStringBytes?: number;
  private offset = 0;
  constructor(bytes: Uint8Array, signal?: AbortSignal, maxStringBytes?: number) { this.bytes = bytes; this.signal = signal; this.maxStringBytes = maxStringBytes; }
  close(): void { this.offset = this.bytes.length; }
  raw(length: number): Uint8Array { const end = Math.min(this.offset + length, this.bytes.length); const result = this.bytes.subarray(this.offset, end); this.offset = end; return result; }
  next(): Value | undefined {
    const first = this.token();
    if (isName(first) && first.value === "{") {
      const frames: Value[][] = [[]];
      while (frames.length) {
        const value = this.token(); if (value === undefined) throw unsupported("An unterminated PostScript procedure was encountered.");
        if (isName(value) && value.value === "{") frames.push([]);
        else if (isName(value) && value.value === "}") {
          const procedure: Procedure = { kind: "procedure", tokens: frames.pop()! };
          if (!frames.length) return procedure;
          frames.at(-1)!.push(procedure);
        } else frames.at(-1)!.push(value);
      }
    }
    if (isName(first) && first.value === "}") throw unsupported("An unmatched PostScript procedure delimiter was encountered.");
    return first;
  }
  private token(): Value | undefined {
    const bytes = this.bytes;
    while (this.offset < bytes.length) {
      throwIfAborted(this.signal);
      if (white(bytes[this.offset])) { this.offset++; continue; }
      if (bytes[this.offset] === 37) { while (this.offset < bytes.length && bytes[this.offset] !== 10 && bytes[this.offset] !== 13) this.offset++; continue; }
      break;
    }
    if (this.offset === bytes.length) return undefined;
    const byte = bytes[this.offset++];
    if (byte === 40) {
      const output: number[] = []; let depth = 1;
      while (this.offset < bytes.length) {
        throwIfAborted(this.signal);
        let value = bytes[this.offset++];
        if (value === 92) {
          if (this.offset === bytes.length) break;
          value = bytes[this.offset++];
          if (value === 10 || value === 13) { if (value === 13 && bytes[this.offset] === 10) this.offset++; continue; }
          if (value >= 48 && value <= 55) { let octal = value - 48; for (let i = 0; i < 2 && bytes[this.offset] >= 48 && bytes[this.offset] <= 55; i++) octal = octal * 8 + bytes[this.offset++] - 48; checkStringLength(output.length + 1, this.maxStringBytes); output.push(octal & 255); continue; }
          value = ({ 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 } as Record<number, number>)[value] ?? value;
        } else if (value === 40) depth++;
        else if (value === 41 && --depth === 0) return Uint8Array.from(output);
        else if (value === 13) { if (bytes[this.offset] === 10) this.offset++; value = 10; }
        checkStringLength(output.length + 1, this.maxStringBytes); output.push(value);
      }
      throw unsupported("A PostScript literal string is truncated.");
    }
    if (byte === 60 && bytes[this.offset] !== 60) {
      const output: number[] = []; let high = -1;
      while (this.offset < bytes.length) {
        throwIfAborted(this.signal);
        const value = bytes[this.offset++]; if (value === 62) { if (high >= 0) { checkStringLength(output.length + 1, this.maxStringBytes); output.push(high * 16); } return Uint8Array.from(output); }
        if (white(value)) continue; const digit = hex(value); if (digit < 0) throw unsupported("A PostScript hexadecimal string has an invalid digit.");
        if (high < 0) high = digit; else { checkStringLength(output.length + 1, this.maxStringBytes); output.push(high * 16 + digit); high = -1; }
      }
      throw unsupported("A PostScript hexadecimal string is truncated.");
    }
    if ((byte === 60 || byte === 62) && bytes[this.offset] === byte) { this.offset++; return executableName(byte === 60 ? "<<" : ">>"); }
    if ([91, 93, 123, 125].includes(byte)) return executableName(String.fromCharCode(byte));
    const literal = byte === 47, start = literal ? this.offset : this.offset - 1;
    while (this.offset < bytes.length && !delimiter(bytes[this.offset])) this.offset++;
    if (this.offset === start) throw unsupported("An invalid PostScript token was encountered.");
    const text = byteString(bytes.subarray(start, this.offset));
    // The token scanner consumes its whitespace delimiter. RD/readstring sees
    // the first binary byte immediately after that one separator.
    if (white(bytes[this.offset])) { if (bytes[this.offset++] === 13 && bytes[this.offset] === 10) this.offset++; }
    if (literal) return literalName(text);
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return finite(Number(text));
    const radix = /^(\d+)#([0-9a-z]+)$/i.exec(text);
    if (radix) { const base = Number(radix[1]); if (base < 2 || base > 36 || [...radix[2]].some(c => parseInt(c, 36) >= base)) throw unsupported("Invalid PostScript radix number."); return finite(parseInt(radix[2], base)); }
    return executableName(text);
  }
}

// PLRM 3.3.2: access belongs to an array/string/file reference, while a
// dictionary's access belongs to its shared value. Views retain storage aliases
// without changing another reference's access attribute.
type Access = 0 | 1 | 2 | 3;
const accessAttributes = new WeakMap<object, Access>();
const executableReferences = new WeakMap<object, boolean>();
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
  if ((!Array.isArray(items) && !(items instanceof Uint8Array)) || typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= items.length) throw unsupported("A PostScript get index is invalid.");
  return items[index];
}
function put(target: Value, index: Value, value: Value): void {
  requireAccess(target, 3);
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
function unsupported(message: string, operator?: string): PdfError { return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-unsupported", ...(operator ? { operator } : {}) } }); }
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
function cloneValue(root: Value, signal?: AbortSignal, maxStringBytes?: number): Value {
  const seen = new Map<object, Value>(), pending: { source: Value; target: Value }[] = [];
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
    else if (tagged(source, "file")) throw unsupported("Custom font procedures cannot retain a font input file between glyph executions.", "currentfile");
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
