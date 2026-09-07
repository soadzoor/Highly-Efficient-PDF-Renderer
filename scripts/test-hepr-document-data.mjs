import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const {
  HEPR_COLOR_SPACE_KIND,
  HEPR_DOCUMENT_DATA_VERSION,
  HEPR_PAINT_KIND,
  collectHeprTransferables,
  createEmptyHeprPageData
} = await import("../src/heprDocumentData.ts");
const {
  HEPR_DATA_VALIDATION_CODES,
  HeprDataValidationError,
  validateHeprDocumentData,
  validateHeprPageData
} = await import("../src/heprDocumentDataValidation.ts");

function pageInfo(sourcePageIndex = 0, width = 612, height = 792) {
  return {
    sourcePageIndex,
    mediaBox: [0, 0, width, height],
    cropBox: [0, 0, width, height],
    bleedBox: null,
    trimBox: null,
    artBox: null,
    rotation: 0,
    userUnit: 1,
    width,
    height
  };
}

function documentFor(page) {
  return {
    kind: "hepr-document",
    version: HEPR_DOCUMENT_DATA_VERSION,
    info: {
      pdfVersion: "1.7",
      byteLength: 123,
      pageCount: 1,
      pages: [page.pageInfo],
      label: "fixture.pdf",
      fingerprint: null,
      linearized: false,
      repaired: false,
      tagged: false,
      language: null,
      metadata: {}
    },
    pages: [page],
    diagnostics: []
  };
}

const emptyPage = createEmptyHeprPageData(pageInfo());
validateHeprPageData(emptyPage);
validateHeprDocumentData(documentFor(emptyPage));

const transferables = collectHeprTransferables(emptyPage);
assert.ok(transferables.includes(emptyPage.stores.transforms.values.buffer));
assert.equal(new Set(transferables).size, transferables.length);

const denseFillPage = createEmptyHeprPageData(pageInfo());
denseFillPage.stores.paths.fillPathMetaA = new Float32Array([0, 1, 0, 0]);
denseFillPage.stores.paths.fillPathMetaB = new Float32Array([0, 0, 10, 10]);
denseFillPage.stores.paths.fillPathMetaC = new Float32Array([1, 0, 0, 1]);
denseFillPage.stores.paths.fillSegmentsA = new Float32Array([0, 0, 10, 0]);
denseFillPage.stores.paths.fillSegmentsB = new Float32Array([0, 0, 0, 0]);
denseFillPage.stores.colors = {
  spaceKinds: new Uint8Array([HEPR_COLOR_SPACE_KIND.DeviceRgb]),
  componentCounts: new Uint8Array([3]),
  alternateSpaceIndices: new Int32Array([-1]),
  functionIndices: new Int32Array([-1]),
  parameterOffsets: new Uint32Array([0, 3]),
  parameters: new Float32Array([0, 0, 0]),
  nameOffsets: new Uint32Array([0, 0]),
  names: [],
  profileOffsets: new Uint32Array([0, 0]),
  profiles: new Uint8Array(0),
  lookupOffsets: new Uint32Array([0, 0]),
  lookupBytes: new Uint8Array(0)
};
denseFillPage.stores.paints = {
  kinds: new Uint8Array([HEPR_PAINT_KIND.SolidColor]),
  resourceIndices: new Uint32Array([0]),
  alphas: new Float32Array([1]),
  overprint: new Uint8Array([0]),
  overprintModes: new Uint8Array([0]),
  patternTransformIndices: new Int32Array([-1]),
  patternBasePaintIndices: new Int32Array([-1])
};
denseFillPage.displayProgram.groups[0].commands = [
  {
    kind: "draw",
    source: "fill-paths",
    first: 0,
    count: 1,
    paintIndex: 0,
    transformIndex: 0,
    clipIndex: -1,
    optionalContentIndex: -1,
    markedContentIndex: -1,
    sourceOffset: 42,
    sourceLength: 3
  }
];
validateHeprPageData(denseFillPage);
assert.equal(
  denseFillPage.stores.paths.fillPathMetaA.buffer,
  denseFillPage.stores.paths.fillPathMetaA.buffer,
  "dense arrays are retained directly"
);

const cyclicPage = createEmptyHeprPageData(pageInfo());
cyclicPage.displayProgram.groups.push({
  commands: [
    {
      kind: "invoke-group",
      groupIndex: 0,
      transformIndex: 0,
      clipIndex: -1,
      optionalContentIndex: -1,
      markedContentIndex: -1,
      sourceOffset: -1,
      sourceLength: -1
    }
  ],
  isolated: true,
  knockout: false,
  blendMode: "Normal",
  alpha: 1,
  alphaIsShape: false,
  softMaskGroupIndex: -1,
  softMaskSubtype: null,
  softMaskTransferFunctionIndex: -1,
  backdropPaintIndex: -1,
  blendingColorSpaceIndex: -1,
  clipIndex: -1
});
cyclicPage.displayProgram.groups[0].commands = [
  {
    kind: "invoke-group",
    groupIndex: 1,
    transformIndex: 0,
    clipIndex: -1,
    optionalContentIndex: -1,
    markedContentIndex: -1,
    sourceOffset: -1,
    sourceLength: -1
  }
];
assert.throws(
  () => validateHeprPageData(cyclicPage),
  (error) =>
    error instanceof HeprDataValidationError &&
    error.code === HEPR_DATA_VALIDATION_CODES.ResourceCycle
);

const deepProgramPage = createEmptyHeprPageData(pageInfo());
const deepGroupCount = 20_000;
deepProgramPage.displayProgram.groups = Array.from({ length: deepGroupCount }, (_, index) => ({
  commands: index + 1 === deepGroupCount
    ? []
    : [{
        kind: "invoke-group",
        groupIndex: index + 1,
        transformIndex: 0,
        clipIndex: -1,
        optionalContentIndex: -1,
        markedContentIndex: -1,
        sourceOffset: -1,
        sourceLength: -1
      }],
  isolated: true,
  knockout: false,
  blendMode: "Normal",
  alpha: 1,
  alphaIsShape: false,
  softMaskGroupIndex: -1,
  softMaskSubtype: null,
  softMaskTransferFunctionIndex: -1,
  backdropPaintIndex: -1,
  blendingColorSpaceIndex: -1,
  clipIndex: -1
}));
validateHeprPageData(deepProgramPage);
deepProgramPage.displayProgram.groups[deepGroupCount - 1].commands = [{
  kind: "invoke-group",
  groupIndex: 0,
  transformIndex: 0,
  clipIndex: -1,
  optionalContentIndex: -1,
  markedContentIndex: -1,
  sourceOffset: -1,
  sourceLength: -1
}];
assert.throws(
  () => validateHeprPageData(deepProgramPage),
  (error) =>
    error instanceof HeprDataValidationError &&
    error.code === HEPR_DATA_VALIDATION_CODES.ResourceCycle
);

const v6Document = structuredClone(documentFor(emptyPage));
v6Document.version = 6;
assert.throws(
  () => validateHeprDocumentData(v6Document),
  (error) =>
    error instanceof HeprDataValidationError &&
    error.code === HEPR_DATA_VALIDATION_CODES.IncompatibleVersion &&
    error.message.includes("must be regenerated")
);

console.log("HEPR page-native document data tests passed");
hooks.deregister();
