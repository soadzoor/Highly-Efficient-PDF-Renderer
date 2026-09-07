import {
  HEPR_GRADIENT_KIND,
  HEPR_MESH_KIND,
  type HeprPageData
} from "./heprDocumentData";

export type HeprPatchTessellationErrorCode =
  | "invalid-data"
  | "resource-limit"
  | "aborted"
  | "function-evaluator-required"
  | "function-evaluation";

export class HeprPatchTessellationError extends Error {
  readonly code: HeprPatchTessellationErrorCode;
  readonly details: Readonly<Record<string, number | string | boolean>>;

  constructor(
    code: HeprPatchTessellationErrorCode,
    message: string,
    details: Readonly<Record<string, number | string | boolean>> = {},
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "HeprPatchTessellationError";
    this.code = code;
    this.details = details;
  }
}

export type HeprPatchFunctionEvaluator = (
  functionIndex: number,
  inputs: readonly number[],
  signal?: AbortSignal
) => ArrayLike<number>;

export interface HeprPatchTessellationOptions {
  /** Maximum position-space deviation of the generated triangle surface. */
  readonly flatness?: number;
  /** Maximum native-color-component deviation sampled during subdivision. */
  readonly componentFlatness?: number;
  /** Minimum subdivision depth used for opaque function evaluators. */
  readonly minFunctionDepth?: number;
  readonly maxDepth?: number;
  readonly maxTriangles?: number;
  readonly maxOutputBytes?: number;
  readonly maxSubdivisionNodes?: number;
  readonly maxFunctionEvaluations?: number;
  readonly signal?: AbortSignal;
  /** Required only when the shading has a scalar or component function array. */
  readonly evaluateFunction?: HeprPatchFunctionEvaluator;
}

export interface HeprPatchTriangleData {
  readonly gradientIndex: number;
  readonly meshIndex: number;
  readonly colorSpaceIndex: number;
  readonly componentCount: number;
  /** Non-indexed triangles: six values (three xy pairs) per triangle. */
  readonly positions: Float32Array;
  /** Three native-color tuples per triangle. */
  readonly components: Float32Array;
  /** Interpolated `t` per triangle vertex for function-backed shadings. */
  readonly functionInputs: Float32Array;
  /** Scalar function index or the component-function array, empty when direct. */
  readonly functionIndices: Int32Array;
  /** `patchCount + 1`; source-ordered spans measured in triangles. */
  readonly patchTriangleOffsets: Uint32Array;
  /** Deepest adaptive subdivision used by each source patch. */
  readonly patchDepths: Uint8Array;
}

interface ResolvedOptions {
  readonly flatness: number;
  readonly componentFlatness: number;
  readonly minFunctionDepth: number;
  readonly maxDepth: number;
  readonly maxTriangles: number;
  readonly maxOutputBytes: number;
  readonly maxSubdivisionNodes: number;
  readonly maxFunctionEvaluations: number;
  readonly signal?: AbortSignal;
  readonly evaluateFunction?: HeprPatchFunctionEvaluator;
}

interface PatchColorValue {
  readonly components: Float64Array;
  readonly functionInput: number;
}

interface PatchLeaf {
  readonly net: Float64Array;
  readonly depth: number;
  readonly uCell: number;
  readonly vCell: number;
}

interface PatchEdgeUse {
  group: PatchEdgeGroup;
  readonly reversed: boolean;
}

interface PatchEdgeGroup {
  readonly key: string;
  readonly points: Float64Array;
  readonly entries: Array<{ readonly patch: PatchRecord; readonly side: number; readonly reversed: boolean }>;
  readonly samples: Map<string, readonly [number, number]>;
  depth: number;
  values: Set<number>;
}

interface PatchRecord {
  readonly sourceIndex: number;
  readonly net: Float64Array;
  readonly cornerValues: Float64Array;
  readonly componentCount: number;
  readonly functionIndices: readonly number[];
  readonly colorCache: Map<string, PatchColorValue>;
  readonly positionCache: Map<string, readonly [number, number]>;
  readonly edges: PatchEdgeUse[];
  leaves: PatchLeaf[];
  maxLeafDepth: number;
  topologyDepth: number;
}

interface TessellationContext {
  readonly options: ResolvedOptions;
  subdivisionNodes: number;
  leafCount: number;
  functionEvaluations: number;
}

interface PatchTopology {
  readonly scale: number;
  readonly vertical: ReadonlyMap<number, readonly number[]>;
  readonly horizontal: ReadonlyMap<number, readonly number[]>;
}

interface ParameterPoint {
  readonly u: number;
  readonly v: number;
}

const DEFAULT_OPTIONS: Readonly<Omit<ResolvedOptions, "signal" | "evaluateFunction">> = Object.freeze({
  flatness: 0.25,
  componentFlatness: 1 / 1024,
  minFunctionDepth: 1,
  maxDepth: 10,
  maxTriangles: 1_000_000,
  maxOutputBytes: 256 * 1024 * 1024,
  maxSubdivisionNodes: 2_000_000,
  maxFunctionEvaluations: 2_000_000
});

const PATCH_FUNCTION_ARRAY_FLAG = 1 << 5;
const PATCH_CORNERS = Object.freeze([0, 3, 6, 9]);
const SIDE_LEFT = 0;
const SIDE_RIGHT = 1;
const SIDE_BOTTOM = 2;
const SIDE_TOP = 3;

/**
 * Adaptively tessellate one HEPR Coons/tensor gradient without rasterization.
 *
 * Geometry is converted to an exact bicubic tensor net, subdivided with
 * de Casteljau, and emitted in source-patch then deterministic quadtree order.
 * A conforming quadtree boundary fan removes T-junctions. Coincident patch
 * edges share the union of their dyadic samples and a canonical curve cache,
 * so independently refined adjacent source patches remain crack-free.
 *
 * Direct corner components are bilinearly interpolated in parameter space.
 * For function-backed meshes the scalar `t` is bilinearly interpolated first,
 * then passed to the supplied evaluator, matching PDF semantics. Both the
 * evaluated components and per-vertex `t` are retained in the result.
 */
