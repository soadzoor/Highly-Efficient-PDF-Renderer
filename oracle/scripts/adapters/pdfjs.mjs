import { createHash } from "node:crypto";

import { hashCanonical } from "../lib/canonical.mjs";

const EXPECTED_PDFJS_VERSION = "6.1.200";
const SEMANTIC_CHUNK_SIZE = 256;

export async function createEngine() {
  const canvas = await import("@napi-rs/canvas");
  installCanvasGlobals(canvas);

  const pdfModuleUrl = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = await import(pdfModuleUrl);
  if (pdfjs.version !== EXPECTED_PDFJS_VERSION) {
    throw new Error(
      `Differential oracle requires pdfjs-dist ${EXPECTED_PDFJS_VERSION}; resolved ${String(pdfjs.version)}.`
    );
  }

  const packageRoot = new URL("../../", pdfModuleUrl);
  const operationNames = new Map(
    Object.entries(pdfjs.OPS).map(([name, value]) => [Number(value), name])
  );

  return {
    identity: {
      id: "pdfjs-dist",
      version: pdfjs.version,
      build: pdfjs.build
    },

    async openDocument({ bytes, label }) {
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        cMapUrl: new URL("cmaps/", packageRoot).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("standard_fonts/", packageRoot).href,
        wasmUrl: new URL("wasm/", packageRoot).href,
        disableFontFace: true,
        fontExtraProperties: true,
        isEvalSupported: false,
        useSystemFonts: false,
        useWorkerFetch: false,
        verbosity: 0,
        docBaseUrl: `file:///hepr-oracle/${encodeURIComponent(label)}`
      });
      const document = await loadingTask.promise;

      return {
        pageCount: document.numPages,

        async getDocumentMetadata() {
          const metadata = await document.getMetadata();
          return {
            fingerprints: [...document.fingerprints],
            info: normalizeJson(metadata?.info ?? null),
            metadata: normalizeJson(metadata?.metadata?.getAll?.() ?? null),
            contentDispositionFilename: metadata?.contentDispositionFilename ?? null,
            contentLength: finiteIntegerOrNull(metadata?.contentLength)
          };
        },

        async getPage(sourcePageIndex) {
          const page = await document.getPage(sourcePageIndex + 1);
          return createPageAdapter(page, sourcePageIndex, pdfjs, canvas, operationNames);
        },

        async close() {
          await loadingTask.destroy();
        }
      };
    }
  };
}

function createPageAdapter(page, sourcePageIndex, pdfjs, canvas, operationNames) {
  return {
    async getMetadata() {
      const viewport = page.getViewport({ scale: 1, rotation: page.rotate, dontFlip: false });
      const annotations = await page.getAnnotations({ intent: "display" });
      return {
        sourcePageIndex,
        rotation: normalizeNumber(page.rotate),
        userUnit: normalizeNumber(page.userUnit),
        view: normalizeNumberArray(page.view),
        viewport: {
          width: normalizeNumber(viewport.width),
          height: normalizeNumber(viewport.height),
          viewBox: normalizeNumberArray(viewport.viewBox),
          transform: normalizeNumberArray(viewport.transform)
        },
        annotations: annotations.map(normalizeAnnotation)
      };
    },

    async getNormalizedText() {
      const content = await page.getTextContent({
        includeMarkedContent: true,
        disableNormalization: false
      });
      return normalizeTextContent(content.items);
    },

    async getSemanticSummary() {
      const operatorList = await page.getOperatorList({
        intent: "display",
        annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS
      });
      return summarizeOperatorList(operatorList, operationNames);
    },

    async renderPng(scale, { maxRenderPixels }) {
      const viewport = page.getViewport({ scale, rotation: page.rotate, dontFlip: false });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
        throw new Error(`Page ${sourcePageIndex} produced invalid ${scale}x dimensions ${width}x${height}.`);
      }
      if (width * height > maxRenderPixels) {
        throw new Error(
          `Page ${sourcePageIndex} at ${scale}x requires ${width * height} pixels, exceeding ` +
          `--max-render-pixels=${maxRenderPixels}.`
        );
      }

      const surface = canvas.createCanvas(width, height);
      const context = surface.getContext("2d");
      context.save();
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.restore();
      const renderTask = page.render({
        canvas: surface,
        canvasContext: context,
        viewport,
        background: "#ffffff",
        annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
        intent: "display"
      });
      await renderTask.promise;
      return {
        width,
        height,
        bytes: surface.toBuffer("image/png")
      };
    },

    async close() {
      page.cleanup();
    }
  };
}

