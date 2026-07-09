import type { Bounds, PageTextIndex, VectorScene } from "./pdfVectorExtractor";
import {
  computeCharQuad,
  TEXT_BOUNDS_HORIZONTAL_PADDING_FACTOR,
  TEXT_BOUNDS_VERTICAL_PADDING_FACTOR
} from "./sceneTextGeometry";
import { createSelectionOverlay, type SelectionOverlay } from "./textSelectionOverlay";

export interface TextSelectionPoint {
  x: number;
  y: number;
}

/**
 * Host adapter: how the selection controller talks to whichever renderer
 * drives the canvas. Native HEPR renderers satisfy it via `RendererApi`
 * (`clientToScenePoint`, `sceneToClientPoint`, `setTextSelectionHighlights`);
 * three.js apps via the equivalent `HeprThreePdfObject` methods.
 */
export interface TextSelectionAdapter {
  getScene(): VectorScene | null;

  /** Client (CSS px) -> PDF scene space, or null when the point misses the page. */
  clientToScenePoint(clientX: number, clientY: number): TextSelectionPoint | null;

  /** PDF scene space -> client (CSS px); used to place touch handles and the copy popup. */
  sceneToClientPoint(sceneX: number, sceneY: number): TextSelectionPoint | null;

  /** Scene-space rects (4 floats each) drawn with the blue selection style; null clears. */
  setSelectionHighlights(rects: Float32Array | null): void;

  /**
   * Called with `false` when a selection gesture takes over an in-flight
   * pointer (touch long-press) and `true` when it ends. Native hosts should
   * call `canvasInteractionController.cancelActiveGesture()` on `false`;
   * three.js hosts typically set `controls.enabled = value`.
   */
  setCameraInteractionEnabled?(enabled: boolean): void;
}

/** Caret between characters of a page's indexed text: offset in [0, text.length]. */
export interface TextSelectionCaret {
  pageIndex: number;
  offset: number;
}

/**
 * Normalized selection: `start` precedes `end` in visual reading order
 * (pages in index order, lines top to bottom, chars left to right). Note
 * that visual order can differ from raw char order within a page — e.g.
 * printed page headers/footers are often emitted after the body text.
 */
export interface TextSelectionRange {
  start: TextSelectionCaret;
  end: TextSelectionCaret;
}

export interface TextSelectionOptions {
  /** Canvas re-resolved per event so backend switches that swap the element keep working. */
  getCanvas(): HTMLCanvasElement | null;
  adapter: TextSelectionAdapter;
  /** Feature toggle. Defaults to true; also switchable via enable()/disable(). */
  enabled?: boolean;
  /** Touch long-press duration before selection starts. Defaults to 500 ms. */
  longPressMs?: number;
  /** Finger movement allowed during the long-press. Defaults to 8 px. */
  longPressMoveTolerancePx?: number;
  onSelectionChange?(range: TextSelectionRange | null, selectedText: string): void;
  /** Called after a successful clipboard write. */
  onCopy?(text: string): void;
}

export interface TextSelectionController {
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  clearSelection(): void;
  getSelectionRange(): TextSelectionRange | null;
  /** Page slices of the indexed text, joined with "\n" across pages. */
  getSelectedText(): string;
  copySelection(): Promise<boolean>;
  /** Re-push highlight rects through the adapter (e.g. after a backend swap). */
  refreshHighlights(): void;
  /** Reposition DOM handles/copy popup; call once per rendered frame. */
  updateOverlay(): void;
  /** True while a selection or handle drag owns a pointer. */
  isGestureActive(): boolean;
  dispose(): void;
}

const DEFAULT_LONG_PRESS_MS = 500;
const DEFAULT_LONG_PRESS_MOVE_TOLERANCE_PX = 8;
/** Double-click detection window (pointerdown `detail` is unreliable cross-browser). */
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_DISTANCE_PX = 6;
/** Hover/hit slack around line boxes, relative to the line height. */
const LINE_HIT_INFLATE_FACTOR = 0.15;
/** Chars join a line run when quads vertically overlap by at least this share. */
const LINE_VERTICAL_OVERLAP_FACTOR = 0.5;
/**
 * Chars join a line run when their baselines agree within this share of the
 * smaller ink height. Same-row glyphs share the pen baseline exactly, so this
 * only needs to absorb float jitter; it must stay well below the row pitch so
 * consecutive rows never merge.
 */
const LINE_BASELINE_TOLERANCE_FACTOR = 0.5;

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

