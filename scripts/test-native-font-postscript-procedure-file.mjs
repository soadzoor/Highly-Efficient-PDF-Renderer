import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks=registerHooks({resolve(specifier,context,next){
  return next(context.parentURL?.includes("/src/")&&/^\.\.?\//.test(specifier)&&!specifier.endsWith(".ts")?specifier+".ts":specifier,context);
}});
const encoder=new TextEncoder(), decoder=new TextDecoder();
try{
  const{createNativeFontPostScriptProcedureFile:create,snapshotNativeFontPostScriptProcedureFile:snapshot,
    restoreNativeFontPostScriptProcedureFile:restore}=await import("../src/pdf/nativeFontPostScriptProcedureFile.ts");
  const{createNativeFontPostScriptFilter:filter}=await import("../src/pdf/nativeFontPostScriptFile.ts");
  const{executeNativeFontPostScript}=await import("../src/pdf/nativeFontPostScript.ts");
  const{PdfError}=await import("../src/pdf/nativeTypes.ts");
  const procedure={kind:"procedure",tokens:[]};
  const bytes=value=>encoder.encode(value), text=value=>decoder.decode(value);
  const all=file=>{const output=[];for(let byte=file.readByte();byte>=0;byte=file.readByte())output.push(byte);return Uint8Array.from(output);};

  let calls=0;
  const source=create(procedure,()=>bytes(["4","1","4","2",">","unused"][calls++]??""));
  const decoded=filter(source,"ASCIIHexDecode");
  assert.equal(calls,0,"filter construction preserves lazy procedure execution");
  assert.equal(text(all(decoded)),"AB","half-byte decoder state survives every procedure boundary");
  assert.equal(calls,5,"EOD stops procedure calls before later chunks");
  assert.equal(source.closed,false,"closing a default filter does not close its procedure source");

  const shared=bytes("AB");let sharedCalls=0;
  const reused=create(procedure,()=>{if(sharedCalls===2)return new Uint8Array(0);shared[0]=65+sharedCalls++;return shared;});
  assert.equal(text(all(reused)),"ABBB","producers can refill the same buffer between chunks");
  assert.equal(sharedCalls,2);assert.equal(reused.closed,true);

  const lines=[bytes("a\r"),bytes("\nb\n"),bytes("c"),new Uint8Array(0)];
  const lineSource=create(procedure,()=>lines.shift()??new Uint8Array(0));const target=new Uint8Array(4);
  assert.deepEqual(lineSource.readLineInto(target),{length:1,complete:true});assert.equal(text(target.subarray(0,1)),"a");
  assert.deepEqual(lineSource.readLineInto(target),{length:1,complete:true});assert.equal(text(target.subarray(0,1)),"b");
  assert.deepEqual(lineSource.readLineInto(target),{length:1,complete:false});assert.equal(text(target.subarray(0,1)),"c");

  const original=create(procedure,()=>bytes("ABCD"));
  assert.equal(original.readByte(),65);assert.equal(original.peekByte(),66);
  const saved=snapshot(original),cloned=restore({...saved,chunk:saved.chunk.slice()},()=>new Uint8Array(0));
  assert.equal(cloned.readByte(),66,"cloned lookahead is consumed exactly once");
  assert.equal(text(all(cloned)),"CD");assert.equal(original.readByte(),66,"clone cursor is isolated");
  assert.equal(snapshot(cloned).closed,true);assert.equal(snapshot(decoded),null);

  const controller=new AbortController();let abortCalls=0;
  const cancellable=create(procedure,()=>{abortCalls++;return bytes("A");},{signal:controller.signal});
  controller.abort();assert.throws(()=>cancellable.readByte(),error=>error instanceof PdfError&&error.code==="aborted");
  assert.equal(abortCalls,0);
  const limited=create(procedure,()=>bytes("AB"),{maxDecodedBytes:1});
  assert.equal(limited.readByte(),65);assert.throws(()=>limited.readByte(),error=>error instanceof PdfError&&error.code==="resource-limit");
  assert.throws(()=>create(procedure,()=>42).readByte(),error=>error instanceof PdfError&&error.details.operator==="typecheck");
  let recursive;recursive=create(procedure,()=>{recursive.readByte();return bytes("A");});
  assert.throws(()=>recursive.readByte(),error=>error instanceof PdfError&&error.details.operator==="ioerror");

  if(!process.argv.includes("--helper-only")){
    const execute=(code,options={})=>executeNativeFontPostScript(bytes(code),undefined,{initialDictionary:new Map([["FontType",1]]),...options});
    const values=execute(`
      /parts [(4)(1)(4)(2)(>)] def /cursor 0 def
      /producer { cursor parts length lt { parts cursor get /cursor cursor 1 add def } { () } ifelse } def
      /stream /producer load /ASCIIHexDecode filter def
      /before cursor def /value stream 4 string readstring pop def /after cursor def
    `).dictionary;
    assert.equal(values.get("before"),0);assert.equal(text(values.get("value")),"AB");assert.equal(values.get("after"),5);
    const nested=execute(`
      /parts [(3431)(34323e)(>)] def /cursor 0 def
      /first { cursor parts length lt { parts cursor get /cursor cursor 1 add def } { () } ifelse } /ASCIIHexDecode filter def
      /second { first 2 string readstring pop } /ASCIIHexDecode filter def
      /value second 8 string readstring pop def
    `).dictionary;
    assert.equal(text(nested.get("value")),"AB","nested procedure/filter chains preserve parent decoder state");
    const errors=execute(`
      /bad { 42 } /ASCIIHexDecode filter def
      { bad read } stopped pop /badType $error /errorname get def clear
      /failure { undefinedProcedureFileOperator } /ASCIIHexDecode filter def
      { failure read } stopped pop /badOperator $error /errorname get def clear
      /good { (41>) } /ASCIIHexDecode filter def /recovered good 1 string readstring pop def
    `).dictionary;
    assert.equal(errors.get("badType").value,"typecheck");assert.equal(errors.get("badOperator").value,"undefined");
    assert.equal(text(errors.get("recovered")),"A","caught source failures leave the VM usable");
    assert.throws(()=>execute("/stream { {} loop } /ASCIIHexDecode filter def stream read",{maxOperations:100}),
      error=>error instanceof PdfError&&error.code==="resource-limit");
    const retained=execute(`
      /cursor [0] def /chunks [(4142)(4344)(>)] def
      /source { cursor 0 get chunks length lt { chunks cursor 0 get get cursor 0 cursor 0 get 1 add put } { () } ifelse } def
      /stream /source load /ASCIIHexDecode filter def stream read pop pop
      /Private << /OtherSubrs [{} {} {} {} { stream read pop } {}] >> def
    `);
    const firstGlyph=retained.createOtherSubrExecutor(),secondGlyph=retained.createOtherSubrExecutor();
    assert.deepEqual(firstGlyph(4,[]),[66]);assert.deepEqual(firstGlyph(4,[]),[67]);
    assert.deepEqual(secondGlyph(4,[]),[66],"active retained stream cursors are cloned per glyph");
    const reusable=execute(`
      /cursor [0] def /chunks [(4142)(4344)(>)] def
      /source { cursor 0 get chunks length lt { chunks cursor 0 get get cursor 0 cursor 0 get 1 add put } { () } ifelse } def
      /stream /source load << /Filter /ASCIIHexDecode >> /ReusableStreamDecode filter def
      stream 1 setfileposition
      /Private << /OtherSubrs [{} {} {} {} { stream read pop } {}] >> def
    `);
    const a=reusable.createOtherSubrExecutor(),b=reusable.createOtherSubrExecutor();
    assert.deepEqual(a(4,[]),[66]);assert.deepEqual(a(4,[]),[67]);assert.deepEqual(b(4,[]),[66]);
    const cyclic=execute(`
      /state << /cursor [0] /chunks [(4142)(4344)(>)] >> def
      /source { //state begin cursor 0 get chunks length lt
        { chunks cursor 0 get get cursor 0 cursor 0 get 1 add put } { () } ifelse end } def
      state /stream /source load /ASCIIHexDecode filter put
      /Private << /OtherSubrs [{} {} {} {} { state /stream get read pop } {}] >> def
    `);
    const cyclicA=cyclic.createOtherSubrExecutor(),cyclicB=cyclic.createOtherSubrExecutor();
    assert.deepEqual(cyclicA(4,[]),[65]);assert.deepEqual(cyclicA(4,[]),[66]);assert.deepEqual(cyclicB(4,[]),[65],
      "procedure/file/dictionary cycles preserve graph aliases while glyph state remains isolated");
    const scanned=execute(`
      /cursor [0] def /chunks [(/res)<756c74202868656c><6c6f2920646566>] def
      /stream { cursor 0 get chunks length lt { chunks cursor 0 get get cursor 0 cursor 0 get 1 add put } { () } ifelse }
        << /EODCount 0 /EODString () >> /SubFileDecode filter def
      stream cvx exec
    `).dictionary;
    assert.equal(text(scanned.get("result")),"hello","executable filtered streams preserve lexer state across procedure calls");
  }
  console.log("Native font PostScript procedure-file checks passed.");
}finally{hooks.deregister();}
