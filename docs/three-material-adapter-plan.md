# Three Material Adapter Rewrite Plan

Goal: render HEPR pages as true Three.js objects using Three materials/shaders, while preserving core visual output and performance characteristics.

## Constraints
- Reuse core shader logic and data encoding where possible.
- Keep page nodes transformable (`position/rotation/scale`) like regular Three objects.
- Avoid HTML-canvas texture bridging for the WebGL path.
- Maintain feature parity: strokes, fills, text, raster layers, culling, pan cache/vector-minify behavior.

## Milestones
1. Extract shared GPU contracts from core WebGL renderer:
   - shader sources
   - packed data texture layouts
   - camera/AA uniforms
2. Build `ThreeMaterialPageRenderer` with layered sub-meshes:
   - stroke mesh (instanced quad + data textures)
   - fill mesh
   - text mesh
   - raster layer mesh
3. Port culling and visibility update logic into a renderer-agnostic module.
4. Recreate pan-cache/vector-minify behavior using Three render targets.
5. Add benchmark harness against native WebGL/WebGPU outputs and frame times.
6. Make material adapter the default Three path once parity thresholds are met.

## Success Criteria
- Visual delta below agreed threshold vs native reference scenes.
- No background/content temporal mismatch.
- Similar interaction FPS on large PDFs (same machine/config).
- No additional API burden for Three users.

