import { PdfError, type PdfSource } from "./pdf/nativeTypes";
import {
  openPdfInNodeWorker as openPdfInNodeWorkerClient,
  type NodePdfWorkerOpenOptions
} from "./pdf/workerClient";
import {
  createBundledStandardFontResolver,
  type BundledStandardFontAsset,
  type CreateBundledStandardFontResolverOptions
} from "./standardFontResolver";
import type { NativeMissingFontResolver } from "./pdf/nativeFont";

export type { NodePdfWorkerOpenOptions } from "./pdf/workerClient";

const PUBLISHED_PDF_WORKER_SPECIFIER = "@soadzoor/hepr/experimental/pdf-worker";

/**
 * Open a long-lived PDF session through `node:worker_threads` without
 * installing a global Worker shim. The emitted worker is resolved through a
 * package self-reference, so it remains stable when this entry is rebundled.
 */
export async function openPdfInNodeWorker(
  source: PdfSource,
  options: NodePdfWorkerOpenOptions = {}
) {
  return await openPdfInNodeWorkerClient(source, {
    ...options,
    workerUrl: options.workerUrl ?? resolveDefaultNodePdfWorkerUrl()
  });
}

function resolveDefaultNodePdfWorkerUrl(): URL {
  try {
    // A bare self-reference remains valid when this entry is moved into an
    // SSR bundle: Node resolves it back into the installed HEPR package.
    return new URL(import.meta.resolve(PUBLISHED_PDF_WORKER_SPECIFIER));
  } catch {
    // Preserve direct use of older/unscoped builds whose package metadata
    // does not expose the worker subpath. Source-tree callers still provide
    // an explicit compiled workerUrl as documented for source checkout.
    return new URL(
      /* @vite-ignore */ "./pdf-worker.js",
      import.meta.url
    );
  }
}

interface NodeFileStat {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino?: number | bigint;
}

interface NodeFileHandle {
  stat(): Promise<NodeFileStat>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

interface NodeFsPromises {
  open(path: string | URL, flags: "r"): Promise<NodeFileHandle>;
  readFile(path: string | URL): Promise<Uint8Array>;
}

export interface CreateNodeBundledStandardFontResolverOptions
  extends Omit<CreateBundledStandardFontResolverOptions, "loadAsset"> {
  /** Override the package-relative reader, primarily for controlled hosts/tests. */
  readonly loadAsset?: (
    asset: Readonly<BundledStandardFontAsset>,
    signal?: AbortSignal
  ) => Promise<Uint8Array>;
}

/**
 * Node file-URL loader for HEPR's package-relative, lazy Standard-14
 * substitutes. The returned resolver is safe to pass to direct or worker
 * sessions; worker clients keep the callback on the host.
 */
export function createNodeBundledStandardFontResolver(
  options: CreateNodeBundledStandardFontResolverOptions = {}
): NativeMissingFontResolver {
  return createBundledStandardFontResolver({
    ...options,
    loadAsset: options.loadAsset ?? (async (assetValue, signal) => {
      signal?.throwIfAborted();
      const fs = await loadNodeFsPromises();
      signal?.throwIfAborted();
      const bytes = await fs.readFile(assetValue.url);
      signal?.throwIfAborted();
      return bytes;
    })
  });
}

/**
 * Open a Node file as a random-access `PdfSource` without buffering the file.
 *
 * The returned source owns its file descriptor. `openPdf()` closes it when the
 * session closes; callers that never hand the source to a session must call
 * `source.close()` themselves.
 */
export async function createNodeFilePdfSource(
  path: string | URL,
  options: { readonly label?: string } = {}
): Promise<Extract<PdfSource, { kind: "range" }>> {
  const nodeProcess = (globalThis as {
    readonly process?: { readonly versions?: { readonly node?: string } };
  }).process;
  if (!nodeProcess?.versions?.node) {
    throw new Error("createNodeFilePdfSource() is available only in Node.js.");
  }

  // Keeping the specifier non-literal prevents browser bundlers from trying to
  // resolve a Node builtin in the regular package entry.
  const fs = await loadNodeFsPromises();
  const handle = await fs.open(path, "r");
  let closed = false;
  let initialStat: NodeFileStat;
  try {
    initialStat = await handle.stat();
  } catch (error) {
    await handle.close();
    throw error;
  }
  if (!Number.isSafeInteger(initialStat.size) || initialStat.size < 0) {
    await handle.close();
    throw new RangeError("The PDF file size is not a non-negative safe integer.");
  }

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await handle.close();
  };

  return {
    kind: "range",
    byteLength: initialStat.size,
    label: options.label ?? nodePathLabel(path),
    async read(offset, length, signal) {
      signal.throwIfAborted();
      if (closed) throw new PdfError("closed", "The Node PDF file source is closed.");
      assertRange(offset, length, initialStat.size);
      const currentStat = await handle.stat();
      if (!sameFileVersion(initialStat, currentStat)) {
        throw new PdfError("source-changed", "The PDF file changed while it was being read.");
      }
      const output = new Uint8Array(length);
      let written = 0;
      while (written < length) {
        signal.throwIfAborted();
        const { bytesRead } = await handle.read(
          output,
          written,
          length - written,
          offset + written
        );
        if (bytesRead <= 0) {
          throw new PdfError(
            "unexpected-eof",
            `Unexpected end of PDF file at byte ${offset + written}; expected ${length - written} more bytes.`,
            { offset: offset + written }
          );
        }
        written += bytesRead;
      }
      signal.throwIfAborted();
      const finalStat = await handle.stat();
      if (!sameFileVersion(initialStat, finalStat)) {
        throw new PdfError("source-changed", "The PDF file changed while it was being read.");
      }
      return output;
    },
    close
  };
}

let nodeFsPromises: Promise<NodeFsPromises> | undefined;

function loadNodeFsPromises(): Promise<NodeFsPromises> {
  if (!nodeFsPromises) {
    // Keeping the specifier non-literal prevents browser bundlers from trying
    // to resolve a Node builtin in the regular package entry.
    const moduleName = "node:fs/promises";
    nodeFsPromises = import(/* @vite-ignore */ moduleName) as unknown as Promise<NodeFsPromises>;
  }
  return nodeFsPromises;
}

function assertRange(offset: number, length: number, byteLength: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > byteLength
  ) {
    throw new RangeError(
      `Requested file range [${offset}, ${offset + length}) is outside [0, ${byteLength}).`
    );
  }
}

function sameFileVersion(initial: NodeFileStat, current: NodeFileStat): boolean {
  return initial.size === current.size &&
    initial.mtimeMs === current.mtimeMs &&
    (initial.ino === undefined || current.ino === undefined || initial.ino === current.ino);
}

function nodePathLabel(path: string | URL): string {
  const value = path instanceof URL ? decodeURIComponent(path.pathname) : path;
  const normalized = value.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "document.pdf";
}
