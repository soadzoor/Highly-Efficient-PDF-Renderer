import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { RendererApi } from "./rendererTypes";
import { computeCharRangeBounds } from "./sceneTextGeometry";

export interface TextSearchMatch {
  pageIndex: number;
  /** UTF-16 offset into the page's indexed text. */
  startChar: number;
  length: number;
  /** Scene-space union of the matched characters' quads. */
  bounds: Bounds;
}

export interface TextSearchState {
  hasScene: boolean;
  hasTextIndex: boolean;
  query: string;
  caseSensitive: boolean;
  matchCount: number;
  matchCountCapped: boolean;
  /** Index into the match list, or -1 when there is no active match. */
  currentIndex: number;
}

export interface TextSearchController {
  setScene(scene: VectorScene | null): void;
  setQuery(query: string): void;
  setCaseSensitive(enabled: boolean): void;
  next(): void;
  prev(): void;
  clear(): void;
  getState(): TextSearchState;
  getCurrentMatch(): TextSearchMatch | null;
}

export interface TextSearchControllerOptions {
  getRenderer: () => RendererApi | null;
  getCanvas: () => HTMLCanvasElement | null;
  onStateChange: (state: TextSearchState) => void;
  onMatchesChange: (current: TextSearchMatch | null, all: TextSearchMatch[]) => void;
}

const MAX_MATCHES = 5_000;
/** Viewport margin kept around a match when the camera zooms to fit it. */
const CAMERA_MARGIN_CSS_PX = 96;
/** Zoom-to target: the match ends up roughly this tall on screen. */
const READABLE_MATCH_CSS_PX = 40;
/** Keep the current zoom while cycling if the match is at least this tall. */
const MIN_READABLE_MATCH_CSS_PX = 12;

export interface SceneTextSearchOptions {
  /** Case-sensitive matching. Defaults to false. */
  caseSensitive?: boolean;
  /** Match-count cap. Defaults to 5000. */
  maxMatches?: number;
}

/**
 * UI-agnostic full-document text search over a scene's text index. Suitable
 * for library consumers (e.g. three.js apps) that drive their own camera and
 * highlighting; the interactive controller below builds on it.
 */
export interface SceneTextSearcher {
  /** Whether the scene carries a searchable text index. */
  readonly hasText: boolean;
  /**
   * Finds non-overlapping matches in document order. Whitespace runs in the
   * query are collapsed to single spaces to mirror the index's word-gap
   * encoding, so phrases match across line breaks. Match bounds are
   * scene-space rectangles derived from the glyph geometry.
   */
  search(query: string, options?: SceneTextSearchOptions): TextSearchMatch[];
}

export function createSceneTextSearcher(scene: VectorScene): SceneTextSearcher {
  const pages = scene.textIndex?.pages ?? [];
  const hasText = pages.some((page) => page.text.length > 0);
  let foldedPages: string[] | null = null;

  const getFoldedPages = (): string[] => {
    if (!foldedPages) {
      foldedPages = pages.map((page) => foldCase(page.text));
    }
    return foldedPages;
  };

  return {
    hasText,

    search(query: string, options: SceneTextSearchOptions = {}): TextSearchMatch[] {
      const matches: TextSearchMatch[] = [];
      if (!hasText) {
        return matches;
      }
      const caseSensitive = options.caseSensitive === true;
      const maxMatches = Math.max(1, options.maxMatches ?? MAX_MATCHES);

      // The haystack encodes every word gap/line break as a single " ", so
      // collapse whitespace runs in the query to match that convention.
      const normalizedQuery = query.replace(/\s+/g, " ");
      if (normalizedQuery.trim().length === 0) {
        return matches;
      }

      const needle = caseSensitive ? normalizedQuery : foldCase(normalizedQuery);
      const haystacks = caseSensitive ? pages.map((page) => page.text) : getFoldedPages();

      for (let pageIndex = 0; pageIndex < haystacks.length; pageIndex += 1) {
        const haystack = haystacks[pageIndex];
        if (haystack.length < needle.length) {
          continue;
        }
        let fromIndex = 0;
        while (matches.length < maxMatches) {
          const found = haystack.indexOf(needle, fromIndex);
          if (found < 0) {
            break;
          }
          matches.push({
            pageIndex,
            startChar: found,
            length: needle.length,
            bounds: computeCharRangeBounds(scene, pages[pageIndex], found, needle.length)
          });
          fromIndex = found + needle.length;
        }
        if (matches.length >= maxMatches) {
          break;
        }
      }
      return matches;
    }
  };
}

