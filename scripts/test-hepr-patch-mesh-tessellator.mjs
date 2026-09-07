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

try {
  const [dataApi, tessellationApi] = await Promise.all([
    import("../src/heprDocumentData.ts"),
    import("../src/heprPatchMeshTessellator.ts")
  ]);
  const {
    createEmptyHeprPageData,
    HEPR_COLOR_SPACE_KIND,
    HEPR_FUNCTION_KIND,
    HEPR_GRADIENT_KIND,
    HEPR_MESH_KIND
  } = dataApi;
  const { tessellateHeprPatchMesh } = tessellationApi;

  const coonsPage = makePage({
    dataApi,
    meshKind: HEPR_MESH_KIND.CoonsPatch,
    gradientKind: HEPR_GRADIENT_KIND.CoonsPatchMesh,
    patches: [flatCoons(0), flatCoons(2)],
    corners: [affineRgbCorners(), affineRgbCorners()]
  });
  const direct = tessellateHeprPatchMesh(coonsPage, 0, {
    flatness: 1e-6,
    componentFlatness: 1e-6,
    maxDepth: 4
  });
  assert.deepEqual([...direct.patchTriangleOffsets], [0, 4, 8]);
  assert.deepEqual([...direct.patchDepths], [0, 0]);
  assert.equal(direct.positions.length, 8 * 6);
  assert.equal(direct.components.length, 8 * 3 * 3);
  assert.equal(direct.functionInputs.length, 0);
  assert.ok([...direct.positions.slice(0, 4 * 6)].every((value, index) => index % 2 === 1 || value <= 1));
  assert.ok([...direct.positions.slice(4 * 6)].every((value, index) => index % 2 === 1 || value >= 2));
  closeArray([...direct.positions.slice(0, 2)], [0.5, 0.5]);
  closeArray([...direct.components.slice(0, 3)], [0.5, 0.5, 0]);

  const curvedTensor = flatTensor(0);
  curvedTensor[12][1] += 1;
  const tensorPage = makePage({
    dataApi,
    meshKind: HEPR_MESH_KIND.TensorPatch,
    gradientKind: HEPR_GRADIENT_KIND.TensorPatchMesh,
    patches: [curvedTensor],
    corners: [affineRgbCorners()]
  });
  const tensor = tessellateHeprPatchMesh(tensorPage, 0, {
    flatness: 10,
    componentFlatness: 1,
    maxDepth: 0
  });
  closeArray(
    [...tensor.positions.slice(0, 2)],
    [0.5, 0.5 + 9 / 64],
    1e-6,
    "source point 13 maps to tensor p11"
  );

  const directSaddlePage = makePage({
    dataApi,
    meshKind: HEPR_MESH_KIND.TensorPatch,
    gradientKind: HEPR_GRADIENT_KIND.TensorPatchMesh,
    patches: [flatTensor(0)],
    corners: [[
      [0, 0, 0], [1, 0, 0], [0, 0, 0], [1, 0, 0]
    ]]
  });
  const directSaddle = tessellateHeprPatchMesh(directSaddlePage, 0, {
    flatness: 1,
    componentFlatness: 0.02,
    maxDepth: 6
  });
  assert.ok(directSaddle.patchDepths[0] > 0, "bilinear direct color drives adaptive subdivision");

  const joinedPage = makePage({
    dataApi,
    meshKind: HEPR_MESH_KIND.TensorPatch,
    gradientKind: HEPR_GRADIENT_KIND.TensorPatchMesh,
    patches: [flatTensor(0), bowedTensor(1)],
    corners: [affineRgbCorners(), affineRgbCorners()]
  });
  const joined = tessellateHeprPatchMesh(joinedPage, 0, {
    flatness: 0.01,
    componentFlatness: 1,
    maxDepth: 8,
    maxTriangles: 100_000
  });
  assert.equal(joined.patchDepths[0], 0, "the flat patch remains one adaptive leaf");
  assert.ok(joined.patchDepths[1] > 0, "the bowed patch subdivides");
  const firstEdge = boundaryValues(joined, 0, 1);
  const secondEdge = boundaryValues(joined, 1, 1);
  assert.deepEqual(firstEdge, secondEdge, "shared patch edges use identical synchronized samples");
  assert.ok(firstEdge.length > 2, "a coarse neighbour receives the refined edge samples");
  const joinedAgain = tessellateHeprPatchMesh(joinedPage, 0, {
    flatness: 0.01,
    componentFlatness: 1,
    maxDepth: 8,
    maxTriangles: 100_000
  });
  assert.deepEqual([...joinedAgain.positions], [...joined.positions], "tessellation is deterministic");
  assert.deepEqual([...joinedAgain.components], [...joined.components]);
  assert.deepEqual([...joinedAgain.patchTriangleOffsets], [...joined.patchTriangleOffsets]);

  const scalarPage = makePage({
    dataApi,
    meshKind: HEPR_MESH_KIND.TensorPatch,
    gradientKind: HEPR_GRADIENT_KIND.TensorPatchMesh,
    patches: [flatTensor(0)],
    corners: [[[0], [0], [1], [1]]],
    functionIndices: [0],
    functionCount: 1
  });
  const observedInputs = [];
  const scalar = tessellateHeprPatchMesh(scalarPage, 0, {
    flatness: 1,
    componentFlatness: 0.005,
    minFunctionDepth: 1,
    maxDepth: 8,
    evaluateFunction(index, inputs) {
      assert.equal(index, 0);
      assert.equal(inputs.length, 1);
      observedInputs.push(inputs[0]);
      return [inputs[0], inputs[0] ** 2, 1 - inputs[0]];
    }
  });
  assert.deepEqual([...scalar.functionIndices], [0]);
  assert.equal(scalar.functionInputs.length, scalar.positions.length / 2);
  assert.ok(observedInputs.some((value) => value > 0 && value < 1));
  for (let vertex = 0; vertex < scalar.functionInputs.length; vertex += 1) {
    const t = scalar.functionInputs[vertex];
    closeArray(
      [...scalar.components.slice(vertex * 3, vertex * 3 + 3)],
      [t, t * t, 1 - t],
      2e-6,
      "t is interpolated before the nonlinear function"
    );
  }

  assert.throws(
    () => tessellateHeprPatchMesh(scalarPage, 0),
    hasTessellationCode("function-evaluator-required")
  );
  assert.throws(
    () => tessellateHeprPatchMesh(scalarPage, 0, {
      evaluateFunction() { return [0]; }
    }),
    hasTessellationCode("function-evaluation")
  );
  assert.throws(
    () => tessellateHeprPatchMesh(scalarPage, 0, {
      maxFunctionEvaluations: 1,
      evaluateFunction(_index, inputs) { return [inputs[0], inputs[0], inputs[0]]; }
    }),
    hasTessellationCode("resource-limit")
  );

  const arrayPage = makePage({
    dataApi,
    meshKind: HEPR_MESH_KIND.CoonsPatch,
    gradientKind: HEPR_GRADIENT_KIND.CoonsPatchMesh,
    patches: [flatCoons(0)],
    corners: [[[0], [0], [1], [1]]],
    functionIndices: [0, 1, 2],
    functionArray: true,
    functionCount: 3
  });
  const arrayResult = tessellateHeprPatchMesh(arrayPage, 0, {
    flatness: 1,
    componentFlatness: 1,
    minFunctionDepth: 0,
    maxDepth: 2,
    evaluateFunction(index, inputs) {
      return index === 0 ? [inputs[0]] : index === 1 ? [2 * inputs[0]] : [1 - inputs[0]];
    }
  });
  assert.deepEqual([...arrayResult.functionIndices], [0, 1, 2]);
  for (let vertex = 0; vertex < arrayResult.functionInputs.length; vertex += 1) {
    const t = arrayResult.functionInputs[vertex];
    closeArray(
      [...arrayResult.components.slice(vertex * 3, vertex * 3 + 3)],
      [t, 2 * t, 1 - t]
    );
  }

  assert.throws(
    () => tessellateHeprPatchMesh(tensorPage, 0, {
      flatness: 1e-9,
      componentFlatness: 1,
      maxDepth: 0
    }),
    hasTessellationCode("resource-limit")
  );
  assert.throws(
    () => tessellateHeprPatchMesh(coonsPage, 0, { maxTriangles: 7 }),
    hasTessellationCode("resource-limit")
  );
  assert.throws(
    () => tessellateHeprPatchMesh(coonsPage, 0, { maxOutputBytes: 32 }),
    hasTessellationCode("resource-limit")
  );
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => tessellateHeprPatchMesh(coonsPage, 0, { signal: controller.signal }),
    hasTessellationCode("aborted")
  );

  const corruptIndexPage = makePage({
    dataApi,
    meshKind: HEPR_MESH_KIND.CoonsPatch,
    gradientKind: HEPR_GRADIENT_KIND.CoonsPatchMesh,
    patches: [flatCoons(0)],
    corners: [affineRgbCorners()]
  });
  corruptIndexPage.stores.meshes.indices[1] = 0;
  assert.throws(
    () => tessellateHeprPatchMesh(corruptIndexPage, 0),
    hasTessellationCode("invalid-data")
  );

  console.log("renderer-neutral HEPR patch mesh tessellation tests passed");
} finally {
  hooks.deregister();
}

