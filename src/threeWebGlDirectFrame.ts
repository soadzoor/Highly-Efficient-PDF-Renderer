import * as THREE from "three";

type PaintMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
type ObjectDrawHook = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  geometry: THREE.BufferGeometry, material: THREE.Material, group: null) => void;
type MaterialDrawHook = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  geometry: THREE.BufferGeometry, object: PaintMesh, group: null) => void;
interface DirectDrawHost {
  renderBufferDirect(camera: THREE.Camera, scene: THREE.Scene, geometry: THREE.BufferGeometry,
    material: THREE.Material, object: PaintMesh, group: null): void;
}

/** The direct path is scoped to the installed renderer and private PDF paints. */
export function createThreeWebGlDirectFrame(renderer: unknown, camera: THREE.Camera): ThreeWebGlDirectFrame | null {
  if (THREE.REVISION !== "186" || !(renderer instanceof THREE.WebGLRenderer) ||
    (renderer as THREE.WebGLRenderer & { isWebGLRenderer?: boolean }).isWebGLRenderer !== true ||
    typeof renderer.renderBufferDirect !== "function") return null;
  return new ThreeWebGlDirectFrame(renderer, camera);
}

/**
 * One ordinary render owns Three's render-state stack for a whole compositor
 * frame. Hidden meshes upload every geometry during its projection phase;
 * a driver hook then draws the recorded surfaces through renderBufferDirect.
 * No renderer internals or GPU resource caches are replaced.
 */
export class ThreeWebGlDirectFrame {
  private readonly scene = new THREE.Scene();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly hiddenMaterial = new THREE.RawShaderMaterial();
  private readonly driverMaterial = new THREE.RawShaderMaterial({
    vertexShader: "precision highp float; attribute vec3 position; void main() { gl_Position = vec4(position, 1.0); }",
    fragmentShader: "precision highp float; void main() { gl_FragColor = vec4(0.0); }",
    depthTest: false, depthWrite: false, toneMapped: false
  });
  private readonly target = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false, colorSpace: THREE.NoColorSpace
  });
  private readonly driver: PaintMesh;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.Camera;
  private readonly uploads: PaintMesh[] = [];
  private active = false;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    this.renderer = renderer; this.camera = camera;
    this.scene.matrixWorldAutoUpdate = false;
    this.hiddenMaterial.visible = false;
    this.geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    // A zero count still reaches gl.drawArrays and increments info.render.calls.
    // An entirely out-of-bounds range clamps to a negative count and skips it.
    this.geometry.setDrawRange(2, 0);
    this.driver = new THREE.Mesh(this.geometry, this.driverMaterial);
    this.driver.frustumCulled = false;
    this.driver.matrixAutoUpdate = false;
    this.driver.layers.mask = camera.layers.mask;
  }

  supports(meshes: readonly PaintMesh[]): boolean {
    return !this.disposed && !(this.camera as THREE.ArrayCamera).isArrayCamera && meshes.every(mesh => mesh.isMesh &&
      !(mesh as THREE.InstancedMesh).isInstancedMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh &&
      !(mesh as THREE.BatchedMesh).isBatchedMesh && mesh.geometry.isBufferGeometry &&
      !Array.isArray(mesh.material) && (mesh.material as THREE.RawShaderMaterial).isRawShaderMaterial === true);
  }

  run(meshes: readonly PaintMesh[], replay: () => void): void {
    if (!this.supports(meshes)) throw new TypeError("Unsupported Three WebGL compositor draw.");
    if (this.active) throw new Error("Three WebGL compositor frame is already active.");
    const renderer = this.renderer;
    const saved = { target: renderer.getRenderTarget(), cube: renderer.getActiveCubeFace(),
      mip: renderer.getActiveMipmapLevel(), sort: renderer.sortObjects, autoClear: renderer.autoClear,
      scissorTest: renderer.getScissorTest(), xr: renderer.xr.enabled };
    let count = 0, failed = false, failure: unknown;
    const fail = (error: unknown): void => { if (!failed) { failed = true; failure = error; } };
    try {
      const geometries = new Set<THREE.BufferGeometry>();
      for (const mesh of meshes) {
        if (geometries.has(mesh.geometry)) continue;
        geometries.add(mesh.geometry);
        let upload = this.uploads[count++];
        if (!upload) {
          upload = new THREE.Mesh(this.geometry, this.hiddenMaterial);
          upload.frustumCulled = false;
          upload.matrixAutoUpdate = false;
          this.uploads.push(upload);
        }
        upload.geometry = mesh.geometry;
        upload.layers.mask = this.camera.layers.mask;
        this.scene.add(upload);
      }
      this.driver.layers.mask = this.camera.layers.mask;
      this.scene.add(this.driver);
      this.driver.onBeforeRender = () => {
        this.active = true;
        try { replay(); } catch (error) { fail(error); }
        finally {
          this.active = false;
          // Let render complete even when replay failed, so its camera,
          // material, VAO and nested render-state caches are restored normally.
          try { renderer.setRenderTarget(this.target); } catch (error) { fail(error); }
        }
      };
      renderer.autoClear = false;
      renderer.sortObjects = false;
      renderer.xr.enabled = false;
      // A private attachment also bypasses Three's canvas output stage when
      // the host uses a HalfFloat output buffer or postprocessing.
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
    } finally {
      this.active = false;
      this.driver.onBeforeRender = () => {};
      this.scene.clear();
      for (let index = 0; index < count; index++) this.uploads[index].geometry = this.geometry;
      renderer.autoClear = saved.autoClear;
      renderer.sortObjects = saved.sort;
      renderer.xr.enabled = saved.xr;
      renderer.setScissorTest(saved.scissorTest);
      renderer.setRenderTarget(saved.target, saved.cube, saved.mip);
    }
    if (failed) throw failure;
  }

  /** The same per-object sequence used by WebGLRenderer's renderObject. */
  draw(mesh: PaintMesh, scene: THREE.Scene): void {
    if (!this.active) throw new Error("Three WebGL compositor draw requires an active frame.");
    const material = mesh.material;
    if (!mesh.visible || !material.visible || !mesh.layers.test(this.camera.layers)) return;
    const renderer = this.renderer, camera = this.camera, geometry = mesh.geometry;
    // The installed renderer passes null for single-material meshes. Its type
    // declarations still require a group object in these public callbacks.
    const hooks = mesh as unknown as { onBeforeRender: ObjectDrawHook; onAfterRender: ObjectDrawHook };
    const materialHook = material as unknown as { onBeforeRender: MaterialDrawHook };
    const direct = renderer as unknown as DirectDrawHost;
    try {
      hooks.onBeforeRender(renderer, scene, camera, geometry, material, null);
      mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
      mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
      materialHook.onBeforeRender(renderer, scene, camera, geometry, mesh, null);
      if (material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass) {
        try {
          material.side = THREE.BackSide; material.needsUpdate = true;
          direct.renderBufferDirect(camera, scene, geometry, material, mesh, null);
          material.side = THREE.FrontSide; material.needsUpdate = true;
          direct.renderBufferDirect(camera, scene, geometry, material, mesh, null);
        } finally { material.side = THREE.DoubleSide; }
      } else direct.renderBufferDirect(camera, scene, geometry, material, mesh, null);
    } finally { hooks.onAfterRender(renderer, scene, camera, geometry, material, null); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.clear();
    for (const upload of this.uploads) upload.geometry = this.geometry;
    this.uploads.length = 0;
    this.geometry.dispose(); this.hiddenMaterial.dispose(); this.driverMaterial.dispose(); this.target.dispose();
  }
}