interface PageLineRun {
  startChar: number;
  /** Exclusive; trailing separators are excluded. */
  endChar: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PageTextLayout {
  /** charCount * 4 scene-space AABBs; chars without geometry have minX = Infinity. */
  quads: Float32Array;
  /** Line runs in char (stream) order; each spans a contiguous char range. */
  lines: PageLineRun[];
  /**
   * Indices into `lines`, sorted visually (top to bottom, then left to
   * right). Char order can differ from visual order — browser-print PDFs
   * often emit the body first and the page header/footer afterwards — and
   * selection must follow what the user sees.
   */
  visualOrder: number[];
  /** Per `lines` index: its rank in `visualOrder`. */
  visualRank: number[];
  bounds: Bounds | null;
}

interface CharHit {
  pageIndex: number;
  charIndex: number;
}

type SelectionGestureState = "idle" | "mouseSelecting" | "touchPending" | "touchSelecting" | "handleDragging";

/**
 * Index of the line whose char range holds `offset`; offsets falling in the
 * separator gap between two runs resolve to the nearer one. Lines are char-
 * contiguous and ordered by startChar, so this is a binary search.
 */
function lineIndexForOffset(layout: PageTextLayout, offset: number): number {
  const lines = layout.lines;
  if (lines.length === 0) {
    return -1;
  }
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lines[mid].startChar <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  if (offset > lines[low].endChar && low + 1 < lines.length) {
    const distanceToPrevious = offset - lines[low].endChar;
    const distanceToNext = lines[low + 1].startChar - offset;
    if (distanceToNext < distanceToPrevious) {
      return low + 1;
    }
  }
  return low;
}

/**
 * Baseline y of an instanced char: the pen origin (textInstanceB e,f) sits on
 * the baseline, so every glyph of a visual row shares it exactly — a far more
 * reliable row key than ink-box overlap, which orphans small punctuation
 * (commas hang below neighbors without descenders, quotes float above
 * x-height-only neighbors). Returns null for fallback-quad chars.
 */
function charBaselineY(scene: VectorScene, page: PageTextIndex, charIndex: number): number | null {
  const ref = page.charInstance[charIndex];
  if (ref === undefined || ref < 0) {
    return null;
  }
  const offset = ref * 4 + 1;
  return offset < scene.textInstanceB.length ? scene.textInstanceB[offset] : null;
}

function buildPageTextLayout(scene: VectorScene, page: PageTextIndex): PageTextLayout {
  const charCount = page.charInstance.length;
  const quads = new Float32Array(charCount * 4);
  const lines: PageLineRun[] = [];
  let bounds: Bounds | null = null;
  let currentLine: PageLineRun | null = null;
  let currentBaselineY: number | null = null;
  let currentMaxCharHeight = 0;

  for (let i = 0; i < charCount; i += 1) {
    if (!computeCharQuad(scene, page, i, quads, i * 4)) {
      quads[i * 4] = Number.POSITIVE_INFINITY;
      continue;
    }
    const minX = quads[i * 4];
    const minY = quads[i * 4 + 1];
    const maxX = quads[i * 4 + 2];
    const maxY = quads[i * 4 + 3];
    const charHeight = maxY - minY;
    const baselineY = charBaselineY(scene, page, i);

    if (bounds === null) {
      bounds = { minX, minY, maxX, maxY };
    } else {
      bounds.minX = Math.min(bounds.minX, minX);
      bounds.minY = Math.min(bounds.minY, minY);
      bounds.maxX = Math.max(bounds.maxX, maxX);
      bounds.maxY = Math.max(bounds.maxY, maxY);
    }

    if (currentLine !== null) {
      let joinsLine: boolean;
      if (baselineY !== null && currentBaselineY !== null) {
        const tolerance = Math.min(charHeight, currentMaxCharHeight) * LINE_BASELINE_TOLERANCE_FACTOR;
        joinsLine = Math.abs(baselineY - currentBaselineY) <= tolerance;
      } else {
        const overlap = Math.min(currentLine.maxY, maxY) - Math.max(currentLine.minY, minY);
        const smallerHeight = Math.min(currentLine.maxY - currentLine.minY, charHeight);
        joinsLine = overlap >= smallerHeight * LINE_VERTICAL_OVERLAP_FACTOR;
      }
      if (joinsLine) {
        currentLine.endChar = i + 1;
        currentLine.minX = Math.min(currentLine.minX, minX);
        currentLine.minY = Math.min(currentLine.minY, minY);
        currentLine.maxX = Math.max(currentLine.maxX, maxX);
        currentLine.maxY = Math.max(currentLine.maxY, maxY);
        currentMaxCharHeight = Math.max(currentMaxCharHeight, charHeight);
        currentBaselineY ??= baselineY;
        continue;
      }
      lines.push(currentLine);
    }
    currentLine = { startChar: i, endChar: i + 1, minX, minY, maxX, maxY };
    currentBaselineY = baselineY;
    currentMaxCharHeight = charHeight;
  }
  if (currentLine !== null) {
    lines.push(currentLine);
  }

  const visualOrder = lines.map((_, index) => index).sort((a, b) => {
    const centerA = (lines[a].minY + lines[a].maxY) * 0.5;
    const centerB = (lines[b].minY + lines[b].maxY) * 0.5;
    // Scene space is Y-up: larger center y = visually higher.
    return centerB - centerA || lines[a].minX - lines[b].minX;
  });
  const visualRank = new Array<number>(lines.length);
  for (let rank = 0; rank < visualOrder.length; rank += 1) {
    visualRank[visualOrder[rank]] = rank;
  }

  return { quads, lines, visualOrder, visualRank, bounds };
}

export function createTextSelectionController(options: TextSelectionOptions): TextSelectionController {
  const adapter = options.adapter;
  const longPressMs = options.longPressMs ?? DEFAULT_LONG_PRESS_MS;
  const longPressTolerancePx = options.longPressMoveTolerancePx ?? DEFAULT_LONG_PRESS_MOVE_TOLERANCE_PX;

  let enabled = options.enabled ?? true;
  let disposed = false;
  let state: SelectionGestureState = "idle";
  let activePointerId: number | null = null;

  let lastScene: VectorScene | null = null;
  const pageLayouts = new Map<number, PageTextLayout>();

  /** Selection model: normalized range plus the raw anchor for drag direction. */
  let selectionRange: TextSelectionRange | null = null;
  let anchorCaret: TextSelectionCaret | null = null;
  /** Word range at the gesture origin for word-granularity extension. */
  let wordAnchor: TextSelectionRange | null = null;
  let wordGranularity = false;
  let selectionRects: Float32Array | null = null;
  let selectionIsTouch = false;
  let handleDragWhich: "start" | "end" | null = null;

  let cursorCanvas: HTMLCanvasElement | null = null;
  let cursorApplied = false;

  let lastClickTime = 0;
  let lastClickX = 0;
  let lastClickY = 0;

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchLatestX = 0;
  let touchLatestY = 0;
  let touchMoved = false;

  const overlay: SelectionOverlay = createSelectionOverlay({
    onHandleDragStart(which: "start" | "end"): void {
      if (!enabled || !selectionRange) {
        return;
      }
      state = "handleDragging";
      handleDragWhich = which;
      overlay.hideCopyButton();
    },
    onHandleDragMove(_which: "start" | "end", clientX: number, clientY: number): void {
      if (state !== "handleDragging" || !selectionRange || handleDragWhich === null) {
        return;
      }
      const scenePoint = adapter.clientToScenePoint(clientX, clientY);
      if (!scenePoint) {
        return;
      }
      const caret = nearestCaret(scenePoint.x, scenePoint.y);
      if (!caret) {
        return;
      }
      let start = handleDragWhich === "start" ? caret : selectionRange.start;
      let end = handleDragWhich === "end" ? caret : selectionRange.end;
      if (compareCaretsVisual(start, end) > 0) {
        // Handles crossed: swap roles like native selection.
        const swapped = start;
        start = end;
        end = swapped;
        handleDragWhich = handleDragWhich === "start" ? "end" : "start";
      }
      setSelection({ start, end });
      updateOverlay();
    },
    onHandleDragEnd(): void {
      if (state !== "handleDragging") {
        return;
      }
      state = "idle";
      handleDragWhich = null;
      updateOverlay();
    },
    onCopyClick(): void {
      void copySelection().then((copied) => {
        if (copied) {
          overlay.flashCopied();
        }
      });
    },
    onContextMenuCopy(): void {
      void copySelection();
    }
  });

  function getSceneChecked(): VectorScene | null {
    const scene = adapter.getScene();
    if (scene !== lastScene) {
      lastScene = scene;
      pageLayouts.clear();
      resetSelection(false);
    }
    return scene;
  }

  function getPageLayout(scene: VectorScene, pageIndex: number): PageTextLayout | null {
    const page = scene.textIndex?.pages[pageIndex];
    if (!page || page.text.length === 0) {
      return null;
    }
    let layout = pageLayouts.get(pageIndex);
    if (!layout) {
      layout = buildPageTextLayout(scene, page);
      pageLayouts.set(pageIndex, layout);
    }
    return layout;
  }

  function pageCount(scene: VectorScene): number {
    return scene.textIndex?.pages.length ?? 0;
  }

  /** Exact hit: is this scene point on a text line box (for cursor + press gating)? */
  function hitChar(sceneX: number, sceneY: number): CharHit | null {
    const scene = getSceneChecked();
    if (!scene?.textIndex) {
      return null;
    }
    const pages = pageCount(scene);
    for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
      const rectOffset = pageIndex * 4;
      if (rectOffset + 3 < scene.pageRects.length) {
        if (
          sceneX < scene.pageRects[rectOffset] ||
          sceneY < scene.pageRects[rectOffset + 1] ||
          sceneX > scene.pageRects[rectOffset + 2] ||
          sceneY > scene.pageRects[rectOffset + 3]
        ) {
          continue;
        }
      }
      const layout = getPageLayout(scene, pageIndex);
      if (!layout?.bounds) {
        continue;
      }
      if (
        sceneX < layout.bounds.minX ||
        sceneY < layout.bounds.minY ||
        sceneX > layout.bounds.maxX ||
        sceneY > layout.bounds.maxY
      ) {
        continue;
      }
      for (const line of layout.lines) {
        const inflate = (line.maxY - line.minY) * LINE_HIT_INFLATE_FACTOR;
        if (
          sceneX < line.minX - inflate ||
          sceneX > line.maxX + inflate ||
          sceneY < line.minY - inflate ||
          sceneY > line.maxY + inflate
        ) {
          continue;
        }
        const charIndex = nearestCharInLine(layout, line, sceneX);
        if (charIndex >= 0) {
          return { pageIndex, charIndex };
        }
      }
    }
    return null;
  }

