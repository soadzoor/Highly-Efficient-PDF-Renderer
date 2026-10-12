import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const { createNativeOptionalContentRegistry, openNativePdfDocument } = await import("../src/pdf/nativePdf.ts");
  const { createDefaultOptionalContentSnapshot, validateSceneOptionalContent } = await import("../src/optionalContent.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");

  function fixture({ catalog = null, groups = 128 } = {}) {
    return writeTinyPdf({ objects: [
      { number: 1, body: `<< /Type /Catalog /Pages 2 0 R ${catalog === null ? "" : "/OCProperties 10 0 R"} >>` },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << ${Array.from({ length: groups }, (_, i) => `/Layer${i} ${11 + i} 0 R`).join(" ")} >> >> >>` },
      ...(catalog === null ? [] : [{ number: 10, body: catalog }]),
      ...Array.from({ length: groups }, (_, i) => ({ number: 11 + i, body: `<< /Type /OCG /Name (Layer ${i}) >>` }))
    ] });
  }

  async function withRegistry(options, callback, registryOptions = {}) {
    const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture(options) });
    try {
      const emitted = [];
      const registry = await createNativeOptionalContentRegistry(document, {
        ...registryOptions, onDiagnostic: diagnostic => emitted.push(diagnostic)
      });
      await callback(document, registry, emitted);
    } finally {
      await document.close();
    }
  }

  await withRegistry({}, async (document, registry, emitted) => {
    assert.equal(emitted.length, 0, "an absent catalog is diagnosed only if content uses a layer");
    const names = Array.from({ length: 128 }, (_, i) => `Layer${i}`);
    const properties = await registry.resolvePageProperties(document.getPage(0).resources, names);
    assert.equal(registry.groupCount, names.length, "coalescing diagnostics must retain every layer");
    assert.deepEqual(properties.map(property => property.membershipIndex), names.map((_, i) => i));
    assert.ok(properties.every(property => property.defaultVisible));
    const scene = await registry.sceneData();
    validateSceneOptionalContent(scene);
    assert.deepEqual(scene.groups.map(group => group.name), names.map((_, i) => `Layer ${i}`));
    const snapshot = createDefaultOptionalContentSnapshot({ ...createEmptyVectorScene(), optionalContent: scene });
    assert.ok(properties.every(property => snapshot.conditions[property.membershipIndex] === 1));
    await registry.resolvePageProperties(document.getPage(0).resources, names);
    await registry.sceneData();
    assert.equal(emitted.length, 1, "an absent catalog produces one document warning, including repeated resolution");
    assert.equal(emitted[0].code, "optional-content.missing-catalog");
    assert.equal(emitted[0].severity, "warning");
    assert.deepEqual(registry.getDiagnostics(), emitted, "callbacks and retained diagnostics remain consistent");
  });

  for (const catalog of ["<< /D << /Order [] >> >>", "<< /OCGs null /D << /OFF [] >> >>"]) {
    await withRegistry({ catalog }, async (document, registry, emitted) => {
      assert.equal(registry.groupCount, 0);
      assert.equal(await registry.sceneData(), undefined);
      assert.equal(emitted.length, 0, "flattened PDFs with empty unused layer metadata need no recovery warning");
      await registry.resolvePageProperties(document.getPage(0).resources, ["Layer0", "Layer1"]);
      assert.deepEqual(emitted.map(diagnostic => diagnostic.code), ["optional-content.missing-catalog-groups"]);
      assert.ok(registry.listGroups().every(group => group.defaultVisible));
    });
  }

  await withRegistry({ catalog: "<< /D << /BaseState /OFF /ON [11 0 R] /OFF [12 0 R] >> >>", groups: 2 }, async (document, registry, emitted) => {
    const properties = await registry.resolvePageProperties(document.getPage(0).resources, ["Layer0", "Layer1"]);
    assert.deepEqual(properties.map(property => property.defaultVisible), [true, false],
      "a missing catalog group list must not discard explicit ON/OFF states");
    assert.equal(emitted.filter(diagnostic => diagnostic.code === "optional-content.missing-catalog-groups").length, 1);
    assert.equal(emitted.filter(diagnostic => diagnostic.code === "optional-content.hidden").length, 1);
  });

  await withRegistry({ catalog: "<< /OCGs [] /D << >> >>", groups: 2 }, async (document, registry, emitted) => {
    await registry.resolvePageProperties(document.getPage(0).resources, ["Layer0", "Layer1"]);
    assert.deepEqual(emitted.map(diagnostic => diagnostic.code), [
      "optional-content.missing-catalog-group", "optional-content.missing-catalog-group"
    ], "a present but incomplete group list retains precise per-group diagnostics");
    assert.deepEqual(emitted.map(diagnostic => diagnostic.details.groupName), ["Layer 0", "Layer 1"]);
  });

  await withRegistry({ groups: 3 }, async (document, registry, emitted) => {
    await assert.rejects(registry.resolvePageProperties(document.getPage(0).resources, ["Layer0", "Layer1", "Layer2"]),
      error => error?.code === "resource-limit");
    assert.equal(registry.groupCount, 2, "caller limits still bound lazy group recovery");
    assert.equal(emitted.length, 1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(registry.resolvePageProperties(document.getPage(0).resources, ["Layer0"], controller.signal),
      error => error?.name === "AbortError");
    assert.equal(emitted.length, 1, "cancelled requests do not duplicate recovery diagnostics");
  }, { limits: { maxGroups: 2 } });

  console.log("Native optional-content recovery tests passed.");
} finally {
  hooks.deregister();
}
