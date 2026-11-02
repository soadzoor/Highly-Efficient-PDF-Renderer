import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createPdfLayerControls } from "../src/pdfLayerControls.ts";

class Element extends EventTarget {
  childNodes=[]; value=""; textContent=""; checked=false; indeterminate=false; disabled=false; hidden=false;
  constructor(tag="div") { super(); this.tagName=tag; this.ownerDocument={createElement:tag=>new Element(tag)}; }
  append(...children) { this.childNodes.push(...children); }
  replaceChildren(...children) { this.childNodes=[...children]; this.textContent=""; }
  set innerHTML(_html) {
    this.elements=new Map([["fieldset",new Element("fieldset")],['input[type="search"]',new Element("input")],[".pdf-layers-all input",new Element("input")],[".pdf-layers-list",new Element()],
      ["button",new Element("button")],[".pdf-layers-status",new Element()],["progress",new Element("progress")]]);
  }
  querySelector(selector) { return this.elements.get(selector); }
}
const group=(id,name,visible,locked=false)=>({id,name,visible,defaultVisible:visible,locked,usedInView:true});
let layers=[group("walls","Walls <script>",true),group("doors","Doors",false),group("grid","Grid",true,true)];
let listener, pendingResolve, pendingReject;
const calls=[];
const container=new Element();
const controller={
  getLayers:()=>layers,
  getAllLayerVisibility() {
    const editable=layers.filter(l=>!l.locked&&l.usedInView), visible=editable.filter(l=>l.visible).length;
    return { checked:editable.length>0&&visible===editable.length, indeterminate:visible>0&&visible<editable.length, disabled:editable.length===0 };
  },
  getLayerOrder:()=>[{kind:"label",label:"Architecture",children:[{kind:"group",groupId:"walls",children:[{kind:"group",groupId:"doors"}]}]}],
  subscribeLayerVisibility(fn) { listener=fn; return ()=>{listener=null;}; },
  setLayerVisibility(id,visible) {
    calls.push([id,visible]); return new Promise((resolve,reject)=>{
      pendingResolve=()=>{layers=layers.map(l=>l.id===id?{...l,visible}:l);listener?.();resolve();};pendingReject=reject;
    });
  },
  setAllLayerVisibility(visible) {
    calls.push(["all",visible]); return new Promise((resolve,reject)=>{
      pendingResolve=()=>{layers=layers.map(l=>l.locked||!l.usedInView?l:{...l,visible});listener?.();resolve();};pendingReject=reject;
    });
  },
  async resetLayerVisibility() { calls.push("reset"); layers=layers.map(l=>({...l,visible:l.defaultVisible}));listener?.(); }
};
const widget=createPdfLayerControls({container,controller});
const filter=container.querySelector('input[type="search"]'), list=container.querySelector(".pdf-layers-list");
const all=container.querySelector(".pdf-layers-all input");
const status=container.querySelector(".pdf-layers-status"), progress=container.querySelector("progress");
const walk=node=>[node,...node.childNodes.flatMap(walk)];
const boxes=()=>walk(list).filter(n=>n.tagName==="input");
assert.equal(boxes().length,3,"unlisted layers remain available below PDF order");
assert.equal(all.checked,false);assert.equal(all.indeterminate,true);assert.equal(all.disabled,false);
assert.deepEqual(boxes().map(b=>[b.checked,b.disabled]),[[true,false],[false,false],[true,true]]);
assert(walk(list).some(n=>n.textContent==="Walls <script>"),"layer names are literal text");
boxes()[1].checked=true;boxes()[1].dispatchEvent(new Event("change"));
assert.deepEqual(calls,[["doors",true]]);
assert.match(status.textContent,/Applying/);
widget.setProgress(47); assert.equal(progress.value,47); assert.equal(progress.hidden,false); assert.match(status.textContent,/47%/);
pendingResolve(); await new Promise(r=>setTimeout(r,0)); widget.setProgress(null);
assert.equal(boxes()[1].checked,true);assert.equal(progress.hidden,true);
assert.equal(all.checked,true);assert.equal(all.indeterminate,false,"individual changes update the aggregate checkbox");
filter.value="door";filter.dispatchEvent(new Event("input"));assert.equal(boxes().length,1);
all.checked=false;all.dispatchEvent(new Event("change"));
assert.deepEqual(calls.at(-1),["all",false],"All submits one bulk operation");
assert.equal(layers[0].visible,true,"applied layer state remains intact until preparation commits");
pendingResolve();await new Promise(r=>setTimeout(r,0));
assert.deepEqual(layers.map(l=>l.visible),[false,false,true],"All includes filtered-out layers and preserves locked layers");
assert.equal(all.checked,false);assert.equal(all.indeterminate,false);
all.checked=true;all.dispatchEvent(new Event("change"));pendingReject(Error("bulk preparation failed"));
await new Promise(r=>setTimeout(r,0));
assert.match(status.textContent,/bulk preparation failed/);assert.equal(all.checked,false,"failed bulk updates restore the applied checkbox state");
all.checked=true;all.dispatchEvent(new Event("change"));pendingResolve();await new Promise(r=>setTimeout(r,0));
assert.equal(all.checked,true);assert.equal(all.indeterminate,false);assert(layers.every(l=>l.visible));
filter.value="missing";filter.dispatchEvent(new Event("input"));assert.equal(list.textContent,"No matching layers.");
widget.refresh();assert.equal(filter.value,"");assert.equal(boxes().length,3);
boxes()[0].checked=false;boxes()[0].dispatchEvent(new Event("change"));pendingReject(Error("Surface budget exceeded"));
await new Promise(r=>setTimeout(r,0));assert.match(status.textContent,/Surface budget exceeded.*reset/);assert.equal(boxes()[0].checked,true,"failed updates show applied state");
container.querySelector("button").dispatchEvent(new Event("click"));await new Promise(r=>setTimeout(r,0));assert.equal(boxes()[1].checked,false);
assert.equal(all.checked,false);assert.equal(all.indeterminate,true,"reset restores the mixed PDF defaults");
boxes()[1].checked=true;boxes()[1].dispatchEvent(new Event("change"));
layers=[];widget.refresh();pendingReject(Error("old document"));await new Promise(r=>setTimeout(r,0));
assert.equal(status.textContent,"");assert.match(list.textContent,/no optional-content/);assert.equal(filter.disabled,true);
assert.equal(all.checked,false);assert.equal(all.indeterminate,false);assert.equal(all.disabled,true);
layers=[group("locked","Locked",true,true),{...group("print","Print only",false),usedInView:false}];widget.refresh();
assert.equal(all.disabled,true,"documents with no editable View layers disable All");
layers=[group("replacement","Replacement",true)];widget.refresh();assert.equal(all.checked,true);assert.equal(all.indeterminate,false);assert.equal(all.disabled,false);
widget.dispose();assert.equal(listener,null);widget.setProgress(90);assert.equal(container.childNodes.length,0);
const beforeDisposedToggle=calls.length;all.dispatchEvent(new Event("change"));assert.equal(calls.length,beforeDisposedToggle,"disposal removes the All listener");

