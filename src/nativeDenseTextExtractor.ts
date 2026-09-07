import {
  openPdf,
  type NativeVectorPdfSession,
  type OpenPdfOptions
} from "./pdfSession";
import type { NativeMissingFontResolver } from "./pdf/nativeFont";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { VectorScene } from "./pdfVectorExtractor";

export interface NativeDenseTextExtractOptions {
  readonly signal?: AbortSignal;
  readonly missingFontResolver?: NativeMissingFontResolver;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
}

/**
 * Parse a dense compiler's text-only mini-PDF with HEPR's native text engine.
 *
 * This deliberately targets the existing one-page `VectorScene` ABI. The
 * caller remains responsible for proving that each returned scene contains no
 * non-text paint before merging it with the established dense geometry.
 *
 * @internal
 */
export async function extractDenseTextMiniPdfWithNative(
  bytes: Uint8Array,
  options: NativeDenseTextExtractOptions = {}
): Promise<VectorScene[]> {
  options.signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new TypeError("Native dense-text extraction requires non-empty PDF bytes.");
  }

  const openOptions: OpenPdfOptions = {
    repair: "safe",
    signal: options.signal,
    // Production dense-text extraction intentionally has no implicit font
    // substitution. A mini-PDF with a nonembedded font falls back to PDF.js
    // until the bundled substitute metrics/outlines are oracle-equivalent.
    missingFontResolver: options.missingFontResolver,
    onDiagnostic: options.onDiagnostic
  };
  const session = await openPdf({
    kind: "bytes",
    bytes,
    ownership: "copy",
    label: "dense-text-mini.pdf"
  }, openOptions);

  try {
    const vectorSession = readNativeVectorSession(session);
    const scenes: VectorScene[] = [];
    for (let sourcePageIndex = 0;
      sourcePageIndex < vectorSession.info.pageCount;
      sourcePageIndex += 1) {
      options.signal?.throwIfAborted();
      scenes.push(await vectorSession.compileVectorPage(sourcePageIndex, {
        optimization: "none",
        signal: options.signal
      }));
    }
    options.signal?.throwIfAborted();
    const diagnostics = session.getDiagnostics();
    const blockingDiagnostic = diagnostics.find(
      ({ code }) => !(
        code === "font.sfnt-horizontal-metrics-normalized" ||
        (options.missingFontResolver && code === "font.missing-substituted")
      )
    );
    if (blockingDiagnostic) {
      throw new Error(
        `Native dense-text extraction emitted ${blockingDiagnostic.code}; ` +
        "the established PDF.js text pass is required for this mini-PDF."
      );
    }
    return scenes;
  } finally {
    await session.close();
  }
}

function readNativeVectorSession(
  session: Awaited<ReturnType<typeof openPdf>>
): NativeVectorPdfSession {
  const candidate = session as Partial<NativeVectorPdfSession>;
  if (typeof candidate.compileVectorPage !== "function") {
    throw new Error("The native PDF session does not expose legacy VectorScene compilation.");
  }
  return session as NativeVectorPdfSession;
}
