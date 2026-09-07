import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { hashCanonical } from "../lib/canonical.mjs";

const SEMANTIC_SCHEMA = "hepr-display-program-v7";

let sourceHooks = null;
let sourceModules = null;

/**
 * Private differential candidate. It deliberately loads the source engine,
 * rather than the published bundle, so a comparison always exercises the
 * current checkout. PDF.js is never imported by this adapter.
 */
export async function createEngine({ repositoryRoot }) {
  const root = path.resolve(repositoryRoot);
  installSourceHooks(root);
  const [
    { openPdf },
    { renderHeprPageToCanvas2d },
    { createNodeBundledStandardFontResolver }
  ] = await loadSourceModules(root);
  const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const resolveMissingFont = createNodeBundledStandardFontResolver();

  return {
    identity: {
      id: "hepr-native",
      version: String(packageMetadata.version),
      build: "source-hep-v7-canvas2d-reference"
    },

    async openDocument({ bytes, label }) {
      const ownedBytes = new Uint8Array(bytes);
      const session = await openPdf(
        {
          kind: "bytes",
          bytes: ownedBytes,
          ownership: "copy",
          label
        },
        {
          repair: "safe",
          missingFontResolver: resolveMissingFont,
          imageCodecResolver: decodePackedImageWithCanvas
        }
      );
      let closed = false;

      return {
        pageCount: session.info.pageCount,

        async getDocumentMetadata() {
          assertDocumentOpen(closed);
          return toOracleDocumentMetadata(session.info);
        },

        async getPage(sourcePageIndex) {
          assertDocumentOpen(closed);
          const pageData = await session.compilePage(sourcePageIndex, {
            optimization: "safe"
          });
          return createPageAdapter(
            pageData,
            renderHeprPageToCanvas2d
          );
        },

        async close() {
          if (closed) return;
          closed = true;
          await session.close();
        }
      };
    }
  };
}

function createPageAdapter(initialPageData, renderHeprPageToCanvas2d) {
  let pageData = initialPageData;

  return {
    async getMetadata() {
      return toOraclePageMetadata(requirePageData(pageData));
    },

    async getNormalizedText() {
      return normalizeText(requirePageData(pageData).textIndex.text);
    },

    async getSemanticSummary() {
      return summarizeHeprPage(requirePageData(pageData));
    },

    async renderPng(scale, { maxRenderPixels }) {
      const page = requirePageData(pageData);
      const result = await renderHeprPageToCanvas2d(page, {
        scale,
        background: [1, 1, 1, 1],
        maxCanvasPixels: maxRenderPixels,
        surfaceFactory(width, height) {
          const canvas = createCanvas(width, height);
          return { canvas, context: canvas.getContext("2d") };
        }
      });
      return {
        width: result.width,
        height: result.height,
        bytes: result.surface.canvas.toBuffer("image/png")
      };
    },

    async close() {
      pageData = null;
    }
  };
}