export function tessellateHeprPatchMesh(
  page: Readonly<HeprPageData>,
  gradientIndex: number,
  options: HeprPatchTessellationOptions = {}
): HeprPatchTriangleData {
  const resolved = resolveOptions(options);
  throwIfCancelled(resolved.signal);
  const source = resolvePatchSource(page, gradientIndex, resolved);
  const context: TessellationContext = {
    options: resolved,
    subdivisionNodes: 0,
    leafCount: 0,
    functionEvaluations: 0
  };
  for (const patch of source.patches) buildPatchLeaves(patch, context);
  const edgeGroups = connectPatchEdges(source.patches, resolved.signal);
  synchronizePatchEdges(source.patches, edgeGroups, resolved.signal);
  const topologies = source.patches.map((patch) => buildPatchTopology(patch, resolved.signal));

  const patchTriangleOffsets = new Uint32Array(source.patches.length + 1);
  let triangleCount = 0;
  for (let patchIndex = 0; patchIndex < source.patches.length; patchIndex += 1) {
    throwIfCancelled(resolved.signal);
    const patch = source.patches[patchIndex];
    const topology = topologies[patchIndex];
    for (const leaf of patch.leaves) {
      throwIfCancelled(resolved.signal);
      triangleCount = checkedAdd(
        triangleCount,
        leafPolygon(topology, leaf).length,
        "triangle count"
      );
      if (triangleCount > resolved.maxTriangles || triangleCount > 0xffff_ffff) {
        throw limitError("Patch tessellation exceeds its triangle ceiling.", {
          triangleCount,
          limit: Math.min(resolved.maxTriangles, 0xffff_ffff)
        });
      }
    }
    patchTriangleOffsets[patchIndex + 1] = triangleCount;
  }

  const vertexCount = checkedMultiply(triangleCount, 3, "triangle vertex count");
  const positionValueCount = checkedMultiply(vertexCount, 2, "position value count");
  const componentValueCount = checkedMultiply(
    vertexCount,
    source.componentCount,
    "component value count"
  );
  const functionInputCount = source.functionIndices.length > 0 ? vertexCount : 0;
  const outputBytes = [
    checkedMultiply(positionValueCount, 4, "position byte count"),
    checkedMultiply(componentValueCount, 4, "component byte count"),
    checkedMultiply(functionInputCount, 4, "function-input byte count"),
    checkedMultiply(patchTriangleOffsets.length, 4, "patch-offset byte count"),
    source.patches.length,
    checkedMultiply(source.functionIndices.length, 4, "function-index byte count")
  ].reduce((sum, value) => checkedAdd(sum, value, "tessellation output byte count"), 0);
  if (outputBytes > resolved.maxOutputBytes) {
    throw limitError("Patch tessellation exceeds its output-byte ceiling.", {
      outputBytes,
      limit: resolved.maxOutputBytes
    });
  }

  let positions: Float32Array;
  let components: Float32Array;
  let functionInputs: Float32Array;
  try {
    positions = new Float32Array(positionValueCount);
    components = new Float32Array(componentValueCount);
    functionInputs = new Float32Array(functionInputCount);
  } catch (cause) {
    throw new HeprPatchTessellationError(
      "resource-limit",
      "Patch tessellation output allocation failed.",
      { outputBytes },
      cause
    );
  }

  let positionOffset = 0;
  let componentOffset = 0;
  let functionInputOffset = 0;
  const writeVertex = (patch: PatchRecord, point: ParameterPoint): void => {
    const position = evaluatePatchPosition(patch, point.u, point.v);
    const color = evaluatePatchColor(patch, point.u, point.v, context);
    positions[positionOffset++] = finiteFloat32(position[0], "triangle x coordinate");
    positions[positionOffset++] = finiteFloat32(position[1], "triangle y coordinate");
    for (const component of color.components) {
      components[componentOffset++] = finiteFloat32(component, "triangle color component");
    }
    if (source.functionIndices.length > 0) {
      functionInputs[functionInputOffset++] = finiteFloat32(
        color.functionInput,
        "triangle function input"
      );
    }
  };

  for (let patchIndex = 0; patchIndex < source.patches.length; patchIndex += 1) {
    const patch = source.patches[patchIndex];
    const topology = topologies[patchIndex];
    for (const leaf of patch.leaves) {
      throwIfCancelled(resolved.signal);
      const polygon = leafPolygon(topology, leaf);
      const cellScale = 2 ** leaf.depth;
      const center = Object.freeze({
        u: (leaf.uCell + 0.5) / cellScale,
        v: (leaf.vCell + 0.5) / cellScale
      });
      for (let index = 0; index < polygon.length; index += 1) {
        writeVertex(patch, center);
        writeVertex(patch, polygon[index]);
        writeVertex(patch, polygon[(index + 1) % polygon.length]);
      }
    }
  }
  if (
    positionOffset !== positions.length ||
    componentOffset !== components.length ||
    functionInputOffset !== functionInputs.length
  ) {
    throw invalidError("Patch tessellation output cardinality is inconsistent.");
  }

  return Object.freeze({
    gradientIndex,
    meshIndex: source.meshIndex,
    colorSpaceIndex: source.colorSpaceIndex,
    componentCount: source.componentCount,
    positions,
    components,
    functionInputs,
    functionIndices: Int32Array.from(source.functionIndices),
    patchTriangleOffsets,
    patchDepths: Uint8Array.from(source.patches, (patch) => patch.maxLeafDepth)
  });
}

