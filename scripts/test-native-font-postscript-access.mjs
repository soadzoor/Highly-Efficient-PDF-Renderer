import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { executeNativeFontPostScript } = await import("../src/pdf/nativeFontPostScript.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const execute = source => executeNativeFontPostScript(new TextEncoder().encode(source), undefined,
    { initialDictionary: new Map([["FontType", 1]]) });
  const reject = source => assert.throws(() => execute(source),
    error => error instanceof PdfError && error.code === "unsupported-font");

  // PLRM 3.3.2 and the access operators: arrays/strings have per-reference
  // attributes; a dictionary's attributes are shared by all its references.
  const arrays = execute(`
    /source [10 20] def /locked source readonly def
    /sourceWritable source wcheck def /lockedWritable locked wcheck def /lockedReadable locked rcheck def
    /same source locked eq def source 0 99 put /observed locked 0 get def
    /view locked 0 1 getinterval def /viewWritable view wcheck def
    /unlockedView source 0 1 getinterval def /unlockedWritable unlockedView wcheck def
    /hidden source noaccess def /hiddenReadable hidden rcheck def /hiddenWritable hidden wcheck def
    /opaque source executeonly def /opaqueReadable opaque rcheck def
    /sourceStillWritable source wcheck def
  `).dictionary;
  assert.equal(arrays.get("sourceWritable"), true);
  assert.equal(arrays.get("lockedWritable"), false);
  assert.equal(arrays.get("lockedReadable"), true);
  assert.equal(arrays.get("same"), true, "access changes preserve the shared array value");
  assert.equal(arrays.get("observed"), 99);
  assert.equal(arrays.get("viewWritable"), false, "intervals inherit their source reference's access");
  assert.equal(arrays.get("unlockedWritable"), true);
  assert.equal(arrays.get("hiddenReadable"), false);
  assert.equal(arrays.get("hiddenWritable"), false);
  assert.equal(arrays.get("opaqueReadable"), false);
  assert.equal(arrays.get("sourceStillWritable"), true);

  const dictionaries = execute(`/d 1 dict def /alias d def d readonly pop
    /w alias wcheck def /r alias rcheck def`).dictionary;
  assert.equal(dictionaries.get("w"), false, "dictionary access reductions apply to all aliases");
  assert.equal(dictionaries.get("r"), true);
  const strings = execute(`/text (abc) def /locked text readonly def /view locked 1 2 getinterval def
    /w view wcheck def text 1 90 put /observed view 0 get def /r view rcheck def
    /same text locked eq def`).dictionary;
  assert.equal(strings.get("w"), false);
  assert.equal(strings.get("r"), true);
  assert.equal(strings.get("observed"), 90);
  assert.equal(strings.get("same"), true);

  const procedures = execute(`/p {1 2 add} def /locked /p load readonly def
    /w /locked load wcheck def /r /locked load rcheck def
    /literal /locked load cvlit def /literalWritable literal wcheck def
    /same literal /locked load eq def
    /answer /p load executeonly exec def
    /executable (3 4 add) cvx def /x /executable load xcheck def /stringAnswer executable def
    /literalString /executable load cvlit def /literalX literalString xcheck def
  `).dictionary;
  assert.equal(procedures.get("w"), false);
  assert.equal(procedures.get("r"), true);
  assert.equal(procedures.get("literalWritable"), false);
  assert.equal(procedures.get("same"), true);
  assert.equal(procedures.get("answer"), 3, "execute-only permits execution");
  assert.equal(procedures.get("x"), true);
  assert.equal(procedures.get("stringAnswer"), 7, "executable strings execute locally rather than being silently ignored");
  assert.equal(procedures.get("literalX"), false);
  const bound = execute(`/p {1 2 add} readonly def /p load bind pop
    /add {pop pop 99} def /answer p def
    /nested {{3 4 mul}} bind def /child /nested load 0 get def
    /childWritable /child load wcheck def /nestedWritable /nested load wcheck def`).dictionary;
  assert.equal(bound.get("answer"), 99, "bind skips readonly procedures");
  assert.equal(bound.get("childWritable"), false, "bind makes nested procedure references readonly");
  assert.equal(bound.get("nestedWritable"), true);

  const guarded = execute(`/FontMatrix [.001 0 0 .001 0 0] def
    [0] readonly wcheck {FontMatrix 0 .002 put} if`).dictionary;
  assert.equal(guarded.get("FontMatrix")[0], .001, "access-sensitive font initialization keeps the correct geometry");
  const builtins = execute(`/standardWritable StandardEncoding wcheck def /systemWritable systemdict wcheck def`).dictionary;
  assert.equal(builtins.get("standardWritable"), false);
  assert.equal(builtins.get("systemWritable"), false);

  for (const source of [
    "[1] readonly 0 2 put", "(a) readonly 0 90 put", "1 dict readonly /x 2 put",
    "[1] noaccess 0 get", "{1} executeonly 0 get", "(a) noaccess cvn",
    "[1] noaccess length", "[1] noaccess 0 1 getinterval", "[1] noaccess aload",
    "2 [1] readonly astore", "[1] [0] readonly copy", "[1] noaccess [0] copy",
    "[1] readonly 0 [2] putinterval", "1 dict noaccess begin", "1 dict readonly begin /x 2 def",
    "1 dict noaccess /x known", "1 dict readonly /x undef", "[1] noaccess {} forall",
    "currentfile (x) readonly readstring", "{1} noaccess exec",
    "[1] noaccess readonly", "[1] executeonly readonly", "[1] noaccess executeonly",
    "1 readonly", "1 rcheck", "true wcheck", "1 dict executeonly"
  ]) reject(source);

  // Native font consumption can inspect opaque Private data. Explicit
  // PostScript reads still obey the reference access and mutable state stays
  // confined to one glyph, including readonly interval aliases.
  const privateFont = execute(`/Private 4 dict dup begin
    /storage [10 20] def /view storage 0 1 getinterval readonly def
    /OtherSubrs [{} {} {} {} {storage 0 storage 0 get 1 add put view 0 get}
      {view wcheck {100} {200} ifelse}] def
    end noaccess def`);
  const glyph = privateFont.createOtherSubrExecutor();
  assert.deepEqual(glyph(4, []), [11]);
  assert.deepEqual(glyph(4, []), [12]);
  assert.deepEqual(glyph(5, []), [200], "cloning retains access attributes and interval storage aliases");
  assert.deepEqual(privateFont.createOtherSubrExecutor()(4, []), [11]);
  const retainedInput = execute(`/savedFile currentfile def /Private << /OtherSubrs [{} {} {} {} {1}] >> def`);
  assert.deepEqual(retainedInput.createOtherSubrExecutor()(4, []), [1],
    "retained input cursors are copied into independent glyph environments");

  console.log("Font PostScript access tests passed: reference attributes, shared dictionaries, aliases, execution, binding, private consumption and typed access failures.");
} finally { hooks.deregister(); }
