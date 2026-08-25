/** The subset of PDF.js's operator-list result consumed by HEPR. */
export interface PdfOperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

interface PdfOperatorListChunk extends PdfOperatorList {
  length: number;
}

interface PdfOperatorListIntentState {
  operatorList: PdfOperatorList;
}

interface PdfPageWithOperatorChunks {
  getOperatorList: () => Promise<PdfOperatorList>;
  _renderPageChunk?: (
    chunk: PdfOperatorListChunk,
    intentState: PdfOperatorListIntentState
  ) => void;
}

const MAX_BULK_APPEND_ITEMS = 8_192;
const pagesWithBatchedCollector = new WeakSet<object>();

/**
 * Collect a PDF.js page operator list while avoiding millions of individual
 * `Array.push` calls on unusually dense pages.
 *
 * PDF.js streams operator chunks internally, but its public `getOperatorList`
 * collector appends every item separately. Temporarily wrapping the chunk
 * hook lets the original collector retain responsibility for intent state,
 * task notifications, errors, cancellation, and cleanup while we only replace
 * the two hot append loops. The hook is private, so gracefully use the public
 * implementation when it is absent or cannot be wrapped.
 */
export async function collectPdfOperatorList(page: unknown): Promise<PdfOperatorList> {
  const pageLike = page as PdfPageWithOperatorChunks;
  if (typeof pageLike?.getOperatorList !== "function") {
    throw new TypeError("PDF page does not expose getOperatorList().");
  }

  const originalRenderPageChunk = pageLike._renderPageChunk;
  if (typeof originalRenderPageChunk !== "function") {
    return pageLike.getOperatorList();
  }
  if (pagesWithBatchedCollector.has(pageLike)) {
    return pageLike.getOperatorList();
  }

  const hadOwnChunkHandler = Object.prototype.hasOwnProperty.call(pageLike, "_renderPageChunk");
  const batchedRenderPageChunk = function (
    this: PdfPageWithOperatorChunks,
    chunk: PdfOperatorListChunk,
    intentState: PdfOperatorListIntentState
  ): void {
    const target = intentState?.operatorList;
    if (
      !Array.isArray(chunk?.fnArray) ||
      !Array.isArray(chunk.argsArray) ||
      chunk.fnArray.length !== chunk.argsArray.length ||
      chunk.length !== chunk.fnArray.length ||
      !Array.isArray(target?.fnArray) ||
      !Array.isArray(target.argsArray) ||
      target.fnArray.length !== target.argsArray.length
    ) {
      originalRenderPageChunk.call(this, chunk, intentState);
      return;
    }

    appendArrayChunk(target.fnArray, chunk.fnArray);
    appendArrayChunk(target.argsArray, chunk.argsArray);

    // Let PDF.js preserve lastChunk/separateAnnots, notify its tasks, and run
    // its private cleanup path without appending the same operators again.
    originalRenderPageChunk.call(
      this,
      { ...chunk, fnArray: [], argsArray: [], length: 0 },
      intentState
    );
  };

  pagesWithBatchedCollector.add(pageLike);
  let installed = false;
  try {
    try {
      pageLike._renderPageChunk = batchedRenderPageChunk;
      installed = pageLike._renderPageChunk === batchedRenderPageChunk;
    } catch {
      // A frozen or accessor-backed PDF.js page uses the public collector.
    }
    return await pageLike.getOperatorList();
  } finally {
    if (installed) {
      restoreChunkHandler(
        pageLike,
        batchedRenderPageChunk,
        originalRenderPageChunk,
        hadOwnChunkHandler
      );
    }
    pagesWithBatchedCollector.delete(pageLike);
  }
}

function appendArrayChunk<T>(target: T[], source: T[]): void {
  if (source.length <= MAX_BULK_APPEND_ITEMS) {
    target.push(...source);
    return;
  }

  for (let offset = 0; offset < source.length; offset += MAX_BULK_APPEND_ITEMS) {
    target.push(...source.slice(offset, offset + MAX_BULK_APPEND_ITEMS));
  }
}

function restoreChunkHandler(
  page: PdfPageWithOperatorChunks,
  installed: NonNullable<PdfPageWithOperatorChunks["_renderPageChunk"]>,
  original: NonNullable<PdfPageWithOperatorChunks["_renderPageChunk"]>,
  hadOwnChunkHandler: boolean
): void {
  if (page._renderPageChunk !== installed) {
    return;
  }
  try {
    if (hadOwnChunkHandler) {
      page._renderPageChunk = original;
    } else {
      delete page._renderPageChunk;
    }
  } catch {
    // Leaving an own property containing the original function is equivalent
    // for future calls and safer than masking the extraction result with an
    // error from a non-configurable page object.
    try {
      page._renderPageChunk = original;
    } catch {
      // The page was made immutable while its operator list was loading.
    }
  }
}