function resolveOptions(options: HeprPatchTessellationOptions): ResolvedOptions {
  const maxDepth = options.maxDepth ?? DEFAULT_OPTIONS.maxDepth;
  const resolved: ResolvedOptions = {
    flatness: options.flatness ?? DEFAULT_OPTIONS.flatness,
    componentFlatness: options.componentFlatness ?? DEFAULT_OPTIONS.componentFlatness,
    minFunctionDepth: options.minFunctionDepth ?? Math.min(DEFAULT_OPTIONS.minFunctionDepth, maxDepth),
    maxDepth,
    maxTriangles: options.maxTriangles ?? DEFAULT_OPTIONS.maxTriangles,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_OPTIONS.maxOutputBytes,
    maxSubdivisionNodes: options.maxSubdivisionNodes ?? DEFAULT_OPTIONS.maxSubdivisionNodes,
    maxFunctionEvaluations: options.maxFunctionEvaluations ?? DEFAULT_OPTIONS.maxFunctionEvaluations,
    signal: options.signal,
    evaluateFunction: options.evaluateFunction
  };
  requirePositiveFinite(resolved.flatness, "flatness");
  requirePositiveFinite(resolved.componentFlatness, "componentFlatness");
  requireIntegerRange(resolved.maxDepth, 0, 20, "maxDepth");
  requireIntegerRange(resolved.minFunctionDepth, 0, resolved.maxDepth, "minFunctionDepth");
  requirePositiveSafeInteger(resolved.maxTriangles, "maxTriangles");
  requirePositiveSafeInteger(resolved.maxOutputBytes, "maxOutputBytes");
  requirePositiveSafeInteger(resolved.maxSubdivisionNodes, "maxSubdivisionNodes");
  requirePositiveSafeInteger(resolved.maxFunctionEvaluations, "maxFunctionEvaluations");
  return resolved;
}

function resolvePatchSource(
  page: Readonly<HeprPageData>,
  gradientIndex: number,
  options: ResolvedOptions
): {
  readonly meshIndex: number;
  readonly colorSpaceIndex: number;
  readonly componentCount: number;
  readonly functionIndices: readonly number[];
  readonly patches: PatchRecord[];
} {
  if (!Number.isSafeInteger(gradientIndex) || gradientIndex < 0 || gradientIndex >= page.stores.gradients.kinds.length) {
    throw invalidError("Patch gradient index is out of range.", { gradientIndex });
  }
  const gradients = page.stores.gradients;
  const meshes = page.stores.meshes;
  const colors = page.stores.colors;
  const gradientKind = gradients.kinds[gradientIndex];
  const expectedMeshKind = gradientKind === HEPR_GRADIENT_KIND.CoonsPatchMesh
    ? HEPR_MESH_KIND.CoonsPatch
    : gradientKind === HEPR_GRADIENT_KIND.TensorPatchMesh
      ? HEPR_MESH_KIND.TensorPatch
      : -1;
  if (expectedMeshKind < 0) {
    throw invalidError("Gradient is not a Coons or tensor-product patch mesh.", { gradientIndex });
  }
  const meshIndex = gradients.meshIndices[gradientIndex];
  if (!Number.isSafeInteger(meshIndex) || meshIndex < 0 || meshIndex >= meshes.kinds.length) {
    throw invalidError("Patch gradient has an invalid mesh reference.", { gradientIndex, meshIndex });
  }
  if (meshes.kinds[meshIndex] !== expectedMeshKind) {
    throw invalidError("Patch gradient and mesh kinds disagree.", { gradientIndex, meshIndex });
  }
  const colorSpaceIndex = gradients.colorSpaceIndices[gradientIndex];
  if (
    !Number.isSafeInteger(colorSpaceIndex) ||
    colorSpaceIndex < 0 ||
    colorSpaceIndex >= colors.spaceKinds.length ||
    meshes.colorSpaceIndices[meshIndex] !== colorSpaceIndex
  ) {
    throw invalidError("Patch gradient has an invalid or inconsistent color space.", {
      gradientIndex,
      meshIndex,
      colorSpaceIndex
    });
  }
  const componentCount = colors.componentCounts[colorSpaceIndex];
  if (!Number.isSafeInteger(componentCount) || componentCount <= 0) {
    throw invalidError("Patch color space has no components.", { colorSpaceIndex, componentCount });
  }

  const scalarFunctionIndex = gradients.functionIndices[gradientIndex];
  const hasFunctionArray = (gradients.extendFlags[gradientIndex] & PATCH_FUNCTION_ARRAY_FLAG) !== 0;
  let functionIndices: number[] = [];
  if (hasFunctionArray) {
    if (scalarFunctionIndex !== -1) {
      throw invalidError("Patch shading has both scalar and array function metadata.", { gradientIndex });
    }
    const start = gradients.coordinateOffsets[gradientIndex];
    const end = gradients.coordinateOffsets[gradientIndex + 1];
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > gradients.coordinates.length ||
      end - start < componentCount
    ) {
      throw invalidError("Patch function-array sidecar is truncated.", { gradientIndex });
    }
    functionIndices = Array.from(
      gradients.coordinates.subarray(start, start + componentCount),
      (value) => value
    );
  } else if (scalarFunctionIndex >= 0) {
    functionIndices = [scalarFunctionIndex];
  } else if (scalarFunctionIndex !== -1) {
    throw invalidError("Patch shading has an invalid function index.", {
      gradientIndex,
      functionIndex: scalarFunctionIndex
    });
  }
  for (const functionIndex of functionIndices) {
    if (
      !Number.isSafeInteger(functionIndex) ||
      functionIndex < 0 ||
      functionIndex >= page.stores.functions.kinds.length
    ) {
      throw invalidError("Patch shading function index is out of range.", {
        gradientIndex,
        functionIndex
      });
    }
  }
  if (functionIndices.length > 0 && !options.evaluateFunction) {
    throw new HeprPatchTessellationError(
      "function-evaluator-required",
      "Function-backed patch tessellation requires an HEPR function evaluator.",
      { gradientIndex }
    );
  }
  if (functionIndices.length === 0 && componentCount > 4) {
    throw invalidError("Direct patch colors exceed the four-slot mesh ABI.", {
      gradientIndex,
      componentCount
    });
  }

  const controlsPerPatch = expectedMeshKind === HEPR_MESH_KIND.CoonsPatch ? 12 : 16;
  const vertexStart = meshes.vertexOffsets[meshIndex];
  const vertexEnd = meshes.vertexOffsets[meshIndex + 1];
  const indexStart = meshes.indexOffsets[meshIndex];
  const indexEnd = meshes.indexOffsets[meshIndex + 1];
  if (
    !Number.isSafeInteger(vertexStart) ||
    !Number.isSafeInteger(vertexEnd) ||
    vertexStart < 0 ||
    vertexEnd < vertexStart ||
    vertexEnd > meshes.positions.length / 2 ||
    !Number.isSafeInteger(indexStart) ||
    !Number.isSafeInteger(indexEnd) ||
    indexStart < 0 ||
    indexEnd < indexStart ||
    indexEnd > meshes.indices.length
  ) {
    throw invalidError("Patch mesh offsets are invalid.", { meshIndex });
  }
  const vertexCount = vertexEnd - vertexStart;
  if (vertexCount <= 0 || vertexCount % controlsPerPatch !== 0 || indexEnd - indexStart !== vertexCount) {
    throw invalidError("Patch mesh does not contain complete control nets.", { meshIndex });
  }
  const patchCount = vertexCount / controlsPerPatch;
  if (patchCount * 4 > options.maxTriangles) {
    throw limitError("Patch count exceeds the minimum triangle budget.", {
      patchCount,
      limit: options.maxTriangles
    });
  }
  const patches: PatchRecord[] = [];
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex += 1) {
    throwIfCancelled(options.signal);
    const sourcePositions = new Float64Array(controlsPerPatch * 2);
    const cornerValues = new Float64Array(4 * (functionIndices.length > 0 ? 1 : componentCount));
    for (let control = 0; control < controlsPerPatch; control += 1) {
      const localControl = patchIndex * controlsPerPatch + control;
      const vertexIndex = vertexStart + localControl;
      if (meshes.indices[indexStart + localControl] !== vertexIndex) {
        throw invalidError("Patch control indices do not retain source order.", {
          meshIndex,
          patchIndex,
          control
        });
      }
      const positionOffset = vertexIndex * 2;
      sourcePositions[control * 2] = finiteNumber(
        meshes.positions[positionOffset],
        "patch x coordinate"
      );
      sourcePositions[control * 2 + 1] = finiteNumber(
        meshes.positions[positionOffset + 1],
        "patch y coordinate"
      );
      const colorOffset = vertexIndex * 4;
      if (!PATCH_CORNERS.includes(control)) {
        for (let component = 0; component < 4; component += 1) {
          if (meshes.colors[colorOffset + component] !== 0) {
            throw invalidError("Non-corner patch control has a color payload.", {
              meshIndex,
              patchIndex,
              control
            });
          }
        }
      } else {
        const storedCount = functionIndices.length > 0 ? 1 : componentCount;
        for (let component = storedCount; component < 4; component += 1) {
          if (meshes.colors[colorOffset + component] !== 0) {
            throw invalidError("Patch corner has data outside its component payload.", {
              meshIndex,
              patchIndex,
              control
            });
          }
        }
      }
    }
    for (let corner = 0; corner < 4; corner += 1) {
      const vertexIndex = vertexStart + patchIndex * controlsPerPatch + PATCH_CORNERS[corner];
      const colorOffset = vertexIndex * 4;
      const storedCount = functionIndices.length > 0 ? 1 : componentCount;
      for (let component = 0; component < storedCount; component += 1) {
        cornerValues[corner * storedCount + component] = finiteNumber(
          meshes.colors[colorOffset + component],
          "patch corner component"
        );
      }
    }
    patches.push({
      sourceIndex: patchIndex,
      net: expectedMeshKind === HEPR_MESH_KIND.CoonsPatch
        ? coonsToTensorNet(sourcePositions)
        : sourceTensorNet(sourcePositions),
      cornerValues,
      componentCount,
      functionIndices,
      colorCache: new Map(),
      positionCache: new Map(),
      edges: [],
      leaves: [],
      maxLeafDepth: 0,
      topologyDepth: 0
    });
  }
  return { meshIndex, colorSpaceIndex, componentCount, functionIndices, patches };
}

