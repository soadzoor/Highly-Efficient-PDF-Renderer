import { scanDensePdfPreparedResourceReferences, type DensePdfContentSegment, type DensePdfMatrix } from "./nativeContentCompiler";
import { isPdfName, isPdfStream, type PdfDictionary, type PdfStream, type PdfValue } from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import { multiplyNativePdfMatrices, transformNativePdfRectangle } from "./nativeFormGeometry";
import { prepareNativeInlineImages } from "./nativeInlineImage";
import type { NativeOptionalContentRegistry } from "./nativeOptionalContent";
import { computeNativePdfPageGeometry } from "./nativePageGeometry";
import { PdfError } from "./nativeTypes";
import type { NativeVectorCompileOptions } from "../pdfSession";

export type PdfPageOverviewKind = "vector" | "ocr" | "raster";

interface InspectionState { matrix: DensePdfMatrix; renderingMode: number; fillAlpha: number; strokeAlpha: number }
interface InspectionOperator { operator: string; operands: readonly unknown[]; property?: PdfValue }
const INSPECT_OPERATORS = new Set(["q", "Q", "cm", "Tr", "gs", "Tj", "TJ", "'", '"', "Do", "BMC", "BDC", "EMC"]);

/** Inspect paint and text modes without invoking any image codec or deriving font outlines. */
export async function inspectNativePageOverview(document: NativePdfDocument, sourcePageIndex: number,
  options: NativeVectorCompileOptions, signal: AbortSignal, optionalContent: NativeOptionalContentRegistry): Promise<PdfPageOverviewKind> {
  const page = document.getPage(sourcePageIndex);
  const { pageMatrix, pageBounds } = computeNativePdfPageGeometry(page);
  const pageArea = (pageBounds.maxX - pageBounds.minX) * (pageBounds.maxY - pageBounds.minY);
  let imageCoverage = 0, hiddenTextBytes = 0, visibleTextBytes = 0, commands = 0, decodedBytes = 0;
  const maxCommands = options.limits?.maxCommandsPerPage ?? document.limits.maxCommandsPerPage;
  const activeForms = new Set<PdfStream>();
  const imagePaint = (state: InspectionState) => {
    const bounds = transformNativePdfRectangle([0, 0, 1, 1], state.matrix);
    const area = Math.max(0, Math.min(bounds.maxX, pageBounds.maxX) - Math.max(bounds.minX, pageBounds.minX)) *
      Math.max(0, Math.min(bounds.maxY, pageBounds.maxY) - Math.max(bounds.minY, pageBounds.minY));
    imageCoverage += Math.min(area, Math.abs(state.matrix[0] * state.matrix[3] - state.matrix[1] * state.matrix[2]));
  };
  const walk = async (streams: readonly PdfStream[], resources: PdfDictionary, inherited: InspectionState, depth: number) => {
    if (depth > document.limits.maxRecursionDepth) throw new PdfError("resource-limit", "Page overview Form nesting exceeds the limit.");
    const segments: DensePdfContentSegment[] = [];
    let offset = 0;
    for (const stream of streams) {
      const bytes = await document.decodeStream(stream, signal);
      decodedBytes += bytes.length;
      if (decodedBytes > document.limits.maxDecodedStreamBytes) throw new PdfError("resource-limit", "Page overview content exceeds the decoded byte limit.");
      const prepared = prepareNativeInlineImages(bytes, { signal, sourceOffset: offset });
      segments.push(...prepared.segments.map(segment => segment.kind === "content" ? segment : {
        kind: "image" as const, imageIndex: 0, sourceOffset: segment.sourceOffset, sourceLength: segment.sourceLength
      }));
      offset += bytes.length;
      segments.push({ kind: "content", bytes: Uint8Array.of(10), sourceOffset: offset++, sourceLength: 1 });
    }
    const operators: InspectionOperator[] = [];
    const countCommand = () => {
      if (++commands > maxCommands) throw new PdfError("resource-limit", "Page overview content exceeds the command limit.");
    };
    scanDensePdfPreparedResourceReferences(segments, { signal,
      onOperator(operator, operands, property) {
        countCommand();
        if (INSPECT_OPERATORS.has(operator)) operators.push({ operator, operands, property });
      },
      onInlineImage() { countCommand(); operators.push({ operator: "BI", operands: [] }); }
    });
    let state = { ...inherited };
    const graphics: InspectionState[] = [];
    const visible = [true];
    for (const { operator, operands, property } of operators) {
      signal.throwIfAborted();
      if (operator === "q") {
        if (graphics.length >= document.limits.maxRecursionDepth) throw new PdfError("resource-limit", "Page overview graphics nesting exceeds the limit.");
        graphics.push({ ...state });
      } else if (operator === "Q") {
        const restored = graphics.pop();
        if (!restored) throw new PdfError("invalid-object", "Page overview graphics stack underflow.");
        state = restored;
      } else if (operator === "cm") state.matrix = multiplyNativePdfMatrices(state.matrix, operands as number[]);
      else if (operator === "Tr") state.renderingMode = Number(operands[0]);
      else if (operator === "gs") {
        const states = resources.get("ExtGState");
        if (states) {
          const value = (await document.resolveDictionary(states, signal)).get(String(operands[0]));
          const extended = await document.resolveDictionary(value, signal);
          const alpha = await document.resolveValue(extended.get("ca"), signal);
          if (typeof alpha === "number") state.fillAlpha = alpha;
          const strokeAlpha = await document.resolveValue(extended.get("CA"), signal);
          if (typeof strokeAlpha === "number") state.strokeAlpha = strokeAlpha;
        }
      } else if (operator === "BMC" || operator === "BDC") {
        let ownVisible = true;
        if (operator === "BDC" && operands[0] === "OC") {
          const properties = resources.get("Properties");
          const value = typeof operands[1] === "string" && properties
            ? (await document.resolveDictionary(properties, signal)).get(operands[1]) : property;
          ownVisible = value ? (await optionalContent.resolvePropertyValue(value, signal))?.defaultVisible ?? true : true;
        }
        if (visible.length > document.limits.maxRecursionDepth) throw new PdfError("resource-limit", "Page overview marked-content nesting exceeds the limit.");
        visible.push(visible.at(-1)! && ownVisible);
      } else if (operator === "EMC") {
        if (visible.length === 1) throw new PdfError("invalid-object", "Page overview marked-content stack underflow.");
        visible.pop();
      } else if (visible.at(-1)) {
        if (operator === "BI") imagePaint(state);
        else if (operator === "Do") {
          const objects = resources.get("XObject");
          if (!objects) continue;
          const value = (await document.resolveDictionary(objects, signal)).get(String(operands[0]));
          const object = await document.resolveValue(value, signal);
          if (!isPdfStream(object)) continue;
          const oc = object.dictionary.get("OC");
          if (oc && (await optionalContent.resolvePropertyValue(oc, signal))?.defaultVisible === false) continue;
          const subtype = await document.resolveValue(object.dictionary.get("Subtype"), signal);
          if (isPdfName(subtype, "Image")) imagePaint(state);
          else if (isPdfName(subtype, "Form")) {
            if (activeForms.has(object)) throw new PdfError("resource-limit", "Cyclic page overview Form reference.");
            activeForms.add(object);
            try {
              const matrix = await document.resolveValue(object.dictionary.get("Matrix"), signal);
              const ownResources = object.dictionary.get("Resources");
              await walk([object], ownResources ? await document.resolveDictionary(ownResources, signal) : resources,
                { ...state, matrix: Array.isArray(matrix) ? multiplyNativePdfMatrices(state.matrix, matrix as number[]) : state.matrix }, depth + 1);
            } finally { activeForms.delete(object); }
          }
        } else {
          const bytes = textOperandBytes(operands);
          if (state.renderingMode === 7) continue;
          const fill = [0, 2, 4, 6].includes(state.renderingMode) && state.fillAlpha > .001;
          const stroke = [1, 2, 5, 6].includes(state.renderingMode) && state.strokeAlpha > .001;
          if (fill || stroke) visibleTextBytes += bytes;
          else hiddenTextBytes += bytes;
        }
      }
    }
    if (visible.length !== 1) throw new PdfError("invalid-object", "Unbalanced page overview marked content.");
  };
  await walk(await document.getPageContentStreams(sourcePageIndex, signal),
    page.resources ? await document.resolveDictionary(page.resources, signal) : new Map(),
    { matrix: pageMatrix, renderingMode: 0, fillAlpha: 1, strokeAlpha: 1 }, 0);
  // A small logo or illustration must not change a vector page's loading policy.
  // Mixed pages with substantial visible text retain their original vector scene.
  // OCR scans often include wide margins, so they need not cover the entire page.
  if (imageCoverage >= pageArea * .5 && hiddenTextBytes > 0 && hiddenTextBytes > visibleTextBytes * 4) return "ocr";
  if (!(imageCoverage >= pageArea * .75)) return "vector";
  return visibleTextBytes === 0 ? "raster" : "vector";
}

function textOperandBytes(operands: readonly unknown[]): number {
  return operands.reduce<number>((sum, value) => sum + (value instanceof Uint8Array ? value.length
    : Array.isArray(value) ? textOperandBytes(value) : 0), 0);
}
