import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { compositeScenePaintGraph, type PdfCompositeOperation, type ScenePaintCompositorAdapter } from "./scenePaintCompositor";
import { PDF_COMPOSITE_FRAGMENT_GLSL, pdfCompositeFunctions } from "./pdfCompositeShaders";
import { setThreePdfShapeOnly } from "./threePdfShape";
import { HEPR_THREE_LAYER_ORDER_TEXT } from "./threeLayerOrder";
import { choosePdfCompositeResolution } from "./pdfCompositeBudget";

/** Public renderer operations only, so Three retains ownership of its GPU state cache. */
export interface ThreePaintHostRenderer {
  autoClear: boolean;
  readonly outputColorSpace?: string;
  xr?: { enabled: boolean };
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

interface ProxyEntry {
  source: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  run?: VectorDrawRun;
  runIndices?: readonly number[];
  attribute?: string;
  partialGeometry?: THREE.InstancedBufferGeometry;
  partialIds?: THREE.InstancedBufferAttribute;
}

const FULLSCREEN_VERTEX = `precision highp float;
in vec3 position;
void main() { gl_Position=vec4(position.xy,0.0,1.0); }`;

function callNode(fn: unknown, params: Record<string, unknown>): never {
  return (fn as (params: Record<string, unknown>) => unknown)(params) as never;
}

/**
 * Three keys a texture uniform by the bound texture's UUID, so several texture
 * nodes that hold the same texture when the shader is built collapse onto one
 * binding. Every composite input starts on the shared placeholder, and
 * `current`/`initial` legitimately name one surface in the final pass, so the
 * pass shader was generated with a single texture that all seven inputs read:
 * the composite math then saw its own source in every channel and resolved to
 * nothing. Pin each input to its own hash so the seven bindings stay separate
 * whatever they point at, and name them after the GLSL uniforms they mirror.
 */
function bindCompositeTexture(node: unknown, name: string): TextureBinding {
  const uniform = node as { name: string; getUniformHash: () => string };
  uniform.name = name;
  uniform.getUniformHash = () => `hepr-composite-${name}`;
  return node as TextureBinding;
}

const compositeNodeFn: unknown = TSL.wgslFn(`
fn heprComposite(source:vec4f, shape:vec4f, current:vec4f, stats:vec4f, initial:vec4f,
  mask:vec4f, transferTex:texture_2d<f32>, p:vec4f, q:vec4f, backdrop:vec3f) -> vec4f {
  if (p.x==4.0) {
    var value=source.a;
    if (q.y>0.5) { value=pdfLum(source.rgb+(1.0-source.a)*backdrop); }
    value=clamp(value,0.0,1.0);
    if (q.z>1.0) {
      let at=value*(q.z-1.0); let first=i32(floor(at));
      let width=i32(textureDimensions(transferTex).x); let next=min(first+1,i32(q.z)-1);
      value=mix(textureLoad(transferTex,vec2i(first%width,first/width),0).r,
        textureLoad(transferTex,vec2i(next%width,next/width),0).r,fract(at));
    }
    return vec4f(value);
  }
  return pdfCompositePass(source,shape,current,stats,initial,mask,p,q);
}`, [TSL.wgslFn(pdfCompositeFunctions("wgsl"))] as never);

const presentNodeFn: unknown = TSL.wgslFn(`
fn heprPresentComposite(color:vec4f) -> vec4f {
  return vec4f(color.rgb/max(color.a,0.0000001),color.a);
}`);

/** Direct Three GL/GPU compositing. Primitive meshes share their canonical GPU geometry. */
export class ThreePaintCompositor implements ScenePaintCompositorAdapter<THREE.RenderTarget> {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private readonly geometry: THREE.BufferGeometry;
  private readonly passMaterial: THREE.Material;
  private readonly passMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private readonly internalScene = new THREE.Scene();
  // Every pass and proxy material writes clip position itself, so this camera
  // only satisfies `renderer.render(scene, camera)`. It must still be a concrete
  // camera: WebGPURenderer rebuilds the projection for its own coordinate system
  // on first use, and the abstract base class has no updateProjectionMatrix.
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly pool: THREE.RenderTarget[] = [];
  private readonly surfaces = new Set<THREE.RenderTarget>();
  private readonly proxies = new Map<THREE.Object3D, ProxyEntry>();
  private readonly runsByKind = new Map<VectorDrawRun["kind"], ProxyEntry[]>();
  private paintSelection: Uint8Array | null = null;
  private readonly transfers = new Map<Float32Array, THREE.DataTexture>();
  private readonly zero: THREE.DataTexture;
  private readonly presentZero: THREE.DataTexture;
  private readonly bindings: TextureBinding[] = [];
  private readonly params = new THREE.Vector4();
  private readonly extra = new THREE.Vector4();
  private readonly backdropColor = new THREE.Vector3();
  private readonly presentationBinding: TextureBinding;
  private readonly linearPresentation = { value: 0 };
  private renderer: ThreePaintHostRenderer | null = null;
  private output: THREE.RenderTarget | null = null;
  private width = 0;
  private height = 0;
  private rendering = false;
  private warnedResolution = false;
  private readonly backend: "webgl" | "webgpu";
  private bindingVersion = 0;
  /**
   * Opt-in WebGPU pass attribution. A texture used as both a binding and a
   * render attachment inside one pass is reported by the device asynchronously,
   * with no way back to the call that encoded it. Setting this, or the
   * `HEPR_DEBUG_COMPOSITOR_VALIDATION` global, brackets every compositor render
   * in an error scope so the failing operation names itself.
   */
  debugValidation = false;

