# HEP container version 1

The `.hep` file is a binary container with MIME type `application/x-hep`. Container
version **1** wraps **scene schema version 9**, recorded in
`manifest.json`. These version numbers evolve independently. The page-based v8
document model is a different thing; it is not this container's scene schema.
Readers require scene v9; older HEP files must be regenerated from their
original PDF. Container repacking preserves section bytes and does not upgrade a
scene or restore omitted layers.

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

## Scene draw order

### Scene structure sections

Scene v8 keeps `clipPaths`, `drawRuns` and `paintGraph` in their own sections
rather than as JSON in the manifest. Each manifest entry is a descriptor that
names its section and the counts a reader checks the decoded section against; a
mismatch, a descriptor naming any other section, or a truncated section is
rejected. Clip edges alone were 84,048 decimal coordinates on a 15-page
brochure, 84% of that document's manifest, and deflate cannot compress unique
decimal text.

| Field | Descriptor | Section |
| --- | --- | --- |
| `clipPaths` | `{file, count, edgeCount}` | `geometry/clip-paths.d512` |
| `drawRuns` | `{file, count}` | `geometry/draw-runs.varint` |
| `paintGraph` | `{file, rootCount}` | `geometry/paint-graph.varint` |
| `rasterLayers` (v9) | `{file, count, atlasCount}` | `geometry/raster-layers.varint` |

Every integer is an unsigned LEB128 varint unless described as zigzag, which is
the signed mapping. `geometry/clip-paths.d512` holds `pathCount`, then per path
a zigzag `parent`, a `fillRule` byte and an edge count, then four column byte
lengths and the columns. Each column carries one component of every
`[x0, y0, x1, y1]` edge across all paths, delta-coded against the previous edge
in that column on the same 1/512 fixed-point grid as text instance origins:
about 1/430,000 of a page and far below one device pixel. A `parent` must
reference an earlier path.

`geometry/draw-runs.varint` holds `runCount` then one record each: a flags byte
with the kind in bits 0-2 and presence bits for a clip index (8), a visibility
condition (16) and Multiply blending (32); then a zigzag `first` delta-coded per
kind, a `count`, and the present optional fields. Bits 6-7 must be zero.

`geometry/paint-graph.varint` is a pre-order walk. Each list opens with its
length; each node opens with a header byte carrying the kind in bits 0-1 and a
condition bit (4). A draw leaf then holds a zigzag run-index delta, which is
most of the graph. A retained leaf holds its page, first command, count and
raster slot. A group uses bits 3-7 for isolated, knockout, bounds, soft mask and
`alphaIsShape`, then a blend-mode byte, a float64 alpha, and its optional parts
before its children. Group alpha, bounds and mask backdrop are float64 because a
scene holds them at full precision; mask transfer samples are float32 because
they are already a `Float32Array`.

### Raster layers and atlases

PDFs can paint thousands of tiny images; a map sliced into one-pixel scanlines is
common. Scene v8 gave each image its own PNG section and JSON record, and on a
one-page map with 5,184 scanline images that overhead alone made the HEP 1.8 times
the size of its PDF. Scene v9 keeps one binary record per canonical layer, so
layer indices, transforms, paint order, pages and opacity are unchanged, and packs
the pixels of small layers into shared atlas images. A reader crops every atlas
cell back into that layer's own straight-alpha RGBA; atlases never reach the GPU.

`geometry/raster-layers.varint` holds `atlasCount`, then per atlas an encoding
byte (0 raw RGBA8, 1 PNG), `width` and `height`. Then `layerCount` and per layer
a flags byte (bits 0-1 storage: 0 raw RGBA8, 1 PNG, 2 WebP, 3 atlas cell; bit 2
opacity present; bits 3-7 zero), `width`, `height`, and zigzag deltas of
`paintOrder` and `pageIndex` against the previous layer. An atlas cell follows
with its atlas index and zigzag `x` and `y`, relative to the previous cell's right
edge and row when that cell is in the same atlas and to zero otherwise; the cell
must lie inside its atlas. Layers with identical pixels may share one cell, so a
writer stores a repeated logo, symbol or scanline once. A present opacity is a
float64 in `[0,1]`. The section ends with all float32 matrices in
component-major order (every `a`, then every `b`, ... every `f`), XOR-delta coded
against the previous value and byte-shuffled like `text-instance-a`; its length
must be exactly `24 * layerCount`.

Section names derive from indices: a standalone layer is `raster/layer-N.rgba`,
`.png` or `.webp` by its layer index, and an atlas is `raster/atlas-N.rgba` or
`.png`. A writer puts a layer of at most 16,384 texels, and at most 2,048 texels
on each side, into an atlas unless lossy WebP, plus about 64 bytes of per-section
cost, needs at most half the bytes of its lossless form, as photographs do.
Atlases are shelf-packed in layer order, at most 2,048 texels square, and stored
losslessly, since lossy blocks would bleed between unrelated cells; a single
candidate stays standalone. Readers accept up to 262,144 layers and 4,096 image
sections, and count decoded atlases and cropped cells toward the texel budget.

### Text glyph outlines and origins

