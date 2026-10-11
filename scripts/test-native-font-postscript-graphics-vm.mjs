import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {spawnSync} from "node:child_process";

// PLRM3 chapters 4/8; the explicit identity CTM avoids dependence on a host
// device. --ghostscript checks observable path/style/color values independently.
// https://www.adobe.com/jp/print/postscript/pdfs/PLRM.pdf
const hooks=registerHooks({resolve(specifier,context,next){
  return next(context.parentURL?.includes("/src/")&&/^\.\.?\//.test(specifier)&&!specifier.endsWith(".ts")?specifier+".ts":specifier,context);
}});
const encoder=new TextEncoder(),useOracle=process.argv.includes("--ghostscript");
const cases=[
  {name:"device color spaces and component operators",code:`
    [/DeviceCMYK] setcolorspace /initial [currentcolor] def
    .1 .2 .3 .4 setcolor /components [currentcolor] def
    /space currentcolorspace 0 get def /spaceGlobal currentcolorspace gcheck def
    /spaceWritable currentcolorspace wcheck def
    /saved save def currentcolorspace 0 /DeviceRGB put saved restore
    /restoredSpace currentcolorspace 0 get def
  `,expect:{initial:[0,0,0,1],components:[.1,.2,.3,.4],space:"/DeviceCMYK",spaceGlobal:false,spaceWritable:true,restoredSpace:"/DeviceCMYK"}},
  {name:"graphics language errors remain exact through stopped",code:`
    { newpath currentpoint } stopped pop /noPoint $error /errorname get def clear
    { -1 setlinecap } stopped pop /badCap $error /errorname get def clear
    { [0 0] 0 setdash } stopped pop /badDash $error /errorname get def clear
    { newpath 0 0 -1 0 90 arc } stopped pop /badArc $error /errorname get def clear
  `,expect:{noPoint:"/nocurrentpoint",badCap:"/rangecheck",badDash:"/rangecheck",badArc:"/rangecheck"}},
  {name:"pathforall order and operands",code:`
    newpath 1 2 moveto 3 4 lineto 5 6 7 8 9 10 curveto closepath
    /records 4 array def /cursor 0 def /record { records cursor 3 -1 roll put /cursor cursor 1 add def } def
    {2 array astore record} {2 array astore record} {6 array astore record} {[] record} pathforall
    /pathPoint [currentpoint] def
  `,expect:{records:[[1,2],[3,4],[5,6,7,8,9,10],[]],pathPoint:[1,2]}},
  {name:"exit terminates pathforall without changing path",code:`
    newpath 1 2 moveto 3 4 lineto 5 6 7 8 9 10 curveto closepath
    /visits 0 def
    {pop pop /visits visits 1 add def} {pop pop /visits visits 1 add def exit}
    {pop pop pop pop pop pop /visits 99 def} {/visits 99 def} pathforall
    /pathPoint [currentpoint] def
    { exit } stopped pop /outsideExit $error /errorname get def clear
  `,expect:{visits:2,pathPoint:[1,2],outsideExit:"/invalidexit"}},
  {name:"currentpoint follows CTM changes",code:`
    newpath 10 20 moveto 2 4 scale /scaled [currentpoint] def
    1 2 rmoveto /relative [currentpoint] def 90 rotate /rotated [currentpoint] def
  `,expect:{scaled:[5,5],relative:[6,7],rotated:[7,-6]}},
  {name:"gsave and restore retain device paints while restoring graphics state",code:`
    newpath 1 2 moveto 3 4 lineto 2 setlinewidth 1 0 0 setrgbcolor
    /saved save def
      100 200 translate newpath 0 0 moveto 10 0 lineto 9 setlinewidth 0 1 0 setrgbcolor stroke
    saved restore
    /restoredPoint [currentpoint] def /restoredMatrix matrix currentmatrix def
    /restoredWidth currentlinewidth def /restoredColor [currentrgbcolor] def
    gsave newpath 20 30 moveto 40 30 lineto 0 0 1 setrgbcolor stroke grestore
    /afterGrestore [currentpoint] def /afterColor [currentrgbcolor] def
  `,expect:{restoredPoint:[3,4],restoredMatrix:[1,0,0,1,0,0],restoredWidth:2,restoredColor:[1,0,0],
    afterGrestore:[3,4],afterColor:[1,0,0]},paints:2},
  {name:"current line style and clipping restoration",code:`
    2.5 setlinewidth 2 setlinecap 1 setlinejoin 4 setmiterlimit [5 2] 3 setdash
    /width currentlinewidth def /cap currentlinecap def /join currentlinejoin def /miter currentmiterlimit def
    currentdash /phase exch def /dash exch def
    newpath 0 0 moveto 20 0 lineto 20 20 lineto closepath clip
    gsave newpath 0 0 moveto 10 0 lineto 10 10 lineto closepath eoclip
      newpath 1 1 moveto 2 2 lineto stroke
    grestore newpath 3 3 moveto 4 4 lineto stroke
  `,expect:{width:2.5,cap:2,join:1,miter:4,dash:[5,2],phase:3},paints:2},
  {name:"gray and RGB current colors",code:`
    .25 setgray /grayRGB [currentrgbcolor] def /grayValue currentgray def
    1 .5 0 setrgbcolor /rgb [currentrgbcolor] def /rgbGray currentgray def
    /rgbCMYK [currentcmykcolor] def /rgbHSB [currenthsbcolor] def
    1.5 setgray /clippedGray currentgray def
  `,expect:{grayRGB:[.25,.25,.25],grayValue:.25,rgb:[1,.5,0],rgbGray:.595,
    rgbCMYK:[0,.5,1,0],rgbHSB:[1/12,1,1],clippedGray:1}},
  {name:"CMYK and HSB original component preservation",code:`
    .1 .2 .3 .4 setcmykcolor /cmyk [currentcmykcolor] def
    .5 .8 .9 sethsbcolor /hsb [currenthsbcolor] def /hsbRGB [currentrgbcolor] def
    gsave .25 setgray grestore /restoredHSB [currenthsbcolor] def
  `,expect:{cmyk:[.1,.2,.3,.4],hsb:[.5,.8,.9],hsbRGB:[.18,.9,.9],restoredHSB:[.5,.8,.9]}},
  {name:"planar procedure source call order and exact byte cursor",code:`
    /source <102030405060708090A0B0C0FF> /ReusableStreamDecode filter def
    /calls 6 array def /cursor 0 def
    /record { calls cursor 3 -1 roll put /cursor cursor 1 add def } def
    /red 2 string def /green 2 string def /blue 2 string def
    2 2 8 [1 0 0 1 0 0]
      {1 record source red readstring pop}
      {2 record source green readstring pop}
      {3 record source blue readstring pop}
      true 3 colorimage
    /nextByte source read pop def
  `,expect:{calls:[1,2,3,1,2,3],cursor:6,nextByte:255},paints:1},
  {name:"explicit strokes preserve unspecified invoking styles",code:`
    newpath 0 0 moveto 10 0 lineto stroke
    gsave 2 setlinecap [3 2] 1 setdash newpath 0 10 moveto 10 10 lineto stroke grestore
    newpath 0 20 moveto 10 20 lineto stroke /completed true def
  `,expect:{completed:true},paints:3}
];
try{
  const{executeNativeFontPostScript}=await import("../src/pdf/nativeFontPostScript.ts");
  const{NativeFontPostScriptGlyphContext}=await import("../src/pdf/nativeFontPostScriptGraphics.ts");
  const failures=[];
  for(const fixture of cases)try{
    if(useOracle){
      const code=`100 dict begin [1 0 0 1 0 0] setmatrix\n${fixture.code}\n`+
        Object.keys(fixture.expect).map(key=>`/${key} load ==`).join("\n")+"\nquit";
      const result=spawnSync("gs",["-q","-dNODISPLAY","-dBATCH","-dNOPAUSE","-c",code],
        {stdio:["ignore","pipe","pipe"],encoding:"utf8",timeout:10000});
      assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
      const lines=result.stdout.trim().split("\n");assert.equal(lines.length,Object.keys(fixture.expect).length);
      Object.entries(fixture.expect).forEach(([key,value],i)=>equal(parseDisplay(lines[i]),value,`${fixture.name}: Ghostscript ${key}`,1e-5));
    }
    const context=new NativeFontPostScriptGlyphContext();
    const result=executeNativeFontPostScript(encoder.encode(fixture.code),undefined,
      {initialDictionary:new Map([["FontType",1]]),initialMatrix:[1,0,0,1,0,0],glyphContext:context});
    for(const[key,value]of Object.entries(fixture.expect))equal(jsValue(result.dictionary.get(key)),value,`${fixture.name}: ${key}`);
    if(fixture.paints!==undefined)assert.equal(context.paintRecords.length,fixture.paints,fixture.name);
    if(fixture.name.startsWith("gsave"))assert.deepEqual(context.paintRecords[0].commands,
      [{kind:"move",x:100,y:200},{kind:"line",x:110,y:200}]);
    if(fixture.name.startsWith("current line"))assert.deepEqual(context.paintRecords.map(paint=>paint.clips.length),[2,1]);
    if(fixture.name.startsWith("planar procedure"))assert.deepEqual([...context.paintRecords[0].rgba],
      [16,48,80,255,32,64,96,255,112,144,176,255,128,160,192,255]);
    if(fixture.name.startsWith("explicit strokes"))assert.deepEqual(context.paintRecords.map(paint=>paint.changedStrokeFields),
      [[],["lineCap","dashArray","dashPhase"],[]],"only explicit setters override the invoking PDF style");
  }catch(error){failures.push(fixture.name);console.error(`${fixture.name}: ${error.stack}`);}
  for(const[width,height]of [[0,Number.MAX_SAFE_INTEGER],[Number.MAX_SAFE_INTEGER,0]]){
    const context=new NativeFontPostScriptGlyphContext();
    const result=executeNativeFontPostScript(encoder.encode(`
      /sourceCalls 0 def
      ${width} ${height} 12 [1 0 0 1 0 0]
        {/sourceCalls sourceCalls 1 add def <0000>}
        {/sourceCalls sourceCalls 1 add def <0000>}
        {/sourceCalls sourceCalls 1 add def <0000>}
        true 3 colorimage
    `),undefined,{initialDictionary:new Map([["FontType",1]]),initialMatrix:[1,0,0,1,0,0],glyphContext:context,maxStringBytes:32});
    assert.equal(result.dictionary.get("sourceCalls"),0,"zero-sized planar images do not invoke producers");
    assert.deepEqual(context.paintRecords,[],"zero-sized images allocate no visible samples");
  }
  assert.deepEqual(failures,[]);
  console.log(`Native font PostScript VM graphics checks passed (${cases.length} groups${useOracle?", Ghostscript verified":""}).`);
}finally{hooks.deregister();}
function jsValue(value){return Array.isArray(value)?value.map(jsValue):value?.kind==="name"?"/"+value.value:value;}
function parseDisplay(text){
  if(text.startsWith("[")){let depth=0,start=1;const result=[];
    for(let i=1;i<text.length;i++){if(text[i]==="[")depth++;else if(text[i]==="]")depth--;
      if((text[i]===" "&&depth===0)||(i===text.length-1)){const part=text.slice(start,i).trim();if(part)result.push(parseDisplay(part));start=i+1;}}
    return result;
  }
  return text.startsWith("/")?text:text==="true"?true:text==="false"?false:Number(text);
}
function equal(actual,expected,label,tolerance=1e-9){
  if(Array.isArray(expected)){assert(Array.isArray(actual),label);assert.equal(actual.length,expected.length,label);expected.forEach((value,i)=>equal(actual[i],value,label,tolerance));}
  else if(typeof expected==="number")assert(Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)),`${label}: ${actual} != ${expected}`);
  else assert.equal(actual,expected,label);
}
