import * as THREE from "three";
import ClippingContext from "three/src/renderers/common/ClippingContext.js";

interface PrivateRenderContext {
  viewportValue: THREE.Vector4 & { minDepth?: number; maxDepth?: number };
  scissorValue: THREE.Vector4;
  viewport: boolean;
  scissor: boolean;
  clippingContext?: ClippingContext;
  textures: THREE.Texture[] | null;
  depthTexture: THREE.DepthTexture | null;
  width: number;
  height: number;
  renderTarget: THREE.RenderTarget;
  depth: boolean;
  stencil: boolean;
  activeCubeFace: number;
  activeMipmapLevel: number;
  occlusionQueryCount: number;
  fullscreenPass: boolean;
  camera: THREE.Camera;
}

type RenderObject = (object: THREE.Mesh, scene: THREE.Scene, camera: THREE.Camera,
  geometry: THREE.BufferGeometry, material: THREE.Material, group: null, lightsNode: unknown,
  clippingContext: ClippingContext) => void;
type SceneRenderHook = (renderer: PrivateRenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.RenderTarget) => void;

interface PrivateRenderer {
  isWebGPURenderer: boolean;
  _initialized: boolean;
  _isDeviceLost: boolean;
  _callDepth: number;
  _activeCubeFace: number;
  _activeMipmapLevel: number;
  _mrt: unknown;
  _renderObjectFunction: unknown;
  _currentRenderBundle: unknown;
  _currentRenderContext: PrivateRenderContext | null;
  _currentRenderObjectFunction: unknown;
  _handleObjectFunction: unknown;
  _currentSourceMaterial: unknown;
  _renderObjectDirect: unknown;
  _updateCamera(camera: THREE.Camera, useXRCamera: boolean): THREE.Camera;
  _nodes: { nodeFrame: { renderId: number } };
  _renderContexts: { get(target: THREE.RenderTarget, mrt: null, depth: number): PrivateRenderContext };
  _textures: {
    updateRenderTarget(target: THREE.RenderTarget, mip: number): void;
    get(target: THREE.RenderTarget): { textures: THREE.Texture[]; depthTexture: THREE.DepthTexture | null; width: number; height: number };
  };
  _background: { update(scene: THREE.Scene, list: null, context: PrivateRenderContext): void };
  _canvasTarget: { _scissorTest: boolean };
  backend: {
    isWebGPUBackend: boolean;
    beginRender(context: PrivateRenderContext): void;
    finishRender(context: PrivateRenderContext): void;
    updateTimeStampUID(context: PrivateRenderContext): void;
    getTimestampUID(context: PrivateRenderContext): unknown;
  };
  lighting: { beginRender(scene: THREE.Scene): void; finishRender(scene: THREE.Scene): void; getNode(scene: THREE.Scene): unknown };
  inspector: { beginRender(uid: unknown, scene: THREE.Scene, camera: THREE.Camera, target: THREE.RenderTarget): void; finishRender(uid: unknown): void };
  xr: { isPresenting: boolean };
  info: { calls: number; render: { calls: number; frameCalls: number } };
  opaque: boolean;
  transparent: boolean;
  needsFrameBufferTarget: boolean;
  getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2;
  getRenderTarget(): THREE.RenderTarget | null;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  renderObject: RenderObject;
}

const adapters = new WeakMap<object, ThreeWebGpuDirectPass>();
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const methods = (value: unknown, names: readonly string[]): boolean =>
  record(value) && names.every(name => typeof value[name] === "function");

function supportedState(renderer: PrivateRenderer): boolean {
  return renderer._initialized === true && renderer._isDeviceLost === false && renderer.xr.isPresenting === false &&
    renderer._mrt === null && renderer._renderObjectFunction === null && renderer._currentRenderBundle === null &&
    renderer._activeCubeFace === 0 && renderer._activeMipmapLevel === 0;
}

