import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts") ? specifier + ".ts" : specifier, context);
} });
const oracle = process.argv.includes("--ghostscript"), encoder = new TextEncoder();
const identity = `/ColorRenderingType 1 /WhitePoint [1 1 1] /TransformPQR [{5 1 roll pop pop pop pop} dup dup]`;
const source = `[/CIEBasedABC << /WhitePoint [1 1 1] >>] setcolorspace`;
const adaptation = [3, 4, 5].map(i => `{ 5 dict begin /v exch def /bd exch def /wd exch def /bs exch def /ws exch def
  bd ${i} get v bs ${i} get sub wd ${i} get bd ${i} get sub mul ws ${i} get bs ${i} get sub div add end }`).join(" ");
const fixtures = [
  { name: "identity CRD and unchanged source queries", code: `<< ${identity} >> setcolorrendering ${source} .2 .4 .6 setcolor
    /components [currentcolor] def /rgb [currentrgbcolor] def`, expected: { components: [.2, .4, .6], rgb: [0, 0, 0] }, rgba: [.2, .4, .6, 1] },
  { name: "LMN and ABC transformations encode before range clipping", code: `<< ${identity}
    /MatrixLMN [2 0 0 0 -1 0 0 0 1] /EncodeLMN [{2 div} {neg} {dup mul}]
    /MatrixABC [0 1 0 0 0 1 1 0 0] /EncodeABC [{.1 add} {} {2 mul}]
    >> setcolorrendering ${source} .6 .2 .5 setcolor`, rgba: [.35, .6, .4, 1] },
  { name: "white and black point adaptation through nonidentity PQR", code: `<< ${identity}
    /MatrixPQR [2 0 0 0 3 0 0 0 4] /RangePQR [0 9 0 9 0 9] /TransformPQR [${adaptation}]
    >> setcolorrendering [/CIEBasedABC << /WhitePoint [2 1 1] /BlackPoint [.2 .1 .1] >>] setcolorspace .56 .46 .64 setcolor`, rgba: [.2, .4, .6, 1] },
  { name: "equal white and black points bypass all PQR operations", code: `<< ${identity}
    /MatrixPQR [0 0 0 0 0 0 0 0 0] /TransformPQR [{missingPqr} dup dup]
    >> setcolorrendering ${source} .2 .4 .6 setcolor`, rgba: [.2, .4, .6, 1] },
  { name: "PQR inverse and column-major cross-component mapping", code: `<< ${identity}
    /MatrixPQR [1 0 0 .5 1 0 0 0 2] /RangePQR [0 9 0 9 0 9] /TransformPQR [${adaptation}]
    >> setcolorrendering [/CIEBasedABC << /WhitePoint [2 1 1] >>] setcolorspace .5 .4 .6 setcolor`, rgba: [.22, .4, .6, 1] },
  { name: "canonical default compensates a source black point", code: `[/CIEBasedA << /WhitePoint [.95047 1 1.08883]
    /BlackPoint [.190094 .2 .217766] /MatrixA [.95047 1 1.08883] /RangeLMN [0 2 0 2 0 2] >>] setcolorspace .2 setcolor`,
    rgba: [0, 0, 0, 1], diagnostic: "font.postscript-cie-rendering-approximated" },
  { name: "canonical sRGB default uses bound operators", code: `/exp {pop pop 0} def /mul {pop pop 0} def
    [/CIEBasedA << /WhitePoint [.95047 1 1.08883] /MatrixA [.95047 1 1.08883] >>] setcolorspace .25 setcolor`,
    rgba: [.5370987, .5370987, .5370987, 1], diagnostic: "font.postscript-cie-rendering-approximated", noOracle: true },
  { name: "RGB RenderTable ranges, trilinear bytes and channel transforms", code: `<< ${identity}
    /RangeABC [-1 1 -1 1 -1 1] /RenderTable [2 2 2
      [<0000000000FF00FF0000FFFF> <FF0000FF00FFFFFF00FFFFFF>] 3 {dup mul} {} {}]
    >> setcolorrendering ${source} 0 0 0 setcolor`, rgba: [.25, .5, .5, 1] },
  { name: "CMYK RenderTable is retained with explicit display diagnostic", code: `<< ${identity}
    /RenderTable [2 2 2 [<3366991A3366991A3366991A3366991A> <3366991A3366991A3366991A3366991A>]
      4 {} {} {} {}] >> setcolorrendering ${source} .2 .4 .6 setcolor`, rgba: [1 - 77 / 255, 1 - 128 / 255, 1 - 179 / 255, 1], diagnostic: "font.postscript-crd-cmyk-display-approximated", noRaster: true },
  { name: "changing CRD refreshes an already selected CIE color", code: `<< ${identity} >> setcolorrendering ${source} .2 .4 .6 setcolor
    << ${identity} /EncodeABC [{2 mul} {} {}] >> setcolorrendering`, rgba: [.4, .4, .6, 1] },
  { name: "gsave, save, default resource and object identity", code: `/original currentcolorrendering def
    /defaultSame original /DefaultColorRendering /ColorRendering findresource eq def /readOnly original wcheck not def
    /first << ${identity} >> def /second << ${identity} /EncodeABC [{2 mul} {} {}] >> def
    first setcolorrendering ${source} .2 .4 .6 setcolor gsave second setcolorrendering grestore
    /restored currentcolorrendering first eq def /s save def second setcolorrendering s restore
    /vmRestored currentcolorrendering first eq def`, expected: { defaultSame: true, readOnly: true, restored: true, vmRestored: true }, rgba: [.2, .4, .6, 1] },
  { name: "malformed rendering dictionary leaves prior graphics state", code: `/first << ${identity} >> def first setcolorrendering
    { << ${identity} /RangeABC [-1 1 0 1 0 1] >> setcolorrendering } stopped pop
    /caught $error /errorname get def clear /same currentcolorrendering first eq def`, expected: { caught: "/rangecheck", same: true }, noOracle: true },
  { name: "color rendering procedures propagate errors through stopped", code: `<< ${identity} /EncodeABC [{missingCrdOperator} {} {}] >> setcolorrendering
    { ${source} } stopped pop /caught $error /errorname get def clear .5 setgray`, expected: { caught: "/undefined" }, rgba: [.5, .5, .5, 1], noOracle: true },
  { name: "direct PQR procedure argument order and six-element points", code: `/transforms [${adaptation}] def
    /mapped [ [2 1 1 4 3 4] [.2 .1 .1 .4 .3 .4] [1 1 1 2 3 4] [0 0 0 0 0 0] 1.12 transforms 0 get exec
      [2 1 1 4 3 4] [.2 .1 .1 .4 .3 .4] [1 1 1 2 3 4] [0 0 0 0 0 0] 1.38 transforms 1 get exec
      [2 1 1 4 3 4] [.2 .1 .1 .4 .3 .4] [1 1 1 2 3 4] [0 0 0 0 0 0] 2.56 transforms 2 get exec ] def`, expected: { mapped: [.4, 1.2, 2.4] } },
  { name: "findcolorrendering default substitution", code: `/Perceptual findcolorrendering /exact exch def /selected exch def`, expected: { exact: false, selected: "/DefaultColorRendering" }, diagnostic: "font.postscript-rendering-intent-substituted" },
  { name: "findcolorrendering calls a font-local customized procedure set", code: `
    /ColorRendering /ColorRendering /ProcSet findresource dup length dict copy
      dup /GetPageDeviceName { /FontDisplay } put dup /GetHalftoneName { /FontScreen } put
      dup /GetSubstituteCRD {pop /OtherRendering} put /ProcSet defineresource pop
    /RelativeColorimetric.FontDisplay.FontScreen << ${identity} >> /ColorRendering defineresource pop
    /OtherRendering << ${identity} >> /ColorRendering defineresource pop
    /RelativeColorimetric findcolorrendering /exact exch def /selected exch def
    (UnknownIntent) findcolorrendering /alternateExact exch def /alternate exch def`, expected: { exact: true, selected: "/RelativeColorimetric.FontDisplay.FontScreen", alternateExact: false, alternate: "/OtherRendering" }, diagnostic: "font.postscript-rendering-intent-substituted" }
];
try {
  const { executeNativeFontPostScript } = await import("../src/pdf/nativeFontPostScript.ts");
  const { NativeFontPostScriptGlyphContext } = await import("../src/pdf/nativeFontPostScriptGraphics.ts");
  for (const fixture of fixtures) {
    const context = new NativeFontPostScriptGlyphContext();
    const result = executeNativeFontPostScript(encoder.encode(fixture.code), undefined,
      { glyphContext: context, initialMatrix: [1, 0, 0, 1, 0, 0], initialDictionary: new Map([["FontType", 1]]) });
    for (const [key, value] of Object.entries(fixture.expected ?? {})) close(display(result.dictionary.get(key)), value, fixture.name + ": " + key, 1e-9);
    if (fixture.rgba) close(context.color, fixture.rgba, fixture.name, 2e-6);
    if (fixture.diagnostic) assert(context.diagnostics.some(value => value.code === fixture.diagnostic), fixture.name);
    else assert.equal(context.diagnostics.length, 0, fixture.name);
    if (oracle && !fixture.noOracle) {
      const query = Object.keys(fixture.expected ?? {}).map(key => `/${key} load ==`).join("\n");
      const contract = spawnSync("gs", ["-q", "-dNODISPLAY", "-dBATCH", "-dNOPAUSE", "-c", `100 dict begin ${fixture.code}\n${query}\nquit`], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 10000 });
      assert.ifError(contract.error); assert.equal(contract.status, 0, fixture.name + ": " + contract.stdout + contract.stderr);
      const lines = contract.stdout.trim().split("\n");
      Object.entries(fixture.expected ?? {}).forEach(([key, value], index) => close(parse(lines[index]), value, fixture.name + ": Ghostscript " + key, 1e-5));
    }
  }
  // The loading graphics state is cloned into each glyph, including CRD data
  // and immediate procedure references, while calls within one glyph share it.
  const loaded = executeNativeFontPostScript(encoder.encode(`
    /crd << ${identity} >> def crd setcolorrendering
    /Private << /OtherSubrs [{pop ${source} .2 .4 .6 setcolor crd /EncodeABC [{2 mul} {} {}] put}] >> def
  `), undefined, { initialDictionary: new Map([["FontType", 1]]) });
  const a = new NativeFontPostScriptGlyphContext(), b = new NativeFontPostScriptGlyphContext();
  loaded.createOtherSubrExecutor(undefined, a)(0, [0]);
  loaded.createOtherSubrExecutor(undefined, b)(0, [0]);
  close(a.color, [.2, .4, .6, 1], "first glyph CRD", 1e-9); close(b.color, a.color, "CRD glyph isolation", 1e-9);
  assert.throws(() => executeNativeFontPostScript(encoder.encode(`<< ${identity} /EncodeLMN [{ {} loop } {} {}] >> setcolorrendering ${source}`), undefined,
    { glyphContext: new NativeFontPostScriptGlyphContext(), initialDictionary: new Map([["FontType", 1]]), maxOperations: 300 }), error => error.code === "resource-limit");
  const controller = new AbortController(); controller.abort();
  assert.throws(() => executeNativeFontPostScript(encoder.encode(`currentcolorrendering`), undefined, { signal: controller.signal }), error => error.code === "aborted");
  // Ghostscript 9+ ignores CRDs in its ICC rendering pipeline (Artifex's
  // GhostscriptColorManagement documentation). Its state/resource contracts
  // remain useful oracles; expected conversion vectors above follow PLRM 7.1.
  console.log(`Native font PostScript color-rendering checks passed (${fixtures.length + 3} groups${oracle ? ", Ghostscript state/resource contracts verified" : ""}).`);
} finally { hooks.deregister(); }
function display(value) { return Array.isArray(value) ? value.map(display) : value?.kind === "name" ? "/" + value.value : value; }
function parse(value) { return value?.startsWith("[") ? value.slice(1, -1).trim().split(/\s+/).filter(Boolean).map(parse) : value?.startsWith("/") ? value : value === "true" ? true : value === "false" ? false : Number(value); }
function close(actual, expected, label, tolerance) {
  if (Array.isArray(expected)) { assert(Array.isArray(actual), label); assert.equal(actual.length, expected.length, label); expected.forEach((value, i) => close(actual[i], value, label, tolerance)); }
  else if (typeof expected === "number") assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
  else assert.equal(actual, expected, label);
}
