# HEP container version 1

The `.hep` file is a binary container with MIME type `application/x-hep`. Container
version **1** wraps the existing **scene schema version 6**, recorded in
`manifest.json`. These version numbers evolve independently. The page-based v7
document model is not this container's scene schema. Legacy ZIP-based files must
be converted with `node scripts/repack-heps.mjs` or regenerated from their PDF.

All integers are unsigned and little-endian. Offsets and lengths are bytes.
There are no directory records, timestamps, encryption, ZIP structures, or
platform-specific compression parameters. Names are case-sensitive UTF-8 paths.
The container is documented for interoperability; it is not an opaque proprietary
compression algorithm.

## Header and index

The first 32 bytes are:

| Offset | Type | Value |
| --- | --- | --- |
| 0 | 4 bytes | `48 45 50 00` (`HEP\0`) |
| 4 | uint16 | Container version: `1` |
| 6 | uint16 | Flags: `0` |
| 8 | uint32 | Entry count |
| 12 | uint32 | Chunk count |
| 16 | uint32 | Index byte length |
| 20 | uint32 | CRC32 of the complete index, including padding |
| 24 | uint32 | Reserved: `0` |
| 28 | uint32 | Reserved: `0` |

The index follows immediately. It contains all chunk records, then all entry
records; its length is divisible by four. Each chunk record is 20 bytes:

| Offset within record | Type | Meaning |
| --- | --- | --- |
| 0 | uint32 | Absolute payload offset |
| 4 | uint32 | Stored payload length, excluding external padding |
| 8 | uint32 | Decoded payload length, including internal alignment gaps |
| 12 | uint32 | CRC32 of the complete decoded chunk |
| 16 | uint8 | Codec: `0` = stored, `1` = zlib-wrapped DEFLATE |
| 17 | 3 bytes | Reserved: all zero |

Each variable-length entry record has this layout:

| Offset within record | Type | Meaning |
| --- | --- | --- |
| 0 | uint16 | UTF-8 name byte length |
| 2 | uint16 | Reserved: `0` |
| 4 | uint32 | Zero-based chunk record index |
| 8 | uint32 | Entry offset within the decoded chunk |
| 12 | uint32 | Entry byte length |
| 16 | name length bytes | UTF-8 name |
| after name | 0–3 bytes | Zero padding to the next multiple of four |

An empty entry has chunk ID `0xffffffff`, offset zero, and length zero. It has no
payload. Nonempty entries reference a real chunk and have four-byte-aligned
decoded offsets. Names must be nonempty, unique, valid UTF-8, at most 65,535
encoded bytes, and contain neither NUL nor backslashes. Empty, `.` and `..` path
components are invalid. A leading UTF-8 BOM is part of the name, not discarded.

## Payloads and grouping

Payloads begin immediately after the index. Each payload starts at a multiple of
four, with only 0–3 zero alignment bytes between payloads. The final payload is
also padded to four bytes. There are no unindexed bytes or unused chunks.
Chunk record order need not match payload order; offsets determine their location.
Payloads must not overlap. Stored chunks have equal stored and decoded lengths.
An empty archive consists of its 32-byte header with an empty-index CRC of zero.

One chunk may contain a standalone entry or several small entries. Standalone
entries cover the entire decoded chunk. Grouped entries are each at most 4 KiB,
share their first path component, and occupy at most 64 KiB including alignment
gaps. Each entry begins at `align4(previous offset + previous length)`, with zero
gap bytes; the chunk ends at the final entry's end without internal tail padding.
The writer groups entries in insertion order, opening a new chunk when the current
group fills. Entry metadata order does not affect decoding.

`manifest.json`, root-level files, `raster/` and `source/` sections, PDF files, and
PNG/WebP files remain standalone. The manifest uses compact JSON. PNG/WebP payloads
are stored directly. Other chunks use native zlib-wrapped DEFLATE if the result is
smaller, otherwise stored bytes. A global `STORE` setting stores every chunk;
per-entry `STORE` overrides are grouped separately from compressed entries.
CRC32 is the IEEE reflected polynomial `0xedb88320`, initialized and finalized
with XOR `0xffffffff` (the same convention as ZIP and zlib).

## Limits and integrity

Readers reject unknown versions, codecs, nonzero reserved fields, malformed names,
duplicate names, invalid references, overlaps, undocumented gaps, and truncation.
The index checksum is verified before interpreting records. Chunk checksums and
internal gap bytes are verified when a section is read, after decoding if needed.
CRC32 detects accidental corruption; it is not authentication.

| Resource | Maximum |
| --- | --- |
| Entries / chunks | 8,192 each |
| Index | 16 MiB |
| Decoded chunk | 1 GiB |
| Total decoded chunks, including alignment gaps | 2 GiB |
| `manifest.json` | 16 MiB |
| `source/source.pdf` or `source.pdf` | 512 MiB |
| Each `raster/` payload | 768 MiB |
| Total `raster/` payloads | 1 GiB |

The scene loader additionally applies its semantic raster, image-dimension, and
source-PDF limits. Callers can provide stricter per-entry byte limits to the
internal reader. Metadata limits are checked before decompression, and streamed
decoded output cannot exceed its declared length. A grouped chunk is decoded once
per reader, including concurrent entry reads. Standalone decoded chunks are not
cached. Returned section buffers are independent copies.

## Runtime behavior

The shared implementation uses `CompressionStream("deflate")` and
`DecompressionStream("deflate")` in Node and modern browsers. No third-party
compression package is needed. Native streams choose the compression level;
numeric compression-level options are unsupported. Exact compressed bytes can
differ between platforms while remaining interoperable.

Stored-container reading and writing work without either native compression API.
Operations that need a missing API fail with an actionable error. Abort signals
stop entry work and cancel both sides of active compression/decompression streams.
Writer progress starts at 0 and finishes at 100; intermediate progress advances
with processed decoded bytes. This container index does not add page streaming:
the current scene loader still assembles the document's global scene.
