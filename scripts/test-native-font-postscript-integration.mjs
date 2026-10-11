import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import {
  buildType1Fixture, type1CharString as cs, concatType1Bytes, encryptType1Bytes
} from "./lib/type1Fixture.mjs";

// Operator semantics and font dictionary execution follow Adobe PLRM3 chapters
// 3/8 and Adobe5176 AppendixF. Expected glyph coordinates below are explicit,
// independent of the VM. --ghostscript also checks the PS values with GS.
// https://www.adobe.com/jp/print/postscript/pdfs/PLRM.pdf
// https://adobe-type-tools.github.io/font-tech-notes/pdfs/5176.CFF.pdf
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const encoder = new TextEncoder();
const expectGhostscript = process.argv.includes("--ghostscript");
try {
  const { NativeType1Font } = await import("../src/pdf/nativeType1.ts");
  const { NativeCffFont } = await import("../src/pdf/nativeCff.ts");
  const { parseNativePdfFont } = await import("../src/pdf/nativeFont.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const at = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  const first = font => font.getGlyphOutline(font.glyphIdForName("A")).commands[0];
  const parseType1 = code => NativeType1Font.parse(buildType1Fixture({clearExtra: code}).bytes);
  const matrixCases = [
    ["explicit stop", "{ stop } stopped { /FontMatrix [.002 0 0 .003 0 0] def } if", [100, 0]],
    ["normal stopped completion", "{ /FontMatrix [.002 0 0 .003 0 0] def } stopped { stop } if", [100, 0]],
    ["catchable language error", "{ 1 0 div } stopped { pop pop /FontMatrix [.002 0 0 .003 0 0] def } if", [100, 0]],
    ["nested stop", "{ { stop } stopped { /FontMatrix [.002 0 0 .003 0 0] def } if } stopped { stop } if", [100, 0]],
    ["save dictionary rollback", "save /FontMatrix [.009 0 0 .009 0 0] def restore", [50, 0]],
    ["save array rollback", "/FontMatrix FontMatrix 6 array copy def save FontMatrix 0 .009 put restore", [50, 0]],
    ["numeric string conversion", "/FontMatrix [(.002) cvr 0 0 (3e-3) cvr 0 0] def", [100, 0]],
    ["immediate name lookup", "/computedMatrix [.002 0 0 .003 0 0] def /FontMatrix //computedMatrix def", [100, 0]],
    ["ASCII85 numeric string conversion", "/FontMatrix [<~/het7~> cvr 0 0 <~/het8~> cvr 0 0] def", [100, 0]],
    ["dictionary stack lookup", "countdictstack array dictstack dup length 1 sub get /FontMatrix [.002 0 0 .003 0 0] put", [100, 0]],
    ["missing font resource fallback", "/NotARegisteredIntegrationFont /Font resourcestatus { pop pop } { /FontMatrix [.002 0 0 .003 0 0] def } ifelse", [100, 0]],
    ["explicit scale matrix", "/FontMatrix 2 3 matrix scale [.001 0 0 .001 0 0] matrix concatmatrix def", [100, 0]]
  ];
  for (const [label, code, expected] of matrixCases) {
    const font = parseType1(code), point = first(font);
    at(point.x, expected[0]); at(point.y, expected[1]);
    assert.deepEqual(font.diagnostics, [], label);
    if (expectGhostscript) {
      const matrix = oracleMatrix(code);
      at(matrix[0] * 50 * 1000 + matrix[4] * 1000, expected[0]);
      at(matrix[1] * 50 * 1000 + matrix[5] * 1000, expected[1]);
    }
  }
  const encodingCode = "/Encoding Encoding 256 array copy def " +
    "Encoding (16#41) token pop exch pop /B 8 string cvs cvn put " +
    "Encoding 65 16 8 string cvrs cvi /A put";
  const encoded = parseType1(encodingCode);
  assert.equal(encoded.builtInGlyphNames[65], "B", "token parses radix code and cvs/cvn preserve the glyph name");
  assert.equal(encoded.builtInGlyphNames[41], "A", "cvrs emits radix text and cvi converts that text");
  assert.deepEqual(encoded.diagnostics, []);
  if (expectGhostscript) assert.equal(oracle(encodingCode + " Encoding 65 get == Encoding 41 get =="), "/B\n/A");

  const replacement = cs(0, 500, "hsbw", 100, 50, "rmoveto", 200, 0, "rlineto", 0, 300, "rlineto", "closepath", "endchar");
  const fixture = buildType1Fixture({ lenIV: -1 });
  const computedBytes = amendPrivate(fixture,
    `dup begin CharStrings /A (<${Buffer.from(replacement).toString("hex")}>) token pop exch pop put end`, true);
  const computedGlyph = NativeType1Font.parse(computedBytes);
  assert.deepEqual(computedGlyph.getGlyphOutline(computedGlyph.glyphIdForName("A")).commands, [
    {kind:"move", x:100, y:50}, {kind:"line", x:300, y:50}, {kind:"line", x:300, y:350}, {kind:"close"}
  ], "token-built byte strings replace the actual CharStrings program");
  assert.deepEqual(computedGlyph.diagnostics, []);
  const ascii85Fixture=buildType1Fixture({clearExtra:"/FontMatrix [<~/het7~> cvr 0 0 <~/het8~> cvr 0 0] def"});
  assert.equal(first(NativeType1Font.parse(ascii85Fixture.bytes,{},
    {length1:ascii85Fixture.length1,length2:ascii85Fixture.length2})).x,100,
    "framed Type1 loaders reach the VM after decoding cleartext ASCII85 literals");
  const tinyAscii85Fixture=buildType1Fixture({lenIV:-1,glyphs:[[".notdef",cs(0,0,"hsbw","endchar")]],
    clearExtra:"/Unused <~/het7~> def"});
  assert.equal(NativeType1Font.parse(tinyAscii85Fixture.bytes,{maxType1StringBytes:4}).numGlyphs,1,
    "ASCII85 string allowance counts decoded bytes rather than encoded source bytes");
  assert.throws(()=>NativeType1Font.parse(buildType1Fixture({clearExtra:"/Unused <~zz~> def"}).bytes,
    {maxType1StringBytes:4}),error=>error instanceof PdfError&&error.code==="resource-limit");
  assert.throws(()=>NativeType1Font.parse(encoder.encode("%!PS\n/Unused <~z")),
    error=>error instanceof PdfError&&/ASCII85.*unterminated/.test(error.message));

  const otherProgram = cs(0, 500, "hsbw", 0, 0, "rmoveto", 11, 1, 4, "callothersubr", "pop", 0, "rlineto", "endchar");
  const customCases = [
    ["stopped inside OtherSubr", "", "{ { stop } stopped { 2 mul } if }", 22],
    ["save/restore inside OtherSubr", "/state [2] def", "{ save state 0 9 put restore state 0 get add }", 13],
    ["numeric strings inside OtherSubr", "", "{ (2) cvi mul }", 22],
    ["matrix transforms inside OtherSubr", "", "{ 0 [2 0 0 3 0 0] dtransform pop }", 22],
    ["font resource lookup inside OtherSubr", "", "{ /FixtureType1 /Font findresource /FontMatrix get 0 get 2000 mul mul }", 22]
  ];
  for (const [label, extra, procedure, expected] of customCases) {
    const font = NativeType1Font.parse(buildType1Fixture({
      glyphs:[[".notdef",cs(0,500,"hsbw","endchar")],["A",otherProgram]],
      privateExtra: `${extra} /OtherSubrs [{} {} {} {} ${procedure}] def`
    }).bytes);
    assert.equal(font.getGlyphOutline(font.glyphIdForName("A")).commands[1].x, expected, label);
    assert.deepEqual(font.diagnostics, [], label);
  }

  const cffCode = "{ stop } stopped { /FontMatrix [(.002) cvr 0 0 (.003) cvr 0 0] def } if";
  const cff = NativeCffFont.parse(buildCff(cffCode));
  assert.deepEqual(cff.getGlyphOutline(1).commands[0], {kind:"move",x:200,y:150});
  assert.deepEqual(cff.diagnostics, [], "CFF AppendixF uses the same expanded font-local language");
  const resolver={async resolveValue(value){return value;},async decodeStream(value){return value.bytes;}};
  const name=value=>({kind:"name",value});
  const pdfFont=async(bytes,subtype,framing={})=>parseNativePdfFont(new Map([
    ["Subtype",name("Type1")],["BaseFont",name("IntegrationFont")],["FirstChar",65],["Widths",[500]],
    ["FontDescriptor",new Map([["Flags",32],[subtype?"FontFile3":"FontFile",{
      kind:"stream",dictionary:new Map([...(subtype?[["Subtype",name(subtype)]]:[]),...Object.entries(framing)]),bytes
    }]])]
  ]),resolver);
  const pdfType1=await pdfFont(computedBytes);
  assert.deepEqual(pdfType1.getGlyphOutline(pdfType1.decode(Uint8Array.of(65)).glyphId).commands,
    computedGlyph.getGlyphOutline(computedGlyph.glyphIdForName("A")).commands);
  assert.equal(pdfType1.substitution,null,"PDF font integration uses computed original Type1 programs");
  const pdfAscii85=await pdfFont(ascii85Fixture.bytes,undefined,{Length1:ascii85Fixture.length1,Length2:ascii85Fixture.length2});
  assert.equal(pdfAscii85.substitution,null,"PDF FontFile parsing reaches expanded cleartext literal syntax");
  assert.equal(pdfAscii85.getGlyphOutline(pdfAscii85.decode(Uint8Array.of(65)).glyphId).commands[0].x,100);
  const wrappedFixture=buildType1Fixture({clearExtra:"/FontMatrix [.002 0 0 .003 0 0] def"});
  const wrappedCleartext=encoder.encode(Buffer.from(wrappedFixture.cleartext).toString("latin1")
    .replace("currentfile eexec\n","{ currentfile eexec } exec\n"));
  const wrappedTrailer=wrappedFixture.bytes.subarray(wrappedFixture.length1+wrappedFixture.length2);
  const wrappedBytes=concatType1Bytes(wrappedCleartext,wrappedFixture.encrypted,wrappedTrailer);
  const wrappedFraming={length1:wrappedCleartext.length,length2:wrappedFixture.encrypted.length};
  const wrappedType1=NativeType1Font.parse(wrappedBytes,{},wrappedFraming);
  assert.equal(first(wrappedType1).x,100,"explicit cleartext framing preserves procedure-wrapped eexec");
  assert.deepEqual(wrappedType1.diagnostics,[]);
  assert.deepEqual(first(NativeType1Font.parse(wrappedBytes,{}, {length1:wrappedFraming.length1})),first(wrappedType1),
    "explicit cleartext framing also works when encrypted length is omitted");
  const wrappedPfb=concatType1Bytes(pfbRecord(1,wrappedCleartext.subarray(0,37)),pfbRecord(1,wrappedCleartext.subarray(37)),
    pfbRecord(2,wrappedFixture.encrypted),pfbRecord(1,wrappedTrailer),Uint8Array.of(128,3));
  assert.deepEqual(first(NativeType1Font.parse(wrappedPfb)),first(wrappedType1),"PFB segment boundaries frame wrapped eexec");
  const pdfWrappedType1=await pdfFont(wrappedBytes,undefined,{Length1:wrappedFraming.length1,Length2:wrappedFraming.length2});
  assert.equal(pdfWrappedType1.substitution,null,"PDF FontFile lengths preserve computed encrypted loaders");
  assert.equal(pdfWrappedType1.getGlyphOutline(pdfWrappedType1.decode(Uint8Array.of(65)).glyphId).commands[0].x,100);
  const pdfCff=await pdfFont(buildCff(cffCode),"Type1C");
  assert.deepEqual(pdfCff.getGlyphOutline(pdfCff.decode(Uint8Array.of(65)).glyphId).commands,cff.getGlyphOutline(1).commands);
  assert.equal(pdfCff.substitution,null,"PDF FontFile3 integration uses computed original CFF programs");
  const cffGlyph = NativeCffFont.parse(buildCff(
    `CharStrings /A (<${Buffer.from(Uint8Array.of(189,239,21,239,139,5,14)).toString("hex")}>) token pop exch pop put`
  ));
  assert.deepEqual(cffGlyph.getGlyphOutline(1).commands[0], {kind:"move",x:50,y:100});
  assert.deepEqual(cffGlyph.diagnostics, [], "CFF AppendixF computed CharStrings remain byte programs");
  const cffOther = NativeCffFont.parse(buildCff("/OtherSubrs [{} {} {} {} { (2) cvi mul }] def", otherProgram, true));
  assert.equal(cffOther.getGlyphOutline(1).commands[1].x, 22);
  assert.deepEqual(cffOther.diagnostics, []);

  // A caught PostScript stop never catches host cancellation or caller limits.
  assert.throws(() => NativeType1Font.parse(buildType1Fixture({clearExtra:"{ {} loop } stopped pop"}).bytes,
    {maxType1PostScriptOperations:200}), error => error instanceof PdfError && error.code === "resource-limit");
  const controller = new AbortController(); controller.abort();
  assert.throws(() => NativeType1Font.parse(buildType1Fixture({clearExtra:"{ stop } stopped pop"}).bytes,
    {}, {signal:controller.signal}), error => error instanceof PdfError && error.code === "aborted");

  const opaque = parseType1("unsupported_integration_loader_operator");
  assert.equal(first(opaque).x, 50, "unsupported loaders retain declarative geometry");
  assert.equal(opaque.diagnostics[0].details.operator, "unsupported_integration_loader_operator");
  assert.throws(() => parseType1("/FontMatrix unsupported_integration_expression_operator def"),
    error => error instanceof PdfError && error.details.operator === "unsupported_integration_expression_operator");
  const cffOpaque = NativeCffFont.parse(buildCff("unsupported_integration_cff_operator"));
  assert.equal(cffOpaque.getGlyphOutline(1).commands[0].x, 100);
  assert.equal(cffOpaque.diagnostics[0].details.operator, "unsupported_integration_cff_operator");
  const cidOpaque = NativeCffFont.parse(buildCidCff("/FSType 8 def", "unsupported_integration_fd_operator"));
  assert.equal(cidOpaque.getGlyphOutline(1).commands[0].x, 100);
  assert.equal(cidOpaque.diagnostics[0].details.operator, "unsupported_integration_fd_operator");
  assert.equal(cidOpaque.diagnostics[0].details.fontDictionaryIndex, 0);
  const bothOpaque=NativeCffFont.parse(buildCidCff("unsupported_integration_top_operator","unsupported_integration_fd_operator"));
  assert.equal(bothOpaque.diagnostics.length,1);
  assert.equal(bothOpaque.diagnostics[0].details.operator,"unsupported_integration_top_operator");
  assert.equal(bothOpaque.diagnostics[0].details.fontDictionaryPostScriptOperator,"unsupported_integration_fd_operator");
  const unknownOtherSubr = NativeType1Font.parse(buildType1Fixture({
    glyphs:[[".notdef",cs(0,500,"hsbw","endchar")],["A",otherProgram]],
    privateExtra:"/OtherSubrs [{} {} {} {} { unsupported_integration_other_operator }] def"
  }).bytes);
  assert.equal(unknownOtherSubr.getGlyphOutline(1).commands[1].x, 11);
  assert.equal(unknownOtherSubr.diagnostics[0].details.operator,"unsupported_integration_other_operator");
  const cffUnknownOther = NativeCffFont.parse(buildCff(
    "/OtherSubrs [{} {} {} {} { unsupported_integration_other_operator }] def",otherProgram,true));
  assert.equal(cffUnknownOther.getGlyphOutline(1).commands[1].x,11);
  assert.equal(cffUnknownOther.diagnostics[0].details.operator,"unsupported_integration_other_operator");
  console.log(`Native font PostScript integration checks passed${expectGhostscript ? " with Ghostscript value oracles" : ""}.`);
} finally { hooks.deregister(); }

function oracle(code) {
  const result = spawnSync("gs", ["-q", "-dNODISPLAY", "-dBATCH", "-dNOPAUSE", "-c",
    `/FontMatrix [.001 0 0 .001 0 0] readonly def /Encoding StandardEncoding 256 array copy def\n${code}\nquit`],
    {stdio:["ignore","pipe","pipe"],encoding:"utf8", timeout:10000});
  assert.ifError(result.error); assert.equal(result.status,0,result.stdout+result.stderr);
  return result.stdout.trim();
}
function oracleMatrix(code) { return oracle(code+" FontMatrix { 20 string cvs print ( ) print } forall").split(/\s+/).map(Number); }
function amendPrivate(fixture, code, mutableCharStrings=false) {
  let plain = Buffer.from(fixture.privatePlaintext).toString("latin1");
  if (mutableCharStrings) plain=plain.replace("end readonly put\nend readonly put", "end put\nend readonly put");
  plain=plain.replace("dup /FontName get exch definefont pop", code+"\ndup /FontName get exch definefont pop");
  const encrypted=encryptType1Bytes(concatType1Bytes(new Uint8Array(4),Uint8Array.from(plain,char=>char.charCodeAt(0))),55665);
  return concatType1Bytes(fixture.cleartext,encrypted,`\n${"0".repeat(512)}\ncleartomark\n`);
}
function cat(...parts) { return Uint8Array.from(parts.flatMap(part=>[...(typeof part==="string"?encoder.encode(part):part)])); }
function pfbRecord(kind,bytes) {
  return concatType1Bytes(Uint8Array.of(128,kind,bytes.length&255,(bytes.length>>>8)&255,(bytes.length>>>16)&255,(bytes.length>>>24)&255),bytes);
}
function dictInt(value) { return Uint8Array.of(29,(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255); }
function index(objects) {
  if(!objects.length)return Uint8Array.of(0,0);
  let at=1;const offsets=[at];for(const object of objects)offsets.push(at+=object.length);
  const size=at>255?2:1;
  return cat([objects.length>>>8,objects.length&255,size],...offsets.map(value=>size===1?[value]:[value>>>8,value&255]),...objects);
}
function buildCff(code, glyph=Uint8Array.of(239,189,21,239,139,5,14), type1=false) {
  const header=Uint8Array.of(1,0,4,4),names=index([encoder.encode("IntegrationCFF")]),strings=index([encoder.encode(code)]),globals=index([]);
  const encoding=Uint8Array.of(0,1,65),charset=Uint8Array.of(0,0,34);
  const chars=index([type1?cs(0,500,"hsbw","endchar"):Uint8Array.of(14),glyph]);
  const priv=cat(dictInt(500),[20]);
  const top=(enc,set,program,privateOffset)=>cat(dictInt(391),[12,21],...(type1?[dictInt(1),[12,6]]:[]),dictInt(enc),[16],dictInt(set),[15],dictInt(program),[17],dictInt(priv.length),dictInt(privateOffset),[18]);
  const start=header.length+names.length+index([top(0,0,0,0)]).length+strings.length+globals.length;
  const topBytes=top(start,start+encoding.length,start+encoding.length+charset.length,start+encoding.length+charset.length+chars.length);
  return cat(header,names,index([topBytes]),strings,globals,encoding,charset,chars,priv);
}
function buildCidCff(topCode, fdCode) {
  const header=Uint8Array.of(1,0,4,4),names=index([encoder.encode("IntegrationCID")]);
  const strings=index([topCode,fdCode,"Adobe","Identity"].map(value=>encoder.encode(value))),globals=index([]);
  const charset=Uint8Array.of(0,0,42),select=Uint8Array.of(0,0,0);
  const chars=index([Uint8Array.of(14),Uint8Array.of(239,189,21,239,139,5,14)]),priv=cat(dictInt(500),[20]);
  const fd=offset=>cat(dictInt(392),[12,21],dictInt(priv.length),dictInt(offset),[18]);
  const top=(set,sel,glyphs,fds)=>cat(dictInt(393),dictInt(394),dictInt(0),[12,30],dictInt(391),[12,21],
    dictInt(set),[15],dictInt(sel),[12,37],dictInt(glyphs),[17],dictInt(fds),[12,36]);
  const start=header.length+names.length+index([top(0,0,0,0)]).length+strings.length+globals.length;
  const fdOffset=start+charset.length+select.length+chars.length,privateOffset=fdOffset+index([fd(0)]).length;
  return cat(header,names,index([top(start,start+charset.length,start+charset.length+select.length,fdOffset)]),
    strings,globals,charset,select,chars,index([fd(privateOffset)]),priv);
}
