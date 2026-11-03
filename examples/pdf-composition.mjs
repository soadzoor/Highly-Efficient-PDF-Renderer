import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * General PDF composition gallery with reusable pages, vector paths, text,
 * images, clipping and links. Callers control the stacking order.
 * Passing the factory lets the offline checker exercise the local source API.
 */
export async function createPdfCompositionExample(createPdfDocument, options = {}) {
  const diagnostics = [], loadFontAsset = options.loadFontAsset ?? (async url => new Uint8Array(await readFile(url)));
  const common = { loadFontAsset, onDiagnostic: value => diagnostics.push(value), signal: options.signal };
  const source = await createPdfDocument({ ...common, metadata: { title: "Reusable PDF pages" } });
  let sourceBlob;
  try {
    for (const [width, height] of [[700, 520], [500, 400]]) {
      const page = source.addPage({ width, height });
      page.drawRectangle({ x: 0, y: 0, width, height, fill: "#f7f9fc" });
      for (let x = 20; x < width; x += 40) page.drawPath([["M", x, 0], ["L", x, height]], { stroke: "#dfe6ef", strokeWidth: .5 });
      for (let y = 20; y < height; y += 40) page.drawPath([["M", 0, y], ["L", width, y]], { stroke: "#dfe6ef", strokeWidth: .5 });
      page.drawRectangle({ x: 22, y: 22, width: width - 44, height: height - 44, stroke: "#9baac0", strokeWidth: 1, fill: null });
      page.drawText("SOURCE BACKGROUND", { x: 34, y: 30, fontSize: 11, color: "#64748b" });
    }
    sourceBlob = await source.save();
  } finally { await source.dispose(); }

  const doc = await createPdfDocument({ ...common, metadata: { title: "PDF composition example", author: "Example application",
    creator: "Example application" } });
  try {
    const imported = await doc.importPdf(new Uint8Array(await sourceBlob.arrayBuffer()));
    const page = doc.addSourcePage(imported, 0);
    const hidden = doc.addSourcePage(imported, 1, { background: false });
    const regular = await doc.fonts.loadBundled("Liberation Sans");
    const bold = await doc.fonts.loadBundled("Liberation Sans", { fontWeight: "bold" });
    const italic = await doc.fonts.loadBundled("Liberation Sans", { fontStyle: "italic" });
    const icon = await doc.registerImage(syntheticSnapshot());
    const label = (text, x, y, extra = {}) => page.drawText(text, { x, y, fontSize: 9, fontId: regular.id, color: "#334155", ...extra });
    const red = { stroke: "#c9404e", strokeWidth: 1.8, lineCap: "round", lineJoin: "round" };

    // Curves and simple geometry share the same vector path API.
    page.drawText("PDF composition example", { x: 28, y: 486, fontSize: 21, fontId: bold.id, color: "#18324b" });
    label("A gallery of synthetic PDF paths, text, images, transforms and links.", 28, 470);
    page.drawSvgPath("M 30 412 C 17 412 17 430 29 431 C 26 444 43 451 51 440 C 61 452 80 449 81 436 C 97 435 98 416 83 413 Z", { ...red, svgYAxis: "up" });
    label("Curved outline", 32, 400);
    arrow(page, [121, 419], [188, 445], red);
    label("Arrow", 125, 400);
    arrow(page, [220, 419], [284, 445], red, true);
    label("Two-way arrow", 215, 400);
    page.drawPath([["M", 315, 443], ["L", 382, 418]], red);
    page.drawPath([["M", 315, 419], ["L", 382, 443]], { ...red, dashArray: [5, 3] });
    label("Line / dashed line", 312, 400);
    page.drawPath([["M", 420, 424], ["C", 435, 454, 448, 410, 462, 431], ["Q", 475, 451, 485, 426]], red);
    page.drawPath([["M", 419, 421], ["L", 485, 439]], { stroke: "#ffcf33", strokeWidth: 12, strokeOpacity: .3, lineCap: "round" });
    label("Curve / translucent stroke", 410, 400);
    page.drawRectangle({ x: 520, y: 416, width: 48, height: 28, fill: "#e68c9d", fillOpacity: .22, ...red });
    page.drawEllipse({ x: 590, y: 415, width: 55, height: 29, fill: null, ...red });
    label("Rectangle / ellipse", 522, 400);
    page.drawPath([["M", 33, 339], ["L", 58, 378], ["L", 83, 339], ["Z"]], { ...red, fill: "#e68c9d", fillOpacity: .22 });
    page.drawPath([["M", 106, 343], ["L", 135, 374], ["M", 106, 374], ["L", 135, 343]], red);
    label("Triangle / cross", 30, 325);
    page.drawPath([["M", 171, 359], ["L", 252, 359], ["M", 171, 351], ["L", 171, 367], ["M", 252, 351], ["L", 252, 367]], red);
    label("8.10 m", 195, 367); label("Line with end ticks", 171, 325);
    page.drawPath([["M", 284, 343], ["L", 306, 375], ["L", 344, 356], ["L", 371, 376]], red);
    label("12.5 m", 307, 337); label("Polyline", 283, 325);
    page.drawRectangle({ x: 408, y: 342, width: 64, height: 34, fill: "#bd6076", fillOpacity: .2, ...red });
    label("2.18 m²", 420, 354); label("Filled rectangle", 405, 325);
    page.drawPath([["M", 509, 343], ["L", 520, 375], ["L", 562, 370], ["L", 576, 350], ["L", 548, 338], ["Z"]], { ...red, fill: "#bd6076", fillOpacity: .2 });
    label("3.42 m²", 524, 352); label("Filled polygon", 510, 325);
    page.drawEllipse({ x: 612, y: 345, width: 27, height: 27, fill: "#ffffff", ...red });
    label("360°", 615, 356, { fontSize: 8 }); label("SVG badge", 605, 325);
    page.drawRectangle({ x: 29, y: 269, width: 150, height: 39, fill: "#fff4db", stroke: "#d39b38", strokeWidth: 1 });
    page.drawTextBox({ x: 33, y: 273, width: 142, height: 31, text: "Text box\nwith two lines", fontSize: 10,
      fontId: regular.id, color: "#644619", align: "center", verticalAlignment: "middle" });
    page.drawRectangle({ x: 211, y: 269, width: 110, height: 39, fill: "#ffffff", ...red });
    label("Elbow callout", 224, 286);
    page.drawPath([["M", 321, 286], ["L", 348, 286], ["L", 367, 267]], red);
    arrow(page, [348, 286], [367, 267], red);

    // Saved graphics states make transforms and clipping reusable.
    page.saveState();
    page.transform([.966, .259, -.259, .966, 424, 260]);
    page.clipRectangle({ x: 0, y: 0, width: 106, height: 28 });
    page.drawRectangle({ x: 0, y: 0, width: 106, height: 28, fill: "#e1effb" });
    page.drawText("Rotated / clipped text", { x: 5, y: 10, fontSize: 10, fontId: italic.id, color: "#175985", underline: true });
    page.restoreState();

    // Draw translucent shapes before the artwork they surround.
    page.drawEllipse({ x: 61, y: 111, width: 108, height: 108, fill: "#63c989", fillOpacity: .22 });
    page.drawEllipse({ x: 262, y: 112, width: 105, height: 105, fill: "#f2bc38", fillOpacity: .2 });
    page.drawPath([["M", 114, 165], ["L", 315, 165]], { stroke: "#41759b", strokeWidth: 2 });
    arrow(page, [204, 165], [280, 165], { stroke: "#41759b", strokeWidth: 2 });
    label("Connector with arrowhead", 153, 221);

    // Labels can combine backgrounds, styles and dashed connectors.
    page.drawPath([["M", 115, 165], ["L", 97, 89]], { stroke: "#64748b", strokeWidth: 1, dashArray: [3, 3] });
    page.drawRectangle({ x: 41, y: 62, width: 128, height: 24, fill: "#d9f2e5", fillOpacity: .85 });
    page.drawTextBox({ x: 45, y: 65, width: 120, height: 18, text: "Icon A", fontSize: 11, fontId: bold.id,
      color: "#205b3a", align: "center", verticalAlignment: "middle" });
    page.drawRectangle({ x: 41, y: 45, width: 128, height: 17, fill: "#ffffff", fillOpacity: .75 });
    page.drawTextBox({ x: 45, y: 46, width: 120, height: 15, text: "Styled label", fontSize: 9, fontId: italic.id,
      color: "#506174", align: "center", verticalAlignment: "middle" });

    // Reuse one raster image; the same API accepts PNG and JPEG bytes.
    page.drawImage(icon, { x: 81, y: 131, width: 68, height: 68 });
    page.drawImage(icon, { x: 282, y: 131, width: 68, height: 68, opacity: .9 });
    // Later paths and text can add badges above existing images.
    page.drawEllipse({ x: 138, y: 183, width: 16, height: 16, fill: "#3aa56b", stroke: "#ffffff", strokeWidth: 1 });
    page.drawEllipse({ x: 76, y: 183, width: 22, height: 22, fill: "#18324b" });
    page.drawText("3", { x: 83, y: 190, fontSize: 11, fontId: bold.id, color: "#ffffff" });
    page.drawEllipse({ x: 334, y: 183, width: 23, height: 23, fill: "#ffffff", stroke: "#64748b", strokeWidth: 1 });
    page.drawSvgPath("M 338 192 L 342 188 Q 345 185 348 188 L 350 190 M 343 195 L 347 199 Q 350 202 353 199 L 354 198 M 342 192 L 350 196", {
      svgYAxis: "up", stroke: "#41759b", strokeWidth: 1.5, lineCap: "round" });
    page.addLink({ x: 334, y: 183, width: 23, height: 23 }, { type: "url", url: "https://example.com/composition" });
    page.addLink({ x: 282, y: 131, width: 68, height: 68 }, { type: "page", pageIndex: hidden.pageIndex, x: 80, y: 110 });

    // An even-odd compound path leaves a hole in its translucent fill.
    page.drawPath([["M", 390, 71], ["L", 390, 213], ["L", 645, 213], ["L", 645, 71], ["Z"],
      ["M", 446, 112], ["L", 580, 112], ["L", 580, 170], ["L", 446, 170], ["Z"]], {
      fill: "#5d8ed1", fillOpacity: .15, fillRule: "evenodd", stroke: "#426ea5", strokeWidth: 1.5, dashArray: [7, 3] });
    page.drawTextBox({ x: 420, y: 180, width: 190, height: 23, text: "Compound path with a hole", fontSize: 11, fontId: bold.id,
      color: "#335681", align: "center", verticalAlignment: "middle" });
    const measured = await doc.measureText("Measured text", { fontId: regular.id, fontSize: 10 });
    label("Measured text", 440, 89);
    page.drawPath([["M", 440, 85], ["L", 440 + measured.width, 85]], { stroke: "#426ea5", strokeWidth: .6 });

    hidden.drawText("Imported page with a custom viewport", { x: 30, y: 290, fontSize: 17, fontId: bold.id, color: "#18324b" });
    hidden.drawImage(icon, { x: 90, y: 140, width: 80, height: 80 });
    hidden.drawPath([["M", 60, 110], ["L", 220, 110], ["L", 220, 250], ["L", 60, 250], ["Z"]], {
      stroke: "#3aa56b", strokeWidth: 2, fill: "#63c989", fillOpacity: .12 });
    hidden.drawTextBox({ x: 240, y: 140, width: 140, height: 82, text: "Bold italic underlined text", fontSize: 13,
      runs: [{ text: "Bold ", fontId: bold.id }, { text: "italic ", fontId: italic.id }, { text: "underlined text", underline: true }],
      color: "#284f74", align: "left", verticalAlignment: "middle" });
    hidden.setViewport({ x: -20, y: -15, width: 440, height: 360 });
    return { blob: await doc.save(), sourceBlob, diagnostics, measured,
      description: "General PDF composition gallery with two pages, preserved source content, an omitted source background, custom viewport, vector geometry, styled text, shared images and links." };
  } finally { await doc.dispose(); }
}

