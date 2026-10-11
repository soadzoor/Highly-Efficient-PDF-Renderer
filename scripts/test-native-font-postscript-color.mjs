import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts") ? specifier + ".ts" : specifier, context);
} });
const encoder = new TextEncoder(), oracle = process.argv.includes("--ghostscript");
const cie = `/WhitePoint [.95047 1 1.08883] /MatrixLMN [.4124564 .2126729 .0193339 .3575761 .7151522 .119192 .1804375 .072175  .9503041] /RangeLMN [0 2 0 2 0 2]`;
const cases = [
  { name: "Indexed string palette and rounded/clipped indices", code: `
    [/Indexed /DeviceRGB 2 <FF000000FF000000FF>] setcolorspace
    /initial [currentcolor] def .6 setcolor /rounded [currentcolor] def /rgb [currentrgbcolor] def
    -5 setcolor /low [currentcolor] def 30 setcolor /high [currentcolor] def
  `, expect: { initial: [0], rounded: [1], rgb: [0, 1, 0], low: [0], high: [2] }, color: [0, 0, 1, 1] },
  { name: "Indexed procedure and original CMYK queries", code: `
    [/Indexed /DeviceCMYK 2 {2 div dup dup .1}] setcolorspace
    1 setcolor /components [currentcolor] def /cmyk [currentcmykcolor] def
  `, expect: { components: [1], cmyk: [.5, .5, .5, .1] }, color: [.4, .4, .4, 1] },
  { name: "Separation alternate and initial tint", code: `
    [/Separation /LogoGreen /DeviceRGB {dup .5 mul exch 0 exch}] setcolorspace
    /initial [currentcolor] def .6 setcolor /components [currentcolor] def /rgb [currentrgbcolor] def
  `, expect: { initial: [1], components: [.6], rgb: [.3, 0, .6] }, color: [.3, 0, .6, 1] },
  { name: "DeviceN five component alternate", code: `
    [/DeviceN [/InkA /InkB /InkC /InkD /InkE] /DeviceRGB {pop pop}] setcolorspace
    /initial [currentcolor] def .2 .4 .6 .8 1 setcolor /components [currentcolor] def /rgb [currentrgbcolor] def
  `, expect: { initial: [1, 1, 1, 1, 1], components: [.2, .4, .6, .8, 1], rgb: [.2, .4, .6] }, color: [.2, .4, .6, 1] },
  { name: "None separation never paints", code: `
    [/Separation /None /DeviceRGB {}] setcolorspace /initial [currentcolor] def .7 setcolor /components [currentcolor] def /cmyk [currentcmykcolor] def
    0 0 moveto 1 0 lineto 1 1 lineto closepath fill
  `, expect: { initial: [1], components: [.7], cmyk: [0, 0, 0, 0] }, color: [0, 0, 0, 0] },
  { name: "All separation", code: `
    [/Separation /All /DeviceRGB {}] setcolorspace .25 setcolor /components [currentcolor] def /rgb [currentrgbcolor] def /cmyk [currentcmykcolor] def
  `, expect: { components: [.25], rgb: [0, 0, 0], cmyk: [0, 0, 0, 0] }, color: [.75, .75, .75, 1] },
  { name: "gsave and VM restore preserve source-space identity", code: `
    /palette [/Indexed /DeviceRGB 1 <FF000000FF00>] def palette setcolorspace 1 setcolor
    gsave .25 setgray grestore /spaceSame currentcolorspace palette eq def /restored [currentcolor] def
    /s save def currentcolorspace 0 /DeviceGray put s restore
    /restoredFamily currentcolorspace 0 get def 0 setcolor /rgb [currentrgbcolor] def
  `, expect: { spaceSame: true, restored: [1], restoredFamily: "/Indexed", rgb: [1, 0, 0] }, color: [1, 0, 0, 1] },
  { name: "CIEBasedABC source clipping and device query defaults", code: `
    [/CIEBasedABC << ${cie} /RangeABC [0 1 -.2 .8 .1 1] >>] setcolorspace
    /initial [currentcolor] def 2 -1 .5 setcolor /clipped [currentcolor] def
    /rgb [currentrgbcolor] def /gray currentgray def /cmyk [currentcmykcolor] def /hsb [currenthsbcolor] def
  `, expect: { initial: [0, 0, .1], clipped: [1, -.2, .5], rgb: [0, 0, 0], gray: 0, cmyk: [0, 0, 0, 1], hsb: [0, 0, 0] }, cie: true },
  { name: "CIEBasedA decoding", code: `
    [/CIEBasedA << /WhitePoint [.95047 1 1.08883] /RangeA [0 100]
      /DecodeA {100 div dup mul} /MatrixA [.95047 1 1.08883] /RangeLMN [0 2 0 2 0 2] >>] setcolorspace
    50 setcolor /components [currentcolor] def
  `, expect: { components: [50] }, color: [.5370987, .5370987, .5370987, 1], cie: true },
  { name: "CIEBasedABC nonlinear decoding", code: `
    [/CIEBasedABC << ${cie} /DecodeABC [{dup mul} dup dup] >>] setcolorspace
    .5 .5 .5 setcolor /components [currentcolor] def
  `, expect: { components: [.5, .5, .5] }, color: [.5370987, .5370987, .5370987, 1], cie: true },
  { name: "CIEBasedDEF trilinear table and source ranges", code: `
    [/CIEBasedDEF << ${cie} /RangeDEF [0 2 0 2 0 2] /DecodeDEF [{2 div} dup dup]
      /Table [2 2 2 [<0000000000FF00FF0000FFFF> <FF0000FF00FFFFFF00FFFFFF>]] >>] setcolorspace
    1 1 1 setcolor /components [currentcolor] def
  `, expect: { components: [1, 1, 1] }, color: [.735357, .735357, .735357, 1], cie: true },
  { name: "CIEBasedDEFG four dimensional interpolation", code: `
    [/CIEBasedDEFG << ${cie}
      /Table [2 2 2 2 [[<0000000000000000FF0000FF> <00FF0000FF0000FFFF00FFFF>]
        [<FF0000FF0000FF00FFFF00FF> <FFFF00FFFF00FFFFFFFFFFFF>]]] >>] setcolorspace
    .5 .5 .5 .3 setcolor /components [currentcolor] def
  `, expect: { components: [.5, .5, .5, .3] }, color: [.735357, .735357, .735357, 1], cie: true },
  { name: "Indexed dictionary image Decode uses palette indices", code: `
    [/Indexed /DeviceRGB 2 <FF000000FF000000FF>] setcolorspace
    << /ImageType 1 /Width 3 /Height 1 /BitsPerComponent 8 /ImageMatrix [1 0 0 1 0 0]
      /Decode [0 255] /DataSource <000102> /Interpolate true >> image /completed true def
  `, expect: { completed: true }, pixels: [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255] },
  { name: "DeviceN arbitrary component image", code: `
    [/DeviceN [/A /B /C /D /E] /DeviceRGB {pop pop}] setcolorspace
    << /ImageType 1 /Width 1 /Height 1 /BitsPerComponent 8 /ImageMatrix [1 0 0 1 0 0]
      /Decode [0 1 0 1 0 1 0 1 0 1] /DataSource <336699CCFF> >> image /completed true def
  `, expect: { completed: true }, pixels: [51, 102, 153, 255] },
  { name: "invalid image Decode fails before calling its procedure source", code: `
    /procedureCalls 0 def [/Indexed /DeviceRGB 0 <FF0000>] setcolorspace
    { << /ImageType 1 /Width 1 /Height 1 /BitsPerComponent 8 /ImageMatrix [1 0 0 1 0 0]
      /Decode [0 1 0 1] /DataSource { /procedureCalls procedureCalls 1 add def <00> } >> image } stopped pop
    /caught $error /errorname get def clear
  `, expect: { caught: "/rangecheck", procedureCalls: 0 } },
  { name: "color procedure errors propagate through stopped", code: `
    { [/Indexed /DeviceRGB 1 {pop 1 0 missingColorProcedure}] setcolorspace } stopped pop
    /caught $error /errorname get def clear
    .5 setgray /after [currentcolor] def
  `, expect: { caught: "/undefined", after: [.5] }, color: [.5, .5, .5, 1] },
  { name: "inaccessible palette is invalidaccess", code: `
    { [/Indexed /DeviceRGB 0 <FF0000> noaccess] setcolorspace } stopped pop
    /caught $error /errorname get def clear
  `, expect: { caught: "/invalidaccess" } },
  { name: "invalid CIE parameters diagnosed", code: `
    { [/CIEBasedABC << /WhitePoint [0 1 1] >>] setcolorspace } stopped pop
    /caught $error /errorname get def clear
  `, expect: { caught: "/rangecheck" } }
];
try {
  const { executeNativeFontPostScript } = await import("../src/pdf/nativeFontPostScript.ts");
  const { NativeFontPostScriptGlyphContext } = await import("../src/pdf/nativeFontPostScriptGraphics.ts");
  for (const fixture of cases) {
    if (oracle) {
      const program = `100 dict begin [1 0 0 1 0 0] setmatrix\n${fixture.code}\n` + Object.keys(fixture.expect).map(key => `/${key} load ==`).join("\n") + "\nquit";
      const result = spawnSync("gs", ["-q", "-dNODISPLAY", "-dBATCH", "-dNOPAUSE", "-c", program], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error); assert.equal(result.status, 0, fixture.name + ": " + result.stdout + result.stderr);
      const lines = result.stdout.trim().split("\n"); assert.equal(lines.length, Object.keys(fixture.expect).length, fixture.name);
      Object.entries(fixture.expect).forEach(([key, expected], index) => equal(parseDisplay(lines[index]), expected, fixture.name + ": Ghostscript " + key, 1e-5));
    }
    const context = new NativeFontPostScriptGlyphContext();
    const result = executeNativeFontPostScript(encoder.encode(fixture.code), undefined,
      { glyphContext: context, initialMatrix: [1, 0, 0, 1, 0, 0], initialDictionary: new Map([["FontType", 1]]) });
    for (const [key, expected] of Object.entries(fixture.expect)) equal(jsValue(result.dictionary.get(key)), expected, fixture.name + ": " + key);
    if (fixture.color) equal(context.color, fixture.color, fixture.name + ": display color", 2e-5);
    if (fixture.pixels) {
      assert.equal(context.paintRecords.length, 1, fixture.name); assert.equal(context.paintRecords[0].kind, "image", fixture.name);
      assert.deepEqual([...context.paintRecords[0].rgba], fixture.pixels, fixture.name);
    }
    assert.equal(context.diagnostics.some(value => value.code === "font.postscript-cie-rendering-approximated"), fixture.cie === true, fixture.name);
  }
  const context = new NativeFontPostScriptGlyphContext();
  assert.throws(() => executeNativeFontPostScript(encoder.encode(`[/Indexed /DeviceRGB 0 {pop {} loop}] setcolorspace`), undefined,
    { glyphContext: context, initialDictionary: new Map([["FontType", 1]]), maxOperations: 100 }), error => error.code === "resource-limit");
  const name = value => ({ kind: "name", value, literal: true });
  let nested = [name("DeviceRGB")];
  for (let depth = 0; depth < 12000; depth++) nested = [name("Indexed"), nested, 0, Uint8Array.of(0, 0, 0)];
  const nestedResult = executeNativeFontPostScript(encoder.encode(`{ nested setcolorspace } stopped pop
    /caught $error /errorname get def clear`), undefined, { glyphContext: new NativeFontPostScriptGlyphContext(),
    initialDictionary: new Map([["FontType", 1], ["nested", nested]]) });
  assert.equal(nestedResult.dictionary.get("caught").value, "rangecheck",
    "deep invalid alternate families are rejected before recursive parsing or host stack exhaustion");
  const spotResult = executeNativeFontPostScript(encoder.encode(`{ [/Separation /Logo nested {}] setcolorspace } stopped pop
    /caught $error /errorname get def clear`), undefined, { glyphContext: new NativeFontPostScriptGlyphContext(),
    initialDictionary: new Map([["FontType", 1], ["nested", nested]]) });
  assert.equal(spotResult.dictionary.get("caught").value, "rangecheck");
  console.log(`Native font PostScript color checks passed (${cases.length} groups${oracle ? ", Ghostscript verified" : ""}).`);
} finally { hooks.deregister(); }
function jsValue(value) { return Array.isArray(value) ? value.map(jsValue) : value?.kind === "name" ? "/" + value.value : value; }
function parseDisplay(text) {
  if (text.startsWith("[")) return text.slice(1, -1).trim().split(/\s+/).filter(Boolean).map(parseDisplay);
  return text.startsWith("/") ? text : text === "true" ? true : text === "false" ? false : Number(text);
}
function equal(actual, expected, label, tolerance = 1e-9) {
  if (Array.isArray(expected)) { assert(Array.isArray(actual), label); assert.equal(actual.length, expected.length, label); expected.forEach((value, index) => equal(actual[index], value, label, tolerance)); }
  else if (typeof expected === "number") assert(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
  else assert.equal(actual, expected, label);
}
