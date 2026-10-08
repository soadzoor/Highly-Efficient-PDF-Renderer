# HEP container versions 1 and 2

The `.hep` file is a binary container with MIME type `application/x-hep`. Container
versions **1** and **2** wrap **scene schema versions 9–12**, recorded in
`manifest.json`. These version numbers evolve independently. The page-based v8
document model is a different thing; it is not this container's scene schema.
Readers support both container versions and scene v9–v12; files using older
scene schemas must be regenerated from their original PDF. Writers use scene
v12 for transposed binary runs, v11 for original JBIG2 streams, v10 for plain
packed monochrome rasters, otherwise v9. Readers need support for the scene
version used by the file. Container repacking preserves section bytes
and does not upgrade a scene or restore omitted layers.

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
| 4 | uint16 | Container version: `1` or `2` |
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
| 16 | uint8 | Codec: `0` = stored, `1` = zlib-wrapped DEFLATE, `2` = DEFLATE with exact vec4 palette (container v2 only) |
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

## Exact palette chunks (container v2)

Container v2 adds codec `2`; its header, index, entry names, checksums, and
logical section bytes are otherwise unchanged. The writer emits v2 only when
at least one palette chunk is selected. Existing v1 files remain readable;
files using codec 2 require an updated reader. Scene schema remains v9.

Codec 2 applies zlib-wrapped DEFLATE to a byte palette payload:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | uint16 | Palette entry count, from 1 through 256 |
| 2 | uint16 | Reserved: `0` |
| 4 | `count × 16` bytes | Exact four-word records, each word little-endian uint32 |
| after palette | one byte per decoded record | Zero-based palette index |

The original chunk's decoded length must be divisible by 16 and determines
the number of records; the palette count cannot exceed that number. The inflated
palette length must equal
`4 + paletteCount * 16 + decodedLength / 16`; every index must be in range.
Palette expansion preserves all 128 bits per record, including signed zero
and NaN payloads. CRC32 and entry offsets refer to the original expanded bytes.
Decompression is bounded by the declared decoded length before expansion,
which remains subject to the usual chunk limit.

The writer considers this codec only for standalone
`textures/stroke-styles.f32` and `textures/stroke-styles.f32cm` sections with at
most 256 distinct 16-byte records. It selects the palette only
when its actual compressed payload, padded to four bytes, is smaller than the
original stored/DEFLATE candidate. Chunk counts, index size, and all other
sections stay identical, so selecting the palette cannot enlarge the archive.
Global or per-entry `STORE` retains the original bytes without a palette.
This codec stores no vector LOD data.

## Annotation metadata

Scene v9 optionally references `annotations/annotations.json` through
`manifest.scene.annotations`:

```json
{ "file": "annotations/annotations.json", "version": 1, "count": 0 }
```

An optional `"appearances": "forms"` or `"appearances": "none"` records that
the file was converted with only form-field appearances, or no annotation
appearances, compiled into page content. It is absent when every appearance was
compiled. Readers that predate it ignore it.

