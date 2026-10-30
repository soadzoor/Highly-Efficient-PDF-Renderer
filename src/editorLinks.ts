import type { AnnotationDestination, SceneAnnotation, ScenePdfPage } from "./annotationData";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { EditorLink, EditorObject, EditorSelectionFrame, EditorSession } from "./editorTypes";
import { editorPoint, editorTransformBounds, invertEditorMatrix, retainEditorAnnotationPlacements } from "./editorScene";
import { resolvePdfLinkUrl } from "./viewerLinkNavigation";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import { getEditorSceneTranslationHint, setEditorSceneTranslationHint } from "./editorScenePreview";

export const EDITOR_LINK_PREFIX = "editor-link:", EDITOR_TARGET_PREFIX = "editor-target:";
const rebinders = new WeakMap<EditorSession, (previous: string, replacement: string) => void>();
/** Private author-model replacement hook; no author identities are added to HEP. */
export function registerEditorLinkRebinder(session: EditorSession, rebind: (previous: string, replacement: string) => void): void { rebinders.set(session, rebind); }
export function rebindEditorLinkTarget(session: EditorSession, previous: string, replacement: string): void { rebinders.get(session)?.(previous, replacement); }
export interface EditorSourceLink { ownerId: string; annotationId: string; link: EditorLink }
const bindings = new WeakMap<VectorScene, ReadonlyMap<string, EditorSourceLink>>();
const sourceAnnotations = new WeakMap<VectorScene, ReadonlyMap<string, SceneAnnotation>>();
const diagnostics = new WeakMap<VectorScene, readonly PdfDiagnostic[]>();
/** Operation-local export notices, never serialized as document/editor data. */
export function getEditorLinkDiagnostics(scene: VectorScene): readonly PdfDiagnostic[] { return diagnostics.get(scene) ?? []; }
const annotationLookups = new WeakMap<VectorScene, { ids: Map<string, SceneAnnotation>; names: Map<string, SceneAnnotation[]> }>();
function lookup(scene: VectorScene) {
  let value = annotationLookups.get(scene); if (value) return value;
  value = { ids: new Map(), names: new Map() };
  for (const annotation of scene.annotations ?? []) if (annotation.subtype !== "Link") {
    value.ids.set(annotation.id, annotation); value.ids.set(`annotation:${annotation.id}`, annotation);
    if (annotation.name) { const entries = value.names.get(annotation.name) ?? []; entries.push(annotation); value.names.set(annotation.name, entries); }
  }
  annotationLookups.set(scene, value); return value;
}
const decode = (value: string | undefined, prefix: string): string | undefined => {
  if (!value?.startsWith(prefix)) return;
  try { return decodeURIComponent(value.slice(prefix.length)); } catch { return; }
};

export function validateEditorLink(link: EditorLink): void {
  if (!link || typeof link !== "object") throw new TypeError("A link requires a URL or a destination.");
  if (link.type === "url") {
    if (typeof link.url !== "string" || !resolvePdfLinkUrl(link.url.trim())) throw new TypeError("Enter an absolute HTTP, HTTPS, mailto or tel URL.");
  } else if (link.type === "object") {
    if (typeof link.objectId !== "string" || !link.objectId) throw new TypeError("Choose a destination object.");
  } else if (link.type === "destination") {
    const d = link.destination;
    if (!d || !Number.isSafeInteger(d.sourcePageIndex) || d.sourcePageIndex! < 0 ||
        d.fit !== undefined && !["Fit", "FitB", "FitR", "XYZ", "FitH", "FitBH", "FitV", "FitBV"].includes(d.fit) ||
        d.parameters !== undefined && (!Array.isArray(d.parameters) || d.parameters.length > 4 || d.parameters.some(n => n !== null && !Number.isFinite(n)))) throw new TypeError("Invalid local PDF destination.");
  } else throw new TypeError("Unsupported link type.");
}

function identifiableObject(scene: VectorScene, id: string, pageIndex?: number): string | undefined {
  // Anonymous primitive indices can change on save/reopen. Never bind a saved
  // destination to another primitive which happens to reuse the old index.
  if (/^(source:|source-group:)/.test(id)) return;
  const data = lookup(scene), direct = data.ids.get(id);
  const annotation = direct && (pageIndex === undefined || direct.pageIndex === pageIndex) ? direct : data.names.get(id)?.find(item => pageIndex === undefined || item.pageIndex === pageIndex);
  return annotation && `annotation:${annotation.id}`;
}

