import * as THREE from "three";

export interface ThreeShaderCompileHost {
  compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene | null) => Promise<unknown>;
}

export interface ThreeShaderCompileOptions {
  signal?: AbortSignal;
  targetScene?: THREE.Scene;
}

/**
 * Compile PDF paint materials together before any draw forces a cold program to
 * finish. Hidden layers and compositor-only paints need inert stand-ins: moving
 * their real meshes would disturb scene hooks, and their draw callbacks change
 * shared paint uniforms. The host owns compilation and all borrowed resources.
 */
export async function compileThreeMaterialRoots(host: ThreeShaderCompileHost, camera: THREE.Camera,
  roots: readonly THREE.Object3D[], options: ThreeShaderCompileOptions = {}): Promise<void> {
  options.signal?.throwIfAborted();
  if (!host.compileAsync) return;
  const scene = options.targetScene ? new THREE.Group() : new THREE.Scene();
  const layouts = new Map<THREE.Material, Set<string>>();
  for (const root of roots) root.traverse(object => {
    if (!(object as THREE.Mesh).isMesh) return;
    const source = object as THREE.Mesh;
    const layout = geometryLayout(source.geometry);
    for (const material of Array.isArray(source.material) ? source.material : [source.material]) {
      let known = layouts.get(material);
      if (!known) layouts.set(material, known = new Set());
      if (known.has(layout)) continue;
      known.add(layout);
      const mesh = new THREE.Mesh(source.geometry, material);
      mesh.name = source.name;
      mesh.frustumCulled = false;
      mesh.layers.mask = camera.layers.mask;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(source.matrixWorld);
      scene.add(mesh);
    }
  });
  if (!scene.children.length) return;
  try {
    // Keep the receiver: both renderer implementations read their own state.
    // WebGL queues links without uniform discovery; WebGPU also prepares the
    // bindings and geometry that its pipeline compilation requires.
    // GPU compilation cannot be cancelled. Drain its queued work before an
    // aborted caller can dispose the document or the renderer underneath it.
    await host.compileAsync(scene, camera, options.targetScene);
    options.signal?.throwIfAborted();
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    throw error;
  } finally {
    // Do not dispose the stand-ins: on WebGPU that would evict the pipelines
    // just compiled. Their borrowed materials release the host's caches later.
    scene.clear();
  }
}

function geometryLayout(geometry: THREE.BufferGeometry): string {
  const buffers = new Map<THREE.BufferAttribute | THREE.InterleavedBuffer, number>();
  const attributes = Object.keys(geometry.attributes).sort().map(name => {
    const attribute = geometry.getAttribute(name);
    const interleaved = attribute instanceof THREE.InterleavedBufferAttribute;
    const buffer = interleaved ? attribute.data : attribute;
    if (!buffers.has(buffer)) buffers.set(buffer, buffers.size);
    const instances = interleaved && buffer instanceof THREE.InstancedInterleavedBuffer
      ? buffer.meshPerAttribute : attribute instanceof THREE.InstancedBufferAttribute ? attribute.meshPerAttribute : 0;
    return [name, buffers.get(buffer), attribute.itemSize, attribute.normalized, attribute.array.constructor.name,
      interleaved ? attribute.data.stride : attribute.itemSize, interleaved ? attribute.offset : 0,
      interleaved ? undefined : attribute.gpuType, instances];
  });
  // Morph targets are object-specific shader inputs, unlike PDF instance IDs.
  const morph = Object.values(geometry.morphAttributes).some(attributes => attributes?.length) ? geometry.id : 0;
  return JSON.stringify([geometry instanceof THREE.InstancedBufferGeometry, geometry.index?.array.constructor.name,
    attributes, morph]);
}