The UTF-8 JSON section contains `{ "version": 1, "annotations": [], "pdfPages": [] }` with
`SceneAnnotation` records as described in [the API reference](api.md#pdf-annotations-and-html-bubbles).
The optional `pdfPages` array holds `{pageIndex, sourcePageIndex, pdfToScene}`
for displayed pages, including pages without annotations. The six-number matrix
maps original PDF destination coordinates into composed scene coordinates.
Readers validate unique in-range scene slots, nonnegative integer source indexes,
and finite, invertible matrices. Older sections without `pdfPages` remain valid;
this optional addition changes neither section nor scene/container versions.
It preserves original PDF geometry alongside composed scene geometry, source
identities, decoded strings, field metadata, relationships, inert actions and
optional-content condition indexes. It contains no appearance streams.

The reader validates the descriptor, version, count, geometry, scalar types,
page slots, condition indexes and bounded action nesting. Section size is
limited to 64 MiB before decompression; record, coordinate, text and action
budgets also apply. Invalid metadata fails validation rather than becoming
interactive UI data. A missing descriptor produces an empty annotation array.

This optional section changes none of the container, scene v9 or page v8
versions. Existing supported files without metadata remain readable.
Repacking cannot recover omitted annotations; reconvert the original PDF to
obtain them.

## Structure content

Scene v9 optionally references tagged-PDF attribution through
`manifest.scene.structure`:

```json
{ "file": "structure/structure.json", "rangesFile": "structure/content-ranges.varint",
  "version": 1, "itemCount": 3, "elementCount": 4, "rangeCount": 3 }
```

`structure/structure.json` contains `{ "version": 1, "items": [], "elements": [] }`
with the `SceneContentItem` and `StructureElement` records described in
[the API reference](api.md#tagged-pdf-structure-mcids). An item records one
marked-content sequence with an MCID: its scene page slot, source page, MCID, tag
and optional owning `elementId`. Elements include every owner's ancestors.

`structure/content-ranges.varint` assigns primitives to items. For each kind, in
the order stroke, fill, text, raster, gradient-fill, gradient-stroke, it holds an
unsigned varint range count followed by one triple per range: the gap from the
previous range's end, the range length and the item index. Ranges within a kind
are sorted, non-overlapping and address the canonical primitive stores; unlisted
primitives belong to no item.

Readers validate the descriptor counts, range bounds against the scene's stores,
item and element references, and the element, property and text budgets. Older
readers ignore the descriptor, and files without it carry no attribution. This
optional section changes none of the container, scene v9 or page v8 versions.

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
| `rasterLayers` (v9–v12) | `{file, count, atlasCount}` | `geometry/raster-layers.varint` |

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
opacity present; bit 3 selects packed monochrome in v10+, bit 4 selects original
JBIG2 in v11+, bit 5 selects transposed binary runs in v12+; an extended storage
flag requires bits 0-1 and all other storage flags zero; bits 6-7 zero),
`width`, `height`, and zigzag deltas of
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
sections, and count decoded atlases and cropped cells as RGBA toward the memory
budget.

Scene v10 adds `raster/layer-N.mono`: eight palette bytes (straight-alpha RGBA8
for zero bits, then one bits), followed by exactly `ceil(width / 8) * height`
MSB-first packed bytes. Each row is independently byte-padded; padding bits are
preserved. Dimensions come from the layer record. The ordinary container
DEFLATE compresses this section; PNG/WebP encoders, RGBA expansion, and atlas
packing are bypassed. Both palette alpha values, opacity, transforms, paint
order, pages, and full-resolution pixels remain lossless. The section stores
canonical pixels; GPU display derivatives are rebuilt when needed. Optional
decoded JBIG2 symbol caches are omitted. Reloading retains packed rows with lazy
RGBA access for consumers that require it.

Packed layers count their palette and packed bytes toward the same 1 GiB
aggregate raster memory limit. Traditional layers retain RGBA accounting;
per-image texel and dimension limits still apply to both representations.
Indexed section lengths are checked against dimensions before decompression.
For a 2,480 by 3,506 scan this reduces the uncompressed pixel section from
34,779,520 RGBA bytes to 1,086,868 bytes including the palette. Compressed size
depends on the scan; packed DEFLATE does not promise the same ratio as the
original JBIG2 stream. Larger HEP exports remain valid and produce a size warning.

Scene v11 adds `raster/layer-N.jbig2`, reusing the PDF's original encoded JBIG2
segments when the canonical packed pixels and dimensions still match their
source fingerprint. This avoids re-encoding monochrome scans. Each section has
a 40-byte `HJB1` header followed by the encoded segments:

| Offset | Type | Value |
| --- | --- | --- |
| 0 | 4 bytes | `HJB1` |
| 4 | uint8 | Bit 0: invert decoded bits; other bits zero |
| 5 | 3 bytes | Reserved: zero |
| 8 | 8 bytes | Two straight-alpha RGBA8 palette colors |
| 16 | uint32 | Encoded segment byte length |
| 20 | uint32 | Shared globals byte length |
| 24 | uint32 | Globals section index, or `0xffffffff` when empty |
| 28 | 2 uint32 | Canonical packed pixel fingerprint |
| 36 | uint32 | Reserved: zero |

Globals use `raster/jbig2-globals-N.bin`; identical globals share one section.
Both segments and globals use container STORE because they are already
compressed. The loader uses the bundled native JBIG2 decoder, applies polarity,
clears row padding as the original PDF parser did, and verifies the fingerprint
before publishing a layer. The fingerprint is the pair returned by
`hashMonochromePixels` in `src/monochromeRaster.ts`, including dimensions.
Palette, opacity, page placement, and pixels remain exact. Unsupported source
provenance or changed pixels fall back to v10 packed storage. Original segments
and shared globals count toward resident raster memory alongside decoded packed
pixels. One JBIG2 decode is bounded to 128 MiB of encoded inputs and packed output;
shared globals are size-checked before decompression. Reloading JBIG2 usually
uses more CPU than inflating packed bytes.

Scene v12 adds `raster/layer-N.binary`, selected by the fast-opening scan option.
Its 16-byte header contains `HBR1` at bytes 0–3, the two RGBA8 palette colors at
4–11, and four reserved zero bytes at 12–15. The remaining bytes store an initial
bit (0 or 1), then positive canonical unsigned base-128 varint run lengths;
successive runs alternate the bit value. The bit stream is the packed raster
transposed in 8-by-8 blocks: for each group of eight rows, visit byte columns
left to right, transpose the eight row bytes, and concatenate the eight output
bytes. Missing rows in the final block are zero. Bits within each output byte
are MSB first. Transposing again recovers the canonical rows, including their
padding bits. Runs must fill exactly `ceil(width / 8) * ceil(height / 8) * 64`
bits; zero runs, overlong varints, overruns, trailing bytes and nonzero hidden
rows are invalid. Container DEFLATE compresses the run stream.

The writer bounds preprocessing memory and falls back to v10 packed storage if
the run section is not smaller than the plain palette-plus-packed section.
Reload allocates only the canonical packed output and a small block scratch
buffer. Both scan options are lossless and avoid full RGBA expansion.

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

A group with a nonempty string `annotationId` is an annotation layer rather than
a PDF layer: it shows or hides the compiled appearance of the annotation with
that `SceneAnnotation.id`, and its `id` is `annotation:<annotationId>`. The
annotation's draw runs use its group condition, or an `and` of that condition
and the PDF layer condition the appearance already had. Annotation layers are
`defaultVisible`, `locked` and not `usedInView`, and appear in neither `order`
nor `radioGroups`. Readers without annotation layers therefore treat them as
fixed, visible layers and cannot hide them through layer controls. A scene
without PDF layers can carry this object for annotation layers alone.

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
narrowest layout that represents it exactly: binary DeviceGray images of at
least 256 pixels use `Gray1` (format 8), with black zero bits and white one bits,
MSB first and each row padded to `ceil(width / 8)` bytes. Eight-bit DeviceGray
sources stay `Gray8`, or `GrayAlpha8` when a color-key Mask needs alpha. Native
WebGL and WebGPU renderers upload binary images as packed R8 bytes and separate
R8 coverage mipmaps; consumers requiring RGBA widen the pixels on demand.
Scene v10 raster layers retain packed bits directly; decoded v9 images with at
most two exact RGBA colors can recover packed GPU storage.
Grayscale soft masks are stored once rather than as three redundant channels.
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

## Optional page primitive ownership

`manifest.scene.pagePrimitiveRanges` is an optional JSON array of unsigned
32-bit integers. It contains 12 values per displayed page: `[first, count]`
pairs for strokes, solid fills, text instances, raster layers, gradient fills,
and gradient stroke runs, in that order. Each pair addresses its corresponding
canonical primitive store. Per-store ranges are contiguous in page order,
start at zero and cover the entire store exactly; malformed metadata is rejected.
New grid compositions record these ranges and HEP round trips preserve them.

This metadata supports independent runtime page transforms without assigning
out-of-page content to a neighboring page. Files without it remain readable;
page extraction uses existing text/raster/gradient page metadata and infers
stroke/fill membership from the original page layout, with a diagnostic. Runtime
Three.js page matrices are presentation state and are not stored here.

## Optional LOD caches (scene v9)

An optional top-level `manifest.sourcePdfByteLength` records the original PDF's
positive safe-integer byte length. New PDF exports record it, and readers retain
it for later scene exports. Writers compare the complete archive, including index
and padding, with this size and emit a console warning and optional `onWarning`
callback when the HEP is at least as large. Export still succeeds and preserves
all requested LOD caches. The demo viewers show the warning after download.
This additive metadata changes no container or scene version.
For older files or custom scenes, callers can supply the original PDF length.

The optional top-level `manifest.lod` object has independent `vector` and `text`
entries: vector currently uses `{ "version": 3, "file": "lod-vector/index.json" }`,
and text uses `{ "version": 3, "file": "lod-text/index.json" }`. These additive caches do not require a container or
scene-schema bump: the canonical scene is unchanged and older readers ignore
unknown sections. Bump the corresponding cache version when its build algorithm
or representation changes. Readers accept vector v1/v2/v3 and text v1/v2/v3, warning when an older encoding
can be repacked for smaller files. Other
versions or malformed caches fall back independently to normal LOD generation
with a console warning. Generic container repacking preserves caches as-is;
`scripts/repack-hep-lods.mjs` upgrades their encoding.

Each index is JSON (decoded limit 64 MiB). Numeric arrays are replaced by
`{ "array": "f32" | "f64" | "u32", "file": "lod-vector/N.bin", "length": N }`
descriptors, with the appropriate prefix for text. Each binary section contains
little-endian numeric values transposed into byte planes: byte `b` of element
`i` is at `b * length + i`. Lengths must match exactly. This preserves Float32/
Float64 values without additional quantization and improves DEFLATE compression.
Indexes contain at most 128 arrays, nesting depth at most 16.

In v1, vector indexes contain `tileGrid` (including Float64 x/y edges), `literals`
(stroke count and four Float32 vec4 streams: endpoints, primitiveMeta,
primitiveBounds, styles), optional Uint32 `origins`, and `levels`. Storage IDs
below the canonical stroke count reference canonical geometry; higher IDs
reference the shared literal suffix. Each level contains tolerance, optional
overview flag, segment count, scene bounds, maximum half width, optional Uint32
record IDs (absent for the exact level), and Uint32 tile offsets, counts and
segment IDs. Tile IDs address positions within the level, not storage IDs.
Selection marks, visible IDs, build timings and GPU data are not persisted.
Culling bounds are cheaply reconstructed from the shared geometry.

In v1, text indexes contain exact/coarse/combined instance counts, the solid glyph
index, runs, clusters, page nodes, and three Float32 coarse-instance streams
(`coarseInstanceA/B/C`), matching `TextLodBuildData`. The exact glyph prefix and
original glyph definitions remain in the canonical scene. Each viewer creates
fresh selection state from the immutable cached build.

### LOD encoding v2

Vector metadata and indexes retain the v1 structure. `literals`' four arrays
instead contain Uint32 residuals in component-major order (`channel * count +
record`). Lossless residuals XOR original Float32 words with these predictors:

- `primitiveMeta` and `styles`: the corresponding canonical record at `origins[id]`,
  or zero when origins are absent.
- `endpoints`: canonical start x/y; control x/y predict the decoded end x/y from
  `primitiveMeta`.
- `primitiveBounds`: Float32 min(start, end) x/y, then max(start, end) x/y.

Decode meta before endpoints, then bounds. Residuals preserve arbitrary curves,
clip bounds, styling, and signed zeros bit-for-bit. Bounds need not equal the
prediction; exceptions remain in the residual stream.

Compact mode adds `positionQuantum: 0.001953125` to the vector index and
`precision: "compact"` to its manifest descriptor (otherwise `"lossless"`).
All four endpoint components and the first two meta components use Uint32 modular
integer differences instead of XOR: round(position / quantum) minus the rounded
predictor. Decode with signed 32-bit modular addition, then multiply by the
quantum into Float32. Other fields keep lossless word residuals. Canonical arrays
are never quantized. Export rounds only literals and recomputes non-clipped
bounds as conservative control hulls, preserving clip windows. Derived level
bounds expand by half a quantum; exact-level bounds and all tile indexes stay
unchanged. The existing 0.35-unit bucket margin exceeds rounding displacement.
Compact export falls back to lossless for out-of-range coordinates.

Text `runs`, `clusters`, and `pages` become `{ count, columns }` tables with
Float64 numeric columns; the field order is specified by `TABLE_FIELDS` in
`src/hepLodEncoding.ts`. Bounds, transforms and directions are flattened into
component columns. Booleans are 0/1. Absent optional direction pairs use NaN;
exact-only nodes may use positive Infinity for `maxInkHeight`. All other numbers
must be finite. The v1 reader converts null heights back to Infinity only for
ineligible nodes, recovering JSON's conversion of this exact-only sentinel.
Coarse text instance arrays remain Float32. Text compaction introduces no rounding.

### Text LOD encoding v3

The index carries `textEncoding: "predictive"`. Tables retain the v2 field order
and store each Float64 column as two Uint32 XOR residual columns (low word, high
word), each containing `count` records. A run's source glyph range predicts its
transform and ink height from the canonical glyph matrices, positions and glyph
bounds. Bounds predict the decoded run transform. Cluster and page bounds,
counts and heights predict their decoded children; page bounds include the
canonical page rectangle. Source range starts predict the previous range's end,
and other scalar fields use zero unless the predictor defines a derived value.
The predictor formulas and evaluation order are specified by
`predictTextNode` in `src/hepLodEncoding.ts`.

Decode run ranges first, validate them, then decode transforms before bounds.
Decode runs before clusters, then pages. Ranges are contiguous, non-overlapping
and bounded by their source arrays, so prediction scans visit each glyph or
child at most once per table. The three coarse Float32 streams store Uint32
residuals in component-major order. Their predictors are the decoded run
transforms rounded to Float32 and the canonical first glyph's color.

All corrections remain in the residuals, including values changed by canonical
coordinate quantization, signed zero and the positive Infinity sentinel. The
decoded cache is lossless; this changes no canonical scene data, clustering or
LOD selection. Older viewers ignore text v3 and rebuild it when needed.

### Vector LOD encoding v3

The residual codec from v2 is retained. Bit-identical literal records (all sixteen
Float32 words plus the optional paint origin) share a storage ID across levels.
Level record lists retain their order and multiplicity; canonical records stay
unchanged. Hash collisions are resolved by exact comparison, including signed zero.

The index declares `tileIndexes: "rebuild"`. Levels omit `tileOffsets`, `tileCounts`,
and `tileSegmentIds`. The loader validates geometry and membership before rebuilding
bounds and spatial indexes cooperatively, with cancellation. Reconstruction never
simplifies geometry; each viewer still owns its mutable selection state. Cached
index reconstruction permits at most 64 × 1024 × 1024 tile references across all levels;
exceeding this limit invalidates the optional cache with a diagnostic.

Compact precision is the default for new vector caches; explicit `lossless`
precision disables additional rounding. Compact v3 replaces the scalar grid with a Float32 `positionQuanta` array, one
power-of-two step per literal. Each grid is no larger than the finest referencing
level's original tolerance divided by 32. Identical records are shared before
rounding, so fine/coarse sharing always chooses the finer precision, and exact
post-rounding duplicates are shared again. The existing modular coordinate codec
uses the record's grid for both the position and its predictor. Negative zero
positions round to positive zero; lossless streams retain all bits.

Per-coordinate displacement is at most half a grid step. Derived scene bounds
expand by the largest half-step in their level. The selection tolerance also
increases by sqrt(2) times this half-step to account for rounding within the
existing screen-space error budget. Clip rectangles, styles, widths, alpha,
primitive flags, and canonical geometry are unchanged. Rebuilt indexes use the
rounded positions, so no assumption about the old tile margin is needed.
Re-export retains an existing `positionQuanta` array, preventing accumulated
rounding or bound growth. A v2 scalar `positionQuantum` can be retained when
repacking without additional rounding; explicitly choosing compact upgrades it
to adaptive grids. Out-of-range coordinates retain their existing precision with
a warning. Text caches continue using v2 without additional loss.
