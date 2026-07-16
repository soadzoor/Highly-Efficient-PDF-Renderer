# Room gold-set adjudication

This workflow creates a small, independent reference set for room detection. It intentionally does not treat the human-authored TSV files as ground truth. TSV presence and detector/TSV agreement influence which difficult pages are sampled, but TSV polygons are not copied into the gold manifest.

The tooling uses only Node.js built-ins:

```sh
node scripts/room-gold-set.mjs --help
```

## 1. Select representative pages

Start from a noise-aware score report and its corresponding detector predictions:

```sh
node scripts/room-gold-set.mjs select \
  --score-report .eval/live-final/scores-iou50.json \
  --output .eval/room-gold/gold.json \
  --count 12 \
  --seed 20260710
```

Selection is deterministic for the same report, count, and seed. It round-robins across:

- floorplans without TSV annotations;
- non-floorplan negative controls;
- low and high agreement with known TSV positives;
- pages with many unmatched predictions;
- dense, sparse, and midrange detector outputs.

Folder and building-family penalties discourage a sample dominated by repeated levels from one building. The high-agreement pages are controls, not presumed-correct pages. `selection.weakLabelSignals.isGroundTruth` is always `false`.

High-agreement controls require at least ten known positive annotations so a trivial one-room page cannot win that stratum. The unmatched-prediction stratum balances unmatched rate with page size rather than selecting only tiny pages with unstable ratios.

The command copies each detector polygon into `regions` with `status: "ambiguous"`. It records an optional TSV path as `sources.weakLabelTsv`, but never reads or imports its polygons.

If PNG overlays already exist, attach them during selection:

```sh
node scripts/room-gold-set.mjs select \
  --score-report .eval/live-final/scores-iou50.json \
  --png-dir .eval/gold-review/png \
  --output .eval/room-gold/gold.json
```

Do this before adjudication because `select` creates a fresh manifest.

## 2. Review each selected page

Review the PDF itself at useful zoom, with the detector overlay or prediction polygon as a navigation aid. Do not begin by assuming either detector output or TSV geometry is correct. A good anti-anchoring order is:

1. inspect the PDF and decide where bounded spaces actually exist;
2. classify and, when necessary, edit the detector candidates;
3. add any spaces the detector missed;
4. consult the TSV only as a final omission hint;
5. make a second whole-page pass before declaring coverage complete.

Use exactly one status for every region:

- `room`: a bounded occupiable room or circulation space that belongs in this product's room output;
- `shaft-service`: a bounded shaft, riser, inaccessible service void, or equivalent enclosed service space;
- `non-room`: sheet frame, title block, annotation box, furniture/equipment outline, exterior pocket, detector fragment, or other false detection;
- `ambiguous`: the PDF does not support a confident decision yet.

`room` and `shaft-service` are both accepted spatial regions for topology validation. They must not overlap, and neither may contain another accepted region. A large "super room" containing real rooms must be marked `non-room` or replaced with the correct non-overlapping regions.

For an unchanged candidate, retain `origin.kind: "detector"`. If its boundary is edited, use `edited-detector` and retain all contributing zero-based `predictionIndices`. For a missed region, append a new unique region such as:

```json
{
  "id": "manual-0001",
  "status": "room",
  "polygon": [120.5, 240.0, 180.0, 240.0, 180.0, 300.0, 120.5, 300.0],
  "origin": { "kind": "manual" },
  "notes": "Missed textless storage room"
}
```

Polygons use the same detector scene coordinate space as the seeded candidates. Adjacent accepted polygons may share boundary segments; shared boundaries are not overlaps.

Set page `coverage` according to what was actually inspected:

- `complete`: the whole page was checked, all missing regions were added, all candidate statuses were resolved, and no accepted regions overlap or contain one another;
- `partial`: only a stated area or subset was checked; useful for reviewed-region precision analysis, not page-level recall;
- `unknown`: not reviewed or the review extent was not recorded.

Record `review.reviewer`, `review.reviewedAt` as an ISO 8601 timestamp, and any scope limitations in `review.notes`. A page with unresolved `ambiguous` regions cannot be `complete`.

## 3. Validate while reviewing

```sh
node scripts/room-gold-set.mjs validate .eval/room-gold/gold.json --check-files
node scripts/room-gold-set.mjs summary .eval/room-gold/gold.json
```

Validation checks the critical schema fields, enum values, unique IDs, polygon shape and finiteness, accepted-polygon self-intersections, and pairwise overlap/containment. It warns if a complete page lacks a reviewer or if a page is only partial. `--check-files` also checks source paths.

The standalone JSON Schema is [room-gold-set.schema.json](room-gold-set.schema.json). The CLI performs additional geometry and cross-record checks that JSON Schema cannot express.

The summary reports coverage, all four region statuses, unresolved candidates, and accepted regions on complete pages. Only complete pages should be used for page-level recall, false-negative counts, or ordinary precision/recall. Partial pages must remain explicitly partial so their unreviewed areas do not become accidental negatives.

## Review acceptance checklist

A page is evaluation-ready only when all of the following are true:

- the PDF, not the TSV, was the primary evidence;
- every detector candidate has a resolved status;
- missed rooms and shaft/service spaces were added manually;
- large enclosing super-room candidates were rejected;
- accepted regions neither overlap nor contain each other;
- the whole page, including drawing margins and title blocks, was inspected;
- reviewer identity, timestamp, and coverage are recorded;
- `validate` succeeds.

For higher-confidence results, have a second reviewer independently inspect at least the low-agreement, no-TSV, and dense pages. Keep disagreements `ambiguous` until resolved rather than forcing a label.
