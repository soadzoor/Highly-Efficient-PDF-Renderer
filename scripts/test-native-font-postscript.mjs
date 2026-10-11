import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { buildType1Fixture, concatType1Bytes } from "./lib/type1Fixture.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { executeNativeFontPostScript } = await import("../src/pdf/nativeFontPostScript.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const bytes = source => new TextEncoder().encode(source);
  const execute = (source, options = {}) => executeNativeFontPostScript(bytes(source), undefined,
    { initialDictionary: new Map([["FontType", 1]]), ...options });
  const failure = (run, code) => assert.throws(run, error => error instanceof PdfError && error.code === code);

  const arithmetic = execute(`
    /a 20 4 div 3 mul 2 add def /b -8 abs 2 exp def /c 19 3 idiv def
    /array 6 array def 0 1 5 { dup array exch 3 -1 roll 2 mul put } for
    /sum 0 def array { sum add /sum exch def } forall
    /conditional sum 30 eq { 7 } { 9 } ifelse def
    /repeatSum 0 def 4 { /repeatSum repeatSum 3 add def } repeat
    /loopValue 0 def { /loopValue loopValue 1 add def loopValue 5 eq { exit } if } loop
  `).dictionary;
  assert.equal(arithmetic.get("a"), 17);
  assert.equal(arithmetic.get("b"), 64);
  assert.equal(arithmetic.get("c"), 6);
  assert.deepEqual(arithmetic.get("array"), [0, 2, 4, 6, 8, 10]);
  assert.equal(arithmetic.get("sum"), 30);
  assert.equal(arithmetic.get("conditional"), 7);
  assert.equal(arithmetic.get("repeatSum"), 12);
  assert.equal(arithmetic.get("loopValue"), 5);

  const arrays = execute(`
    /source [10 20 30 40] def /view source 1 2 getinterval def
    view 0 99 put source 2 77 put
    /observed view aload pop 2 array astore def
    source 1 source 0 3 getinterval putinterval
    /target 6 array def /copied [4 5] target copy def copied 0 8 put
  `).dictionary;
  assert.deepEqual(arrays.get("observed"), [99, 77], "array intervals share mutable storage");
  assert.deepEqual(arrays.get("source"), [10, 10, 99, 77], "overlapping putinterval uses original source elements");
  assert.equal(arrays.get("copied").length, 2, "copy returns the populated target interval");
  assert.equal(arrays.get("target")[0], 8);

  const bound = execute(`/p { 1 2 add } bind def /add { pop pop 42 } def /answer p def
    /execArray [3 4 /mul cvx] cvx exec def /literal /abc cvx cvlit def`).dictionary;
  assert.equal(bound.get("answer"), 3, "bind captures operator meaning before later redefinition");
  assert.equal(bound.get("execArray"), 12);
  assert.equal(bound.get("literal").literal, true);
  const sharedBind = execute(`/p { 1 2 add } def /q /p load def /p load bind pop
    /add { pop pop 99 } def /answer q def`).dictionary;
  assert.equal(sharedBind.get("answer"), 3, "bind updates the shared executable array");
  const lexical = execute(`/string (a\\n\\050b\\051\\\ncontinued) def /hex <f 0 1> def
    /radix 16#ff def /name (example) cvn def /dict << /x 4 /y 5 >> def`).dictionary;
  assert.deepEqual([...lexical.get("string")], [...bytes("a\n(b)continued")]);
  assert.deepEqual([...lexical.get("hex")], [240, 16]);
  assert.equal(lexical.get("radix"), 255);
  assert.equal(lexical.get("name").value, "example");
  assert.equal(lexical.get("dict").get("y"), 5);
  const names = execute(`/equal /FontName (FontName) eq def
    /reverse (FontName) /FontName eq def /unequal /FontName (OtherName) eq def`).dictionary;
  assert.equal(names.get("equal"), true, "PostScript compares name and string contents");
  assert.equal(names.get("reverse"), true);
  assert.equal(names.get("unequal"), false);

  const fixture = buildType1Fixture();
  const dictionary = executeNativeFontPostScript(fixture.cleartext, fixture.privatePlaintext,
    { maxOperations: 10000 }).dictionary;
  assert.equal(dictionary.get("FontType"), 1);
  assert.equal(dictionary.get("Private").get("lenIV"), 4);
  assert.equal(dictionary.get("CharStrings").size, 3, "currentfile/readstring retains exact encrypted binary strings");
  const binary = executeNativeFontPostScript(concatType1Bytes(bytes(`
    10 dict begin /FontType 1 def /RD { string currentfile exch readstring pop } bind def
    /CharStrings 1 dict dup begin /A 4 RD `), Uint8Array.of(32, 0, 41, 255), bytes(` def end def currentdict end`)));
  assert.deepEqual([...binary.dictionary.get("CharStrings").get("A")], [32, 0, 41, 255]);

  const others = execute(`/counter 0 def /Private << /OtherSubrs [ {} {} {} {} { sub }
    { 10 mul } { /counter counter 1 add store counter } ] >> def`);
  assert.deepEqual(others.executeOtherSubr(4, [11, 22]), [11], "Type1 reverses arguments entering the PS stack");
  assert.deepEqual(others.executeOtherSubr(5, [3, 7]), [30, 7], "pop retrieves the PS top first");
  assert.deepEqual(others.executeOtherSubr(6, []), [1]);
  assert.deepEqual(others.executeOtherSubr(6, []), [1], "glyph calls are independent of cache execution order");
  assert.equal(others.dictionary.get("counter"), 0);
  assert.equal(others.executeOtherSubr(99, []), null);
  const state = execute(`/Private << /storage [10 20 30] /counter 0 >> def
    Private begin /view storage 1 2 getinterval def
    /text (abc) def /textView text 1 2 getinterval def
    /OtherSubrs [ {} {} {} {} { /counter counter 1 add store view 0 counter put textView 0 90 put }
      { storage 1 get counter add text 1 get add } ] def end`);
  const glyph = state.createOtherSubrExecutor();
  assert.deepEqual(glyph(4, []), []);
  assert.deepEqual(glyph(5, []), [92], "OtherSubrs share private state and array/string interval storage within a glyph");
  assert.deepEqual(glyph(4, []), []);
  assert.deepEqual(glyph(5, []), [94]);
  assert.deepEqual(state.createOtherSubrExecutor()(5, []), [118], "each glyph starts from the original private state");

  for (const source of ["(anything) (r) file", "(anything) run", "(anything) deletefile", "1 0 div", "3.5 2 idiv", "3 1.5 mod", "pop", "/a /a cvx def a"]) {
    failure(() => execute(source), "unsupported-font");
  }
  failure(() => execute(`{} loop`, { maxOperations: 30 }), "resource-limit");
  failure(() => execute(`1 2 3`, { maxStack: 2 }), "resource-limit");
  for (const source of ["5 string", "/s (abcde) def", "/s <0102030405> def", "/s (\\101\\102\\103\\104\\105) def"]) {
    failure(() => execute(source, { maxStringBytes: 4 }), "resource-limit");
  }
  const controller = new AbortController(); controller.abort();
  failure(() => execute(`/x 1 def`, { signal: controller.signal }), "aborted");
  const delayed = execute(`/Private << /OtherSubrs [{} {} {} {} {1 2 add}] >> def`);
  failure(() => delayed.executeOtherSubr(4, [], controller.signal), "aborted");
  const nested = "/deep " + "{".repeat(2000) + "1" + "}".repeat(2000) + " bind def";
  assert.equal(execute(nested).dictionary.get("deep").kind, "procedure", "lexing/binding does not consume the JS call stack");
  console.log("Font PostScript tests passed: computed records, binary input, control flow, binding, custom OtherSubrs, isolated state, limits and cancellation.");
} finally { hooks.deregister(); }
