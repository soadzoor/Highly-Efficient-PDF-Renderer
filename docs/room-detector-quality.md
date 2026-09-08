# Room detector quality review

This review uses the Dublin, Simi Valley, and Murietta example PDFs and their
existing HEP files. Source PDFs were rendered independently with PyMuPDF and
checked against detector overlays. It is a partial visual review, not a complete
room annotation set or a claim of accuracy on arbitrary floorplans.

## Changes

- **Exact contours.** The contour walker overwrote the preceding corner while
  walking a straight edge. A six-by-six square became a five-vertex polygon with
  area 28.5 instead of 36. Emitting actual turns preserves grid boundaries, corners,
  and enclosed area before simplification.
- **Supported wall geometry.** Axis snapping fits complete runs from immutable
  coordinates. Wall-face snapping checks both endpoints and selects the interior
  face using polygon winding. Tiny raster bevels become corners only when both
  finite wall segments support the intersection. Real diagonal walls remain.
- **Compact geometry fallback.** If snapping or independent simplification makes
  adjacent polygons overlap, try simplifying the raw contour before reverting to
  every raster step. Optional inward margins are limited to 2.2 raster pixels;
  a candidate must retain at least 95% of raw area, retain interior label anchors,
  remain simple, and pass the existing pairwise overlap checks. Small rooms can
  retain their exact contours.
- **Label ownership.** Annotation-only text is attached by final pixel ownership
  after splitting. A nearby equipment/dimension label across a partition no longer
  seeds room growth on behalf of the wrong room. Clustering estimates text size
  from its smaller box dimension, so a rotated dimension cannot join distant room
  labels merely because its bounding box is tall.
- **Dense-page seeding.** When automatic text exceeds the 4,000-seed limit, select
  plausible room labels before annotations, preserving their original order.
  Murietta's HEP contains 4,172 words; its last 172 include actual room numbers that
  the previous early cutoff never considered. Caller-provided seed order is kept.

The geometry changes use existing page-relative thresholds and vector evidence.
There are no building-name rules, new dependencies, trained weights, or PDF/HEP
asset changes.

Modified files:

- `src/roomDetector.ts`: contour, snapping, geometry fallback, and label handling.
- `scripts/test-room-boundary-geometry.mjs`: direct contour and wall-support checks.
- `scripts/test-room-detector-seeds.mjs`: text ownership, rotated text, and seed limits.
- `scripts/test-room-geometry-fallback.mjs`: compact disjoint boundaries, label
  preservation, small rooms, and caller-selected simplification tolerance.
- `scripts/test-room-detector.mjs`: two assertions now measure architectural shape
  rather than the old erroneous contour area or an incidental repair count.
- `scripts/lib/testSuites.mjs`: include the three new Node-only tests in the fast suite.
- `docs/room-detector-quality.md`: this review and reproducible checks.

## Source-based review notes

| Example | Source observations and useful checks |
| --- | --- |
| Dublin | The northwest wing has genuine oblique walls. Nuclear imaging room 1132 and MRI equipment room 1153 were omitted before the contour correction and recovered afterward. Central pharmacy shelving can still fragment the apparent room interior. |
| Simi Valley | Group Therapy rooms 1033, 1032, and 1050 each contain a conference table; table outlines must not split them into separate rooms. Corridor 1201 connects corridors 1220 and 1210. Electrical room 1145 is a clear enclosed room with a difficult opening. Medication Preparation 1132 has its room callout below the room; equipment labels inside it are not evidence of separate rooms. |
| Murietta | Enclosed exam rooms 1212, 1210, and 1208 are useful controls. Halls 1228/1230 and work areas 1231/1232 surround enclosed spaces. Southwest circulation and recovery bays are difficult open-plan examples. Multiple labels in connected circulation do not automatically imply separate enclosed rooms. |

Searchable text and room-label ownership are different: Simi's HEP contains
1201 and 1132, but some previous watershed/geometry paths discarded their labels.
An absent output label must not be interpreted as missing source text without
checking the text index.

## Selected-run results

The baseline and selected runs used the same existing HEPs and default detector
options. Counts describe detector output, not adjudicated true positives. Failed
seeds are text items, often several per room or annotation; they are not missed-room
counts. No complete precision/recall percentage is inferred from this table.

| Example | Detected regions, before → after | Failed text seeds, before → after | Long off-axis perimeter, before → after |
| --- | ---: | ---: | ---: |
| Dublin | 227 → 239 | 1,139 → 937 | 7.41% → 5.01% |
| Murietta | 207 → 216 | 898 → 609 | 0.96% → 0.42% |
| Simi Valley | 83 → 83 | 24 → 24 | 1.85% → 1.14% |

