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
interface ProxyEntry {
  source: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  run?: VectorDrawRun;
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
  private readonly transfers = new Map<Float32Array, THREE.DataTexture>();
  private readonly zero: THREE.DataTexture;
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

  constructor(backend: "webgl" | "webgpu") {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.zero = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    this.zero.needsUpdate = true;
    const names = ["uSource", "uShape", "uCurrent", "uStats", "uInitial", "uMask", "uTransfer"];
    if (backend === "webgl") {
      const uniforms: Record<string, THREE.IUniform> = {
        uParams: { value: this.params }, uExtra: { value: this.extra }, uMaskBackdrop: { value: this.backdropColor }
      };
      for (const name of names) { const binding = { value: this.zero as THREE.Texture }; this.bindings.push(binding); uniforms[name] = binding; }
      this.passMaterial = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: PDF_COMPOSITE_FRAGMENT_GLSL.replace(/^#version 300 es\s*/, ""), uniforms });
      this.presentationBinding = { value: this.zero };
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
      const textures = names.map(() => TSL.textureLoad(this.zero, TSL.screenCoordinate));
      this.bindings.push(...textures as unknown as TextureBinding[]);
      material.vertexNode = TSL.vec4(TSL.positionLocal.xy, 0, 1);
      // A texture-valued function argument must stay a texture node rather than a sampled vec4.
      const transfer = TSL.textureLoad(this.zero);
      this.bindings[6] = transfer as unknown as TextureBinding;
      material.fragmentNode = callNode(compositeNodeFn, { source: textures[0], shape: textures[1], current: textures[2],
        stats: textures[3], initial: textures[4], mask: textures[5], transferTex: transfer,
        p: TSL.uniform(this.params), q: TSL.uniform(this.extra), backdrop: TSL.uniform(this.backdropColor) });
      this.passMaterial = material;
      const present = new NodeMaterial();
      present.vertexNode = TSL.vec4(TSL.positionLocal.xy, 0, 1);
      const texture = TSL.texture(this.zero, TSL.uv().flipY());
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
    try {
      const resolution = choosePdfCompositeResolution(scene, width, height);
      width = resolution.width; height = resolution.height;
      if (resolution.scale < 1 && !this.warnedResolution) {
        this.warnedResolution = true;
        console.warn("[HEPR] PDF transparency groups use reduced resolution to stay within the 512 MiB compositor budget.");
      }
      if (width !== this.width || height !== this.height) {
        this.releaseSurfaces(); this.width = Math.max(1, Math.floor(width)); this.height = Math.max(1, Math.floor(height));
      } else if (this.output) { this.release(this.output); this.output = null; }
      renderer.autoClear = false;
      if (renderer.xr) renderer.xr.enabled = false;
      renderer.setScissorTest(false);
      this.collect(roots);
      backdrop = this.acquire(); this.clear(backdrop);
      for (const proxy of this.proxies.values()) if (proxy.source.userData.heprPageBackground) {
        proxy.mesh.geometry = proxy.source.geometry; proxy.mesh.material = proxy.source.material;
        this.drawProxy(proxy, backdrop, false);
      }
      this.output = compositeScenePaintGraph(scene, this, backdrop, visible);
      this.presentationBinding.value = this.output.texture;
      // Raw GL paints use display values internally. A postprocessing target
      // expects working-linear color and applies its output transfer afterward.
      this.linearPresentation.value = saved.target || renderer.outputColorSpace === THREE.LinearSRGBColorSpace ? 1 : 0;
      this.mesh.visible = true;
    } finally {
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
    this.surfaces.add(target); return target;
  }
  release(target: THREE.RenderTarget): void { this.pool.push(target); }
  clear(target: THREE.RenderTarget, color: readonly [number, number, number, number] = [0, 0, 0, 0]): void {
    this.target(target); this.renderer!.setClearColor(new THREE.Color().setRGB(color[0], color[1], color[2]), color[3]);
    this.renderer!.clear(true, false, false);
  }
  copy(source: THREE.RenderTarget, destination: THREE.RenderTarget): void { this.pass({ operation: 5, source }, destination); }
  draw(run: VectorDrawRun, destination: THREE.RenderTarget, shapeOnly: boolean): void {
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
      proxy.mesh.material = proxy.source.material;
      proxy.mesh.geometry = this.geometryForRun(proxy, run);
      if (proxy.mesh.geometry instanceof THREE.InstancedBufferGeometry && proxy.mesh.geometry.instanceCount === 0) continue;
      this.drawProxy(proxy, destination, shapeOnly);
    }
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
    try { this.renderer!.render(this.internalScene, this.camera); } finally { this.internalScene.remove(this.passMesh); }
  }
  dispose(): void {
    this.releaseSurfaces();
    for (const proxy of this.proxies.values()) proxy.partialGeometry?.dispose();
    this.proxies.clear();
    this.runsByKind.clear();
    for (const texture of this.transfers.values()) texture.dispose();
    this.transfers.clear(); this.zero.dispose(); this.geometry.dispose(); this.passMaterial.dispose(); this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
  private target(target: THREE.RenderTarget): void { this.renderer!.setRenderTarget(target); }
  private drawProxy(proxy: ProxyEntry, destination: THREE.RenderTarget, shapeOnly: boolean): void {
    const restore = setThreePdfShapeOnly(proxy.mesh.material, shapeOnly);
    this.target(destination); this.internalScene.add(proxy.mesh);
    try { this.renderer!.render(this.internalScene, this.camera); }
    finally { this.internalScene.remove(proxy.mesh); restore(); }
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
      const entry = { source, mesh, run: object.userData.heprDrawRun as VectorDrawRun | undefined, attribute: object.userData.heprInstanceAttribute };
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
  private geometryForRun(proxy: ProxyEntry, run: VectorDrawRun): THREE.BufferGeometry {
    const geometry = proxy.source.geometry;
    if (!proxy.attribute || !proxy.run || (proxy.run.first >= run.first && proxy.run.first + proxy.run.count <= run.first + run.count)) return geometry;
    const source = geometry.getAttribute(proxy.attribute);
    if (!proxy.partialGeometry) {
      const partial = new THREE.InstancedBufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) if (name !== proxy.attribute) partial.setAttribute(name, attribute);
      partial.setIndex(geometry.index); proxy.partialGeometry = partial;
    }
    if (!proxy.partialIds || proxy.partialIds.count < run.count) {
      proxy.partialIds = new THREE.InstancedBufferAttribute(new Float32Array(run.count), 1);
      proxy.partialIds.setUsage(THREE.StreamDrawUsage);
      proxy.partialGeometry.setAttribute(proxy.attribute, proxy.partialIds);
    }
    let count = 0;
    for (let item = 0; item < (geometry as THREE.InstancedBufferGeometry).instanceCount; item++) {
      const index = source.getX(item);
      if (index >= run.first && index < run.first + run.count) proxy.partialIds.setX(count++, index);
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
    this.transfers.set(values, texture); return texture;
  }
}