  constructor(backend: "webgl" | "webgpu") {
    this.backend = backend;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.zero = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    this.zero.needsUpdate = true;
    this.stampBindingVersion(this.zero);
    // Three decides at shader-generation time whether a sampled texture is
    // filterable, and it reads that from whatever the node holds then. A
    // DataTexture defaults to nearest on both filters, which compiled the
    // presentation material to a point fetch, so the surfaces the 512 MiB
    // budget scales below the viewport came back blocky where the GL path
    // filtered them. The presented surface therefore starts on its own
    // filterable placeholder. The pass inputs keep the nearest one: they are
    // explicit texture loads, and a filterable value would add an unused
    // sampler binding per input to every composite pass.
    this.presentZero = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    this.presentZero.minFilter = this.presentZero.magFilter = THREE.LinearFilter;
    this.presentZero.needsUpdate = true;
    this.stampBindingVersion(this.presentZero);
    const names = ["uSource", "uShape", "uCurrent", "uStats", "uInitial", "uMask", "uTransfer"];
    if (backend === "webgl") {
      const uniforms: Record<string, THREE.IUniform> = {
        uParams: { value: this.params }, uExtra: { value: this.extra }, uMaskBackdrop: { value: this.backdropColor }
      };
      for (const name of names) { const binding = { value: this.zero as THREE.Texture }; this.bindings.push(binding); uniforms[name] = binding; }
      this.passMaterial = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: PDF_COMPOSITE_FRAGMENT_GLSL.replace(/^#version 300 es\s*/, ""), uniforms });
      this.presentationBinding = { value: this.presentZero };
      const material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3,
        vertexShader: `precision highp float; in vec3 position; out vec2 vUv;
          void main(){vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.0,1.0);}`,
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
        uniforms: { uImage: this.presentationBinding, uLinearOutput: this.linearPresentation } });
      this.mesh = new THREE.Mesh(this.geometry, material);
    } else {
      const material = new NodeMaterial();
      const textures = names.slice(0, 6).map(name =>
        bindCompositeTexture(TSL.textureLoad(this.zero, TSL.screenCoordinate), name));
      this.bindings.push(...textures);
      material.vertexNode = TSL.vec4(TSL.positionLocal.xy, 0, 1);
      // A texture-valued function argument must stay a texture node rather than a sampled vec4.
      const transfer = bindCompositeTexture(TSL.textureLoad(this.zero), names[6]);
      this.bindings.push(transfer);
      material.fragmentNode = callNode(compositeNodeFn, { source: textures[0], shape: textures[1], current: textures[2],
        stats: textures[3], initial: textures[4], mask: textures[5], transferTex: transfer,
        p: TSL.uniform(this.params), q: TSL.uniform(this.extra), backdrop: TSL.uniform(this.backdropColor) });
      this.passMaterial = material;
      const present = new NodeMaterial();
      present.vertexNode = TSL.vec4(TSL.positionLocal.xy, 0, 1);
      const texture = TSL.texture(this.presentZero, TSL.uv().flipY());
      // Three applies the host output transfer to straight color before blending.
      present.fragmentNode = callNode(presentNodeFn, { color: texture });
      this.presentationBinding = texture as unknown as TextureBinding;
      this.mesh = new THREE.Mesh(this.geometry, present);
    }
    for (const material of [this.passMaterial, this.mesh.material]) {
      material.depthTest = material.depthWrite = material.toneMapped = false;
      material.side = THREE.DoubleSide;
      material.blending = THREE.NoBlending;
      if (material instanceof NodeMaterial) { material.fog = material.lights = false; }
    }
    this.mesh.material.blending = THREE.CustomBlending;
    this.mesh.material.blendSrc = this.mesh.material.blendSrcAlpha = THREE.OneFactor;
    if (backend === "webgpu") this.mesh.material.blendSrc = THREE.SrcAlphaFactor;
    this.mesh.material.blendDst = this.mesh.material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = HEPR_THREE_LAYER_ORDER_TEXT;
    this.mesh.visible = false;
    this.passMesh = new THREE.Mesh(this.geometry, this.passMaterial);
    this.passMesh.frustumCulled = false;
  }