function summarizeHeprPage(page) {
  const histogram = new Map();
  let commandCount = 0;
  const appendCommands = (commands) => {
    for (const command of commands) {
      commandCount += 1;
      const key = command.kind === "draw"
        ? `draw:${command.source}`
        : command.kind;
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
  };
  for (const group of page.displayProgram.groups) appendCommands(group.commands);
  for (const program of page.displayProgram.programs) appendCommands(program.commands);

  const stores = page.stores;
  const resources = {
    transforms: stores.transforms.values.length / 6,
    paths: stores.paths.pathVerbOffsets.length - 1,
    strokeSegments: stores.strokes.endpoints.length / 4,
    strokeStyles: stores.strokes.lineWidths.length,
    glyphs: stores.glyphs.fontIndices.length,
    fonts: stores.fonts.names.length,
    images: stores.images.widths.length,
    meshes: stores.meshes.kinds.length,
    functions: stores.functions.kinds.length,
    gradients: stores.gradients.kinds.length,
    patterns: stores.patterns.kinds.length,
    clips: stores.clips.parentIndices.length,
    colorSpaces: stores.colors.spaceKinds.length,
    paints: stores.paints.kinds.length,
    optionalContentEntries: stores.optionalContent.names.length,
    markedContentEntries: stores.markedContent.tags.length,
    groups: page.displayProgram.groups.length,
    programs: page.displayProgram.programs.length
  };

  return {
    schema: SEMANTIC_SCHEMA,
    commandCount,
    histogram: Object.fromEntries(
      [...histogram].sort(([left], [right]) => left.localeCompare(right))
    ),
    resources,
    displayProgramSha256: hashCanonical(page.displayProgram, { numberDigits: 12 }),
    resourceStoreSha256: hashCanonical(stores, { numberDigits: 12 }),
    textGeometrySha256: hashCanonical({
      charGlyphIndices: page.textIndex.charGlyphIndices,
      fallbackQuads: page.textIndex.fallbackQuads
    }, { numberDigits: 12 })
  };
}

function toOracleDocumentMetadata(info) {
  const pdfInfo = {
    PDFFormatVersion: info.pdfVersion,
    Language: info.language,
    EncryptFilterName: null,
    IsLinearized: info.linearized,
    // These fields are intentionally conservative. Documents containing one
    // of these features remain metadata-gate failures until the public info
    // boundary exposes the corresponding catalog facts.
    IsAcroFormPresent: false,
    IsXFAPresent: false,
    IsCollectionPresent: false,
    IsSignaturesPresent: false
  };
  const metadataFields = [
    ["title", "Title"],
    ["author", "Author"],
    ["subject", "Subject"],
    ["keywords", "Keywords"],
    ["creator", "Creator"],
    ["producer", "Producer"],
    ["creationDate", "CreationDate"],
    ["modificationDate", "ModDate"]
  ];
  for (const [source, target] of metadataFields) {
    if (typeof info.metadata[source] === "string") {
      pdfInfo[target] = info.metadata[source];
    }
  }
  return {
    fingerprints: [info.fingerprint, null],
    info: pdfInfo,
    metadata: null,
    contentDispositionFilename: null,
    // The pinned PDF.js adapter's finite-integer normalizer currently maps its
    // null byte-source Content-Length to zero.
    contentLength: 0
  };
}

function toOraclePageMetadata(page) {
  const view = intersectBoxes(page.pageInfo.mediaBox, page.pageInfo.cropBox) ??
    page.pageInfo.mediaBox;
  const viewport = pdfjsCompatibleViewport(
    view,
    page.pageInfo.rotation,
    page.pageInfo.userUnit
  );
  return {
    sourcePageIndex: page.pageInfo.sourcePageIndex,
    rotation: normalizeNumber(page.pageInfo.rotation),
    userUnit: normalizeNumber(page.pageInfo.userUnit),
    view: view.map(normalizeNumber),
    viewport,
    // Appearance streams are compiled into the ordered program, but the v1
    // public page ABI intentionally does not expose annotation dictionaries.
    // Keeping this empty makes annotation-bearing corpus PDFs fail the exact
    // metadata gate instead of inventing lossy metadata.
    annotations: []
  };
}

function pdfjsCompatibleViewport(viewBox, rotation, userUnit) {
  const scale = userUnit;
  const centerX = (viewBox[0] + viewBox[2]) / 2;
  const centerY = (viewBox[1] + viewBox[3]) / 2;
  let rotateA;
  let rotateB;
  let rotateC;
  let rotateD;
  switch (rotation) {
    case 90:
      [rotateA, rotateB, rotateC, rotateD] = [0, 1, 1, 0];
      break;
    case 180:
      [rotateA, rotateB, rotateC, rotateD] = [-1, 0, 0, 1];
      break;
    case 270:
      [rotateA, rotateB, rotateC, rotateD] = [0, -1, -1, 0];
      break;
    default:
      [rotateA, rotateB, rotateC, rotateD] = [1, 0, 0, -1];
      break;
  }

  const rotated = rotateA === 0;
  const offsetCanvasX = Math.abs(
    (rotated ? centerY - viewBox[1] : centerX - viewBox[0]) * scale
  );
  const offsetCanvasY = Math.abs(
    (rotated ? centerX - viewBox[0] : centerY - viewBox[1]) * scale
  );
  const width = Math.abs(
    (rotated ? viewBox[3] - viewBox[1] : viewBox[2] - viewBox[0]) * scale
  );
  const height = Math.abs(
    (rotated ? viewBox[2] - viewBox[0] : viewBox[3] - viewBox[1]) * scale
  );
  return {
    width: normalizeNumber(width),
    height: normalizeNumber(height),
    viewBox: viewBox.map(normalizeNumber),
    transform: [
      rotateA * scale,
      rotateB * scale,
      rotateC * scale,
      rotateD * scale,
      offsetCanvasX - rotateA * scale * centerX - rotateC * scale * centerY,
      offsetCanvasY - rotateB * scale * centerX - rotateD * scale * centerY
    ].map(normalizeNumber)
  };
}

async function decodePackedImageWithCanvas(request, signal) {
  signal?.throwIfAborted();
  if (
    request.codec !== "jpeg" ||
    request.bitsPerComponent !== 8 ||
    ![1, 3].includes(request.components) ||
    request.imageMask
  ) {
    throw new Error(
      `The reference candidate has no ${request.codec} ${request.components}-component codec kernel.`
    );
  }
  const image = await loadImage(Buffer.from(request.encoded));
  signal?.throwIfAborted();
  if (image.width !== request.width || image.height !== request.height) {
    throw new Error("The Canvas JPEG decoder returned unexpected dimensions.");
  }
  const surface = createCanvas(image.width, image.height);
  const context = surface.getContext("2d");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height).data;
  const samples = new Uint8Array(image.width * image.height * request.components);
  if (request.components === 1) {
    for (let source = 0, target = 0; source < rgba.length; source += 4) {
      samples[target++] = rgba[source];
    }
  } else {
    for (let source = 0, target = 0; source < rgba.length; source += 4) {
      samples[target++] = rgba[source];
      samples[target++] = rgba[source + 1];
      samples[target++] = rgba[source + 2];
    }
  }
  signal?.throwIfAborted();
  return {
    samples,
    width: request.width,
    height: request.height,
    components: request.components,
    bitsPerComponent: 8
  };
}