/** Standard names retain bindings where PDF annotation identities are available. */
export function editorSourceLinks(scene: VectorScene): ReadonlyMap<string, EditorSourceLink> {
  const cached = bindings.get(scene); if (cached) return cached;
  const result = new Map<string, EditorSourceLink>(), originals = new Map<string, SceneAnnotation>();
  for (const annotation of scene.annotations ?? []) {
    if (annotation.subtype !== "Link") continue;
    const original = decode(annotation.name ?? annotation.id, EDITOR_LINK_PREFIX);
    const ownerId = original && identifiableObject(scene, original, annotation.pageIndex) || `annotation:${annotation.id}`;
    // A source URI may require the viewer's URL base, or describe an action the
    // editor cannot author. Keep its owner identity even when no editable link
    // model can represent it, so an explicit override never duplicates it.
    originals.set(ownerId, annotation);
    let link: EditorLink | undefined;
    if (annotation.action?.type === "URI" && annotation.action.uri) {
      const uri = resolvePdfLinkUrl(annotation.action.uri, undefined, annotation.action.uriBase);
      if (uri) link = { type: "url", url: uri };
    } else {
      const destination = annotation.action?.type === "GoTo" ? annotation.action.destination : !annotation.action ? annotation.destination : undefined;
      if (destination?.sourcePageIndex !== undefined) {
        const target = decode(destination.name, EDITOR_TARGET_PREFIX);
        const targetPage = scene.pdfPages?.find(page => page.sourcePageIndex === destination.sourcePageIndex)?.pageIndex;
        const rebound = target && identifiableObject(scene, target, targetPage);
        link = rebound ? { type: "object", objectId: rebound } : { type: "destination", destination: structuredClone(destination) };
      }
    }
    if (!link) continue;
    result.set(ownerId, { ownerId, annotationId: annotation.id, link });
  }
  sourceAnnotations.set(scene, originals);
  bindings.set(scene, result); return result;
}

/** Includes unresolved relative URIs and inert source actions, without authoring them. */
export function editorSourceLinkAnnotation(scene: VectorScene, ownerId: string): SceneAnnotation | undefined {
  editorSourceLinks(scene); return sourceAnnotations.get(scene)?.get(ownerId);
}

/** Generated metadata links pick their visual owner in Edit rather than a phantom object. */
export function editorLinkSelectionOwner(session: EditorSession, annotation: SceneAnnotation): string | null {
  const original = decode(annotation.name ?? annotation.id, EDITOR_LINK_PREFIX);
  if (original) {
    try { const object = session.getObject(original); if (object.pageIndex === annotation.pageIndex) return object.id; } catch { /* Saved IDs may have become annotation identities. */ }
    const rebound = identifiableObject(session.sourceScene, original, annotation.pageIndex);
    if (rebound) return rebound;
  }
  return session.sourceScene.annotations?.some(item => item.id === annotation.id) ? `annotation:${annotation.id}` : null;
}

