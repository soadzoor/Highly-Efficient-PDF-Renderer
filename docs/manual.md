# Manual

[Home](../README.md) · [Examples](examples.md) · [API reference](api.md)

HEPR loads PDF or pre-parsed HEP files into a scene of strokes, fills, text,
and raster layers. Use the three.js integration to add that scene to your
application, or explore the standalone canvas viewer in the
[examples](examples.md).

## Installation and platform requirements

```bash
npm install @soadzoor/hepr three
```

For bundled browser applications, use the `@soadzoor/hepr/bundler` entry and
the [Vite configuration in the quick start](../README.md#quick-start).

The browser integration requires a canvas and a supported GPU backend:

| Backend | Requirements |
| --- | --- |
| WebGL (default) | WebGL 2; use a three.js `WebGLRenderer` for the three.js integration. |
| WebGPU | `navigator.gpu` and an available GPU adapter; use a three.js `WebGPURenderer` for the three.js integration. |

PDF parsing uses workers. Deploy the worker assets emitted by your bundler
alongside your application. Browser image processing uses browser canvas APIs;
the optional Node canvas dependency is unnecessary in a browser.

Compressed HEP exports require `CompressionStream("deflate")`; reading them
requires `DecompressionStream("deflate")`. See [HEP files](#hep-files) for an
uncompressed option and [Node conversion](#node-conversion) for server requirements.

## Editing documents

Both viewers start in **View** mode. Choose **Edit** to prepare full-quality
editing data and show editing tools. A **Loading Edit mode** card appears inside
the canvas before the editing tools load, even with Settings closed. It remains
visible through the first displayed editable frame, including when returning to
an existing editing session. A spinner and progress bar identify the current
stage: loading tools, preparing full-quality pages, preparing form fields and
fonts, preparing controls, or drawing the editable document. Percentages measure
page or field progress within that stage; stages without a measurable total use
an indeterminate bar.

The mode button becomes **Cancel editing setup** while preparation is running.
Cancel or a setup failure returns to View and removes the loading card; failures
remain in the status message. Choose Edit to retry. Cancelling re-entry preserves
your earlier modifications. Preparation can take longer and use more memory than
viewing. Returning to View keeps the modifications and removes the editor overlay
and its frame work. Setup UI, layout observers and listeners exist only during
setup. New visible content still has its ordinary rendering cost. Browser/GPU
performance must be verified on your documents.

View and Edit use the same vector toolbar icons. Hover for descriptive titles,
or navigate by keyboard with accessible button names and visible focus. Page,
password, save, flatten and print actions use icons alongside the editing tools;
busy-state titles describe work such as preparing a print or export.

Drop PDF or HEP files anywhere in either viewer to open them. When a document is
already open, choose **Replace** or **Attach at end**, or cancel the drop. Attach
keeps current edits, appends pages in file order and supports Undo; it also works
in View without showing editing controls. Enter imported PDF passwords when
prompted. With several files, Replace opens the first and attaches the rest.
Legacy HEP ZIP files are accepted. HEP attachment preserves its retained visual
content but cannot restore missing original form or text-authoring semantics.
Each file attaches separately; if a later file fails or is cancelled, earlier
completed attachments remain. Press Escape to cancel an operation.

In Edit, drop PNG, JPEG or WebP files onto a document page to insert images at the
drop location. Images retain their source resolution and transparency and support
Undo. Drop documents and images separately; image insertion requires Edit mode.

Use Select to move, resize or rotate objects. Ctrl/Cmd-click toggles membership
in a selection; Shift-click adds. Drag anywhere inside the selection frame to
move the entire selection. Drag an empty area outside it to select every visible
object fully contained in the rectangle. Selection handles and numeric controls
apply to the entire selection. Corner resizing keeps proportions by default;
hold Shift to resize width and height independently. Textbox handles change
wrapping while preserving the frame's proportions; hold Alt to scale the textbox
appearance instead, or Alt+Shift to scale it freely. Modifiers can be changed
during a drag. Use undo/redo, duplicate, delete, grouping,
and arrow-key nudging from the editing tools and shortcuts.
The selection frame and handles follow the object's rotation and transform.
Resize along the visible frame's axes; numeric W/H controls use its edge lengths.
Dragging the rotation grip snaps the resulting absolute frame angle to the
nearest multiple of 45°, including 0°, only when it is within 5° of that angle
(inclusive). Other angles rotate freely. Hold Alt (Option on macOS) to bypass
snapping entirely. Pressing or releasing Alt/Option updates the preview even
without moving the pointer; the final pointer position and modifier state are
honored when you release the grip.
Shift retains its selection and free-resize behavior.
**Rotate** displays and sets the selection frame's absolute angle, normalized to
`[-180°, 180°)` with positive angles counterclockwise. Entering 90° sets the frame
to 90°; entering 90° again keeps it there. During a drag, the value follows the
displayed preview.
During a transform, the objects and selection frame advance together with each
rendered preview. New pointer positions are coalesced while a preview prepares;
the previous displayed pose remains together until the next one is drawn.
Transform previews reuse PDF field appearances while the source, values and
target widgets are unchanged, applying current geometry, clips and paint order
on each update. Identical glyph resources also reuse the existing text atlas.
Supported moves prepare the current scene once, then move selected text, paths
and form appearances while retaining paint order and antialiased clipping.
Native WebGL/WebGPU reuse GPU resources for compatible poses; Three.js also
reuses material textures while viewing a single document object, including Grid
and single-page Reader. Independent multi-page Reader views use the regular
update path, including when those page views are retained on returning to Grid.
Rotation, resizing, selected images/gradients, complex effects and incompatible
clipping/text state keep full compilation. Existing LOD settings are preserved,
and releasing, cancelling or leaving Edit resumes normal document updates.
Each source session retains current reusable resource sets rather than an
appearance history; superseded preparation stops when no active operation needs
it. Reusable preparation and active export snapshots survive cancellation of a
single preview, and disposing the source session releases its caches.
Transform handles appear only in Select. Rotation and resize cursors remain
visible throughout a drag; Text and Pencil use their own cursors. Switching
tools or pressing Escape cancels the current gesture.
Document selection frames, handles and input controls are clipped at the canvas
viewport and stay below the toolbars, Settings panel and thumbnails. Captured
drags can continue beyond the viewport; page edges and Reader gaps do not clamp
their coordinates. Text-selection popups and annotation bubbles stay within the
visible document area.
In Reader layout, the mouse wheel scrolls over the selection frame and drawing
overlay; Ctrl/Cmd-wheel zooms, and Shift-wheel scrolls horizontally.

Source annotations and inseparable mask/compositing groups select together.
Other source content can select as individual strokes, glyphs, fills or images;
use multi-selection and grouping when the original document has no useful
object boundaries. An existing raster island moves as a whole image.

The Fill tool shows controls for ordinary AcroForm text, checkbox, radio and
choice fields, respecting read-only flags and text limits. With Select active,
double-click a field to switch to Fill and focus that widget for typing or
keyboard interaction. Typing uses the PDF's
font and point size, with automatic sizing similar to Chrome/PDFium. Unfocused
controls retain the document's appearance, including checkmarks in radio groups;
keyboard focus remains visible. PDF actions and JavaScript are not executed.
After a value changes, the native control keeps the current value visible even
after losing focus, until its matching regenerated appearance is drawn. This
also covers shared widgets and cleared fields, so the previous value does not
flash while the document updates. Failed regeneration keeps the current value
visible for correction or retry.
Pending checkbox/radio marks use black vector shapes following the PDF's standard
mark choice, including checkmarks on radio fields, while retaining radio-group
and keyboard behavior. The document's own appearance takes over after rendering.
Field borders and controls follow the document's rendered zoom and pan frames
without replacing focused inputs or their drafts.
Rotate or resize a field with Select, then return to Fill to type in its original
local dimensions at the new angle and scale. Saved HEPR PDFs retain that field
plane when reopened and filled again.
Textboxes support mixed formatting, sizes, colors,
underline, strikethrough and alignment. Choose bundled fonts, import TTF/OTF
files, or request installed fonts in a browser that supports local font access.
Font bytes are used for committed rendering and PDF output.
Double-click a textbox created and saved by HEPR to edit it again, including its
rich formatting and embedded fonts. Ordinary existing page text is transform-only.

Use shapes, polygon/polyline and pencil tools for vector markup, with stroke
width, color, opacity and optional closed-area fill. **Color opacity** controls
the stroke (or text/image), and **Fill opacity** independently controls closed
fills. Each has a linked slider and number input from 0 to 1, with 0.1 steps.
Slider movement updates the number immediately; releasing commits one undoable
change. Existing fill opacity is preserved when changing stroke opacity.
Rectangle, ellipse, line, arrow, polygon and polyline previews show their actual
outlines, chosen document-scaled width, colors and separate stroke/fill opacities,
including closed fills and arrowheads. Polygon/polyline styles are captured on
the first click; the next segment follows the pointer on that original page.
Press Enter or double-click to finish using clicked vertices only.
Finished shapes, pencil strokes and signature copies remain visible independently
until their matching document frame is drawn. You can start the next drawing on
the same document while an earlier one compiles. Returning to View waits for
that handoff before removing the previews.
The signature library saves
drawn vector handwriting in this browser's `localStorage`; placed copies can
have independent size, stroke thickness and color. Saved signatures show clickable
vector previews with their names. New signatures offer **Smooth strokes** to
straighten small sampling zigzags and fit compact curves; turn it off to keep
the raw handwriting. Smoothed captures also discard redundant stored points.
Pencil strokes share the curve fitter with a smaller error budget and preview
their committed fitted curves. Endpoints, pen lifts, loops and dots are retained,
and reopening stored captures does not
repeatedly smooth or rewrite them. Choosing a signature activates its toolbar
button and shows a translucent preview centered on the cursor. Click a page to
stamp the preview's size, color and stroke width; click again for another copy,
or press Escape to return to Select. The preview follows zoom and page rotation
and hides outside the document or when leaving the canvas or Edit mode.
Existing saved signatures remain usable. There is no application count
limit, but browser storage capacity and privacy settings still apply. General
PNG/JPEG/WebP images use the separate image-import tool.

**Save PDF** retains editable newly added annotations, including when starting
from a HEP. Existing forms are preserved when the original source PDF is
available. Source content transforms can rebuild the affected page's drawing
content as vectors, reporting changes to its authoring structure. Unrelated pages
and source document resources are preserved. A flattened PDF copy and PDF-based
printing are also available. If direct printing is unavailable, download the PDF
and print it with your preferred PDF viewer.

Chrome and some other readers paint editable form fields above annotations,
including newly added pencil strokes and signatures. When artwork may overlap
field areas, **Save PDF** offers an explicit choice: **Save flattened PDF** keeps
the artwork above the fields, turning fields and annotations into page graphics
in that copy; **Save editable PDF** retains their editing behavior, with a note
that those readers may cover overlapping artwork. Your active document stays
editable with either choice. **Flattened PDF** exports directly without this
choice, and printing uses the compiled visual result. Bounds checks are
conservative, so a reported overlap does not always mean a stroke is covered.

**Print** is also available in the main toolbar in View mode, for PDF and HEP
documents. It includes modifications retained after leaving Edit mode. Unedited
PDFs print from their original resources; HEP content is rebuilt as a vector PDF.
The loaded page selection is respected, and an already supplied PDF password is
used to prepare a temporary printable copy without changing the source file.

**PDF password** opens the output protection settings. Keep the existing
protection, remove it, or set/replace the opening password and confirm it. Open a
protected source with its current password first; it does not need to be entered
again in the editor. These settings apply to both editable and flattened PDF
saves. New protection uses AES-256. Passwords stay in memory and are not stored
in `localStorage`. Protection changes remain unsaved until a PDF export succeeds;
saving HEP or printing does not save these settings. HEP files remain unencrypted.

**Pages** opens page management. Select pages using checkboxes or page ranges,
rotate them left/right by 90 degrees or by 180 degrees, or remove them. A document
must retain at least one page. Choose PDFs to insert before/after a chosen page
or at the end; selecting multiple files merges their pages in file order. Enter
each imported PDF's password when prompted. Page operations support progress,
cancellation, undo and redo alongside other edits. The destination keeps its
existing PDF protection; the PDF password settings control exported copies.
Current object and layer ordering stays intact during these page operations.

**Save HEP** stores the current appearance as ordinary compact scene data. It
does not embed the original PDF, source font files or editing history. Reopening
allows geometry transforms, but does not promise rich-text or form-authoring
semantics. PDF export from a HEP rebuilds the document from the geometry, glyph
outlines, Unicode mappings and images that remain; it needs no original PDF.

### Layers

Use the **Layers** toolbar icon to open layer editing in the right Settings dock.
Add named layers, rename them, change default visibility or its lock, choose a
parent, and move layers up or down. The top layer paints in front; reordering
also changes artwork stacking. Unlayered artwork keeps its existing paint slots,
and compositing groups move as units so their clips, masks and blending survive.
Content associated with several layers uses its frontmost listed membership.
Newly creating or renaming a layer alone does not reorder existing artwork.

**New objects** chooses the active layer for text, shapes, signatures and images.
Choose **Unlayered** to add independent content. A hidden active layer must be
shown before placing new content. Select existing objects, choose their destination
and use **Assign selection**; **Select contents** selects a layer's visible objects.
**Remove layer, keep artwork** removes the visibility membership, retaining other
memberships, or redirects it to the chosen destination. Select its contents and
delete them separately when the artwork itself should be removed. All document
layer edits participate in Undo/Redo; changing the active layer is a preference.
New textbox drafts retain the layer chosen when typing begins. Editing a reopened
textbox preserves its actual compound membership; hiding a layer hides its typing
draft without discarding the text, and showing it restores the draft.

With **Select** active, right-click an object or anywhere inside the current
selection frame to open its drawing-order menu. **Bring to front** and **Send to
back** move the selection to the ends of its layer; **Bring forward** and **Send
backward** move it one position. Selected objects keep their relative order.
Selections spanning layers or pages arrange independently in each layer/page;
unlayered objects arrange among other unlayered objects. Other layers keep their
order. Clips, masks and inseparable compositing groups move with their content.
Commands that cannot change the order are disabled. These changes support
Undo/Redo and are baked into normal PDF/HEP drawing data. Use the keyboard's
context-menu key or Shift+F10 to open the menu for the selection, then arrow keys
and Enter to choose a command; Escape closes it without clearing the selection.

Layer visibility changes respect PDF radio alternatives and visibility locks.
These locks prevent visibility toggles; they do not lock artwork against editing.
Layers excluded by a source PDF's View intent retain that intent. The editor does
not expose internal annotation-visibility groups as user layers. Hidden layer
content is excluded from picking, form interaction, text search and selection.
PDF and HEP saves preserve layers, hierarchy and edited default visibility; HEP
uses its existing optional-content data without embedding editing history.

Standard PDF readers always paint editable annotations above page graphics, and
may paint widgets above other annotations. After reordering objects or layers in a document
with annotations, **Save PDF** offers editable output or a flattened copy that
preserves the displayed stacking. Printing uses the compiled visual result.
The active document stays editable after either export.

Check layer creation, nested reordering, visibility, assignment, removal and
Undo/Redo in both viewers. Reopen saved PDF and HEP copies, toggle their layers,
and compare overlaps in an independent PDF reader; check the flattened copy for
crossings between page artwork, annotations and form widgets.
Check the four right-click commands with overlapping source and newly added
objects, multi-selections and separate layers. Reopen saved copies and verify
that clicking an overlap selects the object now in front.

### Manual editing verification

Run the viewer yourself, open a PDF with forms, switch to Edit, change multiple
field types, add mixed-font text/shapes/ink/a signature/an image, and transform a
selection made with both modifier clicks and area selection. Verify undo/redo,
View/Edit switching, Reader/Grid layouts, and WebGL/WebGPU switching. Save PDF,
flattened PDF and HEP, reopen each, inspect text search and appearance, and print
using your browser and an independent PDF reader. Compare matched performance
captures in default View mode and after editing; offline Canvas2D checks do not
prove browser or GPU behavior.
In both viewers with WebGL and WebGPU, close Settings and enter Edit with a large
PDF or a slow tool download. Check that **Loading Edit mode** appears before tool
loading and stays visible until the editable document is drawn. Check stage
labels, measured page/field percentages and indeterminate stages; percentages
describe each stage rather than the entire setup. Cancel during preparation and
initial drawing, then retry. Make edits, return to View and cancel re-entry;
verify that another attempt retains the edits. Force a setup failure, such as a
blocked editor-tool download, and check that its status remains visible with no
stuck card or editing controls. Replace the document during preparation and
verify that late progress cannot affect the replacement. Check the card's bounds
with Settings open/closed and on narrow screens, and that setup UI and its layout
work are absent in idle View mode.
Select and rotate objects near each canvas edge, then pan or zoom them beneath
the top bar, thumbnails and Settings panel. Confirm selection graphics and fields
stay behind those controls and do not intercept their clicks. Check Examples
menus and toolbar hide/restore on narrow screens. In View, check touch-selection
handles, Copy/context menus and annotation bubbles near every canvas edge.
Continue a captured drag across the top bar and release or cancel outside the
canvas; its final position and undo/redo should remain correct.
Check icon tooltips and keyboard focus in View and Edit in both viewers. Verify
page navigation, zoom/fit, search, Settings, downloads and mode switching, then
Pages, PDF password, PDF/HEP saves, flattening and printing in Edit. Check that
busy/cancel transitions retain the icons and update their descriptions, and that
the toolbar can still be hidden and restored on narrow screens.
Drop PDF/HEP files in View and Edit and check Replace, Attach and Cancel with
existing edits, multiple files and protected PDFs. Check Undo/Redo, page order,
Reader thumbnails, search, export and printing after attachment; View should stay
in View. Cancel during preparation or password entry and check earlier completed
imports remain. Drop transparent PNGs, JPEGs and WebPs on rotated/cropped pages
in Edit, then change tools, zoom or switch documents during decoding to check
that images retain their captured page location or cancel safely.
In Reader layout with Select active, scroll over empty space, selected objects,
and their handles. Repeat with a drawing tool; check wheel/trackpad scrolling,
Shift-wheel horizontal movement and Ctrl/Cmd-wheel zoom in both viewers/backends.
Double-click empty, filled, rotated and resized form fields with Select active.
Check that Fill activates and the clicked widget receives focus without moving
the viewport or changing its value. Test shared widgets and read-only fields;
switch tools or leave Edit before a pending frame and verify focus is cancelled.
With Fill active, zoom in and out rapidly and pan across text, checkbox, radio
and choice fields. Check that their borders remain aligned with the document,
including the final zoom frame, in both viewers and both backends. Repeat in
Reader and Grid, while a text field is focused, after backend switches and after
leaving and reentering Edit; verify that typing drafts and the caret survive zoom.
With slow form regeneration or delayed drawing, type and click outside the field;
check that the current value remains visible without exposing the previous value
or doubling the text. Repeat with shared widgets, rapid successive changes and
deleting all text. Check undo/redo, switching tools, leaving and reentering Edit,
and a failed regeneration followed by retry. Verify that the correct value stays
visible and pending updates preserve an active typing draft and caret.
Repeat on rotated/resized fields and fields with custom backgrounds;
check that the original appearance returns only after the matching value is drawn.
Check checkbox/radio changes during and after the update, including radio fields
using checkmarks and circles. Verify keyboard/group behavior, undo and save/reopen,
with no browser-blue mark flash or duplicate marks.
Rotate and resize text and choice fields, return to Fill, and type several values.
Check that the control, text size and appearance keep their orientation without
expanding to the rotated bounds. Repeat after undo/redo and PDF save/reopen.
After filling a PDF, drag a source field, a new shape, a textbox and a
multi-selection in both viewers and backends. Compare repeated drags before and
after filling; check that unchanged fields keep their appearance while moved
fields, clips, stacking and text/search geometry follow the current transform.
Repeat after undo, gesture cancellation, further value changes, source replacement
and backend switching. Change checkbox/radio values quickly during pending
preparation, and verify the latest value appears while active save snapshots
retain their captured values. Browser/GPU drag performance remains a manual check.
Repeat translation over overlapping artwork and partially clipped glyphs; compare
the moving pose with the released result, with no changed stacking, clipping-edge
coverage or selection-frame lag. Compare native and Three WebGL/WebGPU in Grid,
single-page Reader and multi-page Reader, including Reader-to-Grid transitions.
Cancel by Escape, change selection or source during preparation, and switch
backend or mode; verify current geometry, LOD behavior and field values remain
correct. Save/reopen PDF and HEP after releasing and after cancelling a gesture.
For performance comparisons, keep document, zoom, selection and backend matched;
separate initial gesture preparation from repeated moves. Offline CPU timings
and mocked uploads do not establish browser frame rates or GPU performance.
Before entering Edit, print a PDF and a HEP from the main toolbar. Print a
protected PDF using its existing unlock password, and check selected-page scope.
After editing, return to View and print again; verify the retained changes are
included and printing leaves the unsaved-change indicator intact.
Check all four resize corners and rotation while dragging beyond the handles.
Rotate objects and groups, release the handle, reselect them, and check undo/redo.
Rotate a multi-selection and check its frame during the drag and after committing.
Start from a non-grid angle and approach 0°, 45° and negative multiples of 45°.
Check that absolute angles within 5° of each target, including exactly 5°, snap;
angles outside that range remain free. Hold Alt/Option to bypass snapping, then
press and release it without moving the pointer. Release at a new pointer
position and verify the final angle respects the latest modifier state. Check that
**Rotate** follows the displayed frame, accepts signed absolute angles, and leaves
the angle unchanged when the same value is entered twice.
Check that corner cursors follow the frame's angle and the rotation grip remains
outside its top edge at different zooms.
Drag handles beyond a page border and across Reader gaps; they should stay tied
to the selected page rather than stop or jump to an adjacent page.
Move, resize and rotate selections quickly, then release or cancel while a
preview is preparing. Check that objects, frame and handles stay aligned until
the final or restored pose appears, including after switching renderer backends.
Draw pencil strokes at several zooms on rotated/cropped pages, using thin/wide
strokes, transparency and optional fills. Check that the fitted curve, thickness,
colors and opacities stay consistent while drawing, on release and when the
document appears. Delay rendering with several strokes pending; verify there is
no gap or doubled opacity as each matching frame takes over. Check undo/delete,
gesture cancellation, tool/mode/document changes and failed compilation for
stray previews or lost committed strokes.
Repeat with rectangles, ellipses, lines and arrows in every drag direction,
releasing at a new position without another move event. Check directed arrowheads
and closed fills. For polygons/polylines, move the next segment around the first
page, change toolbar styles after the first click, and finish with Enter or
double-click; only clicked vertices and the initially chosen style should commit.
Check repeated vertices and double-click completion for extra endpoints. Draw
several shapes or stamp signatures while earlier drawings are pending, then
return to View; verify independent, continuous handoffs to the rendered document.
Resize images, shapes, signatures and multi-selections with and without Shift;
press and release Shift during the drag and check both preview and final size.
Check textbox wrapping with plain/Shift resizing and appearance scaling with
Alt/Alt+Shift, including textboxes on rotated pages.
Open saved textboxes in Chrome or another independent reader and check letters,
spacing and formatting, including imported fonts and Unicode.
Switch to each drawing, placement, form and Pan tool with objects selected;
confirm that transform handles disappear and the cursor matches the action.
Cancel drags with Escape and switch tools during a pending selection.
Also save protected editable/flattened PDFs, reopen them with the new password,
then remove or replace protection and verify that old passwords stop working.
Rotate cropped pages, remove pages, and insert multiple PDFs, including protected
ones and forms with overlapping field names. Check page order, Reader thumbnails,
search, field editing, undo/redo and PDF/HEP round trips after each operation.

Optional offline comparisons use small synthetic technical/form, book-text, and
image-heavy fixtures. Install the independent pdf.js reference outside the repo,
then generate before/after PDF, baked HEP, rebuilt PDF, and comparison PNGs:

```sh
npm install --prefix /tmp/hepr-editor-reference --no-audit --no-fund --ignore-scripts pdfjs-dist@6.4.299
node scripts/check-editor-visuals.mjs /tmp/hepr-editor-validation
```

The output includes `overview.png`, `book-overview.png`, `image-overview.png`,
and JSON reports. These compare HEPR Canvas2D with pdf.js; they do not measure
browser interaction or GPU rendering.

## Loading documents

`pdfObjectGenerator(source, options, backend)` accepts:

- A browser `File` or `Blob`.
- A `Uint8Array` or `ArrayBuffer` containing PDF or HEP bytes.
- A URL or browser-relative URL path.
- A base64 payload or base64 data URL, such as `data:application/pdf;base64,...`.

URL inputs are fetched, so remote servers must permit your application's
cross-origin requests. For a Node filesystem path, use the repository CLI or
read the file into bytes before passing it to `buildHep`.

The loader detects the format from the source. Set `sourceKind: "pdf"` or
`sourceKind: "hep"` when you need to select it explicitly.

```ts
import { pdfObjectGenerator } from "@soadzoor/hepr/bundler";

const pdf = await pdfObjectGenerator("/documents/plan.pdf", {
  pages: "1-3, 5",
  maxPagesPerRow: 2,
  onProgress: ({ stage, value }) => {
    console.log(stage, `${Math.round(value * 100)}%`);
  }
});

scene.add(pdf);
```

The returned object is a `THREE.Group`. Position, scale, and rotate it like
other scene objects. Frame your camera using the object's bounds; the
[examples](examples.md) include a complete setup.

PDF extraction uses HEPR's native parser and prefers usable output over refusing
a document. Content stays vector-based where possible. When a page cannot be
represented safely as vectors, HEPR can render it as a bounded image while
retaining searchable text. Such pages lose vector sharpness and drawing geometry.
Some unsupported color and gradient behavior is approximated with warnings.
Use `onDiagnostic` to display these warnings; see [rendering compatibility](api.md#rendering-compatibility-and-diagnostics).

PDFs encrypted with the standard password handler (RC4, AES-128 or AES-256)
open directly when they need no password to view, as with documents that only
restrict permissions. Pass the `password` option for documents that require one;
see [password-protected PDFs](api.md#password-protected-pdfs). HEPR does not
enforce permission flags. A missing or wrong password, unrecoverable malformed
resources, resource-limit violations, and features unsupported by both paths can
still reject the load. Display load errors in your application so users can tell
when a document could not be opened.

### Selecting and arranging pages

The `pages` option uses one-based ASCII page numbers:

| Selection | Pages loaded |
| --- | --- |
| `"2"` | Page 2 |
| `"2-5"` | Pages 2 through 5, inclusive |
| `"1-3, 5, 8"` | Several ranges or individual pages |
| `"5-"` | Page 5 through the end |
| `"-3"` | The first three pages |
| Omitted or blank | Every page |

Whitespace is allowed. Duplicate and overlapping selections are merged, and
pages appear in ascending document order. Invalid selections reject with a
`RangeError`. `maxPagesPerRow` controls the composed grid; omitting it lets HEPR
choose a compact layout.

Page selection and grid options apply when loading a PDF. A HEP file contains
an already-composed scene, so these options do not change its pages or layout.

The native and Three demos initially show multipage PDFs and HEPs in **Reader**:
a centered vertical column with ordinary scrolling and lazy page thumbnails.
Use the compact toolbar to jump to a page, enter a zoom percentage, fit the page
width or whole page, find text, or open advanced settings. Ctrl/Cmd+wheel and
pinch zoom the document; unmodified wheel and touch dragging scroll. The
thumbnail sidebar initially opens at viewport widths of 800 pixels or more.
Focus the document viewport to scroll with the arrow keys, Page Up/Down, Home,
and End; editing the page number, zoom, or search field keeps normal input behavior.
Reader can also be selected for single-page documents, which retain their
existing default view.

The demos retain **Grid**, and the Three demo also retains **Sphere** and
**Helix**. Switching back to Reader restores its zoom and reading position.
Reader does not change package loading defaults or the canonical layout saved
by Download HEP.

Download PDF and Download HEP are available inside the expanded Settings panel.
Settings occupies a separate column to the right of the canvas in the native,
Three.js and room detection demos. It scrolls independently and never covers
the document; editing tools stay within the document column. In the native and
Three.js viewers, close Settings to return its space to the canvas, or reopen it
from the main toolbar. Reader retains the reading position and updates Fit Width
or Fit Page for the available space. Select **Hide toolbar** to reclaim its
screen space while keeping your reading position and zoom; use the floating
**Show toolbar** button to bring the controls back.

Search and selection APIs return zero-based page indexes within the composed
subset. Page-scoped progress includes `pageIndex` / `pageCount` for that subset
and `sourcePageIndex` / `sourcePageCount` for the original PDF.

The native and Three demos enable **GPU compress scans** by default. They decode
every selected PDF page before display and prepare bounded scan textures during
parsing, trading longer loading and more CPU memory for faster zoom refinement.
Packed monochrome scans use compact storage; eligible opaque color/grayscale
scans can use lossy BC7/ASTC blocks. Preparation targets image-only pages with a
raster covering at least half the page. Pages with visible vectors or text skip
scan preparation, but still load upfront while the option is enabled. It overrides page streaming,
is bypassed by **Use OCR text instead of scans**, and does not affect HEP loading.
Selecting **GPU compress scans** unchecks both **Use OCR text instead of scans**
and **Stream pages**. Selecting either of those unchecks **GPU compress scans**;
OCR-only viewing and streaming can be used together. HEP loads preserve the
PDF scan-compression choice.

The public API also resolves conflicting PDF options and warns through
`onDiagnostic` and `console.warn`: `ocrTextOnly: true` disables `compressScans`;
otherwise `compressScans: true` replaces `pageLoading: "auto"` with `"eager"`.
When all three are requested, OCR wins and automatic streaming remains available.
The returned `sourceOptions` stores the resolved choices without changing the
caller's options. HEP loads ignore these PDF-only options. See the
[loading options and warning codes](api.md#loading-options).

The Three.js package defaults and demos with **GPU compress scans** unchecked
prepare all selected page overviews before display, then upload the initial
scene once.
They do not rebuild the growing scene or wait for a frame after each parsed page.
The **Stream pages** checkbox opts into viewport-driven loading for PDFs with
more than 16 selected pages, starting from metadata and loading pages near the
camera in one worker. It is unchecked by default; switching it reloads the
retained PDF while preserving the camera and page layout. In the package, use
`pageLoading: "auto"` to stream or `pageLoading: "all"` (the default) to prepare all
overviews. Streaming uses a bounded overview cache; full loading retains every
overview and uses more CPU memory for vector-heavy documents.
Vector pages keep their original geometry at every zoom in both modes.
Image-dominated scanned pages with usable invisible OCR show that text as visible
vectors at a distance, without decoding scan images. Only scans without usable
OCR get small bitmap previews, with a longest edge of at most 96 pixels.
Unsupported drawing features can still use a diagnosed bounded raster fallback.
Scan pixels load when a page occupies more than 256 screen pixels; zooming back
out below 224 pixels restores the OCR vectors or scan preview. The gap prevents
flicker near the transition. At most 12 detailed pages remain cached, with a
further limit based on estimated CPU payload bytes. Vector-only documents return
complete vector scenes after full loading. During streaming, evicted pages
regenerate as you navigate. OCR/scan transitions retain the page geometry, glyph
resources and search index. Scan pixels and coverage mips prepare in a shared
worker, with a cooperative fallback, while the previous representation stays
visible. Submissions are spread across images; Three initializes prepared textures
through its active host before switching page visibility. Recent GPU resolution
tiers stay warm inside
the same automatic raster budget, so repeated zoom cycles can reuse them. Pages
with additional vector paints or clips install their detail geometry once;
compositing effects can still require a diagnosed scene rebuild.
Unloaded pages retain their outlines
and positions. Search progressively loads preview text for the rest of the
document; explicit HEP export compiles the complete original PDF.

Pages waiting for their first overview show an animated book-page skeleton:
a heading and groups of horizontal lines. Native and Three WebGL/WebGPU draw
these shapes analytically in the page background, keeping them sharp at any
zoom without allocating image textures. The skeleton disappears when the
overview arrives. Offscreen or hidden pages do not keep animation running;
the system's reduced-motion preference leaves a static skeleton.

Three.js page demand follows camera projections, including moved or hidden pages.
`pdfObjectGenerator` exposes the current viewing window through `sceneData` and
emits `change` events with `reason: "pages-loaded"` when it changes. Use
`loadCompleteScene({ signal })` for complete geometry analysis, or
`pageLoading: "eager"` when complete original scene data, including decoded scans,
is required before rendering.
Extraction APIs and HEP conversion still produce complete scenes for their selected pages;
the Three example reuses its live PDF session and cached full pages to complete
the export scene once. It serializes that scene without reopening the PDF.
Missing full pages still need compilation;
raster and OCR previews cannot stand in for the original page content.
All GPU integrations allocate small raster display tiers first and increase
their resolution automatically with zoom. CPU canonical image data stays available
for refinement; reducing GPU textures alone does not reduce eager parsing memory.

Native WebGL/WebGPU and both Three material backends retain packed one-bit images
at full resolution and an R8 coverage base at smaller tiers. Their monochrome
mipmaps store four-bit grayscale coverage in a compact atlas, with explicit
bilinear/trilinear shader filtering. This halves the mip payload for large pages
and lowers full-resolution texture memory from about 0.46 to 0.29 bytes per pixel
(roughly 2.70 GB to 1.72 GB for 5.9 gigapixels, before allocation overhead).
Inspect scanned text while zooming through intermediate sizes on each backend;
four-bit mips can slightly change stroke darkness, while close-up binary pixels,
canonical PDF data and exports remain exact. Check repeated OCR/scan swaps for
stall regressions and consistent zoom-out demotion. No compression extension or
additional runtime dependency is needed. Eligible color images can use BC7/ASTC 4x4 through
the host's `ExternalTexture` support, with one shared encoder workspace.
Independent page views share the document's automatic raster memory target.

The native and Three demos offer **Use OCR text instead of scans** for PDF
sources. It reconstructs existing text with vector fonts, preserving
text positions and widths, while skipping scan decoding and scan GPU textures.
Glyphless or missing outlines use bundled substitute fonts.
It is an approximate text-only view: pictures, diagrams, colors, clipping and
annotation appearances are omitted; pages without drawable stored text are
blank and emit a diagnostic. Search and selection remain available. The checkbox
forces text at every zoom; unchecking it restores automatic OCR overviews and
scan detail while retaining the camera and page layout. HEP sources do not
support this option. HEP export uses the original PDF content.

## Rendering and level of detail

The three.js object follows your camera and synchronizes itself during normal
`renderer.render(scene, camera)` calls. Use your existing camera controls for
pan, zoom, and rotation. The object's `fitToBounds()`, `setViewState()`, and
`attachControls()` helpers target its internal fallback view; they do not frame
or control your application's three.js camera.

The standalone viewer renders directly to its canvas through
`WebGlPdfRenderer` or `WebGpuPdfRenderer`. Both backends support
vector content, raster layers, search highlights, and selection highlights.
See the [API reference](api.md) for integration points.

Vector LOD simplifies stroke geometry according to the current view, aiming for
roughly 50,000 visible strokes. Large drawings build a fine representation and
additional overview levels. When a tile exceeds its budget, overview levels can
omit tiny marks and merge nearby lines more aggressively. This trades some fine
detail and hatch density for performance while keeping vector rendering.
The HUD labels these selections `(overview)` and shows the total target.

LOD construction keeps the original tolerances and level-selection rules. It
streams completed paint groups, stores merge membership as compact source IDs,
and builds geometry in fixed-size chunks. All levels share one stroke store:
a simplified record that is bit-identical to its source stroke refers to that
stroke instead of copying it, and only records that differ are stored, once.
Levels share culling bounds per stored stroke. Native backends upload the
canonical strokes and these LOD-only records into shared exact/LOD GPU textures
directly from their arrays, without a combined CPU copy. Three data textures
upload one array each, so Three stroke materials read two texture sets: the
canonical strokes' complete rows, viewed in the scene's own arrays, and a
second set holding their partial last row and the LOD-only records. Recoloring
an individual stroke copies the style data of both sets on first use.
Selection scratch grows with visible work.
These storage changes preserve the geometry, paint order, clipping, and detail
transitions of the existing LOD hierarchy; they do not skip levels to meet an
allocation budget.

For a bounded Node measurement on an existing HEP (without PDF conversion or a
browser), run `node scripts/benchmark-vector-lod-memory.mjs path/to/file.hep`.
`--output=path.json` records a parity snapshot; `--compare=path.json` checks every
level's geometry bits, paint origins, spatial buckets, and sampled zoom/pan
selections. Add `--ordered` to include ordered draw preparation and its first
overview frame. Node process memory is a comparative measurement, not an iOS tab
memory estimate. See [the memory optimization report](vector-lod-memory.md) for
measurements, changed files, and device verification steps.

Tiles that fit their budget retain exact or fine geometry. Very dense views can
retain coarser overview levels when zoomed in: front-facing and tilted views
prioritize the budget over the usual 5-pixel overview error limit only when the
whole visible draw list exceeds the soft budget. Hatching in affordable views keeps its usual
detail even when individual tiles exceed their share. Detail returns as the
visible tiles fit their budget; zoom alone does not force every tiny mark to render.
Tilted three.js cameras choose detail per tile:
content near the camera receives more of the budget and finer geometry, distant
content thins out, and tiles outside the view are skipped. The antialiasing filter
still fades retained thin strokes continuously. The target is soft: limited
simplification, clipping, or complex compositing can keep a document above it.
Stationary tilted views reuse their tile decisions and instance lists when the
projection, depth clipping, viewport, detail scale and visibility inputs match.
Perspective pans, zooms and orbits recompute those decisions; affine views can
also reuse guarded selections during small pans.
Set Vector LOD to Off for exact strokes at every zoom. Embedded PDF images remain raster layers.

The Draw counter reports selected vector representatives. During native cached
panning it describes the cached content, not a fresh submission of every stroke
on each frame. Compare direct rendering as well as panning when profiling the
native and Three.js viewers.

| `vectorLod` | Behavior |
| --- | --- |
| `"auto"` (default) | Enables LOD for large stroke scenes. |
| `"off"` | Uses exact strokes. |
| `"force"` | Enables LOD preparation even below the usual size threshold. |

Change the mode with `pdf.setVectorLodMode(...)` and inspect the result with
`pdf.getVectorStrokeLodStats()`.

Text has a separate `textLod` option. The default `"auto"` uses coarse runs for
subpixel text clusters; `"off"` selects exact glyphs. To disable raster glyph
atlas rendering, set `vectorOnly: true`.

HEP avoids PDF extraction, but large scenes still need LOD preparation and GPU
upload. The Vector LOD hierarchy is rebuilt during loading rather than stored
in the HEP file. Use `onProgress` to keep loading feedback visible through
these stages.

## Cancellation and cleanup

Pass an `AbortSignal` when the user can switch documents or close the viewer
before loading finishes:

```ts
const controller = new AbortController();
const pending = pdfObjectGenerator(source, { signal: controller.signal });

// In your document-switch or teardown handler:
controller.abort();

try {
  const pdf = await pending;
  scene.add(pdf);
} catch (error) {
  if (!controller.signal.aborted) throw error;
}
```

Cancellation covers source reads, parser workers, HEP loading, LOD preparation,
and provisional renderer resources. Synchronous work stops at its next
cooperative checkpoint; an image decode already running may finish first.

Once an object has been returned, the application owns it. Remove it from the
scene and dispose its resources when replacing or closing the document:

```ts
pdf.removeFromParent();
pdf.dispose();
```

Dispose any separately created text selection controller as well. Keep the
previous document visible until a replacement loads successfully, and abort
superseded loads to avoid unnecessary work.

## Search and text selection

Use `hasSearchableText` to check for an extracted text index. `searchText()`
returns matches in page and reading order; queries are case-insensitive by
default and can span whitespace and line breaks. `setSearchHighlights()` draws
the results and emphasizes the current match. Your application owns the search
field, next/previous navigation, and camera movement.

Text selection is optional. `createTextSelectionController()` connects your
canvas and coordinate transforms to desktop drag selection, double-click word
selection, touch long-press selection, drag handles, and clipboard copy.

Call the controller's `updateOverlay()` after rendering to keep touch handles
aligned with the camera. After swapping renderer backends, call
`refreshHighlights()`. Dispose the controller during teardown.

Search and selection work with both PDF and HEP scenes that have extracted
text. See the [examples](examples.md) and [API reference](api.md) for adapters,
highlight coordinates, and copy behavior.

## Drawing selection

The standalone viewer, Three.js example, and room detection demo share a
**Drawing Selection** checkbox that starts unchecked. Enable it to trace
geometry on hover and select a primitive with a click or tap. The
panel shows its reference and geometry information and lets you change vector
colors temporarily. Images can be selected but not recolored. Dragging and
pinching still move the view; text-selection gestures are suspended until you
turn drawing selection off in viewers with text selection. Empty clicks and
Escape clear the selection. The cursor becomes a pointer over selectable
geometry. In the room demo, selection targets the underlying drawing primitives;
room detection and TSV overlays remain independent.

On the first hover or click, a progress bar shows **Preparing drawing selection**
with the percentage of preparation work completed. It disappears when picking
is ready. You can continue panning and zooming while it prepares, or turn
Drawing Selection off to cancel preparation.

**Reset selected** restores one selected primitive's original color;
**Reset all colors** restores all overrides. Turning the checkbox off clears
interaction state and releases its extra resources. Opening another document
clears selections and overrides; switching rendering backends preserves them.
These changes are never written into exported PDF or HEP files.

Library hosts can opt into the shared `createThreePrimitiveInteractionController()`
or handle their own events with `pick()`, `getPrimitive()`, `setHover()`,
`setSelection()`, and the primitive override methods. See the
[examples](examples.md#pick-inspect-and-recolor-drawing-primitives).

## PDF layers

The native viewer, Three.js example, and room-detection demo share a collapsible
**PDF Layers** panel that displays the PDF's optional
content groups in their original hierarchy. Filter by name, toggle visibility,
use **All** to show or hide all editable layers (including layers hidden by the
filter), or choose **Reset to PDF defaults**. **All** shows a mixed state when some
available layers are visible. Locked layers are disabled; radio groups
allow only one enabled member. PDFs without layers show an empty state.
Bulk enabling preserves the current radio-group choice, or picks an available
default/first member if none is enabled. **All** becomes checked when every
compatible editable layer is enabled, so it can then be unchecked to hide them.
Drawing Selection details show associated layer names and IDs. A primitive can
depend on several layers or a negated visibility expression.

Layer controls work independently of Drawing Selection. Hidden geometry is
excluded from picking and hidden text from search and text selection. Hiding a
selected primitive clears its trace while preserving its temporary color for
later reappearance. Switching backends keeps the layer state; opening another
document restores that document's defaults.

Most visibility changes only invalidate rendering and text caches. Compatibility
effects that need regenerated images show preparation progress; the previous
applied state remains visible until preparation finishes. Failed changes show an
error and leave that state intact. View-mode runtime layer choices are not exported.
Edit mode provides the authoring controls described under **Layers** above;
their default-visibility and layer changes are saved in PDF and HEP.

Layer eligibility is cached when visibility changes. When every paint is visible,
rendering uses the ordinary culling and batching path without scanning layer
conditions each frame. Layer boundaries remain in the document's canonical data,
but compatible visible ranges can share a GPU draw. Native renderers can also
batch overlapping solid paints with identical colors: normal source-over blending
produces the same result in either order. Different colors and blending effects
retain their ordering dependencies. Temporary primitive recoloring disables this
color-based optimization until the overrides are cleared. Ordinary paint groups
use the direct rendering path; opacity, masks, knockout, and blend effects still
require compositing surfaces.

Dense native drawings use a cached paint schedule for the complete scene. Visible
strokes from different OCGs can share a draw, and disjoint stroke/fill/text paints
can be regrouped while preserving overlap dependencies. Panning and layer changes
filter that schedule instead of repeating the batching search. Coverage-scale
changes during zoom, or temporary color overrides, can require a new schedule.
This trades some subset-specific batching opportunities for cheaper camera updates;
the scheduling search remains bounded for heavily overlapping drawings.
Dependency margins follow the renderer's coverage: strokes include their width
and screen-space antialiasing, while fill and transformed glyph quads need only a
small rasterization margin around their existing bounds. Zooming out therefore
does not artificially expand fill/text dependencies by the larger stroke margin.
Overlapping paints still retain their required order, including all stroke LOD
levels; unknown projection scales keep source order.

For scenes with explicit paint order, native and Three.js rendering also omit
redundant opaque straight strokes from their temporary draw lists. Comparisons
require matching color, caps, clipping, and exact collinearity, within compatible
paint-order regions. A covering stroke
must be selected by the current layer, viewport, and LOD state. Hiding its layer
restores any previously covered stroke; recoloring a solid stroke, fill, or text
instance suspends this optimization until its overrides are cleared. Curves,
translucent strokes, incompatible paints, and compositing effects remain intact.
Like the former extraction-time containment optimization, this can reduce the
extra antialias edge darkening from repeated opaque strokes; it does not use the
old geometric tolerances to remove nearby distinct lines.

The live **Draw** counter reflects these omissions, with **redundant strokes
omitted** reported separately. The document's **culled** statistic still describes
permanent extraction-time removals and may remain zero. Canonical geometry and
primitive references are preserved for picking, inspection, and export. Existing
HEP files benefit without regeneration. Decisions are reused until the selected
stroke IDs or relevant appearance state change. When IDs change, only affected
collinear groups need their coverage recomputed; packed culling metadata adds
runtime memory proportional to the stroke count.

For manual performance verification, compare panning and zooming the same drawing
at the same viewport, DPR, zoom, and LOD settings. Check all layers visible, a subset
hidden, and a recolored overlapping stroke or fill followed by resetting its color.
Check that a contained stroke reappears after hiding its covering layer, and
compare coincident stroke edges at high zoom with the previous optimized output.
Also check native WebGL/WebGPU and switching backends. Draw-call reductions in
non-browser tests do not by themselves establish an FPS or GPU-time improvement.

Native ordered batches also skip geometric rectangle clips when the complete
paint bounds, including every stroke LOD level and screen-space coverage margin,
are strictly inside the entire rectangle clip chain. Clipping stays active near
edges, for polygon clips, and when a conservative projection scale is unavailable.
Canonical clipping metadata remains intact. WebGL retains compatible texture and
vertex state between batches; devices without enough combined texture units use
the original binding layout.

For temporary performance captures in the main viewer, select **WebGL** or
**WebGPU**, load the drawing, then run this in the browser console:

```js
heprPerf.start({ maxFrames: 1200 });
```

Pan or zoom for several seconds, then run:

```js
heprPerf.stop();          // CPU timing and batch-counter tables, plus the report
copy(heprPerf.json());    // Chrome DevTools helper: copy the report for comparison
```

`copy()` is a DevTools utility, rather than a browser JavaScript function. If it
is unavailable in your console context, evaluate `heprPerf.json()` as a separate
command, then right-click the returned string and choose **Copy string contents**
in Chrome/Edge DevTools.

In the native viewer, `heprPerf.status()` reports whether a document is committed
and source preparation, scene loading, layout changes or backend switching are
still active. It includes the loading tokens and pending source count for
diagnosing a document that remains marked as loading after it becomes visible.

Capture panning and zooming separately, with the same viewport, DPR, LOD settings,
and visible layers when comparing versions. Capture is off by default, stops after
the requested number of rendered frames (600 by default), and also stops when the
document or renderer is replaced; demand-driven page updates keep it running.
`heprPerf.report()` reads the current report;
starting again clears the previous capture. The report includes the starting view,
drawing label, settings, per-frame averages/percentiles for CPU phases, batch and
upload counters, and sampled GPU command-span timing when supported.

Ordinary captures omit the per-instance fill, image and gradient quad-area
estimates. Enable them separately when investigating geometry or clipping:

```js
heprPerf.start({ maxFrames: 1200, geometryDiagnostics: true });
```

These native WebGL diagnostics scan submitted instances and add CPU work to
captured frames, including the `drawSubmission` section. Compare ordinary
captures when assessing frame rate or submission cost. The report's
`geometryDiagnostics` field records whether they were requested; omitted
estimate counters do not mean that their area was zero. `gpuOperations` does
not enable geometry diagnostics.

Native WebGL, native WebGPU and the Three.js material paths can submit
consecutive ordinary fills and strokes in a shared vector batch while retaining
their paint order. Both viewers expose the `heprPerf.mixedVectors` debug switch
to compare this path with separate fill and stroke draws:

```js
heprPerf.mixedVectors(false);
heprPerf.start({ maxFrames: 1200 });
// Pan at a fixed zoom, then stop and save the baseline.
heprPerf.stop();
copy(heprPerf.json());

heprPerf.mixedVectors(true);
heprPerf.start({ maxFrames: 1200 });
// Repeat the same pan, then stop and save the batched capture.
heprPerf.stop();
copy(heprPerf.json());
```

Warm up each path before recording and use the same document, viewport, DPR,
zoom and visible layers. Leave `geometryDiagnostics` disabled in both captures.
The report context records the requested `mixedVectorBatching` setting.
Composited draws keep their existing paths. In Three.js, the switch applies to
the loaded PDF object, including its page views and native texture fallback;
library hosts can call `pdfObject.setMixedVectorBatchingEnabled(enabled)` and
read `pdfObject.getMixedVectorBatchingEnabled()` directly.

Native `mixedVectorBatches` and Three.js `three.mixedVectorBatches` count combined
submissions. Three.js `three.mixedVectorInstances` counts their primitives.
Native `mixedVectorInstanceUploadBytes` and Three.js
`three.mixedVectorInstanceUploadBytes` record changed instance data. Unchanged
plans reuse the mixed instance buffer. The Three.js layer borrows the existing
fill and stroke textures, including the split stroke-LOD store, and retains
per-instance page transforms and clips. Other paint kinds and blend modes end
a mixed batch. `three.mixedVectors` times collection, ordering and preparation
of the shared Three.js batches.

Optional shader preparation keeps the original draws available. WebGPU may
continue using them until asynchronous pipeline preparation finishes, so warm
up before recording and check the mixed-batch counters to confirm activation.
Unsupported contexts or shader failures use separate draws and emit a
diagnostic. WebGPU queue submission batching is separate from this optimization:
combining command buffers alone still retains every draw inside them.

To isolate GPU fill and stroke work, both viewers also expose
`heprPerf.vectors("all" | "fills" | "strokes" | "none")`. Changing this mode
stops the current capture before changing visibility. It leaves the camera,
LOD settings, page backgrounds, text and raster images in place. Each new
capture records `context.fillRendering` and `context.strokeRendering`.

```js
heprPerf.mixedVectors(true);
heprPerf.vectors("all");
// Warm up, then capture a small pan at a fixed zoom.
heprPerf.start({ maxFrames: 1200, maxFrameRecords: 240 });
// Repeat the same movement for each mode.
heprPerf.stop();
copy(heprPerf.json());

heprPerf.vectors("fills"); // Repeat warm-up and capture; save a separate report.
heprPerf.vectors("strokes"); // Repeat warm-up and capture.
heprPerf.vectors("none"); // Optional background/text/raster reference.
heprPerf.vectors("all"); // Restore the drawing when finished.
```

Use the same starting view, viewport, DPR, layers and movement for all runs.
Reset to the same fitted view before warm-up and keep zoom fixed during pan
comparisons: fractional-pixel camera alignment changes subpixel fill work.
Keep mixed batching enabled: compatible paints retain their shared draw while
the vertex shader rejects the disabled kind, avoiding a return to thousands
of separate submissions. Check mixed-batch counters after warm-up; unsupported
or composited paints can still use separate draws. For Three WebGL, pass
`webglCalls: false` to `start` when comparing GPU load without GL-call wrappers.
Compare sampled GPU milliseconds and CPU submission time. GPU timings for the
isolated modes are not additive, and utilization alone does not measure time
per frame. Library hosts can use the PDF object's `setFillRenderingEnabled`,
`getFillRenderingEnabled`, `setStrokeRenderingEnabled` and
`getStrokeRenderingEnabled` methods directly.

Ordinary fill uploads use conservative bounds from the decoded line endpoints
and quadratic control hulls, shared by culling, paint ordering and spatial
indexes. Open paths retain the union of the original and decoded bounds.
Closed paths whose decoded hull is no larger than a pixel's filter footprint
use their precomputed signed area with the existing fill rule, without reading
any segments. A footprint containing the whole hull takes the exact area. One
reaching only part of the hull takes the share of the hull's width and height
that it overlaps. That share is exact for axis-aligned rectangles and keeps each
path's total ink, but other subpixel shapes may move some ink between the at
most 2×2 pixels they touch: up to a third of a right triangle's area, or about
6% of a circle's. At overview zooms of dense drawings, this removes the segment
loop from nearly every fill fragment. Larger paths and open paths keep the
segment calculation. Flat views use a tighter fill quad margin matched to the
filter width. Three.js WebGL/WebGPU also tighten closed-fill quads in projected
views when the bounded viewport footprint and analytic hull checks prove that
every filtered pixel remains covered. Both ordinary and mixed vector draws use
this proof. Uncertain projections, fills outside the sampled viewport, fills
needing the general projection limiter, and compositor targets retain their
existing margins. There is no camera-angle cutoff.

Ordinary native and Three.js fills also defer spatial-index header reads until
the area shortcut does not apply. Segment coverage checks the cell index
first and reads a band header only when the path has no cell index; paths
without either index retain their direct segment scan. This avoids index reads
for pixels answered by the area shortcut and reduces vertex texture inputs in
mixed fill/stroke draws.

Paths with fewer than 24 segments skip both headers even when the document has
indexes for other paths. Both index builders already leave these small paths
unindexed; the builders and shaders share that threshold so the direct scan
uses the same geometry and coverage calculation.

Native and Three.js WebGL/WebGPU also use tighter draws for sparse compound fills whose
closed contours occupy distant parts of one large bounding box. Renderer-only
contour groups share the original edges and retain nested or overlapping
contours together. At each scale, groups draw separately only when their padded
bounds cannot overlap; coarser groups or the original whole fill handle larger
pixel footprints. Derived groups keep edge integration instead of introducing a
new subpixel area approximation. Unknown projected scales retain whole fills.
Three bounds inverse pixel footprints across the viewport and neighbouring
derivative samples using each page's Float32 planar projection. This supports
tilted perspective, orthographic and custom projective transforms, including
rotated, reflected, sheared and nonuniformly scaled pages. Selection uses the
largest bound across visible pages, with no camera-angle cutoff. Stronger
foreshortening can select coarser groups or whole fills when pixel footprints
could overlap. A horizon crossing the sampled viewport, singular or numerically
uncertain projection, or a viewport mapping entirely behind the eye retains
whole fills. Reduced-resolution Three composite surfaces also keep whole fills;
native compositing retains canonical fills because its surface resolution can
change independently of the presentation viewport.
Individual fills inside large paint runs are culled against a guarded viewport,
so small pans reuse instance uploads. Source geometry, paint order, clipping,
primitive picking/color IDs and HEP exports remain unchanged; existing HEPs need
no regeneration. Three mixed batches, page tables and compositor subsets use the
same derived contours. Folded opacity and soft masks retain every selected part
of their canonical paint, refreshing their geometry when the selection changes.
Three performance captures report `three.fillSelectionActive` (eligible layers)
and `three.fillSplitPaths` (canonical sparse paths selected for contour groups),
so a capture can distinguish active selection from projection/compositor fallback.
`three.fillProjectedPaddingEligible` counts layers with a known direct-rendering
footprint; each fill still checks its own hull before tightening its quad.

Segment coverage also integrates a quadratic directly when its control hull
fits inside the footprint. After clipping a curve to the pixel's rows, its
remaining piece can use the same exact integral if its control hull stays
inside the pixel columns. Curves crossing a column boundary retain the
existing subdivision calculation. The shared GLSL/WGSL helper applies this
shortcut to ordinary fills, gradients and glyph outlines across both native
and Three.js backends.

`transitionSections` measures work between frames, including `pageSwap.decode`,
`pageSwap.rasterPreparation`, `pageSwap.total`, `rasterRefinement.prepare` and
`rasterUpload.submit`. `rasterUpload.cacheHit` identifies texture reuse, and
`rasterUpload.threeHost` measures Three host texture initialization before the
page switch. Cold scene generations also record composition, preparation,
`pageSwap.textLod`, `pageSwap.textUpload`, and native scene/atlas construction. `transitions` keeps the latest 120 events. These spans
can overlap, and worker preparation includes queue/wait time; upload submission
measures CPU wall time rather than asynchronous GPU execution. Compare the first
zoom-in with repeated OCR/scan cycles when investigating a stall.

To see which GPU work fills that span, add `gpuOperations: true`:

```js
heprPerf.start({ maxFrames: 1200, gpuOperations: true });
```

On one frame in eight, never one sampled for the frame span, every draw, clear
and blit gets its own GPU timer query. `gpu.operations` then reports:

- `frameMs`, the summed operation time per timed frame. Compare it with
  `gpu.frameMs`: a sum far below the span means the GPU spent the rest waiting
  for commands, so submission (browser, ANGLE or driver) is the limit. A sum near
  the span means GPU execution is the limit.
- `byLabel`, time and operations per frame for each program and target, such as
  `fill → offscreen` or `composite:softMask → offscreen`. Native WebGL names its
  programs, and compositor passes by kind; other hosts show `program#N`.
  `msPerFrame` is the mean; `medianMsPerFrame`, which orders the list, is not
  inflated by a one-off stall such as the first frame after a document loads.
- `slowest`, the 16 slowest single operations, with vertex and instance counts,
  viewport, scissor and blit area. One stall can fill this list.
- `typical`, the 16 slowest operation positions in the frame (`order`), each by
  its median over the timed frames that reached it (`frames`). When frames issue
  the same operations, as while panning at one zoom with the whole document in
  view, this names the draws that cost time in every frame.
- `byPosition`, every such position in frame order, with its label, instance
  count and median, so that the whole frame can be accounted for.

Native WebGL fill and gradient-fill operations also include `source`: up to 32
canonical path IDs (`ids`), their clip roots (`clips`, with -1 meaning no clip),
and `truncated` when more instances were submitted. For indirect fill draws,
`first` is an instance-buffer offset; use `ids` to locate the source paths.
Mixed vector operations include `source.kind: "mixed-vector"` and parallel
`kinds` entries identifying each fill or stroke ID. Fill IDs remain canonical;
stroke IDs address the combined canonical/LOD stroke store.
Position summaries describe the first sampled draw at that position; later
frames can select different paths as visibility and scheduling change.

Native WebGL batches compatible small images into bounded atlases, including
inside transparency groups. Other consecutive images can share one draw using
up to fourteen original textures, with a separate clip root on each instance.
Texture selection uses at most four comparisons per fragment; two additional
fragment samplers remain available for clipping and a folded soft mask.
These texture batches preserve the original hardware mip filtering and do not
copy image pixels. They flush before vector paints, compositor transitions,
folded paints and Multiply passes; tiled images retain individual quads.
`rasterAtlasBatches`, `rasterStripBatches`, `rasterTextureBatches` and
`rasterStandaloneDraws` count submissions. `rasterInstances` counts all image
instances, and `rasterTextureBatchInstances` counts those using texture batches.
Atlas storage retains independent mip chains and reuses them during camera
motion. Images fall back to individual draws if batch resources are unavailable.

Native WebGL also bounds ordinary fill quads by each instance's clip-chain
bounds in the orthographic view. The original path coverage, cell-index origin,
clip tests, masks and paint order remain intact. With `geometryDiagnostics: true`,
`fillUnclippedQuadPixelsEstimate` counts their original expanded quad areas and
`fillQuadPixelsEstimate` counts the bounded areas, both intersected with the
viewport and rounded outward. Overlapping instances count again; these are
area estimates, not actual shaded pixels or GPU instructions. Compare them to
see whether bounding removes work in the current view. `fillClipBoundedInstances`
counts smaller quads and `fillClipCulledInstances` counts empty quads.
`fillClipBoundsAvailable` reports whether bounds were uploaded,
`fillClipBoundsTexels` counts their records, and `vectorClipStoreTexels` counts
the original clip/index store's records. Bounds occupy their own texture,
limited by the device's texture dimensions, so a full clip index store cannot
disable quad shrinking.
Clip geometry with identical Float32 coordinates shares GPU storage across
parents and fill rules, while each clip retains its own header. When the clip
store cannot fit a polygon's finest cell grids or its band index, it retains
the coarser complete grids that fit before falling back to a full edge scan.
This changes the candidate lookup, not the geometry or fill rule. `vectorClipUniquePayloads`
and `vectorClipSharedPayloads` count distinct payloads and nodes reusing them.
`vectorClipRectangleNodes`, `vectorClipCellIndexedNodes`,
`vectorClipBandIndexedNodes`, and `vectorClipUnindexedPolygonNodes` count nodes
using each layout; `vectorClipCoarsenedCellNodes` counts cell-indexed nodes with
finer levels removed to fit the budget. These are whole-document upload
statistics, independent of the current view, and shared nodes count separately.
`fillClipBoundsTestedInstances` counts fills with an available clip bound,
including those whose path bounds already fit inside it. These diagnostics
distinguish disabled bounds from clips that remove no area. Allocation failure
warns and retains the original quads and exact clip tests. Projected views
retain their original expansion and omit the area estimates. The area
calculation runs only while a capture with geometry diagnostics is active.

Native WebGL original-texture image batches also bound their quads by each
image's clip chain in the orthographic view. Inverse transforms are cached per
image and clip; the vertex shader expands them for the live antialiasing
footprint. Mirrored, rotated and sheared images retain their UV interpolation,
mip filtering, masks and paint order. Projected views and unstable inverses
retain the original image quad. With `geometryDiagnostics: true`,
`rasterTextureUnclippedQuadPixelsEstimate` and `rasterTextureQuadPixelsEstimate`
estimate the original and bounded image areas. They count outward-rounded
world bounding boxes intersected with the viewport, including overlaps, so
rotated image estimates can exceed actual quad area. They cover texture
batches; standalone images and atlases are excluded.
`rasterTextureClipBoundsTestedInstances`, `rasterTextureClipBoundedInstances`,
and `rasterTextureClipCulledInstances` report tested, smaller and empty image
quads. These diagnostics omit projected views and add no area scans to ordinary
captures. Compare GPU spans without operation timing as well as a separate
capture with operation timing, since individual timer queries add overhead.

Original-texture image batches cache their instance buffers and VAOs by paint
position. Comparing all instance values before each draw
keeps cached geometry current when visibility, clips, transforms or opacity
change. Textures, camera uniforms, masks and compositing state are bound live.
The cache holds at most 512 batches and 4 MiB of GPU instance data, plus an equal
CPU copy for comparison. Unused trailing slots and document replacement release
their resources. Batches beyond either limit use the streaming path; allocation
failure warns once and retains streaming draws. During captures,
`rasterTextureBatchCacheHits` and `rasterTextureBatchCacheMisses` count reused and
uncached batches, `rasterTextureInstanceUploadBytes` counts actual image-instance
uploads, and `rasterTextureBatchCacheBytes` reports resident instance bytes.
Panning or zooming a stable batch sequence should produce cache hits and no
image-instance uploads after the cache is warm. This reduces submission work
without changing the draw count.

Each timed operation runs between its own queries, so the GPU cannot overlap it
with its neighbours, and those frames run slower. Operation times can therefore
add up to more than an untimed span. The context's own methods are restored
when the capture stops.

On WebGPU, GPU times come from timestamp queries, which the native renderer
requests when the adapter supports them. Every render pass of a sampled frame
writes a timestamp at its start and end. `gpu.frameMs` spans the frame's first
pass's start to its last pass's end. With `gpuOperations`, each operation is a
whole render pass, and its `instances` count the pass's draws. Compositor passes
are labelled `span`, `fold`, `clear` and `composite:<kind>`, and the pass that
presents to the canvas is `frame`. Chrome rounds WebGPU timestamps to 100 µs
unless its WebGPU developer features (`chrome://flags`) are enabled, so pass
times need that flag. The Three example on WebGPU uses Three's own timestamps:
its `gpu.frameMs` is the sum of the frame's render passes, without the gaps
between them.

For loading stalls or tab reloads in the Three example, expand **Settings**,
enable **Record loading diagnostics** before opening the document, then tap
**Copy load report**. **Show load report** exposes selectable text if clipboard
access is unavailable. Alternatively, open `three-example.html?loadDiagnostics=1`
to enable recording for that page load. After an unexpected reload, return to
Settings and copy the recovered report; a retry includes the previous attempt.
The console equivalents are `heprLoad.report()` and `heprLoad.json()`.

Reports with `capture.uiVersion: 2` also include the current checkbox state,
whether recording was enabled at the last load hook, the number of load-hook
calls, and current viewer/loading state. Show/copy feedback identifies reports
without load checkpoints explicitly. These fields help diagnose an empty report
without attributing it to a crash or memory exhaustion. Enabling diagnostics
during a load arms the next load; reopen the document to capture it from the start.

These opt-in reports include parsing progress, Reader page preparation, shader
compilation, first submission, warm-up, and browser error or device-loss events.
Resource snapshots count deduplicated CPU backing buffers and estimate exposed
geometry/texture payloads, including dormant owned layers, without reading pixels
or querying the GPU. GPU byte estimates describe the footprint if these resources
are uploaded, rather than current GPU allocations. They omit
JavaScript objects, strings, workers, driver memory, render targets and some
WebGPU-private resources. `jsHeap` is null when the browser does not expose heap
statistics. Resource scan time is recorded as `snapshotMs`; saving checkpoints
also adds overhead. Times include async
waits and command submission; they do not measure GPU execution.

Checkpoints are saved in this tab's session storage on phase changes and at
throttled progress intervals; the report says when storage is unavailable.
Recovery is best effort: an interrupted record does not prove a crash or memory
exhaustion. Reports include the file name, browser and settings, without document
text or pixels. Recording is disabled by default and checking the box arms the
next load; use the URL option to keep it enabled after reload.

To isolate initial Reader preparation, compare the same document/backend with
`three-example.html?loadDiagnostics=1&initialLayout=grid`. This diagnostic option
starts in Grid and avoids creating all independent page views and shared page
batches during loading. Changing to Reader later still prepares them. Reader is
the normal multipage default.

Reader page views reuse contiguous canonical text buffers; clip-index remapping
keeps a private copy where needed. Shader preparation follows the rendering path
selected by the current page transforms and appearance, including page overlays.
Pages translated within one plane share a single inverse viewport calculation
in tilted perspective views as well as orthographic views. Bounds include a
conservative antialiasing margin; horizon-crossing views and independently
rotated/scaled pages retain general per-page viewport derivation.
For compatible static documents, page handles retain transforms, picking and
interaction state without allocating independent paint textures or materials.
Shared page batches also release the dormant original document materials.
Independent rendering constructs the required materials synchronously before
the page's first frame, replaying current appearance and layer settings; returning
to the canonical document layout reconstructs its original materials as needed.
Changing layouts or page appearance can therefore add preparation on first use.
Streaming documents and documents requiring paint compositing keep their existing
preparation path.

The Three example also exposes `heprPerf` for render captures. Reports with
`context.diagnosticsVersion: 3` include the source kind (PDF/HEP), scene
geometry/clip/raster counts, transparency-group structure, Three revision,
browser and shader-error-check setting. These describe the loaded scene, without
exporting document text, shader source or image pixels.

Version 3 also records `context.initialCamera` and camera values in every retained
`frameRecords[].context`: position, quaternion, up vector, controls target,
distance to target, vertical FOV, aspect, near/far planes and camera zoom.
`cameraTiltDegrees` is measured from the world XY plane's normal (the example's
PDF plane): 0 is top-down and 90 is edge-on. `controlsChanged` is 1 when
MapControls moved the camera during that frame, otherwise 0. `cameraZoom` is the
Three camera's projection zoom; the existing `zoom` and `unitsPerPixel` describe
the derived PDF view. Snapshots are detached numeric values, so moving the camera
later does not change earlier records.

Three CPU sections split `render` into `three.sync` (PDF preparation and
compositing) and the remaining outer host render. Inside `three.sync`,
`three.schedule`, `three.strokeLod`, `three.textLod`,
`three.vectorUpdate` and `three.textUpdate` identify camera-dependent work.
Within `three.vectorUpdate`, `three.strokeLodSelection` measures stroke ID
selection, including projected tile culling, error/reach checks and any budget
retry. `three.strokeLodInstances` measures preparing the selected instances or
refreshing unchanged selections, including any nested batch updates. The earlier
`three.strokeLod` section only handles LOD visibility/scale setup.
`three.strokeLodSelections` and `three.strokeLodReuses` count recomputed and reused
selections per frame; recomputation does not necessarily change the resulting
IDs. `three.strokeLodInstanceUpdates` counts calls that prepare instance lists,
not completed GPU uploads. `three.strokeLodVisibleTiles` and
`three.strokeLodActiveLevels` describe the selected workload.
`three.batchRebuild` and `three.batchUpdate` are nested within layer updates.
`three.batchCandidateInstances` counts candidate IDs visited when assembling
batches, before visibility/redundancy filtering; repeated passes count again.
Ordered stroke LOD batches visit selected IDs only, so this work follows the
visible selection rather than the combined size of all stored LOD levels.
`three.compositor` includes setup, batch lookup/geometry preparation, target
binding, `three.hostDraw` (batches that draw paints) and `three.hostPass`
(batches of composite passes alone). Consecutive compositor operations
into one surface share a batch. `three.hostRenders` counts full calls to the
host's `render(scene, camera)`; `three.directPasses` counts batches drawn through
the specialized compositor path. Inside `three.compositorSetup`,
`three.compositorCollect` measures proxy/range-index maintenance and
`three.compositorSelection` measures visible-paint selection. Compare collection
with `three.scheduleChanges` to diagnose zoom replans. These sections overlap:
do not sum parent and child durations.

`three.cachedPaintPlans` counts frames that replay a stable compositor plan;
`three.paintPlanBuilds` counts frames that rebuild it. Visibility revisions,
paint selection, proxy replacement, surface size and fold eligibility invalidate
the plan. Projected rectangles and computed mask vectors still update every
frame. `three.cachedProxyLookups` and `three.cachedGeometrySelections` count
reused draw lookups and complete geometry selections.

Native WebGL and WebGPU also replay stable paint plans. Their `cachedPaintPlans`,
`paintPlanBuilds` and `paintPlanOperations` counters describe this reuse. Canonical
span coverage is resolved once per paint selection; LOD-only batch changes
refresh the batch intervals without rescanning the full canonical paint list.

Unmasked singleton Darken groups drawing exact black at full group opacity share
ordinary source-over spans. Black Darken is equivalent to alpha blending even at AA edges
and over a translucent background. A global tint that changes black restores
the Darken boundaries while retaining equal-color batching. Different gray
Darken paints retain their order and composite passes because merging them can
change overlapping antialiased pixels. These runtime optimizations also apply
to existing HEP files; re-export is unnecessary.

On Three revision 186, `three.glAutoUniformUploads` counts compositor draws
whose changed material lets Three upload uniforms automatically;
`three.glForcedUniformUploads` counts draws that require an explicit refresh,
including consecutive uses of one material. Other hosts or unverified revisions
keep explicit refreshes. During Three WebGPU compositing, eligible uniform groups
upload their complete CPU buffer once rather than each small changed range.
`three.gpuRequestedBufferWrites` counts these requests before the existing packed
upload, while `three.gpuBufferWrites` counts actual queue uploads. The complete
updates reduce request/copy count but increase `three.gpuStagedUploadBytes`.

Ordinary Three WebGPU fill draws use an opacity/surface-mask shader variant
without the fifteen computed-gradient mask uniforms. `three.surfaceFoldDraws`
counts these draws; paints that compute a gradient mask keep the full shader.
Both variants share live paint, clipping and fold inputs and prepare their
programs before the first draw, including hidden paints that can appear later.

Private Three compositor scenes draw meshes in queued order with host sorting
temporarily disabled. Surface dependencies and opaque/transparent transitions
still split batches; the host's sorting setting is restored after each render.

On Three revision 186, WebGL records the frame's target switches, bounded clears
and batches, then initializes their geometry in one private driver render.
Its driver hook replays the batches through Three's `renderBufferDirect`, with
the usual object/material hooks and matrix updates. `three.directFrame` measures
the driver render including replay, so it overlaps `three.hostDraw` and
`three.hostPass`. WebGPU draws each batch through Three's render-object managers
without repeated scene traversal, render-list construction or sorting. Shader,
geometry, binding, pipeline and texture ownership stays with Three, and each
WebGPU pass gets a fresh render ID for its live mask and opacity inputs.
For the Broschuere workload this replaces 72 full compositor renders with one
on WebGL and zero on WebGPU; its drawing and surface-pass dependencies remain.
These counts exclude the application's outer render and presentation draw.
Unknown renderer versions and unsupported host states use the regular path,
visible as full calls in `three.hostRenders`.

During a Three WebGL capture, existing GL calls are timed by default. The
`gl.*` sections distinguish shader-source setup, compilation, linking, program
use, shader/state queries, buffer/texture uploads, drawing, clears, readbacks
and synchronization. No additional GL query, shader check, readback, flush or
wait is issued. `frameRecords[].events` retains up to eight longest instrumented
calls of at least 8 ms, with names such as `gl.getProgramInfoLog` or
`gl.bufferData`, plus slow compositor submissions. A slow GL call can include
a driver wait; it does not establish pure GPU execution time.

Per-frame counters include schedule changes, batch/material creation, selected
paints, per-kind draw submissions, requested live-instance upload bytes, surface
allocation/clear work, program/texture/geometry counts, and LOD selection.
`three.surfaceBytes` is the compositor's RGBA surface estimate, not total GPU
memory; `three.textSelectionUploads` is a cumulative LOD-runtime count, whose
change between frames identifies an upload. Counts of rendered instances are
sampled before compositing hides the layer meshes. `context.frameGapMs` on
each frame preserves long gaps excluded from the interval summary, and the
bounded record selection prioritizes neighbours of major CPU stalls after
the slowest CPU/GPU and highest-draw frames.

Detailed GL timing adds diagnostic overhead. Use
`heprPerf.start({ webglCalls: false })` for a Three capture without GL-call
wrappers; CPU phase timings and the existing optional GPU timer remain.
Wrappers are removed on stop, automatic capture completion, backend replacement
and disposal. `context.webglCalls` reports which methods could be instrumented.
Three WebGPU reports phase/counter diagnostics without WebGL-call or GPU-query
timings.

To compare top-down and tilted performance, open the same region of the same
document with the same backend, viewport, DPR and LOD settings. Let loading and
initial camera movement settle before each capture. Save one report top-down
and a second at the slow tilt; use similar small pans in each, without changing
the tilt during the capture. Leave per-operation GPU timing off and disable GL
wrappers for this initial comparison:

```js
heprPerf.start({ maxFrames: 1200, maxFrameRecords: 240, webglCalls: false });
// Make similar small pans, then let controls settle. Repeat for each view.
heprPerf.stop();
copy(heprPerf.json()); // Chrome/Edge DevTools helper; save each report separately.
```

The example renders on demand, so a stationary view may produce only a few
frames. Compare CPU section summaries and sampled GPU time, not just the FPS
readout. Stationary tilted views can reuse stroke selections. Perspective pans,
zooms and orbits still recompute them; affine views can also reuse small pans
within a guarded selection. A similar Draw count can therefore
have a different CPU cost. High `three.strokeLodSelection` or
`three.strokeLodInstances` time points to that preparation path; high GPU time
with low CPU preparation instead calls for investigating the rendering work.
CPU and GPU spans overlap and must not be added. Send both complete JSON reports.

To investigate the HEP-only Broschuere zoom pause, collect two reports:
one HEP and one PDF, using a fresh page load for each and the same WebGL backend,
viewport, DPR, layer visibility and LOD settings. Open the document, start
capture before the first zoom, pan briefly, then zoom until the HEP stalls.
Zoom out and repeat the movement once to distinguish first-use from repeat
stalls. Follow the same movement for the PDF.

```js
heprPerf.start({ maxFrames: 1200, maxFrameRecords: 240 });
// Pan/zoom, including the first zoom and one repeated zoom.
heprPerf.stop();
copy(heprPerf.json()); // Chrome/Edge DevTools helper
```

Send both complete JSON reports. They should identify whether the pause is in
scheduling/LOD, resource uploads, shader/program queries, or another submission
phase. A browser Performance trace may still be needed for browser-internal
work such as garbage collection.

Native panning, inertia, zooming and settled frames all render directly using
the current camera and viewport. Vector LOD and visibility selection remain
active during movement; no previous pan image is reused.

Native WebGL captures include `gradientFillSubmission` and
`gradientStrokeSubmission` CPU sections. These sum gradient setup and draw
submission per frame and can overlap the broader `drawSubmission` section.
`gradientAnalyticFillDraws` / `gradientMeshFillDraws` distinguish bounding-quad
fills from mesh fills; the corresponding `...Segments` counters count submitted
fill-path segments, and `gradientMeshTriangles` counts mesh triangles.
`gradientStrokeDraws` and `gradientStrokeSegments` count submitted stroke runs
and their segments. These include repeated draws in compositing passes.

`gradientFillClipPolygonEdges` and `gradientStrokeClipPolygonEdges` sum the
original polygon edges in each submitted draw's clip chain; packed rectangle
clips are excluded. These counts stay unchanged when clip indexing is active.
`gradientFillIndexedClipNodes` and `gradientStrokeIndexedClipNodes` count indexed
polygon nodes across the same chains, including repeat visits in separate draws;
they confirm indexing is active, not how many candidate edges the GPU examines.
Dense clips use horizontal bands over their original edges at upload time, with
the existing full scan retained when indexing is unsuitable or exceeds its
memory budget. Both native and Three WebGL/WebGPU rendering benefit; these
gradient-specific console counters remain native WebGL only.

Bands stop helping once they are thinner than a pixel: every pixel then visits
all the segments in its rows. Every backend therefore indexes fill paths,
gradient fill paths and clip polygons with a multi-level grid of cells as
well (`src/vectorCellIndex.ts`). A fill pixel reads the finest level whose
cells are at least half its footprint, so it visits at most three cells each
way at any zoom, and gets the same coverage as the unindexed sum up to
rounding. The index is built when a scene is uploaded (about 0.3 s for the
Broschuere HEP). Paths are indexed from the largest down within the available
texture capacity, and a path left out keeps its bands. Clips have no per-path
edge cutoff or default index-to-edge allowance. Large collections of small
contours can use cells even when bands scan hundreds of unrelated edges at
close zoom. Cell construction stops when further refinement no longer reduces
candidate work, coordinate precision prevents refinement, or the next complete
level would exceed the texture capacity. It keeps complete coarser levels;
bands and the complete edge scan preserve the original geometry when needed.
The packed GPU format uses exact Float32 addresses, with a capacity of 2^24
texels independently of available memory. Native WebGPU passes the cell
headers in its camera uniforms, Three's WebGL materials set `uFillCellHeaders`
and its node materials take `fillCellBase`. Three's layers do not know the
device's texture limit until upload, so they initially use the packed format's
capacity and adapt their stores to the host renderer during upload.
A host that reuses the GL fill
shaders and never sets the cell uniforms (`uFillCellHeaders`, `uCellHeaders`)
leaves them at zero, which means no cells.

Antialiased clips test a 4×4 grid of samples over the pixel. Each node of the
clip chain clears the bits of the samples outside it, reading only the cells
(or bands) that hold the samples, and the pixel's coverage is the share of
samples left. Every backend does this; the GLSL and WGSL clips read the same
layout.

These shaders issue several texture reads before using any: most of a
pixel's time is the latency of its reads, and a draw takes as long as its
slowest pixels. A fill cell's line pieces take one texel each, read four at a
time; only the few cells holding a curve read a second texel per piece.

With `geometryDiagnostics: true`, for analytic fills in the main orthographic view,
`gradientAnalyticFillBBoxPixelsEstimate` sums viewport-clipped bounding-quad
areas in framebuffer pixels, rounded outward. It includes overlap and ignores
geometric clips, scissor rectangles, transparent pixels, and early exits;
projected views and mesh fills are excluded. Multiplying each quad's estimate
by its clip-chain polygon edge count produces
`gradientAnalyticFillClipEdgeTestsEstimate`, the **unindexed full-scan baseline**
upper-work estimate. It is not the actual indexed candidate count or a GPU
instruction count, and should not fall merely because clip indexing is enabled.
Compare sampled GPU time and corresponding `frameRecords` before and after the
change at the same zoom, viewport, DPR, and visible layers. Diagnostics
do not scan fill segments or clip edges in the render loop and remain off
unless a capture with geometry diagnostics is active. Draw, segment and
clip-header counters remain available in ordinary captures.

Both native renderers clamp each analytic gradient fill's quad to its clip
chain's bounds, widened by the one-pixel coverage margin; nothing outside them
survives the clip. `gradientAnalyticFillQuadPixelsEstimate` sums the clamped
quads the same way, so it can be compared with the unclamped bounding-quad
estimate above. Projected views keep whole quads and are excluded. The Three
materials clamp their gradient quads too. Three always projects through its
local-to-clip matrix, so the margin there is the largest at any corner of the
clamped rectangle, which all four corners agree on.

`foldedPaints` counts compositor group chains drawn as a single paint. A chain
of Normal-blend groups holding one fill path, analytic gradient fill or image
(no knockout, at most one soft mask) scales that paint by the groups' opacity
and mask instead of rendering group surfaces and composite passes. A soft mask
without a transfer function is rendered but not converted: the folded paint
reads the mask's content and computes its alpha or luminosity over the mask
backdrop itself, so the mask needs no conversion pass. A mask with a transfer
function is still converted by its own pass first. Native WebGL folds these
chains; native WebGPU and both Three backends fold fills and analytic gradient
fills (`three.foldedPaints` in Three), but not images.

In Three, a folded paint whose soft mask holds one analytic gradient fill, and
nothing else, computes that mask itself (`three.computedMasks`), so the mask
needs no surface or render at all. The gradient must be axial or radial and
not masked by another gradient. Its outline, and its one clip beyond the
folded paint's own chain, must be convex and made of line segments, with up to
eight edges between them. The paint must be in front of the camera, with no
colour override. Any other mask is rendered as above.

While the Three compositor renders, it turns off WebGPURenderer's lighting,
which none of its materials use, and restores it afterwards. With lighting on,
every `renderer.render()` call rehashes the scene's lights node.

On WebGPU a clear is a render pass of its own, and in Three also a queue
submission. The native and Three compositors therefore clear a surface as the
next pass that renders into it loads. A surface that is read, or partly copied
into, before anything renders into it is still cleared on its own
(`three.clearPasses` in Three).

The [Broschuere gradient investigation](broschuere-gradient-performance.md)
documents a dense polygon-clip hotspot and recommended comparison captures.

The report also includes up to 120 `frameRecords` with the camera and viewport,
CPU phases, batch/instance counts, and GPU timing for the same frame when sampled.
It selects slow frames and evenly spaced examples when the report is requested;
selection and sorting do not run in the render loop. Use
`heprPerf.start({ maxFrames: 1200, maxFrameRecords: 240 })` for more examples, or
`maxFrameRecords: 0` for aggregate summaries only. These records distinguish a
costly batch rebuild from a view that repeatedly needs many draws. Missing GPU
timings mean that frame was not sampled or its result was unavailable, not zero
GPU work.

GPU timer queries are asynchronous, sampled every fourth frame, and never wait for
the GPU or force a flush. Unsupported timer queries, disjoint clocks, and dropped
samples are reported explicitly. CPU timings measure JavaScript/submission work;
they do not include asynchronous GPU execution or all browser layout/compositing.
CPU and GPU spans overlap and must not be added. The GPU query brackets the frame's
command stream, including possible gaps while the CPU prepares more commands; it
does not measure only time spent executing shaders.
Frame intervals describe rendered frames, with idle gaps over 250 ms excluded;
they are not an automatic continuous FPS benchmark. Profiling itself has overhead;
`heprPerf.start({ gpu: false })` provides a CPU-only capture. Rendering remains
unchanged by the capture, and the HUD text updates at most ten times per second
while camera and interaction processing continue every frame.

The Three.js example preserves applied layer visibility when switching WebGL/WebGPU
backends, including a panel change still finishing when the switch begins. Layer
changes refresh search and clear stale text selections without moving the camera.
In the room-detection demo, PDF layers control the drawing; detected rooms and TSV
overlays retain their separate visibility controls. Layer toggles do not rerun room
detection. Opening another document resets the layer panel to that PDF's defaults.
Hosts can mount `createThreePdfLayerControls()` for an object that may be replaced,
mount `createPdfLayerControls()` directly, or use the
[layer APIs](api.md#pdf-layers-optional-content) with their own controls.

## Annotations

All three demos show a collapsible **Annotations** panel below **PDF Layers**. It
lists the document's annotations, such as comments, markups, stamps, form fields
and links, with their type, page and text or link target. Popups and annotations
the PDF marks as hidden are not listed. Every row has a checkbox. Turning an
annotation off hides its drawn appearance and stops its bubble, link preview and
link activation. **All** turns every annotation on or off. While a filter is
active it becomes **All matching** and affects only the matching annotations,
for example every link. The filter matches type, page, text, author and ID. Long
lists show the first 500 matches; refine the filter to reach the rest.

A change reaches bubbles and links at once, and drawn appearances once the
renderer applies it. Some appearances cannot be hidden: those on pages drawn as
a single image, and all appearances in HEP files converted before annotation
layers existed. For these, turning the annotation off only stops its bubble and
link. Switching backends keeps these choices; opening another document turns
every annotation on again. Annotation choices are never exported. Hosts can
mount `createPdfAnnotationControls()` or use the
[annotation APIs](api.md#hiding-annotation-appearances) with their own controls.

## HEP files

HEP (`.hep`) stores a pre-parsed document for reuse. It includes geometry, page
layout, a searchable text index, and optional raster layers. Load it through
the same `pdfObjectGenerator()` entry point as a PDF.

Create a HEP file from a PDF source or an already-loaded scene:

```ts
import { buildHep } from "@soadzoor/hepr/bundler";

const fromPdf = await buildHep(pdfSource, { pages: "3-5" });
const fromScene = await buildHep(pdf.sceneData, {
  sourceLabel: pdf.sourceLabel
});
```

The result is an `application/x-hep` `Blob`; save or upload it with a `.hep`
filename. Exporting a loaded scene reuses its parsed data, including original
PDF layer defaults, hidden geometry, and retained fallback resources. The original
PDF is not required to replay those resources after reopening the HEP file.

By default, `buildHep` uses DEFLATE compression and stores ordinary color rasters
as the smaller of WebP or PNG, with raw RGBA as a fallback when encoding is
unavailable. Eligible oversized JPEG 2000 images retain their original JPX
compression at full resolution. Their pixels undergo no additional lossy
quantization, avoiding the much larger PNG that can result when an image exceeds
WebP's 16,383-pixel dimension limit.
This reduces file size and export encoding work. Full-resolution decoding still
requires memory for the image pixels and codec workspace.

This retention applies to unsigned eight-bit opaque Gray/RGB images decoded by
the bundled codec, with original dimensions, unchanged color interpretation,
absent or identity `Decode`, and no masks or embedded opacity. Images requiring
other color conversions, precision changes or reduced resolution use ordinary
encoding. Eligible images retain their originals through retained page rendering
too, including when a different image's mask requires that path.
Export checks fingerprints of the canonical pixels and original
encoded bytes; edited pixels or stale provenance use ordinary encoding too.
These checks detect accidental changes, not cryptographic tampering.

Set `encodeRasterImages: false` to store decoded raster pixels and disable
original JPX retention. Set
`compression: "store"` to write uncompressed container sections without native
compression stream APIs. Such files can also be loaded without native
decompression streams. Both options can increase file size.

`buildHep` includes applicable vector and text LOD caches by default. Set
`withVectorLod: false` and/or `withTextLod: false` to omit them for smaller files.
Vector caches share unchanged canonical strokes and identical derived records
across levels. Spatial indexes are rebuilt
cooperatively on load, with cancellation support; expensive simplification is skipped.
Text caches include runs, clusters and
coarse instances. Export reuses an available build or creates the requested
LOD. Text caches are omitted when the scene does not qualify for text LOD.

Stored vector LODs default to compact precision; text LODs remain lossless. Vector
caches omit tile indexes and share identical derived records. Vector v5 also
references canonical shape points instead of repeating their coordinates, when
this reduces actual compressed storage; other exports retain v4. Encoding
predicts repeated coordinates/bounds from existing strokes and packs text
metadata into numeric columns. Both caches and compact vector precision are
automatic when applicable:

```ts
const hep = await buildHep(pdf.sceneData);
```

Set `vectorLodPrecision: "lossless"` (CLI: `--vector-lod-precision=lossless`)
to disable additional rounding.

Compact mode rounds derived vector coordinates to power-of-two grids no larger
than 1/32 of the finest referencing level's simplification tolerance. Per-axis
rounding error is at most half a grid step. For example, tolerance 0.5 uses a
1/64-unit grid; a record used only at tolerance 32 can use a 1-unit grid. Shared
records keep the finer precision. Rounding displacement is added to the level's
selection tolerance, preserving the renderer's screen-space error budget.
Exact canonical geometry, stroke widths/colors/opacity and clipping windows stay
unchanged. Bounds cover the rounded geometry, and tile indexes are rebuilt from it.
Text LOD storage remains lossless. Very large coordinates outside the compact
integer range retain lossless storage with a warning. Re-exporting a compact
cache preserves its existing rounding; selecting lossless does not recover
precision already discarded. Rebuild from the original PDF or compact HEP
without LODs to recover the original LOD geometry.

Source-point recipes preserve all existing derived geometry, paint order, styles
and LOD levels. They expand once during loading, with no work added to the render
loop and no LOD simplification. This storage is shared by native and Three WebGL
and WebGPU backends. Existing HEPs can adopt it through the LOD repacker below;
the storage-only repacker changes physical codecs and leaves LOD schemas intact.

Text LOD v3 predicts run transforms and bounds from the canonical glyphs, then
stores exact XOR corrections. Coarse glyph transforms and colors reuse those
predictions. This avoids storing the same geometry several times while preserving
every decoded cache value. Existing text LOD v1/v2 remains readable and can be
repacked without parsing the PDF or clustering the text again.

On load, matching caches skip simplification and clustering. Missing caches are
built when the viewer needs them. Invalid or incompatible caches produce a
console warning recommending regeneration and fall back to normal generation.
Vector and text cache versions are independent of each other and of the HEP
scene/container versions. Older viewers can ignore the optional sections.
Version 1 caches remain usable with a warning recommending re-export/repacking
for smaller files; no simplification or clustering is repeated. The reader also
recovers the v1 JSON null sentinel for exact-only text nodes. GPU upload and
mutable selection state are still prepared at load time.

Fresh HEP exports build vector LOD geometry without allocating viewer culling
bounds, tile indexes, or selection buffers. These are reconstructed when the HEP
opens. Exporting a scene with an existing LOD hierarchy reuses that geometry.

Both example viewers' **Download HEP** button offers independent vector/text
checkboxes when applicable, checked by default. Cancel or Escape stops the
export. Vector LOD offers Lossless and Compact precision choices, with Compact
selected by default. Downloads with either LOD option use a
`-parsed-data-lod.hep` suffix.

Monochrome scans always use the fast, lossless binary encoding with DEFLATE,
falling back to plain packed pixels when binary runs would grow. Each click
downloads one `-parsed-data.hep` file, or `-parsed-data-lod.hep` when LOD is
included. When neither vector nor text LOD is available, export starts without
a dialog. Full-resolution image quality is preserved. Older HEPs containing
original JBIG2 streams remain readable and use the fast encoding on re-export.

Download HEP reuses a complete loaded scene immediately. For paged viewing, it
reuses the existing PDF worker and cached full pages, loading only the remaining
complete content. Export
leaves the viewing window unchanged and releases the temporary full scene afterward.

Exports compare the complete HEP against the original PDF's byte length and
show a warning when the HEP is at least as large. Downloads still succeed and
retain all selected LOD caches. The viewer displays both file sizes after the
download; library callers can use `onWarning(message)`. A custom scene or an
older HEP without a recorded source size needs the
`sourcePdfByteLength` build option for this check.

The builder accepts `signal` and `onProgress`, including LOD building, raster encoding and
container build progress. Browser and Node exports use the same format but may
differ in encoded image bytes.

The loader supports HEP containers v1–v4 with scene schemas v9–v16. Scene v13
stores repeated transparency wrappers and matching draw-run metadata compactly,
preserving the original group boundaries and paint order exactly. Exports use it
when repeated wrappers can share storage. Scene v14 stores compact raster repeat
grids, v15 shares repeated raster sections, and v16 stores eligible original JPX
streams in validated `HJP1` envelopes. Only exports using original JPX storage
need a v16-capable reader; other exports keep the scene version required by their
stored features, and older v9–v15 files remain supported. New exports use
container v2 when an exact stroke-style palette saves space, or v3 when lossless
integer encoding shrinks
the existing vector LOD bytes. Connected clip outlines use v4 when endpoint
chaining reduces storage. These files require an updated viewer. Existing
v1–v3 files remain supported. These encodings preserve every decoded section
byte; optional LOD caches are separate sections. Earlier scene schemas
must be regenerated from the original PDF; repacking a container cannot restore
layer definitions or content omitted by an earlier conversion. The
[container specification](HEP_CONTAINER.md) describes the binary format and
resource limits.

## Node conversion

Node applications need the optional canvas backend for PDF operations that use
Canvas2D and for decoding encoded HEP images. npm installs `@napi-rs/canvas` as an
optional dependency by default. Browser-only consumers can use
`npm install @soadzoor/hepr three --omit=optional`. If the native backend's
installation fails or optional dependencies were omitted, install it explicitly:

```bash
npm install @napi-rs/canvas
```

Library vector/text-only extraction does not need this dependency. Without an encoder,
HEP raster export falls back to raw RGBA and can produce much larger files.
The CLI checks for the canvas backend before converting so PDFs that need raster
fallback can be processed; if it is missing, the CLI prints installation
instructions. Normal repository installs also include the canvas backend.

Offline conversion compiles every selected page's complete original content,
but does not prepare or store GPU display caches. The **GPU compress scans**
viewing option does not apply to `PDFtoHEP.js` or `buildHep`; enabling preparation
alone would add conversion work without changing the saved HEP. Monochrome scans
still use the fast, lossless binary storage, and viewers build display data on load
or zoom. Normal Node provides Canvas2D rather than the WebGL context needed to
prepare BC7/ASTC color blocks.

The npm package includes the `pdf-to-hep` CLI for single-file and batch conversion.
It includes applicable vector and text LOD caches by default, using compact vector
precision. It requires Node.js 22.15+, 23.5+, or 24+ and runs the compiled library
without a repository checkout or development dependencies:

```bash
npx @soadzoor/hepr ./Level1.pdf
npx @soadzoor/hepr --output-dir=./heps ./pdfs
npx @soadzoor/hepr --without-vector-lod --without-text-lod --output-dir=./heps ./pdfs
npx @soadzoor/hepr --without-text-lod --vector-lod-precision=lossless --output-dir=./heps-vector-lod ./pdfs
npx @soadzoor/hepr --force ./pdfs
npx @soadzoor/hepr --workers=4 --output-dir=./heps ./pdfs
npx @soadzoor/hepr --log-file=./conversion.log ./pdfs
npx @soadzoor/hepr --annotation-appearances=none ./pdfs
HEPR_PDF_PASSWORD='secret' npx @soadzoor/hepr ./protected.pdf
```

For repeated use, install the package in your project and invoke its executable:

```bash
npm install @soadzoor/hepr
npx pdf-to-hep ./Level1.pdf --output-dir=./heps
npx -- pdf-to-hep --help
```

If a one-off `npx` run cannot load canvas, install both packages in the same project
with `npm install @soadzoor/hepr @napi-rs/canvas`, then use `npx pdf-to-hep`.
Installing canvas only in the caller's directory does not add it to an existing
`npx` cache installation.

The repository's existing command remains available after `npm install` and uses
the same flags:

```bash
node PDFtoHEP.js --output-dir=./heps ./pdfs
```

### Thumbnail CLI output

The thumbnail CLI options below are available in this checkout. Until a release
containing them is published, invoke `node bin/pdf-to-hep.js` locally. Prepare
its compiled runtime with `npm run build:lib` after installing dependencies;
the launcher does not start a development server.

```bash
# One overview image: drawing-thumbnail-p1.webp
node bin/pdf-to-hep.js ./drawing.pdf --output=thumbnail

# A transparent PNG of page 2, with a 160-pixel longest side
node bin/pdf-to-hep.js ./drawing.pdf --output=thumbnail --thumbnail-page=2 --thumbnail-max-dimension=160 --thumbnail-format=png --thumbnail-background=transparent

# Thumbnail and canonical HEP for each PDF, sharing document/font preparation
node bin/pdf-to-hep.js ./pdfs --output=both --output-dir=./output
```

| Flag | Behavior |
| --- | --- |
| `--output=hep\|thumbnail\|both` | Select generated artifacts. Default: `hep`. |
| `--thumbnail-page=<number>` | One-based source PDF page, independently of HEP page layout. Default: `1`. |
| `--thumbnail-max-dimension=<pixels>` | Positive integer longest output side; preserves aspect ratio. Default: `400`. |
| `--thumbnail-format=webp\|png` | Lossless WebP or PNG. Default: `webp`. |
| `--thumbnail-background=<color>` | HEPR color string, such as `"#ffffff"`, `rebeccapurple`, or `transparent`. Default: white. |

Thumbnail-specific options require `--output=thumbnail` or `--output=both`.
Each PDF produces one thumbnail. For `drawing.pdf`, page 1 is named
`drawing-thumbnail-p1.webp`, or `.png` when PNG is selected. Output goes beside
the source unless `--output-dir` is supplied. Diagnosed PNG fallback also uses
`.png` and reports the actual output filename. Page and format affect the
thumbnail filename; dimension and background do not. Existing artifacts are
skipped independently, so `both` generates a missing thumbnail while keeping an
existing HEP, or generates a missing HEP while keeping an existing thumbnail.
Use `--force` after changing options to replace existing outputs.

If WebP encoding falls back to PNG, a diagnostic identifies the actual `.png`
filename, which is also recognized on later skip checks. Forced WebP regeneration
replaces the previous WebP/PNG variant only after the new image is committed.
The output table reports generation/write time in milliseconds or seconds;
per-PDF progress and batch wall time also include opening and worker overhead.

`both` uses one reusable document session. Thumbnail approximations remain
separate from full-quality HEP geometry, fonts, images and applicable default
LODs. A thumbnail failure, including a requested page absent from the PDF, is
reported as a failure while canonical HEP generation is still attempted.
`--keep-unchanged` applies to HEP output and requires `hep` or `both` mode.

The remaining batch-conversion details describe the default HEP output mode.

Directory input is scanned recursively and converted in isolated child processes,
with one worker per available CPU thread, capped by the number of pending PDFs.
Whenever a child finishes, its slot takes the next PDF without waiting for other
conversions. Each PDF gets a fresh child process to release its memory after
conversion. A single PDF still uses one conversion
process. `--workers=<count>` accepts a positive integer to override the automatic
count; use it to reduce concurrency, or `--workers=1` to run serially.
Progress lines identify their PDF. The terminal ends with a table showing only
the filename, conversion status, duration, PDF size, HEP size, and percentage size
change. Smaller HEPs appear green and larger HEPs red when the terminal supports
color and `NO_COLOR` is unset. The final metrics table reports attempted,
successful, failed and skipped counts, warning and raster-fallback counts, total
conversion time, average and median attempted conversion times, batch wall time,
and original PDF and saved HEP size totals for successful conversions. Existing
output skips are excluded from timing and size comparisons. Summed conversion
durations overlap in parallel and can exceed wall time.

PDFs with identical content are converted once per batch. Pending PDFs that share
their exact byte size are compared by SHA-256 before dispatch; each later copy
receives a copy of the first one's HEP (cloned on copy-on-write filesystems such
as APFS) and appears as `duplicate` in the table. Successful copies are included
in attempted and successful counts, original PDF and saved HEP byte totals,
size comparisons, and raster-fallback counts. The duplicate count is a subset
of successful outputs. Timing statistics use actual copy time; estimated
conversion time saved is reported separately. Warning totals count diagnostics
actually emitted, without repeating the identical PDF's warnings for each copy.
The diagnostics log names the PDF each duplicate matched. If that PDF
produces no HEP, its duplicates are converted normally. Only HEPs written by the
current batch are copied; with `--force --keep-unchanged`, a duplicate's existing
HEP is kept when it already has the same bytes. HEP files do not record their
source file name, so a copy is identical to a conversion of the duplicate.

Detailed worker output, warnings, errors, and full file paths are saved to
`pdf-to-hep-<timestamp>-<unique>.log` in the current working directory. The terminal
prints its location. Use `--log-file=<path>` to choose a different file; an
existing file is appended to. The log groups diagnostics by PDF, including
affected pages and reasons for selective raster layers or whole-page raster
rendering. Original PDF images, font/color approximations, and failed conversion
attempts are not counted as raster fallback in generated HEPs.

Each child retains its own heap limit of 12288 MiB by default (not preallocated).
`HEPR_PDF_TO_HEP_HEAP_MB` or the parent's `--max-old-space-size` overrides this
per-child limit. This heap setting is independent of worker scheduling. Typed
arrays and canvas allocations are outside the JavaScript heap. Ctrl+C stops new
dispatch and cancels all active children; a second signal force-stops them. Failed
conversions do not stop other PDFs.

`Level1.pdf` produces `Level1-parsed-data.hep` beside
the input unless `--output-dir=<directory>` is supplied. Output-name collisions
are rejected. Relative input and output paths use the current working directory.
Existing files are skipped; `--force` replaces them only after a
successful conversion. `--annotation-appearances=render|forms|none` chooses which
annotation appearances become page content (default `render`); annotation metadata
is kept in every mode. PDFs that require a password take it from
`--password=<password>` or, kept out of process lists and shell history, from
the `HEPR_PDF_PASSWORD` environment variable; the same password is tried for
every PDF, and the HEP output is not password protected. Use `--help` for the
complete command syntax.

The flags `--without-vector-lod` and `--without-text-lod` independently disable
the corresponding stored caches. Use both for a file without stored LODs. These
flags do not change the CLI output filename; use a separate output directory to
keep files with and without caches side by side. Existing outputs are skipped
even when the LOD options change; use `--force` to replace them. The JavaScript
`buildHep` API also includes both applicable caches by default; pass
`withVectorLod: false` or `withTextLod: false` to omit either one.

For the bundled examples, run `npm run regenerate:heps` manually. It writes
to `public/examples/heps` and updates the manifest with file sizes. The
example menus offer one **HEP** action per PDF, using the file with stored vector
and text LODs. This action appears only when that file is present in the manifest.

To shrink existing HEPs while preserving every decoded section byte, including
all LOD levels, precision and indexes, run the storage repacker:

```bash
node --experimental-strip-types scripts/repack-hep-storage.mjs /path/to/heps
```

It measures only by default. Add `--write` to atomically replace files that become
smaller, after verifying the changed sections. It accepts individual HEP files
or directories, never parses PDFs or recalculates LODs, and leaves unrelated
sections in their original encoding. New integer chunks require HEP container
v3 support; connected-path chunks require v4. Use Ctrl+C to cancel, or `--timeout-ms=N` for an optional
per-file deadline.

To shrink already-generated example caches by sharing geometry and changing
their cached representation without parsing PDFs or repeating
LOD simplification, run:

```bash
node scripts/repack-hep-lods.mjs --write public/examples/heps
npm run generate-manifest
```

The second command refreshes the manifest after successful repacking. The tool
rebuilds spatial indexes to verify the result; it never generates missing LOD
geometry. The underlying tool defaults to measurement only, supports individual
files, and has a hard 60-second deadline per file in isolated workers:

```bash
node scripts/repack-hep-lods.mjs public/examples/heps/Level_1-parsed-data.hep
```

For an older HEP without recorded PDF size, add
`--source-pdf="/path/to/original.pdf"` for a single HEP file. This reads only the
PDF's file size and enforces the same strict budget; it does not parse the PDF.

`--write` enables atomic replacement, only when smaller. Repacking verifies
canonical section bytes and all decoded LOD data against the expected lossless
or compact result before writing. Invalid/missing caches are rejected
without starting a LOD build. Existing files are unchanged during measurement.

The worker heap ceiling defaults to 12,288 MiB for dense documents. Override it
with `HEPR_PDF_TO_HEP_HEAP_MB` or Node's `--max-old-space-size=<MiB>` argument.
The CLI reports per-file and total attempted conversion times.