// Exercise the real shared controller: radio alternatives must not leave All
// permanently mixed, otherwise the checkbox cannot be clicked to turn them off.
const hooks=registerHooks({resolve(specifier,context,next){
  return next(context.parentURL?.includes("/src/")&&/^\.\.?\//.test(specifier)&&!/\.[a-z0-9]+$/i.test(specifier)?`${specifier}.ts`:specifier,context);
}});
try {
  const {createLayerVisibilityController}=await import("../src/layerVisibility.ts");
  const {createEmptyVectorScene}=await import("../src/emptyVectorScene.ts");
  const scene=createEmptyVectorScene();
  // An annotation layer shares the table but is never a panel entry.
  scene.optionalContent={groups:[group("a","Choice A",true),group("b","Choice B",false),group("free","Free",false),group("locked","Locked",true,true),
    {id:"annotation:ref:9:0",name:"Annotation ref:9:0",defaultVisible:true,locked:true,usedInView:false,annotationId:"ref:9:0"}],
    conditions:[],order:[],radioGroups:[["a","b"]]};
  scene.annotations=[{id:"ref:9:0"}];
  const native=createLayerVisibilityController({getScene:()=>scene,getRenderer:()=>({})});
  native.sceneChanged();
  const root=new Element(), panel=createPdfLayerControls({container:root,controller:native});
  const toggle=root.querySelector(".pdf-layers-all input");
  assert.equal(toggle.indeterminate,true);
  toggle.checked=true;toggle.dispatchEvent(new Event("change"));await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(native.getLayers().map(l=>l.visible),[true,false,true,true]);
  assert.equal(toggle.checked,true);assert.equal(toggle.indeterminate,false,"radio-compatible All can be unchecked");
  toggle.checked=false;toggle.dispatchEvent(new Event("change"));await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(native.getLayers().map(l=>l.visible),[false,false,false,true]);
  assert.equal(toggle.checked,false);assert.equal(toggle.indeterminate,false);
  panel.dispose();native.dispose();

  // Both Three demos use one adapter around their current PDF object. Exercise
  // it with the real visibility rules, without creating a browser or GPU.
  const {createThreePdfLayerControls}=await import("../src/threePdfLayerControls.ts");
  const {OptionalContentController}=await import("../src/optionalContent.ts");
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const objects=[];
  function pdfObject(sceneData) {
    const visibility=new OptionalContentController(sceneData);
    const visibilityListeners=new Set(),progressListeners=new Set();
    let percentage=null;
    const pdf={
      sceneData, visibility, visibilityListeners, progressListeners, nextChange:null,
      get layerVisibilityRevision() { return visibility.revision; },
      getLayers:()=>visibility.getLayers(),
      getLayerOrder:()=>visibility.getOrder(),
      getOptionalContentVisibility:()=>visibility.getSnapshot(),
      getAllLayerVisibility:()=>visibility.getAllLayerVisibility(),
      setLayerVisibilities:changes=>visibility.setLayerVisibilities(changes),
      setLayerVisibility(id,visible) {
        const operation=pdf.nextChange;pdf.nextChange=null;
        return operation?operation():visibility.setLayerVisibility(id,visible);
      },
      setAllLayerVisibility:visible=>visibility.setAllLayerVisibility(visible),
      resetLayerVisibility:()=>visibility.resetLayerVisibility(),
      getAnnotationLayers:()=>visibility.getAnnotationLayers(),
      setAnnotationVisibility:(ids,visible)=>visibility.setAnnotationVisibility(ids,visible),
      subscribeLayerVisibility(callback) {
        visibilityListeners.add(callback);
        const unsubscribe=visibility.subscribe(callback);
        return ()=>{visibilityListeners.delete(callback);unsubscribe();};
      },
      subscribeLayerVisibilityProgress(callback) {
        progressListeners.add(callback);callback(percentage);
        return ()=>{progressListeners.delete(callback);};
      },
      emitProgress(value) { percentage=value;for(const callback of progressListeners)callback(value); }
    };
    objects.push(pdf);return pdf;
  }
  let current=null,renders=0,visibilityChanges=0;
  const threeRoot=new Element();
  const adapter=createThreePdfLayerControls({container:threeRoot,getPdfObject:()=>current,
    requestRender:()=>{renders++;},onVisibilityChange:()=>{visibilityChanges++;}});
  const threeList=threeRoot.querySelector(".pdf-layers-list");
  const threeFilter=threeRoot.querySelector('input[type="search"]');
  const threeAll=threeRoot.querySelector(".pdf-layers-all input");
  const threeStatus=threeRoot.querySelector(".pdf-layers-status");
  const threeProgress=threeRoot.querySelector("progress");
  const checkbox=id=>walk(threeList).find(node=>node.tagName==="label"&&node.title?.split("\n")[1]===id)?.childNodes[0];
  assert.match(threeList.textContent,/no optional-content/);
  assert.equal(threeAll.disabled,true,"the shared Three panel starts empty until an object is attached");

  const original=pdfObject(scene);
  current=original;adapter.objectChanged();
  assert.equal(original.visibilityListeners.size,1);assert.equal(original.progressListeners.size,1);
  assert.equal(checkbox("locked").disabled,true);
  const beforePublication={renders,visibilityChanges};
  checkbox("free").checked=true;
  await original.visibility.replaceScene(scene);
  assert(renders>beforePublication.renders,"republishing display resources still requests a frame");
  assert.equal(checkbox("free").checked,false,"panel listeners still synchronize every publication");
  assert.equal(visibilityChanges,beforePublication.visibilityChanges,"unchanged layer values and conditions do not dirty host thumbnails");
  const publishVisibility=[...original.visibilityListeners][0],snapshot=original.getOptionalContentVisibility();
  const changedConditions=Uint8Array.from([...snapshot.conditions,1]);
  publishVisibility({...snapshot,conditions:changedConditions});
  assert.equal(visibilityChanges,beforePublication.visibilityChanges+1,"new conditions still notify the host");
  const toggledConditions=changedConditions.slice();toggledConditions[toggledConditions.length-1]=0;
  publishVisibility({...snapshot,conditions:toggledConditions});
  assert.equal(visibilityChanges,beforePublication.visibilityChanges+2,"changed condition bytes still notify the host");
  publishVisibility(snapshot);
  assert.equal(visibilityChanges,beforePublication.visibilityChanges+3);
  publishVisibility({...snapshot,layers:[...snapshot.layers,{id:"new-layer",visible:true}]});
  assert.equal(visibilityChanges,beforePublication.visibilityChanges+4,"new layer membership conservatively notifies the host");
  publishVisibility(snapshot);
  const beforeChange={renders,visibilityChanges};
  checkbox("free").checked=true;checkbox("free").dispatchEvent(new Event("change"));await tick();
  assert.equal(original.getLayers().find(layer=>layer.id==="free").visible,true);
  assert(renders>beforeChange.renders,"visibility commits request another rendered frame");
  assert(visibilityChanges>beforeChange.visibilityChanges,"visibility commits refresh dependent demo UI");
  threeAll.checked=false;threeAll.dispatchEvent(new Event("change"));await tick();
  assert.deepEqual(original.getLayers().map(layer=>layer.visible),[false,false,false,true]);
  threeAll.checked=true;threeAll.dispatchEvent(new Event("change"));await tick();
  assert.deepEqual(original.getLayers().map(layer=>layer.visible),[true,false,true,true]);
  threeRoot.querySelector("button").dispatchEvent(new Event("click"));await tick();
  assert.deepEqual(original.getLayers().map(layer=>layer.visible),[true,false,false,true],"reset reaches the current Three object");

  let finishPendingLayer;
  original.nextChange=()=>new Promise(resolve=>{finishPendingLayer=async()=>{
    await original.visibility.setLayerVisibility("b",true);resolve();
  };});
  checkbox("b").checked=true;checkbox("b").dispatchEvent(new Event("change"));
  const prepared=pdfObject(scene);
  const prepare=adapter.prepareReplacement(prepared);
  await tick();
  assert.equal(threeRoot.querySelector("fieldset").disabled,true,"backend preparation suspends new panel gestures");
  assert.equal(prepared.getLayers()[1].visible,false,"replacement preparation waits for a pending panel change to commit");
  await finishPendingLayer();await prepare;
  assert.equal(prepared.getLayers()[1].visible,true,"a layer toggle immediately followed by a backend switch is retained");
  assert.equal(original.visibilityListeners.size,1,"preparation leaves the current PDF object attached");
  assert.equal(prepared.progressListeners.size,0,"replacement progress listeners are released after preparation");
  assert.equal(threeRoot.querySelector("fieldset").disabled,false);
  const transfer=prepared.setLayerVisibilities;let copies=0;
  prepared.setLayerVisibilities=async changes=>{
    await transfer(changes);
    if(++copies===1)await original.setLayerVisibility("free",true);
  };
  await adapter.prepareReplacement(prepared);
  assert.equal(copies,2,"preparation catches up with an external visibility change during state transfer");
  assert.equal(prepared.getLayers().find(layer=>layer.id==="free").visible,true);
  assert.equal(checkbox("annotation:ref:9:0"),undefined,"annotation layers never appear in the layer panel");
  await original.setAnnotationVisibility(["ref:9:0"],false);
  await adapter.prepareReplacement(prepared);
  assert.deepEqual(prepared.getAnnotationLayers(),[{annotationId:"ref:9:0",visible:false}],"hidden annotation appearances survive a backend switch");
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(adapter.prepareReplacement(prepared,aborted.signal),{name:"AbortError"});
  assert.equal(threeRoot.querySelector("fieldset").disabled,false,"an aborted backend switch restores layer controls");
  prepared.setLayerVisibilities=()=>Promise.reject(Error("replacement replay failed"));
  await assert.rejects(adapter.prepareReplacement(prepared),/replacement replay failed/);
  assert.equal(prepared.progressListeners.size,0);
  assert.equal(threeRoot.querySelector("fieldset").disabled,false,"a failed replacement restores layer controls");
  let finishReplay;
  prepared.setLayerVisibilities=()=>new Promise(resolve=>{finishReplay=resolve;});
  const interrupted=new AbortController();
  const interruptedReplay=adapter.prepareReplacement(prepared,interrupted.signal);
  await tick();
  assert.equal(prepared.progressListeners.size,1);
  const rejectInterrupted=assert.rejects(interruptedReplay,{name:"AbortError"});
  interrupted.abort();await rejectInterrupted;
  assert.equal(prepared.progressListeners.size,0);
  assert.equal(threeRoot.querySelector("fieldset").disabled,false);
  finishReplay();await tick();
  prepared.setLayerVisibilities=transfer;
  await original.resetLayerVisibility();

  original.emitProgress(37);
  assert.equal(threeProgress.hidden,false);assert.equal(threeProgress.value,37);
  assert.match(threeStatus.textContent,/37%/);
  original.emitProgress(null);assert.equal(threeProgress.hidden,true);
  threeFilter.value="Choice";threeFilter.dispatchEvent(new Event("input"));
  await original.setLayerVisibility("b",true);
  const replacement=pdfObject(scene);
  // The demos replay the applied state before replacing a backend object.
  await replacement.visibility.setLayerVisibilities(original.getLayers().map(({id,visible})=>({id,visible})));
  const staleVisibility=[...original.visibilityListeners][0];
  const staleProgress=[...original.progressListeners][0];
  let rejectOld;
  original.nextChange=()=>new Promise((_resolve,reject)=>{rejectOld=reject;});
  checkbox("a").checked=true;checkbox("a").dispatchEvent(new Event("change"));
  original.emitProgress(62);
  const supersededPreparation=assert.rejects(adapter.prepareReplacement(pdfObject(scene)),{name:"AbortError"});
  await tick();
  current=replacement;adapter.objectChanged();
  await supersededPreparation;
  assert.equal(original.visibilityListeners.size,0);assert.equal(original.progressListeners.size,0);
  assert.equal(replacement.visibilityListeners.size,1);assert.equal(replacement.progressListeners.size,1);
  assert.equal(threeFilter.value,"Choice","a backend replacement retains the current document's name filter");
  assert.equal(checkbox("b").checked,true,"replacement controls reflect replayed visibility");
  assert.equal(threeProgress.hidden,true);assert.equal(threeStatus.textContent,"");
  const beforeStale={renders,visibilityChanges};
  staleVisibility(original.visibility.getSnapshot());staleProgress(91);
  rejectOld(Error("superseded backend preparation failed"));await tick();
  assert.equal(threeStatus.textContent,"");assert.equal(threeProgress.hidden,true);
  assert.deepEqual({renders,visibilityChanges},beforeStale,"obsolete subscriptions cannot refresh the replacement object");

  let rejectPreviousDocument;
  replacement.nextChange=()=>new Promise((_resolve,reject)=>{rejectPreviousDocument=reject;});
  checkbox("a").checked=true;checkbox("a").dispatchEvent(new Event("change"));
  replacement.emitProgress(45);
  const nextScene=createEmptyVectorScene();
  nextScene.optionalContent={groups:[group("new","New document",false)],conditions:[],order:[],radioGroups:[]};
  const next=pdfObject(nextScene);next.emitProgress(12);
  current=next;adapter.objectChanged();
  assert.equal(threeFilter.value,"","loading a new document resets the filter");
  assert.equal(checkbox("new").checked,false);
  assert.equal(threeProgress.value,12,"an already-running preparation publishes its latest progress on attachment");
  assert.match(threeStatus.textContent,/12%/);
  next.emitProgress(null);
  assert.equal(threeStatus.textContent,"","an old document's pending operation cannot keep the new document's progress text active");
  rejectPreviousDocument(Error("previous document failed"));await tick();
  assert.equal(threeStatus.textContent,"");
  await replacement.setAllLayerVisibility(false);
  assert.equal(checkbox("new").checked,false,"old-document changes do not replace the new document's controls");
  assert.equal(replacement.visibilityListeners.size,0);assert.equal(replacement.progressListeners.size,0);

  next.nextChange=()=>Promise.reject(Error("current preparation failed"));
  checkbox("new").checked=true;checkbox("new").dispatchEvent(new Event("change"));await tick();
  assert.match(threeStatus.textContent,/current preparation failed/);
  assert.equal(checkbox("new").checked,false,"a current-object failure retains the applied visibility");
  current=null;adapter.objectChanged();
  assert.match(threeList.textContent,/no optional-content/);
  assert.equal(threeStatus.textContent,"");assert.equal(threeProgress.hidden,true);
  assert.equal(next.visibilityListeners.size,0);assert.equal(next.progressListeners.size,0);
  current=next;adapter.objectChanged();
  const disposedVisibility=[...next.visibilityListeners][0],disposedProgress=[...next.progressListeners][0];
  let rejectDisposed;
  next.nextChange=()=>new Promise((_resolve,reject)=>{rejectDisposed=reject;});
  checkbox("new").checked=true;checkbox("new").dispatchEvent(new Event("change"));
  const disposedPreparation=assert.rejects(adapter.prepareReplacement(pdfObject(nextScene)),{name:"AbortError"});
  await tick();
  adapter.dispose();
  await disposedPreparation;
  assert.equal(next.visibilityListeners.size,0);assert.equal(next.progressListeners.size,0);
  assert.equal(threeRoot.childNodes.length,0);
  const afterDispose={renders,visibilityChanges};
  disposedVisibility(next.visibility.getSnapshot());disposedProgress(88);adapter.objectChanged();
  rejectDisposed(Error("disposed source failed"));
  threeAll.checked=true;threeAll.dispatchEvent(new Event("change"));await tick();
  assert.equal(next.getLayers()[0].visible,false,"disposal removes controls' event listeners");
  assert.deepEqual({renders,visibilityChanges},afterDispose);

  // Some PDFs author more than one radio alternative as initially visible.
  // Reopening that state is valid even though explicitly checking both boxes
  // in a new mutation batch is not. Backend replay must preserve PDF defaults.
  const radioScene=createEmptyVectorScene();
  radioScene.optionalContent={groups:[group("first","First",true),group("second","Second",true)],
    conditions:[],order:[],radioGroups:[["first","second"]]};
  const radioOriginal=pdfObject(radioScene),radioReplacement=pdfObject(radioScene);
  const radioAdapter=createThreePdfLayerControls({container:new Element(),getPdfObject:()=>radioOriginal,requestRender:()=>{}});
  await radioAdapter.prepareReplacement(radioReplacement);
  assert.deepEqual(radioReplacement.getLayers().map(layer=>layer.visible),[true,true],"backend replay accepts authored radio defaults");
  await radioOriginal.setLayerVisibility("first",false);
  const copyRadioChanges=radioReplacement.setLayerVisibilities;
  let radioCopies=0;
  radioReplacement.setLayerVisibilities=async changes=>{
    await copyRadioChanges(changes);radioCopies++;
    await radioOriginal.resetLayerVisibility();
  };
  await radioAdapter.prepareReplacement(radioReplacement);
  assert.equal(radioCopies,1,"a source reset during transfer requires no further explicit radio mutation");
  assert.deepEqual(radioReplacement.getLayers().map(layer=>layer.visible),[true,true],"retrying replay restores defaults instead of retaining an obsolete nondefault choice");
  radioAdapter.dispose();
  for(const object of objects)object.visibility.dispose();
} finally {hooks.deregister();}
const main=await readFile(new URL("../src/main.ts",import.meta.url),"utf8");
assert.match(main,/layerVisibility\.rendererChanged\(\)/);assert.match(main,/layerVisibility\.sceneChanged\(\)/);
assert.match(main,/createPdfLayerControls\(/);
for(const demo of ["three-example","room-overlay-demo"]){
  const html=await readFile(new URL(`../${demo}.html`,import.meta.url),"utf8");
  const source=await readFile(new URL(`../src/${demo}.ts`,import.meta.url),"utf8");
  assert(html.includes('id="pdf-layers"'),`${demo} mounts the shared layer panel`);
  assert.match(source,/createThreePdfLayerControls\(/,`${demo} uses the shared Three layer adapter`);
  assert.match(source,/\.objectChanged\(\)/,`${demo} updates the adapter when its PDF object changes`);
}
console.log("PDF layer controls passed: hierarchy, locks, filtering, bulk changes, progress, failures, Three object replacement and disposal.");
