import assert from "node:assert/strict";
import { setVectorRenderComparison } from "../src/vectorRenderComparison.ts";

const events = [];
const target = {
  setFillRenderingEnabled(enabled) { events.push(["fills", enabled]); },
  setStrokeRenderingEnabled(enabled) { events.push(["strokes", enabled]); }
};
const stop = () => events.push(["stop"]);
for (const [mode, fillRendering, strokeRendering] of [
  ["all", true, true], ["fills", true, false], ["strokes", false, true], ["none", false, false]
]) {
  events.length = 0;
  assert.deepEqual(setVectorRenderComparison(target, mode, stop), { mode, fillRendering, strokeRendering });
  assert.deepEqual(events, [["stop"], ["fills", fillRendering], ["strokes", strokeRendering]],
    "end the previous capture before changing either paint kind");
}
events.length = 0;
for (const mode of [undefined, null, true, "fill", "", {}]) {
  assert.throws(() => setVectorRenderComparison(target, mode, stop), /Vector comparison/);
}
assert.throws(() => setVectorRenderComparison({ setFillRenderingEnabled() {} }, "all", stop), /does not support/);
assert.deepEqual(events, [], "invalid modes and unsupported targets leave the capture and paint switches untouched");
console.log("Vector comparisons: isolated fill/stroke modes and capture boundaries passed.");
