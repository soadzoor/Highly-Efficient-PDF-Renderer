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

const {
  NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES,
  PdfError,
  createNativeOptionalContentRegistry,
  openNativePdfDocument
} = await import("../src/pdf/nativePdf.ts");

function optionalContentFixture({
  defaultConfiguration = "/D << /BaseState /ON /OFF [12 0 R] >>",
  pageProperties = "",
  extraObjects = []
} = {}) {
  const resources = pageProperties.length === 0
    ? ""
    : `/Resources << /Properties << ${pageProperties} >> >>`;
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 10 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] ${resources} >>` },
      { number: 10, body: `<< /OCGs [11 0 R 12 0 R] ${defaultConfiguration} >>` },
      { number: 11, body: "<< /Type /OCG /Name (Visible Layer) >>" },
      { number: 12, body: "<< /Type /OCG /Name <FEFF00480069006400640065006E0020004C0061007900650072> >>" },
      ...extraObjects
    ]
  });
}

async function withFixture(bytes, options, callback) {
  const document = await openNativePdfDocument({ kind: "bytes", bytes });
  try {
    const registry = await createNativeOptionalContentRegistry(document, options);
    return await callback({ document, registry });
  } finally {
    await document.close();
  }
}

function hasPdfCode(code, messagePattern) {
  return (error) => {
    assert.ok(error instanceof PdfError, `expected PdfError, received ${String(error)}`);
    assert.equal(error.code, code);
    if (messagePattern !== undefined) assert.match(error.message, messagePattern);
    return true;
  };
}

const policyObjects = [
  { number: 13, body: "<< /Type /OCMD /OCGs [11 0 R 12 0 R] /P /AnyOn >>" },
  { number: 14, body: "<< /Type /OCMD /OCGs [11 0 R 12 0 R] /P /AllOn >>" },
  { number: 15, body: "<< /Type /OCMD /OCGs [11 0 R 12 0 R] /P /AnyOff >>" },
  { number: 16, body: "<< /Type /OCMD /OCGs [11 0 R 12 0 R] /P /AllOff >>" },
  { number: 17, body: "<< /Type /OCMD /VE [/And 11 0 R [/Not 12 0 R]] >>" },
  { number: 18, body: "<< /Type /OCMD /VE [/Or 14 0 R 12 0 R] >>" }
];

const policyProperties = [
  "/Visible 11 0 R",
  "/Hidden 12 0 R",
  "/Any 13 0 R",
  "/All 14 0 R",
  "/AnyOff 15 0 R",
  "/AllOff 16 0 R",
  "/Expr 17 0 R",
  "/Nested 18 0 R",
  "/Wrapped << /OC 12 0 R /ActualText (hidden) >>",
  "/Plain << /MCID 7 >>"
].join(" ");

const emittedDiagnostics = [];
await withFixture(
  optionalContentFixture({
    pageProperties: policyProperties,
    extraObjects: policyObjects
  }),
  { onDiagnostic: (diagnostic) => emittedDiagnostics.push(diagnostic) },
  async ({ document, registry }) => {
    assert.equal(registry.groupCount, 2);
    assert.equal(registry.membershipCount, 2, "each OCG starts with one identity membership");
    assert.deepEqual(
      registry.listGroups().map(({ identity, name, defaultVisible }) => ({
        identity,
        name,
        defaultVisible
      })),
      [
        { identity: "ref:11:0", name: "Visible Layer", defaultVisible: true },
        { identity: "ref:12:0", name: "Hidden Layer", defaultVisible: false }
      ]
    );

    const names = [
      "Visible",
      "Hidden",
      "Any",
      "All",
      "AnyOff",
      "AllOff",
      "Expr",
      "Nested",
      "Wrapped",
      "Plain"
    ];
    const properties = await registry.resolvePageProperties(document.getPage(0).resources, names);
    assert.deepEqual(properties.map((property) => property.name), names, "first-use order is retained");
    assert.deepEqual(
      Object.fromEntries(properties.map((property) => [property.name, property.defaultVisible])),
      {
        Visible: true,
        Hidden: false,
        Any: true,
        All: false,
        AnyOff: true,
        AllOff: false,
        Expr: true,
        Nested: false,
        Wrapped: false,
        Plain: true
      }
    );
    assert.equal(properties.at(-1).membership, null, "ordinary property lists are always visible");
    assert.equal(properties.at(-1).membershipIndex, null);
    assert.equal(properties[8].membershipIndex, properties[1].membershipIndex);

    const memberships = Object.fromEntries(
      properties
        .filter((property) => property.membership !== null)
        .map((property) => [property.name, property.membership])
    );
    assert.equal(memberships.Any.policy, "AnyOn");
    assert.equal(memberships.All.policy, "AllOn");
    assert.equal(memberships.AnyOff.policy, "AnyOff");
    assert.equal(memberships.AllOff.policy, "AllOff");
    assert.equal(memberships.Expr.policy, "VisibilityExpression");
    assert.deepEqual(memberships.Expr.groupIndices, [0, 1]);
    assert.deepEqual(
      memberships.Nested.groupIndices,
      [0, 1],
      "a nested OCMD contributes its underlying OCG identities"
    );

    const repeated = await registry.resolvePageProperties(
      document.getPage(0).resources,
      ["Any", "Expr", "Nested"]
    );
    assert.deepEqual(
      repeated.map((property) => property.membershipIndex),
      [memberships.Any.index, memberships.Expr.index, memberships.Nested.index],
      "membership indexes are stable across page-property resolution calls"
    );

    await assert.rejects(
      registry.resolvePageProperties(document.getPage(0).resources, ["Any", "Any"]),
      hasPdfCode("invalid-object", /requested more than once/)
    );
    await assert.rejects(
      registry.resolvePageProperties(document.getPage(0).resources, ["Missing"]),
      hasPdfCode("invalid-object", /missing from/)
    );

    const diagnostics = registry.getDiagnostics();
    assert.equal(diagnostics.length, 4);
    assert.ok(diagnostics.every((diagnostic) =>
      diagnostic.code === NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES.HiddenDefault &&
      diagnostic.severity === "info"
    ));
    assert.equal(new Set(diagnostics.map((diagnostic) => diagnostic.details.membershipIndex)).size, 4);
    assert.equal(emittedDiagnostics.length, diagnostics.length);
    assert.deepEqual(
      emittedDiagnostics.map((diagnostic) => diagnostic.message),
      diagnostics.map((diagnostic) => diagnostic.message),
      "callback and retained diagnostics are deterministic"
    );
  }
);

await withFixture(
  optionalContentFixture({ defaultConfiguration: "/D << /BaseState /OFF /ON [11 0 R] >>" }),
  {},
  async ({ registry }) => {
    assert.deepEqual(registry.listGroups().map((group) => group.defaultVisible), [true, false]);
  }
);

await assert.rejects(
  withFixture(
    optionalContentFixture({
      defaultConfiguration: "/D << /BaseState /ON /ON [11 0 R] /OFF [11 0 R] >>"
    }),
    {},
    async () => undefined
  ),
  hasPdfCode("invalid-object", /both \/D \/ON and \/D \/OFF/)
);

await assert.rejects(
  withFixture(
    optionalContentFixture({
      defaultConfiguration: "/D << /BaseState /ON /AS [<< /Event /View /OCGs [11 0 R] >>] >>"
    }),
    {},
    async () => undefined
  ),
  hasPdfCode("unsupported-content", /usage applications/)
);

const badPolicyFixture = optionalContentFixture({
  pageProperties: "/Bad 13 0 R",
  extraObjects: [{ number: 13, body: "<< /Type /OCMD /OCGs [11 0 R] /P /Sometimes >>" }]
});
await withFixture(badPolicyFixture, {}, async ({ document, registry }) => {
  await assert.rejects(
    registry.resolvePageProperties(document.getPage(0).resources, ["Bad"]),
    hasPdfCode("unsupported-content", /unsupported \/P policy/)
  );
});

const cyclicFixture = optionalContentFixture({
  pageProperties: "/Cycle 13 0 R",
  extraObjects: [{ number: 13, body: "<< /Type /OCMD /VE [/Not 13 0 R] >>" }]
});
await withFixture(cyclicFixture, {}, async ({ document, registry }) => {
  await assert.rejects(
    registry.resolvePageProperties(document.getPage(0).resources, ["Cycle"]),
    hasPdfCode("invalid-object", /cycle detected/)
  );
});

const malformedExpressionFixture = optionalContentFixture({
  pageProperties: "/Malformed 13 0 R",
  extraObjects: [{ number: 13, body: "<< /Type /OCMD /VE 11 0 R >>" }]
});
await withFixture(malformedExpressionFixture, {}, async ({ document, registry }) => {
  await assert.rejects(
    registry.resolvePageProperties(document.getPage(0).resources, ["Malformed"]),
    hasPdfCode("invalid-object", /not an expression array/)
  );
});

const expressionFixture = optionalContentFixture({
  pageProperties: "/Expr 17 0 R",
  extraObjects: [{ number: 17, body: "<< /Type /OCMD /VE [/And 11 0 R [/Not 12 0 R]] >>" }]
});
await withFixture(
  expressionFixture,
  { limits: { maxExpressionDepth: 0 } },
  async ({ document, registry }) => {
    await assert.rejects(
      registry.resolvePageProperties(document.getPage(0).resources, ["Expr"]),
      hasPdfCode("resource-limit", /expression depth/)
    );
  }
);
await withFixture(
  expressionFixture,
  { limits: { maxExpressionNodes: 1 } },
  async ({ document, registry }) => {
    await assert.rejects(
      registry.resolvePageProperties(document.getPage(0).resources, ["Expr"]),
      hasPdfCode("resource-limit", /expression nodes/)
    );
  }
);
await withFixture(
  optionalContentFixture({
    pageProperties: "/Any 13 0 R",
    extraObjects: [policyObjects[0]]
  }),
  { limits: { maxMemberships: 2 } },
  async ({ document, registry }) => {
    await assert.rejects(
      registry.resolvePageProperties(document.getPage(0).resources, ["Any"]),
      hasPdfCode("resource-limit", /membership count/)
    );
  }
);
await withFixture(
  optionalContentFixture({
    pageProperties: "/Nested 18 0 R",
    extraObjects: [policyObjects[1], policyObjects[5]]
  }),
  { limits: { maxMemberships: 3 } },
  async ({ document, registry }) => {
    await assert.rejects(
      registry.resolvePageProperties(document.getPage(0).resources, ["Nested"]),
      hasPdfCode("resource-limit", /membership count/)
    );
  }
);
await assert.rejects(
  withFixture(
    optionalContentFixture(),
    { limits: { maxGroups: 1 } },
    async () => undefined
  ),
  hasPdfCode("resource-limit", /group count/)
);
await withFixture(
  optionalContentFixture({ pageProperties: "/Visible 11 0 R" }),
  { limits: { maxPageProperties: 0 } },
  async ({ document, registry }) => {
    await assert.rejects(
      registry.resolvePageProperties(document.getPage(0).resources, ["Visible"]),
      hasPdfCode("resource-limit", /property count/)
    );
  }
);

await withFixture(
  optionalContentFixture({ pageProperties: "/Visible 11 0 R" }),
  {},
  async ({ document, registry }) => {
    const controller = new AbortController();
    const reason = new PdfError("aborted", "fixture abort");
    controller.abort(reason);
    await assert.rejects(
      registry.resolvePageProperties(document.getPage(0).resources, ["Visible"], controller.signal),
      (error) => error === reason
    );
  }
);

await withFixture(optionalContentFixture(), {}, async ({ document, registry }) => {
  const resolved = await registry.resolvePageProperties(
    document.getPage(0).resources,
    ["R62"],
    undefined,
    []
  );
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].name, "R62");
  assert.equal(resolved[0].propertyList, null);
  assert.equal(resolved[0].membership, null);
  assert.equal(resolved[0].defaultVisible, true);

  await registry.resolvePageProperties(document.getPage(0).resources, ["R62"], undefined, []);
  const unresolved = registry.getDiagnostics().filter((diagnostic) =>
    diagnostic.code === NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES.UnresolvedMetadataProperty
  );
  assert.equal(unresolved.length, 1, "identical unresolved metadata diagnostics are deduplicated");
  assert.deepEqual(unresolved[0].details, {
    propertyName: "R62",
    reason: "resources-missing",
    defaultVisible: true
  });

  await assert.rejects(
    registry.resolvePageProperties(
      document.getPage(0).resources,
      ["R62"],
      undefined,
      ["R62"]
    ),
    hasPdfCode("invalid-object", /page has no resources/),
    "an unresolved /OC membership remains a hard failure"
  );
});

hooks.deregister();
console.log("native optional-content registry tests passed");
