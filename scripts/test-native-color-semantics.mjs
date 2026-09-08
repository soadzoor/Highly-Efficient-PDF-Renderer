import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

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
  NativePdfColorRegistry,
  parseIccMetadata
} = await import("../src/pdf/nativeColor.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");
const { convertDeviceCmykToSrgb } = await import("../src/pdf/deviceCmyk.ts");

const encoder = new TextEncoder();
const D65 = [0.95047, 1, 1.08883];
const SRGB_TO_XYZ = [
  0.4124564, 0.2126729, 0.0193339,
  0.3575761, 0.7151522, 0.119192,
  0.1804375, 0.072175, 0.9503041
];

function name(value) {
  return { kind: "name", value };
}

function ref(objectNumber) {
  return { kind: "ref", objectNumber, generation: 0 };
}

function dictionary(entries = {}) {
  return new Map(Object.entries(entries));
}

function stream(entries, bytes = new Uint8Array(0)) {
  return {
    kind: "stream",
    dictionary: dictionary(entries),
    bytes: typeof bytes === "string" ? encoder.encode(bytes) : bytes
  };
}

function pdfString(bytes) {
  return { kind: "string", bytes: Uint8Array.from(bytes), hex: true };
}

function calGray({
  whitePoint = D65,
  blackPoint,
  gamma
} = {}) {
  const entries = { WhitePoint: whitePoint };
  if (blackPoint !== undefined) entries.BlackPoint = blackPoint;
  if (gamma !== undefined) entries.Gamma = gamma;
  return [name("CalGray"), dictionary(entries)];
}

function calRgb({
  whitePoint = D65,
  blackPoint,
  gamma = [1, 1, 1],
  matrix = SRGB_TO_XYZ
} = {}) {
  const entries = { WhitePoint: whitePoint, Gamma: gamma, Matrix: matrix };
  if (blackPoint !== undefined) entries.BlackPoint = blackPoint;
  return [name("CalRGB"), dictionary(entries)];
}

function lab({
  whitePoint = D65,
  blackPoint,
  range = [-100, 100, -100, 100]
} = {}) {
  const entries = { WhitePoint: whitePoint, Range: range };
  if (blackPoint !== undefined) entries.BlackPoint = blackPoint;
  return [name("Lab"), dictionary(entries)];
}

function exponential({
  inputCount = 1,
  c0 = [0],
  c1 = [1],
  exponent = 1
} = {}) {
  return dictionary({
    FunctionType: 2,
    Domain: Array.from({ length: inputCount }, () => [0, 1]).flat(),
    Range: Array.from({ length: c0.length }, () => [0, 1]).flat(),
    C0: c0,
    C1: c1,
    N: exponent
  });
}

function calculator(program, inputCount, outputCount) {
  return stream({
    FunctionType: 4,
    Domain: Array.from({ length: inputCount }, () => [0, 1]).flat(),
    Range: Array.from({ length: outputCount }, () => [0, 1]).flat()
  }, program);
}

function indexed(base, highValue, lookup) {
  return [name("Indexed"), base, highValue, lookup];
}

function separation(colorant, alternate, tintTransform) {
  return [name("Separation"), name(colorant), alternate, tintTransform];
}

function deviceN(names, alternate, tintTransform, attributes) {
  const values = [name("DeviceN"), names.map(name), alternate, tintTransform];
  if (attributes !== undefined) values.push(attributes);
  return values;
}

function iccProfile({
  byteLength = 128,
  declaredSize = byteLength,
  deviceClass = "mntr",
  dataColorSpace = "RGB ",
  connectionSpace = "XYZ ",
  signature = "acsp"
} = {}) {
  const profile = new Uint8Array(byteLength);
  if (byteLength >= 4) new DataView(profile.buffer).setUint32(0, declaredSize, false);
  if (byteLength > 8) profile[8] = 4;
  writeAscii(profile, 4, "TEST");
  writeAscii(profile, 12, deviceClass);
  writeAscii(profile, 16, dataColorSpace);
  writeAscii(profile, 20, connectionSpace);
  writeAscii(profile, 36, signature);
  return profile;
}