  function nearestCharInLine(layout: PageTextLayout, line: PageLineRun, sceneX: number): number {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = line.startChar; i < line.endChar; i += 1) {
      const minX = layout.quads[i * 4];
      if (!Number.isFinite(minX)) {
        continue;
      }
      const maxX = layout.quads[i * 4 + 2];
      const distance = sceneX < minX ? minX - sceneX : sceneX > maxX ? sceneX - maxX : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /** Clamped caret for drags: nearest page -> nearest line -> insertion offset by quad midpoints. */
  function nearestCaret(sceneX: number, sceneY: number): TextSelectionCaret | null {
    const scene = getSceneChecked();
    if (!scene?.textIndex) {
      return null;
    }
    const pages = pageCount(scene);
    let bestPage = -1;
    let bestPageDistance = Number.POSITIVE_INFINITY;
    for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
      const rectOffset = pageIndex * 4;
      if (rectOffset + 3 >= scene.pageRects.length) {
        continue;
      }
      const dx = Math.max(scene.pageRects[rectOffset] - sceneX, 0, sceneX - scene.pageRects[rectOffset + 2]);
      const dy = Math.max(scene.pageRects[rectOffset + 1] - sceneY, 0, sceneY - scene.pageRects[rectOffset + 3]);
      const distance = dx * dx + dy * dy;
      if (distance < bestPageDistance) {
        bestPageDistance = distance;
        bestPage = pageIndex;
      }
    }
    if (bestPage < 0) {
      return null;
    }

    // Prefer a page that actually has text: fall back to scanning all pages
    // when the nearest page rect has none.
    let layout = getPageLayout(scene, bestPage);
    if (!layout || layout.lines.length === 0) {
      layout = null;
      let bestLayoutDistance = Number.POSITIVE_INFINITY;
      for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
        const candidate = getPageLayout(scene, pageIndex);
        if (!candidate?.bounds || candidate.lines.length === 0) {
          continue;
        }
        const dx = Math.max(candidate.bounds.minX - sceneX, 0, sceneX - candidate.bounds.maxX);
        const dy = Math.max(candidate.bounds.minY - sceneY, 0, sceneY - candidate.bounds.maxY);
        const distance = dx * dx + dy * dy;
        if (distance < bestLayoutDistance) {
          bestLayoutDistance = distance;
          layout = candidate;
          bestPage = pageIndex;
        }
      }
      if (!layout) {
        return null;
      }
    }

