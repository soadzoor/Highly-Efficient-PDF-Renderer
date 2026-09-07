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

  await assert.rejects(
    registry.resolvePageProperties(document.getPage(0).resources, ["Rogue"]),
    pdfError("unsupported-content", /absent from the catalog \/OCGs/)
  );
  assert.equal(registry.membershipCount, 15, "failed and unused properties publish no membership");
  assert.equal("setGroupVisible" in registry, false, "the static registry exposes no layer editing");

  const diagnostics = registry.getDiagnostics();
  assert.equal(diagnostics.length, 5);
  assert.ok(diagnostics.every(({ code, severity }) =>
    code === NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES.HiddenDefault && severity === "info"
  ));
  assert.deepEqual(
    emitted.map(({ message }) => message),
    diagnostics.map(({ message }) => message),
    "retained and callback diagnostics have deterministic order"
  );
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
  await assert.rejects(
    registry.resolvePageProperties(document.getPage(0).resources, ["Missing"]),
    pdfError("unsupported-content", /absent from \/OCGs/)
  );
  await assert.rejects(
    registry.resolvePageProperties(document.getPage(0).resources, ["Duplicate"]),
    pdfError("invalid-object", /repeats group ref:11:0/)
  );
});

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
