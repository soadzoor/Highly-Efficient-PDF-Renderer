type GpuObject = object & Record<PropertyKey, unknown>;
type GpuMethod = (...args: unknown[]) => unknown;

interface CommandDependencies { buffers: Set<object>; groups: Set<object>; known: boolean }
interface GroupDependencies { buffers: Set<object>; known: boolean }
interface StagedWrite { buffer: object | null; offset: number; source: number; size: number }

export interface ThreeWebGpuSubmissionStats {
  requestedSubmissions: number;
  submissions: number;
  commandBuffers: number;
  bufferWriteBarriers: number;
  resourceWriteBarriers: number;
  unknownBarriers: number;
  requestedBufferWrites: number;
  bufferWrites: number;
  stagedUploadBytes: number;
}

export interface ThreeWebGpuSubmissionBatch {
  /** Synchronous GPU encoding only. Nested scopes share their outer batch. */
  run<T>(work: () => T): T;
  readonly stats: ThreeWebGpuSubmissionStats;
  /** Restores native methods without destroying any Three resources. */
  dispose(): void;
}

const installed = new WeakMap<object, ThreeWebGpuSubmissionBatch>();
const devices = new WeakMap<object, ThreeWebGpuSubmissionBatch>();
const MAX_COMMAND_BUFFERS = 256;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const COPY_SRC = 0x0004, COPY_DST = 0x0008;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const ARRAY_KIND = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, Symbol.toStringTag)!.get!;
const ELEMENT_BYTES: Record<string, number> = { Int8Array: 1, Uint8Array: 1, Uint8ClampedArray: 1,
  Int16Array: 2, Uint16Array: 2, Float16Array: 2, Int32Array: 4, Uint32Array: 4, Float32Array: 4,
  Float64Array: 8, BigInt64Array: 8, BigUint64Array: 8 };
const PASS_METHODS = new Set<PropertyKey>(["setPipeline", "draw", "drawIndexed", "dispatchWorkgroups", "setViewport",
  "setScissorRect", "setBlendConstant", "setStencilReference", "beginOcclusionQuery", "endOcclusionQuery", "end",
  "insertDebugMarker", "pushDebugGroup", "popDebugGroup"]);
const ENCODER_METHODS = new Set<PropertyKey>(["copyTextureToTexture", "writeTimestamp", "insertDebugMarker",
  "pushDebugGroup", "popDebugGroup"]);
const object = (value: unknown): value is GpuObject =>
  value !== null && (typeof value === "object" || typeof value === "function");

function emptyStats(): ThreeWebGpuSubmissionStats {
  return { requestedSubmissions: 0, submissions: 0, commandBuffers: 0,
    bufferWriteBarriers: 0, resourceWriteBarriers: 0, unknownBarriers: 0,
    requestedBufferWrites: 0, bufferWrites: 0, stagedUploadBytes: 0 };
}

/** WebGPU writeBuffer uses element offsets for TypedArrays, bytes otherwise. */
function sourceBytes(args: unknown[]): Uint8Array | null {
  const [buffer, offset, data, dataOffset = 0, size] = args;
  if (!object(buffer) || typeof buffer.size !== "number" || typeof buffer.usage !== "number" ||
    (buffer.usage & COPY_DST) === 0 || buffer.mapState !== "unmapped" ||
    typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset % 4 !== 0 ||
    typeof dataOffset !== "number" || !Number.isSafeInteger(dataOffset) || dataOffset < 0) return null;
  let bytes: number, start: number, storage: ArrayBufferLike;
  if (ArrayBuffer.isView(data)) {
    let factor: number;
    try {
      const kind = ARRAY_KIND.call(data) as string | undefined;
      factor = kind ? ELEMENT_BYTES[kind] : 1;
      if (!factor) return null;
      const prototype = kind ? TYPED_ARRAY_PROTOTYPE : DataView.prototype;
      bytes = Object.getOwnPropertyDescriptor(prototype, "byteLength")!.get!.call(data);
      start = Object.getOwnPropertyDescriptor(prototype, "byteOffset")!.get!.call(data);
      storage = Object.getOwnPropertyDescriptor(prototype, "buffer")!.get!.call(data);
    } catch { return null; }
    if (size !== undefined && (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)) return null;
    const count = size === undefined ? bytes - dataOffset * factor : (size as number) * factor;
    const sourceOffset = dataOffset * factor;
    if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_UPLOAD_BYTES || count % 4 !== 0 ||
      sourceOffset + count > bytes || offset + count > buffer.size) return null;
    try { return new Uint8Array(storage, start + sourceOffset, count); } catch { return null; }
  }
  if (!(data instanceof ArrayBuffer) && !(typeof SharedArrayBuffer !== "undefined" && data instanceof SharedArrayBuffer)) return null;
  if (size !== undefined && (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)) return null;
  const count = size === undefined ? data.byteLength - dataOffset : size as number;
  if (count <= 0 || count > MAX_UPLOAD_BYTES || count % 4 !== 0 || dataOffset + count > data.byteLength ||
    offset + count > buffer.size) return null;
  try { return new Uint8Array(data, dataOffset, count); } catch { return null; }
}

