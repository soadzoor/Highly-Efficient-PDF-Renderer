import type { VectorScene } from "./pdfVectorExtractor";
import type { RenderPerformanceProfiler } from "./renderPerformance";

// Rendering is synchronous. Scope diagnostics to the example's host render,
// including its nested compositor renders, and restore the caller on failure.
let current: RenderPerformanceProfiler | null = null;

export function getThreeRenderPerformance(): RenderPerformanceProfiler | null {
  return current?.enabled ? current : null;
}

export function withThreeRenderPerformance<T>(profile: RenderPerformanceProfiler | null, render: () => T): T {
  const previous = current;
  current = profile?.enabled ? profile : null;
  try { return render(); } finally { current = previous; }
}

const GL_METHODS = {
  shaderSource: "shaderSource", compileShader: "shaderCompile", linkProgram: "programLink", useProgram: "programUse",
  getProgramParameter: "shaderQueries", getShaderParameter: "shaderQueries",
  getProgramInfoLog: "shaderQueries", getShaderInfoLog: "shaderQueries",
  getActiveUniform: "shaderQueries", getActiveAttrib: "shaderQueries",
  getUniformLocation: "shaderQueries", getAttribLocation: "shaderQueries",
  getParameter: "stateQueries", getQuery: "stateQueries", getQueryParameter: "stateQueries",
  checkFramebufferStatus: "targetValidation",
  texImage2D: "textureUpload", texSubImage2D: "textureUpload", texStorage2D: "textureUpload",
  compressedTexImage2D: "textureUpload", compressedTexSubImage2D: "textureUpload", generateMipmap: "textureUpload",
  bufferData: "bufferUpload", bufferSubData: "bufferUpload",
  drawArrays: "draw", drawElements: "draw", drawArraysInstanced: "draw", drawElementsInstanced: "draw",
  blitFramebuffer: "draw", clear: "clear", readPixels: "readback", getBufferSubData: "readback",
  getError: "stateQueries", finish: "sync", flush: "sync", clientWaitSync: "sync", waitSync: "sync"
} as const;

/**
 * Time only GL calls the renderer already makes: no added queries, readbacks,
 * flushes, waits or shader checks. Installation is opt-in and reversible.
 * Slow individual calls identify driver/shader stalls within a host render.
 */
export function instrumentThreeWebGlCalls(gl: WebGL2RenderingContext, profile: RenderPerformanceProfiler,
  now: () => number = () => performance.now()): {
    installedMethods: string[]; unavailableMethods: string[]; dispose(): void;
  } {
  const installedMethods: string[] = [], unavailableMethods: string[] = [];
  const restores: (() => void)[] = [];
  const target = gl as unknown as Record<string, unknown>;
  for (const [name, category] of Object.entries(GL_METHODS)) {
    const original = target[name];
    if (typeof original !== "function") { unavailableMethods.push(name); continue; }
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    const wrapped = function(this: WebGL2RenderingContext, ...args: unknown[]): unknown {
      if (getThreeRenderPerformance() !== profile) return Reflect.apply(original, this, args);
      const start = now();
      try { return Reflect.apply(original, this, args); }
      finally {
        const duration = Math.max(0, now() - start);
        profile.addSectionTime(`gl.${category}`, duration);
        profile.add(`gl.${category}Calls`);
        if (duration >= 8) profile.recordEvent(`gl.${name}`, duration);
      }
    };
    try {
      Object.defineProperty(target, name, { configurable: true, writable: true, value: wrapped });
      installedMethods.push(name);
      restores.push(() => {
        // Another inspector may replace a method while capture is active.
        if (target[name] !== wrapped) return;
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else delete target[name];
      });
    } catch { unavailableMethods.push(name); }
  }
  return { installedMethods, unavailableMethods, dispose() {
    for (const restore of restores) restore();
    restores.length = 0;
  } };
}

/** Capture once, outside measured frames. No document text or image data is exported. */
export function describeThreePerformanceScene(scene: VectorScene): Record<string, unknown> {
  const drawKinds: Record<string, number> = {};
  for (const run of scene.drawRuns ?? []) drawKinds[run.kind] = (drawKinds[run.kind] ?? 0) + 1;
  let groups = 0, masks = 0, knockoutGroups = 0, retainedNodes = 0, maxGroupDepth = 0;
  const blends: Record<string, number> = {};
  const visit = (nodes: NonNullable<VectorScene["paintGraph"]>["roots"], depth: number): void => {
    if (depth > 64) return;
    for (const node of nodes) {
      if (node.kind === "retained") retainedNodes++;
      if (node.kind !== "group") continue;
      groups++; maxGroupDepth = Math.max(maxGroupDepth, depth + 1);
      if (node.knockout) knockoutGroups++;
      blends[node.blendMode] = (blends[node.blendMode] ?? 0) + 1;
      if (node.softMask) { masks++; visit(node.softMask.children, depth + 1); }
      visit(node.children, depth + 1);
    }
  };
  visit(scene.paintGraph?.roots ?? [], 0);
  return {
    pages: scene.pageCount, pagesPerRow: scene.pagesPerRow, bounds: { ...scene.bounds },
    strokes: scene.segmentCount, fills: scene.fillPathCount, fillSegments: scene.fillSegmentCount,
    textInstances: scene.textInstanceCount, textGlyphs: scene.textGlyphCount,
    textGlyphSegments: scene.textGlyphSegmentCount,
    gradients: scene.gradientCount, gradientFills: scene.gradientFillPathCount,
    gradientFillSegments: scene.gradientFillSegmentCount,
    gradientStrokes: scene.gradientStrokeRunCount, gradientStrokeSegments: scene.gradientStrokeSegmentCount,
    clipPaths: scene.clipPaths?.length ?? 0,
    clipEdges: scene.clipPaths?.reduce((total, clip) => total + clip.edges.length / 4, 0) ?? 0,
    rasterLayers: scene.rasterLayers.length,
    rasterPixels: scene.rasterLayers.reduce((total, layer) => total + layer.width * layer.height, 0),
    drawKinds, paintGraph: !!scene.paintGraph, groups, masks, knockoutGroups, retainedNodes, maxGroupDepth, blends
  };
}
