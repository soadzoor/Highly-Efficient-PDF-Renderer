import {
  NativePdfDocument,
  type NativePdfOpenOptions
} from "./nativeDocument";
import { createInternalBorrowedPdfByteSource } from "./nativeSource";

/** Internal worker-only options for opening an exclusively owned byte view. */
export interface NativePdfBorrowedByteOpenOptions extends NativePdfOpenOptions {
  readonly label?: string;
}

/**
 * Open native PDF structure directly over bytes already owned by the current
 * worker. This is deliberately absent from the public PDF entry points: public
 * callers must continue to choose explicit copy-or-transfer ownership.
 *
 * The parser never mutates `bytes`. The caller must not mutate or transfer its
 * backing buffer until the returned document has been closed.
 *
 * @internal
 */
export async function openNativePdfDocumentFromBorrowedBytes(
  bytes: Uint8Array,
  options: NativePdfBorrowedByteOpenOptions = {}
): Promise<NativePdfDocument> {
  const { label, ...openOptions } = options;
  return await NativePdfDocument.open(
    createInternalBorrowedPdfByteSource(bytes, label),
    openOptions
  );
}