export function createTextSearchController(options: TextSearchControllerOptions): TextSearchController {
  let searcher: SceneTextSearcher | null = null;
  let hasScene = false;
  let hasTextIndex = false;
  let query = "";
  let caseSensitive = false;
  let matches: TextSearchMatch[] = [];
  let matchCountCapped = false;
  let currentIndex = -1;

  const getState = (): TextSearchState => ({
    hasScene,
    hasTextIndex,
    query,
    caseSensitive,
    matchCount: matches.length,
    matchCountCapped,
    currentIndex
  });

  const emit = (): void => {
    options.onStateChange(getState());
    options.onMatchesChange(currentIndex >= 0 ? matches[currentIndex] : null, matches);
  };

  const collectMatches = (): void => {
    matches = searcher ? searcher.search(query, { caseSensitive, maxMatches: MAX_MATCHES }) : [];
    matchCountCapped = matches.length >= MAX_MATCHES;
  };

  const pickNearestMatch = (): number => {
    if (matches.length === 0) {
      return -1;
    }
    const renderer = options.getRenderer();
    if (!renderer) {
      return 0;
    }
    const view = renderer.getViewState();
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < matches.length; i += 1) {
      const bounds = matches[i].bounds;
      const dx = (bounds.minX + bounds.maxX) * 0.5 - view.cameraCenterX;
      const dy = (bounds.minY + bounds.maxY) * 0.5 - view.cameraCenterY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  };

  const moveCameraToMatch = (match: TextSearchMatch): void => {
    const renderer = options.getRenderer();
    const canvas = options.getCanvas();
    if (!renderer || !canvas) {
      return;
    }

    const bounds = match.bounds;
    const devicePixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(bounds.maxX - bounds.minX, 1e-4);
    const height = Math.max(bounds.maxY - bounds.minY, 1e-4);
    const marginPx = CAMERA_MARGIN_CSS_PX * devicePixelRatio;
    const viewWidth = Math.max(1, canvas.width - marginPx * 2);
    const viewHeight = Math.max(1, canvas.height - marginPx * 2);
    const fitZoom = Math.min(viewWidth / width, viewHeight / height);
    const readableZoom = (READABLE_MATCH_CSS_PX * devicePixelRatio) / height;
    const targetZoom = Math.min(fitZoom, readableZoom);

    // Keep the current zoom while cycling nearby matches; only re-zoom when
    // the match would be off-screen-sized or unreadably small.
    const view = renderer.getViewState();
    const fitsViewport = width * view.zoom <= viewWidth && height * view.zoom <= viewHeight;
    const readableAtCurrent = (height * view.zoom) / devicePixelRatio >= MIN_READABLE_MATCH_CSS_PX;
    const zoom = fitsViewport && readableAtCurrent ? view.zoom : targetZoom;

    renderer.setViewState({
      cameraCenterX: (bounds.minX + bounds.maxX) * 0.5,
      cameraCenterY: (bounds.minY + bounds.maxY) * 0.5,
      zoom
    });
  };

  const runSearch = (moveCamera: boolean): void => {
    collectMatches();
    currentIndex = pickNearestMatch();
    if (moveCamera && currentIndex >= 0) {
      moveCameraToMatch(matches[currentIndex]);
    }
    emit();
  };

  const step = (direction: 1 | -1): void => {
    if (matches.length === 0) {
      return;
    }
    currentIndex = (currentIndex + direction + matches.length) % matches.length;
    moveCameraToMatch(matches[currentIndex]);
    emit();
  };

  return {
    setScene(scene: VectorScene | null): void {
      hasScene = scene !== null;
      searcher = scene ? createSceneTextSearcher(scene) : null;
      hasTextIndex = searcher?.hasText === true;
      // Re-run the active query against the new scene, but keep the camera
      // where it is: scene swaps should not yank the view around.
      runSearch(false);
    },

    setQuery(nextQuery: string): void {
      if (nextQuery === query) {
        return;
      }
      query = nextQuery;
      runSearch(true);
    },

    setCaseSensitive(enabled: boolean): void {
      if (enabled === caseSensitive) {
        return;
      }
      caseSensitive = enabled;
      runSearch(true);
    },

    next(): void {
      step(1);
    },

    prev(): void {
      step(-1);
    },

    clear(): void {
      query = "";
      matches = [];
      matchCountCapped = false;
      currentIndex = -1;
      emit();
    },

    getState,

    getCurrentMatch(): TextSearchMatch | null {
      return currentIndex >= 0 ? matches[currentIndex] : null;
    }
  };
}

/**
 * Length-preserving lowercase fold: characters whose lowercase form expands
 * to multiple code units (e.g. "İ") are kept as-is so char offsets stay
 * aligned with the per-character bounds.
 */
function foldCase(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const folded = ch.toLowerCase();
    out += folded.length === 1 ? folded : ch;
  }
  return out;
}
