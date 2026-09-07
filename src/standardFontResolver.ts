import type {
  NativeMissingFontRequest,
  NativeMissingFontResolver
} from "./pdf/nativeFont";

export type BundledStandardFontAssetId =
  | "liberation-mono-regular"
  | "liberation-mono-bold"
  | "liberation-mono-italic"
  | "liberation-mono-bold-italic"
  | "liberation-sans-regular"
  | "liberation-sans-bold"
  | "liberation-sans-italic"
  | "liberation-sans-bold-italic"
  | "liberation-serif-regular"
  | "liberation-serif-bold"
  | "liberation-serif-italic"
  | "liberation-serif-bold-italic"
  | "noto-sans-math"
  | "noto-sans-symbols-2";

export interface BundledStandardFontAsset {
  readonly id: BundledStandardFontAssetId;
  readonly url: URL;
  readonly family: "mono" | "sans" | "serif" | "symbols";
  readonly weight: 400 | 700;
  readonly italic: boolean;
  readonly byteLength: number;
  readonly sha256: string;
  readonly source:
    | "Liberation Fonts 2.1.5"
    | "Noto Sans Math 3.000"
    | "Noto Sans Symbols 2 2.008";
}

export type BundledStandardFontLoader = (
  asset: Readonly<BundledStandardFontAsset>,
  signal?: AbortSignal
) => Promise<Uint8Array>;

export interface CreateBundledStandardFontResolverOptions {
  /**
   * Asset reader used by the resolver. The default uses `fetch()` and is
   * suitable for browsers. The Node subpath supplies a file-URL reader.
   */
  readonly loadAsset?: BundledStandardFontLoader;
}

