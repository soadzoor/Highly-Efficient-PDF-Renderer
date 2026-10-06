import { requireThreeWebGpuBackend, type ThreeWebGpuBackend } from "./threeMaterialBackend";
import * as THREE from "three";
import type { Bounds, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { ScenePaintMask } from "./scenePaintGraph";
import { compositeScenePaintGraph, pdfCompositeScissorRect, type PdfCompositeProjector, type PdfCompositeOperation, type ScenePaintCompositorAdapter } from "./scenePaintCompositor";
import { PDF_COMPOSITE_FRAGMENT_GLSL } from "./pdfCompositeShaders";
import { setThreePdfShapeOnly } from "./threePdfShape";
import { canFoldThreePaint, setThreePaintFold, threeGradientMaskSource, threeGradientMaskVectors,
  type ThreeGradientMaskFold } from "./threePaintFold";
import { HEPR_THREE_LAYER_ORDER_TEXT } from "./threeLayerOrder";
import { choosePdfCompositeResolution } from "./pdfCompositeBudget";
import { scenePaintNodeBounds } from "./scenePaintGraph";
import { getThreeRenderPerformance } from "./threeRenderPerformance";

/** Public renderer operations only, so Three retains ownership of its GPU state cache. */
export interface ThreePaintHostRenderer {
  autoClear: boolean;
  readonly outputColorSpace?: string;
  xr?: { enabled: boolean };
  /** WebGPURenderer's lighting manager; WebGLRenderer has none. */
  lighting?: { enabled: boolean };
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  getRenderTarget(): THREE.RenderTarget | null;
  setRenderTarget(target: THREE.RenderTarget | null, cubeFace?: number, mipLevel?: number): void;
  getActiveCubeFace?(): number;
  getActiveMipmapLevel?(): number;
  getViewport(target: THREE.Vector4): THREE.Vector4;
  setViewport(viewport: THREE.Vector4): void;
  getScissor(target: THREE.Vector4): THREE.Vector4;
  setScissor(scissor: THREE.Vector4): void;
  getScissorTest(): boolean;
  setScissorTest(enabled: boolean): void;
  getClearColor(target: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  setClearColor(color: THREE.Color, alpha: number): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
}

interface TextureBinding { value: THREE.Texture }
interface GPUDeviceLike {
  pushErrorScope(filter: string): void;
  popErrorScope(): Promise<{ message: string } | null>;
}

/** Stable per-surface identity for diagnostics; Three ids are unique per texture. */
function surfaceLabel(target: THREE.RenderTarget): string {
  return `#${target.texture.id}(${target.width}x${target.height})`;
}

type CompositorMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

interface ProxyEntry {
  source: CompositorMesh;
  /**
   * Stand-ins for `source`, one per time it draws in the current batch: a
   * batch is one host render, and an object can only be in its scene once.
   */
  meshes: CompositorMesh[];
  run?: VectorDrawRun;
  runIndices?: readonly number[];
  attribute?: string;
  /** Subset geometries by use within a batch, since each draw of a batch keeps its own instances. */
  partialGeometries: (THREE.InstancedBufferGeometry | undefined)[];
  ranges?: readonly { first: number; count: number }[];
  origins?: Uint32Array;
  /** One-instance geometries of this mesh's folded paints, by canonical index. */
  foldGeometries?: Map<number, THREE.InstancedBufferGeometry>;
  /** The batch `uses` counts for. */
  batch: number;
  /** Stand-ins taken in that batch. */
  uses: number;
}

/**
 * A group chain's factors, applied to the one paint it was folded onto.
 * `content` is the soft mask whose rendered content `mask` holds, if
 * unconverted, or that `gradient` describes for the paint to compute.
 */
interface PaintFold { opacity: number; mask: THREE.Texture | null; content?: ScenePaintMask; gradient?: ThreeGradientMaskFold }

/** What a paint's stand-in applies to its material while it draws. */
interface DrawState { shapeOnly: boolean; fold: PaintFold | null }

/** A composite pass's inputs, applied to the shared pass uniforms while its mesh draws. */
interface PassState {
  textures: THREE.Texture[];
  params: THREE.Vector4;
  extra: THREE.Vector4;
  backdrop: THREE.Vector3;
  /** The rectangle the pass covers, in clip space (min x, min y, max x, max y). */
  rect: THREE.Vector4;
}

/**
 * Consecutive compositor draws into one surface, rendered together as one
 * host render; see `prepare`.
 */
interface RenderBatch {
  target: THREE.RenderTarget;
  meshes: CompositorMesh[];
  /** Surfaces the batch samples. Nothing may write them before it renders. */
  reads: Set<THREE.RenderTarget>;
  /** Three draws transparent materials after all opaque ones, whatever their order. */
  transparent: boolean;
  /** Meshes other than composite passes. */
  draws: number;
}

/** Index of the soft-mask input in the shared composite binding order. */
const MASK_BINDING = 5;

// A composite pass covers its rectangle with geometry rather than a scissor,
// which Three sets per render call and so would keep passes out of batches.
// The quad spans 0..1 and uRect places it in clip space.
const PASS_VERTEX = `precision highp float;
in vec3 position;
uniform vec4 uRect;
void main() { gl_Position=vec4(mix(uRect.xy,uRect.zw,position.xy),0.0,1.0); }`;

/** Direct Three GL/GPU compositing. Primitive meshes share their canonical GPU geometry. */
export class ThreePaintCompositor implements ScenePaintCompositorAdapter<THREE.RenderTarget> {
  readonly blendsPasses = true;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private readonly geometry: THREE.BufferGeometry;
  private readonly passMaterial: THREE.Material;
  private readonly blendMaterial: THREE.Material;
  /** The unit quad every composite pass draws; see `PASS_VERTEX`. */
  private readonly quad: THREE.BufferGeometry;
  /** Pass meshes by use within a batch, each with the state it applies while it draws. */
  private readonly passMeshes: { mesh: CompositorMesh; state: PassState }[] = [];
  private passUses = 0;
  private readonly drawStates = new WeakMap<THREE.Object3D, DrawState>();
  /** Undoes the material changes of the mesh drawing now; see `beforeDraw`. */
  private readonly meshRestores: (() => void)[] = [];
  private batch: RenderBatch | null = null;
  /** Numbers batches, so a proxy can tell whether its stand-in count is current. */
  private batchId = 0;
  private readonly internalScene = new THREE.Scene();
  // Every pass and proxy material writes clip position itself, so this camera
  // only satisfies `renderer.render(scene, camera)`. It must still be a concrete
  // camera: WebGPURenderer rebuilds the projection for its own coordinate system
  // on first use, and the abstract base class has no updateProjectionMatrix.
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly pool: THREE.RenderTarget[] = [];
  private readonly surfaces = new Set<THREE.RenderTarget>();
  private readonly proxies = new Map<THREE.Object3D, ProxyEntry>();
  private readonly runsByKind = new Map<VectorDrawRun["kind"], { first: number; count: number; proxy: ProxyEntry }[]>();
  private project: PdfCompositeProjector | null = null;
  /** This frame's projection of scene coordinates into clip space, if the host gave one. */
  private clipFromData: THREE.Matrix4 | null = null;
  private scene: VectorScene | null = null;
  /** The mask `canFoldMaskPaint` last accepted, for the `drawFolded` call that follows it. */
  private gradientMask: { maskRun: VectorDrawRun; fold: ThreeGradientMaskFold } | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private paintSelection: Uint8Array | null = null;
  private readonly transfers = new Map<Float32Array, THREE.DataTexture>();
  private readonly zero: THREE.DataTexture;
  // An absent soft mask must read as fully opaque, unlike every other input,
  // whose neutral value is transparent black.
  private readonly one: THREE.DataTexture;
  private readonly presentZero: THREE.DataTexture;
  private readonly bindings: TextureBinding[] = [];
  private readonly params = new THREE.Vector4();
  private readonly extra = new THREE.Vector4();
  private readonly backdropColor = new THREE.Vector3();
  private readonly passRect = new THREE.Vector4(-1, -1, 1, 1);
  private readonly presentationBinding: TextureBinding;
  private readonly linearPresentation = { value: 0 };
  private readonly pageDepth = new THREE.Vector3();
  /**
   * WebGPU clears not yet encoded. There a clear is a render pass and a queue
   * submission of its own, so it waits for the next render into its target,
   * which clears as it loads; a target read before that is cleared first.
   */
  private readonly pendingClears = new Map<THREE.RenderTarget, readonly [number, number, number, number]>();
  /** The pending clear of the target just bound, for its next render. */
  private clearOnRender: readonly [number, number, number, number] | null = null;
  private renderer: ThreePaintHostRenderer | null = null;
  private output: THREE.RenderTarget | null = null;
  private width = 0;
  private height = 0;
  private rendering = false;
  private warnedResolution = false;
  private readonly backend: "webgl" | "webgpu";
  /**
   * The last texture version `stampBindingVersion` gave out. It starts above
   * any version a texture owned elsewhere reaches, such as the gradient colour
   * table a fold binds in place of a mask surface.
   */
  private bindingVersion = 2 ** 20;
  /**
   * Opt-in WebGPU pass attribution. A texture used as both a binding and a
   * render attachment inside one pass is reported by the device asynchronously,
   * with no way back to the call that encoded it. Setting this, or the
   * `HEPR_DEBUG_COMPOSITOR_VALIDATION` global, brackets every compositor render
   * in an error scope so the failing operation names itself.
   */
  debugValidation = false;

  constructor(backend: "webgl" | "webgpu", webGpu?: ThreeWebGpuBackend) {
    this.backend = backend;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.BufferGeometry();
    this.quad.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    // Every compositor mesh keeps an identity transform and writes its clip
    // position itself, so Three need not walk the scene's matrices per render.
    this.internalScene.matrixWorldAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.zero = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    this.zero.needsUpdate = true;
    this.stampBindingVersion(this.zero);
    this.one = new THREE.DataTexture(Uint8Array.of(255, 255, 255, 255), 1, 1, THREE.RGBAFormat);
    // Bound only in place of a mask surface, so it filters like one; see presentZero.
    this.one.minFilter = this.one.magFilter = THREE.LinearFilter;
    this.one.needsUpdate = true;
    this.stampBindingVersion(this.one);
    // Three decides at shader-generation time whether a sampled texture is
    // filterable, and it reads that from whatever the node holds then. A
    // DataTexture defaults to nearest on both filters, which compiled the
    // presentation material to a point fetch, so the surfaces the 512 MiB
    // budget scales below the viewport came back blocky where the GL path
    // filtered them. The presented surface therefore starts on its own
    // filterable placeholder. The pass inputs are built on the nearest one:
    // they are explicit texture loads, and a filterable value would add an
    // unused sampler binding per input to every composite pass. Once built,
    // an absent surface input binds this linear one instead, like the
    // surfaces: Three WebGPU frees a sampler as soon as no binding uses it,
    // and an input alternating between filters made it free and recreate the
    // nearest sampler every frame.
    this.presentZero = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    this.presentZero.minFilter = this.presentZero.magFilter = THREE.LinearFilter;
    this.presentZero.needsUpdate = true;
    this.stampBindingVersion(this.presentZero);
    const names = ["uSource", "uShape", "uCurrent", "uStats", "uInitial", "uMask", "uTransfer"];
    if (backend === "webgl") {
      const uniforms: Record<string, THREE.IUniform> = {
        uParams: { value: this.params }, uExtra: { value: this.extra }, uMaskBackdrop: { value: this.backdropColor },
        uRect: { value: this.passRect }
      };
      for (const name of names) { const binding = { value: this.zero as THREE.Texture }; this.bindings.push(binding); uniforms[name] = binding; }
      this.passMaterial = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: PASS_VERTEX,
        fragmentShader: PDF_COMPOSITE_FRAGMENT_GLSL.replace(/^#version 300 es\s*/, ""), uniforms });
      this.presentationBinding = { value: this.presentZero };
      const material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3,
        vertexShader: `precision highp float; in vec3 position; uniform vec3 uPageDepth; out vec2 vUv;
          void main(){vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,dot(uPageDepth,vec3(position.xy,1.0)),1.0);}`,
        fragmentShader: `precision highp float; uniform sampler2D uImage; uniform float uLinearOutput; in vec2 vUv; out vec4 outColor;
          void main(){
            vec4 color=texture(uImage,vUv);
            if(uLinearOutput>0.5){
              vec3 straight=clamp(color.rgb/max(color.a,0.0000001),0.0,1.0);
              vec3 linear=mix(pow((straight+0.055)/1.055,vec3(2.4)),straight/12.92,lessThanEqual(straight,vec3(0.04045)));
              color.rgb=linear*color.a;
            }
            outColor=color;
          }`,
        uniforms: { uImage: this.presentationBinding, uLinearOutput: this.linearPresentation, uPageDepth: { value: this.pageDepth } } });
      this.mesh = new THREE.Mesh(this.geometry, material);
    } else {
      const state = requireThreeWebGpuBackend(webGpu).createThreeWebGpuPaintCompositorMaterials({
        zero: this.zero, presentZero: this.presentZero, params: this.params, extra: this.extra,
        backdropColor: this.backdropColor, passRect: this.passRect, pageDepth: this.pageDepth,
        geometry: this.geometry, bindings: this.bindings
      });
      this.passMaterial = state.passMaterial;
      this.presentationBinding = state.presentationBinding;
      this.mesh = state.mesh;
    }
    for (const material of [this.passMaterial, this.mesh.material]) {
      material.depthTest = material.depthWrite = material.toneMapped = false;
      material.side = THREE.DoubleSide;
      material.blending = THREE.NoBlending;
      if (backend === "webgpu") {
        const nodeMaterial = material as THREE.Material & { fog: boolean; lights: boolean };
        nodeMaterial.fog = nodeMaterial.lights = false;
      }
    }
    this.mesh.material.blending = THREE.CustomBlending;
    this.mesh.material.blendSrc = this.mesh.material.blendSrcAlpha = THREE.OneFactor;
    if (backend === "webgpu") this.mesh.material.blendSrc = THREE.SrcAlphaFactor;
    this.mesh.material.blendDst = this.mesh.material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = HEPR_THREE_LAYER_ORDER_TEXT;
    this.mesh.visible = false;
    this.blendMaterial = this.passMaterial.clone();
    if (this.blendMaterial instanceof THREE.RawShaderMaterial && this.passMaterial instanceof THREE.RawShaderMaterial) {
      this.blendMaterial.uniforms = this.passMaterial.uniforms;
    }
    // Custom blending applies without `transparent`, which would make Three
    // draw this double-sided material twice, back faces first, and put it
    // after every opaque mesh of a batch regardless of order.
    this.blendMaterial.blending = THREE.CustomBlending;
    this.blendMaterial.blendSrc = this.blendMaterial.blendSrcAlpha = THREE.OneFactor;
    this.blendMaterial.blendDst = this.blendMaterial.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  }

  /**
   * `clipFromData` projects scene coordinates into clip space, as `project`
   * does bounds. Given it, a paint whose soft mask is one gradient fill
   * computes that mask itself; see `canFoldMaskPaint`.
   */
  render(renderer: ThreePaintHostRenderer, scene: VectorScene, roots: readonly THREE.Object3D[], width: number, height: number,
    visible: (condition?: number) => boolean, project: PdfCompositeProjector | null = null,
    clipFromData: THREE.Matrix4 | null = null): void {
    if (this.rendering) return;
    const profile = getThreeRenderPerformance();
    profile?.beginSection("three.compositor");
    profile?.beginSection("three.compositorSetup");
    profile?.add("three.compositorFrames");
    this.rendering = true;
    this.renderer = renderer;
    this.project = project; this.viewportWidth = width; this.viewportHeight = height;
    this.clipFromData = clipFromData; this.scene = scene;
    const saved = { target: renderer.getRenderTarget(), cube: renderer.getActiveCubeFace?.() ?? 0,
      mip: renderer.getActiveMipmapLevel?.() ?? 0, viewport: renderer.getViewport(new THREE.Vector4()),
      scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest(),
      clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear,
      xr: renderer.xr?.enabled, lighting: renderer.lighting?.enabled };
    let backdrop: THREE.RenderTarget | null = null;
    // The presented surface stays bound to the presentation material, and that
    // mesh is live in the host scene, so recycling it as a render attachment
    // now would leave one texture both sampled and written inside a single
    // frame. Hide the mesh while compositing, and hand the surface back to the
    // pool only once a new output has taken over the binding.
    this.mesh.visible = false;
    let presented = this.output;
    this.output = null;
    try {
      const resolution = choosePdfCompositeResolution(scene, width, height);
      width = resolution.width; height = resolution.height;
      if (resolution.scale < 1 && !this.warnedResolution) {
        this.warnedResolution = true;
        console.warn("[HEPR] PDF transparency groups use reduced resolution to stay within the 512 MiB compositor budget.");
      }
      if (width !== this.width || height !== this.height) {
        // releaseSurfaces disposes the presented surface along with the rest.
        this.releaseSurfaces(); presented = null;
        this.width = Math.max(1, Math.floor(width)); this.height = Math.max(1, Math.floor(height));
      }
      renderer.autoClear = false;
      if (renderer.xr) renderer.xr.enabled = false;
      // No compositor material is lit. With lighting on, WebGPURenderer
      // rehashes the scene's whole lights node once per render call, and the
      // compositor makes over a hundred of those a frame.
      if (renderer.lighting) renderer.lighting.enabled = false;
      renderer.setScissorTest(false);
      profile?.beginSection("three.compositorCollect");
      this.collect(roots);
      profile?.endSection("three.compositorCollect");
      profile?.beginSection("three.compositorSelection");
      const selected = this.selectPaints(scene);
      profile?.endSection("three.compositorSelection");
      profile?.endSection("three.compositorSetup");
      if (profile) {
        profile.add("three.proxies", this.proxies.size);
        profile.add("three.selectedPaints", selected ? selected.reduce((sum, value) => sum + value, 0) : scene.drawRuns?.length ?? 0);
        profile.add("three.compositeWidth", width); profile.add("three.compositeHeight", height);
      }
      backdrop = this.acquire(); this.clear(backdrop);
      const backgrounds = [...this.proxies.values()].filter(proxy => proxy.source.userData.heprPageBackground);
      if (backgrounds.length) {
        this.prepare(backdrop, [], backgrounds.map(proxy => proxy.source.material));
        for (const proxy of backgrounds) this.queueProxy(proxy, proxy.source.geometry, false, null);
      }
      this.output = compositeScenePaintGraph(scene, this, backdrop, visible, selected, true);
      this.flush();
      this.flushClear(this.output);
      this.presentationBinding.value = this.output.texture;
      // Raw GL paints use display values internally. A postprocessing target
      // expects working-linear color and applies its output transfer afterward.
      this.linearPresentation.value = saved.target || renderer.outputColorSpace === THREE.LinearSRGBColorSpace ? 1 : 0;
      this.mesh.visible = true;
    } finally {
      if (presented) this.release(presented);
      if (backdrop && backdrop !== this.output) this.release(backdrop);
      // Only a failed frame leaves a batch behind; its draws are abandoned.
      this.batch = null;
      this.pendingClears.clear(); this.clearOnRender = null;
      this.internalScene.clear();
      renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest);
      // Binding a target restores its own physical viewport/scissor. Global
      // viewport APIs retain the default-framebuffer values in Three.
      renderer.setRenderTarget(saved.target, saved.cube, saved.mip);
      renderer.setClearColor(saved.clear, saved.alpha); renderer.autoClear = saved.autoClear;
      if (renderer.xr && saved.xr !== undefined) renderer.xr.enabled = saved.xr;
      if (renderer.lighting && saved.lighting !== undefined) renderer.lighting.enabled = saved.lighting;
      this.renderer = null; this.rendering = false; this.project = null;
      this.clipFromData = null; this.scene = null; this.gradientMask = null;
      profile?.add("three.surfaceBytes", this.surfaces.size * this.width * this.height * 4);
      profile?.endSection("three.compositor");
    }
  }

  acquire(): THREE.RenderTarget {
    const available = this.pool.pop(); if (available) return available;
    if ((this.surfaces.size + 1) * this.width * this.height * 4 > 512 * 1024 * 1024) {
      throw new RangeError("PDF compositing surfaces exceed 512 MiB.");
    }
    const target = new THREE.RenderTarget(this.width, this.height, { depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, colorSpace: THREE.NoColorSpace });
    this.stampBindingVersion(target.texture);
    this.surfaces.add(target);
    getThreeRenderPerformance()?.add("three.newSurfaces");
    return target;
  }
  release(target: THREE.RenderTarget): void { this.pendingClears.delete(target); this.pool.push(target); }
  clear(target: THREE.RenderTarget, color: readonly [number, number, number, number] = [0, 0, 0, 0], bounds?: Bounds): void {
    const rect = pdfCompositeScissorRect(bounds, this.project, this.viewportWidth, this.viewportHeight,
      this.width, this.height);
    if (rect && (rect.width === 0 || rect.height === 0)) return;
    const profile = getThreeRenderPerformance();
    profile?.add("three.clears");
    profile?.add("three.clearPixels", this.backend === "webgl" && rect ? rect.width * rect.height : this.width * this.height);
    this.flushIfTouching(target);
    // WebGPU attachment clears cover the whole surface regardless of scissor;
    // keep that fast clear there, deferred. WebGL can restrict the clear call.
    if (this.backend === "webgpu") { this.pendingClears.set(target, color); return; }
    this.target(target, rect);
    this.renderer!.setClearColor(new THREE.Color().setRGB(color[0], color[1], color[2]), color[3]);
    this.renderer!.clear(true, false, false);
  }
  /** Encodes a target's pending clear before something reads it. */
  private flushClear(target: THREE.RenderTarget | undefined): void {
    const color = target && this.pendingClears.get(target);
    if (!target || !color) return;
    this.flushIfTouching(target);
    this.pendingClears.delete(target);
    this.target(target);
    this.renderer!.setClearColor(new THREE.Color().setRGB(color[0], color[1], color[2]), color[3]);
    getThreeRenderPerformance()?.add("three.clearPasses");
    this.renderer!.clear(true, false, false);
  }
  copy(source: THREE.RenderTarget, destination: THREE.RenderTarget, bounds?: Bounds): void {
    this.pass({ operation: 5, source, bounds }, destination);
  }
  draw(runs: readonly VectorDrawRun[], destination: THREE.RenderTarget, shapeOnly: boolean): void {
    // One proxy can back several runs of a batched span, and geometryForRuns
    // rebuilds one partial buffer per proxy use. Collect each proxy's runs
    // first so every proxy draws once per span. The runs are kept individually
    // rather than merged into one range: a span skips paints whose optional
    // content is hidden, so its range can have holes that a merged range would
    // repaint.
    const profile = getThreeRenderPerformance();
    profile?.beginSection("three.batchLookup");
    const { ordered, byProxy } = this.proxiesForRuns(runs);
    profile?.endSection("three.batchLookup");
    // Fail before anything is queued, not inside the host render.
    if (shapeOnly) for (const proxy of ordered) setThreePdfShapeOnly(proxy.source.material, true)();
    this.prepare(destination, [], ordered.map(proxy => proxy.source.material));
    profile?.beginSection("three.batchGeometry");
    for (const proxy of ordered) {
      const use = this.use(proxy);
      const geometry = this.geometryForRuns(proxy, byProxy.get(proxy)!, use);
      if (geometry instanceof THREE.InstancedBufferGeometry && geometry.instanceCount === 0) { proxy.uses--; continue; }
      if (proxy.run) profile?.add(`three.${proxy.run.kind}Draws`);
      this.queueProxy(proxy, geometry, shapeOnly, null, use);
    }
    profile?.endSection("three.batchGeometry");
  }
  /**
   * A fill or analytic gradient fill whose material can scale its own alpha:
   * each covers a pixel at most once, so its group chain's opacity and mask
   * can apply to the paint itself (see `drawFolded`).
   */
  canFold(run: VectorDrawRun): boolean {
    if (run.count !== 1 || (run.kind !== "fill" && run.kind !== "gradient-fill")) return false;
    const { ordered } = this.proxiesForRuns([run]);
    return ordered.length > 0 && ordered.every(proxy => canFoldThreePaint(proxy.source.material));
  }
  /**
   * A soft mask made of one analytic gradient fill costs a surface, a clear
   * and a render of its own, and splits the folded paint's batch in two. A
   * folded paint can instead compute it at each fragment from the gradient's
   * colour table, its outline and its one clip beyond the paint's own chain
   * (see `threeGradientMaskVectors`), when the host supplied the projection
   * that places them on the surface.
   */
  canFoldMaskPaint(run: VectorDrawRun, maskRun: VectorDrawRun): boolean {
    this.gradientMask = null;
    if (maskRun.kind !== "gradient-fill" || !this.clipFromData || !this.scene) return false;
    const proxies = this.proxiesForRuns([maskRun]).ordered;
    const source = proxies.length === 1 ? threeGradientMaskSource(proxies[0].source.material) : undefined;
    if (!source || source.vectorOverride.w > 0 || source.primitiveColor.w > 0) return false;
    const vectors = threeGradientMaskVectors(this.scene, maskRun, run.clipIndex, this.clipFromData,
      this.width, this.height, this.backend === "webgpu");
    if (!vectors) return false;
    this.gradientMask = { maskRun, fold: { lut: source.lut, vectors, linear: source.linear } };
    return true;
  }
  drawFolded(run: VectorDrawRun, destination: THREE.RenderTarget, opacity: number, mask: THREE.RenderTarget | undefined,
    content?: ScenePaintMask, maskRun?: VectorDrawRun): void {
    const profile = getThreeRenderPerformance();
    profile?.add("three.foldedPaints");
    const gradient = maskRun ? this.gradientMask?.maskRun === maskRun ? this.gradientMask.fold : null : undefined;
    if (gradient === null) throw new Error("A folded paint's mask was not accepted for computing.");
    if (gradient) profile?.add("three.computedMasks");
    const proxies = this.proxiesForRuns([run]).ordered;
    this.prepare(destination, [mask], proxies.map(proxy => proxy.source.material));
    const fold = { opacity, mask: mask?.texture ?? null, content, gradient };
    for (const proxy of proxies) {
      const geometry = this.foldGeometry(proxy, run);
      if (!geometry) continue;
      profile?.add(`three.${run.kind}Draws`);
      this.queueProxy(proxy, geometry, false, fold);
    }
  }
  /** The proxies holding these runs, in source order, each with the runs it holds. */
  private proxiesForRuns(runs: readonly VectorDrawRun[]): { ordered: ProxyEntry[]; byProxy: Map<ProxyEntry, VectorDrawRun[]> } {
    const ordered: ProxyEntry[] = [];
    const byProxy = new Map<ProxyEntry, VectorDrawRun[]>();
    for (const run of runs) {
      const candidates = this.runsByKind.get(run.kind) ?? [];
      let low = 0, high = candidates.length;
      while (low < high) {
        const middle = (low + high) >>> 1, source = candidates[middle];
        if (source.first + source.count <= run.first) low = middle + 1; else high = middle;
      }
      for (let index = low; index < candidates.length; index++) {
        const sourceRun = candidates[index], proxy = sourceRun.proxy;
        if (sourceRun.first >= run.first + run.count) break;
        if (sourceRun.first + sourceRun.count <= run.first) continue;
        const previous = byProxy.get(proxy);
        // A merged run can intersect many ranges owned by the same proxy.
        // It only needs to participate in that proxy's membership test once.
        if (previous) { if (previous[previous.length - 1] !== run) previous.push(run); }
        else { byProxy.set(proxy, [run]); ordered.push(proxy); }
      }
    }
    if (ordered.some(proxy => proxy.source.userData.heprScheduled)) {
      ordered.sort((a, b) => a.source.renderOrder - b.source.renderOrder);
    }
    return { ordered, byProxy };
  }
  pass(operation: PdfCompositeOperation<THREE.RenderTarget>, destination: THREE.RenderTarget): void {
    const rect = pdfCompositeScissorRect(operation.bounds, this.project, this.viewportWidth, this.viewportHeight,
      this.width, this.height);
    if (rect && (rect.width === 0 || rect.height === 0)) return;
    getThreeRenderPerformance()?.add("three.compositePasses");
    const sources = [operation.source, operation.shape, operation.current, operation.stats, operation.initial, operation.mask];
    const material = operation.blend ? this.blendMaterial : this.passMaterial;
    this.prepare(destination, sources, [material]);
    const { mesh, state } = this.nextPassMesh();
    for (let index = 0; index < sources.length; index++) {
      state.textures[index] = sources[index]?.texture ?? (index === MASK_BINDING ? this.one : this.presentZero);
    }
    const transfer = operation.softMask?.transfer;
    state.textures[6] = transfer ? this.transferTexture(transfer) : this.zero;
    state.params.set(operation.operation, operation.blendMode ?? 0, operation.knockout ? 1 : 0, operation.opacity ?? 1);
    state.extra.set(operation.alphaIsShape ? 1 : 0, operation.softMask?.subtype === "Luminosity" ? 1 : 0,
      transfer?.length ?? 0, operation.isolated ? 1 : 0);
    state.backdrop.fromArray(operation.softMask?.backdrop ?? [0, 0, 0]);
    // Surface rectangles count pixels up from the bottom-left corner, the
    // way clip space runs on both backends.
    if (rect) {
      state.rect.set(rect.x / this.width * 2 - 1, rect.y / this.height * 2 - 1,
        (rect.x + rect.width) / this.width * 2 - 1, (rect.y + rect.height) / this.height * 2 - 1);
    } else state.rect.set(-1, -1, 1, 1);
    mesh.material = material;
    this.enqueue(mesh, true);
  }
  /** Give a screen-space composited page its original projected plane depth. */
  setPageDepth(localToClip: THREE.Matrix4): void {
    const inverse = localToClip.clone().invert().elements;
    const z = inverse[10];
    if (Math.abs(z) > 1e-15) this.pageDepth.set(-inverse[2] / z, -inverse[6] / z, -inverse[14] / z);
    else this.pageDepth.set(0, 0, 0);
    if (!this.mesh.material.depthTest) { this.mesh.material.depthTest = true; this.mesh.material.needsUpdate = true; }
  }

  dispose(): void {
    this.releaseSurfaces();
    for (const proxy of this.proxies.values()) this.disposePartial(proxy);
    this.proxies.clear();
    this.runsByKind.clear();
    for (const texture of this.transfers.values()) texture.dispose();
    this.transfers.clear(); this.zero.dispose(); this.one.dispose(); this.presentZero.dispose(); this.geometry.dispose(); this.quad.dispose(); this.passMaterial.dispose(); this.blendMaterial.dispose(); this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
  /**
   * Every pass rebinds this compositor's shared inputs to different surfaces.
   * Three only rebuilds a bind group when the newly bound texture reports a
   * different `generation`, and that generation is the texture's `version`,
   * which render-target textures never raise. Two surfaces therefore look
   * identical to that check and the previous texture stays bound, so a pass can
   * end up sampling the surface it is writing - which WebGPU rejects as a
   * read/write overlap. Giving every texture that reaches a binding its own
   * version makes the comparison meaningful. WebGL rebinds its samplers on
   * every draw and never reads a stale binding, so it is left untouched.
   */
  private stampBindingVersion(texture: THREE.Texture): void {
    if (this.backend === "webgpu") texture.version = ++this.bindingVersion;
  }
  private target(target: THREE.RenderTarget, rect: { x: number; y: number; width: number; height: number } | null = null): void {
    // Render-target rectangles use physical pixels. renderer.setScissor applies
    // the host DPR to the default framebuffer and would scale these twice.
    target.scissorTest = rect !== null;
    const y = rect && this.backend === "webgpu" ? target.height - rect.y - rect.height : rect?.y ?? 0;
    target.scissor.set(rect?.x ?? 0, y, rect?.width ?? target.width, rect?.height ?? target.height);
    const profile = getThreeRenderPerformance();
    profile?.beginSection("three.bindTarget");
    try { this.renderer!.setRenderTarget(target); }
    finally { profile?.endSection("three.bindTarget"); }
    this.clearOnRender = this.pendingClears.get(target) ?? null;
    this.pendingClears.delete(target);
    // WebGPURenderer reads the renderer's scissor-test flag even for targets;
    // WebGLRenderer restores the target flag on bind. Set both through public APIs.
    this.renderer!.setScissorTest(rect !== null);
  }
  private hostRender(passesOnly: boolean, label: () => string): void {
    const profile = getThreeRenderPerformance();
    if (!profile) { this.hostRenderInternal(label); return; }
    profile.add("three.hostRenders");
    const section = passesOnly ? "three.hostPass" : "three.hostDraw";
    const start = performance.now();
    try { this.hostRenderInternal(label); }
    finally {
      const duration = performance.now() - start;
      profile.addSectionTime(section, duration);
      if (duration >= 8) profile.recordEvent(label(), duration);
    }
  }
  private hostRenderInternal(label: () => string): void {
    // A deferred clear of this target happens as the render pass loads.
    const clear = this.clearOnRender;
    this.clearOnRender = null;
    if (!clear) { this.hostRenderUnclearing(label); return; }
    this.renderer!.setClearColor(new THREE.Color().setRGB(clear[0], clear[1], clear[2]), clear[3]);
    this.renderer!.autoClear = true;
    try { this.hostRenderUnclearing(label); } finally { this.renderer!.autoClear = false; }
  }
  private hostRenderUnclearing(label: () => string): void {
    const enabled = this.debugValidation ||
      (globalThis as { HEPR_DEBUG_COMPOSITOR_VALIDATION?: boolean }).HEPR_DEBUG_COMPOSITOR_VALIDATION === true;
    const device = enabled
      ? (this.renderer as { backend?: { device?: GPUDeviceLike } }).backend?.device
      : undefined;
    if (!device) { this.renderer!.render(this.internalScene, this.camera); return; }
    device.pushErrorScope("validation");
    try { this.renderer!.render(this.internalScene, this.camera); }
    finally {
      const described = label();
      void device.popErrorScope().then(error => {
        if (error) console.error(`[HEPR compositor] ${described}: ${error.message}`);
      });
    }
  }
  /**
   * Readies the batch for an operation that draws `materials` into
   * `destination` and samples `reads`.
   *
   * Consecutive operations into one surface share a host render. Three WebGPU
   * gives every render call its own command encoder and queue submission, and
   * Chrome flushes each submission to its GPU process straight away, so the
   * number of calls rather than what they draw sets the compositor's frame
   * time. The operations keep their order, and each mesh applies its own state
   * as Three draws it (see `beforeDraw` and `beforePass`). The pending batch
   * renders first when the operation targets another surface, samples the
   * batch's own target, or is opaque after a transparent draw, which Three
   * would reorder. Writes to a surface the batch uses flush it as well (see
   * `flushIfTouching`).
   */
  private prepare(destination: THREE.RenderTarget, reads: readonly (THREE.RenderTarget | undefined)[],
    materials: readonly THREE.Material[]): void {
    const batch = this.batch;
    if (batch && (batch.target !== destination || reads.includes(batch.target) ||
      (batch.transparent && materials.some(material => !material.transparent)))) this.flush();
    for (const read of reads) if (read && read !== destination) this.flushClear(read);
    if (!this.batch) {
      this.batch = { target: destination, meshes: [], reads: new Set(), transparent: false, draws: 0 };
      this.batchId++;
      this.passUses = 0;
    }
    for (const read of reads) if (read) this.batch.reads.add(read);
  }
  /** Renders the batch before anything writes a surface it draws into or samples. */
  private flushIfTouching(target: THREE.RenderTarget): void {
    const batch = this.batch;
    if (batch && (batch.target === target || batch.reads.has(target))) this.flush();
  }
  /** Renders the pending batch as one host render. */
  private flush(): void {
    const batch = this.batch;
    if (!batch) return;
    this.batch = null;
    this.target(batch.target);
    this.internalScene.add(...batch.meshes);
    try {
      this.hostRender(batch.draws === 0, () => `${batch.meshes.length} mesh(es), ${batch.draws} paint draw(s) -> ` +
        surfaceLabel(batch.target));
    } finally {
      this.internalScene.clear();
      // A render that failed may have stopped between a mesh's hooks.
      this.afterDraw();
    }
  }
  private enqueue(mesh: CompositorMesh, pass: boolean): void {
    const batch = this.batch!;
    // Stand-in meshes are private to the compositor, so an explicit order
    // keeps source order without depending on the layer's own render order.
    mesh.renderOrder = batch.meshes.length;
    batch.meshes.push(mesh);
    if (mesh.material.transparent) batch.transparent = true;
    if (!pass) batch.draws++;
  }
  /** Which of a proxy's stand-ins the batch uses next. */
  private use(proxy: ProxyEntry): number {
    if (proxy.batch !== this.batchId) { proxy.batch = this.batchId; proxy.uses = 0; }
    return proxy.uses++;
  }
  /** Queues a proxy's paints, drawn from `geometry`, into the current batch. */
  private queueProxy(proxy: ProxyEntry, geometry: THREE.BufferGeometry, shapeOnly: boolean, fold: PaintFold | null,
    use = this.use(proxy)): void {
    let mesh = proxy.meshes[use];
    if (!mesh) {
      const created: CompositorMesh = mesh = new THREE.Mesh(geometry, proxy.source.material);
      created.frustumCulled = false;
      created.matrixAutoUpdate = false;
      const state: DrawState = { shapeOnly: false, fold: null };
      this.drawStates.set(created, state);
      created.onBeforeRender = () => this.beforeDraw(created, state);
      created.onAfterRender = () => this.afterDraw();
      proxy.meshes[use] = created;
    }
    const state = this.drawStates.get(mesh)!;
    state.shapeOnly = shapeOnly; state.fold = fold;
    mesh.geometry = geometry; mesh.material = proxy.source.material;
    this.enqueue(mesh, false);
  }
  /**
   * Applies a stand-in's state to its material just before Three draws it.
   * Three WebGPU reads per-object uniforms and textures as it draws each
   * mesh, and WebGLRenderer uploads them again when told to, so meshes of one
   * render can each draw a shared material differently.
   */
  private beforeDraw(mesh: CompositorMesh, state: DrawState): void {
    // Clip clones share one shape input, so these restore in reverse: the last
    // writer of a shared uniform must be the first to put it back.
    this.meshRestores.push(setThreePdfShapeOnly(mesh.material, state.shapeOnly));
    const fold = state.fold;
    if (fold) {
      this.meshRestores.push(setThreePaintFold(mesh.material, fold.opacity, fold.mask, fold.content, fold.gradient));
    }
    if (mesh.material instanceof THREE.RawShaderMaterial) mesh.material.uniformsNeedUpdate = true;
  }
  private afterDraw(): void {
    for (let index = this.meshRestores.length - 1; index >= 0; index--) this.meshRestores[index]();
    this.meshRestores.length = 0;
  }
  private nextPassMesh(): { mesh: CompositorMesh; state: PassState } {
    let entry = this.passMeshes[this.passUses];
    if (!entry) {
      const mesh: CompositorMesh = new THREE.Mesh(this.quad, this.passMaterial);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      const state: PassState = { textures: [], params: new THREE.Vector4(), extra: new THREE.Vector4(),
        backdrop: new THREE.Vector3(), rect: new THREE.Vector4() };
      mesh.onBeforeRender = () => this.beforePass(mesh, state);
      this.passMeshes.push(entry = { mesh, state });
    }
    this.passUses++;
    return entry;
  }
  /** Points the shared pass uniforms at one pass's inputs as its mesh draws; see `beforeDraw`. */
  private beforePass(mesh: CompositorMesh, state: PassState): void {
    for (let index = 0; index < this.bindings.length; index++) this.bindings[index].value = state.textures[index];
    this.params.copy(state.params);
    this.extra.copy(state.extra);
    this.backdropColor.copy(state.backdrop);
    this.passRect.copy(state.rect);
    if (mesh.material instanceof THREE.RawShaderMaterial) mesh.material.uniformsNeedUpdate = true;
  }
  /**
   * Which paints still have something on screen, taken from the instance
   * culling the layers already did. The test matches the one `draw` applies to
   * each mesh, so this drops exactly the paints that would have submitted
   * nothing. A batched mesh reports for every paint behind it at once, which
   * can keep a group standing that might have been dropped but never removes a
   * paint that still draws. Raster and gradient paints use the same conservative
   * projected bounds as composite passes, including their AA margin. Unknown
   * bounds or unsafe perspective projections keep the paint. null means nothing
   * was culled.
   */
  private selectPaints(scene: VectorScene): Uint8Array | null {
    const runs = scene.drawRuns;
    if (!runs) return null;
    const selected = this.paintSelection?.length === runs.length
      ? this.paintSelection : (this.paintSelection = new Uint8Array(runs.length));
    selected.fill(1);
    let culled = false;
    for (const proxy of this.proxies.values()) {
      if (!proxy.runIndices || (proxy.source.geometry as THREE.InstancedBufferGeometry).instanceCount > 0) continue;
      for (const index of proxy.runIndices) { selected[index] = 0; culled = true; }
    }
    const bounds = this.project ? scenePaintNodeBounds(scene).runs : null;
    if (bounds) for (let index = 0; index < runs.length; index++) {
      const kind = runs[index].kind;
      // Vector layers already account for their active LOD's coverage. Only
      // the image/gradient slots lack that culling; leave vector choices alone.
      if (kind !== "raster" && kind !== "gradient-fill" && kind !== "gradient-stroke") continue;
      const offset = index * 4;
      const rect = pdfCompositeScissorRect({ minX: bounds[offset], minY: bounds[offset + 1],
        maxX: bounds[offset + 2], maxY: bounds[offset + 3] }, this.project,
        this.viewportWidth, this.viewportHeight, this.width, this.height);
      if (rect && (rect.width === 0 || rect.height === 0)) { selected[index] = 0; culled = true; }
    }
    return culled ? selected : null;
  }

  private collect(roots: readonly THREE.Object3D[]): void {
    let changed = false;
    const present = new Set<THREE.Object3D>();
    for (const root of roots) root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || (!object.userData.heprDrawRun && !object.userData.heprPageBackground)) return;
      present.add(object);
      if (this.proxies.has(object)) return;
      const source = object as CompositorMesh;
      const entry: ProxyEntry = { source, meshes: [], run: object.userData.heprDrawRun as VectorDrawRun | undefined,
        runIndices: object.userData.heprDrawRunIndices as readonly number[] | undefined,
        attribute: object.userData.heprInstanceAttribute,
        ranges: object.userData.heprDrawRanges as ProxyEntry["ranges"],
        origins: object.userData.heprCanonicalOrigins as Uint32Array | undefined,
        partialGeometries: [], batch: 0, uses: 0 };
      this.proxies.set(object, entry);
      if (entry.run) changed = true;
    });
    for (const [object, entry] of this.proxies) if (!present.has(object)) {
      this.disposePartial(entry); this.proxies.delete(object); changed = true;
    } else if (this.outgrown(entry)) {
      // Nothing is queued yet, so no pending batch still draws what this frees.
      this.disposePartial(entry);
    }
    if (changed) {
      // A zoom replan can replace meshes owning thousands of canonical ranges.
      // Removing each old range with splice repeatedly shifts the remaining
      // index, including newly added ranges. Rebuild once from the live proxies
      // instead; unchanged frames keep the existing index and subset buffers.
      this.runsByKind.clear();
      for (const entry of this.proxies.values()) if (entry.run) {
        let runs = this.runsByKind.get(entry.run.kind);
        if (!runs) this.runsByKind.set(entry.run.kind, runs = []);
        for (const range of entry.ranges ?? [entry.run]) runs.push({ ...range, proxy: entry });
      }
      for (const runs of this.runsByKind.values()) runs.sort((a, b) => a.first - b.first);
    }
  }
  private geometryForRuns(proxy: ProxyEntry, runs: readonly VectorDrawRun[], use: number): THREE.BufferGeometry {
    const geometry = proxy.source.geometry;
    if (!proxy.attribute || !proxy.run) return geometry;
    // Scheduled meshes can own thousands of disjoint canonical ranges. Avoid
    // searching the entire span for every range, and coalesce adjacent inputs
    // so a fully covered mesh keeps its canonical GPU buffers.
    const sorted: { first: number; count: number }[] = [];
    for (const run of [...runs].sort((a, b) => a.first - b.first)) {
      const previous = sorted[sorted.length - 1];
      if (previous && run.first <= previous.first + previous.count) {
        previous.count = Math.max(previous.count, run.first + run.count - previous.first);
      } else sorted.push({ first: run.first, count: run.count });
    }
    const includes = (first: number, count = 1): boolean => {
      let low = 0, high = sorted.length;
      while (low < high) { const middle = (low + high) >>> 1;
        if (sorted[middle].first <= first) low = middle + 1; else high = middle;
      }
      return low > 0 && first + count <= sorted[low - 1].first + sorted[low - 1].count;
    };
    const ranges = proxy.ranges ?? (proxy.run ? [proxy.run] : []);
    if (ranges.every(range => includes(range.first, range.count))) return geometry;
    const source = geometry.getAttribute(proxy.attribute);
    const capacity = (geometry as THREE.InstancedBufferGeometry).instanceCount;
    let partial = proxy.partialGeometries[use];
    if (!partial) {
      partial = new THREE.InstancedBufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        if (!(attribute instanceof THREE.InstancedBufferAttribute)) partial.setAttribute(name, attribute);
      }
      partial.setIndex(geometry.index); proxy.partialGeometries[use] = partial;
    }
    const attributes: [THREE.InstancedBufferAttribute, THREE.InstancedBufferAttribute][] = [];
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (!(attribute instanceof THREE.InstancedBufferAttribute)) continue;
      let target = partial.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
      if (!target) {
        const ArrayType = attribute.array.constructor as { new(length: number): typeof attribute.array };
        // Match the source capacity once, so panning over more visible instances
        // does not repeatedly replace otherwise reusable partial buffers.
        target = new THREE.InstancedBufferAttribute(new ArrayType(attribute.count * attribute.itemSize), attribute.itemSize, attribute.normalized);
        target.setUsage(THREE.StreamDrawUsage); partial.setAttribute(name, target);
      }
      attributes.push([attribute, target]);
    }

    let count = 0;
    for (let item = 0; item < capacity; item++) {
      const id = source.getX(item), canonical = proxy.origins?.[id] ?? id;
      if (!includes(canonical)) continue;
      for (const [attribute, target] of attributes) {
        for (let component = 0; component < attribute.itemSize; component++) {
          target.setComponent(count, component, attribute.getComponent(item, component));
        }
      }
      count++;
    }
    partial.instanceCount = count;
    const profile = getThreeRenderPerformance();
    profile?.add("three.partialInstances", count);
    if (profile) for (const [, target] of attributes) profile.add("three.instanceUploadBytes", count * target.itemSize * target.array.BYTES_PER_ELEMENT);
    for (const [, target] of attributes) { target.clearUpdateRanges(); if (count) target.addUpdateRange(0, count * target.itemSize); target.needsUpdate = true; }
    return partial;
  }

  /**
   * A folded paint's own one-instance geometry. A fill's instance data is the
   * same every frame, so each folded paint builds it once, rather than
   * rewriting the shared partial buffer once per fold within every frame. A
   * mesh holding only this paint keeps its canonical buffers.
   */
  private foldGeometry(proxy: ProxyEntry, run: VectorDrawRun): THREE.BufferGeometry | null {
    const geometry = proxy.source.geometry;
    if (!proxy.attribute || !proxy.run) return geometry;
    const ranges = proxy.ranges ?? [proxy.run];
    if (ranges.every(range => range.first >= run.first && range.first + range.count <= run.first + run.count)) return geometry;
    const cached = proxy.foldGeometries?.get(run.first);
    if (cached) return cached;
    const source = geometry.getAttribute(proxy.attribute);
    const capacity = (geometry as THREE.InstancedBufferGeometry).instanceCount;
    let item = -1;
    for (let index = 0; index < capacity && item < 0; index++) {
      const id = source.getX(index);
      if ((proxy.origins?.[id] ?? id) === run.first) item = index;
    }
    if (item < 0) return null;
    const folded = new THREE.InstancedBufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (!(attribute instanceof THREE.InstancedBufferAttribute)) { folded.setAttribute(name, attribute); continue; }
      const ArrayType = attribute.array.constructor as { new(length: number): typeof attribute.array };
      const array = new ArrayType(attribute.itemSize);
      for (let component = 0; component < attribute.itemSize; component++) array[component] = attribute.getComponent(item, component);
      folded.setAttribute(name, new THREE.InstancedBufferAttribute(array, attribute.itemSize, attribute.normalized));
    }
    folded.setIndex(geometry.index);
    folded.instanceCount = 1;
    (proxy.foldGeometries ??= new Map()).set(run.first, folded);
    return folded;
  }

  /**
   * Whether the source mesh has more instances than a subset buffer holds.
   * Such buffers are disposed with the old owned attributes still attached:
   * replacing an uploaded attribute in place would leave its GPU buffer
   * unreachable.
   */
  private outgrown(proxy: ProxyEntry): boolean {
    const attributes = Object.entries(proxy.source.geometry.attributes);
    return proxy.partialGeometries.some(partial => partial && attributes.some(([name, attribute]) => {
      if (!(attribute instanceof THREE.InstancedBufferAttribute)) return false;
      const target = partial.getAttribute(name);
      return !target || target.count < attribute.count;
    }));
  }

  private disposePartial(proxy: ProxyEntry): void {
    for (const folded of proxy.foldGeometries?.values() ?? []) disposeOwnedInstances(folded);
    proxy.foldGeometries = undefined;
    for (const geometry of proxy.partialGeometries) if (geometry) disposeOwnedInstances(geometry);
    proxy.partialGeometries.length = 0;
  }

  private releaseSurfaces(): void {
    for (const target of this.surfaces) target.dispose();
    this.surfaces.clear(); this.pool.length = 0; this.output = null;
  }
  private transferTexture(values: Float32Array): THREE.DataTexture {
    const existing = this.transfers.get(values); if (existing) return existing;
    const width = Math.min(1024, values.length), height = Math.ceil(values.length / width);
    const pixels = new Float32Array(width * height); pixels.set(values);
    const texture = new THREE.DataTexture(pixels, width, height, THREE.RedFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.needsUpdate = true;
    this.stampBindingVersion(texture);
    this.transfers.set(values, texture); return texture;
  }
}

