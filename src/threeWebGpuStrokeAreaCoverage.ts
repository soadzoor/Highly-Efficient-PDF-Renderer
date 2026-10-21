import { TSL } from "three/webgpu";
import { STROKE_AREA_COVERAGE_WGSL_FUNCTIONS } from "./strokeAreaCoverageShaders";

// Reuse the same function nodes in solid/gradient and mixed materials. Each
// helper's dependencies refer to earlier definitions in the shared source.
const functions: unknown[] = [];
for (const source of STROKE_AREA_COVERAGE_WGSL_FUNCTIONS) {
  functions.push(TSL.wgslFn(source, functions.slice() as never));
}
export const threeWebGpuStrokeAreaCoverageFn = functions[functions.length - 1];