function buildPatchLeaves(patch: PatchRecord, context: TessellationContext): void {
  const stack: PatchLeaf[] = [{ net: patch.net, depth: 0, uCell: 0, vCell: 0 }];
  while (stack.length > 0) {
    throwIfCancelled(context.options.signal);
    const leaf = stack.pop()!;
    context.subdivisionNodes += 1;
    if (context.subdivisionNodes > context.options.maxSubdivisionNodes) {
      throw limitError("Patch tessellation exceeds its subdivision-node ceiling.", {
        count: context.subdivisionNodes,
        limit: context.options.maxSubdivisionNodes
      });
    }
    const geometryError = tensorTriangleErrorBound(leaf.net);
    const componentError = patchComponentError(patch, leaf, context);
    const needsFunctionFloor = patch.functionIndices.length > 0 && leaf.depth < context.options.minFunctionDepth;
    const flat =
      !needsFunctionFloor &&
      geometryError * 2 <= context.options.flatness &&
      componentError * 2 <= context.options.componentFlatness;
    if (flat) {
      patch.leaves.push(leaf);
      patch.maxLeafDepth = Math.max(patch.maxLeafDepth, leaf.depth);
      context.leafCount += 1;
      if (context.leafCount * 4 > context.options.maxTriangles) {
        throw limitError("Patch tessellation exceeds its minimum triangle ceiling.", {
          leafCount: context.leafCount,
          limit: context.options.maxTriangles
        });
      }
      continue;
    }
    if (leaf.depth >= context.options.maxDepth) {
      throw limitError("Patch tessellation cannot satisfy flatness within maxDepth.", {
        patchIndex: patch.sourceIndex,
        depth: leaf.depth,
        geometryError,
        componentError
      });
    }
    const children = splitTensorNet(leaf.net);
    const nextDepth = leaf.depth + 1;
    const u = leaf.uCell * 2;
    const v = leaf.vCell * 2;
    // Reverse push order gives deterministic increasing-v then increasing-u output.
    stack.push({ net: children[3], depth: nextDepth, uCell: u + 1, vCell: v + 1 });
    stack.push({ net: children[2], depth: nextDepth, uCell: u, vCell: v + 1 });
    stack.push({ net: children[1], depth: nextDepth, uCell: u + 1, vCell: v });
    stack.push({ net: children[0], depth: nextDepth, uCell: u, vCell: v });
  }
}

