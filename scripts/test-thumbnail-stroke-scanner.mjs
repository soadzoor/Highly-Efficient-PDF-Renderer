import assert from "node:assert/strict";
import { scanThumbnailStrokeBlock } from "../src/pdf/nativeThumbnailStrokeScanner.ts";

const plainNumber = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)", number = `(${plainNumber})`, space = "[\\x00\\t\\n\\f\\r ]+";
const pattern = new RegExp("q" + space + Array(6).fill(number).join(space) + space + "cm" + space +
  "(?:" + number + space + "G" + space + ")?" + number + space + "w" + space + number + space + "j" + space +
  number + space + "J" + space + number + space + number + space + "m" + space + number + space + number + space +
  "l" + space + "((?:" + plainNumber + space + plainNumber + space + "l" + space + ")*)" +
  "S" + space + "Q(?=[\\x00\\t\\n\\f\\r ()<>\\[\\]{}/%]|$)", "y");
const extraPattern = new RegExp(number + space + number + space + "l" + space, "g");
const encoder = new TextEncoder(), values = new Float64Array(14), reused = { end: -1, hasGray: false };
const tokens = ["q", "1", "0", "0", "1", "5", "7", "cm", ".25", "w", "0", "j", "1", "J", "2", "3", "m", "40", "50", "l", "S", "Q"];
const block = (changes = []) => { const result = [...tokens]; for (const [index, value] of changes) result[index] = value; return result.join(" "); };
const grayBlock = gray => block().replace("cm ", `cm ${gray} G `);
const polyline = (source, extras) => source.replace(" l S", ` l ${extras} S`);
const valid = [block(), grayBlock(".2"), grayBlock("-0"), block([[1, "-0"], [2, "+0"], [8, "0"]]),
  block([[1, "1.000000059604644775390625"], [5, "1.000000178813934326171875"], [14, "-.1234567890123456789"]]),
  block([[14, `0.${"0".repeat(320)}1`]]), block([[8, "-1"], [10, "3"], [12, "2.5"]]),
  polyline(block(), "20 30 l"), polyline(grayBlock(".2"), "+.5 -0 l 1.000000059604644775390625 2. l"),
  polyline(block(), Array.from({ length: 20 }, (_, index) => `${index + 100} ${index + 200} l`).join(" "))];
for (const source of valid) {
  for (const suffix of ["", " ", "\x00\t\n\f\r ", "/Name", "%comment", "(", ")", "<", ">", "[", "]", "{", "}"]) {
    for (const prefix of ["", "prefix "]) {
      for (const final of [false, true]) check(`${prefix}${source}${suffix}`, prefix.length, final);
    }
  }
  check(source.replaceAll(" ", "\x00\t\n\f\r "), 0, true);
  const bytes = encoder.encode(`${source} /Form Do`);
  for (let cut = 0; cut <= bytes.length; cut++) {
    for (const final of [false, true]) check(bytes.subarray(0, cut), 0, final);
  }
}
const invalid = [block().replaceAll(" ", " %comment\n"), `${block()}X`, `${block()}1`, `${block()};`,
  block().replace("cm", "cmX"), block().replace("w", "wx"), grayBlock(".2").replace("G", "GX"),
  block().replace("S", "SX"), block().replace("q", "qX"), block([[1, "9".repeat(320)]])];
for (const extras of ["20 l", "20 30 40 l", "20 /Name l", "20 30 m", "20 30 lX", "20 30 l 1.2.3 1 l", "20 30 l %comment\n"]) {
  invalid.push(polyline(block(), extras));
}
for (const index of [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 17, 18]) {
  for (const value of [".", "+", "-", "++1", "--1", "1.2.3", "1e2", "/N", "(x)", "[1 2]", "true", "null"]) invalid.push(block([[index, value]]));
}
for (const source of invalid) { check(source, 0, false); check(source, 0, true); }
assert.equal(scanThumbnailStrokeBlock(encoder.encode(block()), 0, true, values, reused), reused,
  "the owner can reuse one result object across every successful match");
assert(scanThumbnailStrokeBlock(encoder.encode(block()), 0, true, values), "omitting the reusable result remains supported");
const polylineResult = scanThumbnailStrokeBlock(encoder.encode(polyline(block(), "10 20 l 30 40 l")), 0, true, values, reused);
const scratch = polylineResult.extraCoordinates;
assert.equal(polylineResult.lineCount, 3);
assert.deepEqual([...scratch.subarray(0, 4)], [10, 20, 30, 40]);
scanThumbnailStrokeBlock(encoder.encode(polyline(block(), "50 60 l")), 0, true, values, reused);
assert.equal(reused.extraCoordinates, scratch, "subsequent polylines reuse their growable coordinate scratch");
scanThumbnailStrokeBlock(encoder.encode(block()), 0, true, values, reused);
assert.equal(reused.lineCount, 1, "single-line scopes reset the active coordinate count without discarding reusable storage");
assert.equal(reused.extraCoordinates, scratch);
console.log("Thumbnail stroke byte scanner: exact scope/polyline grammar, reusable growable coordinates, chunk cuts, token/delimiter boundaries, optional gray, signed zero, precise/tiny decimals and malformed fallback passed.");

function check(input, offset, final) {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  const source = new TextDecoder("latin1").decode(bytes);
  pattern.lastIndex = offset;
  const match = pattern.exec(source), expectedEnd = pattern.lastIndex;
  const extraCoordinates = match ? [...match[15].matchAll(extraPattern)].flatMap(part => [Number(part[1]), Number(part[2])]) : [];
  const expected = match && (final || expectedEnd !== source.length) &&
    match.slice(1, 15).every(value => value === undefined || Number.isFinite(Number(value))) &&
    extraCoordinates.every(Number.isFinite);
  const before = { ...reused };
  const result = scanThumbnailStrokeBlock(bytes, offset, final, values, reused);
  assert.equal(Boolean(result), Boolean(expected), `grammar parity at ${offset}, final=${final}: ${JSON.stringify(source)}`);
  if (!expected) { assert.deepEqual(reused, before, "failed/incomplete scans never publish a result"); return; }
  assert.equal(result, reused); assert.equal(result.end, expectedEnd); assert.equal(result.hasGray, match[7] !== undefined);
  assert.deepEqual([...values], match.slice(1, 15).map((value, index) => index === 6 && value === undefined ? 0 : Number(value)),
    "successful numeric scratch matches ordinary decimal conversion including signed zero");
  assert.equal(result.lineCount, 1 + extraCoordinates.length / 2);
  assert.deepEqual(extraCoordinates.length ? [...result.extraCoordinates.subarray(0, extraCoordinates.length)] : [], extraCoordinates);
}
