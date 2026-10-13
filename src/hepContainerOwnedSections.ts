import type { HepArchive, HepArchiveEntry } from "./hepContainer";

const ownedSections = new WeakMap<HepArchiveEntry, Uint8Array<ArrayBuffer>>();

/**
 * Transfer an internally produced compressed image to the archive. The caller
 * must relinquish mutation of these bytes; public file()/async() ownership is
 * unchanged. The writer can then retain this STORE payload without copying it.
 */
export function writeOwnedHepImageSection(archive: HepArchive, name: string, bytes: Uint8Array): void {
  const owned = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  archive.file(name, owned, { compression: "STORE" });
  ownedSections.set(archive.file(name)!, owned);
}

/** Internal write-only access; public entry reads continue to return copies. */
export function ownedHepSectionBytes(entry: HepArchiveEntry): Uint8Array<ArrayBuffer> | undefined {
  return ownedSections.get(entry);
}
