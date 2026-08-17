import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

function strippedDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(
    stripTypeScriptTypes(source, { mode: "strip" })
  ).toString("base64")}`;
}

const geometryPath = new URL("../src/sceneTextGeometry.ts", import.meta.url);
const geometrySource = await readFile(geometryPath, "utf8");
const geometryUrl = strippedDataUrl(geometrySource);

const searchPath = new URL("../src/textSearch.ts", import.meta.url);
const searchSource = (await readFile(searchPath, "utf8")).replaceAll(
  '"./sceneTextGeometry"',
  JSON.stringify(geometryUrl)
);
const {
  createSceneTextSearcher,
  createSearchHighlightSet,
  flattenSearchMatchHighlightBounds
} = await import(strippedDataUrl(searchSource));

const nativeHighlightsPath = new URL("../src/searchHighlights.ts", import.meta.url);
const nativeHighlightsSource = await readFile(nativeHighlightsPath, "utf8");
const { prepareSearchHighlights } = await import(strippedDataUrl(nativeHighlightsSource));

function createFallbackScene(text, positionForChar) {
  const charInstance = new Int32Array(text.length);
  const fallbackQuads = [];
  let fallbackIndex = 0;
  for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
    if (text[charIndex] === " ") {
      charInstance[charIndex] = -1;
      continue;
    }
    const { x, y } = positionForChar(charIndex);
    charInstance[charIndex] = -2 - fallbackIndex;
    fallbackQuads.push(x, y, x + 1, y + 1);
    fallbackIndex += 1;
  }
  return {
    textIndex: {
      version: 2,
      pages: [
        {
          text,
          charInstance,
          fallbackQuads: Float32Array.from(fallbackQuads)
        }
      ]
    },
    textInstanceA: new Float32Array(0),
    textInstanceB: new Float32Array(0),
    textGlyphMetaA: new Float32Array(0),
    textGlyphMetaB: new Float32Array(0)
  };
}

function createInstancedScene(text, positionForChar, matrix = [1, 0, 0, 1]) {
  const charInstance = new Int32Array(text.length);
  const textInstanceA = [];
  const textInstanceB = [];
  let instanceIndex = 0;
  for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
    if (text[charIndex] === " ") {
      charInstance[charIndex] = -1;
      continue;
    }
    const { x, y } = positionForChar(charIndex);
    charInstance[charIndex] = instanceIndex;
    textInstanceA.push(...matrix);
    textInstanceB.push(x, y, 0, 0);
    instanceIndex += 1;
  }
  return {
    textIndex: {
      version: 2,
      pages: [
        {
          text,
          charInstance,
          fallbackQuads: new Float32Array(0)
        }
      ]
    },
    textInstanceA: Float32Array.from(textInstanceA),
    textInstanceB: Float32Array.from(textInstanceB),
    textGlyphMetaA: Float32Array.from([0, 0, 0, 0]),
    textGlyphMetaB: Float32Array.from([1, 1, 0, 0])
  };
}

const phrase = "King of Naples";
const wrappedScene = createInstancedScene(phrase, (charIndex) => {
  if (charIndex < 8) {
    return { x: 80 + charIndex * 1.25, y: 20 };
  }
  return { x: (charIndex - 8) * 1.25, y: 10 };
});
const wrappedMatches = createSceneTextSearcher(wrappedScene).search("king of naples");

assert.equal(wrappedMatches.length, 1, "a wrapped phrase must remain one logical match");
const wrappedMatch = wrappedMatches[0];
assert.equal(wrappedMatch.startChar, 0);
assert.equal(wrappedMatch.length, phrase.length);
assert.equal(wrappedMatch.highlightBounds.length, 2, "a wrapped match needs one rectangle per line");

const [firstLine, secondLine] = wrappedMatch.highlightBounds;
assert.ok(firstLine.minX > 79 && firstLine.maxX < 90, "the first fragment must stay around the line end");
assert.ok(secondLine.minX < 0 && secondLine.maxX < 8, "the second fragment must stay around the next line start");
assert.ok(firstLine.maxX - firstLine.minX < 12, "the first fragment must not span the row");
assert.ok(secondLine.maxX - secondLine.minX < 9, "the second fragment must not span the row");
assert.deepEqual(wrappedMatch.bounds, {
  minX: Math.min(firstLine.minX, secondLine.minX),
  minY: Math.min(firstLine.minY, secondLine.minY),
  maxX: Math.max(firstLine.maxX, secondLine.maxX),
  maxY: Math.max(firstLine.maxY, secondLine.maxY)
});

const packed = createSearchHighlightSet(wrappedMatches, 0);
assert.ok(packed);
assert.equal(packed.count, 2, "both line fragments must reach the renderer");
assert.equal(packed.currentIndex, 0);
assert.equal(packed.currentCount, 2, "both fragments of the current match must be emphasized");
assert.deepEqual(
  Array.from(packed.rects),
  Array.from(
    Float32Array.from([
      firstLine.minX,
      firstLine.minY,
      firstLine.maxX,
      firstLine.maxY,
      secondLine.minX,
      secondLine.minY,
      secondLine.maxX,
      secondLine.maxY
    ])
  )
);

const sameLineScene = createFallbackScene(phrase, (charIndex) => ({
  x: charIndex * 1.25,
  y: 10
}));
const sameLineMatches = createSceneTextSearcher(sameLineScene).search("king of naples");
assert.equal(sameLineMatches.length, 1);
assert.equal(sameLineMatches[0].highlightBounds.length, 1, "ordinary word spaces must not split a highlight");
assert.ok(
  sameLineMatches[0].highlightBounds[0].maxY - sameLineMatches[0].highlightBounds[0].minY < 1.5,
  "horizontal padding must stay tied to glyph thickness"
);

const combinedPacked = createSearchHighlightSet([sameLineMatches[0], wrappedMatch], 1);
assert.ok(combinedPacked);
assert.equal(combinedPacked.count, 3);
assert.equal(combinedPacked.currentIndex, 1, "the active rectangle range must follow preceding matches");
assert.equal(combinedPacked.currentCount, 2);
const combinedBounds = flattenSearchMatchHighlightBounds([sameLineMatches[0], wrappedMatch], 1);
assert.equal(combinedBounds.bounds.length, 3);
assert.equal(combinedBounds.currentIndex, 1);
assert.equal(combinedBounds.currentCount, 2);
assert.equal(combinedBounds.bounds[0], sameLineMatches[0].highlightBounds[0]);
assert.equal(combinedBounds.bounds[1], firstLine);
assert.equal(combinedBounds.bounds[2], secondLine);
const preparedCombined = prepareSearchHighlights(combinedPacked);
assert.ok(preparedCombined);
assert.equal(preparedCombined.otherCount, 1);
assert.equal(preparedCombined.currentCount, 2);
assert.deepEqual(
  Array.from(preparedCombined.otherRects),
  Array.from(combinedPacked.rects.subarray(0, 4))
);
assert.deepEqual(
  Array.from(preparedCombined.currentRects),
  Array.from(combinedPacked.rects.subarray(4))
);

const preparedLegacy = prepareSearchHighlights({
  rects: combinedPacked.rects,
  count: combinedPacked.count,
  currentIndex: 1
});
assert.ok(preparedLegacy);
assert.equal(preparedLegacy.otherCount, 2);
assert.equal(preparedLegacy.currentCount, 1, "legacy payloads must still emphasize one rectangle");

const quarterTurnMatrix = [0, 1, -1, 0];
const rotatedSameLineScene = createInstancedScene(
  phrase,
  (charIndex) => ({ x: 30, y: charIndex * 1.25 }),
  quarterTurnMatrix
);
const rotatedSameLineMatches = createSceneTextSearcher(rotatedSameLineScene).search("king of naples");
assert.equal(rotatedSameLineMatches.length, 1);
assert.equal(
  rotatedSameLineMatches[0].highlightBounds.length,
  1,
  "baseline-oriented grouping must keep rotated same-line text together"
);
assert.ok(
  rotatedSameLineMatches[0].highlightBounds[0].maxX -
    rotatedSameLineMatches[0].highlightBounds[0].minX <
    1.5,
  "rotated instanced padding must use line thickness rather than phrase length"
);

const rotatedWrappedScene = createInstancedScene(
  phrase,
  (charIndex) =>
    charIndex < 8
      ? { x: 30, y: 80 + charIndex * 1.25 }
      : { x: 20, y: (charIndex - 8) * 1.25 },
  quarterTurnMatrix
);
const rotatedWrappedMatches = createSceneTextSearcher(rotatedWrappedScene).search("king of naples");
assert.equal(rotatedWrappedMatches.length, 1);
assert.equal(
  rotatedWrappedMatches[0].highlightBounds.length,
  2,
  "a rotated wrapped match must still split at its visual-line boundary"
);

const fallbackVerticalScene = createFallbackScene(phrase, (charIndex) => ({
  x: 30,
  y: charIndex * 1.25
}));
const fallbackVerticalMatches = createSceneTextSearcher(fallbackVerticalScene).search("king of naples");
assert.equal(fallbackVerticalMatches.length, 1);
assert.equal(
  fallbackVerticalMatches[0].highlightBounds.length,
  1,
  "fallback-only vertical text must infer and retain its progression direction"
);
assert.ok(
  fallbackVerticalMatches[0].highlightBounds[0].maxX -
    fallbackVerticalMatches[0].highlightBounds[0].minX <
    1.5,
  "vertical padding must stay tied to glyph thickness, not phrase length"
);

const fallbackVerticalWrappedScene = createFallbackScene(phrase, (charIndex) =>
  charIndex < 8
    ? { x: 30, y: 80 + charIndex * 1.25 }
    : { x: 20, y: (charIndex - 8) * 1.25 }
);
const fallbackVerticalWrappedMatches = createSceneTextSearcher(fallbackVerticalWrappedScene).search(
  "king of naples"
);
assert.equal(fallbackVerticalWrappedMatches.length, 1);
assert.equal(
  fallbackVerticalWrappedMatches[0].highlightBounds.length,
  2,
  "fallback-only vertical wrapping must produce one tight rectangle per line"
);

const oneGlyphWrapScene = createFallbackScene("A B", (charIndex) =>
  charIndex === 0 ? { x: 0, y: 10 } : { x: 0, y: 8 }
);
const oneGlyphWrapMatches = createSceneTextSearcher(oneGlyphWrapScene).search("a b");
assert.equal(oneGlyphWrapMatches.length, 1);
assert.equal(
  oneGlyphWrapMatches[0].highlightBounds.length,
  2,
  "an unknown fallback direction must not merge aligned glyphs across a separator"
);

console.log("Text search highlight geometry checks passed.");