/**
 * The compositor has already selected and ordered a flat list of private
 * meshes. Skip Three's scene traversal, sorting and render-list construction,
 * retaining its render objects, shaders, buffers, camera conventions and passes.
 * These private fields are deliberately limited to the verified r186 layout.
 */
export function createThreeWebGpuDirectPass(renderer: unknown): ThreeWebGpuDirectPass | null {
  if (THREE.REVISION !== "186" || !record(renderer) || renderer.isWebGPURenderer !== true ||
    !record(renderer.backend) || renderer.backend.isWebGPUBackend !== true ||
    !methods(renderer, ["render", "renderObject", "_renderObjectDirect", "_updateCamera", "getRenderTarget", "getDrawingBufferSize"]) ||
    !methods(renderer.backend, ["beginRender", "finishRender", "updateTimeStampUID", "getTimestampUID"]) ||
    !methods(renderer._renderContexts, ["get"]) || !methods(renderer._textures, ["get", "updateRenderTarget"]) ||
    !methods(renderer._background, ["update"]) || !methods(renderer.lighting, ["beginRender", "finishRender", "getNode"]) ||
    !methods(renderer.inspector, ["beginRender", "finishRender"]) ||
    !record(renderer._nodes) || !record(renderer._nodes.nodeFrame) || !record(renderer._canvasTarget) ||
    !record(renderer.xr) || !record(renderer.info) || !record(renderer.info.render) ||
    typeof renderer._callDepth !== "number" || typeof renderer._nodes.nodeFrame.renderId !== "number") return null;
  const host = renderer as unknown as PrivateRenderer;
  if (!supportedState(host)) return null;
  let adapter = adapters.get(renderer);
  if (!adapter) { adapter = new ThreeWebGpuDirectPass(host); adapters.set(renderer, adapter); }
  return adapter;
}

export class ThreeWebGpuDirectPass {
  private readonly screen = new THREE.Vector4();
  private readonly size = new THREE.Vector2();
  private readonly renderer: PrivateRenderer;
  constructor(renderer: PrivateRenderer) { this.renderer = renderer; }