function makePage({
  dataApi,
  meshKind,
  gradientKind,
  patches,
  corners,
  functionIndices = [],
  functionArray = false,
  functionCount = 0
}) {
  const page = dataApi.createEmptyHeprPageData({
    sourcePageIndex: 0,
    mediaBox: [0, 0, 10, 10],
    cropBox: [0, 0, 10, 10],
    bleedBox: null,
    trimBox: null,
    artBox: null,
    rotation: 0,
    userUnit: 1,
    width: 10,
    height: 10
  });
  page.stores.colors = {
    spaceKinds: new Uint8Array([dataApi.HEPR_COLOR_SPACE_KIND.DeviceRGB]),
    componentCounts: new Uint8Array([3]),
    alternateSpaceIndices: new Int32Array([-1]),
    functionIndices: new Int32Array([-1]),
    parameterOffsets: new Uint32Array([0, 0]),
    parameters: new Float32Array(0),
    nameOffsets: new Uint32Array([0, 0]),
    names: [],
    profileOffsets: new Uint32Array([0, 0]),
    profiles: new Uint8Array(0),
    lookupOffsets: new Uint32Array([0, 0]),
    lookupBytes: new Uint8Array(0)
  };
  page.stores.functions = {
    kinds: new Uint8Array(functionCount).fill(dataApi.HEPR_FUNCTION_KIND.Exponential),
    domainOffsets: zeroOffsets(functionCount),
    domains: new Float32Array(0),
    rangeOffsets: zeroOffsets(functionCount),
    ranges: new Float32Array(0),
    parameterOffsets: zeroOffsets(functionCount),
    parameters: new Float32Array(0),
    sampleOffsets: zeroOffsets(functionCount),
    samples: new Float32Array(0),
    calculatorOffsets: zeroOffsets(functionCount),
    calculatorBytecode: new Uint8Array(0)
  };
  const controlsPerPatch = meshKind === dataApi.HEPR_MESH_KIND.CoonsPatch ? 12 : 16;
  const positions = Float32Array.from(patches.flatMap((patch) => patch.flat()));
  const colorValues = new Float32Array(patches.length * controlsPerPatch * 4);
  const storedComponentCount = functionIndices.length > 0 ? 1 : 3;
  patches.forEach((_patch, patchIndex) => {
    [0, 3, 6, 9].forEach((control, corner) => {
      const base = (patchIndex * controlsPerPatch + control) * 4;
      for (let component = 0; component < storedComponentCount; component += 1) {
        colorValues[base + component] = corners[patchIndex][corner][component];
      }
    });
  });
  const vertexCount = positions.length / 2;
  page.stores.meshes = {
    kinds: new Uint8Array([meshKind]),
    vertexOffsets: new Uint32Array([0, vertexCount]),
    indexOffsets: new Uint32Array([0, vertexCount]),
    positions,
    colors: colorValues,
    indices: Uint32Array.from({ length: vertexCount }, (_, index) => index),
    colorSpaceIndices: new Int32Array([0])
  };
  page.stores.gradients = {
    kinds: new Uint8Array([gradientKind]),
    colorSpaceIndices: new Int32Array([0]),
    functionIndices: new Int32Array([functionArray ? -1 : (functionIndices[0] ?? -1)]),
    coordinateOffsets: new Uint32Array([0, functionArray ? functionIndices.length : 0]),
    coordinates: Float32Array.from(functionArray ? functionIndices : []),
    stopOffsets: new Uint32Array([0, 0]),
    stopPositions: new Float32Array(0),
    stopPaintIndices: new Uint32Array(0),
    meshIndices: new Int32Array([0]),
    extendFlags: new Uint8Array([functionArray ? 1 << 5 : 0])
  };
  return page;
}

