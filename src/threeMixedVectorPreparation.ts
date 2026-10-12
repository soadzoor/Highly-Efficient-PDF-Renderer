import * as THREE from "three";
import { compileThreeMaterialRoots, type ThreeShaderCompileHost } from "./threeShaderPreparation";

interface RenderPipelineObject { material?: THREE.Material; }
interface PipelineManager {
  getForRender: (object: RenderPipelineObject, promises?: unknown) => unknown;
}
interface PipelineData { pipeline?: unknown; error?: boolean; }
interface InspectableHost extends ThreeShaderCompileHost {
  init?: () => Promise<unknown>;
  _pipelines?: PipelineManager;
  backend?: { get: (pipeline: object) => PipelineData };
}
interface PipelineObserver {
  materials: Set<THREE.Material>;
  pipelines: Set<object>;
}
interface PipelineObservation {
  original: PipelineManager["getForRender"];
  wrapper: PipelineManager["getForRender"];
  observers: Set<PipelineObserver>;
}

const observations = new WeakMap<PipelineManager, PipelineObservation>();

/**
 * Three resolves compileAsync even when its WebGPU pipeline creation failed.
 * Inspect the exact pipelines selected for these optional materials before
 * replacing any ordinary draws. Unknown host implementations keep those draws.
 */
export async function compileThreeMixedVectorRoots(host: ThreeShaderCompileHost, camera: THREE.Camera,
  roots: readonly THREE.Object3D[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const inspectable = host as InspectableHost;
  if (!inspectable._pipelines && inspectable.init) await inspectable.init();
  signal?.throwIfAborted();
  const manager = inspectable._pipelines, backend = inspectable.backend;
  if (!host.compileAsync || !manager || typeof manager.getForRender !== "function" || typeof backend?.get !== "function") {
    throw new Error("The host cannot verify optional mixed vector pipelines.");
  }
  const observer: PipelineObserver = { materials: new Set(), pipelines: new Set() };
  for (const root of roots) root.traverse(object => {
    if (!(object as THREE.Mesh).isMesh) return;
    const material = (object as THREE.Mesh).material;
    for (const item of Array.isArray(material) ? material : [material]) observer.materials.add(item);
  });
  const release = observePipelines(manager, observer);
  try {
    await compileThreeMaterialRoots(host, camera, roots, { signal });
    if (!observer.pipelines.size) throw new Error("The host did not prepare a verifiable mixed vector pipeline.");
    for (const pipeline of observer.pipelines) {
      const data = backend.get(pipeline);
      if (data.error || data.pipeline == null) throw new Error("The mixed vector GPU pipeline did not compile successfully.");
    }
  } finally { release(); }
}

function observePipelines(manager: PipelineManager, observer: PipelineObserver): () => void {
  let observation = observations.get(manager);
  if (!observation) {
    const original = manager.getForRender, observers = new Set<PipelineObserver>();
    const wrapper: PipelineManager["getForRender"] = function(this: PipelineManager, object, promises) {
      const pipeline = original.call(this, object, promises);
      if (pipeline && typeof pipeline === "object") for (const active of observers) {
        if (object.material && active.materials.has(object.material)) active.pipelines.add(pipeline);
      }
      return pipeline;
    };
    observation = { original, wrapper, observers };
    observations.set(manager, observation);
    manager.getForRender = wrapper;
  }
  observation.observers.add(observer);
  return () => {
    observation.observers.delete(observer);
    if (observation.observers.size) return;
    if (manager.getForRender === observation.wrapper) manager.getForRender = observation.original;
    observations.delete(manager);
  };
}