    // Pick the line by vertical distance to its box, breaking ties (e.g. the
    // point sitting inside several overlapping row boxes) by distance to the
    // line's vertical center, then by horizontal distance — Chrome-like.
    let bestLine: PageLineRun | null = null;
    let bestOutside = Number.POSITIVE_INFINITY;
    let bestCenter = Number.POSITIVE_INFINITY;
    let bestHorizontal = Number.POSITIVE_INFINITY;
    for (const line of layout.lines) {
      const outside = sceneY < line.minY ? line.minY - sceneY : sceneY > line.maxY ? sceneY - line.maxY : 0;
      if (outside > bestOutside) {
        continue;
      }
      const center = Math.abs(sceneY - (line.minY + line.maxY) * 0.5);
      const horizontal = sceneX < line.minX ? line.minX - sceneX : sceneX > line.maxX ? sceneX - line.maxX : 0;
      if (
        outside < bestOutside ||
        center < bestCenter ||
        (center === bestCenter && horizontal < bestHorizontal)
      ) {
        bestOutside = outside;
        bestCenter = center;
        bestHorizontal = horizontal;
        bestLine = line;
      }
    }
    if (!bestLine) {
      return null;
    }

    let offset = bestLine.endChar;
    for (let i = bestLine.startChar; i < bestLine.endChar; i += 1) {
      const minX = layout.quads[i * 4];
      if (!Number.isFinite(minX)) {
        continue;
      }
      const midX = (minX + layout.quads[i * 4 + 2]) * 0.5;
      if (sceneX < midX) {
        offset = i;
        break;
      }
    }

