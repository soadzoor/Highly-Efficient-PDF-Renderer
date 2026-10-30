import type { VectorScene } from "./pdfVectorExtractor";
import type { EditorSession, EditorSessionOptions } from "./editorTypes";
import { waitForLoad } from "./loadCancellation";

/** Editing is loaded on demand; renderer-only consumers do not load its runtime. */
export async function openEditorSession(scene: VectorScene, options: EditorSessionOptions = {}): Promise<EditorSession> {
  const version = await openSingleEditorSession(scene, options);
  try {
    const { createEditorDocumentSession } = await waitForLoad(import("./editorDocumentSession"), options.signal);
    return createEditorDocumentSession(version, openSingleEditorSession);
  } catch (error) { version.session.dispose(); throw error; }
}

async function openSingleEditorSession(scene: VectorScene, options: EditorSessionOptions) {
  let sourceReleased = false;
  const releaseSource = () => { if (!sourceReleased) { sourceReleased = true; options.disposeSource?.(); } };
  let runtime: typeof import("./editorSessionRuntime");
  try { options.signal?.throwIfAborted(); runtime = await waitForLoad(import("./editorSessionRuntime"), options.signal); }
  catch (error) { releaseSource(); throw error; }
  const { createEditorSession } = runtime;
  let services: Promise<Awaited<ReturnType<typeof import("./editorAppServices")["createEditorAppServices"]>>> | undefined;
  let disposed = false;
  const getServices = () => services ??= import("./editorAppServices").then(async ({ createEditorAppServices }) => {
    const result = await createEditorAppServices(options);
    if (disposed) result.dispose();
    return result;
  });
  let preparedScene: VectorScene;
  try {
    const prepare = options.prepareScene ?? (options.sourcePdf ? (await getServices()).sessionOptions.prepareScene : undefined);
    preparedScene = prepare ? await prepare(scene, options.signal) : scene;
    options.signal?.throwIfAborted();
  } catch (error) {
    disposed = true; if (services) void services.then(value => value.dispose(), () => {}); releaseSource(); throw error;
  }
  const sessionOptions: EditorSessionOptions = {
    ...options,
    compileObject: options.compileObject ?? (async (object, signal) => object.kind === "text"
      ? (await getServices()).sessionOptions.compileObject!(object, signal)
      : (await import("./editorSceneObjects")).compileEditorObjectGeometry(object, signal)),
    compileFields: options.compileFields ?? (async (source, values, signal) =>
      (await getServices()).sessionOptions.compileFields!(source, values, signal)),
    captureRecoveryFonts: options.captureRecoveryFonts ?? (async () => (await getServices()).sessionOptions.captureRecoveryFonts!()),
    restoreRecoveryFonts: options.restoreRecoveryFonts ?? (async (fonts, signal) => (await getServices()).sessionOptions.restoreRecoveryFonts!(fonts, signal)),
    savePdf: options.savePdf ?? (async (source, owner, saveOptions) => options.sourcePdf ||
      (!saveOptions.flatten && owner.getObjects().some(object => object.kind !== "group" && (object.kind !== "source" || object.isClone)))
      ? (await getServices()).sessionOptions.savePdf!(source, owner, saveOptions)
      : (await import("./editorPdfWriter")).writeScenePdf(source, saveOptions)),
    createSourceOptions: options.createSourceOptions ?? (async (sourcePdf, password) => {
      const services = await getServices();
      const fork = services.sessionOptions.createSourceOptions
        ? await services.sessionOptions.createSourceOptions(sourcePdf, password)
        : (await (await import("./editorAppServices")).createEditorAppServices({ ...options, sourcePdf, password })).sessionOptions;
      return { ...fork, sourcePdf, password, loadFontAsset: options.loadFontAsset,
        ...(options.compileObject ? { compileObject: options.compileObject } : {}) };
    })
  };
  let session: EditorSession;
  try { session = createEditorSession(preparedScene, sessionOptions); }
  catch (error) { disposed = true; if (services) void services.then(value => value.dispose(), () => {}); releaseSource(); throw error; }
  const dispose = session.dispose.bind(session);
  session.dispose = () => {
    if (disposed) return;
    disposed = true; dispose(); releaseSource();
    if (services) void services.then(value => value.dispose(), () => {});
  };
  return { session, options: { ...sessionOptions, signal: undefined } };
}
export type * from "./editorTypes";