function patchComponentError(
  patch: PatchRecord,
  leaf: PatchLeaf,
  context: TessellationContext
): number {
  const scale = 2 ** leaf.depth;
  const u0 = leaf.uCell / scale;
  const v0 = leaf.vCell / scale;
  const u1 = (leaf.uCell + 1) / scale;
  const v1 = (leaf.vCell + 1) / scale;
  const c00 = evaluatePatchColor(patch, u0, v0, context).components;
  const c10 = evaluatePatchColor(patch, u1, v0, context).components;
  const c01 = evaluatePatchColor(patch, u0, v1, context).components;
  const c11 = evaluatePatchColor(patch, u1, v1, context).components;
  if (patch.functionIndices.length === 0) {
    let error = 0;
    for (let component = 0; component < patch.componentCount; component += 1) {
      error = Math.max(
        error,
        Math.abs(c10[component] + c01[component] - c00[component] - c11[component]) / 4
      );
    }
    return error;
  }

  let error = 0;
  for (let y = 0; y <= 4; y += 1) {
    for (let x = 0; x <= 4; x += 1) {
      if ((x === 0 || x === 4) && (y === 0 || y === 4)) continue;
      const localU = x / 4;
      const localV = y / 4;
      const actual = evaluatePatchColor(
        patch,
        u0 + (u1 - u0) * localU,
        v0 + (v1 - v0) * localV,
        context
      ).components;
      for (let component = 0; component < patch.componentCount; component += 1) {
        const linear = triangleInterpolate(
          c00[component],
          c10[component],
          c01[component],
          c11[component],
          localU,
          localV
        );
        error = Math.max(error, Math.abs(actual[component] - linear));
      }
    }
  }
  return error;
}

function evaluatePatchColor(
  patch: PatchRecord,
  u: number,
  v: number,
  context: TessellationContext
): PatchColorValue {
  const key = `${u}:${v}`;
  const cached = patch.colorCache.get(key);
  if (cached) return cached;
  const valueCount = patch.functionIndices.length > 0 ? 1 : patch.componentCount;
  const interpolated = new Float64Array(valueCount);
  for (let component = 0; component < valueCount; component += 1) {
    interpolated[component] = bilinear(
      patch.cornerValues[component],
      patch.cornerValues[valueCount + component],
      patch.cornerValues[valueCount * 2 + component],
      patch.cornerValues[valueCount * 3 + component],
      u,
      v
    );
  }
  let components: Float64Array;
  let functionInput = Number.NaN;
  if (patch.functionIndices.length === 0) {
    components = interpolated;
  } else {
    functionInput = interpolated[0];
    components = evaluatePatchFunctions(patch, functionInput, context);
  }
  const result = Object.freeze({ components, functionInput });
  patch.colorCache.set(key, result);
  return result;
}

function evaluatePatchFunctions(
  patch: PatchRecord,
  input: number,
  context: TessellationContext
): Float64Array {
  const evaluator = context.options.evaluateFunction;
  if (!evaluator) {
    throw new HeprPatchTessellationError(
      "function-evaluator-required",
      "Function-backed patch tessellation requires an HEPR function evaluator."
    );
  }
  if (patch.functionIndices.length === 1) {
    const output = callFunction(evaluator, patch.functionIndices[0], input, context);
    if (output.length !== patch.componentCount) {
      throw functionError("A scalar patch function returned the wrong component count.", {
        functionIndex: patch.functionIndices[0],
        expected: patch.componentCount,
        actual: output.length
      });
    }
    return finiteFunctionOutput(output);
  }
  if (patch.functionIndices.length !== patch.componentCount) {
    throw invalidError("Patch function array length does not match its color space.");
  }
  const components = new Float64Array(patch.componentCount);
  for (let component = 0; component < patch.componentCount; component += 1) {
    const output = callFunction(evaluator, patch.functionIndices[component], input, context);
    if (output.length !== 1) {
      throw functionError("A component patch function did not return one value.", {
        functionIndex: patch.functionIndices[component],
        actual: output.length
      });
    }
    components[component] = finiteNumber(output[0], "patch function output");
  }
  return components;
}

function callFunction(
  evaluator: HeprPatchFunctionEvaluator,
  functionIndex: number,
  input: number,
  context: TessellationContext
): ArrayLike<number> {
  throwIfCancelled(context.options.signal);
  context.functionEvaluations += 1;
  if (context.functionEvaluations > context.options.maxFunctionEvaluations) {
    throw limitError("Patch tessellation exceeds its function-evaluation ceiling.", {
      count: context.functionEvaluations,
      limit: context.options.maxFunctionEvaluations
    });
  }
  let output: ArrayLike<number>;
  try {
    output = evaluator(functionIndex, [input], context.options.signal);
  } catch (cause) {
    if (context.options.signal?.aborted) throwIfCancelled(context.options.signal);
    throw new HeprPatchTessellationError(
      "function-evaluation",
      `HEPR function ${functionIndex} failed during patch tessellation.`,
      { functionIndex },
      cause
    );
  }
  if (
    output === null ||
    output === undefined ||
    !Number.isSafeInteger(output.length) ||
    output.length < 0
  ) {
    throw functionError("A patch function evaluator returned a non-array result.", { functionIndex });
  }
  return output;
}

function finiteFunctionOutput(output: ArrayLike<number>): Float64Array {
  const result = new Float64Array(output.length);
  for (let index = 0; index < output.length; index += 1) {
    result[index] = finiteNumber(output[index], "patch function output");
  }
  return result;
}

function connectPatchEdges(
  patches: readonly PatchRecord[],
  signal?: AbortSignal
): PatchEdgeGroup[] {
  const groupsByKey = new Map<string, PatchEdgeGroup>();
  for (const patch of patches) {
    throwIfCancelled(signal);
    for (let side = 0; side < 4; side += 1) {
      const localPoints = tensorEdge(patch.net, side);
      const canonical = canonicalEdge(localPoints);
      let group = groupsByKey.get(canonical.key);
      if (!group) {
        group = {
          key: canonical.key,
          points: canonical.points,
          entries: [],
          samples: new Map(),
          depth: 0,
          values: new Set()
        };
        groupsByKey.set(canonical.key, group);
      }
      const use: PatchEdgeUse = { group, reversed: canonical.reversed };
      patch.edges[side] = use;
      group.entries.push({ patch, side, reversed: canonical.reversed });
    }
  }
  return [...groupsByKey.values()];
}