  render(renderer: ThreePaintHostRenderer, scene: VectorScene, roots: readonly THREE.Object3D[], width: number, height: number,
    visible: (condition?: number) => boolean): void {
    if (this.rendering) return;
    this.rendering = true;
    this.renderer = renderer;
    const saved = { target: renderer.getRenderTarget(), cube: renderer.getActiveCubeFace?.() ?? 0,
      mip: renderer.getActiveMipmapLevel?.() ?? 0, viewport: renderer.getViewport(new THREE.Vector4()),
      scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest(),
      clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear,
      xr: renderer.xr?.enabled };
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
      renderer.setScissorTest(false);
      this.collect(roots);
      const selected = this.selectPaints(scene);
      backdrop = this.acquire(); this.clear(backdrop);
      const backgrounds: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
      for (const proxy of this.proxies.values()) if (proxy.source.userData.heprPageBackground) {
        proxy.mesh.geometry = proxy.source.geometry; proxy.mesh.material = proxy.source.material;
        proxy.mesh.renderOrder = backgrounds.length;
        backgrounds.push(proxy.mesh);
      }
      this.drawMeshes(backgrounds, backdrop, false);
      this.output = compositeScenePaintGraph(scene, this, backdrop, visible, selected);
      this.presentationBinding.value = this.output.texture;
      // Raw GL paints use display values internally. A postprocessing target
      // expects working-linear color and applies its output transfer afterward.
      this.linearPresentation.value = saved.target || renderer.outputColorSpace === THREE.LinearSRGBColorSpace ? 1 : 0;
      this.mesh.visible = true;
    } finally {
      if (presented) this.release(presented);
      if (backdrop) this.release(backdrop);
      this.internalScene.clear();
      renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest);
      // Binding a target restores its own physical viewport/scissor. Global
      // viewport APIs retain the default-framebuffer values in Three.
      renderer.setRenderTarget(saved.target, saved.cube, saved.mip);
      renderer.setClearColor(saved.clear, saved.alpha); renderer.autoClear = saved.autoClear;
      if (renderer.xr && saved.xr !== undefined) renderer.xr.enabled = saved.xr;
      this.renderer = null; this.rendering = false;
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
    this.surfaces.add(target); return target;
  }
  release(target: THREE.RenderTarget): void { this.pool.push(target); }
  clear(target: THREE.RenderTarget, color: readonly [number, number, number, number] = [0, 0, 0, 0]): void {
    this.target(target); this.renderer!.setClearColor(new THREE.Color().setRGB(color[0], color[1], color[2]), color[3]);
    this.renderer!.clear(true, false, false);
  }
  copy(source: THREE.RenderTarget, destination: THREE.RenderTarget): void { this.pass({ operation: 5, source }, destination); }
  draw(runs: readonly VectorDrawRun[], destination: THREE.RenderTarget, shapeOnly: boolean): void {
    // One proxy can back several runs of a batched span, and geometryForRun
    // rebuilds a single shared partial buffer per proxy. Collect each proxy's
    // runs first so every proxy is prepared exactly once, then submit the whole
    // span as a single host render. The runs are kept individually rather than
    // merged into one range: a span skips paints whose optional content is
    // hidden, so its range can have holes that a merged range would repaint.
    const ordered: ProxyEntry[] = [];
    const byProxy = new Map<ProxyEntry, VectorDrawRun[]>();
    for (const run of runs) {
      const candidates = this.runsByKind.get(run.kind) ?? [];
      let low = 0, high = candidates.length;
      while (low < high) {
        const middle = (low + high) >>> 1, source = candidates[middle].run!;
        if (source.first + source.count <= run.first) low = middle + 1; else high = middle;
      }
      for (let index = low; index < candidates.length; index++) {
        const proxy = candidates[index];
        const sourceRun = proxy.run;
        if (sourceRun && sourceRun.first >= run.first + run.count) break;
        if (!sourceRun || sourceRun.kind !== run.kind || sourceRun.first >= run.first + run.count ||
            sourceRun.first + sourceRun.count <= run.first) continue;
        const previous = byProxy.get(proxy);
        if (previous) previous.push(run);
        else { byProxy.set(proxy, [run]); ordered.push(proxy); }
      }
    }
    const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
    for (const proxy of ordered) {
      proxy.mesh.material = proxy.source.material;
      proxy.mesh.geometry = this.geometryForRuns(proxy, byProxy.get(proxy)!);
      if (proxy.mesh.geometry instanceof THREE.InstancedBufferGeometry && proxy.mesh.geometry.instanceCount === 0) continue;
      // Proxy meshes are private to the compositor, so an explicit order keeps
      // source order without depending on the layer's own render order.
      proxy.mesh.renderOrder = meshes.length;
      meshes.push(proxy.mesh);
    }
    this.drawMeshes(meshes, destination, shapeOnly);
  }
  pass(operation: PdfCompositeOperation<THREE.RenderTarget>, destination: THREE.RenderTarget): void {
    const sources = [operation.source, operation.shape, operation.current, operation.stats, operation.initial, operation.mask];
    for (let index = 0; index < sources.length; index++) this.bindings[index].value = sources[index]?.texture ?? this.zero;
    const transfer = operation.softMask?.transfer;
    this.bindings[6].value = transfer ? this.transferTexture(transfer) : this.zero;
    this.params.set(operation.operation, operation.blendMode ?? 0, operation.knockout ? 1 : 0, operation.opacity ?? 1);
    this.extra.set(operation.alphaIsShape ? 1 : 0, operation.softMask?.subtype === "Luminosity" ? 1 : 0, transfer?.length ?? 0, 0);
    this.backdropColor.fromArray(operation.softMask?.backdrop ?? [0, 0, 0]);
    this.target(destination); this.internalScene.add(this.passMesh);
    try {
      this.hostRender(() => `pass op${operation.operation} -> ${surfaceLabel(destination)} ` +
        `sources ${sources.map(source => source ? surfaceLabel(source) : "-").join(",")}`);
    } finally { this.internalScene.remove(this.passMesh); }
  }
  dispose(): void {
    this.releaseSurfaces();
    for (const proxy of this.proxies.values()) proxy.partialGeometry?.dispose();
    this.proxies.clear();
    this.runsByKind.clear();
    for (const texture of this.transfers.values()) texture.dispose();
    this.transfers.clear(); this.zero.dispose(); this.presentZero.dispose(); this.geometry.dispose(); this.passMaterial.dispose(); this.mesh.material.dispose();
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
  private target(target: THREE.RenderTarget): void { this.renderer!.setRenderTarget(target); }
  private hostRender(label: () => string): void {
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
  private drawMeshes(meshes: readonly THREE.Mesh<THREE.BufferGeometry, THREE.Material>[],
    destination: THREE.RenderTarget, shapeOnly: boolean): void {
    if (meshes.length === 0) return;
    // Clip clones share one shape input, so restore in reverse: the last
    // writer of a shared uniform must be the first to put it back.
    const restores = meshes.map(mesh => setThreePdfShapeOnly(mesh.material, shapeOnly));
    this.target(destination);
    for (const mesh of meshes) this.internalScene.add(mesh);
    try { this.hostRender(() => `draw ${meshes.length} mesh(es) -> ${surfaceLabel(destination)}`); }
    finally {
      for (const mesh of meshes) this.internalScene.remove(mesh);
      for (let index = restores.length - 1; index >= 0; index--) restores[index]();
    }
  }
  /**
   * Which paints still have something on screen, taken from the instance
   * culling the layers already did. The test matches the one `draw` applies to
   * each mesh, so this drops exactly the paints that would have submitted
   * nothing. A batched mesh reports for every paint behind it at once, which
   * can keep a group standing that might have been dropped but never removes a
   * paint that still draws. Paints no mesh owns, such as raster and gradient
   * slots, are always kept. null means nothing was culled.
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
    return culled ? selected : null;
  }

  private collect(roots: readonly THREE.Object3D[]): void {
    let changed = false;
    const present = new Set<THREE.Object3D>();
    for (const root of roots) root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || (!object.userData.heprDrawRun && !object.userData.heprPageBackground)) return;
      present.add(object);
      if (this.proxies.has(object)) return;
      const source = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      const mesh = new THREE.Mesh(source.geometry, source.material); mesh.frustumCulled = false;
      const entry = { source, mesh, run: object.userData.heprDrawRun as VectorDrawRun | undefined,
        runIndices: object.userData.heprDrawRunIndices as readonly number[] | undefined,
        attribute: object.userData.heprInstanceAttribute };
      this.proxies.set(object, entry);
      if (entry.run) {
        let runs = this.runsByKind.get(entry.run.kind);
        if (!runs) this.runsByKind.set(entry.run.kind, runs = []);
        runs.push(entry); changed = true;
      }
    });
    for (const [object, entry] of this.proxies) if (!present.has(object)) {
      entry.partialGeometry?.dispose(); this.proxies.delete(object); changed = true;
      if (entry.run) {
        const runs = this.runsByKind.get(entry.run.kind)!;
        const index = runs.indexOf(entry); if (index >= 0) runs.splice(index, 1);
      }
    }
    if (changed) for (const runs of this.runsByKind.values()) runs.sort((a, b) => a.run!.first - b.run!.first);
  }
  private geometryForRuns(proxy: ProxyEntry, runs: readonly VectorDrawRun[]): THREE.BufferGeometry {
    const geometry = proxy.source.geometry;
    const covered = (run: VectorDrawRun): boolean =>
      proxy.run!.first >= run.first && proxy.run!.first + proxy.run!.count <= run.first + run.count;
    if (!proxy.attribute || !proxy.run || runs.some(covered)) return geometry;
    const source = geometry.getAttribute(proxy.attribute);
    const capacity = runs.reduce((total, run) => total + run.count, 0);
    if (!proxy.partialGeometry) {
      const partial = new THREE.InstancedBufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) if (name !== proxy.attribute) partial.setAttribute(name, attribute);
      partial.setIndex(geometry.index); proxy.partialGeometry = partial;
    }
    if (!proxy.partialIds || proxy.partialIds.count < capacity) {
      proxy.partialIds = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      proxy.partialIds.setUsage(THREE.StreamDrawUsage);
      proxy.partialGeometry.setAttribute(proxy.attribute, proxy.partialIds);
    }
    let count = 0;
    for (let item = 0; item < (geometry as THREE.InstancedBufferGeometry).instanceCount; item++) {
      const index = source.getX(item);
      if (runs.some(run => index >= run.first && index < run.first + run.count)) proxy.partialIds.setX(count++, index);
    }
    proxy.partialGeometry.instanceCount = count; proxy.partialIds.needsUpdate = true;
    return proxy.partialGeometry;
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