/** Conservative viewport bounds; unsafe perspective clipping keeps the full pass. */
export function projectThreePdfCompositeBounds(bounds: Bounds, matrix: THREE.Matrix4, width: number, height: number,
  backend: "webgl" | "webgpu" = "webgl"):
  { x: number; y: number; width: number; height: number } | null {
  const m = matrix.elements;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const x of [bounds.minX, bounds.maxX]) for (const y of [bounds.minY, bounds.maxY]) {
    const w = m[3] * x + m[7] * y + m[15];
    const z = m[2] * x + m[6] * y + m[14];
    if (!Number.isFinite(w) || w <= 1e-8 || !Number.isFinite(z) || z < (backend === "webgpu" ? 0 : -w) || z > w) return null;
    const px = ((m[0] * x + m[4] * y + m[12]) / w + 1) * width / 2;
    const py = ((m[1] * x + m[5] * y + m[13]) / w + 1) * height / 2;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    minX = Math.min(minX, px); minY = Math.min(minY, py);
    maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Disposes a subset geometry's own instance buffers. Its other attributes and
 * index belong to the source mesh, so they are detached first and survive.
 */
function disposeOwnedInstances(geometry: THREE.BufferGeometry): void {
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (!(attribute instanceof THREE.InstancedBufferAttribute)) geometry.deleteAttribute(name);
  }
  geometry.setIndex(null); geometry.dispose();
}