function iccSpace({
  count = 3,
  alternate = name("DeviceRGB"),
  range,
  profile = iccProfile()
} = {}) {
  const entries = alternate === null ? { N: count } : { N: count, Alternate: alternate };
  if (range !== undefined) entries.Range = range;
  return [name("ICCBased"), stream(entries, profile)];
}

function writeAscii(bytes, offset, value) {
  for (let index = 0; index < value.length && offset + index < bytes.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function fixtureBytes() {
  const profile = iccProfile({ byteLength: 132, declaredSize: 128 });
  profile.fill(0xa5, 128);
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>" },
      { number: 10, body: "[/Indexed /DeviceRGB 0 <FF0000>]" },
      { number: 11, body: "/Loop" },
      { number: 12, body: "[/CalGray << /WhitePoint [0.95047 1 1.08883] /Gamma 2 >>]" },
      { number: 13, body: "/DeviceRGB" },
      { number: 14, body: tinyPdfStream("/N 3 /Alternate /DeviceRGB", profile) },
      { number: 15, body: "[/ICCBased 14 0 R]" }
    ]
  });
}

function hasPdfCode(code) {
  return (error) => error instanceof PdfError && error.code === code;
}

async function rejectsCode(action, code) {
  await assert.rejects(Promise.resolve().then(action), hasPdfCode(code));
}

function throwsCode(action, code) {
  assert.throws(action, hasPdfCode(code));
}

