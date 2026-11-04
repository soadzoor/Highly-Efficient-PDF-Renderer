# Recognizing scanned text

HEPR can recognize image-dominant pages without usable stored text, then make
the result selectable, copyable and searchable. Recognition adds invisible
text metadata; it preserves the scan's appearance and original PDF bytes.
It skips pages that already have usable text. Recognizing individual scan
regions on a mixed text/image page is not currently supported.

## Viewers

Both example viewers have a **Recognize scanned text** checkbox beside the other
text settings. It is checked by default and tries browser-native recognition
after displaying the first frame. Uncheck it to cancel pending work; completed
text stays available. The checkbox preference is remembered on this browser.
An inline status identifies browser or local recognition and its current stage.
Where native recognition is unavailable, **Use local OCR** allows the optional
engine/model download. That separate choice is also remembered. **Retry** retries
failed attempts and scans where no usable text was found, while retaining
completed text. Merely checking recognition does not authorize downloading
the optional PaddleOCR engine.

The fallback uses PaddleOCR.js 0.4.2 and the multilingual PP-OCRv6 small models
in a dedicated worker. It prefers WebGPU. If a large GPU detector returns no
boxes or inference fails, it first retries that GPU with a 1536-pixel detector
image. The SDK maps boxes back to source coordinates and reads line crops from
the original scan at the configured DPI (300 by default). A successful GPU
recovery is reused for later pages in that worker. Healthy GPU runs and CPU-only
hosting retain the SDK defaults.
Reducing detector resolution can change detected regions, line grouping and OCR
text; it does not guarantee identical results or handwriting accuracy.

If GPU recovery fails, empty or invalid output is verified on CPU with the same
pixels, models and original detector parameters. Confirmed GPU failures retain
the CPU engine. If both engines find no text, subsequent pages can still use
GPU acceleration. Status identifies GPU, CPU, or mixed execution and shows
elapsed inference time. Console diagnostics include initialization timing,
detector overrides and total worker time. Download completion does not mean
recognition has finished; CPU inference can still take substantial time.
Only engine/model assets are requested over the network;
document pixels are processed on the device. Models use CacheStorage when
available, while the browser manages caching of runtime assets. Storage policy,
eviction, and an uncached runtime can still require a connection on reopening.
The viewer's `ViewerPaddleOcrAssets` configuration supports explicit detection
model, recognition model, and ONNX Runtime WASM directory URLs for self-hosting.
Example-viewer integrations can set `detectorMaxSide` in
`ViewerPaddleOcrOptions` or `ViewerTextRecognitionControlsOptions` to a positive
pixel target, or to `"source"` for full-resolution detection. An explicit value
disables the automatic detector-size override. `"source"` also removes the SDK's
implicit 4000-pixel detector ceiling; larger targets remain available to callers.
These options affect local PaddleOCR detection, while native OCR and library
providers keep their own policies. Recognition crops always use source pixels.
Initialized local models remain available between documents in the same viewer.
Turning recognition off or closing the viewer releases them. Cancelling an
active inference terminates its worker, so the next attempt may initialize again.
The viewer also reuses recognition results for identical scan pixels during its
lifetime. This cache stores text and positions in memory, without retaining
page pixels or writing document text to disk; turning recognition off clears it.
Empty results are not cached across documents. If recognition finishes without
usable text, status says **no text found** instead of **complete**.

Native recognition depends on the browser's `TextDetector` API. It remains
experimental in Chromium; OCR working inside a browser's own PDF viewer does
not establish that this API is available to an application. HEPR detects support
and initializes the API, without requiring browser flags.

## Library loading

Library recognition is disabled by default. Opt into native recognition with
`textRecognition: "auto"`, or provide a local fallback:

```js
import { pdfObjectGenerator } from "@soadzoor/hepr/bundler";

const pdf = await pdfObjectGenerator(file, {
  textRecognition: {
    dpi: 300,
    languages: ["en"],
    fallback: () => createApplicationOcrProvider(),
    onProgress: progress => console.log(progress),
  },
  onDiagnostic: diagnostic => console.warn(diagnostic),
});

pdf.addEventListener("change", event => {
  if (event.reason === "text-recognized") {
    // Refresh the application's active search/highlights without moving its camera.
  }
});
```