    const scenePage = scene.textIndex.pages[bestPage];
    return { pageIndex: bestPage, offset: snapCaretOutsideLigature(scenePage, offset) };
  }

  /**
   * Ligatures repeat the same instance ref for every UTF-16 code unit; never
   * place a caret inside such a run (snap to the nearer run boundary).
   */
  function snapCaretOutsideLigature(page: PageTextIndex, offset: number): number {
    if (offset <= 0 || offset >= page.charInstance.length) {
      return offset;
    }
    const ref = page.charInstance[offset];
    if (ref < 0 || page.charInstance[offset - 1] !== ref) {
      return offset;
    }
    let runStart = offset;
    while (runStart > 0 && page.charInstance[runStart - 1] === ref) {
      runStart -= 1;
    }
    let runEnd = offset;
    while (runEnd < page.charInstance.length && page.charInstance[runEnd] === ref) {
      runEnd += 1;
    }
    return offset - runStart <= runEnd - offset ? runStart : runEnd;
  }

  function wordRangeAt(page: PageTextIndex, pageIndex: number, charIndex: number): TextSelectionRange {
    const text = page.text;
    let index = Math.max(0, Math.min(charIndex, text.length - 1));
    // A hit on a separator space picks the nearer neighboring char.
    if (text[index] === " ") {
      if (index + 1 < text.length && text[index + 1] !== " ") {
        index += 1;
      } else if (index > 0 && text[index - 1] !== " ") {
        index -= 1;
      }
    }
    const isWord = WORD_CHAR_RE.test(text[index] ?? "");
    const matches = (ch: string): boolean => ch !== " " && WORD_CHAR_RE.test(ch) === isWord;

    let start = index;
    while (start > 0 && matches(text[start - 1])) {
      start -= 1;
    }
    let end = index + 1;
    while (end < text.length && matches(text[end])) {
      end += 1;
    }
    return {
      start: { pageIndex, offset: snapCaretOutsideLigature(page, start) },
      end: { pageIndex, offset: snapCaretOutsideLigature(page, end) }
    };
  }

  /**
   * Order carets by what the user sees: pages in index order, lines within a
   * page by their visual rank (top to bottom), chars within a line by offset.
   * Char (stream) order alone is wrong here — browser-print PDFs emit the
   * page header/footer after the body, so a drag reaching the footer would
   * otherwise pull the header (which sits between them in char order) into
   * the selection.
   */
  function compareCaretsVisual(a: TextSelectionCaret, b: TextSelectionCaret): number {
    if (a.pageIndex !== b.pageIndex) {
      return a.pageIndex - b.pageIndex;
    }
    if (a.offset === b.offset) {
      return 0;
    }
    const scene = lastScene;
    const layout = scene ? getPageLayout(scene, a.pageIndex) : null;
    if (layout) {
      const lineA = lineIndexForOffset(layout, a.offset);
      const lineB = lineIndexForOffset(layout, b.offset);
      if (lineA >= 0 && lineB >= 0 && lineA !== lineB) {
        const rankDelta = layout.visualRank[lineA] - layout.visualRank[lineB];
        if (rankDelta !== 0) {
          return rankDelta;
        }
      }
    }
    return a.offset - b.offset;
  }

  /**
   * Visit the selected char span of every line between the range endpoints,
   * walking lines in visual order per page (full pages in between are fully
   * covered).
   */
  function forEachSelectedLineSpan(
    scene: VectorScene,
    range: TextSelectionRange,
    visit: (pageIndex: number, layout: PageTextLayout, line: PageLineRun, from: number, to: number) => void
  ): void {
    for (let pageIndex = range.start.pageIndex; pageIndex <= range.end.pageIndex; pageIndex += 1) {
      const layout = getPageLayout(scene, pageIndex);
      if (!layout || layout.lines.length === 0) {
        continue;
      }
      const startRank =
        pageIndex === range.start.pageIndex
          ? layout.visualRank[lineIndexForOffset(layout, range.start.offset)]
          : 0;
      const endRank =
        pageIndex === range.end.pageIndex
          ? layout.visualRank[lineIndexForOffset(layout, range.end.offset)]
          : layout.lines.length - 1;
      for (let rank = startRank; rank <= endRank; rank += 1) {
        const line = layout.lines[layout.visualOrder[rank]];
        let from = line.startChar;
        let to = line.endChar;
        if (pageIndex === range.start.pageIndex && rank === startRank) {
          from = Math.max(from, range.start.offset);
        }
        if (pageIndex === range.end.pageIndex && rank === endRank) {
          to = Math.min(to, range.end.offset);
        }
        if (from < to) {
          visit(pageIndex, layout, line, from, to);
        }
      }
    }
  }

  function buildSelectionRects(scene: VectorScene, range: TextSelectionRange): Float32Array {
    const rects: number[] = [];
    forEachSelectedLineSpan(scene, range, (_pageIndex, layout, _line, from, to) => {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let i = from; i < to; i += 1) {
        const quadMinX = layout.quads[i * 4];
        if (!Number.isFinite(quadMinX)) {
          continue;
        }
        minX = Math.min(minX, quadMinX);
        minY = Math.min(minY, layout.quads[i * 4 + 1]);
        maxX = Math.max(maxX, layout.quads[i * 4 + 2]);
        maxY = Math.max(maxY, layout.quads[i * 4 + 3]);
      }
      if (!Number.isFinite(minX)) {
        return;
      }
      const height = Math.max(maxY - minY, 1e-6);
      rects.push(
        minX - height * TEXT_BOUNDS_HORIZONTAL_PADDING_FACTOR,
        minY - height * TEXT_BOUNDS_VERTICAL_PADDING_FACTOR,
        maxX + height * TEXT_BOUNDS_HORIZONTAL_PADDING_FACTOR,
        maxY + height * TEXT_BOUNDS_VERTICAL_PADDING_FACTOR
      );
    });
    return new Float32Array(rects);
  }

  function selectedTextFor(scene: VectorScene, range: TextSelectionRange): string {
    const pageParts = new Map<number, string[]>();
    forEachSelectedLineSpan(scene, range, (pageIndex, _layout, _line, from, to) => {
      const page = scene.textIndex?.pages[pageIndex];
      if (!page) {
        return;
      }
      let parts = pageParts.get(pageIndex);
      if (!parts) {
        parts = [];
        pageParts.set(pageIndex, parts);
      }
      parts.push(page.text.slice(from, to));
    });
    // Lines within a page join with the index's separator convention (" ");
    // pages join with a newline.
    return Array.from(pageParts.values(), (parts) => parts.join(" ")).join("\n");
  }

  function setSelection(range: TextSelectionRange | null): void {
    const scene = lastScene;
    if (!range || !scene || compareCaretsVisual(range.start, range.end) >= 0) {
      const hadSelection = selectionRange !== null;
      selectionRange = null;
      selectionRects = null;
      adapter.setSelectionHighlights(null);
      if (hadSelection) {
        options.onSelectionChange?.(null, "");
      }
      return;
    }
    selectionRange = range;
    selectionRects = buildSelectionRects(scene, range);
    adapter.setSelectionHighlights(selectionRects.length > 0 ? selectionRects : null);
    options.onSelectionChange?.(range, selectedTextFor(scene, range));
  }

  function resetSelection(notify: boolean): void {
    const hadSelection = selectionRange !== null;
    selectionRange = null;
    selectionRects = null;
    anchorCaret = null;
    wordAnchor = null;
    wordGranularity = false;
    selectionIsTouch = false;
    adapter.setSelectionHighlights(null);
    overlay.hide();
    if (hadSelection && notify) {
      options.onSelectionChange?.(null, "");
    }
  }

  function applyCursor(canvas: HTMLCanvasElement | null, active: boolean): void {
    if (active) {
      if (canvas && (!cursorApplied || cursorCanvas !== canvas)) {
        restoreCursor();
        canvas.style.cursor = "text";
        cursorCanvas = canvas;
        cursorApplied = true;
      }
      return;
    }
    restoreCursor();
  }

  function restoreCursor(): void {
    if (cursorApplied && cursorCanvas) {
      cursorCanvas.style.cursor = "";
    }
    cursorCanvas = null;
    cursorApplied = false;
  }

  /**
   * Keep the browser's own text selection away from the canvas: an iOS
   * long-press would otherwise start a native HTML selection anchored in
   * nearby DOM text (the canvas has none), alongside ours.
   */
  let guardedCanvas: HTMLCanvasElement | null = null;

  function ensureCanvasSelectionGuards(canvas: HTMLCanvasElement): void {
    if (guardedCanvas === canvas) {
      return;
    }
    releaseCanvasSelectionGuards();
    canvas.style.userSelect = "none";
    canvas.style.setProperty("-webkit-user-select", "none");
    canvas.style.setProperty("-webkit-touch-callout", "none");
    guardedCanvas = canvas;
  }

  function releaseCanvasSelectionGuards(): void {
    if (guardedCanvas) {
      guardedCanvas.style.userSelect = "";
      guardedCanvas.style.removeProperty("-webkit-user-select");
      guardedCanvas.style.removeProperty("-webkit-touch-callout");
      guardedCanvas = null;
    }
  }

  function clearNativeDomSelection(): void {
    document.getSelection()?.removeAllRanges();
  }

  function extendSelectionTo(caret: TextSelectionCaret): void {
    if (wordGranularity && wordAnchor && lastScene?.textIndex) {
      const page = lastScene.textIndex.pages[caret.pageIndex];
      if (page) {
        const focusIndex = Math.max(0, Math.min(caret.offset, page.charInstance.length - 1));
        const focusWord = wordRangeAt(page, caret.pageIndex, focusIndex);
        const start = compareCaretsVisual(focusWord.start, wordAnchor.start) < 0 ? focusWord.start : wordAnchor.start;
        const end = compareCaretsVisual(focusWord.end, wordAnchor.end) > 0 ? focusWord.end : wordAnchor.end;
        setSelection({ start, end });
        return;
      }
    }
    if (!anchorCaret) {
      return;
    }
    if (compareCaretsVisual(anchorCaret, caret) <= 0) {
      setSelection({ start: anchorCaret, end: caret });
    } else {
      setSelection({ start: caret, end: anchorCaret });
    }
  }

  function selectWordAt(hit: CharHit): boolean {
    const scene = lastScene;
    const page = scene?.textIndex?.pages[hit.pageIndex];
    if (!page) {
      return false;
    }
    const range = wordRangeAt(page, hit.pageIndex, hit.charIndex);
    wordAnchor = range;
    wordGranularity = true;
    anchorCaret = range.start;
    setSelection(range);
    return selectionRange !== null;
  }

  function cancelLongPress(): void {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function endTouchGesture(): void {
    adapter.setCameraInteractionEnabled?.(true);
    state = "idle";
    activePointerId = null;
  }

  function stopEvent(event: Event): void {
    event.stopPropagation();
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  /** Whether a client-space point lies on one of the current selection rects. */
  function isSelectionHitAt(clientX: number, clientY: number): boolean {
    if (!selectionRange || !selectionRects || selectionRects.length < 4) {
      return false;
    }
    const scenePoint = adapter.clientToScenePoint(clientX, clientY);
    if (!scenePoint) {
      return false;
    }
    for (let offset = 0; offset + 3 < selectionRects.length; offset += 4) {
      if (
        scenePoint.x >= selectionRects[offset] &&
        scenePoint.y >= selectionRects[offset + 1] &&
        scenePoint.x <= selectionRects[offset + 2] &&
        scenePoint.y <= selectionRects[offset + 3]
      ) {
        return true;
      }
    }
    return false;
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return true;
    }
    return target.isContentEditable;
  }

  const handlePointerDown = (event: PointerEvent): void => {
    if (!enabled || disposed) {
      return;
    }
    const canvas = options.getCanvas();
    if (!canvas) {
      return;
    }
    if (event.target === canvas) {
      ensureCanvasSelectionGuards(canvas);
    }

    // While a selection gesture owns a pointer, keep every other canvas
    // pointer away from the camera controllers.
    if ((state === "mouseSelecting" || state === "touchSelecting") && event.target === canvas) {
      stopEvent(event);
      return;
    }
    // A second finger while a long-press is pending means pinch: give up.
    if (state === "touchPending" && event.pointerType === "touch" && event.target === canvas) {
      cancelLongPress();
      state = "idle";
      activePointerId = null;
      return;
    }
    if (event.target !== canvas || state !== "idle") {
      return;
    }

    if (event.pointerType === "touch") {
      // Never block the touch start: panning must begin normally.
      getSceneChecked();
      activePointerId = event.pointerId;
      state = "touchPending";
      touchStartX = event.clientX;
      touchStartY = event.clientY;
      touchLatestX = event.clientX;
      touchLatestY = event.clientY;
      touchMoved = false;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (state !== "touchPending" || touchMoved) {
          return;
        }
        const scenePoint = adapter.clientToScenePoint(touchLatestX, touchLatestY);
        const hit = scenePoint ? hitChar(scenePoint.x, scenePoint.y) : null;
        if (!hit) {
          state = "idle";
          activePointerId = null;
          return;
        }
        // Take over the in-flight pointer: the finger has been stationary,
        // so the pan (if any) had no visible effect yet.
        adapter.setCameraInteractionEnabled?.(false);
        state = "touchSelecting";
        selectionIsTouch = true;
        // Drop any native HTML selection the OS long-press may have started
        // in surrounding UI text before ours takes over.
        clearNativeDomSelection();
        overlay.hide();
        if (selectWordAt(hit)) {
          (navigator as Navigator & { vibrate?: (pattern: number) => boolean }).vibrate?.(10);
        }
      }, longPressMs);
      return;
    }

    // Mouse / pen.
    const isMacCtrlClick =
      event.button === 0 && event.ctrlKey && /Mac|iP/.test(navigator.platform ?? "");
    if ((event.button === 2 || isMacCtrlClick) && isSelectionHitAt(event.clientX, event.clientY)) {
      // Right-press on the selection: keep it away from the camera
      // controllers (no rotate/pan) so the contextmenu that follows can show
      // the custom menu. Don't preventDefault — the contextmenu event must
      // still fire.
      event.stopPropagation();
      return;
    }
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    const scenePoint = adapter.clientToScenePoint(event.clientX, event.clientY);
    const hit = scenePoint ? hitChar(scenePoint.x, scenePoint.y) : null;
    if (!hit) {
      // Plain click on empty space clears; the pan proceeds untouched.
      if (selectionRange) {
        resetSelection(true);
      }
      return;
    }

    stopEvent(event);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort; window-level listeners still track the drag.
    }
    activePointerId = event.pointerId;
    state = "mouseSelecting";
    selectionIsTouch = false;
    overlay.hide();

    const now = performance.now();
    const isDoubleClick =
      now - lastClickTime <= DOUBLE_CLICK_MS &&
      Math.hypot(event.clientX - lastClickX, event.clientY - lastClickY) <= DOUBLE_CLICK_DISTANCE_PX;
    lastClickTime = now;
    lastClickX = event.clientX;
    lastClickY = event.clientY;

    if (isDoubleClick) {
      selectWordAt(hit);
      return;
    }

    wordGranularity = false;
    wordAnchor = null;
    anchorCaret = nearestCaret(scenePoint!.x, scenePoint!.y);
    setSelection(null);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!enabled || disposed) {
      return;
    }

    if (state === "mouseSelecting" || state === "touchSelecting") {
      if (event.pointerId !== activePointerId) {
        if (event.target === options.getCanvas()) {
          stopEvent(event);
        }
        return;
      }
      stopEvent(event);
      const scenePoint = adapter.clientToScenePoint(event.clientX, event.clientY);
      if (!scenePoint) {
        return;
      }
      const caret = nearestCaret(scenePoint.x, scenePoint.y);
      if (caret) {
        extendSelectionTo(caret);
        updateOverlay();
      }
      return;
    }

    if (state === "touchPending" && event.pointerId === activePointerId) {
      touchLatestX = event.clientX;
      touchLatestY = event.clientY;
      if (Math.hypot(event.clientX - touchStartX, event.clientY - touchStartY) > longPressTolerancePx) {
        touchMoved = true;
        cancelLongPress();
        state = "idle";
        activePointerId = null;
      }
      return;
    }

    // Idle hover: show the text cursor over selectable text (mouse only).
    if (state === "idle" && event.pointerType !== "touch" && event.buttons === 0) {
      const canvas = options.getCanvas();
      if (!canvas || event.target !== canvas) {
        if (cursorApplied) {
          restoreCursor();
        }
        return;
      }
      const scenePoint = adapter.clientToScenePoint(event.clientX, event.clientY);
      const hit = scenePoint ? hitChar(scenePoint.x, scenePoint.y) : null;
      applyCursor(canvas, hit !== null);
    }
  };

  const handlePointerEnd = (event: PointerEvent): void => {
    if (!enabled || disposed) {
      return;
    }

    if (state === "mouseSelecting" && event.pointerId === activePointerId) {
      stopEvent(event);
      const canvas = options.getCanvas();
      if (canvas?.hasPointerCapture(event.pointerId)) {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore release failures when capture is already gone.
        }
      }
      state = "idle";
      activePointerId = null;
      if (!selectionRange) {
        // Plain click on text without dragging: collapse any prior selection.
        resetSelection(true);
      }
      updateOverlay();
      return;
    }

    if (state === "touchSelecting" && event.pointerId === activePointerId) {
      // Let the terminating event propagate: the camera controllers saw the
      // original pointerdown and must remove this pointer from their internal
      // tracking (MapControls cleans up in onPointerUp even while disabled;
      // the native controller's state was already cleared by the takeover).
      endTouchGesture();
      updateOverlay();
      return;
    }

    if (state === "touchPending" && event.pointerId === activePointerId) {
      cancelLongPress();
      state = "idle";
      activePointerId = null;
      // A short stationary tap dismisses an existing selection, native-style.
      if (!touchMoved && event.type === "pointerup" && selectionRange) {
        resetSelection(true);
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!enabled || disposed || !selectionRange) {
      return;
    }
    if ((event.key === "c" || event.key === "C") && (event.ctrlKey || event.metaKey) && !event.altKey) {
      if (isEditableTarget(document.activeElement)) {
        return;
      }
      event.preventDefault();
      void copySelection();
    }
  };

  const handleSelectStart = (event: Event): void => {
    if (!enabled || disposed) {
      return;
    }
    // While a touch gesture engages the PDF (or a handle is being dragged),
    // no native HTML selection should start anywhere on the page.
    if (state === "touchPending" || state === "touchSelecting" || state === "handleDragging") {
      event.preventDefault();
    }
  };

  const handleContextMenu = (event: MouseEvent): void => {
    if (!enabled || disposed) {
      return;
    }
    if (event.target !== options.getCanvas()) {
      return;
    }
    // Android fires contextmenu on long-press; keep it away from the canvas
    // while a touch gesture is engaged.
    if (state === "touchPending" || state === "touchSelecting") {
      event.preventDefault();
      return;
    }
    // Right-click on the selection: replace the browser menu with the custom
    // one (native menus cannot offer "Copy" for canvas-rendered text).
    if (state === "idle" && isSelectionHitAt(event.clientX, event.clientY)) {
      event.preventDefault();
      overlay.showContextMenu(event.clientX, event.clientY);
    }
  };

  // Window-level capture listeners are required: at the event target, capture
  // and bubble listeners run in registration order, so canvas-level capture
  // listeners could not pre-empt the pan controllers already attached to the
  // canvas. Pointer-capture retargeted events still pass through here.
  window.addEventListener("pointerdown", handlePointerDown, { capture: true });
  window.addEventListener("pointermove", handlePointerMove, { capture: true });
  window.addEventListener("pointerup", handlePointerEnd, { capture: true });
  window.addEventListener("pointercancel", handlePointerEnd, { capture: true });
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("contextmenu", handleContextMenu);
  window.addEventListener("selectstart", handleSelectStart, { capture: true });

  async function copySelection(): Promise<boolean> {
    const scene = lastScene;
    if (!scene || !selectionRange) {
      return false;
    }
    const text = selectedTextFor(scene, selectionRange);
    if (text.length === 0) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }
    options.onCopy?.(text);
    return true;
  }

  function updateOverlay(): void {
    if (disposed) {
      return;
    }
    if (!enabled || !selectionRange || !selectionRects || selectionRects.length < 4) {
      overlay.hide();
      return;
    }

    const midGesture = state === "mouseSelecting" || state === "touchSelecting";
    if (!selectionIsTouch) {
      overlay.hideHandles();
      overlay.hideCopyButton();
      return;
    }

    const rects = selectionRects;
    const lastRect = rects.length - 4;
    // Scene space is Y-up: rect minY is the visual bottom edge.
    const startBottom = adapter.sceneToClientPoint(rects[0], rects[1]);
    const startTop = adapter.sceneToClientPoint(rects[0], rects[3]);
    const endBottom = adapter.sceneToClientPoint(rects[lastRect + 2], rects[lastRect + 1]);
    const firstCenterTop = adapter.sceneToClientPoint((rects[0] + rects[2]) * 0.5, rects[3]);

    if (!startBottom || !startTop || !endBottom || !firstCenterTop) {
      overlay.hide();
      return;
    }

    const edgeHeightPx = Math.abs(startBottom.y - startTop.y);
    overlay.showHandles(
      { x: startBottom.x, y: startBottom.y, heightPx: edgeHeightPx },
      { x: endBottom.x, y: endBottom.y, heightPx: edgeHeightPx }
    );
    if (midGesture || state === "handleDragging") {
      overlay.hideCopyButton();
    } else {
      overlay.showCopyButton(firstCenterTop.x, firstCenterTop.y);
    }
  }

  return {
    enable(): void {
      enabled = true;
    },

    disable(): void {
      enabled = false;
      cancelLongPress();
      if (state === "touchSelecting") {
        adapter.setCameraInteractionEnabled?.(true);
      }
      state = "idle";
      activePointerId = null;
      resetSelection(true);
      restoreCursor();
      releaseCanvasSelectionGuards();
    },

    isEnabled(): boolean {
      return enabled;
    },

    clearSelection(): void {
      resetSelection(true);
    },

    getSelectionRange(): TextSelectionRange | null {
      return selectionRange;
    },

    getSelectedText(): string {
      if (!lastScene || !selectionRange) {
        return "";
      }
      return selectedTextFor(lastScene, selectionRange);
    },

    copySelection,

    refreshHighlights(): void {
      if (selectionRects && selectionRects.length > 0) {
        adapter.setSelectionHighlights(selectionRects);
      }
    },

    updateOverlay,

    isGestureActive(): boolean {
      return state !== "idle";
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      cancelLongPress();
      if (state === "touchSelecting") {
        adapter.setCameraInteractionEnabled?.(true);
      }
      restoreCursor();
      releaseCanvasSelectionGuards();
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
      window.removeEventListener("pointerup", handlePointerEnd, { capture: true });
      window.removeEventListener("pointercancel", handlePointerEnd, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("selectstart", handleSelectStart, { capture: true });
      overlay.dispose();
    }
  };
}