The straightness diagnostic measures edges longer than 0.004 page diagonals whose
direction differs by more than 2° from the source drawing's dominant directions:
0°/90° for Simi and Murietta; 0°/20°/90°/110° for Dublin. It includes some legitimate
diagonal doorway frontiers and cannot distinguish a correct wall from an incorrect
straight partition. Total polygon vertices fell from 20,885 to 15,981 across the
three examples, although individual rooms can have more vertices after exact tracing.

The independent topology auditor passed all 538 selected regions with zero
violations. Visual review confirmed the recovered Dublin rooms above and the
connected Murietta work area carrying labels 1231/1232/1239/1237/1235. Simi's Play
Room 1211 now has four corners instead of five, matching the source rectangle.
Its conference rooms remain whole, but furniture-sized boundary notches remain.

Local artifacts from this review:

- Baseline overlays and source renders: `.eval/room-review-baseline/`.
- Selected predictions, overlays, and diagnostics: `.eval/room-review-accepted/`.
- Runs named `combined`, `final`, or `neck` contain rejected splitting experiments;
  use `accepted` when inspecting the retained implementation.

## Regression checks

The fast suite now includes focused Node-only checks for exact contour area and
pixel ownership, rotated and oblique geometry, supported corners, shared-frontier
cleanup, preservation of small rooms, annotation ownership, rotated text, and
the seed limit. The existing detector suite additionally covers door evidence,
real architectural bays/chamfers, furniture rejection, and topology.

```sh
npm test
npm run test:file -- scripts/test-room-detector.mjs
```

The existing detector test uses Vite only as an in-process TypeScript transformer
with middleware mode, HMR disabled, and WebSockets disabled; it binds no listener.
Both commands passed: typecheck, 34 fast test files, and 42 existing detector
regressions. Direct extraction of the Simi PDF also succeeded with 83 regions and
24 failed text seeds, matching the HEP counts, and passed the topology audit. A
cached non-floorplan control (`optimizing_cpp`) produced zero rooms.
The held-out LK Office HEP produced the same 16 regions and seven margin-label
failures with the original and selected source. Covered area changed by -0.062%;
visual review preserved its rooms, corridors, and enclosed service voids, and the
selected output passed the topology audit.

Bounded visual checks can reuse the existing HEPs. Run one selected file at a time:

```sh
node scripts/eval-rooms.mjs --run room-quality --hep public/examples/heps/Dublin_1st_Floor_2018_06_01-parsed-data.hep --png
node scripts/eval-rooms.mjs --run room-quality --hep public/examples/heps/SimiValleyBehavioralHealth_SR_20180403-parsed-data.hep --png
node scripts/eval-rooms.mjs --run room-quality --hep public/examples/heps/Murietta_Level1-parsed-data.hep --png
node scripts/audit-room-topology.mjs .eval/room-quality
```

No parsed ZIP generation is required. The evaluator also uses the in-process
transformer without a listener. UI checks remain manual: load each example in the
room overlay demo, detect rooms, inspect the locations above, then check pan/zoom,
backend switching, and the downloaded geometry.

## Remaining limits

Marker promotion toward open-space centers was tested and rejected. Although it
fixed a synthetic near-wall-label miss, it fragmented real conference rooms and
offices. A relative passage-width merge guard removed those cuts but merged real
circulation into holed regions that the output contract could not represent. In
the Murietta ablation, promotion added 59 polygons with almost no extra covered
area; the passage guard then lost 2.6% of covered area compared with no promotion.
Neither experiment is part of the final algorithm. Near-wall labels can still
bias watershed boundaries and need a solution evaluated against those controls.

The result contract describes one outer polygon per room. Connected circulation
wrapping enclosed rooms can have holes; the existing containment guard can reject
that circulation to avoid emitting overlapping rooms. Supporting holes requires a
coordinated detector, rendering, and export change. Increasing room counts or
relaxing cavity thresholds does not solve it.

Furniture, missing/ambiguous openings, labels placed outside their rooms, and
open-plan semantic subdivisions remain difficult. Scanned/image-only PDFs lack
the vector wall evidence this detector needs. Reliable performance on those inputs
requires a separate raster/OCR path and an independently reviewed evaluation set.
Use the [gold-set workflow](room-gold-set.md) for complete precision/recall claims;
partial visual checks and incomplete TSV labels cannot establish them.

Relevant research supports treating vector boundaries and room regions together:
[VectorFloorSeg (CVPR 2023)](https://openaccess.thecvf.com/content/CVPR2023/html/Yang_VectorFloorSeg_Two-Stream_Graph_Attention_Network_for_Vectorized_Roughcast_Floorplan_Segmentation_CVPR_2023_paper.html)
classifies both segments and partitioned regions. Its learned model was not added
here; this change repairs the existing deterministic pipeline and preserves its
topology checks.