const ASSETS = {
  "liberation-mono-regular": asset(
    "liberation-mono-regular",
    new URL("./assets/standard-fonts/LiberationMono-Regular.ttf?no-inline", import.meta.url),
    "mono",
    400,
    false,
    319_508,
    "f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-mono-bold": asset(
    "liberation-mono-bold",
    new URL("./assets/standard-fonts/LiberationMono-Bold.ttf?no-inline", import.meta.url),
    "mono",
    700,
    false,
    307_996,
    "bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-mono-italic": asset(
    "liberation-mono-italic",
    new URL("./assets/standard-fonts/LiberationMono-Italic.ttf?no-inline", import.meta.url),
    "mono",
    400,
    true,
    281_536,
    "605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-mono-bold-italic": asset(
    "liberation-mono-bold-italic",
    new URL("./assets/standard-fonts/LiberationMono-BoldItalic.ttf?no-inline", import.meta.url),
    "mono",
    700,
    true,
    284_068,
    "79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-sans-regular": asset(
    "liberation-sans-regular",
    new URL("./assets/standard-fonts/LiberationSans-Regular.ttf?no-inline", import.meta.url),
    "sans",
    400,
    false,
    410_712,
    "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-sans-bold": asset(
    "liberation-sans-bold",
    new URL("./assets/standard-fonts/LiberationSans-Bold.ttf?no-inline", import.meta.url),
    "sans",
    700,
    false,
    414_456,
    "788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-sans-italic": asset(
    "liberation-sans-italic",
    new URL("./assets/standard-fonts/LiberationSans-Italic.ttf?no-inline", import.meta.url),
    "sans",
    400,
    true,
    415_816,
    "e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-sans-bold-italic": asset(
    "liberation-sans-bold-italic",
    new URL("./assets/standard-fonts/LiberationSans-BoldItalic.ttf?no-inline", import.meta.url),
    "sans",
    700,
    true,
    408_996,
    "698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-serif-regular": asset(
    "liberation-serif-regular",
    new URL("./assets/standard-fonts/LiberationSerif-Regular.ttf?no-inline", import.meta.url),
    "serif",
    400,
    false,
    393_576,
    "058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-serif-bold": asset(
    "liberation-serif-bold",
    new URL("./assets/standard-fonts/LiberationSerif-Bold.ttf?no-inline", import.meta.url),
    "serif",
    700,
    false,
    370_096,
    "d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-serif-italic": asset(
    "liberation-serif-italic",
    new URL("./assets/standard-fonts/LiberationSerif-Italic.ttf?no-inline", import.meta.url),
    "serif",
    400,
    true,
    375_632,
    "0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e",
    "Liberation Fonts 2.1.5"
  ),
  "liberation-serif-bold-italic": asset(
    "liberation-serif-bold-italic",
    new URL("./assets/standard-fonts/LiberationSerif-BoldItalic.ttf?no-inline", import.meta.url),
    "serif",
    700,
    true,
    376_772,
    "f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7",
    "Liberation Fonts 2.1.5"
  ),
  "noto-sans-math": asset(
    "noto-sans-math",
    new URL("./assets/standard-fonts/NotoSansMath-Regular.ttf?no-inline", import.meta.url),
    "symbols",
    400,
    false,
    657_440,
    "b127e84699212b6b2ef50aff58e0ebebeec04ffe6db1b9eb9e209c8c3d97b4aa",
    "Noto Sans Math 3.000"
  ),
  "noto-sans-symbols-2": asset(
    "noto-sans-symbols-2",
    new URL("./assets/standard-fonts/NotoSansSymbols2-Regular.ttf?no-inline", import.meta.url),
    "symbols",
    400,
    false,
    671_568,
    "c4a0a80f0041ce4be81e2478faad22776d23edb98ae3f0d19bd37044820ecf9d",
    "Noto Sans Symbols 2 2.008"
  )
} satisfies Record<BundledStandardFontAssetId, BundledStandardFontAsset>;

/** Pinned, package-relative font assets. Only a selected face is loaded. */
export const BUNDLED_STANDARD_FONT_ASSETS: Readonly<
  Record<BundledStandardFontAssetId, Readonly<BundledStandardFontAsset>>
> = Object.freeze(ASSETS);

/**
 * Resolve a PDF font request to one deterministic bundled substitute.
 *
 * The exact Standard-14 names are honored first. Other nonembedded fonts use
 * descriptor/family/style metadata, making fallback stable across platforms.
 */
export function resolveBundledStandardFontAsset(
  request: Readonly<NativeMissingFontRequest>
): Readonly<BundledStandardFontAsset> {
  const name = normalizeFontName(request.normalizedBaseFont || request.baseFont);
  if (name === "symbol" || name.includes("symbolmt")) {
    return ASSETS["noto-sans-math"];
  }
  if (name === "zapfdingbats" || name.includes("dingbat")) {
    return ASSETS["noto-sans-symbols-2"];
  }

  const bold = request.style.weight >= 600 || /(?:bold|black|heavy|demi|semi)/.test(name);
  const italic = request.style.italic || request.descriptor.italicAngle !== 0 ||
    /(?:italic|oblique)/.test(name);
  const family = request.style.fixedPitch || /(?:courier|mono|typewriter)/.test(name)
    ? "mono"
    : request.style.serif || /(?:times|serif|roman|georgia)/.test(name)
      ? "serif"
      : "sans";
  const face = bold ? (italic ? "bold-italic" : "bold") : (italic ? "italic" : "regular");
  return ASSETS[`${family === "mono" ? "liberation-mono" : family === "serif" ? "liberation-serif" : "liberation-sans"}-${face}`];
}

/**
 * Create a lazy, deterministic resolver for the PDF Standard-14 family and
 * other nonembedded fonts. Completed face loads are cached per resolver.
 */
export function createBundledStandardFontResolver(
  options: CreateBundledStandardFontResolverOptions = {}
): NativeMissingFontResolver {
  const loadAsset = options.loadAsset ?? fetchBundledStandardFontAsset;
  const cache = new Map<BundledStandardFontAssetId, Uint8Array>();
  return async (request, signal) => {
    signal?.throwIfAborted();
    const assetValue = resolveBundledStandardFontAsset(request);
    let bytes = cache.get(assetValue.id);
    if (!bytes) {
      const loaded = await loadAsset(assetValue, signal);
      signal?.throwIfAborted();
      if (!(loaded instanceof Uint8Array)) {
        throw new TypeError(`Bundled font loader returned a non-Uint8Array for ${assetValue.id}.`);
      }
      if (loaded.byteLength !== assetValue.byteLength) {
        throw new RangeError(
          `Bundled font ${assetValue.id} has ${loaded.byteLength} bytes; expected ${assetValue.byteLength}.`
        );
      }
      bytes = loaded;
      cache.set(assetValue.id, bytes);
    }
    signal?.throwIfAborted();
    return {
      sfntBytes: bytes,
      identifier: `hepr:${assetValue.id}:${assetValue.sha256.slice(0, 16)}`
    };
  };
}

async function fetchBundledStandardFontAsset(
  assetValue: Readonly<BundledStandardFontAsset>,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (typeof fetch !== "function") {
    throw new Error(
      "The default bundled-font loader requires fetch(); use the Node subpath or provide loadAsset."
    );
  }
  const response = await fetch(assetValue.url, { signal });
  if (!response.ok) {
    throw new Error(
      `Could not load bundled font ${assetValue.id}: HTTP ${response.status} ${response.statusText}.`
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

function normalizeFontName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function asset(
  id: BundledStandardFontAssetId,
  url: URL,
  family: BundledStandardFontAsset["family"],
  weight: BundledStandardFontAsset["weight"],
  italic: boolean,
  byteLength: number,
  sha256: string,
  source: BundledStandardFontAsset["source"]
): BundledStandardFontAsset {
  return Object.freeze({ id, url, family, weight, italic, byteLength, sha256, source });
}
