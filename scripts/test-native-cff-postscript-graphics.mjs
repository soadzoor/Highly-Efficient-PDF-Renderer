import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {type1CharString as cs} from "./lib/type1Fixture.mjs";

const hooks=registerHooks({resolve(specifier,context,next){
  return next(context.parentURL?.includes("/src/")&&/^\.\.?\//.test(specifier)&&!specifier.endsWith(".ts")?specifier+".ts":specifier,context);
}});
const encoder=new TextEncoder();
const triangle=side=>cs(side,500,"hsbw",0,0,"rmoveto",100,0,"rlineto",0,100,"rlineto",0,4,"callothersubr","endchar");
const glyphs=[[".notdef",cs(0,500,"hsbw","endchar")],["A",triangle(0)]];
try{
  const{NativeCffFont}=await import("../src/pdf/nativeCff.ts");
  const{parseNativePdfFont}=await import("../src/pdf/nativeFont.ts");
  const{PdfError}=await import("../src/pdf/nativeTypes.ts");
  const font=NativeCffFont.parse(build(`/FontMatrix [.002 0 0 .003 .01 -.02] def
    /OtherSubrs [{} {} {} {} { 1 0 0 setrgbcolor closepath fill }] def`));
  const outline=font.getGlyphOutline(1),paint=outline.postScriptPaints[0];
  assert.deepEqual(outline.commands,[],"explicit fill clears the charstring path without discarding painted geometry");
  assert.equal(paint.kind,"fill");assert.equal(paint.fillRule,0);assert.deepEqual(paint.color,[1,0,0,1]);
  assert.deepEqual(paint.commands,[{kind:"move",x:10,y:-20},{kind:"line",x:210,y:-20},
    {kind:"line",x:210,y:280},{kind:"close"}]);
  assert.deepEqual(outline.bounds,[10,-20,210,280]);assert.equal(outline.advanceWidth,1000);
  assert.deepEqual(font.getGlyphOutline(1,undefined,false).postScriptPaints,outline.postScriptPaints,
    "PDF PaintType policy does not remove explicit OtherSubr paints");
  assert.deepEqual(font.diagnostics,[]);

  const strokeFont=NativeCffFont.parse(build(`/OtherSubrs [{} {} {} {} {
    gsave 0 0 40 40 rectclip newpath 10 20 moveto 30 40 lineto
    0 setlinewidth [3 2] 1 setdash 1 setlinecap 2 setlinejoin 2 setmiterlimit
    0 1 0 setrgbcolor stroke grestore newpath
  }] def`));
  const strokeOutline=strokeFont.getGlyphOutline(1);
  assert(strokeOutline.postScriptPaints,JSON.stringify(strokeFont.diagnostics));
  const stroke=strokeOutline.postScriptPaints[0];
  assert.equal(stroke.kind,"stroke");assert.equal(stroke.stroke.width,0);assert.equal(stroke.stroke.lineCap,1);
  assert.equal(stroke.stroke.lineJoin,2);assert.equal(stroke.stroke.miterLimit,2);
  assert.deepEqual(stroke.stroke.dashArray,[3,2]);assert.equal(stroke.stroke.dashPhase,1);
  assert.deepEqual(stroke.stroke.transform,[1,0,0,1,0,0]);assert.deepEqual(stroke.color,[0,1,0,1]);
  assert.equal(stroke.clips.length,1);assert.equal(stroke.clips[0].fillRule,0);
  assert.deepEqual(stroke.commands,[{kind:"move",x:10,y:20},{kind:"line",x:30,y:40}]);

  const curved=NativeCffFont.parse(build(`/OtherSubrs [{} {} {} {} { newpath 0 0 20 0 90 arc fill }] def`));
  const curvedOutline=curved.getGlyphOutline(1);
  assert(curvedOutline.postScriptPaints[0].commands.some(command=>command.kind==="cubic"));
  assert.equal(curved.diagnostics.filter(item=>item.code==="font.postscript-arc-approximation").length,1);
  curved.getGlyphOutline(1,undefined,false);
  assert.equal(curved.diagnostics.filter(item=>item.code==="font.postscript-arc-approximation").length,1);

  const compositeGlyphs=[...glyphs,["acute",triangle(20)],
    ["Aacute",cs(0,500,"hsbw",0,200,300,65,194,"seac")]];
  const composite=NativeCffFont.parse(build(`/FontMatrix [.002 0 0 .003 0 0] def
    /OtherSubrs [{} {} {} {} { closepath fill }] def`,compositeGlyphs));
  const combined=composite.getGlyphOutline(3);
  assert.equal(combined.postScriptPaints.length,2);
  assert.deepEqual(combined.postScriptPaints.map(record=>record.commands[0]),
    [{kind:"move",x:0,y:0},{kind:"move",x:440,y:900}],"seac translates accent paints before FontMatrix");
  assert.deepEqual(combined.bounds,[0,0,640,1200]);
  assert.throws(()=>NativeCffFont.parse(build(`/OtherSubrs [{} {} {} {} { closepath fill }] def`,compositeGlyphs),
    {maxType2PathCommands:7}).getGlyphOutline(3),error=>error instanceof PdfError&&error.code==="resource-limit",
    "composite paint records share the caller's aggregate path allowance");

  const finalFont=NativeCffFont.parse(build(`/FontMatrix [.002 0 0 .003 .01 -.02] def
    /OtherSubrs [{} {} {} {} {
      1 0 0 setrgbcolor 0 0 60 60 rectclip
      0 0 moveto 100 0 rlineto 0 100 rlineto 2 setlinejoin
    }] def`));
  const finalOutline=finalFont.getGlyphOutline(1,undefined,false);
  assert.equal(finalOutline.commands.length,4,"final implicit paint retains its independent raw outline");
  assert.equal(finalOutline.postScriptPaints,undefined,"changing final paint state does not add an explicit mark");
  assert.deepEqual(finalOutline.postScriptFinalState.color,[1,0,0,1]);
  assert.deepEqual(finalOutline.postScriptFinalState.clips[0].commands[0],{kind:"move",x:10,y:-20});
  assert.deepEqual(finalOutline.postScriptFinalState.stroke.transform,[2,0,0,3,10,-20]);
  assert.deepEqual(finalOutline.postScriptFinalState.changedStrokeFields,["lineJoin"]);
  assert.throws(()=>NativeCffFont.parse(build(`/OtherSubrs [{} {} {} {} { 0 0 60 60 rectclip }] def`),
    {maxType2PathCommands:7}).getGlyphOutline(1),error=>error instanceof PdfError&&error.code==="resource-limit",
    "final-only clips share the caller's path allowance");

  const finalComposite=NativeCffFont.parse(build(`/PaintType 2 def /StrokeWidth 10 def
    /FontMatrix [.002 0 0 .003 .01 -.02] def
    /OtherSubrs [{} {} {} {} {
      /left currentpoint pop 100 sub def
      currentpoint pop 110 lt {1 0 0}{0 0 1} ifelse setrgbcolor
      0 0 60 60 rectclip left 0 moveto 100 0 rlineto 0 100 rlineto 2 setlinejoin
    }] def`,compositeGlyphs));
  const pdfComposite=finalComposite.getGlyphOutline(3,undefined,false);
  assert.equal(pdfComposite.commands.length,8,"composite raw paths remain available for PDF text stroke/clip");
  assert.equal(pdfComposite.postScriptFinalState.omitFinalPaint,true);
  assert.deepEqual(pdfComposite.postScriptPaints.map(record=>record.kind),["fill","fill"]);
  assert.deepEqual(pdfComposite.postScriptPaints.map(record=>record.color),[[1,0,0,1],[0,0,1,1]]);
  assert.deepEqual(pdfComposite.postScriptPaints.map(record=>record.commands[0]),
    [{kind:"move",x:10,y:-20},{kind:"move",x:450,y:880}]);
  assert.deepEqual(pdfComposite.postScriptPaints.map(record=>record.clips[0].commands[0]),
    [{kind:"move",x:10,y:-20},{kind:"move",x:410,y:880}]);
  const fontComposite=finalComposite.getGlyphOutline(3);
  assert.deepEqual(fontComposite.postScriptPaints.map(record=>record.kind),["stroke","stroke"],
    "component final paints are materialized separately for the font PaintType policy");
  assert.deepEqual(fontComposite.postScriptPaints.map(record=>record.stroke.width),[10,10]);
  assert.deepEqual(fontComposite.postScriptPaints.map(record=>record.changedStrokeFields),
    [["width","lineJoin"],["width","lineJoin"]]);

  const parentStateGlyphs=[...compositeGlyphs.slice(0,3),["Aacute",cs(0,500,"hsbw",0,5,"callothersubr",0,200,300,65,194,"seac")]];
  const parentState=NativeCffFont.parse(build(`/OtherSubrs [{} {} {} {} {
    0 0 60 60 rectclip 0 0 moveto 100 0 rlineto 0 100 rlineto
  } { 0 0 10 10 rectclip }] def`,parentStateGlyphs));
  assert.equal(parentState.getGlyphOutline(3).postScriptPaints.length,2);
  parentState.getGlyphOutline(3,undefined,false);
  assert.equal(parentState.diagnostics.filter(diagnostic=>diagnostic.code==="font.type1-seac-state-approximated").length,1,
    "parent/component state inheritance approximations are visible and deduplicated");

  const name=value=>({kind:"name",value});
  const bytes=build(`/OtherSubrs [{} {} {} {} { 1 0 0 setrgbcolor closepath fill }] def`);
  const resolver={async resolveValue(value){return value;},async decodeStream(value){return value.bytes;}};
  const pdf=await parseNativePdfFont(new Map([["Subtype",name("Type1")],["BaseFont",name("GraphicsCFF")],
    ["FirstChar",65],["Widths",[500]],["FontDescriptor",new Map([["Flags",32],["FontFile3",{
      kind:"stream",dictionary:new Map([["Subtype",name("Type1C")]]),bytes
    }]])]]),resolver);
  assert.equal(pdf.substitution,null);assert.deepEqual(pdf.getGlyphOutline(pdf.decode(Uint8Array.of(65)).glyphId).postScriptPaints[0].color,[1,0,0,1]);
  console.log("Native CFF PostScript glyph graphics checks passed.");
}finally{hooks.deregister();}

function cat(...parts){return Uint8Array.from(parts.flatMap(part=>[...part]));}
function integer(value){return Uint8Array.of(29,(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255);}
function index(objects){
  if(!objects.length)return Uint8Array.of(0,0);let offset=1;const offsets=[offset];
  for(const object of objects)offsets.push(offset+=object.length);const size=offset>255?2:1;
  return cat([objects.length>>>8,objects.length&255,size],...offsets.map(value=>size===1?[value]:[value>>>8,value&255]),...objects);
}
function build(code,programs=glyphs){
  const header=Uint8Array.of(1,0,4,4),names=index([encoder.encode("GraphicsCFF")]);
  const strings=index([code,...programs.slice(1).map(([name])=>name)].map(value=>encoder.encode(value))),globals=index([]);
  const encoding=Uint8Array.of(0,programs.length-1,...programs.slice(1).map((_,i)=>i===0?65:i===1?194:66));
  const charset=cat([0],...programs.slice(1).map((_,i)=>[(392+i)>>>8,(392+i)&255]));
  const chars=index(programs.map(([,program])=>program)),priv=cat(integer(500),[20]);
  const top=(enc,set,program,privateOffset)=>cat(integer(391),[12,21],integer(1),[12,6],integer(enc),[16],
    integer(set),[15],integer(program),[17],integer(priv.length),integer(privateOffset),[18]);
  const start=header.length+names.length+index([top(0,0,0,0)]).length+strings.length+globals.length;
  return cat(header,names,index([top(start,start+encoding.length,start+encoding.length+charset.length,
    start+encoding.length+charset.length+chars.length)]),strings,globals,encoding,charset,chars,priv);
}
