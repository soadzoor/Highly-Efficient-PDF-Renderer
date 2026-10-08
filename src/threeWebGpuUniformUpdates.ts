type GpuObject = object & Record<PropertyKey, unknown>;
type GpuMethod = (...args: unknown[]) => unknown;
const UNIFORM_COPY_DST = 0x0040 | 0x0008;
const MAX_UNIFORM_BYTES = 64 * 1024;
const object = (value: unknown): value is GpuObject =>
  value !== null && (typeof value === "object" || typeof value === "function");

/**
 * Three's uniform groups retain every field in their CPU buffer. During a
 * compositor batch, upload that buffer once instead of encoding a copy for
 * every small changed range. The submission adapter snapshots the bytes and
 * retains its normal barriers when an earlier draw uses the same GPU buffer.
 * Storage buffers and unfamiliar layouts keep Three's normal update path.
 */
export function installThreeWebGpuUniformUpdates(backend: unknown, active: () => boolean): (() => void) | null {
  if (!object(backend) || backend.isWebGPUBackend !== true || typeof backend.updateBinding !== "function" ||
    typeof backend.get !== "function") return null;
  const owner = new WeakRef(backend), original = backend.updateBinding as GpuMethod;
  const previous = Object.getOwnPropertyDescriptor(backend, "updateBinding");
  const method = function(this: GpuObject, binding: unknown): unknown {
    if (this === owner.deref() && active() && arguments.length === 1 && object(binding) &&
      binding.isUniformBuffer === true && binding.isStorageBuffer !== true &&
      binding.buffer instanceof Float32Array && Array.isArray(binding.updateRanges) &&
      binding.updateRanges.length > 1) {
      const array = binding.buffer, ranges = binding.updateRanges;
      const data = (this.get as GpuMethod).call(this, binding), device = this.device;
      const buffer = object(data) ? data.buffer : null;
      // UniformsGroup.byteLength recalculates the field layout. The already
      // allocated CPU/GPU buffers supply the size needed for this upload.
      if (object(buffer) && buffer.usage === UNIFORM_COPY_DST && buffer.mapState === "unmapped" &&
        buffer.size === array.byteLength &&
        array.byteLength > 0 && array.byteLength <= MAX_UNIFORM_BYTES &&
        object(device) && object(device.queue) && typeof device.queue.writeBuffer === "function") {
        let end = 0, valid = true;
        for (const range of ranges) {
          if (!object(range) || typeof range.start !== "number" || !Number.isSafeInteger(range.start) ||
            typeof range.count !== "number" || !Number.isSafeInteger(range.count) ||
            range.start < end || range.count <= 0 || range.start + range.count > array.length) {
            valid = false; break;
          }
          end = range.start + range.count;
        }
        if (valid) return (device.queue.writeBuffer as GpuMethod).call(device.queue, buffer, 0, array, 0);
      }
    }
    return arguments.length === 1 ? original.call(this, binding) : Reflect.apply(original, this, arguments);
  };
  try { Object.defineProperty(backend, "updateBinding", { configurable: true, writable: true, value: method }); }
  catch { return null; }
  return () => {
    const backend = owner.deref();
    if (!backend || backend.updateBinding !== method) return;
    if (previous) Object.defineProperty(backend, "updateBinding", previous);
    else Reflect.deleteProperty(backend, "updateBinding");
  };
}