function zeroOffsets(count) {
  return new Uint32Array(count + 1);
}

function flatCoons(xOffset) {
  return [
    [xOffset, 0], [xOffset, 1 / 3], [xOffset, 2 / 3], [xOffset, 1],
    [xOffset + 1 / 3, 1], [xOffset + 2 / 3, 1], [xOffset + 1, 1],
    [xOffset + 1, 2 / 3], [xOffset + 1, 1 / 3], [xOffset + 1, 0],
    [xOffset + 2 / 3, 0], [xOffset + 1 / 3, 0]
  ];
}

function flatTensor(xOffset) {
  return [
    ...flatCoons(xOffset),
    [xOffset + 1 / 3, 1 / 3],
    [xOffset + 1 / 3, 2 / 3],
    [xOffset + 2 / 3, 2 / 3],
    [xOffset + 2 / 3, 1 / 3]
  ];
}

function bowedTensor(xOffset) {
  const points = flatTensor(xOffset);
  points[12] = [points[12][0], 2];
  return points;
}

function affineRgbCorners() {
  return [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]];
}

function boundaryValues(result, patchIndex, x) {
  const firstTriangle = result.patchTriangleOffsets[patchIndex];
  const endTriangle = result.patchTriangleOffsets[patchIndex + 1];
  const values = new Set();
  for (let offset = firstTriangle * 6; offset < endTriangle * 6; offset += 2) {
    if (Math.abs(result.positions[offset] - x) <= 1e-7) {
      values.add(result.positions[offset + 1]);
    }
  }
  return [...values].sort((a, b) => a - b);
}

function closeArray(actual, expected, tolerance = 1e-6, message = "arrays differ") {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= tolerance, `${message}: ${value} != ${expected[index]}`);
  });
}

function hasTessellationCode(code) {
  return (error) => {
    assert.equal(error?.name, "HeprPatchTessellationError");
    assert.equal(error?.code, code);
    return true;
  };
}