function synchronizePatchEdges(
  patches: readonly PatchRecord[],
  groups: readonly PatchEdgeGroup[],
  signal?: AbortSignal
): void {
  for (const group of groups) {
    throwIfCancelled(signal);
    group.depth = Math.max(...group.entries.map((entry) => entry.patch.maxLeafDepth));
    const scale = 2 ** group.depth;
    const values = new Set<number>([0, scale]);
    for (const entry of group.entries) {
      for (const leaf of entry.patch.leaves) {
        throwIfCancelled(signal);
        if (!leafTouchesSide(leaf, entry.side)) continue;
        const leafScale = 2 ** leaf.depth;
        const first = entry.side === SIDE_LEFT || entry.side === SIDE_RIGHT
          ? leaf.vCell
          : leaf.uCell;
        const multiplier = scale / leafScale;
        for (const local of [first * multiplier, (first + 1) * multiplier]) {
          values.add(entry.reversed ? scale - local : local);
        }
      }
    }
    group.values = values;
  }
  for (const patch of patches) {
    throwIfCancelled(signal);
    patch.topologyDepth = Math.max(
      patch.maxLeafDepth,
      ...patch.edges.map((edge) => edge.group.depth)
    );
  }
}

function buildPatchTopology(patch: PatchRecord, signal?: AbortSignal): PatchTopology {
  const scale = 2 ** patch.topologyDepth;
  const verticalSets = new Map<number, Set<number>>();
  const horizontalSets = new Map<number, Set<number>>();
  for (const leaf of patch.leaves) {
    throwIfCancelled(signal);
    const multiplier = scale / 2 ** leaf.depth;
    const x0 = leaf.uCell * multiplier;
    const x1 = (leaf.uCell + 1) * multiplier;
    const y0 = leaf.vCell * multiplier;
    const y1 = (leaf.vCell + 1) * multiplier;
    addLineEndpoints(verticalSets, x0, y0, y1);
    addLineEndpoints(verticalSets, x1, y0, y1);
    addLineEndpoints(horizontalSets, y0, x0, x1);
    addLineEndpoints(horizontalSets, y1, x0, x1);
  }
  for (let side = 0; side < 4; side += 1) {
    throwIfCancelled(signal);
    const edge = patch.edges[side];
    const groupScale = 2 ** edge.group.depth;
    const multiplier = scale / groupScale;
    for (const canonical of edge.group.values) {
      const local = (edge.reversed ? groupScale - canonical : canonical) * multiplier;
      if (side === SIDE_LEFT) addLineValue(verticalSets, 0, local);
      else if (side === SIDE_RIGHT) addLineValue(verticalSets, scale, local);
      else if (side === SIDE_BOTTOM) addLineValue(horizontalSets, 0, local);
      else addLineValue(horizontalSets, scale, local);
    }
  }
  return {
    scale,
    vertical: sortLineSets(verticalSets),
    horizontal: sortLineSets(horizontalSets)
  };
}

function leafPolygon(topology: PatchTopology, leaf: PatchLeaf): ParameterPoint[] {
  const multiplier = topology.scale / 2 ** leaf.depth;
  const x0 = leaf.uCell * multiplier;
  const x1 = (leaf.uCell + 1) * multiplier;
  const y0 = leaf.vCell * multiplier;
  const y1 = (leaf.vCell + 1) * multiplier;
  const bottom = lineRange(topology.horizontal.get(y0), x0, x1);
  const right = lineRange(topology.vertical.get(x1), y0, y1);
  const top = lineRange(topology.horizontal.get(y1), x0, x1).reverse();
  const left = lineRange(topology.vertical.get(x0), y0, y1).reverse();
  const points: Array<readonly [number, number]> = [];
  for (const x of bottom) points.push([x, y0]);
  for (const y of right.slice(1)) points.push([x1, y]);
  for (const x of top.slice(1)) points.push([x, y1]);
  for (const y of left.slice(1, -1)) points.push([x0, y]);
  if (points.length < 4) throw invalidError("Patch leaf topology is incomplete.");
  return points.map(([u, v]) => Object.freeze({
    u: u / topology.scale,
    v: v / topology.scale
  }));
}

function evaluatePatchPosition(patch: PatchRecord, u: number, v: number): readonly [number, number] {
  const key = `${u}:${v}`;
  const cached = patch.positionCache.get(key);
  if (cached) return cached;
  let side = -1;
  let t = 0;
  if (u === 0) { side = SIDE_LEFT; t = v; }
  else if (u === 1) { side = SIDE_RIGHT; t = v; }
  else if (v === 0) { side = SIDE_BOTTOM; t = u; }
  else if (v === 1) { side = SIDE_TOP; t = u; }
  let point: readonly [number, number];
  if (side >= 0) {
    const edge = patch.edges[side];
    const canonicalT = edge.reversed ? 1 - t : t;
    const sampleKey = String(canonicalT);
    const edgeCached = edge.group.samples.get(sampleKey);
    if (edgeCached) point = edgeCached;
    else {
      point = evaluateCubic(edge.group.points, canonicalT);
      edge.group.samples.set(sampleKey, point);
    }
  } else {
    point = evaluateTensor(patch.net, u, v);
  }
  patch.positionCache.set(key, point);
  return point;
}

function sourceTensorNet(source: Float64Array): Float64Array {
  if (source.length !== 32) throw invalidError("Tensor patch has the wrong control count.");
  const net = new Float64Array(32);
  const mapping = [
    [0, 0], [0, 1], [0, 2], [0, 3],
    [1, 3], [2, 3], [3, 3], [3, 2],
    [3, 1], [3, 0], [2, 0], [1, 0],
    [1, 1], [1, 2], [2, 2], [2, 1]
  ] as const;
  for (let sourceIndex = 0; sourceIndex < mapping.length; sourceIndex += 1) {
    setNetPoint(net, mapping[sourceIndex][0], mapping[sourceIndex][1], source[sourceIndex * 2], source[sourceIndex * 2 + 1]);
  }
  return net;
}

