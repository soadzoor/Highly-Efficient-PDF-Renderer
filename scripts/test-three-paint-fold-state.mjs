import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });

try {
  const { createThreePaintFoldRestorer, registerThreePaintFoldInputs, copyThreePaintFold,
    enableThreeRawPaintFold, setThreePaintFold, THREE_GRADIENT_MASK_VECTORS } =
    await import("../src/threePaintFold.ts");
  const { paintFoldMaskWeights } = await import("../src/nativePaintFold.ts");
  const alpha = { subtype: "Alpha", children: [] };
  const luminosity = { subtype: "Luminosity", backdrop: [0.2, 0.3, 0.4], children: [] };
  const mask = new THREE.Texture(), lut = new THREE.Texture();
  const gradient = { lut, linear: true,
    vectors: Float32Array.from({ length: THREE_GRADIENT_MASK_VECTORS * 4 }, (_, index) => index / 4) };

  for (const backend of ["webgl", "webgpu"]) {
    const material = backend === "webgl" ? new THREE.RawShaderMaterial() : new NodeMaterial();
    let inputs;
    if (backend === "webgl") {
      enableThreeRawPaintFold(material);
      inputs = { fold: material.uniforms.uPaintFold, weights: material.uniforms.uPaintMaskWeights,
        mask: material.uniforms.uPaintMask, gradient: material.uniforms.uPaintMaskGradient.value, neutral: null };
    } else {
      inputs = { fold: TSL.uniform(new THREE.Vector4(1, 0, 0, 0)),
        weights: TSL.uniform(new THREE.Vector4()), mask: TSL.textureLoad(new THREE.DataTexture()),
        gradient: Array.from({ length: THREE_GRADIENT_MASK_VECTORS }, () => new THREE.Vector4()),
        neutral: new THREE.DataTexture() };
      registerThreePaintFoldInputs(material, inputs);
    }
    const clone = material.clone();
    copyThreePaintFold(material, clone);
    inputs.fold.value.set(0.8, 1, 0.2, 3);
    inputs.weights.value.set(1, 2, 3, 4);
    inputs.mask.value = mask;
    inputs.gradient.forEach((vector, index) => vector.set(index, 2, 3, 4));
    const refs = [inputs.fold.value, inputs.weights.value, ...inputs.gradient];
    const snapshot = () => ({ fold: inputs.fold.value.toArray(), weights: inputs.weights.value.toArray(),
      mask: inputs.mask.value, gradient: inputs.gradient.map(vector => vector.toArray()) });
    const original = snapshot();
    const outer = createThreePaintFoldRestorer(), inner = createThreePaintFoldRestorer();

    // A clipped material writes the same inputs. An inner surface fold must
    // restore the outer gradient, then the outer must restore all original values.
    const outerCallback = outer.apply(material, 0.4, null, luminosity, gradient);
    const folded = snapshot();
    assert.deepEqual(folded.fold, [0.4, 3, paintFoldMaskWeights(luminosity)[4], 0]);
    assert.equal(folded.mask, lut);
    assert.deepEqual(folded.gradient.flat(), [...gradient.vectors]);
    const innerCallback = inner.apply(clone, 0.6, mask, alpha);
    assert.deepEqual(inputs.fold.value.toArray(), [0.6, 1, 0, 0]);
    assert.equal(inputs.mask.value, mask);
    assert.throws(() => inner.apply(material, 1, null), /already active/,
      `${backend}: reusing an active snapshot cannot overwrite its saved values`);
    innerCallback();
    assert.deepEqual(snapshot(), folded, `${backend}: inner restores the shared outer state`);
    outerCallback();
    assert.deepEqual(snapshot(), original, `${backend}: all original values are restored`);
    outerCallback();
    assert.deepEqual(snapshot(), original, `${backend}: repeated cleanup is harmless`);

    // Warm snapshots reuse their vectors and one callback. Interleave an
    // ordinary fold to ensure gradient restoration is reset between draws.
    const originalClone = THREE.Vector4.prototype.clone;
    THREE.Vector4.prototype.clone = () => { throw new Error("A warm fold cloned a vector."); };
    try {
      for (let frame = 0; frame < 10; frame++) {
        assert.equal(outer.apply(material, 0.25, null, alpha, gradient), outerCallback);
        outer.restore();
        assert.deepEqual(snapshot(), original);
        assert.equal(outer.apply(material, 0.5, null), outerCallback);
        assert.equal(inputs.mask.value, inputs.neutral);
        outer.restore();
        assert.deepEqual(snapshot(), original);
      }
    } finally { THREE.Vector4.prototype.clone = originalClone; }
    [inputs.fold.value, inputs.weights.value, ...inputs.gradient].forEach((vector, index) =>
      assert.equal(vector, refs[index], `${backend}: references used by uniform bindings remain unchanged`));

    // An existing caller's independent snapshot may enclose a cached one.
    const restoreLegacy = setThreePaintFold(material, 0.9, null, luminosity, gradient);
    const legacyState = snapshot();
    outer.apply(clone, 0.3, mask, alpha)();
    assert.deepEqual(snapshot(), legacyState);
    restoreLegacy();
    assert.deepEqual(snapshot(), original);
    assert.throws(() => outer.apply(material, 0.5, null, alpha,
      { ...gradient, get vectors() { throw new Error("failed gradient draw"); } }), /failed gradient draw/);
    assert.deepEqual(snapshot(), original, `${backend}: a failed draw rolls back its fold before returning`);
    outer.apply(material, 0.5, mask, alpha)();
    assert.deepEqual(snapshot(), original, `${backend}: the next draw recovers after a failed apply`);

    const other = backend === "webgl" ? new THREE.RawShaderMaterial() : new NodeMaterial();
    const otherInputs = { fold: { value: new THREE.Vector4(0.7, 0, 0, 0) },
      weights: { value: new THREE.Vector4(4, 3, 2, 1) }, mask: { value: mask },
      gradient: inputs.gradient.map(vector => vector.clone()), neutral: null };
    registerThreePaintFoldInputs(other, otherInputs);
    assert.equal(outer.apply(other, 1, null, alpha, gradient), outerCallback,
      `${backend}: an inactive snapshot can follow a replacement material`);
    outer.restore();
    assert.deepEqual(otherInputs.fold.value.toArray(), [0.7, 0, 0, 0]);
    assert.deepEqual(otherInputs.weights.value.toArray(), [4, 3, 2, 1]);
    assert.equal(otherInputs.mask.value, mask);
    assert.deepEqual(snapshot(), original, `${backend}: replacement never restores the previous material`);
    assert.throws(() => outer.apply(new THREE.Material(), 1, null), /cannot draw a folded paint/);
    outer.restore();
    assert.deepEqual(snapshot(), original);
  }
  console.log("Three paint fold snapshots: reusable callbacks, nested shared inputs and exact uniform restoration passed");
} finally { hooks.deregister(); }
