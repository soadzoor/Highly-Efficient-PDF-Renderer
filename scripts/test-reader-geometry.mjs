import assert from "node:assert/strict";
import {
  computeReaderPageRects, readerContentMetrics, readerViewFromScroll, readerScrollFromView,
  readerPageAtPoint, readerCaptureAnchor, readerRestoreAnchor, readerFitZoom, readerZoomAt
} from "../src/readerGeometry.ts";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const pages = [{ width: 600, height: 800 }, { width: 1200, height: 500 }, { width: 400, height: 900 }];
const rects = computeReaderPageRects(pages);
assert.deepEqual([...rects], [-300, -800, 300, 0, -600, -1316, 600, -816, -200, -2232, 200, -1332]);
assert.equal(computeReaderPageRects([]).length, 0);
assert.deepEqual([...computeReaderPageRects([{ width: NaN, height: Infinity }])], [-.5, -1, .5, 0]);

// Scroll values and camera centers round-trip at different CSS zooms; DPR is a host adapter concern.
for (const zoom of [.25, 1, 4, 32]) {
  const metrics = readerContentMetrics(rects, zoom, 900, 700);
  for (const [left, top] of [[0, 0], [(metrics.surfaceWidth - 900) / 2, (metrics.surfaceHeight - 700) / 2],
    [metrics.surfaceWidth - 900, metrics.surfaceHeight - 700]]) {
    const view = readerViewFromScroll(metrics, left, top), scroll = readerScrollFromView(metrics, view);
    close(scroll.left, left); close(scroll.top, top);
  }
  const first = readerViewFromScroll(metrics, 0, 0);
  close((metrics.maxY - first.centerY) * zoom, 350 - metrics.originY);
  const last = readerViewFromScroll(metrics, 0, metrics.surfaceHeight - 700);
  close((last.centerY - rects[9]) * zoom, 350 - metrics.originY);
}

// Fit modes use the selected page, preserving actual differences in page size.
close(readerFitZoom(rects, 0, 900, 700, "width"), 852 / 600);
close(readerFitZoom(rects, 0, 900, 700, "page"), 652 / 800);
close(readerFitZoom(rects, 1, 900, 700, "width"), 852 / 1200);

// Document zoom keeps the scene point under an arbitrary pointer stationary.
const before = { centerX: 150, centerY: -1100, zoom: 2, width: 900, height: 700 };
for (const [x, y] of [[0, 0], [450, 350], [712, 591]]) {
  const after = readerZoomAt(before, 5, x, y);
  close(before.centerX + (x - 450) / before.zoom, after.centerX + (x - 450) / after.zoom);
  close(before.centerY - (y - 350) / before.zoom, after.centerY - (y - 350) / after.zoom);
}

assert.equal(readerPageAtPoint(rects, 0, -200), 0);
assert.equal(readerPageAtPoint(rects, 0, -1100), 1);
assert.equal(readerPageAtPoint(rects, 0, -2000), 2);
assert.equal(readerPageAtPoint(rects, 0, -808), 0, "a gap tie chooses the earlier page");

// A streaming replacement, sidebar resize, or same-document reload retains a page-relative anchor.
const anchor = readerCaptureAnchor(rects, before);
assert.equal(anchor.pageIndex, 1);
const changed = computeReaderPageRects([{ width: 600, height: 1000 }, ...pages.slice(1)]);
const restored = readerRestoreAnchor(changed, anchor, 3);
close(restored.centerX, before.centerX);
close(restored.centerY, before.centerY - 200);
close(restored.zoom, 3);
const narrow = readerContentMetrics(rects, 2, 720, 700);
const narrowView = readerViewFromScroll(narrow, ...Object.values(readerScrollFromView(narrow, before)));
close(narrowView.centerX, before.centerX); close(narrowView.centerY, before.centerY);

console.log("Reader geometry checks passed.");