function coonsToTensorNet(source: Float64Array): Float64Array {
  if (source.length !== 24) throw invalidError("Coons patch has the wrong control count.");
  const net = new Float64Array(32);
  const boundaryMapping = [
    [0, 0], [0, 1], [0, 2], [0, 3],
    [1, 3], [2, 3], [3, 3], [3, 2],
    [3, 1], [3, 0], [2, 0], [1, 0]
  ] as const;
  for (let sourceIndex = 0; sourceIndex < boundaryMapping.length; sourceIndex += 1) {
    setNetPoint(
      net,
      boundaryMapping[sourceIndex][0],
      boundaryMapping[sourceIndex][1],
      source[sourceIndex * 2],
      source[sourceIndex * 2 + 1]
    );
  }
  const p00 = netPoint(net, 0, 0);
  const p30 = netPoint(net, 3, 0);
  const p03 = netPoint(net, 0, 3);
  const p33 = netPoint(net, 3, 3);
  for (const i of [1, 2]) {
    for (const j of [1, 2]) {
      const u = i / 3;
      const v = j / 3;
      const left = netPoint(net, 0, j);
      const right = netPoint(net, 3, j);
      const bottom = netPoint(net, i, 0);
      const top = netPoint(net, i, 3);
      const bilinearCorner = bilinearPoint(p00, p03, p33, p30, u, v);
      setNetPoint(
        net,
        i,
        j,
        (1 - u) * left[0] + u * right[0] + (1 - v) * bottom[0] + v * top[0] - bilinearCorner[0],
        (1 - u) * left[1] + u * right[1] + (1 - v) * bottom[1] + v * top[1] - bilinearCorner[1]
      );
    }
  }
  return net;
}

function tensorTriangleErrorBound(net: Float64Array): number {
  const p00 = netPoint(net, 0, 0);
  const p30 = netPoint(net, 3, 0);
  const p03 = netPoint(net, 0, 3);
  const p33 = netPoint(net, 3, 3);
  let controlError = 0;
  for (let j = 0; j < 4; j += 1) {
    for (let i = 0; i < 4; i += 1) {
      const actual = netPoint(net, i, j);
      const linear = bilinearPoint(p00, p03, p33, p30, i / 3, j / 3);
      controlError = Math.max(controlError, Math.hypot(actual[0] - linear[0], actual[1] - linear[1]));
    }
  }
  const twist = Math.hypot(
    p30[0] + p03[0] - p00[0] - p33[0],
    p30[1] + p03[1] - p00[1] - p33[1]
  ) / 4;
  return controlError + twist;
}

function splitTensorNet(net: Float64Array): readonly [Float64Array, Float64Array, Float64Array, Float64Array] {
  const left = new Float64Array(32);
  const right = new Float64Array(32);
  for (let j = 0; j < 4; j += 1) {
    const split = splitCubic([
      netPoint(net, 0, j), netPoint(net, 1, j), netPoint(net, 2, j), netPoint(net, 3, j)
    ]);
    for (let i = 0; i < 4; i += 1) {
      setNetPoint(left, i, j, split[0][i][0], split[0][i][1]);
      setNetPoint(right, i, j, split[1][i][0], split[1][i][1]);
    }
  }
  const bottomLeft = new Float64Array(32);
  const topLeft = new Float64Array(32);
  const bottomRight = new Float64Array(32);
  const topRight = new Float64Array(32);
  for (const [source, bottom, top] of [
    [left, bottomLeft, topLeft],
    [right, bottomRight, topRight]
  ] as const) {
    for (let i = 0; i < 4; i += 1) {
      const split = splitCubic([
        netPoint(source, i, 0), netPoint(source, i, 1), netPoint(source, i, 2), netPoint(source, i, 3)
      ]);
      for (let j = 0; j < 4; j += 1) {
        setNetPoint(bottom, i, j, split[0][j][0], split[0][j][1]);
        setNetPoint(top, i, j, split[1][j][0], split[1][j][1]);
      }
    }
  }
  return [bottomLeft, bottomRight, topLeft, topRight];
}

function splitCubic(
  points: readonly (readonly [number, number])[]
): readonly [readonly (readonly [number, number])[], readonly (readonly [number, number])[]] {
  const p01 = midpoint(points[0], points[1]);
  const p12 = midpoint(points[1], points[2]);
  const p23 = midpoint(points[2], points[3]);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const center = midpoint(p012, p123);
  return [[points[0], p01, p012, center], [center, p123, p23, points[3]]];
}

function evaluateTensor(net: Float64Array, u: number, v: number): readonly [number, number] {
  const bu = bernstein3(u);
  const bv = bernstein3(v);
  let x = 0;
  let y = 0;
  for (let j = 0; j < 4; j += 1) {
    for (let i = 0; i < 4; i += 1) {
      const weight = bu[i] * bv[j];
      const offset = (j * 4 + i) * 2;
      x += net[offset] * weight;
      y += net[offset + 1] * weight;
    }
  }
  return Object.freeze([x, y]);
}

function evaluateCubic(points: Float64Array, t: number): readonly [number, number] {
  if (t === 0) return Object.freeze([points[0], points[1]]);
  if (t === 1) return Object.freeze([points[6], points[7]]);
  const b = bernstein3(t);
  return Object.freeze([
    points[0] * b[0] + points[2] * b[1] + points[4] * b[2] + points[6] * b[3],
    points[1] * b[0] + points[3] * b[1] + points[5] * b[2] + points[7] * b[3]
  ]);
}