function normalizeText(value) {
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

function intersectBoxes(left, right) {
  const result = [
    Math.max(left[0], right[0]),
    Math.max(left[1], right[1]),
    Math.min(left[2], right[2]),
    Math.min(left[3], right[3])
  ];
  return result[2] > result[0] && result[3] > result[1] ? result : null;
}

function normalizeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (Object.is(number, -0)) return 0;
  return Number(number.toPrecision(12));
}

function requirePageData(pageData) {
  if (pageData === null) throw new Error("The HEPR oracle page is closed.");
  return pageData;
}

function assertDocumentOpen(closed) {
  if (closed) throw new Error("The HEPR oracle document is closed.");
}

function installSourceHooks(repositoryRoot) {
  if (sourceHooks) return;
  const sourceRoot = pathToFileURL(`${path.join(repositoryRoot, "src")}${path.sep}`).href;
  sourceHooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        context.parentURL?.startsWith(sourceRoot) &&
        /^\.\.?\//.test(specifier) &&
        !path.extname(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    }
  });
}

function loadSourceModules(repositoryRoot) {
  if (!sourceModules) {
    sourceModules = Promise.all([
      import(pathToFileURL(path.join(repositoryRoot, "src", "pdfSession.ts")).href),
      import(pathToFileURL(path.join(repositoryRoot, "src", "heprCanvas2dRenderer.ts")).href),
      import(pathToFileURL(path.join(repositoryRoot, "src", "nodePdfSource.ts")).href)
    ]);
  }
  return sourceModules;
}
