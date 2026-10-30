import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { commitEditorText } = await import("../src/editorRichText.ts");
  const compile = async bytes => { const parser = await openPdf({ kind: "bytes", bytes }); try { return await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); } finally { await parser.close(); } };
  const scene = buildStrokeScene([{ points: [[0, 0], [150, 100]], width: 1 }]); scene.pageRects = Float32Array.of(0, 0, 150, 100);
  const editor = await openEditorSession(scene); let bytes;
  try {
    const text = editor.addObject({ id: "linked-text", kind: "text", pageIndex: 0, x: 20, y: 50, width: 100, height: 25, text: "Original text", fontSize: 12, fontFamily: "Liberation Sans" });
    const source = editor.addObject({ id: "incoming-link", kind: "shape", shape: "rectangle", pageIndex: 0, x: 10, y: 10, width: 25, height: 20, fill: "yellow" });
    editor.setObjectLink(text, { type: "url", url: "https://example.com/keep-me" });
    editor.setObjectLink(source, { type: "object", objectId: text }); editor.setObjectsLocked([source], true);
    bytes = new Uint8Array(await (await editor.savePdf({ markSaved: false })).arrayBuffer());
  } finally { editor.dispose(); }
  const sourceScene = await compile(bytes), services = await createEditorAppServices({ sourcePdf: bytes });
  const reopened = await openEditorSession(sourceScene, { ...services.sessionOptions, sourcePdf: bytes });
  try {
    const text = sourceScene.annotations.find(a => a.name === "linked-text"), incoming = sourceScene.annotations.find(a => a.name === "incoming-link"); assert(text && incoming);
    const owner = `annotation:${incoming.id}`, previousTarget = `annotation:${text.id}`;
    assert.deepEqual(reopened.getObjectLink(owner), { type: "object", objectId: previousTarget }); assert(reopened.isObjectLocked(owner));
    const next = commitEditorText(reopened, { kind: "text", pageIndex: 0, x: 20, y: 50, width: 110, height: 30, text: "Changed text", fontSize: 14, fontFamily: "Liberation Sans" }, { sourceAnnotationId: text.id });
    assert.deepEqual(reopened.getObjectLink(next), { type: "url", url: "https://example.com/keep-me" }, "editing a reopened textbox retains its outgoing link");
    assert.deepEqual(reopened.getObjectLink(owner), { type: "object", objectId: next }, "incoming references follow the replacement author model"); assert(reopened.isObjectLocked(owner), "automatic target rebinding preserves an incoming owner's lock");
    reopened.undo(); assert.deepEqual(reopened.getObjectLink(owner), { type: "object", objectId: previousTarget }); reopened.redo();
    const after = await reopened.getScene(); assert.equal(after.annotations.filter(a => a.subtype === "Link").length, 2, "replacing a textbox never duplicates old hotspots");
    const saved = new Uint8Array(await (await reopened.savePdf()).arrayBuffer()), final = await compile(saved);
    assert.equal(final.annotations.filter(a => a.subtype === "Link").length, 2);
    assert(final.annotations.some(a => a.subtype === "FreeText" && a.contents === "Changed text"));
    assert(final.annotations.some(a => a.subtype === "Link" && a.action?.uri === "https://example.com/keep-me"));
    console.log("Linked textbox replacement: outgoing links, incoming locked references, one-step Undo/Redo and duplicate-free PDF roundtrip passed.");
  } finally { reopened.dispose(); services.dispose(); }
} finally { hooks.deregister(); }