function tensorEdge(net: Float64Array, side: number): Float64Array {
  const points = new Float64Array(8);
  for (let index = 0; index < 4; index += 1) {
    const point = side === SIDE_LEFT
      ? netPoint(net, 0, index)
      : side === SIDE_RIGHT
        ? netPoint(net, 3, index)
        : side === SIDE_BOTTOM
          ? netPoint(net, index, 0)
          : netPoint(net, index, 3);
    points[index * 2] = point[0];
    points[index * 2 + 1] = point[1];
  }
  return points;
}

function canonicalEdge(points: Float64Array): { readonly key: string; readonly points: Float64Array; readonly reversed: boolean } {
  const reversedPoints = new Float64Array(8);
  for (let index = 0; index < 4; index += 1) {
    reversedPoints[index * 2] = points[(3 - index) * 2];
    reversedPoints[index * 2 + 1] = points[(3 - index) * 2 + 1];
  }
  const forwardKey = edgeKey(points);
  const reverseKey = edgeKey(reversedPoints);
  return reverseKey < forwardKey
    ? { key: reverseKey, points: reversedPoints, reversed: true }
    : { key: forwardKey, points, reversed: false };
}

const EDGE_KEY_BUFFER = new ArrayBuffer(4);
const EDGE_KEY_FLOAT = new Float32Array(EDGE_KEY_BUFFER);
const EDGE_KEY_UINT = new Uint32Array(EDGE_KEY_BUFFER);

function edgeKey(points: Float64Array): string {
  const parts: string[] = [];
  for (const value of points) {
    EDGE_KEY_FLOAT[0] = Object.is(value, -0) ? 0 : Math.fround(value);
    parts.push(EDGE_KEY_UINT[0].toString(16).padStart(8, "0"));
  }
  return parts.join("");
}

function leafTouchesSide(leaf: PatchLeaf, side: number): boolean {
  const scale = 2 ** leaf.depth;
  if (side === SIDE_LEFT) return leaf.uCell === 0;
  if (side === SIDE_RIGHT) return leaf.uCell + 1 === scale;
  if (side === SIDE_BOTTOM) return leaf.vCell === 0;
  return leaf.vCell + 1 === scale;
}

function addLineEndpoints(
  lines: Map<number, Set<number>>,
  line: number,
  first: number,
  second: number
): void {
  addLineValue(lines, line, first);
  addLineValue(lines, line, second);
}

function addLineValue(lines: Map<number, Set<number>>, line: number, value: number): void {
  let values = lines.get(line);
  if (!values) {
    values = new Set();
    lines.set(line, values);
  }
  values.add(value);
}

function sortLineSets(lines: Map<number, Set<number>>): ReadonlyMap<number, readonly number[]> {
  return new Map([...lines].map(([line, values]) => [line, [...values].sort((a, b) => a - b)]));
}

function lineRange(
  values: readonly number[] | undefined,
  minimum: number,
  maximum: number
): number[] {
  if (!values) throw invalidError("Patch topology is missing a leaf boundary.");
  const first = lowerBound(values, minimum);
  const end = upperBound(values, maximum);
  const result = values.slice(first, end);
  if (result[0] !== minimum || result[result.length - 1] !== maximum) {
    throw invalidError("Patch topology leaf boundary is truncated.");
  }
  return result;
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function setNetPoint(net: Float64Array, i: number, j: number, x: number, y: number): void {
  const offset = (j * 4 + i) * 2;
  net[offset] = x;
  net[offset + 1] = y;
}

function netPoint(net: Float64Array, i: number, j: number): readonly [number, number] {
  const offset = (j * 4 + i) * 2;
  return [net[offset], net[offset + 1]];
}

function bilinearPoint(
  p00: readonly [number, number],
  p03: readonly [number, number],
  p33: readonly [number, number],
  p30: readonly [number, number],
  u: number,
  v: number
): readonly [number, number] {
  return [
    bilinear(p00[0], p03[0], p33[0], p30[0], u, v),
    bilinear(p00[1], p03[1], p33[1], p30[1], u, v)
  ];
}

function bilinear(c00: number, c03: number, c33: number, c30: number, u: number, v: number): number {
  return (1 - u) * (1 - v) * c00 +
    (1 - u) * v * c03 +
    u * v * c33 +
    u * (1 - v) * c30;
}

function triangleInterpolate(
  c00: number,
  c10: number,
  c01: number,
  c11: number,
  u: number,
  v: number
): number {
  return v <= u
    ? (1 - u) * c00 + (u - v) * c10 + v * c11
    : (1 - v) * c00 + u * c11 + (v - u) * c01;
}

function bernstein3(value: number): readonly [number, number, number, number] {
  const inverse = 1 - value;
  return [
    inverse * inverse * inverse,
    3 * value * inverse * inverse,
    3 * value * value * inverse,
    value * value * value
  ];
}

function midpoint(
  first: readonly [number, number],
  second: readonly [number, number]
): readonly [number, number] {
  return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
}

function checkedAdd(first: number, second: number, label: string): number {
  const value = first + second;
  if (!Number.isSafeInteger(value)) throw limitError(`${label} overflows safe integer arithmetic.`);
  return value;
}

function checkedMultiply(first: number, second: number, label: string): number {
  const value = first * second;
  if (!Number.isSafeInteger(value) || value > 0xffff_ffff) {
    throw limitError(`${label} exceeds the typed-array address space.`);
  }
  return value;
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw invalidError(`${label} is not finite.`);
  return value;
}

function finiteFloat32(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
    throw invalidError(`${label} cannot be represented as Float32.`);
  }
  return value;
}

function requirePositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite.`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
}

function requireIntegerRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new HeprPatchTessellationError("aborted", "Patch tessellation was cancelled.");
  }
}

function invalidError(
  message: string,
  details: Readonly<Record<string, number | string | boolean>> = {}
): HeprPatchTessellationError {
  return new HeprPatchTessellationError("invalid-data", message, details);
}

function limitError(
  message: string,
  details: Readonly<Record<string, number | string | boolean>> = {}
): HeprPatchTessellationError {
  return new HeprPatchTessellationError("resource-limit", message, details);
}

function functionError(
  message: string,
  details: Readonly<Record<string, number | string | boolean>> = {}
): HeprPatchTessellationError {
  return new HeprPatchTessellationError("function-evaluation", message, details);
}