function arrow(page, start, end, style, bidirectional = false) {
  const head = (tip, other) => {
    const angle = Math.atan2(tip[1] - other[1], tip[0] - other[0]), size = 7;
    return [["M", tip[0] - size * Math.cos(angle - .5), tip[1] - size * Math.sin(angle - .5)], ["L", ...tip],
      ["L", tip[0] - size * Math.cos(angle + .5), tip[1] - size * Math.sin(angle + .5)]];
  };
  page.drawPath([["M", ...start], ["L", ...end], ...head(end, start), ...(bidirectional ? head(start, end) : [])], style);
}

function syntheticSnapshot() {
  const width = 64, height = 64, data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = x >= 9 && x <= 54 && y >= 9 && y <= 54, screen = x >= 16 && x <= 47 && y >= 15 && y <= 40;
    const index = (y * width + x) * 4;
    if (inside) data.set(screen ? [120, 191, 224, 255] : [42, 67, 91, 255], index);
    if (x >= 25 && x <= 38 && y >= 45 && y <= 49) data.set([222, 233, 241, 255], index);
  }
  return { width, height, data };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { createPdfDocument } = await import("@soadzoor/hepr/node");
  const output = resolve(process.argv[2] ?? "/tmp/hepr-pdf-composition.pdf");
  await mkdir(resolve(output, ".."), { recursive: true });
  const result = await createPdfCompositionExample(createPdfDocument);
  await writeFile(output, new Uint8Array(await result.blob.arrayBuffer()));
  console.log(JSON.stringify({ output, bytes: result.blob.size, diagnostics: result.diagnostics }, null, 2));
}