Scene v9 stores glyph outline segments in the `manifest.textGlyphSegments`
section `{file, segmentCount, quantizationMin, quantizationMax}` naming
`geometry/text-glyph-segments.cq16`, in place of the two `text-glyph-primitives`
textures. A segment is `A = [x0, y0, cx, cy]`, `B = [x1, y1, type, 0]`; a line's
control point is its end and `type` is 1 for a quadratic. Every point uses one
uint16 range grid per axis, `[x, y]` in the manifest, so contours chain exactly.
The section holds `segmentCount`, a quadratic bitset and a control bitset of
`ceil(segmentCount / 8)` bytes each (bit `i & 7` of byte `i >> 3`), six column
byte lengths and six zigzag columns: start x/y against the previous end, end x/y
against the start, and control x/y against the rounded-down chord midpoint for
segments with the control bit. Every quadratic has it; a line has it only when
its control point differs from its end. `B.w` decodes as zero.

`manifest.textInstances.positionsFile` names `geometry/text-instance-ef.pd512`,
and `positionColumnByteLengths` lists three zigzag streams on the 1/512 grid:
origin `f` deltas; then, for an origin on the previous origin's baseline (equal
quantized `f`), its `e` step minus a predicted advance, wrapped to int32; and
otherwise its plain `e` step. The prediction is the step seen most often so far
after the same glyph index at the same `text-instance-a` matrix `a`, ties keeping
the earlier leader, and zero when none was seen. Readers decode the glyph index
column and `text-instance-a` first and update the prediction in the same order.
That leaves kerning and word spacing: a 396-page manual's origins shrank by a
third, and with chained outlines its HEP went from 123% to 90% of its PDF.

### Optional content (PDF layers)

The optional `manifest.scene.optionalContent` object contains `groups`,
`conditions`, `order`, and `radioGroups`. Group entries contain a document-local
`id`, display `name`, `defaultVisible`, `locked`, and `usedInView` booleans. Store
the document/artifact identity alongside a layer ID; names are not unique and
IDs have no stability guarantee across independently converted files.

Conditions form a bounded, acyclic graph. A condition is a group reference
`{kind:"group",groupId}`, a boolean `{kind:"constant",value}`, a negation
`{kind:"not",operand}`, or `{kind:"and"|"or",operands}`. Numeric operands index
the condition table. This retains nested marked-content, OCG and OCMD semantics
without requiring one layer ID per primitive. Optional-content-aware draw runs
add `optionalContent`, a condition-table index; an absent field means
unconditional visibility. Initially hidden geometry remains in the canonical
stores and retains its primitive indices when layers are toggled.

`order` retains the default configuration's display tree using group nodes
`{kind:"group",groupId,children?}` and label nodes
`{kind:"label",label,children}`. `radioGroups` lists arrays of mutually exclusive
group IDs. Runtime visibility belongs to a view and is never written over these
original definitions or exported defaults.

When searchable characters need visibility associations, `manifest.textIndex`
adds `optionalContentFile`, naming `text/optional-content.varint`. Its unsigned
varint stream has one token per UTF-16 code unit, in page order: zero means
unconditional and a positive token is the condition-table index plus one. This
also associates fallback text quads that have no rendered glyph instance.
The section must have exactly the declared text length and valid condition
references. Scenes without such associations omit this section.

The char map addresses fallback quads by position, so a page carries exactly one
quad per fallback character and its declared `fallbackCount` must equal that
number. Characters that share a glyph, such as the members of a ligature, each
own a quad holding the same rectangle; a shared quad would leave the two counts
disagreeing and a reader then discards the whole text index.

Layer tables are limited to 100,000 groups, 1,000,000 condition nodes/operands,
and nesting depth 64. IDs and references must be valid and unique where required;
cyclic conditions, invalid draw-run references and malformed text associations
are rejected. The existing 16 MiB manifest limit still applies.

### Compositing and replay resources

`scene.paintGraph.roots` retains the ordered hierarchy of draw leaves, composite
groups, and retained fallback leaves. Draw leaves reference a draw-run index.
Groups retain alpha, isolation, knockout, blend mode, bounds, optional visibility
condition, and an optional alpha/luminosity mask subtree. Each canonical draw run
is covered once, including singleton raster runs substituted by a retained leaf.
Repeated/cyclic nodes and nesting beyond 64 are rejected.

`scene.retainedPages` entries contain a resource `file`, a six-value page-to-scene
`matrix`, and an `optionalContentConditions` array mapping retained memberships
to scene conditions (`-1` means unconditional). A resource is shared by all
fallback islands that replay that page. Its file is `retained/page-N.bin` and
contains self-contained retained drawing commands and typed stores, never a PDF
that must be reparsed. Its image store keeps each decoded payload in the
narrowest layout that represents it exactly: a DeviceGray source stays `Gray8`,
or `GrayAlpha8` when a color-key Mask can make a pixel transparent, and only a
consumer that uploads a texture widens it to straight RGBA8. A grayscale soft
mask is therefore stored once rather than as three redundant channels.
Replay is driven only by an optional-content change, so
an exporter writes `scene.retainedPages` and its retained paint-graph leaves
only for a document that has toggleable layers; without them the baked raster
slots already carry the page, and the section is omitted rather than shipped
unreachable. Runtime visibility updates copy only membership bytes and
rebuild affected raster slots before an atomic presentation change. Slots use a
fixed full-page structural quad, so their canonical identity and picking bounds
remain valid when previously hidden content becomes visible.