/** Add ordinary Link annotation metadata only; drawing buffers stay unchanged. */
export function compileEditorLinks(scene: VectorScene, source: VectorScene, owners: readonly string[], context: {
  getObject(id: string): EditorObject;
  getFrame(id: string): EditorSelectionFrame;
  getLink(id: string): EditorLink | null;
  isDeleted(id: string): boolean;
  condition(id: string): number | undefined;
  onDiagnostic?(diagnostic: PdfDiagnostic): void;
}): VectorScene {
  if (!owners.length) return scene;
  const notices: PdfDiagnostic[] = [];
  const initial = editorSourceLinks(source), ownerSet = new Set(owners), replaced = new Set([...initial.values()].filter(value => ownerSet.has(value.ownerId)).map(value => value.annotationId));
  for (const id of owners) { const inherited = editorSourceLinkAnnotation(source, id); if (inherited) replaced.add(inherited.id); }
  const stableId = (object: EditorObject): string => {
    const annotation = object.kind === "source" && object.annotationId ? lookup(source).ids.get(object.annotationId) : undefined;
    return annotation?.name && lookup(source).names.get(annotation.name)?.length === 1 ? annotation.name : object.id;
  };
  const names = new Set(owners.flatMap(id => { try { return [`${EDITOR_LINK_PREFIX}${encodeURIComponent(id)}`, `${EDITOR_LINK_PREFIX}${encodeURIComponent(stableId(context.getObject(id)))}`]; } catch { return []; } }));
  const annotations = (scene.annotations ?? []).filter(annotation => !replaced.has(annotation.id) && !names.has(annotation.name ?? annotation.id));
  let pdfPages: ScenePdfPage[] | undefined;
  const page = (pageIndex: number): ScenePdfPage => {
    pdfPages ??= scene.pdfPages?.map(value => ({ ...value })) ?? [];
    let result = pdfPages.find(value => value.pageIndex === pageIndex);
    if (!result) {
      const used = new Set(pdfPages.map(value => value.sourcePageIndex)); let sourcePageIndex = pageIndex; while (used.has(sourcePageIndex)) sourcePageIndex++;
      result = { pageIndex, sourcePageIndex, pdfToScene: [1, 0, 0, 1, scene.pageRects[pageIndex * 4], scene.pageRects[pageIndex * 4 + 1]] }; pdfPages.push(result);
    }
    return result;
  };
  for (const id of owners) {
    if (context.isDeleted(id)) continue;
    const link = context.getLink(id); if (!link) continue;
    const object = context.getObject(id), frame = context.getFrame(id), original = initial.get(id), inherited = editorSourceLinkAnnotation(source, id);
    const annotation = object.kind === "source" && object.annotationId ? scene.annotations?.find(value => value.id === object.annotationId) : undefined;
    let points: number[];
    if (annotation?.quadPoints?.length) points = [...annotation.quadPoints];
    else if (object.kind === "shape" && object.review?.quads) points = object.review.quads.flatMap(quad => quad.flatMap(([x, y]) =>
      editorPoint(frame.transform, x, y)));
    else {
      const b = frame.bounds, padX = b.maxX > b.minX ? 0 : .5, padY = b.maxY > b.minY ? 0 : .5;
      points = [[b.minX - padX, b.maxY + padY], [b.maxX + padX, b.maxY + padY], [b.minX - padX, b.minY - padY], [b.maxX + padX, b.minY - padY]].flatMap(([x, y]) => editorPoint(frame.transform, x, y));
    }
    const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let index = 0; index < points.length; index += 2) { bounds.minX = Math.min(bounds.minX, points[index]); bounds.maxX = Math.max(bounds.maxX, points[index]); bounds.minY = Math.min(bounds.minY, points[index + 1]); bounds.maxY = Math.max(bounds.maxY, points[index + 1]); }
    if (!points.every(Number.isFinite) || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) continue;
    const ownerPage = page(object.pageIndex), inverse = invertEditorMatrix(ownerPage.pdfToScene), pdf = editorTransformBounds(bounds, inverse);
    let destination: AnnotationDestination | undefined;
    if (link.type === "object") {
      try {
        if (context.isDeleted(link.objectId)) throw new Error("The destination object was removed.");
        const target = context.getObject(link.objectId), targetFrame = context.getFrame(link.objectId), targetBounds = editorTransformBounds(targetFrame.bounds, targetFrame.transform);
        const targetPage = page(target.pageIndex), pdfBounds = editorTransformBounds(targetBounds, invertEditorMatrix(targetPage.pdfToScene));
        destination = { name: `${EDITOR_TARGET_PREFIX}${encodeURIComponent(stableId(target))}`, sourcePageIndex: targetPage.sourcePageIndex,
          fit: "FitR", parameters: [pdfBounds.minX, pdfBounds.minY, Math.max(pdfBounds.minX + .01, pdfBounds.maxX), Math.max(pdfBounds.minY + .01, pdfBounds.maxY)] };
      } catch (error) {
        const notice: PdfDiagnostic = { code: "editor.link-target-missing", severity: "warning", pageIndex: object.pageIndex, message: `A link was omitted because its destination object is unavailable: ${error instanceof Error ? error.message : String(error)}` };
        notices.push(notice); context.onDiagnostic?.(notice); continue;
      }
    } else if (link.type === "destination") destination = structuredClone(link.destination);
    const name = `${EDITOR_LINK_PREFIX}${encodeURIComponent(stableId(object))}`;
    const condition = context.condition(id);
    const pdfPoints = points.flatMap((_, index) => index % 2 ? [] : editorPoint(inverse, points[index], points[index + 1]));
    annotations.push({ id: original?.annotationId ?? inherited?.id ?? name, name, subtype: "Link", pageIndex: object.pageIndex, sourcePageIndex: ownerPage.sourcePageIndex,
      annotationIndex: (source.annotations?.length ?? 0) + annotations.length, bounds, quadPoints: points,
      pdfGeometry: { rect: [pdf.minX, pdf.minY, pdf.maxX, pdf.maxY], quadPoints: pdfPoints }, flags: 4, visibleInDefaultView: true,
      hasAppearance: false, border: { width: 0 }, ...(condition === undefined ? {} : { optionalContent: condition }),
      ...(link.type === "url" ? { action: { type: "URI", uri: link.url } } : { destination }) });
  }
  const result: VectorScene = { ...scene, annotations, ...(pdfPages ? { pdfPages } : {}) };
  retainEditorAnnotationPlacements(scene, result);
  diagnostics.set(result, notices);
  const hint = getEditorSceneTranslationHint(scene); if (hint) setEditorSceneTranslationHint(result, hint);
  return result;
}
