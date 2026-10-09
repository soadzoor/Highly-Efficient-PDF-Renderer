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

const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
const {
  NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES,
  createNativeOptionalContentRegistry
} = await import("../src/pdf/nativeOptionalContent.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

function optionalContentPdf({
  version = "1.7",
  groups = [
    { number: 11, body: "<< /Type /OCG /Name (Layer A) >>" },
    { number: 12, body: "<< /Type /OCG /Name (Layer B) >>" }
  ],
  ocgs = groups.map(({ number }) => `${number} 0 R`).join(" "),
  defaultConfiguration = "<< /BaseState /ON >>",
  optionalContentExtras = "",
  pageProperties = [""],
  extraObjects = []
} = {}) {
  const pages = pageProperties.map((properties, index) => {
    const resources = properties.length === 0
      ? ""
      : `/Resources << /Properties << ${properties} >> >>`;
    return {
      number: 3 + index,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] ${resources} >>`
    };
  });
  const kids = pages.map(({ number }) => `${number} 0 R`).join(" ");
  const defaultEntry = defaultConfiguration === null ? "" : `/D ${defaultConfiguration}`;
  return writeTinyPdf({
    version,
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 10 0 R >>" },
      { number: 2, body: `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>` },
      ...pages,
      {
        number: 10,
        body: `<< /OCGs [${ocgs}] ${defaultEntry} ${optionalContentExtras} >>`
      },
      ...groups,
      ...extraObjects
    ]
  });
}

async function withRegistry(bytes, options, callback) {
  const document = await openNativePdfDocument({ kind: "bytes", bytes });
  try {
    const emitted = [];
    const registry = await createNativeOptionalContentRegistry(document, {
      ...options,
      onDiagnostic: (diagnostic) => emitted.push(diagnostic)
    });
    return await callback({ document, registry, emitted });
  } finally {
    await document.close();
  }
}

function pdfError(code, pattern) {
  return (error) => {
    assert.ok(error instanceof PdfError, `expected PdfError, received ${String(error)}`);
    assert.equal(error.code, code);
    if (pattern !== undefined) assert.match(error.message, pattern);
    return true;
  };
}

await withRegistry(optionalContentPdf({
  defaultConfiguration: "<< /BaseState /ON /OFF [12 0 R] >>",
  pageProperties: ["/Off 12 0 R"]
}), {}, async ({ document, registry, emitted }) => {
  for (const resources of [undefined, new Map(), new Map([["Properties", new Map()]])]) {
    const [property] = await registry.resolvePageProperties(resources, ["Gone"], undefined, ["Gone"]);
    assert.equal(property.defaultVisible, true);
    assert.equal(property.propertyList, null);
    assert.equal(property.membershipIndex, null);
    await registry.resolvePageProperties(resources, ["Gone"], undefined, ["Gone"]);
  }
  assert.equal(emitted.filter(d => d.code === "optional-content.unresolved-property").length, 3,
    "missing resources, Properties and individual names are diagnosed once each");
  const [missing, hidden] = await registry.resolvePageProperties(
    document.getPage(0).resources, ["Gone", "Off"], undefined, ["Gone", "Off"]);
  assert.equal(missing.defaultVisible, true);
  assert.equal(hidden.defaultVisible, false, "valid hidden memberships still control visibility");
  await assert.rejects(registry.resolvePageProperties(new Map([["Properties", 42]]),
    ["Gone"], undefined, ["Gone"]), pdfError("invalid-object"),
  "malformed membership resources still fail validation");
  await assert.rejects(registry.resolvePageProperties(undefined, ["Gone"],
    AbortSignal.abort(), ["Gone"]), error => error.name === "AbortError");
});

const primaryProperties = [
  "/G11 11 0 R",
  "/G12 12 0 R",
  "/Any 20 0 R",
  "/All 21 0 R",
  "/Empty 22 0 R",
  "/Nulls 23 0 R",
  "/OneAnd 24 0 R",
  "/OneOr 25 0 R",
  "/IntentOr 26 0 R",
  "/IgnoredNot 27 0 R",
  "/RefExpression 28 0 R",
  "/VEWins 29 0 R",
  "/Inline << /Type /OCMD /OCGs 11 0 R /P /AnyOff >>",
  "/Wrapped << /OC 13 0 R /ActualText (visible) >>",
  "/Rogue 30 0 R",
  "/Lazy 99 0 R"
].join(" ");

const primary = optionalContentPdf({
  version: "2.0",
  groups: [
    {
      number: 11,
      body: "<< /Type /OCG /Name (View Off) /Intent /View /Usage << /View << /ViewState /OFF >> >> >>"
    },
    {
      number: 12,
      body: "<< /Type /OCG /Name (Design Layer) /Intent /Design /Usage 99 0 R >>"
    },
    {
      number: 13,
      body: "<< /Type /OCG /Name <FEFFD83DDE80> /Intent [/View /Design] /Usage << /View << /ViewState /ON >> >> >>"
    },
    {
      number: 14,
      body: "<< /Type /OCG /Name <EFBBBFF09F9880> /Intent /FutureIntent >>"
    }
  ],
  defaultConfiguration: [
    "<< /BaseState /OFF /ON [11 0 R] /Intent /View /Order 99 0 R",
    "/AS [",
    "<< /Event /View /OCGs [11 0 R 12 0 R 13 0 R] /Category [/View] >>",
    "<< /Event /Print /OCGs 99 0 R /Category 98 0 R >>",
    "<< /Event /View /OCGs [] /Category 98 0 R >>",
    "] >>"
  ].join(" "),
  optionalContentExtras: "/Configs 99 0 R",
  pageProperties: [primaryProperties],
  extraObjects: [
    { number: 20, body: "<< /Type /OCMD /OCGs [11 0 R 12 0 R] /P /AnyOn >>" },
    { number: 21, body: "<< /Type /OCMD /OCGs [11 0 R 13 0 R] /P /AllOn >>" },
    { number: 22, body: "<< /Type /OCMD /P /AllOff >>" },
    { number: 23, body: "<< /Type /OCMD /OCGs [null null] /P /AnyOn >>" },
    { number: 24, body: "<< /Type /OCMD /VE [/And 13 0 R] >>" },
    { number: 25, body: "<< /Type /OCMD /VE [/Or 11 0 R] >>" },
    { number: 26, body: "<< /Type /OCMD /VE [/Or 12 0 R 11 0 R] >>" },
    { number: 27, body: "<< /Type /OCMD /VE [/Not 12 0 R] >>" },
    { number: 28, body: "<< /Type /OCMD /VE 31 0 R >>" },
    { number: 29, body: "<< /Type /OCMD /VE [/Or 13 0 R] /OCGs [(unused)] /P /Sometimes >>" },
    { number: 30, body: "<< /Type /OCG /Name (Not in catalog) >>" },
    { number: 31, body: "[/Or 13 0 R]" }
  ]
});

await withRegistry(primary, {}, async ({ document, registry, emitted }) => {
  assert.deepEqual(
    registry.listGroups().map(({ index, membershipIndex, identity, name, defaultVisible }) => ({
      index,
      membershipIndex,
      identity,
      name,
      defaultVisible
    })),
    [
      { index: 0, membershipIndex: 0, identity: "ref:11:0", name: "View Off", defaultVisible: false },
      { index: 1, membershipIndex: 1, identity: "ref:12:0", name: "Design Layer", defaultVisible: true },
      { index: 2, membershipIndex: 2, identity: "ref:13:0", name: "🚀", defaultVisible: true },
      { index: 3, membershipIndex: 3, identity: "ref:14:0", name: "😀", defaultVisible: true }
    ],
    "configuration intent filters states, while View usage applications override active groups"
  );

  const names = [
    "G11",
    "G12",
    "Any",
    "All",
    "Empty",
    "Nulls",
    "OneAnd",
    "OneOr",
    "IntentOr",
    "IgnoredNot",
    "RefExpression",
    "VEWins",
    "Inline",
    "Wrapped"
  ];
  const properties = await registry.resolvePageProperties(document.getPage(0).resources, names);
  const byName = Object.fromEntries(properties.map((property) => [property.name, property]));
  assert.deepEqual(
    Object.fromEntries(properties.map((property) => [property.name, property.defaultVisible])),
    {
      G11: false,
      G12: true,
      Any: false,
      All: false,
      Empty: true,
      Nulls: true,
      OneAnd: true,
      OneOr: false,
      IntentOr: false,
      IgnoredNot: true,
      RefExpression: true,
      VEWins: true,
      Inline: true,
      Wrapped: true
    }
  );
  assert.deepEqual(byName.Any.membership.groupIndices, [0, 1], "ignored-intent groups remain described");
  assert.deepEqual(byName.Empty.membership.groupIndices, []);
  assert.deepEqual(byName.Nulls.membership.groupIndices, []);
  assert.deepEqual(byName.IntentOr.membership.groupIndices, [0, 1]);
  assert.deepEqual(byName.IgnoredNot.membership.groupIndices, [1]);
  assert.equal(byName.OneAnd.membership.expression.operands.length, 1, "/And accepts one operand");
  assert.equal(byName.OneOr.membership.expression.operands.length, 1, "/Or accepts one operand");
  assert.equal(byName.RefExpression.membership.expression.kind, "or");
  assert.equal(byName.VEWins.membership.policy, "VisibilityExpression");
  assert.equal(byName.Inline.membership.identity.startsWith("direct:"), true);
  assert.equal(byName.Wrapped.membershipIndex, 2);

  const resources = await document.resolveValue(document.getPage(0).resources);
  const resourceProperties = await document.resolveValue(resources.get("Properties"));
  const inline = resourceProperties.get("Inline");
  const firstInline = await registry.resolvePropertyValue(inline);
  const secondInline = await registry.resolvePropertyValue(inline);
  assert.equal(firstInline, secondInline, "a direct inline BDC dictionary has stable identity caching");
  assert.equal(firstInline.index, byName.Inline.membershipIndex);

  const [rogue] = await registry.resolvePageProperties(document.getPage(0).resources, ["Rogue"]);
  assert.equal(rogue.defaultVisible, true, "unlisted groups retain paint despite the default OFF state");
  assert.equal(rogue.membershipIndex, 15);
  assert.equal(registry.membershipCount, 16, "unused properties publish no membership");
  assert.equal("setGroupVisible" in registry, false, "the static registry exposes no layer editing");

  const diagnostics = registry.getDiagnostics();
  assert.equal(diagnostics.length, 6);
  assert.ok(diagnostics.slice(0, 5).every(({ code, severity }) =>
    code === NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES.HiddenDefault && severity === "info"
  ));
  assert.equal(diagnostics[5].code, NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES.MissingCatalogGroup);
  assert.equal(diagnostics[5].severity, "warning");
  assert.deepEqual(
    emitted.map(({ message }) => message),
    diagnostics.map(({ message }) => message),
    "retained and callback diagnostics have deterministic order"
  );
  const [{ createEmptyVectorScene }, { createDefaultOptionalContentSnapshot, validateSceneOptionalContent }] = await Promise.all([
    import("../src/emptyVectorScene.ts"), import("../src/optionalContent.ts")
  ]);
  const data = await registry.sceneData();
  validateSceneOptionalContent(data);
  const snapshot = createDefaultOptionalContentSnapshot({ ...createEmptyVectorScene(), optionalContent: data });
  for (const property of properties) if (property.membershipIndex !== null) {
    assert.equal(snapshot.conditions[property.membershipIndex] === 1, property.defaultVisible,
      `${property.name}: exported visibility graph matches static policy and intent semantics`);
  }
  assert.equal(data.groups[1].usedInView, false);
  assert.equal(data.order.length, data.groups.length, "invalid display order safely uses catalog order");
});

for (const [intent, expected] of [
  ["[]", [true, true]],
  ["/All", [false, false]],
  ["/View", [false, true]]
]) {
  await withRegistry(optionalContentPdf({
    groups: [
      { number: 11, body: "<< /Type /OCG /Name (View) /Intent /View >>" },
      { number: 12, body: "<< /Type /OCG /Name (Design) /Intent /Design >>" }
    ],
    defaultConfiguration: `<< /BaseState /OFF /Intent ${intent} >>`
  }), {}, async ({ registry }) => {
    assert.deepEqual(registry.listGroups().map((group) => group.defaultVisible), expected);
  });
}

await withRegistry(optionalContentPdf({
  groups: [{ number: 11, body: "<< /Type /OCG /Name (Unchanged) >>" }],
  defaultConfiguration: "<< /BaseState /Unchanged >>"
}), {}, async ({ registry }) => {
  assert.equal(registry.getGroup(0).defaultVisible, true, "/Unchanged retains the initial ON state");
});

await withRegistry(optionalContentPdf({
  groups: [{ number: 11, body: "<< /Type /OCG /Name (No Intent) /Intent [] >>" }],
  defaultConfiguration: "<< /BaseState /OFF /Intent /All >>"
}), {}, async ({ registry }) => {
  assert.equal(
    registry.getGroup(0).defaultVisible,
    true,
    "an explicitly empty group intent has no intersection even with configuration /All"
  );
});

await withRegistry(optionalContentPdf({
  groups: [{ number: 11, body: "<< /Type /OCG /Name (Lazy Usage) /Usage 99 0 R >>" }],
  defaultConfiguration: "<< /BaseState /OFF /Order 99 0 R >>",
  optionalContentExtras: "/Configs 99 0 R"
}), {}, async ({ registry }) => {
  assert.equal(registry.getGroup(0).defaultVisible, false, "unused Usage/UI/alternate configs stay lazy");
});

const scoped = optionalContentPdf({
  defaultConfiguration: "<< /BaseState /ON /OFF [12 0 R] >>",
  pageProperties: ["/Same 11 0 R", "/Same 12 0 R"]
});
await withRegistry(scoped, {}, async ({ document, registry }) => {
  const pageZero = await registry.resolvePageProperties(document.getPage(0).resources, ["Same"]);
  const pageOne = await registry.resolvePageProperties(document.getPage(1).resources, ["Same"]);
  assert.equal(pageZero[0].defaultVisible, true);
  assert.equal(pageOne[0].defaultVisible, false, "property names are resolved in their resource scope");
});

const concurrent = optionalContentPdf({
  pageProperties: ["/A 20 0 R /B 21 0 R"],
  extraObjects: [
    { number: 20, body: "<< /Type /OCMD /OCGs 11 0 R /P /AnyOn >>" },
    { number: 21, body: "<< /Type /OCMD /OCGs 12 0 R /P /AnyOn >>" }
  ]
});
await withRegistry(concurrent, {}, async ({ document, registry }) => {
  const [b, a] = await Promise.all([
    registry.resolvePageProperties(document.getPage(0).resources, ["B"]),
    registry.resolvePageProperties(document.getPage(0).resources, ["A"])
  ]);
  assert.deepEqual(
    [b[0].membershipIndex, a[0].membershipIndex],
    [2, 3],
    "concurrent lazy resolutions publish indexes in invocation order"
  );
});

const failureCases = [
  {
    bytes: optionalContentPdf({ ocgs: "11 0 R 11 0 R" }),
    code: "invalid-object",
    pattern: /repeats ref:11:0/
  },
  {
    bytes: optionalContentPdf({ ocgs: "<< /Type /OCG /Name (Direct) >>" }),
    code: "invalid-object",
    pattern: /not an indirect reference/
  },
  {
    bytes: optionalContentPdf({ defaultConfiguration: null }),
    code: "invalid-object",
    pattern: /no default \/D configuration/
  },
  {
    bytes: optionalContentPdf({
      groups: [{ number: 11, body: "<< /Type /OCG /Name (Duplicate Intent) /Intent [/View /View] >>" }]
    }),
    code: "invalid-object",
    pattern: /repeats \/View/
  },
  {
    bytes: optionalContentPdf({
      version: "2.0",
      groups: [{ number: 11, body: "<< /Type /OCG /Name <EFBBBFC0AF> >>" }]
    }),
    code: "invalid-object",
    pattern: /malformed UTF-8/
  },
  {
    bytes: optionalContentPdf({
      groups: [{ number: 11, body: "<< /Type /OCG /Name <FEFFD8000041> >>" }]
    }),
    code: "invalid-object",
    pattern: /unpaired UTF-16 high surrogate/
  },
  {
    bytes: optionalContentPdf({
      defaultConfiguration: "<< /AS [<< /Event /View /OCGs [11 0 R] /Category [/Zoom] >>] >>"
    }),
    code: "unsupported-content",
    pattern: /category \/Zoom requires external viewer context/
  },
  {
    bytes: optionalContentPdf({
      groups: [{
        number: 11,
        body: "<< /Type /OCG /Name (Bad View State) /Usage << /View << /ViewState /Maybe >> >> >>"
      }],
      defaultConfiguration: "<< /AS [<< /Event /View /OCGs [11 0 R] /Category [/View] >>] >>"
    }),
    code: "invalid-object",
    pattern: /invalid \/Usage \/View \/ViewState/
  },
  {
    bytes: optionalContentPdf({
      defaultConfiguration: "<< /AS [<< /Event /SlideShow /OCGs [11 0 R] /Category [/View] >>] >>"
    }),
    code: "unsupported-content",
    pattern: /event \/SlideShow is unsupported/
  },
  {
    bytes: optionalContentPdf({
      defaultConfiguration: "<< /AS [<< /Event /View /OCGs [11 0 R] >>] >>"
    }),
    code: "unsupported-content",
    pattern: /usage applications require a supported \/Category array/
  }
];

for (const { bytes, code, pattern } of failureCases) {
  await assert.rejects(
    withRegistry(bytes, {}, async () => undefined),
    pdfError(code, pattern)
  );
}

const lazyOcRequestFailures = optionalContentPdf({
  pageProperties: ["/Missing 20 0 R /Duplicate 21 0 R"],
  extraObjects: [
    { number: 20, body: "<< /Type /OCMD /OCGs 30 0 R >>" },
    { number: 21, body: "<< /Type /OCMD /OCGs [11 0 R 11 0 R] >>" },
    { number: 30, body: "<< /Type /OCG /Name (Outside catalog) >>" }
  ]
});
await withRegistry(lazyOcRequestFailures, {}, async ({ document, registry }) => {
  const [missing] = await registry.resolvePageProperties(document.getPage(0).resources, ["Missing"]);
  assert.equal(missing.defaultVisible, true);
  assert.deepEqual(missing.membership.groupIndices, [2], "policy memberships recover unlisted OCGs");
  await assert.rejects(
    registry.resolvePageProperties(document.getPage(0).resources, ["Duplicate"]),
    pdfError("invalid-object", /repeats group ref:11:0/)
  );
});

const recoveredGroups = optionalContentPdf({
  defaultConfiguration: "<< /BaseState /OFF >>",
  pageProperties: [
    "/Early 20 0 R /Repeated 21 0 R /Late 30 0 R /Wrapped << /OC 30 0 R >> " +
    "/Off 22 0 R /Not 23 0 R /Direct << /Type /OCG /Name (Direct) >>"
  ],
  extraObjects: [
    { number: 20, body: "<< /Type /OCMD /OCGs 11 0 R >>" },
    { number: 21, body: "<< /Type /OCMD /VE [/And 30 0 R 30 0 R] >>" },
    { number: 22, body: "<< /Type /OCMD /OCGs 30 0 R /P /AnyOff >>" },
    { number: 23, body: "<< /Type /OCMD /VE [/Not 30 0 R] >>" },
    { number: 30, body: "<< /Type /OCG /Name (Unlisted) >>" }
  ]
});
await withRegistry(recoveredGroups, {}, async ({ document, registry, emitted }) => {
  const names = ["Early", "Repeated", "Late", "Wrapped", "Off", "Not", "Direct"];
  const properties = await registry.resolvePageProperties(document.getPage(0).resources, names);
  const byName = Object.fromEntries(properties.map(property => [property.name, property]));
  assert.deepEqual(properties.map(property => property.membershipIndex), [2, 4, 3, 3, 5, 6, 7]);
  assert.deepEqual(properties.map(property => property.defaultVisible), [false, true, true, true, false, false, true]);
  assert.deepEqual(registry.listGroups().map(({ index, membershipIndex }) => [index, membershipIndex]),
    [[0, 0], [1, 1], [2, 3], [3, 7]], "group indexes remain distinct from lazy membership indexes");
  assert.deepEqual(byName.Repeated.membership.groupIndices, [2]);
  assert.equal(byName.Repeated.membership.expression.operands[0].membershipIndex, 3);
  assert.equal(byName.Repeated.membership.expression.operands[1].groupIndex, 2,
    "a repeated VE operand reuses the group recovered by its first operand");
  assert.deepEqual(byName.Off.membership.groupIndices, [2]);

  const resources = await document.resolveValue(document.getPage(0).resources);
  const resourceProperties = await document.resolveValue(resources.get("Properties"));
  const direct = resourceProperties.get("Direct");
  assert.equal((await registry.resolvePropertyValue(direct)).index, 7);
  const wrappedDirect = new Map([["OC", direct]]);
  assert.equal((await registry.resolvePropertyValue(wrappedDirect)).index, 7);
  const repeated = await registry.resolvePageProperties(document.getPage(0).resources, names);
  assert.deepEqual(repeated.map(property => property.membershipIndex), properties.map(property => property.membershipIndex));
  assert.equal(registry.membershipCount, 8, "repeated, direct and wrapped references keep stable identities");
  const warnings = emitted.filter(({ code }) => code === NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES.MissingCatalogGroup);
  assert.equal(warnings.length, 2, "each recovered indirect or direct group emits one warning");
  assert.deepEqual(warnings.map(({ details }) => [details.groupName, details.membershipIndex]),
    [["Unlisted", 3], ["Direct", 7]]);
  assert.ok(warnings.every(({ severity, message }) => severity === "warning" && /recovered as visible/.test(message)));

  const [{ createEmptyVectorScene }, { createDefaultOptionalContentSnapshot, validateSceneOptionalContent }] = await Promise.all([
    import("../src/emptyVectorScene.ts"), import("../src/optionalContent.ts")
  ]);
  const data = await registry.sceneData();
  validateSceneOptionalContent(data);
  const snapshot = createDefaultOptionalContentSnapshot({ ...createEmptyVectorScene(), optionalContent: data });
  for (const property of properties) {
    assert.equal(snapshot.conditions[property.membershipIndex] === 1, property.defaultVisible,
      `${property.name}: exported conditions preserve recovered group and membership indexes`);
  }
  assert.deepEqual(data.conditions[3], { kind: "group", groupId: "ref:30:0" });
});

for (const [body, pattern] of [
  ["<< /Type /Other /Name (Wrong type) >>", /not an \/OCG or \/OCMD/],
  ["<< /Type /OCG /Name 42 >>", /no string \/Name/],
  ["<< /Type /OCG /Name () >>", /empty \/Name/],
  ["<< /Type /OCG /Name (Bad intent) /Intent 42 >>", /Intent/]
]) {
  await withRegistry(optionalContentPdf({
    pageProperties: ["/Malformed << /OC 30 0 R >>"],
    extraObjects: [{ number: 30, body }]
  }), {}, async ({ document, registry, emitted }) => {
    await assert.rejects(registry.resolvePageProperties(document.getPage(0).resources, ["Malformed"]),
      pdfError("invalid-object", pattern));
    assert.equal(registry.groupCount, 2);
    assert.equal(registry.membershipCount, 2);
    assert.equal(emitted.length, 0, "invalid groups are not recovered or diagnosed as accepted");
  });
}

const recoveryLimits = optionalContentPdf({
  pageProperties: ["/Late 30 0 R /Policy 20 0 R /Nested 21 0 R"],
  extraObjects: [
    { number: 20, body: "<< /Type /OCMD /OCGs 30 0 R >>" },
    { number: 21, body: "<< /Type /OCMD /VE [/And 20 0 R] >>" },
    { number: 30, body: "<< /Type /OCG /Name (Unlisted) >>" }
  ]
});
for (const limit of ["maxGroups", "maxMemberships"]) {
  await withRegistry(recoveryLimits, { limits: { [limit]: 2 } }, async ({ document, registry, emitted }) => {
    await assert.rejects(registry.resolvePageProperties(document.getPage(0).resources, ["Late"]),
      pdfError("resource-limit", /exceeds limit 2/));
    assert.equal(registry.groupCount, 2);
    assert.equal(registry.membershipCount, 2);
    assert.equal(emitted.length, 0);
  });
}
for (const [maxMemberships, name] of [[3, "Policy"], [4, "Nested"]]) {
  await withRegistry(recoveryLimits, { limits: { maxMemberships } }, async ({ document, registry }) => {
    await assert.rejects(registry.resolvePageProperties(document.getPage(0).resources, [name]),
      pdfError("resource-limit", new RegExp(`exceeds limit ${maxMemberships}`)));
    assert.equal(registry.membershipCount, maxMemberships,
      "recovering groups and nested memberships cannot bypass the parent's publication limit");
    const [late] = await registry.resolvePageProperties(document.getPage(0).resources, ["Late"]);
    assert.equal(late.membershipIndex, 2, "a published recovery remains usable after its parent hits a limit");
    assert.equal(late.defaultVisible, true);
  });
}
await withRegistry(recoveryLimits, {}, async ({ document, registry, emitted }) => {
  const reason = new PdfError("aborted", "unlisted group recovery cancelled");
  await assert.rejects(registry.resolvePageProperties(document.getPage(0).resources, ["Late"],
    AbortSignal.abort(reason)), error => error === reason);
  assert.equal(registry.groupCount, 2);
  assert.equal(registry.membershipCount, 2);
  assert.equal(emitted.length, 0, "cancelled requests do not recover groups");
});

for (const mode of ["recovered", "limited", "aborted"]) {
  const document = await openNativePdfDocument({ kind: "bytes", bytes: optionalContentPdf({
    extraObjects: [{ number: 30, body: "<< /Type /OCG /Name (Delayed) /Intent /View >>" }]
  }) });
  try {
    const lateRef = { kind: "ref", objectNumber: 30, generation: 0 };
    const late = await document.resolveValue(lateRef);
    const delayedValue = late.get(mode === "aborted" ? "Intent" : "Name");
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const emitted = [];
    const registry = await createNativeOptionalContentRegistry({
      catalog: document.catalog,
      async resolveValue(value, signal) {
        if (value === delayedValue) {
          entered.resolve();
          await release.promise;
          return value;
        }
        return await document.resolveValue(value, signal);
      }
    }, {
      limits: mode === "limited" ? { maxMemberships: 3 } : undefined,
      onDiagnostic: diagnostic => emitted.push(diagnostic)
    });
    const controller = new AbortController();
    const reason = new PdfError("aborted", "delayed unlisted group cancelled");
    const pending = registry.resolvePropertyValue(lateRef, controller.signal);
    await entered.promise;
    assert.equal(registry.combineMemberships(0, 1), 2);
    if (mode === "aborted") controller.abort(reason);
    release.resolve();
    if (mode === "recovered") {
      assert.equal((await pending).index, 3, "recovery uses the membership index available after metadata resolves");
      assert.equal(registry.getGroup(2).membershipIndex, 3);
      assert.equal(registry.membershipCount, 4);
      assert.equal(emitted.length, 1);
    } else {
      await assert.rejects(pending, mode === "limited"
        ? pdfError("resource-limit", /exceeds limit 3/) : error => error === reason);
      assert.equal(registry.groupCount, 2);
      assert.equal(registry.membershipCount, 3);
      assert.equal(emitted.length, 0, "publication rechecks capacity and cancellation after metadata resolves");
    }
    assert.equal(registry.getMembership(2).identity, "scope:0:1", "recovery preserves the concurrent combined scope");
  } finally {
    await document.close();
  }
}

const expressionCycle = optionalContentPdf({
  pageProperties: ["/Cycle 20 0 R"],
  extraObjects: [
    { number: 20, body: "<< /Type /OCMD /VE 30 0 R >>" },
    { number: 30, body: "[/And 31 0 R]" },
    { number: 31, body: "[/Or 30 0 R]" }
  ]
});
await withRegistry(expressionCycle, {}, async ({ document, registry }) => {
  await assert.rejects(
    registry.resolvePageProperties(document.getPage(0).resources, ["Cycle"]),
    pdfError("invalid-object", /visibility-expression cycle detected/)
  );
});

const operandLimit = optionalContentPdf({
  pageProperties: ["/Wide 20 0 R"],
  extraObjects: [{ number: 20, body: "<< /Type /OCMD /VE [/And 11 0 R 12 0 R] >>" }]
});
await withRegistry(
  operandLimit,
  { limits: { maxExpressionOperands: 1 } },
  async ({ document, registry }) => {
    await assert.rejects(
      registry.resolvePageProperties(document.getPage(0).resources, ["Wide"]),
      pdfError("resource-limit", /operand count exceeds limit 1/)
    );
  }
);

await withRegistry(optionalContentPdf(), {}, async ({ document, registry }) => {
  const controller = new AbortController();
  const reason = new PdfError("aborted", "optional-content semantic fixture abort");
  controller.abort(reason);
  await assert.rejects(
    registry.resolvePageProperties(document.getPage(0).resources, [], controller.signal),
    (error) => error === reason
  );
});

hooks.deregister();
console.log("native optional-content semantic fixture tests passed");
