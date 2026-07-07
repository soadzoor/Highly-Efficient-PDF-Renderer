---
name: verify
description: Build, launch, and drive the HEPR demo app in a headless browser to verify UI/renderer changes at the real surface.
---

# Verifying HEPR changes

## Build / typecheck
- `npx tsc --noEmit` (build is `npm run build` = tsc + vite build).

## Launch
- `npm run dev -- --port 5199 --strictPort` (background). App at `http://localhost:5199/`.
- `/favicon.ico` 404s — pre-existing, ignore.

## Drive (GUI surface)
- No Playwright in the repo. Install `playwright-core` in the session scratchpad
  and launch system Chrome: `chromium.launch({ channel: "chrome", headless: true })`.
- Key elements: `#example-select` (examples dropdown trigger), `#example-menu`
  (portaled to `<body>`), `#open-file`, `#backend-select` (WebGL/WebGPU),
  `#status`, `#metrics` (per-file stats populate after a load).
- Fast happy path: open the Examples dropdown, click a ZIP chip (parsed data
  loads in <1s from localhost), then assert `#metrics` shows the file name and
  screenshot the canvas.
- Example PDFs also sit in the repo root and `public/examples/pdfs/` for
  drag/drop or file-input tests.
- Second surface: `http://localhost:5199/three-example.html` (dark-themed
  three.js demo, own inline CSS, same `#example-select`/`#example-menu`
  dropdown; per-file stats land in `#file-value` etc.).

## Gotchas
- The HUD panel uses `backdrop-filter` + `overflow-y: auto`, so it clips
  fixed/absolute descendants — overlays must be portaled to `<body>`.
- Headless WebGPU may be unavailable; WebGL is the default backend.
