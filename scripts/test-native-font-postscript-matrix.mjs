import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const {
    nativeFontPostScriptIdentityMatrix: identity,
    nativeFontPostScriptConcatMatrices: concat,
    nativeFontPostScriptInvertMatrix: invert,
    nativeFontPostScriptTranslation: translate,
    nativeFontPostScriptScaling: scale,
    nativeFontPostScriptRotation: rotate,
    nativeFontPostScriptTransform: transform
  } = await import("../src/pdf/nativeFontPostScriptMatrix.ts");
  const { executeNativeFontPostScript } = await import("../src/pdf/nativeFontPostScript.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const bytes = value => new TextEncoder().encode(value);
  const execute = (source, options = {}) => executeNativeFontPostScript(bytes(source), undefined,
    { initialDictionary: new Map([["FontType", 1]]), ...options });
  const unsupported = fn => assert.throws(fn, error => error instanceof PdfError && error.code === "unsupported-font");
  const near = (actual, expected, label = "affine result") => {
    assert.equal(actual.length, expected.length, label);
    for (let i = 0; i < expected.length; i++) {
      assert(Number.isFinite(actual[i]), `${label}: finite component ${i}`);
      const tolerance = 2e-12 * Math.max(Math.abs(expected[i]), Number.MIN_VALUE);
      assert(Math.abs(actual[i] - expected[i]) <= tolerance || actual[i] === expected[i],
        `${label}: component ${i} expected ${expected[i]}, received ${actual[i]}`);
    }
  };

  // PLRM 4.3.3 uses row vectors, unlike the convention of many JavaScript
  // graphics libraries. Independent Ghostscript 10.02 confirms these values.
  const first = [2, 3, 5, 7, 11, 13], second = [17, 19, 23, 29, 31, 37];
  assert.deepEqual(identity(), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(concat(first, second), [103, 125, 246, 298, 517, 623]);
  assert.deepEqual(transform(2, 4, first), [35, 47]);
  assert.deepEqual(transform(2, 4, first, true), [24, 34], "distance transformation excludes translation");
  near(invert(first), [-7, 3, 5, -2, 12, -7]);
  near(transform(35, 47, first, false, true), [2, 4]);
  near(transform(24, 34, first, true, true), [2, 4]);
  assert.deepEqual(transform(2, 4, concat(first, second)), [1707, 2065]);
  assert.deepEqual(transform(...transform(2, 4, first), second), [1707, 2065]);
  assert.deepEqual(translate(10, 20), [1, 0, 0, 1, 10, 20]);
  assert.deepEqual(scale(-2, 3), [-2, 0, 0, 3, 0, 0]);
  assert.deepEqual(rotate(90), [0, 1, -1, 0, 0, 0]);
  assert.deepEqual(rotate(-90), [0, -1, 1, 0, 0, 0]);
  assert.deepEqual(rotate(540), [-1, 0, 0, -1, 0, 0]);
  assert.deepEqual(rotate(-720), identity());
  near(rotate(1e-12), [1, 1e-12 * Math.PI / 180, -1e-12 * Math.PI / 180, 1, 0, 0]);
  near(rotate(-1e-12), [1, -1e-12 * Math.PI / 180, 1e-12 * Math.PI / 180, 1, 0, 0]);
  near(transform(3, 4, rotate(30)), [0.598076211353316, 4.964101615137754]);
  near(invert([0, 2, -3, 0, 9, -11]), [0, -1 / 3, 0.5, 0, 5.5, 3]);
  for (const value of [identity(), concat(first, second), invert(first), translate(1, 2), scale(3, 4), rotate(30), transform(1, 2, first)]) {
    assert(Object.isFrozen(value), "affine results are immutable");
  }
  assert.deepEqual(first, [2, 3, 5, 7, 11, 13], "input matrices are unchanged");

  // Valid extreme scales must not fail just because computing a*d directly
  // would overflow or underflow. There is no arbitrary singularity epsilon.
  near(invert([1e200, 0, 0, 1e200, 1e200, -1e200]), [1e-200, 0, 0, 1e-200, -1, 1]);
  near(invert([1e-200, 0, 0, 1e-200, 1e-200, -1e-200]), [1e200, 0, 0, 1e200, -1, 1]);
  near(invert([1e-200, 0, 0, 1e200, 0, 0]), [1e200, 0, 0, 1e-200, 0, 0]);
  near(invert([1e160, 1e160, 1e-150, 2e-150, 0, 0]), [2e-160, -1e150, -1e-160, 1e150, 0, 0]);
  assert(invert([1, 1, 1, 1 + Number.EPSILON, 0, 0]).every(Number.isFinite));
  const enormousTranslation = [1e-200, 0, 0, 1e-200, 1e200, -1e200];
  near(transform(1e-200, 2e-200, enormousTranslation, true, true), [1, 2]);
  unsupported(() => invert(enormousTranslation));
  for (const value of [[0, 0, 0, 0, 0, 0], [1, 2, 2, 4, 5, 6], [0, 2, 0, 3, 0, 0]]) {
    unsupported(() => invert(value));
    unsupported(() => transform(1, 2, value, false, true));
    unsupported(() => transform(1, 2, value, true, true));
    assert(transform(1, 2, value).every(Number.isFinite), "singular matrices can still transform forwards");
  }
  for (const run of [
    () => concat([1, 0, 0, 1, 0], identity()), () => invert([1, 0, 0, 1, 0, 0, 7]),
    () => invert([1, 0, 0, 1, NaN, 0]), () => scale(Infinity, 1), () => rotate(NaN),
    () => translate(1, "2"), () => transform(NaN, 2, identity()),
    () => concat([Number.MAX_VALUE, 0, 0, 1, 0, 0], [2, 0, 0, 1, 0, 0]),
    () => transform(2, 0, [Number.MAX_VALUE, 0, 0, 1, 0, 0])
  ]) unsupported(run);

  const explicit = execute(`
    /identity matrix def
    /destination [9 8 7 6 5 4] def
    /translation 10 20 destination translate def
    /destinationAliased translation destination eq def
    /scaling -2 3 matrix scale def /rotation 90 matrix rotate def
    /product [2 3 5 7 11 13] [17 19 23 29 31 37] matrix concatmatrix def
    /inversion [2 3 5 7 11 13] readonly matrix invertmatrix def
    /point 2 4 [2 3 5 7 11 13] transform 2 array astore def
    /distance 2 4 [2 3 5 7 11 13] dtransform 2 array astore def
    /inversePoint 35 47 [2 3 5 7 11 13] itransform 2 array astore def
    /inverseDistance 24 34 [2 3 5 7 11 13] idtransform 2 array astore def
    /source [2 0 0 3 5 7] def source source invertmatrix pop
    /storage [9 9 9 9 9 9 9 9] def /view storage 1 6 getinterval def
    view identmatrix pop
  `).dictionary;
  assert.deepEqual(explicit.get("identity"), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(explicit.get("translation"), [1, 0, 0, 1, 10, 20]);
  assert.equal(explicit.get("destinationAliased"), true, "matrix operators return the exact destination array reference");
  assert.deepEqual(explicit.get("scaling"), [-2, 0, 0, 3, 0, 0]);
  assert.deepEqual(explicit.get("rotation"), [0, 1, -1, 0, 0, 0]);
  assert.deepEqual(explicit.get("product"), [103, 125, 246, 298, 517, 623]);
  near(explicit.get("inversion"), [-7, 3, 5, -2, 12, -7]);
  near(explicit.get("point"), [35, 47]); near(explicit.get("distance"), [24, 34]);
  near(explicit.get("inversePoint"), [2, 4]); near(explicit.get("inverseDistance"), [2, 4]);
  near(explicit.get("source"), [0.5, 0, 0, 1 / 3, -2.5, -7 / 3]);
  assert.deepEqual(explicit.get("storage"), [9, 1, 0, 0, 1, 0, 0, 9], "matrix writes retain shared interval storage");

  // A caller-supplied matrix supplies the graphics context. All explicit matrix
  // forms leave it untouched; gsave/grestore isolate changes.
  const state = execute(`
    initmatrix
    /default matrix defaultmatrix def
    10 20 translate 2 3 scale
    /before matrix currentmatrix def
    gsave 90 rotate
      /inside matrix currentmatrix def
      /point 4 5 transform 2 array astore def
      /distance 4 5 dtransform 2 array astore def
      /backPoint -0 32 itransform 2 array astore def
      /backDistance -10 12 idtransform 2 array astore def
      gsave [7 0 0 8 9 10] setmatrix /nested matrix currentmatrix def grestore
    grestore
    /after matrix currentmatrix def
    30 matrix rotate pop 99 88 matrix translate pop 7 8 matrix scale pop
    /afterExplicit matrix currentmatrix def
    [1 2 3 4 5 6] concat /concatenated matrix currentmatrix def
    initmatrix /reset matrix currentmatrix def
  `, { initialMatrix: [1, 0, 0, 1, 0, 0] }).dictionary;
  assert.deepEqual(state.get("default"), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(state.get("before"), [2, 0, 0, 3, 10, 20]);
  assert.deepEqual(state.get("inside"), [0, 3, -2, 0, 10, 20]);
  near(state.get("point"), [0, 32]); near(state.get("distance"), [-10, 12]);
  near(state.get("backPoint"), [4, 5]); near(state.get("backDistance"), [4, 5]);
  assert.deepEqual(state.get("nested"), [7, 0, 0, 8, 9, 10]);
  assert.deepEqual(state.get("after"), state.get("before"));
  assert.deepEqual(state.get("afterExplicit"), state.get("before"));
  assert.deepEqual(state.get("concatenated"), [2, 6, 6, 12, 20, 38]);
  assert.deepEqual(state.get("reset"), [1, 0, 0, 1, 0, 0]);

  for (const source of ["matrix currentmatrix", "matrix defaultmatrix", "1 2 transform", "1 2 dtransform", "1 2 itransform", "1 2 idtransform"]) {
    assert.throws(() => execute(source), error => error instanceof PdfError && error.details.operator === source.split(" ").at(-1));
  }
  const established = execute(`[2 0 0 3 10 20] setmatrix /point 4 5 transform 2 array astore def
    /matrix matrix currentmatrix def`).dictionary;
  assert.deepEqual(established.get("point"), [18, 35]);
  assert.deepEqual(established.get("matrix"), [2, 0, 0, 3, 10, 20]);
  unsupported(() => execute("matrix setmatrix matrix defaultmatrix"));
  unsupported(() => execute("gsave matrix setmatrix grestore matrix currentmatrix"));

  for (const source of [
    "matrix readonly identmatrix", "matrix readonly currentmatrix", "matrix readonly defaultmatrix",
    "1 2 matrix readonly translate", "1 2 matrix readonly scale", "90 matrix readonly rotate",
    "matrix matrix matrix readonly concatmatrix", "matrix matrix readonly invertmatrix",
    "[1 0 0 1 0 0] noaccess matrix invertmatrix", "[0 0 0 0 0 0] setmatrix 1 2 itransform",
    "[0 0 0 0 0 0] matrix invertmatrix", "7 array identmatrix", "5 array identmatrix",
    "1 2 (abcdef) transform", "[1 0 0 1 0 true] setmatrix", "true 2 matrix translate"
  ]) unsupported(() => execute(source, { initialMatrix: [1, 0, 0, 1, 0, 0] }));
  assert.throws(() => execute("100 { 1 2 matrix translate pop } repeat", { maxOperations: 30 }),
    error => error instanceof PdfError && error.code === "resource-limit");
  const controller = new AbortController(); controller.abort();
  assert.throws(() => execute("matrix", { signal: controller.signal }), error => error instanceof PdfError && error.code === "aborted");
  console.log("Font PostScript matrix tests passed: PLRM ordering, explicit/CTM transforms, inverse scales, aliasing, access, graphics-state isolation and typed failures.");
} finally { hooks.deregister(); }
