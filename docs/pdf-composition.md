# PDF composition

`createPdfDocument` creates PDFs from blank pages, imported PDF pages, compiled scenes and ordered drawing operations. It requires no editor UI or renderer. The caller owns content selection, layout, asset preparation and delivery of the resulting PDF Blob.

## Pages and output

| Source | Operations | Behavior |
| --- | --- | --- |
| Blank page | `addPage({width, height})` | Create a page with dimensions in PDF points. |
| Original PDF | `importPdf(bytes, {password?})`, then `addSourcePage(source, index)` | Preserve native page artwork and geometry. Source page indexes start at zero. |
| Geometry without artwork | `addSourcePage(source, index, {background: false})` | Retain page boxes and rotation while omitting source content. |
| Compiled scene, including HEP | `importScene(scene)`, then `addSourcePage(source, index)` | Reconstruct PDF pages from the complete scene. |

Append pages in the desired order; one document can combine sources and page sizes. `source.pages` exposes displayed dimensions. `save()` returns a PDF Blob. Always call `dispose()` to release document resources. Metadata, abort signals, progress callbacks and diagnostics are supported by the document factory and applicable import/save operations.

```js
import { createPdfDocument } from "@soadzoor/hepr";

const document = await createPdfDocument({
  metadata: { title: "Illustrated report" },
  onDiagnostic: diagnostic => console.warn(diagnostic),
});
try {
  const page = document.addPage({ width: 600, height: 400 });
  page.drawPath([["M", 20, 20], ["L", 160, 20], ["L", 160, 100], ["Z"]], {
    fill: "#80bdcf", fillOpacity: .2, stroke: "#28657a", strokeWidth: 1.5,
  });
  page.drawTextBox({ x: 25, y: 30, width: 120, height: 40, text: "Caption", fontSize: 12,
    align: "center", verticalAlignment: "middle" });
  const pdfBlob = await document.save();
  // Download, store or upload pdfBlob here.
} finally {
  await document.dispose();
}
```

The factory is also exported from `@soadzoor/hepr/bundler` and `@soadzoor/hepr/node`. When running source modules in Node, provide `loadFontAsset: async url => new Uint8Array(await readFile(url))` for bundled fonts.

## Drawing and reusable resources

- `drawPath` accepts `['M', x, y]`, `['L', x, y]`, `['Q', cx, cy, x, y]`, `['C', c1x, c1y, c2x, c2y, x, y]` and `['Z']`. Curves remain vectors. Rectangle and ellipse helpers provide common shapes. Multiple subpaths with `fillRule: 'evenodd'` can form openings.
- Paint options include independent fill/stroke colors and opacity, stroke width, caps, joins, miter limit and dash pattern/phase. Omitted or null paint is absent; stroke width zero requests a PDF hairline.
- Vector icons use paths or `drawSvgPath`; SVG coordinates are Y down by default, with `svgYAxis: 'up'` available. Register PNG/JPEG bytes or raw RGBA pixels with `registerImage`, then reuse the image handle across `drawImage` placements. Scaling, rotation, reflection and opacity apply per placement.
- `document.fonts.register` accepts outline TTF/OTF bytes. Register separate regular/bold/italic faces as needed, or load bundled fonts. `drawText` uses a baseline and explicit newlines without automatic wrapping. `drawTextBox` adds wrapping and horizontal/vertical alignment. Rich runs support fonts, sizes, colors, backgrounds, opacity, underline and strikethrough. `measureText` uses the same shaping as output.
- Build measurements, callouts, captions, leader lines, arrows and badges from paths and text. Compute values, units, arrowheads and collision placement in the caller. `addLink` creates an independent invisible hotspot targeting a URL or an output page; visible link artwork remains caller-defined.

New drawing operations become ordinary PDF artwork rather than editor annotations. Call order controls paint order: for example, draw a translucent highlight, its icon, then a caption. Choose any ordering appropriate to the document.

## Coordinates, grouping and viewports

Coordinates are PDF points from the displayed lower-left of the page's initial visible crop. Imported rotation, crop origin and `/UserUnit` are accounted for; do not apply them a second time. Rectangle, ellipse and image `x`/`y` identify their lower-left bounds. Transforms are six-number affine matrices.

Use balanced `saveState()`/`restoreState()` calls around `transform`, `clipPath` and `clipRectangle` to place or clip groups. To map an external axis-aligned coordinate system, apply its scale and origin offset once to the group rather than independently to every primitive.

`setViewport({x, y, width, height})` updates Crop/Trim/Bleed/Art boxes while retaining MediaBox. Drawing coordinates remain fixed. PDF readers intersect CropBox with MediaBox: an outlying viewport cannot create a blank margin beyond MediaBox. For example, CropBox `[-20, -15, 420, 345]` with MediaBox `[0, 0, 500, 400]` displays an effective 420 × 345 points.

## Source fidelity and diagnostics

Import original PDF bytes to retain native page artwork without reconstructing it through the scene parser. Source annotation appearances are baked into the page below subsequent artwork. Supported source links remain links; unsupported or unresolved destinations produce diagnostics. Imported documents are composition sources, not editable copies of every original document-level feature.

HEP carries a complete scene rather than the original PDF bytes. `importScene` reconstructs from that scene and cannot promise identical original structures, fonts, annotations or unsupported features. Retain original bytes when preservation matters. Inspect diagnostics for approximations and reduced fidelity; adding overlays does not require rasterizing an entire page.

## Runnable example and offline comparison

[`examples/pdf-composition.mjs`](../examples/pdf-composition.mjs) exports `createPdfCompositionExample` and builds synthetic source pages, vector/SVG/image icons, shapes, measurement labels, rich captions, links, a polygon opening, omitted source artwork and a viewport crop.

After building the package:

```sh
node examples/pdf-composition.mjs /tmp/hepr-pdf-composition.pdf
```

For optional offline comparison with an independently installed pdf.js reference:

```sh
HEPR_PDFJS_MODULE=/path/to/pdfjs-dist/legacy/build/pdf.mjs \
  node scripts/check-pdf-composition-visuals.mjs /tmp/hepr-pdf-composition-validation
```

The checker writes source/output PDFs, individual pdf.js and HEPR Canvas2D snapshots, side-by-side images and a JSON report. These checks cover offline parsing and Canvas2D output. Browser asset loading, GPU rendering and interactive integration require separate manual verification.
