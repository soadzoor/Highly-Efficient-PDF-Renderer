import * as THREE from "three";
import { WebGlRasterCompression, MAX_WEBGL_RASTER_COMPRESSION_WORKSPACE_BYTES } from "./webGlRasterCompression";
import { WebGpuRasterCompression } from "./webGpuRasterCompression";
import { selectRasterCompressionFormat, type RasterCompressionFormat } from "./rasterCompression";
import { registerThreeCompressedTexture, type ThreeRasterCompressor } from "./threeRasterTextures";

interface HostRenderer {
  readonly isWebGLRenderer?: boolean;
  readonly isWebGPURenderer?: boolean;
  getContext?: () => unknown;
  readonly backend?: { readonly device?: unknown };
}

type ExternalTexture = THREE.Texture & { sourceTexture: any };
const externalTextureConstructor = (THREE as unknown as {
  ExternalTexture?: new (source: any) => ExternalTexture
}).ExternalTexture;

interface SharedEncoder {
  gl: WebGL2RenderingContext | null;
  webGl: WebGlRasterCompression | null;
  webGpu: WebGpuRasterCompression | null;
  listeners: Set<() => void>;
  active: boolean;
}
const encoders = new WeakMap<HostRenderer, SharedEncoder>();

/** One bounded encoder per host context/device, shared by document and independent page materials. */
export class ThreeRasterCompression implements ThreeRasterCompressor {
  private host: HostRenderer | null = null;
  private shared: SharedEncoder | null = null;
  private disposed = false;
  private readonly onChange: () => void;
  constructor(onChange: () => void) { this.onChange = onChange; }

  setHost(host: HostRenderer): void {
    if (this.disposed || host === this.host) return;
    this.detach(); this.host = host;
    if (!externalTextureConstructor) return;
    let state = encoders.get(host);
    if (!state) {
      state = { gl: null, webGl: null, webGpu: null, listeners: new Set(), active: true };
      encoders.set(host, state);
      const notify = () => { for (const listener of state!.listeners) listener(); };
      if (host.isWebGLRenderer) {
        const gl = host.getContext?.() as WebGL2RenderingContext | undefined;
        if (gl) { state.gl = gl; state.webGl = new WebGlRasterCompression(gl); }
      } else if (host.isWebGPURenderer && host.backend?.device) {
        void WebGpuRasterCompression.create(host.backend.device).then(encoder => {
          if (!state!.active) { encoder?.dispose(); return; }
          state!.webGpu = encoder; encoder?.setFailureListener(notify); notify();
        }).catch(error => console.warn("[HEPR] Three raster compression unavailable; using bounded uncompressed textures.", error));
      }
    }
    this.shared = state; state.listeners.add(this.onChange); this.onChange();
  }

  get format(): RasterCompressionFormat | null {
    const state = this.shared;
    return state?.webGl ? selectRasterCompressionFormat(state.webGl.capabilities)
      : state?.webGpu?.available ? state.webGpu.format : null;
  }
  get workspaceBytes(): number {
    return this.format ? this.shared?.webGpu?.workspaceBytes ?? MAX_WEBGL_RASTER_COMPRESSION_WORKSPACE_BYTES : 0;
  }

  upload(data: Uint8Array, width: number, height: number, format: RasterCompressionFormat): THREE.Texture {
    const state = this.shared;
    const resource = state?.webGl ? state.webGl.upload(data, width, height, format) : state?.webGpu?.createTexture(width, height, data);
    if (!resource || !externalTextureConstructor) throw new Error("The Three host cannot compress this raster.");
    const texture = new externalTextureConstructor(resource.texture);
    texture.image = { width: Math.ceil(width / 4) * 4, height: Math.ceil(height / 4) * 4 };
    texture.flipY = false; texture.generateMipmaps = false;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    // Three deliberately leaves external GPU allocation ownership to its creator.
    const gl = state!.gl;
    texture.addEventListener("dispose", () => {
      if (!texture.sourceTexture) return;
      if (gl) gl.deleteTexture(texture.sourceTexture); else texture.sourceTexture.destroy();
      texture.sourceTexture = null;
    });
    registerThreeCompressedTexture(texture, width, height, format, resource.estimatedBytes, resource.uvScale);
    return texture;
  }

  releaseWorkspace(): void { this.shared?.webGl?.releaseWorkspace(); this.shared?.webGpu?.releaseWorkspace(); }
  dispose(): void { this.disposed = true; this.detach(); }
  private detach(): void {
    const state = this.shared;
    state?.listeners.delete(this.onChange);
    if (state && !state.listeners.size) {
      state.active = false; state.webGl?.dispose(); state.webGpu?.dispose();
      if (this.host) encoders.delete(this.host);
    }
    this.shared = null; this.host = null;
  }
}