Backdrop-dependent islands replay the retained command prefix, so changing an
underlying layer can change a later island even when the island's own layer
remains visible. Replay uses original PDF paints and current layer visibility.
Temporary viewer color overrides and the global vector tint do not recolor
fallback pixels or feed into their retained backdrop correction; these islands
retain raster appearance and inspection limits.

Each retained resource begins with 16 bytes: ASCII `HRP` followed by zero,
little-endian uint32 encoding version `1`, uint32 UTF-8 JSON metadata length,
and uint32 payload byte length. Metadata is padded with zeroes to a four-byte
boundary. Typed arrays appear in metadata as
`{$heprArray:"u8"|"u32"|"i32"|"f32",offset,length}`; offsets address the aligned
payload, lengths count elements, and multibyte values are little-endian. Repeated
references reuse one array. Metadata is limited to 16 MiB and the payload to
768 MiB; array ranges and the complete retained-page schema are validated.
Ordinary scenes omit these resources. Old embedded-PDF raster recovery is not
part of scene v8 or v9.

### Gradient meshes and image opacity

`gradientMetaA.x == 2` identifies indexed triangle shading. Optional top-level
`gradientMesh` metadata names four raw little-endian sections: ranges (uint32
`[firstIndex,indexCount]` per gradient), positions (float32 XY per vertex), colors
(float32 sRGB RGBA per vertex), and triangle indices (uint32). It also declares
`vertexCount` and `indexCount`. Vertex colors and all geometry remain shared by
paints; references continue to identify the whole gradient fill. Analytic paints
have empty mesh ranges. Readers validate complete section lengths, finite values,
unit colors, triangle alignment and vertex references, with limits of ten million
vertices and thirty million indices.

For analytic gradients, `gradientMetaA.z` uses bit 0 to disable start extension
and bit 1 to disable end extension. `gradientMetaA.w` is zero for no background,
otherwise packed RGB8 plus one; a PDF `sh` paint does not use shading background.
Radial gradients may have intersecting circles and retain the highest eligible
real root with nonnegative radius. A raster-layer record optionally carries
`opacity` in `[0,1]`; absence means one. Opacity does not duplicate or rewrite the
shared RGBA image bytes.

### Paint runs

The optional `manifest.scene.drawRuns` array records PDF paint order across
vector and image stores. Each entry is `{ "kind": "fill", "first": 0, "count": 1 }`.
Kinds are `fill`, `stroke`, `text`, `raster`, `gradient-fill`, and `gradient-stroke`;
indices address the corresponding path, segment, glyph-instance, image-layer,
or gradient-paint store. Counts are positive. Ranges must cover each store exactly
once, without overlap. Page backgrounds precede these runs and interaction
highlights follow them.

When this field is absent, readers use the established image/gradient prefix,
then fills, strokes, and text. A scene containing draw runs requires a reader
that honors them; treating it as separate fixed passes can change overlaps.
The ordered scenes retain vector geometry; bounded raster layers are used for
content that requires unsupported compositing or paint features.

An optional `blendMode: "Multiply"` on ordinary draw runs preserves the compact
legacy representation of PDF Multiply. Absent means Normal source-over. The
paint graph represents all PDF blend modes, including nonseparable modes, along
with isolation, knockout and soft masks. Readers must retain graph boundaries
when batching or merging pages. Graph renderers track separate color, shape and
group alpha surfaces; plain runs without a graph may use the established paired
Multiply passes. Gradient paint blend modes are represented by graph groups.

An optional `clipIndex` on a fill, stroke, text or raster run references
`manifest.scene.clipPaths`. Each clip is `{ "parent": -1, "fillRule": 0,
"edges": [x0, y0, x1, y1, ...] }`. Coordinates describe directed polygon edges in
page space. A parent index references an earlier clip to intersect with; `-1`
means no parent. Fill rule `0` is nonzero winding, `1` is even-odd. Empty paths
clip everything. Clip paths require ordered draw runs and a reader that applies
their references. They do not modify the image pixels or painted vector geometry.
Limits are 8,192 edges per path, 64 intersected clips and 4,194,304 total nodes
plus edges (64 MiB of packed coordinate data). Curved clip boundaries
are subdivided into vector edges at a 0.0001-point tolerance before Float32
storage, with a diagnostic; glyph outlines and painted curves are unaffected.
Renderers evaluate clipping at the current zoom without a raster mask.

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
| Each retained page program | 16 MiB metadata + 768 MiB typed stores |
| Each `raster/` payload | 768 MiB |
| Total `raster/` payloads | 1 GiB |

The scene loader additionally applies its semantic raster, image-dimension,
optional-content DAG and paint-graph limits. Callers can provide stricter per-entry byte limits to the
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