`createApplicationOcrProvider()` is supplied by the host application. HEPR does
not import an OCR package or choose download URLs for library callers.
An explicit `provider` replaces the native probe; `fallback` is loaded only
when native recognition is unavailable or fails. Supplied providers remain
caller-owned. Providers returned by `fallback` are document-owned and disposed
when settings change or the document closes.

`TextRecognitionProvider.recognize(input)` receives straight-alpha RGBA bytes,
`width`, `height`, the original zero-based `sourcePageIndex`, language hints,
and an `AbortSignal`. It returns `{ lines }` in reading order. Each line has
`text` and a polygon of `[x, y]` points in input pixels, with a top-left origin.
Optional `characters` carry their own text and polygons. Providers must not
modify input pixels, and should cancel work when signaled.

HEPR preserves character boxes when provided. Otherwise it divides line geometry
between graphemes, so partial-word selection and highlights are approximate.
Copying a whole line retains its recognized text. OCR can misread printed text
and handwriting; handwriting parity with Chrome is not guaranteed.
After selecting text on a page, use the platform's normal copy shortcut
(Ctrl+C on Windows/Linux, Cmd+C on macOS). Selection takes canvas focus and
uses the native clipboard event, while text inputs and editable fields keep
their normal copying behavior.

The lightweight `createPaddleTextRecognitionProvider({ loadClient })` adapter
accepts a caller-created PaddleOCR client with `predict()`. It maps SDK result
items to HEPR lines and creates browser `ImageData` by default. `prepareImage`
and `releaseImage` support runtimes needing a different input, such as an
OpenCV Mat in a worker. The adapter imports no PaddleOCR code. The application
must explicitly configure its client's worker, model, and WASM URLs. Keep
inference in a worker when responsiveness matters.

Recognition samples original image pixels at the requested resolution, bypassing
lossy GPU display compression and the viewer's adaptive low-resolution tiers.
GPU compression warnings for ordinary page display are independent of this.
Custom PDF worker URLs must use the matching HEPR build (worker protocol 18)
so an older worker cannot silently reduce OCR snapshot quality.
Recognition runs after display, one page at a time, prioritizing visible pages.
Streaming discovers additional candidates as page overviews load; a document
search requests remaining overviews. Completed text survives page eviction,
Reader/Grid changes, and renderer changes. Use `configureTextRecognition()`,
`pauseTextRecognition()`, `retryTextRecognition()`, and
`getTextRecognitionProgress()` to control a Three.js object's background work.
Progress states are `idle`, `recognizing`, `complete`, `unavailable`, `failed`,
`paused`, and `disposed`, with completed/total page counts. `recognizedPages`
counts completed pages containing usable OCR text. Optional `provider`
identifies `native`, `fallback`, or `custom`; `stage` distinguishes initialization,
raster preparation, and recognition. Recognition failures
produce `text-recognition.*` diagnostics and leave the page visible.

## Saving recognition

Completed recognition is part of the existing HEP text index; reopening it
requires no OCR engine. Viewer HEP exports preserve completed recognition.
To recognize all selected PDF pages before conversion, opt in explicitly:

```js
import { openDocumentSession } from "@soadzoor/hepr/node";

const session = await openDocumentSession("scanned.pdf");
try {
  const hep = await session.buildHep({
    pages: "1-3",
    textRecognition: { provider: applicationProvider, dpi: 300 },
  });
  // Save hep using the application's own file handling.
} finally {
  await session.close();
}
```

Browser `buildHep(source, options)` and `buildHepWithScene(source, options)` also
accept `textRecognition`. Conversion awaits selected-page recognition before
serializing text and canonical scan pixels. Node rasterization uses the existing
optional Canvas2D backend; the host supplies its recognition provider.

`ocrTextOnly` continues to display text already stored in a PDF. It does not
recognize scans. Saving a PDF with a newly embedded OCR text layer is not
implemented by this feature.