function closeTo(actual, expected, tolerance = 1e-6) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`
  );
}

function closeRgb(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, 3);
  for (let index = 0; index < 3; index += 1) closeTo(actual[index], expected[index], tolerance);
}

function srgbCompand(value) {
  return value <= 0.0031308
    ? 12.92 * value
    : 1.055 * value ** (1 / 2.4) - 0.055;
}

function assertMonotonicOffsets(offsets, finalLength) {
  assert.equal(offsets[0], 0);
  assert.equal(offsets.at(-1), finalLength);
  for (let index = 1; index < offsets.length; index += 1) {
    assert(offsets[index] >= offsets[index - 1]);
  }
}

const document = await openNativePdfDocument({ kind: "bytes", bytes: fixtureBytes() });

async function testDeviceSpacesAndScopedDefaults() {
  const colors = new NativePdfColorRegistry(document);
  const gray = await colors.add(name("DeviceGray"));
  const rgb = await colors.add(name("RGB"));
  const cmyk = await colors.add(name("CMYK"));
  assert.equal(await colors.add(name("G")), gray);
  assert.equal(await colors.add(name("DeviceRGB")), rgb);
  assert.deepEqual(colors.defaultDecode(gray), [0, 1]);
  assert.deepEqual(colors.defaultDecode(rgb), [0, 1, 0, 1, 0, 1]);
  assert.deepEqual(colors.defaultDecode(cmyk), [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.deepEqual(colors.convertToSrgb(gray, [-1]), [0, 0, 0]);
  assert.deepEqual(colors.convertToSrgb(rgb, [-1, 0.25, 2]), [0, 0.25, 1]);
  assert.deepEqual(
    colors.convertToSrgb(cmyk, [0, 1, 1, 0]),
    convertDeviceCmykToSrgb(0, 1, 1, 0)
  );
  assert.deepEqual(
    convertDeviceCmykToSrgb(0, 0.85, 0.9, 0).map((value) => Math.round(value * 255)),
    [255, 76, 41],
    "the uncalibrated DeviceCMYK fallback remains compatible with the PDF.js oracle"
  );
  const scratch = [0, 0, 0];
  for (let entry = 0; entry < 256; entry += 1) {
    const components = [entry / 255, 1 - entry / 255, (entry % 17) / 16, entry / 128 - 0.5];
    const expected = convertDeviceCmykToSrgb(...components);
    assert.equal(convertDeviceCmykToSrgb(...components, scratch), scratch);
    assert.deepEqual(scratch, expected, "reusable CMYK output preserves exact conversion and clamping");
  }
  throwsCode(() => colors.convertToSrgb(rgb, [0, 0]), "unsupported-color");
  throwsCode(() => colors.convertToSrgb(rgb, [0, Number.NaN, 0]), "unsupported-color");

  // Compare the device-leaf shortcut with the recursive Indexed conversion,
  // which still exercises graph validation and the generic device evaluator.
  for (const [deviceName, deviceIndex, count] of [
    ["DeviceGray", gray, 1], ["DeviceRGB", rgb, 3], ["DeviceCMYK", cmyk, 4]
  ]) {
    const lookup = Uint8Array.from({ length: 256 * count }, (_, offset) =>
      (Math.floor(offset / count) * (offset % count * 2 + 1) + offset % count * 37) & 255);
    const palette = await colors.add(indexed(name(deviceName), 255, pdfString(lookup)));
    for (let entry = 0; entry < 256; entry += 1) {
      const components = Array.from(lookup.subarray(entry * count, (entry + 1) * count), value => value / 255);
      assert.deepEqual(colors.convertToSrgb(deviceIndex, components), colors.convertToSrgb(palette, [entry]));
    }
    throwsCode(() => colors.convertToSrgb(deviceIndex, new Array(count).fill(Infinity)), "unsupported-color");
    const aborted = new AbortController();
    aborted.abort();
    throwsCode(() => colors.convertToSrgb(deviceIndex, new Array(count).fill(0), aborted.signal), "aborted");
  }

  const defaultGray = calGray({ gamma: 2 });
  const defaultRgb = calRgb();
  const defaultCmyk = iccSpace({
    count: 4,
    alternate: name("DeviceCMYK"),
    profile: iccProfile({ dataColorSpace: "CMYK" })
  });
  const scope = dictionary({
    DefaultGray: defaultGray,
    DefaultRGB: defaultRgb,
    DefaultCMYK: defaultCmyk,
    UnusedMalformed: 42
  });
  const scopedGray = await colors.add(name("DeviceGray"), scope);
  const scopedRgb = await colors.add(name("DeviceRGB"), scope);
  const scopedCmyk = await colors.add(name("DeviceCMYK"), scope);
  assert.equal(colors.describe(scopedGray).kind, "CalGray");
  assert.equal(colors.describe(scopedRgb).kind, "CalRGB");
  assert.equal(colors.describe(scopedCmyk).kind, "ICCBased");
  assert.notEqual(scopedRgb, rgb);
  assert.equal(
    colors.describe(colors.describe(scopedCmyk).alternateSpaceIndex).kind,
    "DeviceCMYK",
    "an ICC Alternate is not subject to DefaultCMYK substitution"
  );

  const separateScope = dictionary({ DefaultRGB: lab() });
  await rejectsCode(() => colors.add(name("DeviceRGB"), separateScope), "unsupported-color");
  await rejectsCode(
    () => colors.add(name("DeviceGray"), dictionary({ DefaultGray: name("DeviceRGB") })),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(name("DeviceRGB"), dictionary({ DefaultRGB: name("DeviceRGB") })),
    "unsupported-color"
  );

  const shared = indexed(name("DeviceRGB"), 0, pdfString([255, 0, 0]));
  const firstScope = dictionary({ DefaultRGB: calRgb() });
  const secondScope = dictionary();
  const first = await colors.add(shared, firstScope);
  assert.equal(await colors.add(shared, firstScope), first);
  const second = await colors.add(shared, secondScope);
  assert.notEqual(first, second);
  assert.notEqual(
    colors.describe(first).alternateSpaceIndex,
    colors.describe(second).alternateSpaceIndex
  );

  const indirectFirst = await colors.add(ref(10), firstScope);
  assert.equal(await colors.add(ref(10), firstScope), indirectFirst);
  const indirectSecond = await colors.add(ref(10), secondScope);
  assert.notEqual(indirectFirst, indirectSecond);
  const indirectName = await colors.add(ref(13));
  assert.equal(indirectName, rgb, "an indirect color-space name resolves like a direct name");

  const loopScope = dictionary({ Loop: ref(11) });
  await rejectsCode(() => colors.add(ref(11), loopScope), "unsupported-color");
  const aliases = dictionary({ A: name("B"), B: name("A") });
  await rejectsCode(() => colors.add(name("A"), aliases), "unsupported-color");
}

async function testCalibratedSpaces() {
  const colors = new NativePdfColorRegistry(document);
  const gray = await colors.add(calGray({ blackPoint: [0.01, 0.02, 0.03], gamma: 2 }));
  assert.deepEqual(colors.describe(gray).parameters, [...D65, 0.01, 0.02, 0.03, 2]);
  const expectedGray = srgbCompand(0.25);
  closeRgb(colors.convertToSrgb(gray, [0.5]), [expectedGray, expectedGray, expectedGray], 2e-5);

  const rgb = await colors.add(calRgb({ blackPoint: [0.01, 0.02, 0.03] }));
  closeRgb(colors.convertToSrgb(rgb, [1, 0, 0]), [1, 0, 0], 2e-4);
  assert.deepEqual(colors.describe(rgb).parameters.slice(3, 6), [0.01, 0.02, 0.03]);

  const labIndex = await colors.add(lab({
    blackPoint: [0.01, 0.02, 0.03],
    range: [-80, 90, -70, 60]
  }));
  assert.deepEqual(colors.defaultDecode(labIndex), [0, 100, -80, 90, -70, 60]);
  closeRgb(colors.convertToSrgb(labIndex, [100, 0, 0]), [1, 1, 1], 2e-4);
  const neutralLinear = ((50 + 16) / 116) ** 3;
  const neutral = srgbCompand(neutralLinear);
  closeRgb(colors.convertToSrgb(labIndex, [50, 0, 0]), [neutral, neutral, neutral], 2e-5);
  closeRgb(
    colors.convertToSrgb(labIndex, [50, -1000, 1000]),
    colors.convertToSrgb(labIndex, [50, -80, 60]),
    1e-12
  );

  await rejectsCode(() => colors.add(calGray({ whitePoint: [0, 1, 1] })), "unsupported-color");
  await rejectsCode(() => colors.add(calGray({ whitePoint: [1, 0.9, 1] })), "unsupported-color");
  await rejectsCode(() => colors.add(calGray({ blackPoint: [0, -1, 0] })), "unsupported-color");
  await rejectsCode(() => colors.add(calGray({ gamma: 0 })), "unsupported-color");
  await rejectsCode(() => colors.add(calRgb({ gamma: [1, 1] })), "unsupported-color");
  await rejectsCode(() => colors.add(calRgb({ matrix: [1, 0, 0] })), "unsupported-color");
  await rejectsCode(() => colors.add(lab({ range: [1, -1, -1, 1] })), "unsupported-color");
  await colors.add(lab({ range: [4, 4, -2, -2] }));
  await rejectsCode(
    () => colors.add([name("CalGray"), dictionary({ WhitePoint: D65 }), 0]),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(calGray({ whitePoint: [D65[0], 1, D65[2], 0] })),
    "unsupported-color"
  );
}

async function testIccProfilesAndKernelBoundary() {
  const parsed = parseIccMetadata(iccProfile());
  assert.equal(parsed.declaredSize, 128);
  assert.equal(parsed.deviceClass, "mntr");
  assert.equal(parsed.dataColorSpace, "RGB ");
  assert.equal(parsed.connectionSpace, "XYZ ");
  throwsCode(() => parseIccMetadata(new Uint8Array(127)), "unsupported-color");
  throwsCode(() => parseIccMetadata(iccProfile({ signature: "nope" })), "unsupported-color");
  throwsCode(
    () => parseIccMetadata(iccProfile({ byteLength: 128, declaredSize: 129 })),
    "unsupported-color"
  );

  const colors = new NativePdfColorRegistry(document);
  const indirect = await colors.add(ref(15));
  const indirectDescription = colors.describe(indirect);
  assert.equal(indirectDescription.kind, "ICCBased");
  assert.equal(indirectDescription.profile.length, 128, "bytes after the declared ICC size are discarded");
  assert.deepEqual(colors.defaultDecode(indirect), [0, 1, 0, 1, 0, 1]);
  // No ICC resolver is configured here, so nothing has asked for profile
  // fidelity and 8.6.5.5 hands the conversion to the alternate space. A
  // resolver that is present and fails still raises; see the transform-result
  // cases in test-pdf-session-icc-transform-resolver.mjs.
  assert.deepEqual(colors.convertToSrgb(indirect, [0.25, 0.5, 0.75]), [0.25, 0.5, 0.75]);

  await rejectsCode(
    () => colors.add(iccSpace({ count: 2, profile: iccProfile() })),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(iccSpace({ count: 3, profile: iccProfile({ dataColorSpace: "CMYK" }) })),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(iccSpace({ profile: iccProfile({ deviceClass: "link" }) })),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(iccSpace({ profile: iccProfile({ connectionSpace: "RGB " }) })),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(iccSpace({ alternate: name("DeviceGray") })),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(iccSpace({ alternate: name("Pattern") })),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(iccSpace({ range: [0, 1, 0, -1, 0, 1] })),
    "unsupported-color"
  );
  const fixedRange = await colors.add(iccSpace({ range: [0.5, 0.5, 0, 1, 0, 1] }));
  assert.deepEqual(colors.defaultDecode(fixedRange), [0.5, 0.5, 0, 1, 0, 1]);

  const limited = new NativePdfColorRegistry(document, undefined, { maxIccProfileBytes: 128 });
  await rejectsCode(
    () => limited.add(iccSpace({
      profile: iccProfile({ byteLength: 129, declaredSize: 128 })
    })),
    "resource-limit"
  );

  // ISO 32000-1 8.6.5.5: when the profile cannot be used, the alternate space
  // stands in for it. One is always available -- /Alternate when supplied, and
  // the Device space matching /N otherwise -- so having no ICC resolver must
  // degrade the colour, not fail the document.
  const withoutResolver = new NativePdfColorRegistry(document);
  const explicitAlternate = await withoutResolver.add(iccSpace());
  assert.deepEqual(
    withoutResolver.convertToSrgb(explicitAlternate, [0.25, 0.5, 0.75]),
    [0.25, 0.5, 0.75]
  );

  const impliedAlternate = await withoutResolver.add(iccSpace({ alternate: null }));
  assert.deepEqual(
    withoutResolver.convertToSrgb(impliedAlternate, [1, 0, 0]),
    [1, 0, 0],
    "/N 3 implies DeviceRGB when /Alternate is absent"
  );

  // /Range still maps the components onto [0, 1] before the alternate space
  // sees them, exactly as it does for a resolver-backed profile above.
  const rangedFallback = await withoutResolver.add(iccSpace({
    range: [0.1, 0.9, 0.2, 0.8, 0.3, 0.7]
  }));
  closeRgb(withoutResolver.convertToSrgb(rangedFallback, [-1, 2, 0.5]), [0, 1, 0.5], 1e-12);

  let received = null;
  const kernelColors = new NativePdfColorRegistry(document, undefined, {
    iccKernel: {
      convertToSrgb(profile, components, metadata) {
        received = { profile, components: [...components], metadata };
        return [1.5, -0.5, 0.25];
      }
    }
  });
  const kernelIcc = await kernelColors.add(iccSpace({
    range: [0.1, 0.9, 0.2, 0.8, 0.3, 0.7]
  }));
  assert.deepEqual(kernelColors.convertToSrgb(kernelIcc, [-1, 2, 0.5]), [1, 0, 0.25]);
  closeRgb(received.components, [0, 1, 0.5], 1e-12);
  assert.equal(received.profile.length, 128);
  assert.equal(received.metadata.dataColorSpace, "RGB ");

  const invalidKernel = new NativePdfColorRegistry(document, undefined, {
    iccKernel: { convertToSrgb() { return [0, Number.NaN, 0]; } }
  });
  const invalidKernelIcc = await invalidKernel.add(iccSpace());
  throwsCode(() => invalidKernel.convertToSrgb(invalidKernelIcc, [0, 0, 0]), "unsupported-color");

  const throwingKernel = new NativePdfColorRegistry(document, undefined, {
    iccKernel: { convertToSrgb() { throw new Error("bad profile"); } }
  });
  const throwingKernelIcc = await throwingKernel.add(iccSpace());
  throwsCode(() => throwingKernel.convertToSrgb(throwingKernelIcc, [0, 0, 0]), "unsupported-color");
}

async function testIndexedSpaces() {
  const colors = new NativePdfColorRegistry(document);
  const direct = await colors.add(indexed(
    name("DeviceRGB"),
    1,
    pdfString([255, 0, 0, 0, 255, 0, 99, 98])
  ));
  assert.deepEqual([...colors.describe(direct).lookup], [255, 0, 0, 0, 255, 0]);
  assert.deepEqual(colors.defaultDecode(direct), [0, 1]);
  assert.deepEqual(colors.convertToSrgb(direct, [-1]), [1, 0, 0]);
  assert.deepEqual(colors.convertToSrgb(direct, [0.6]), [0, 1, 0]);
  assert.deepEqual(colors.convertToSrgb(direct, [9]), [0, 1, 0]);

  const labIndexed = await colors.add(indexed(
    lab({ range: [-100, 100, -100, 100] }),
    0,
    pdfString([128, 255, 0])
  ));
  const labBase = colors.describe(labIndexed).alternateSpaceIndex;
  closeRgb(
    colors.convertToSrgb(labIndexed, [0]),
    colors.convertToSrgb(labBase, [128 / 255 * 100, 100, -100]),
    1e-12
  );

  const iccIndexed = await colors.add(indexed(
    iccSpace({ range: [10, 20, -2, 2, 0.25, 0.75] }),
    0,
    pdfString([0, 128, 255])
  ));
  const iccBase = colors.describe(iccIndexed).alternateSpaceIndex;
  assert.deepEqual(colors.defaultDecode(iccBase), [10, 20, -2, 2, 0.25, 0.75]);

  const spot = separation(
    "Spot",
    name("DeviceRGB"),
    exponential({ c0: [1, 1, 1], c1: [0, 0, 1] })
  );
  const spotIndexed = await colors.add(indexed(spot, 0, pdfString([255])));
  closeRgb(colors.convertToSrgb(spotIndexed, [0]), [0, 0, 1]);

  const duo = deviceN(
    ["InkA", "InkB"],
    name("DeviceGray"),
    calculator("{ add 2 div }", 2, 1)
  );
  const duoIndexed = await colors.add(indexed(duo, 0, pdfString([255, 0])));
  closeRgb(colors.convertToSrgb(duoIndexed, [0]), [0.5, 0.5, 0.5]);

  const lookupStream = stream({}, Uint8Array.of(0, 0, 255));
  const streamIndex = await colors.add(indexed(name("DeviceRGB"), 0, lookupStream));
  assert.deepEqual(colors.convertToSrgb(streamIndex, [0]), [0, 0, 1]);

  await rejectsCode(
    () => colors.add(indexed(name("DeviceRGB"), 1, pdfString([0, 0, 0]))),
    "unsupported-color"
  );
  for (const highValue of [-1, 0.5, 256]) {
    await rejectsCode(
      () => colors.add(indexed(name("DeviceGray"), highValue, pdfString([0]))),
      "unsupported-color"
    );
  }
  await rejectsCode(
    () => colors.add(indexed(indexed(name("DeviceGray"), 0, pdfString([0])), 0, pdfString([0]))),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(indexed([name("Pattern")], 0, pdfString([0]))),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(indexed(name("DeviceGray"), 0, 42)),
    "unsupported-color"
  );
}

async function testSeparationAndDeviceN() {
  const colors = new NativePdfColorRegistry(document);
  const tint = exponential({ c0: [1, 1, 1], c1: [0, 0, 1] });
  const spot = await colors.add(separation("Spot", name("DeviceRGB"), tint));
  assert.deepEqual(colors.describe(spot).names, ["Spot"]);
  closeRgb(colors.convertToSrgb(spot, [-1]), [1, 1, 1]);
  closeRgb(colors.convertToSrgb(spot, [1]), [0, 0, 1]);

  const scopedSpot = await colors.add(
    separation("Scoped", name("DeviceRGB"), tint),
    dictionary({ DefaultRGB: calRgb() })
  );
  assert.equal(colors.describe(colors.describe(scopedSpot).alternateSpaceIndex).kind, "CalRGB");

  const all = await colors.add(separation("All", name("DeviceRGB"), tint));
  const none = await colors.add(separation("None", name("DeviceRGB"), tint));
  throwsCode(() => colors.convertToSrgb(all, [1]), "unsupported-color");
  throwsCode(() => colors.convertToSrgb(none, [1]), "unsupported-color");

  const duoFunction = calculator("{ pop dup dup }", 2, 3);
  const duo = await colors.add(deviceN(
    ["InkA", "InkB"],
    name("DeviceRGB"),
    duoFunction,
    dictionary({ Subtype: name("DeviceN"), MixingHints: 42 })
  ));
  assert.deepEqual(colors.describe(duo).names, ["InkA", "InkB"]);
  closeRgb(colors.convertToSrgb(duo, [0.25, 0.9]), [0.25, 0.25, 0.25]);

  const repeatedNone = await colors.add(deviceN(
    ["None", "None"],
    name("DeviceGray"),
    calculator("{ add 2 div }", 2, 1)
  ));
  throwsCode(() => colors.convertToSrgb(repeatedNone, [0, 0]), "unsupported-color");

  const nChannel = await colors.add(deviceN(
    ["Spot"],
    name("DeviceGray"),
    exponential(),
    dictionary({ Subtype: name("NChannel") })
  ));
  assert.equal(colors.describe(nChannel).kind, "DeviceN");

  const specialAlternate = separation("Nested", name("DeviceGray"), exponential());
  await rejectsCode(
    () => colors.add(separation("Spot", specialAlternate, exponential())),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(deviceN(["Ink"], specialAlternate, exponential())),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(separation("Spot", name("DeviceRGB"), exponential())),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(deviceN(["InkA", "InkB"], name("DeviceRGB"), tint)),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(deviceN(["Ink", "Ink"], name("DeviceGray"), exponential({ inputCount: 2 }))),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(deviceN(["All"], name("DeviceGray"), exponential())),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(deviceN(["None"], name("DeviceGray"), exponential(), dictionary({ Subtype: name("NChannel") }))),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(deviceN(["Ink"], name("DeviceGray"), exponential(), 42)),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.add(deviceN(["Ink"], name("DeviceGray"), exponential(), dictionary({ Subtype: name("Other") }))),
    "unsupported-color"
  );

  const limited = new NativePdfColorRegistry(document, undefined, { maxDeviceNComponents: 1 });
  await rejectsCode(
    () => limited.add(deviceN(
      ["A", "B"],
      name("DeviceGray"),
      calculator("{ add 2 div }", 2, 1)
    )),
    "resource-limit"
  );
  assert.throws(
    () => new NativePdfColorRegistry(document, undefined, { maxDeviceNComponents: 256 }),
    RangeError
  );
}

async function testPatternBasesLimitsCancellationAndStore() {
  const colors = new NativePdfColorRegistry(document);
  assert.equal(await colors.resolvePatternBase(name("Pattern")), null);
  assert.equal(await colors.resolvePatternBase([name("Pattern")]), null);
  const rgb = await colors.resolvePatternBase([name("Pattern"), name("DeviceRGB")]);
  assert.equal(colors.describe(rgb).kind, "DeviceRGB");

  const resources = dictionary({
    P: [name("Pattern"), name("DeviceRGB")],
    Colored: name("Pattern"),
    A: name("B"),
    B: name("A"),
    DefaultRGB: calRgb()
  });
  const scopedBase = await colors.resolvePatternBase(name("P"), resources);
  assert.equal(colors.describe(scopedBase).kind, "CalRGB");
  assert.equal(await colors.resolvePatternBase(name("Colored"), resources), null);
  await rejectsCode(() => colors.resolvePatternBase(name("A"), resources), "unsupported-color");
  await rejectsCode(
    () => colors.resolvePatternBase([name("Pattern"), name("DeviceRGB"), 0]),
    "unsupported-color"
  );
  await rejectsCode(
    () => colors.resolvePatternBase([name("Pattern"), [name("Pattern")]]),
    "unsupported-color"
  );
  await rejectsCode(() => colors.add(name("Pattern")), "unsupported-color");

  const countLimited = new NativePdfColorRegistry(document, undefined, { maxColorSpaces: 1 });
  await countLimited.add(name("DeviceGray"));
  await rejectsCode(() => countLimited.add(name("DeviceRGB")), "resource-limit");

  const depthLimited = new NativePdfColorRegistry(document, undefined, { maxColorDepth: 1 });
  await rejectsCode(
    () => depthLimited.add(name("A"), dictionary({ A: name("DeviceRGB") })),
    "resource-limit"
  );

  const valueLimited = new NativePdfColorRegistry(document, undefined, { maxStoreValues: 6 });
  await rejectsCode(() => valueLimited.add(calGray()), "resource-limit");
  const byteLimited = new NativePdfColorRegistry(document, undefined, { maxStoreBytes: 2 });
  await rejectsCode(
    () => byteLimited.add(indexed(name("DeviceRGB"), 0, pdfString([1, 2, 3]))),
    "resource-limit"
  );

  const controller = new AbortController();
  controller.abort("fixture abort");
  await rejectsCode(() => colors.add(name("DeviceGray"), undefined, controller.signal), "aborted");
  await rejectsCode(() => colors.resolvePatternBase(name("Pattern"), undefined, controller.signal), "aborted");
  throwsCode(() => colors.convertToSrgb(rgb, [0, 0, 0], controller.signal), "aborted");
  throwsCode(() => colors.buildStore(controller.signal), "aborted");

  const storeColors = new NativePdfColorRegistry(document);
  const indexedIndex = await storeColors.add(ref(10));
  const calIndex = await storeColors.add(ref(12));
  const iccIndex = await storeColors.add(ref(15));
  const spotIndex = await storeColors.add(separation(
    "StoreSpot",
    name("DeviceGray"),
    exponential()
  ));
  const store = storeColors.buildStore();
  assert.equal(store.spaceKinds.length, storeColors.size);
  assert.equal(store.componentCounts.length, storeColors.size);
  assert.equal(store.alternateSpaceIndices.length, storeColors.size);
  assert.equal(store.functionIndices.length, storeColors.size);
  assertMonotonicOffsets(store.parameterOffsets, store.parameters.length);
  assertMonotonicOffsets(store.nameOffsets, store.names.length);
  assertMonotonicOffsets(store.profileOffsets, store.profiles.length);
  assertMonotonicOffsets(store.lookupOffsets, store.lookupBytes.length);
  assert.equal(
    store.lookupOffsets[indexedIndex + 1] - store.lookupOffsets[indexedIndex],
    3
  );
  assert.equal(
    store.parameterOffsets[calIndex + 1] - store.parameterOffsets[calIndex],
    7
  );
  assert.equal(
    store.profileOffsets[iccIndex + 1] - store.profileOffsets[iccIndex],
    128
  );
  assert.deepEqual(
    store.names.slice(store.nameOffsets[spotIndex], store.nameOffsets[spotIndex + 1]),
    ["StoreSpot"]
  );
}

try {
  await testDeviceSpacesAndScopedDefaults();
  await testCalibratedSpaces();
  await testIccProfilesAndKernelBoundary();
  await testIndexedSpaces();
  await testSeparationAndDeviceN();
  await testPatternBasesLimitsCancellationAndStore();
  console.log("native PDF managed-color semantics tests passed");
} finally {
  await document.close();
  hooks.deregister();
}