/**
 * Three submits each render target separately. Combine their command buffers
 * while retaining WebGPU queue ordering: a write to a buffer used by earlier
 * encoded work submits that work first. Uniforms must never be overwritten by
 * a later render before their original render has entered the queue.
 *
 * Only standard GPU calls are intercepted. Three still owns all encoders,
 * passes, bindings and resources. Unknown commands/bindings submit normally.
 * Install before shader preparation so existing bind groups can be tracked.
 */
export function installThreeWebGpuSubmissionBatch(renderer: unknown): ThreeWebGpuSubmissionBatch | null {
  if (!object(renderer)) return null;
  const candidate = renderer.backend;
  if (!object(candidate) || candidate.isWebGPUBackend !== true || !object(candidate.device)) return null;
  const device = candidate.device;
  const previous = devices.get(device);
  if (previous) { installed.set(renderer, previous); return previous; }
  if (!object(device.queue) || typeof device.createBindGroup !== "function" ||
    typeof device.createCommandEncoder !== "function" || typeof device.queue.submit !== "function" ||
    typeof device.queue.writeBuffer !== "function") return null;
  const queue = device.queue;
  const submit = (queue.submit as GpuMethod).bind(queue);
  const writeBuffer = (queue.writeBuffer as GpuMethod).bind(queue);
  const createEncoder = (device.createCommandEncoder as GpuMethod).bind(device);
  const createBuffer = typeof device.createBuffer === "function" ? (device.createBuffer as GpuMethod).bind(device) : null;
  const uploadLimit = Math.min(MAX_UPLOAD_BYTES,
    object(device.limits) && typeof device.limits.maxBufferSize === "number" ? device.limits.maxBufferSize : MAX_UPLOAD_BYTES);
  const groups = new WeakMap<object, GroupDependencies>();
  const commands = new WeakMap<object, CommandDependencies>();
  const submitted = new WeakSet<object>();
  let pending: object[] = [], pendingBuffers = new Set<object>();
  const writes: StagedWrite[] = [];
  let writeCount = 0, uploadBytes = 0, uploadData = new Uint8Array(0), upload: GpuObject | null = null;
  const destroyUpload = () => {
    if (upload && typeof upload.destroy === "function") (upload.destroy as GpuMethod).call(upload);
    upload = null; uploadData = new Uint8Array(0);
  };
  let depth = 0, disposed = false, stageAllowed = true, stats = emptyStats();

  const flush = () => {
    if (!pending.length && !writeCount) return;
    const ready = pending;
    pending = []; pendingBuffers.clear();
    const count = writeCount, bytes = uploadBytes;
    // Retire the segment before any GPU call can throw. A failed upload must
    // never leak abandoned writes into the next frame.
    writeCount = 0; uploadBytes = 0;
    try {
      if (count) {
        if (!upload || (upload.size as number) < uploadData.length) {
          if (upload && typeof upload.destroy === "function") (upload.destroy as GpuMethod).call(upload);
          upload = createBuffer!({ label: "HEPR Three uniform upload", size: uploadData.length, usage: COPY_SRC | COPY_DST }) as GpuObject;
        }
        writeBuffer(upload, 0, uploadData, 0, bytes);
        stats.bufferWrites++; stats.stagedUploadBytes += bytes;
        const copy = createEncoder({ label: "HEPR Three uniform copies" }) as GpuObject;
        for (let index = 0; index < count; index++) {
          const write = writes[index];
          (copy.copyBufferToBuffer as GpuMethod).call(copy, upload, write.source, write.buffer, write.offset, write.size);
        }
        ready.unshift((copy.finish as GpuMethod).call(copy) as object);
        stats.commandBuffers++;
      }
      stats.submissions++;
      submit(ready);
    } finally {
      for (let index = 0; index < count; index++) writes[index].buffer = null;
    }
  };
  const resourceBarrier = () => {
    if (pending.length || writeCount) { stats.resourceWriteBarriers++; flush(); }
  };
  const views = new WeakMap<object, boolean>();
  const resourceRestores = new WeakMap<object, () => void>();
  const trackedResources = new Set<WeakRef<GpuObject>>();
  const resourceKnown = new WeakMap<object, boolean>();
  const trackResource = (resource: GpuObject): boolean => {
    if (disposed) return false;
    const existing = resourceKnown.get(resource);
    if (existing !== undefined) return existing;
    const changes: { key: string; previous?: PropertyDescriptor; method: GpuMethod }[] = [];
    const reference = new WeakRef(resource);
    const restore = () => {
      for (let index = changes.length - 1; index >= 0; index--) {
        const change = changes[index];
        if (resource[change.key] !== change.method) continue;
        if (change.previous) Object.defineProperty(resource, change.key, change.previous);
        else Reflect.deleteProperty(resource, change.key);
      }
      trackedResources.delete(reference); resourceRestores.delete(resource);
    };
    try {
      for (const key of ["destroy", "mapAsync", "unmap", "createView"]) {
        if (typeof resource[key] !== "function") continue;
        const original = (resource[key] as GpuMethod).bind(resource);
        const method: GpuMethod = (...args) => {
          if (key !== "createView") resourceBarrier();
          const result = original(...args);
          if (key === "createView" && object(result)) views.set(result, true);
          if (key === "destroy") restore();
          return result;
        };
        const previous = Object.getOwnPropertyDescriptor(resource, key);
        Object.defineProperty(resource, key, { configurable: true, writable: true, value: method });
        changes.push({ key, previous, method });
      }
    } catch { restore(); resourceKnown.set(resource, false); return false; }
    resourceKnown.set(resource, true);
    if (changes.length) { trackedResources.add(reference); resourceRestores.set(resource, restore); }
    return true;
  };
  const touch = (dependencies: CommandDependencies, value: unknown) => {
    if (object(value)) {
      dependencies.buffers.add(value);
      if (!trackResource(value)) dependencies.known = false;
    }
    else dependencies.known = false;
  };

  // Native WebGPU methods and accessors require their original receiver.
  const wrap = (target: GpuObject, intercept: (key: PropertyKey, args: unknown[], method: GpuMethod) => unknown) => {
    const methods = new Map<PropertyKey, GpuMethod>();
    return new Proxy(target, { get(real, key) {
      const value = Reflect.get(real, key, real);
      if (typeof value !== "function") return value;
      let method = methods.get(key);
      if (!method) {
        const original = (value as GpuMethod).bind(real);
        method = (...args) => intercept(key, args, original);
        methods.set(key, method);
      }
      return method;
    } });
  };

  const pass = (encoder: GpuObject, dependencies: CommandDependencies) => wrap(encoder, (key, args, method) => {
    if (key === "setBindGroup") {
      const group = args[1];
      if (group !== null && group !== undefined && (!object(group) || !dependencies.groups.has(group))) {
        const entry = object(group) && groups.get(group);
        if (entry) {
          dependencies.groups.add(group as object);
          for (const buffer of entry.buffers) dependencies.buffers.add(buffer);
          if (!entry.known) dependencies.known = false;
        }
        else dependencies.known = false;
      }
    } else if (key === "setVertexBuffer") {
      if (args[1] !== null) touch(dependencies, args[1]);
    } else if (key === "setIndexBuffer" || key === "drawIndirect" || key === "drawIndexedIndirect" ||
      key === "dispatchWorkgroupsIndirect") touch(dependencies, args[0]);
    else if (!PASS_METHODS.has(key)) dependencies.known = false;
    return method(...args);
  });

  const encoder = (real: GpuObject) => {
    const dependencies: CommandDependencies = { buffers: new Set(), groups: new Set(), known: true };
    return wrap(real, (key, args, method) => {
      if (key === "beginRenderPass" || key === "beginComputePass") {
        const descriptor = args[0];
        if (object(descriptor)) {
          if (object(descriptor.occlusionQuerySet) && !trackResource(descriptor.occlusionQuerySet)) dependencies.known = false;
          if (object(descriptor.timestampWrites) && object(descriptor.timestampWrites.querySet) &&
            !trackResource(descriptor.timestampWrites.querySet)) dependencies.known = false;
          if (descriptor.colorAttachments !== undefined && !Array.isArray(descriptor.colorAttachments)) dependencies.known = false;
          const attachments = Array.isArray(descriptor.colorAttachments) ? descriptor.colorAttachments : [];
          for (const attachment of [...attachments, descriptor.depthStencilAttachment]) {
            if (!object(attachment)) continue;
            if (object(attachment.view) && !views.has(attachment.view)) dependencies.known = false;
            if (object(attachment.resolveTarget) && !views.has(attachment.resolveTarget)) dependencies.known = false;
          }
        }
        const created = method(...args);
        if (!object(created)) { dependencies.known = false; return created; }
        return pass(created, dependencies);
      }
      if (key === "finish") {
        const command = method(...args);
        if (object(command)) commands.set(command, dependencies);
        return command;
      }
      if (key === "copyBufferToBuffer") { touch(dependencies, args[0]); touch(dependencies, args[2]); }
      else if (key === "copyBufferToTexture") {
        touch(dependencies, object(args[0]) ? args[0].buffer : undefined);
        if (object(args[1]) && object(args[1].texture) && !trackResource(args[1].texture)) dependencies.known = false;
      } else if (key === "copyTextureToBuffer") {
        touch(dependencies, object(args[1]) ? args[1].buffer : undefined);
        if (object(args[0]) && object(args[0].texture) && !trackResource(args[0].texture)) dependencies.known = false;
      } else if (key === "copyTextureToTexture") {
        for (const descriptor of args.slice(0, 2)) {
          if (object(descriptor) && object(descriptor.texture) && !trackResource(descriptor.texture)) dependencies.known = false;
        }
      }
      else if (key === "clearBuffer") touch(dependencies, args[0]);
      else if (key === "resolveQuerySet") {
        touch(dependencies, args[3]);
        if (object(args[0]) && !trackResource(args[0])) dependencies.known = false;
      } else if (key === "writeTimestamp" && object(args[0]) && !trackResource(args[0])) dependencies.known = false;
      else if (!ENCODER_METHODS.has(key)) dependencies.known = false;
      return method(...args);
    });
  };

  const queueProxy = wrap(queue, (key, args, method) => {
    if (disposed) return method(...args);
    if (key === "submit" && depth > 0 && !disposed) {
      // Three reuses and immediately clears its submission array.
      const list = Array.from(args[0] as Iterable<unknown>);
      stats.requestedSubmissions++; stats.commandBuffers += list.length;
      const inRequest = new Set<object>();
      const duplicate = list.some(command => {
        if (!object(command)) return false;
        if (submitted.has(command) || inRequest.has(command)) return true;
        inRequest.add(command); return false;
      });
      for (const command of list) if (object(command)) submitted.add(command);
      if (!duplicate && list.length && list.every(command => object(command) && commands.get(command)?.known)) {
        for (const command of list as object[]) {
          pending.push(command);
          for (const buffer of commands.get(command)!.buffers) pendingBuffers.add(buffer);
        }
        if (pending.length >= MAX_COMMAND_BUFFERS) flush();
        return;
      }
      stats.unknownBarriers++; stageAllowed = false; flush(); stats.submissions++;
      return method(list);
    }
    if (key === "writeBuffer") {
      if (depth > 0 && !disposed) stats.requestedBufferWrites++;
      if (object(args[0]) && pendingBuffers.has(args[0])) { stats.bufferWriteBarriers++; flush(); }
      const bytes = depth > 0 && !disposed && stageAllowed && createBuffer && object(args[0]) &&
        trackResource(args[0]) ? sourceBytes(args) : null;
      if (bytes && bytes.length <= uploadLimit) {
        if (uploadBytes + bytes.length > uploadLimit) flush();
        const needed = uploadBytes + bytes.length;
        if (needed > uploadData.length) {
          let capacity = Math.min(4096, uploadLimit);
          while (capacity < needed) capacity = Math.min(capacity * 2, uploadLimit);
          const expanded = new Uint8Array(capacity); expanded.set(uploadData); uploadData = expanded;
        }
        // Snapshot now, before Three reuses its CPU uniform buffer.
        uploadData.set(bytes, uploadBytes);
        let write = writes[writeCount];
        if (!write) writes[writeCount] = write = { buffer: args[0] as object, offset: 0, source: 0, size: 0 };
        write.buffer = args[0] as object; write.offset = args[1] as number; write.source = uploadBytes; write.size = bytes.length;
        writeCount++;
        uploadBytes += bytes.length;
        if (writeCount >= 4096) flush();
        return;
      }
      if (depth > 0 && !disposed) {
        if ((createBuffer && stageAllowed) || writeCount) resourceBarrier();
        stats.bufferWrites++;
      }
    } else resourceBarrier();
    return method(...args);
  });

  const proxyMethods = wrap(device, (key, args, method) => {
    if (disposed) return method(...args);
    if (key === "createBindGroup") {
      const group = method(...args), buffers = new Set<object>();
      const entries = object(args[0]) && args[0].entries;
      if (object(group) && Array.isArray(entries)) {
        let known = true;
        for (const entry of entries) {
          if (!object(entry) || !object(entry.resource)) { known = false; continue; }
          const resource = entry.resource;
          if (object(resource.buffer)) {
            buffers.add(resource.buffer);
            if (!trackResource(resource.buffer)) known = false;
          } else if (!views.has(resource) && Object.prototype.toString.call(resource) !== "[object GPUSampler]") known = false;
        }
        groups.set(group, { buffers, known });
      }
      return group;
    }
    if (key === "createBuffer" || key === "createTexture" || key === "createQuerySet") {
      const resource = method(...args);
      if (object(resource)) trackResource(resource);
      return resource;
    }
    if (key === "createCommandEncoder") {
      const created = method(...args);
      return depth > 0 && !disposed && object(created) ? encoder(created) : created;
    }
    if (key === "pushErrorScope" || key === "popErrorScope" || key === "destroy") resourceBarrier();
    if (key === "destroy") destroyUpload();
    return method(...args);
  });
  // Keep GPUDevice identity intact: canvas.configure() and XRGPUBinding take
  // a native device and reject a Proxy during WebIDL interface conversion.
  // Instance methods are reversible; a non-extensible host uses normal Three.
  const patches: { target: GpuObject; key: string; previous?: PropertyDescriptor; method: unknown }[] = [];
  const restore = () => {
    for (let index = patches.length - 1; index >= 0; index--) {
      const patch = patches[index];
      if (patch.target[patch.key] !== patch.method) continue;
      if (patch.previous) Object.defineProperty(patch.target, patch.key, patch.previous);
      else Reflect.deleteProperty(patch.target, patch.key);
    }
  };
  try {
    for (const [target, wrapped, keys] of [
      [queue, queueProxy, ["submit", "writeBuffer", "writeTexture", "copyExternalImageToTexture", "onSubmittedWorkDone"]],
      [device, proxyMethods, ["createBindGroup", "createCommandEncoder", "createBuffer", "createTexture", "createQuerySet",
        "pushErrorScope", "popErrorScope", "destroy"]]
    ] as const) {
      for (const key of keys) {
        if (typeof target[key] !== "function") continue;
        const previous = Object.getOwnPropertyDescriptor(target, key), method = wrapped[key];
        Object.defineProperty(target, key, { configurable: true, writable: true, value: method });
        patches.push({ target, key, previous, method });
      }
    }
  } catch { restore(); return null; }

  const owner = new WeakRef(renderer);
  const batch: ThreeWebGpuSubmissionBatch = {
    run<T>(work: () => T): T {
      if (disposed) return work();
      if (depth++ === 0) { stats = emptyStats(); stageAllowed = true; }
      try { return work(); } finally { if (--depth === 0) flush(); }
    },
    get stats() { return stats; },
    dispose() {
      if (disposed) return;
      flush(); disposed = true;
      destroyUpload();
      for (const reference of trackedResources) {
        const resource = reference.deref();
        if (resource) resourceRestores.get(resource)?.();
      }
      trackedResources.clear();
      restore();
      devices.delete(device);
      const renderer = owner.deref();
      if (renderer) installed.delete(renderer);
    }
  };
  installed.set(renderer, batch);
  devices.set(device, batch);
  return batch;
}

/** Also supports hosts that installed the adapter after constructing Three. */
export function getThreeWebGpuSubmissionBatch(renderer: unknown): ThreeWebGpuSubmissionBatch | null {
  return installThreeWebGpuSubmissionBatch(renderer);
}
