import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";

// Adobe PLRM3 §§3.7.2–3.7.3, §3.9 and operator entries setglobal,
// gcheck, filter, defineresource and findresource. --ghostscript independently
// checks the observable values against the local PostScript interpreter.
// https://www.adobe.com/jp/print/postscript/pdfs/PLRM.pdf
const hooks=registerHooks({resolve(specifier,context,next){
  return next(context.parentURL?.includes("/src/")&&/^\.\.?\//.test(specifier)&&!specifier.endsWith(".ts")?specifier+".ts":specifier,context);
}});
const encoder=new TextEncoder();
const oracleOnly=process.argv.includes("--oracle-only"), useOracle=oracleOnly||process.argv.includes("--ghostscript");
const cases=[
  {name:"allocation modes, scanner literals and shared storage",code:`
    /defaultMode currentglobal def
    /localString (abc) def /localArray [1] def /localDict 1 dict def /localProcedure {} def
    true setglobal
      /globalString (def) def /globalArray [2] def /globalDict 1 dict def /globalProcedure {} def
    false setglobal
    /localFlags [localString gcheck localArray gcheck localDict gcheck /localProcedure load gcheck] def
    /globalFlags [globalString gcheck globalArray gcheck globalDict gcheck /globalProcedure load gcheck] def
    /simpleFlags [1 gcheck true gcheck null gcheck /GlyphName gcheck] def
    /globalView globalArray 0 1 getinterval gcheck def
    /globalStringView globalString 0 1 getinterval gcheck def
    /systemGlobal systemdict gcheck def /userGlobal userdict gcheck def /dictionaryGlobal globaldict gcheck def
    /distinctDictionaries globaldict userdict ne def
    /sameDictionaryStack currentdict def true setglobal /unchangedDictionaryStack currentdict sameDictionaryStack eq def false setglobal
  `,expect:{defaultMode:false,localFlags:[false,false,false,false],globalFlags:[true,true,true,true],
    simpleFlags:[true,true,true,true],globalView:true,globalStringView:true,systemGlobal:true,userGlobal:false,
    dictionaryGlobal:true,distinctDictionaries:true,unchangedDictionaryStack:true}},
  {name:"procedure scan time, execution allocations and immediately evaluated references",code:`
    /localArray [1] def /localProcedure { (abc) [1] 1 array } def
    true setglobal localProcedure /runtimeArray exch def /runtimeLiteralArray exch def /parsedString exch def false setglobal
    /parsedStringFlag parsedString gcheck def /runtimeArrayFlag runtimeArray gcheck def
    /runtimeLiteralArrayFlag runtimeLiteralArray gcheck def
    true setglobal { ({ //localArray }) cvx exec } stopped pop
    /immediateReferenceError $error /errorname get def clear
    true setglobal /fontDirectoryGlobal FontDirectory gcheck def
    /sameGlobalFontDirectory FontDirectory GlobalFontDirectory eq def false setglobal
    /fontDirectoryLocal FontDirectory gcheck def
    /saveFlag save dup gcheck exch restore def
  `,expect:{parsedStringFlag:false,runtimeArrayFlag:true,runtimeLiteralArrayFlag:true,
    immediateReferenceError:"/invalidaccess",fontDirectoryGlobal:true,sameGlobalFontDirectory:true,fontDirectoryLocal:false,saveFlag:true}},
  {name:"global write barriers and legal simple-value copies",code:`
    /localString (abc) def /localArray [1] def
    true setglobal /globalArray 3 array def /globalDict 5 dict def false setglobal
    { globalDict /bad localString put } stopped pop /dictionaryError $error /errorname get def clear
    { globalArray 0 localArray put } stopped pop /arrayError $error /errorname get def clear
    { globaldict /bad localString put } stopped pop /globaldictError $error /errorname get def clear
    { localString globalArray 0 1 getinterval astore } stopped pop /astoreError $error /errorname get def clear
    globalArray 0 [11 22 33] putinterval
    /copiedValues globalArray 3 array copy def
    globalDict /name /A put globalDict /number 42 put
    /simpleName globalDict /name get def /simpleNumber globalDict /number get def
    /noFailedEntry globalDict /bad known not def
  `,expect:{dictionaryError:"/invalidaccess",arrayError:"/invalidaccess",globaldictError:"/invalidaccess",
    astoreError:"/invalidaccess",copiedValues:[11,22,33],simpleName:"/A",simpleNumber:42,noFailedEntry:true}},
  {name:"local rollback, persistent global values and string contents",code:`
    /localArray [1] def /localDict << /value 2 >> def /localString (abc) def
    true setglobal /globalArray [3] def /globalDict << /value 4 >> def /globalString (def) def false setglobal
    /saved save def
      localArray 0 11 put localDict /value 12 put localString 0 90 put
      globalArray 0 13 put globalDict /value 14 put globalString 0 89 put
      true setglobal globaldict /createdAfterSave [15] put
    saved restore
    /restoredMode currentglobal def /localValue localArray 0 get def /localDictValue localDict /value get def
    /localStringValue localString 3 string copy def
    /globalValue globalArray 0 get def /globalDictValue globalDict /value get def
    /globalStringValue globalString 3 string copy def /newGlobalValue globaldict /createdAfterSave get 0 get def
  `,expect:{restoredMode:false,localValue:1,localDictValue:2,localStringValue:"(Zbc)",globalValue:13,
    globalDictValue:14,globalStringValue:"(Yef)",newGlobalValue:15}},
  {name:"new global operands survive local restore",code:`
    save true setglobal 1 array exch restore /newGlobal exch def
    /mode currentglobal def /newGlobalFlag newGlobal gcheck def
    /newGlobalLength newGlobal length def
    { save false setglobal 1 array exch restore } stopped pop
    /localRestoreError $error /errorname get def clear
  `,expect:{mode:false,newGlobalFlag:true,newGlobalLength:1,localRestoreError:"/invalidrestore"}},
  {name:"caught language errors reset allocation mode but explicit stop does not",code:`
    true setglobal { 1 0 div } stopped pop /errorMode currentglobal def clear
    true setglobal { stop } stopped pop /stopMode currentglobal def false setglobal
  `,expect:{errorMode:false,stopMode:true}},
  {name:"global and local resource visibility and registration lifetime",code:`
    true setglobal /SharedGlobalFixture << /value 11 >> /ProcSet defineresource pop false setglobal
    /SharedGlobalFixture << /value 22 >> /ProcSet defineresource pop
    /localVisible /SharedGlobalFixture /ProcSet findresource /value get def
    true setglobal /globalVisible /SharedGlobalFixture /ProcSet findresource /value get def false setglobal
    /saved save def
      /TemporaryLocalFixture << /value 33 >> /ProcSet defineresource pop
      true setglobal /PersistentGlobalFixture << /value 44 >> /ProcSet defineresource pop false setglobal
    saved restore
    /localRemoved /TemporaryLocalFixture /ProcSet resourcestatus {pop pop false}{true} ifelse def
    /globalRetained /PersistentGlobalFixture /ProcSet findresource /value get def
    /localObject << /value 55 >> def
    true setglobal { /InvalidGlobalFixture localObject /ProcSet defineresource pop } stopped pop
    /resourceError $error /errorname get def /errorMode currentglobal def clear
  `,expect:{localVisible:22,globalVisible:11,localRemoved:true,globalRetained:44,resourceError:"/invalidaccess",errorMode:false}},
  {name:"filter globalness follows retained sources rather than allocation mode",code:`
    /localSource (4142>) def true setglobal /globalSource (4344>) def false setglobal
    globalSource /ASCIIHexDecode filter /globalFilter exch def
    true setglobal localSource /ASCIIHexDecode filter /localFilter exch def false setglobal
    /globalFilterFlag globalFilter gcheck def /localFilterFlag localFilter gcheck def
    /globalDecoded globalFilter 2 string readstring pop def /localDecoded localFilter 2 string readstring pop def
  `,expect:{globalFilterFlag:true,localFilterFlag:false,globalDecoded:"(CD)",localDecoded:"(AB)"}},
  {name:"globally registered final font survives restore",code:`
    /saved save def true setglobal
      /GlobalAfterSave << /FontType 3 /FontName /GlobalAfterSave /FontMatrix [.001 0 0 .001 0 0]
        /FontBBox [0 0 10 10] /Encoding StandardEncoding /BuildChar {pop pop} >> definefont pop
    false setglobal saved restore
  `,expect:{FontName:"/GlobalAfterSave",FontType:3},oracleDictionary:"GlobalAfterSave"},
  {name:"global font dictionary registered locally still rolls back",code:`
    true setglobal /GlobalButLocalFont << /FontType 3 /FontName /GlobalButLocalFont /FontMatrix [.001 0 0 .001 0 0]
      /FontBBox [0 0 10 10] /Encoding StandardEncoding /BuildChar {pop pop} >> def false setglobal
    /saved save def /LocalRegistration GlobalButLocalFont definefont pop saved restore
    /localRegistrationGone /LocalRegistration /Font resourcestatus {pop pop false}{true} ifelse def
  `,expect:{localRegistrationGone:true,FontType:1}}
];
try{
  const{executeNativeFontPostScript}=await import("../src/pdf/nativeFontPostScript.ts");
  const failures=[];
  for(const fixture of cases)try{
    if(useOracle){
      const expected=Object.values(fixture.expect).map(psDisplay).join("\n");
      const code=`100 dict begin /FontType 1 def\n${fixture.code}\n`+
        (fixture.oracleDictionary?`/${fixture.oracleDictionary} /Font findresource begin\n`:"")+
        `${Object.keys(fixture.expect).map(key=>`/${key} load ==`).join("\n")}\nquit`;
      const result=spawnSync("gs",["-q","-dNODISPLAY","-dBATCH","-dNOPAUSE","-c",code],
        {stdio:["ignore","pipe","pipe"],encoding:"utf8",timeout:10000});
      assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
      assert.equal(result.stdout.trim(),expected,"Ghostscript: "+fixture.name);
    }
    if(!oracleOnly){
      const result=executeNativeFontPostScript(encoder.encode(fixture.code),undefined,{initialDictionary:new Map([["FontType",1]])});
      for(const[key,expected]of Object.entries(fixture.expect))assert.deepEqual(jsValue(result.dictionary.get(key)),expected,`${fixture.name}: ${key}`);
    }
  }catch(error){failures.push(fixture.name);console.error(`${fixture.name}: ${error.stack}`);}
  if(!oracleOnly){
    const aliases=executeNativeFontPostScript(encoder.encode(`
      true setglobal globaldict /state [0] put false setglobal
      userdict /marker 7 put
      /OtherSubrs [{} {} {} {} {
        //globaldict globaldict eq //userdict userdict eq and //FontDirectory FontDirectory eq and
        //systemdict systemdict eq and //$error $error eq and {1}{0} ifelse
        globaldict /state get 0 2 copy get 1 add put globaldict /state get 0 get
      }] def
    `),undefined,{initialDictionary:new Map([["FontType",1]])});
    const first=aliases.createOtherSubrExecutor(),second=aliases.createOtherSubrExecutor();
    assert.deepEqual(first(4,[]),[1,1],"immediate and named standard dictionaries retain identity");
    assert.deepEqual(first(4,[]),[2,1],"global state persists within a glyph");
    assert.deepEqual(second(4,[]),[1,1],"global state is isolated between glyphs");
  }
  assert.deepEqual(failures,[]);
  console.log(`Native font PostScript global VM checks passed (${cases.length} groups${useOracle?", Ghostscript verified":""}).`);
}finally{hooks.deregister();}
function jsValue(value){
  if(value instanceof Uint8Array)return"("+new TextDecoder().decode(value)+")";
  if(Array.isArray(value))return value.map(jsValue);
  if(value?.kind==="name")return"/"+value.value;
  return value;
}
function psDisplay(value){return Array.isArray(value)?"["+value.map(psDisplay).join(" ")+"]":String(value);}
