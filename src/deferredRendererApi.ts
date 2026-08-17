import type { VectorScene } from "./pdfVectorExtractor";
import type { RendererApi } from "./rendererTypes";
import type { SceneStats } from "./webGlFloorplanRenderer";

/**
 * Renderer facade used by the three.js adapter to postpone the expensive
 * native scene upload until the texture fallback is actually needed.
 *
 * The native renderer itself remains the proxy target, so advanced consumers
 * retain the existing renderer API and runtime behavior. Configuration, view,
 * interaction, and hit-testing calls go straight through without allocating a
 * second copy of the scene. Calls that need native scene resources force the
 * deferred upload first.
 */
export interface DeferredSceneRendererApi extends RendererApi {
  /** Whether the pending scene has been uploaded to the native backend. */
  hasUploadedScene(): boolean;

  /** Upload the pending scene now, returning its native resource statistics. */
  ensureSceneUploaded(): SceneStats;
}

const SCENE_RESOURCE_METHODS = new Set<PropertyKey>([
  "getSceneStats",
  "getTextLodStats",
  "getVectorStrokeLodStats",
  "renderExternalFrame",
  "renderProjectedFrame"
]);

/**
 * Wrap an initialized native backend without uploading `initialScene` yet.
 *
 * `setScene` keeps its normal eager semantics when explicitly called through
 * the public API. Only the scene supplied by the three.js factory is deferred.
 */
export function deferRendererSceneUpload(
  renderer: RendererApi,
  initialScene: VectorScene
): DeferredSceneRendererApi {
  let pendingScene = initialScene;
  let sceneUploaded = false;
  let disposed = false;
  let uploadedStats: SceneStats | null = null;
  const forwardedMethods = new Map<PropertyKey, { source: Function; forwarded: Function }>();

  const ensureSceneUploaded = (): SceneStats => {
    if (disposed) {
      throw new Error("Cannot upload a scene after the native renderer has been disposed.");
    }
    if (!sceneUploaded) {
      uploadedStats = renderer.setScene(pendingScene);
      sceneUploaded = true;
    }
    if (!uploadedStats) {
      throw new Error("The native renderer did not return scene statistics after uploading the scene.");
    }
    return uploadedStats;
  };

  const hasUploadedScene = (): boolean => sceneUploaded;
  const setScene = (scene: VectorScene): SceneStats => {
    pendingScene = scene;
    const stats = renderer.setScene(scene);
    uploadedStats = stats;
    sceneUploaded = true;
    return stats;
  };
  const dispose = (): void => {
    disposed = true;
    renderer.dispose();
  };

  const proxy = new Proxy(renderer, {
    get(target, property): unknown {
      if (property === "hasUploadedScene") {
        return hasUploadedScene;
      }
      if (property === "ensureSceneUploaded") {
        return ensureSceneUploaded;
      }
      if (property === "setScene") {
        return setScene;
      }
      if (property === "dispose") {
        return dispose;
      }

      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function" || property === "constructor") {
        return value;
      }
      const cached = forwardedMethods.get(property);
      if (cached?.source === value) {
        return cached.forwarded;
      }
      let forwarded: (...args: unknown[]) => unknown;
      if (property === "setExternalFrameDriver") {
        forwarded = (...args: unknown[]): unknown => {
          // Once the native backend owns its frame loop, its internal calls no
          // longer pass through this proxy. Materialize first so the queued
          // autonomous frame cannot present an empty scene.
          // Match the native renderers' Boolean coercion exactly so untyped
          // JavaScript callers cannot bypass the guard with null, 0, or "".
          if (!Boolean(args[0])) {
            ensureSceneUploaded();
          }
          return Reflect.apply(value, target, args);
        };
      } else if (SCENE_RESOURCE_METHODS.has(property)) {
        forwarded = (...args: unknown[]): unknown => {
          ensureSceneUploaded();
          return Reflect.apply(value, target, args);
        };
      } else {
        forwarded = (...args: unknown[]): unknown => Reflect.apply(value, target, args);
      }
      forwardedMethods.set(property, { source: value, forwarded });
      return forwarded;
    },
    set(target, property, value): boolean {
      return Reflect.set(target, property, value, target);
    }
  });

  return proxy as DeferredSceneRendererApi;
}