function summarizeOperatorList(operatorList, operationNames) {
  const sequenceHash = createHash("sha256");
  const argumentHash = createHash("sha256");
  const semanticHash = createHash("sha256");
  const histogram = new Map();
  const chunks = [];
  let chunkHash = createHash("sha256");
  let chunkStart = 0;

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operationCode = Number(operatorList.fnArray[index]);
    const operationName = operationNames.get(operationCode) ?? `unknown:${operationCode}`;
    const argumentsDigest = hashCanonical(operatorList.argsArray[index], { numberDigits: 12 });
    histogram.set(operationName, (histogram.get(operationName) ?? 0) + 1);
    sequenceHash.update(operationName).update("\0");
    argumentHash.update(argumentsDigest).update("\0");
    semanticHash.update(operationName).update("\0").update(argumentsDigest).update("\0");
    chunkHash.update(operationName).update("\0").update(argumentsDigest).update("\0");

    const chunkLength = index - chunkStart + 1;
    if (chunkLength === SEMANTIC_CHUNK_SIZE || index + 1 === operatorList.fnArray.length) {
      chunks.push({
        start: chunkStart,
        length: chunkLength,
        sha256: chunkHash.digest("hex")
      });
      chunkStart = index + 1;
      chunkHash = createHash("sha256");
    }
  }

  return {
    operatorCount: operatorList.fnArray.length,
    histogram: Object.fromEntries([...histogram].sort(([left], [right]) => left.localeCompare(right))),
    sequenceSha256: sequenceHash.digest("hex"),
    argumentsSha256: argumentHash.digest("hex"),
    semanticSha256: semanticHash.digest("hex"),
    separateAnnotationsSha256: hashCanonical(operatorList.separateAnnots ?? null),
    chunks
  };
}

function normalizeTextContent(items) {
  let value = "";
  for (const item of items) {
    if (!item || typeof item !== "object" || typeof item.str !== "string") {
      continue;
    }
    value += item.str;
    if (item.hasEOL) {
      value += "\n";
    }
  }
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeAnnotation(annotation) {
  return {
    annotationType: finiteIntegerOrNull(annotation?.annotationType),
    subtype: stringOrNull(annotation?.subtype),
    rect: normalizeNumberArray(annotation?.rect),
    color: normalizeNumberArray(annotation?.color),
    flags: finiteIntegerOrNull(annotation?.annotationFlags ?? annotation?.flags),
    fieldType: stringOrNull(annotation?.fieldType),
    fieldName: stringOrNull(annotation?.fieldName),
    hasAppearance: Boolean(annotation?.hasAppearance),
    hidden: Boolean(annotation?.hidden),
    printable: Boolean(annotation?.print),
    viewable: annotation?.viewable === undefined ? null : Boolean(annotation.viewable),
    readOnly: annotation?.readOnly === undefined ? null : Boolean(annotation.readOnly)
  };
}

function normalizeJson(value, depth = 0) {
  if (depth > 16) {
    return "[depth-limit]";
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return normalizeNumber(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item, depth + 1));
  }
  if (typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (typeof item !== "function" && item !== undefined) {
        output[key] = normalizeJson(item, depth + 1);
      }
    }
    return output;
  }
  return String(value);
}

function normalizeNumberArray(value) {
  if (!value || typeof value.length !== "number") {
    return null;
  }
  return Array.from(value, normalizeNumber);
}

function normalizeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  if (Object.is(number, -0)) {
    return 0;
  }
  return Number(number.toPrecision(12));
}

function finiteIntegerOrNull(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function stringOrNull(value) {
  return typeof value === "string" ? value.normalize("NFC") : null;
}

function installCanvasGlobals(canvas) {
  for (const name of ["DOMMatrix", "ImageData", "Path2D"]) {
    if (globalThis[name] === undefined && canvas[name] !== undefined) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: canvas[name],
        writable: true
      });
    }
  }
}
