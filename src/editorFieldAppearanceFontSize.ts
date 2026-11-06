import { isPdfDictionary, isPdfName, isPdfStream, type PdfDictionary, type PdfStream, type PdfValue } from "./pdf/nativeCos";
import type { NativePdfDocument } from "./pdf/nativeDocument";
import type { NativePdfAnnotationAppearance, NativePdfMatrix, NativePdfRectangle } from "./pdf/nativeForms";
import { computeNativePdfAnnotationPlacement, multiplyNativePdfMatrices } from "./pdf/nativeFormGeometry";
import { scanDensePdfResourceReferences } from "./pdf/nativeContentCompiler";
import { prepareNativeInlineImages } from "./pdf/nativeInlineImage";
import { throwIfAborted } from "./pdf/nativeTypes";
import { invertEditorMatrix } from "./editorScene";

export interface EditorFieldAppearanceFrame { rect: NativePdfRectangle; transform: NativePdfMatrix }
const IDENTITY: NativePdfMatrix = [1, 0, 0, 1, 0, 0];
const matrixOperand = (values: readonly unknown[]): values is NativePdfMatrix =>
  values.length === 6 && values.every(value => typeof value === "number" && Number.isFinite(value));
const hasText = (value: unknown): boolean => value instanceof Uint8Array ? value.length > 0 : Array.isArray(value) && value.some(hasText);

/** Read point sizes before render adapters bake glyph transforms into outlines. */
export async function readEditorFieldAppearanceFontSize(document: NativePdfDocument, annotation: NativePdfAnnotationAppearance,
  signal?: AbortSignal, frame?: EditorFieldAppearanceFrame): Promise<number | undefined> {
  const ap = await document.resolveValue(annotation.dictionary.get("AP"), signal);
  if (!isPdfDictionary(ap)) return undefined;
  let normal = await document.resolveValue(ap.get("N"), signal);
  if (isPdfDictionary(normal)) normal = await document.resolveValue(annotation.appearanceState !== undefined
    ? normal.get(annotation.appearanceState) : normal.size === 1 ? normal.values().next().value : undefined, signal);
  if (!isPdfStream(normal)) return undefined;
  const numbers = async (value: PdfValue | undefined, count: number): Promise<number[] | undefined> => {
    const array = await document.resolveValue(value, signal); if (!Array.isArray(array) || array.length !== count) return undefined;
    const resolved = await Promise.all(array.map(item => document.resolveValue(item, signal)));
    return resolved.every(item => typeof item === "number" && Number.isFinite(item)) ? resolved as number[] : undefined;
  };
  const bbox = await numbers(normal.dictionary.get("BBox"), 4);
  const matrix = normal.dictionary.get("Matrix") == null ? IDENTITY : await numbers(normal.dictionary.get("Matrix"), 6);
  if (!bbox || !matrix || !matrixOperand(matrix)) return undefined;
  const bounds: NativePdfRectangle = [Math.min(bbox[0], bbox[2]), Math.min(bbox[1], bbox[3]), Math.max(bbox[0], bbox[2]), Math.max(bbox[1], bbox[3])];
  const placement = computeNativePdfAnnotationPlacement(annotation, { bbox: bounds, matrix }, [...IDENTITY]).invocationMatrix;
  const transform = multiplyNativePdfMatrices(frame ? invertEditorMatrix(frame.transform) : IDENTITY, multiplyNativePdfMatrices(placement, matrix));
  interface State { transform: NativePdfMatrix; fontSize: number; renderingMode: number }
  const active = new Set<PdfStream>();
  const visit = async (stream: PdfStream, inherited: PdfDictionary, initial: State, depth: number): Promise<number | undefined> => {
    throwIfAborted(signal);
    if (active.has(stream) || depth >= document.limits.maxRecursionDepth) return undefined;
    active.add(stream);
    try {
      const declared = await document.resolveValue(stream.dictionary.get("Resources"), signal);
      const resources = isPdfDictionary(declared) ? declared : inherited;
      const content = await document.decodeStream(stream, signal), prepared = prepareNativeInlineImages(content, { signal });
      const operations: { operator: string; operands: readonly unknown[] }[] = [];
      for (const segment of prepared.segments) if (segment.kind === "content") scanDensePdfResourceReferences(segment.bytes, { signal,
        onOperator: (operator, operands) => {
          if (["q", "Q", "cm", "BT", "Tf", "Tm", "Tr", "gs", "Do", "Tj", "TJ", "'", '"'].includes(operator)) operations.push({ operator, operands: [...operands] });
        } });
      let state = { ...initial }, textMatrix: NativePdfMatrix = IDENTITY;
      const stack: State[] = [];
      for (const { operator, operands } of operations) {
        throwIfAborted(signal);
        if (operator === "q") stack.push({ ...state });
        else if (operator === "Q") state = stack.pop() ?? state;
        else if (operator === "cm" && matrixOperand(operands)) state.transform = multiplyNativePdfMatrices(state.transform, operands);
        else if (operator === "BT") textMatrix = IDENTITY;
        else if (operator === "Tm" && matrixOperand(operands)) textMatrix = operands;
        else if (operator === "Tf" && typeof operands[1] === "number") state.fontSize = operands[1];
        else if (operator === "Tr" && typeof operands[0] === "number") state.renderingMode = operands[0];
        else if (operator === "gs" && typeof operands[0] === "string") {
          const states = await document.resolveValue(resources.get("ExtGState"), signal);
          const entry = isPdfDictionary(states) ? await document.resolveValue(states.get(operands[0]), signal) : undefined;
          const font = isPdfDictionary(entry) ? await document.resolveValue(entry.get("Font"), signal) : undefined;
          if (Array.isArray(font)) { const size = await document.resolveValue(font[1], signal); if (typeof size === "number") state.fontSize = size; }
        } else if (operator === "Do" && typeof operands[0] === "string") {
          const objects = await document.resolveValue(resources.get("XObject"), signal);
          const child = isPdfDictionary(objects) ? await document.resolveValue(objects.get(operands[0]), signal) : undefined;
          if (!isPdfStream(child) || !isPdfName(child.dictionary.get("Subtype"), "Form")) continue;
          const matrix = child.dictionary.get("Matrix") == null ? IDENTITY : await numbers(child.dictionary.get("Matrix"), 6);
          if (!matrix || !matrixOperand(matrix)) continue;
          const size = await visit(child, resources, { ...state, transform: multiplyNativePdfMatrices(state.transform, matrix) }, depth + 1);
          if (size !== undefined) return size;
        } else if (["Tj", "TJ", "'", '"'].includes(operator) && state.renderingMode !== 3 && state.renderingMode !== 7 && operands.some(hasText)) {
          const matrix = multiplyNativePdfMatrices(state.transform, textMatrix), size = Math.abs(state.fontSize) * Math.hypot(matrix[2], matrix[3]);
          if (Number.isFinite(size) && size > 0) return size;
        }
      }
      return undefined;
    } finally { active.delete(stream); }
  };
  return visit(normal, new Map(), { transform, fontSize: 0, renderingMode: 0 }, 0);
}