  /** Returns false when an unsupported host state uses Three's full render. */
  render(scene: THREE.Scene, camera: THREE.Camera): boolean {
    const renderer = this.renderer;
    const target = renderer.getRenderTarget();
    if (!supportedState(renderer) || !target || renderer.needsFrameBufferTarget ||
      target.depthBuffer || target.stencilBuffer || target.samples !== 0 ||
      target.textures.length !== 1 || scene.matrixWorldAutoUpdate || camera.matrixWorldAutoUpdate ||
      (camera as THREE.Camera & { isArrayCamera?: boolean }).isArrayCamera || scene.overrideMaterial ||
      scene.background || scene.backgroundNode || scene.environment || scene.environmentNode || scene.fog ||
      scene.children.some(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || mesh.children.length || mesh.frustumCulled || Array.isArray(mesh.material) ||
          (mesh as THREE.Mesh & { occlusionTest?: boolean }).occlusionTest) return true;
        const material = mesh.material as THREE.Material & { transmission?: number; transmissionNode?: unknown; lights?: boolean };
        return material.lights === true || (material.transmission ?? 0) > 0 || !!material.transmissionNode;
      })) {
      renderer.render(scene, camera);
      return false;
    }

    const nodeFrame = renderer._nodes.nodeFrame;
    const renderId = nodeFrame.renderId;
    const contextBefore = renderer._currentRenderContext;
    const objectFunction = renderer._currentRenderObjectFunction;
    const handleFunction = renderer._handleObjectFunction;
    const sourceMaterial = renderer._currentSourceMaterial;
    const callDepth = renderer._callDepth;
    let context: PrivateRenderContext | undefined;
    let began = false, lighting = false, inspected = false;
    try {
      renderer.lighting.beginRender(scene); lighting = true;
      renderer._callDepth++;
      context = renderer._renderContexts.get(target, null, renderer._callDepth);
      renderer._currentRenderContext = context;
      renderer._currentRenderObjectFunction = renderer.renderObject;
      renderer._handleObjectFunction = renderer._renderObjectDirect;
      renderer.info.calls++; renderer.info.render.calls++; renderer.info.render.frameCalls++;
      // Render-scoped node updates must see a fresh ID for every target, even
      // when its context is reused by another surface with the same format.
      nodeFrame.renderId = renderer.info.calls;
      renderer.backend.updateTimeStampUID(context);
      renderer.inspector.beginRender(renderer.backend.getTimestampUID(context), scene, camera, target); inspected = true;
      camera = renderer._updateCamera(camera, false);

      renderer.getDrawingBufferSize(this.size);
      this.screen.set(0, 0, this.size.width, this.size.height);
      context.viewportValue.copy(target.viewport).floor();
      const viewport = target.viewport as THREE.Vector4 & { minDepth?: number; maxDepth?: number };
      context.viewportValue.minDepth = viewport.minDepth ?? 0;
      context.viewportValue.maxDepth = viewport.maxDepth ?? 1;
      context.viewport = !context.viewportValue.equals(this.screen);
      context.scissorValue.copy(target.scissor).floor();
      context.scissor = renderer._canvasTarget._scissorTest && !context.scissorValue.equals(this.screen);
      if (!context.clippingContext) context.clippingContext = new ClippingContext();
      context.clippingContext.updateGlobal(scene, camera);
      (scene.onBeforeRender as unknown as SceneRenderHook).call(scene, renderer, scene, camera, target);

      renderer._textures.updateRenderTarget(target, 0);
      const data = renderer._textures.get(target);
      context.textures = data.textures; context.depthTexture = data.depthTexture;
      context.width = data.width; context.height = data.height; context.renderTarget = target;
      context.depth = false; context.stencil = false;
      context.activeCubeFace = 0; context.activeMipmapLevel = 0;
      context.occlusionQueryCount = 0; context.fullscreenPass = false;
      const scissor = context.scissorValue;
      scissor.x = Math.max(scissor.x, 0); scissor.y = Math.max(scissor.y, 0);
      scissor.z = Math.min(Math.max(scissor.z, 0), Math.max(context.width - scissor.x, 0));
      scissor.w = Math.min(Math.max(scissor.w, 0), Math.max(context.height - scissor.y, 0));
      renderer._background.update(scene, null, context);
      context.camera = camera;
      renderer.backend.beginRender(context); began = true;
      const lightsNode = renderer.lighting.getNode(scene);
      // Match Three's opaque and transparent lists. The compositor already
      // splits transitions between these lists, so its paint order is intact.
      for (let transparent = 0; transparent < 2; transparent++) {
        if (transparent ? !renderer.transparent : !renderer.opaque) continue;
        for (const child of scene.children) {
          const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
          const material = mesh.material;
          if (Number(material.transparent) !== transparent || !mesh.visible ||
            !mesh.layers.test(camera.layers) || !material.visible) continue;
          const side = material.side;
          try { renderer.renderObject(mesh, scene, camera, mesh.geometry, material, null, lightsNode, context.clippingContext); }
          finally { material.side = side; }
        }
      }
    } finally {
      try { if (began) renderer.backend.finishRender(context!); }
      finally {
        nodeFrame.renderId = renderId;
        renderer._currentRenderContext = contextBefore;
        renderer._currentRenderObjectFunction = objectFunction;
        renderer._handleObjectFunction = handleFunction;
        renderer._currentSourceMaterial = sourceMaterial;
        renderer._callDepth = callDepth;
        try { if (lighting) renderer.lighting.finishRender(scene); }
        finally { if (inspected) renderer.inspector.finishRender(renderer.backend.getTimestampUID(context!)); }
      }
    }
    (scene.onAfterRender as unknown as SceneRenderHook).call(scene, renderer, scene, camera, target);
    return true;
  }
}
