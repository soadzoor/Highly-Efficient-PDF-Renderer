# GPU PDF Floorplan Renderer (TypeScript POC)

This proof-of-concept implements a GPU-first floorplan renderer inspired by the vector-texture approach in
<https://wdobbie.com/post/gpu-text-rendering-with-vector-textures/>.

## What this POC does

- Loads a PDF floorplan (drag-and-drop or file picker).
- Extracts first-page vector path strokes via `pdfjs-dist` operator lists.
- Flattens Bezier curves into line segments.
- Uploads segment data into GPU float textures.
- Renders anti-aliased analytic strokes in a WebGL2 shader.
- Supports pan and zoom camera controls.
- Uses a spatial grid to cull visible segments when zoomed in.

## Run

```bash
npm install
npm run dev
```

Then open the Vite URL in your browser.

## Controls

- Drag with mouse/pointer: pan
- Mouse wheel: zoom around cursor
- Drag-and-drop PDF: load new floorplan

## Notes and current limitations

- The POC currently renders stroke paths from page 1.
- Filled geometry and text glyph rendering are not fully implemented yet.
- Performance varies with GPU/browser and PDF complexity.
