import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { executeNativeFontPostScript } = await import("../src/pdf/nativeFontPostScript.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const bytes = source => new TextEncoder().encode(source);
  const text = value => new TextDecoder().decode(value);
  const execute = (source, options = {}) => executeNativeFontPostScript(bytes(source), undefined,
    { initialDictionary: new Map([["FontType", 1]]), ...options });
  const failures = [];
  const check = (name, run) => {
    try { run(); }
    catch (error) { failures.push(name); console.error(`${name}: ${error.stack}`); }
  };

  // PLRM chapter 8, independently checked with Ghostscript 10.02.1. stopped
  // restores an offending operator's operands, but not earlier side effects.
  check("stopped operands and command identity", () => {
    const dict = execute(`
      { 5 6 add } stopped /normalStopped exch def /normalValue exch def
      { 11 stop 99 } stopped /explicitStopped exch def /explicitValue exch def
      /mutation 7 def { /mutation 8 def 1 (x) add } stopped /failed exch def
      2 array astore /errorOperands exch def /errorName $error /errorname get def
      /errorCommandType $error /command get type def
      /commandIsName $error /command get /add eq def
      { unknownEmbeddedFontName } stopped pop
      /undefinedName $error /errorname get def
      /undefinedCommandType $error /command get type def
      /undefinedCommand $error /command get def
      { { 9 stop } stopped /innerStopped exch def /innerValue exch def 13 }
        stopped /outerStopped exch def /outerValue exch def
    `).dictionary;
    assert.equal(dict.get("normalStopped"), false); assert.equal(dict.get("normalValue"), 11);
    assert.equal(dict.get("explicitStopped"), true); assert.equal(dict.get("explicitValue"), 11);
    assert.equal(dict.get("failed"), true); assert.equal(dict.get("mutation"), 8);
    assert.equal(dict.get("errorOperands")[0], 1); assert.equal(text(dict.get("errorOperands")[1]), "x");
    assert.equal(dict.get("errorName").value, "typecheck");
    assert.equal(dict.get("errorCommandType").value, "operatortype");
    assert.equal(dict.get("commandIsName"), false);
    assert.equal(dict.get("undefinedName").value, "undefined");
    assert.equal(dict.get("undefinedCommandType").value, "nametype");
    assert.equal(dict.get("undefinedCommand").value, "unknownEmbeddedFontName");
    assert.equal(dict.get("innerStopped"), true); assert.equal(dict.get("innerValue"), 9);
    assert.equal(dict.get("outerStopped"), false); assert.equal(dict.get("outerValue"), 13);
  });

  check("stopped dictionary stack and typed errors", () => {
    const dict = execute(`
      /depth countdictstack def
      { 2 dict begin /localValue 3 def stop } stopped pop
      /deeper countdictstack def /localVisible localValue def
      currentdict end /owner exch def
      /deeper owner /deeper get def /localVisible owner /localVisible get def
      { [] (x) get } stopped pop /badIndexType $error /errorname get def clear
      { 1 array -1 1 getinterval } stopped pop /badRange $error /errorname get def clear
      { 1 0 div } stopped pop /zeroDivision $error /errorname get def clear
      { [] readonly 0 4 put } stopped pop /badAccess $error /errorname get def clear
    `).dictionary;
    assert.equal(dict.get("deeper"), dict.get("depth") + 1);
    assert.equal(dict.get("localVisible"), 3);
    assert.equal(dict.get("badIndexType").value, "typecheck");
    assert.equal(dict.get("badRange").value, "rangecheck");
    assert.equal(dict.get("zeroDivision").value, "undefinedresult");
    assert.equal(dict.get("badAccess").value, "invalidaccess");
  });

  check("save nesting, aliases, access and packing", () => {
    const dict = execute(`
      /storage [1 2 3] def /view storage 1 2 getinterval def
      /stringStorage (abc) def /stringView stringStorage 1 2 getinterval def
      /sharedDict << /value 5 >> def /beforeCount sharedDict length def
      false setpacking
      /outer save def
        storage 1 99 put view 1 88 put stringView 0 90 put
        sharedDict /value 77 put sharedDict readonly pop true setpacking
        /temporaryAfterSave 44 def
        /inner save def storage 0 33 put /duringInner 66 def
        inner restore
        /innerRestored storage 0 get def
      outer restore
      /observed view aload pop 2 array astore def
      /stringObserved stringView 2 string copy def
      /dictWritable sharedDict wcheck def /packingRestored currentpacking def
      /temporaryGone /temporaryAfterSave where { pop false } { true } ifelse def
      /innerDefinitionGone /duringInner where { pop false } { true } ifelse def
    `).dictionary;
    assert.deepEqual(dict.get("storage"), [1, 2, 3]); assert.deepEqual(dict.get("observed"), [2, 3]);
    assert.equal(text(dict.get("stringStorage")), "abc"); assert.equal(text(dict.get("stringObserved")), "bc");
    assert.equal(dict.get("sharedDict").get("value"), 5); assert.equal(dict.get("dictWritable"), true);
    assert.equal(dict.get("packingRestored"), false);
    assert.equal(dict.get("temporaryGone"), true); assert.equal(dict.get("innerDefinitionGone"), true);
  });

  check("invalidrestore preserves current VM", () => {
    const dict = execute(`
      /storage [1] def
      { save 1 array exch restore } stopped pop
      /newOperandError $error /errorname get def clear
      { save 1 dict begin restore } stopped pop
      /newDictionaryError $error /errorname get def
      currentdict end /owner exch def /newDictionaryError owner /newDictionaryError get def clear
      /s save def storage 0 9 put s restore
      { s restore } stopped pop /staleSaveError $error /errorname get def clear
      { save dup restore restore } stopped pop /staleObjectError $error /errorname get def clear
    `).dictionary;
    assert.equal(dict.get("newOperandError").value, "invalidrestore");
    assert.equal(dict.get("newDictionaryError").value, "invalidrestore");
    // The name s was itself defined after save, so it is undefined afterward.
    assert.equal(dict.get("staleSaveError").value, "undefined");
    assert.equal(dict.get("staleObjectError").value, "invalidrestore");
    assert.deepEqual(dict.get("storage"), [1]);
  });

  check("string conversion preserves execution and search aliases", () => {
    const dict = execute(`
      /executableName (CustomGlyph) cvx cvn def
      /literalName (CustomGlyph) cvn def
      /convertedInteger ( 16#FF remaining) cvi def /convertedReal (12.5) cvr def
      /nameText /CustomGlyph 32 string cvs def /hexText 255 16 16 string cvrs def
      /source (prefix-A-suffix) def
      source (A) search { /before exch def /match exch def /after exch def /found true def }
        { pop /found false def } ifelse
      match 0 90 put
      /anchorSource (Font-Bold) def
      anchorSource (Font) anchorsearch { /anchorMatch exch def /anchorAfter exch def /anchored true def }
        { pop /anchored false def } ifelse
      anchorMatch 0 77 put
      /failedSource (abc) def failedSource (z) search
        { pop pop pop /missing false def } { /missing true def /failedAlias exch def } ifelse
      failedAlias 0 90 put
    `).dictionary;
    assert.equal(dict.get("executableName").literal, false); assert.equal(dict.get("literalName").literal, true);
    assert.equal(dict.get("convertedInteger"), 255); assert.equal(dict.get("convertedReal"), 12.5);
    assert.equal(text(dict.get("nameText")), "CustomGlyph"); assert.equal(text(dict.get("hexText")), "FF");
    assert.equal(dict.get("found"), true); assert.equal(text(dict.get("before")), "prefix-");
    assert.equal(text(dict.get("match")), "Z"); assert.equal(text(dict.get("after")), "-suffix");
    assert.equal(text(dict.get("source")), "prefix-Z-suffix");
    assert.equal(dict.get("anchored"), true); assert.equal(text(dict.get("anchorAfter")), "-Bold");
    assert.equal(text(dict.get("anchorSource")), "Mont-Bold");
    assert.equal(dict.get("missing"), true); assert.equal(text(dict.get("failedSource")), "Zbc");
  });

  check("forall observes live array and string elements", () => {
    const dict = execute(`
      /source [1 2] def /seen 2 array def /i 0 def
      source { seen i 3 -1 roll put /i i 1 add def source 1 9 put } forall
      /text (ab) def /textSeen 2 array def /i 0 def
      text { textSeen i 3 -1 roll put /i i 1 add def text 1 90 put } forall
    `).dictionary;
    assert.deepEqual(dict.get("seen"), [1, 9]); assert.deepEqual(dict.get("textSeen"), [97, 90]);
  });

  check("dictstack exposes shared dictionaries and destination interval", () => {
    const dict = execute(`
      /depth countdictstack def /destination depth 2 add array def
      /observed destination dictstack def
      /sameCurrent observed depth 1 sub get currentdict eq def
      observed depth 1 sub get /throughStack 42 put
      /extra 2 dict def extra begin /extraDepth countdictstack def end
      /extraDepth extra /extraDepth get def
    `).dictionary;
    assert.equal(dict.get("observed").length, dict.get("depth"));
    assert.equal(dict.get("destination").length, dict.get("depth") + 2);
    assert.equal(dict.get("sameCurrent"), true); assert.equal(dict.get("throughStack"), 42);
    assert.equal(dict.get("extraDepth"), dict.get("depth") + 1);
  });

  check("resources return readonly instances and reused scratch strings", () => {
    const dict = execute(`
      /EmbeddedFoo << /answer 42 >> /ProcSet defineresource /resourceA exch def
      /EmbeddedBar << /answer 43 >> /ProcSet defineresource pop
      /resourceWritable resourceA wcheck def
      /resourceAnswer /EmbeddedFoo /ProcSet findresource /answer get def
      /EmbeddedFoo /ProcSet resourcestatus /exists exch def /size exch def /status exch def
      /scratch 128 string def /names 2 array def /aliases 2 array def /types 2 array def /n 0 def
      (Embedded*) {
        /current exch def names n current cvn put aliases n current put types n current type put
        /n n 1 add def
      } scratch /ProcSet resourceforall
      /scratchAliases aliases 0 get aliases 1 get eq def
      /s save def /Transient << /answer 44 >> /ProcSet defineresource pop s restore
      /Transient /ProcSet resourcestatus /transientPresent exch def
      /EmbeddedFoo /ProcSet undefineresource
      /EmbeddedFoo /ProcSet resourcestatus /removedPresent exch def
    `).dictionary;
    assert.equal(dict.get("resourceWritable"), false); assert.equal(dict.get("resourceAnswer"), 42);
    assert.equal(dict.get("exists"), true); assert.equal(dict.get("status"), 0); assert.equal(dict.get("size"), -1);
    assert.deepEqual(dict.get("names").map(name => name.value).sort(), ["EmbeddedBar", "EmbeddedFoo"]);
    assert.deepEqual(dict.get("types").map(name => name.value), ["stringtype", "stringtype"]);
    assert.equal(dict.get("scratchAliases"), true, "equal-length resource names occupy the same reused scratch interval");
    assert.equal(dict.get("transientPresent"), false); assert.equal(dict.get("removedPresent"), false);
  });

  check("stopped cannot swallow configured limits or cancellation", () => {
    assert.throws(() => execute("{ {} loop } stopped", { maxOperations: 50 }),
      error => error instanceof PdfError && error.code === "resource-limit");
    assert.throws(() => execute("{ 100 string } stopped", { maxStringBytes: 10 }),
      error => error instanceof PdfError && error.code === "resource-limit");
    const controller = new AbortController(); controller.abort();
    assert.throws(() => execute("{ 1 } stopped", { signal: controller.signal }),
      error => error instanceof PdfError && error.code === "aborted");
  });

  check("a diagnosed OtherSubr failure does not contaminate later calls", () => {
    const font = execute(`/Private << /OtherSubrs [{} {} {} {} { 4 dict begin 100 unknownOtherSubrOperation } { 2 mul }] >> def`);
    const glyph = font.createOtherSubrExecutor();
    assert.throws(() => glyph(4, [7]), error => error instanceof PdfError && error.details.operator === "unknownOtherSubrOperation");
    assert.deepEqual(glyph(5, [11]), [22]);
  });

  check("resource templates treat brackets literally", () => {
    const dict = execute(`
      /EmbeddedA <<>> /ProcSet defineresource pop
      /EmbeddedB <<>> /ProcSet defineresource pop
      (Embedded[AB]) <<>> /ProcSet defineresource pop
      /countFound 0 def /foundName null def
      (Embedded[AB]) { cvn /foundName exch def /countFound countFound 1 add def }
        64 string /ProcSet resourceforall
    `).dictionary;
    assert.equal(dict.get("countFound"), 1);
    assert.equal(dict.get("foundName").value, "Embedded[AB]");
  });

  assert.equal(failures.length, 0, `PostScript state regressions failed: ${failures.join(", ")}`);
  console.log("Native font PostScript state semantics passed (stopped, save aliases/access, strings, forall, dictstack and resources).");
} finally {
  hooks.deregister();
}
