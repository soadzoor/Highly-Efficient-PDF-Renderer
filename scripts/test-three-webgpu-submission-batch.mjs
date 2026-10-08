import assert from "node:assert/strict";
import { installThreeWebGpuSubmissionBatch, getThreeWebGpuSubmissionBatch } from "../src/threeWebGpuSubmissionBatch.ts";

for (const renderer of [null, {}, { backend: {} }, { backend: { isWebGPUBackend: false } },
  { backend: { isWebGPUBackend: true, device: { queue: {} } } }]) {
  assert.equal(installThreeWebGpuSubmissionBatch(renderer), null);
}
{
  const { host, device } = fixture();
  Object.freeze(device);
  const originalSubmit = device.queue.submit;
  assert.equal(installThreeWebGpuSubmissionBatch(host), null, "a host with fixed native methods safely keeps normal submission");
  assert.equal(device.queue.submit, originalSubmit, "partial installation restores earlier method changes");
}

// The mock queue executes real command buffers at submission time, reading the
// buffer's current contents. Blindly deferring submit would turn [1, 2] into
// [2, 2] here, reproducing overwritten uniforms between compositor passes.
{
  const { host, device, outputs, submissions } = fixture();
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  assert.equal(gpu, device, "canvas.configure and XR bindings receive the original native GPUDevice");
  assert.equal(getThreeWebGpuSubmissionBatch(host), batch);
  assert.equal(installThreeWebGpuSubmissionBatch(host), batch, "installation is idempotent");
  assert.equal(gpu.limits.maxBufferSize, 1024, "native device accessors retain their original receiver");
  assert.equal(gpu.queue.label, "queue", "native queue accessors retain their original receiver");
  const a = { value: 1 }, b = { value: 2 };
  const first = gpu.createBindGroup({ entries: [{ resource: { buffer: a } }] });
  const second = gpu.createBindGroup({ entries: [{ resource: { buffer: b } }] });
  batch.run(() => {
    gpu.queue.writeBuffer(a, 0, new Uint32Array([1]));
    submitPaint(gpu, first);
    gpu.queue.writeBuffer(b, 0, new Uint32Array([2]));
    submitPaint(gpu, second);
    assert.equal(submissions.length, 0, "independent passes stay queued until the scope completes");
  });
  assert.deepEqual(outputs, [1, 2]);
  assert.equal(submissions.length, 1); assert.equal(submissions[0].length, 2);
  assert.deepEqual(batch.stats, { requestedSubmissions: 2, submissions: 1, commandBuffers: 2,
    bufferWriteBarriers: 0, resourceWriteBarriers: 0, unknownBarriers: 0,
    requestedBufferWrites: 2, bufferWrites: 2, stagedUploadBytes: 0 });
  batch.dispose(); assert.equal(host.backend.device, device, "disposing restores the original host device");
  assert.equal(device.destroyed, false, "the adapter does not own GPU resources");
  batch.run(() => submitPaint(device, first));
  assert.equal(submissions.length, 2, "a disposed controller runs work normally");
}
{
  const { host, outputs, submissions } = fixture();
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  const buffer = { value: 0 }, group = gpu.createBindGroup({ entries: [{ resource: { buffer } }] });
  batch.run(() => {
    gpu.queue.writeBuffer(buffer, 0, new Uint32Array([1])); submitPaint(gpu, group);
    gpu.queue.writeBuffer(buffer, 0, new Uint32Array([2]));
    assert.deepEqual(outputs, [1], "a conflicting write submits the earlier uniform value first");
    submitPaint(gpu, group);
  });
  assert.deepEqual(outputs, [1, 2]); assert.equal(submissions.length, 2);
  assert.equal(batch.stats.bufferWriteBarriers, 1);
}

// Every standard buffer access used by render/compute/copy work establishes
// the same ordering barrier, including GPU writes followed by CPU writes.
for (const encode of [
  (encoder, buffer) => { const pass = encoder.beginRenderPass({}); pass.setVertexBuffer(0, buffer); pass.draw(); pass.end(); },
  (encoder, buffer) => { const pass = encoder.beginRenderPass({}); pass.setIndexBuffer(buffer); pass.drawIndexed(); pass.end(); },
  (encoder, buffer) => { const pass = encoder.beginRenderPass({}); pass.drawIndirect(buffer); pass.end(); },
  (encoder, buffer) => { const pass = encoder.beginRenderPass({}); pass.drawIndexedIndirect(buffer); pass.end(); },
  (encoder, buffer) => { const pass = encoder.beginComputePass({}); pass.dispatchWorkgroupsIndirect(buffer); pass.end(); },
  (encoder, buffer) => encoder.copyBufferToBuffer(buffer, 0, { value: 0 }, 0, 4),
  (encoder, buffer) => encoder.copyBufferToBuffer({ value: 7 }, 0, buffer, 0, 4),
  (encoder, buffer) => encoder.copyBufferToTexture({ buffer }, { texture: {} }, {}),
  (encoder, buffer) => encoder.copyTextureToBuffer({ texture: { value: 7 } }, { buffer }, {}),
  (encoder, buffer) => encoder.clearBuffer(buffer),
  (encoder, buffer) => encoder.resolveQuerySet({}, 0, 1, buffer, 0)
]) {
  const { host, submissions } = fixture();
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device, buffer = { value: 1 };
  batch.run(() => {
    const encoder = gpu.createCommandEncoder(); encode(encoder, buffer); gpu.queue.submit([encoder.finish()]);
    gpu.queue.writeBuffer(buffer, 0, new Uint32Array([2]));
    assert.equal(submissions.length, 1, "CPU buffer writes follow all earlier GPU buffer accesses");
    assert.equal(buffer.value, 2);
  });
  assert.equal(batch.stats.bufferWriteBarriers, 1);
}
for (const change of [
  gpu => gpu.queue.writeTexture({}, new Uint32Array([3]), {}, {}),
  gpu => gpu.queue.copyExternalImageToTexture({}, {}, {}),
  gpu => gpu.queue.onSubmittedWorkDone(),
  gpu => gpu.pushErrorScope("validation"),
  gpu => gpu.popErrorScope()
]) {
  const { host, submissions } = fixture();
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  const group = gpu.createBindGroup({ entries: [] });
  batch.run(() => { submitPaint(gpu, group); change(gpu); assert.equal(submissions.length, 1); });
  assert.equal(batch.stats.resourceWriteBarriers, 1, "resource updates and async completion preserve queue boundaries");
}
for (const unsupported of ["oldGroup", "oldCommand", "bundle", "newEncoderMethod", "missingEntries"]) {
  const { host, device, outputs, submissions } = fixture();
  const oldBuffer = { value: 1 }, oldGroup = device.createBindGroup({ entries: [{ resource: { buffer: oldBuffer } }] });
  const oldEncoder = device.createCommandEncoder();
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  batch.run(() => {
    if (unsupported === "oldGroup") submitPaint(gpu, oldGroup);
    else if (unsupported === "missingEntries") submitPaint(gpu, gpu.createBindGroup({}));
    else {
      const encoder = unsupported === "oldCommand" ? oldEncoder : gpu.createCommandEncoder();
      if (unsupported === "bundle") { const pass = encoder.beginRenderPass({}); pass.executeBundles([]); pass.end(); }
      if (unsupported === "newEncoderMethod") encoder.futureBufferOperation(oldBuffer);
      gpu.queue.submit([encoder.finish()]);
    }
    assert.equal(submissions.length, 1, `${unsupported}: unknown dependencies submit immediately`);
    gpu.queue.writeBuffer(oldBuffer, 0, new Uint32Array([2]));
  });
  if (unsupported === "oldGroup") assert.deepEqual(outputs, [1]);
  assert.equal(batch.stats.unknownBarriers, 1);
}
{
  const { host, outputs, submissions } = fixture();
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  const group = gpu.createBindGroup({ entries: [{ resource: { buffer: { value: 3 } } }] });
  submitPaint(gpu, group);
  assert.equal(submissions.length, 1, "outside a batch GPU commands use normal Three submission");
  batch.run(() => {
    submitPaint(gpu, group); batch.run(() => submitPaint(gpu, group));
    assert.equal(submissions.length, 1, "nested batches retain the outer submission boundary");
  });
  assert.equal(submissions.length, 2); assert.equal(submissions[1].length, 2);
  assert.throws(() => batch.run(() => { submitPaint(gpu, group); throw new Error("failed paint"); }), /failed paint/);
  assert.equal(submissions.length, 3, "completed earlier passes still submit when a later paint fails");
  batch.run(() => submitPaint(gpu, group));
  assert.equal(batch.stats.submissions, 1, "the next frame recovers with fresh statistics");
  assert.deepEqual(outputs, [3, 3, 3, 3, 3]);
  batch.run(() => { for (let i = 0; i < 257; i++) submitPaint(gpu, group); });
  assert.equal(batch.stats.submissions, 2, "large batches retain a bounded number of command buffers");
}
{
  const { host, outputs, submissions } = fixture({ staging: true });
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  const a = gpu.createBuffer({ size: 16, usage: 8 }), b = gpu.createBuffer({ size: 16, usage: 8 });
  const first = gpu.createBindGroup({ entries: [{ resource: { buffer: a } }] });
  const second = gpu.createBindGroup({ entries: [{ resource: { buffer: b } }] });
  const source = new Uint32Array([1]);
  batch.run(() => {
    gpu.queue.writeBuffer(a, 0, source); source[0] = 99; submitPaint(gpu, first);
    gpu.queue.writeBuffer(b, 0, new Uint32Array([2])); submitPaint(gpu, second);
    assert.equal(submissions.length, 0);
  });
  assert.deepEqual(outputs, [1, 2], "upload staging snapshots CPU data before Three reuses it");
  assert.equal(submissions.length, 1); assert.equal(submissions[0].length, 3, "one copy command precedes both draws");
  assert.equal(batch.stats.requestedBufferWrites, 2); assert.equal(batch.stats.bufferWrites, 1);
  assert.equal(batch.stats.stagedUploadBytes, 8);
  outputs.length = 0;
  batch.run(() => {
    gpu.queue.writeBuffer(a, 0, new Uint32Array([3])); submitPaint(gpu, first);
    gpu.queue.writeBuffer(a, 0, new Uint32Array([4])); submitPaint(gpu, first);
  });
  assert.deepEqual(outputs, [3, 4], "staged copies retain distinct values across a shared uniform buffer");
  assert.equal(batch.stats.bufferWrites, 2); assert.equal(batch.stats.bufferWriteBarriers, 1);
  batch.run(() => gpu.queue.writeBuffer(a, 0, new Uint32Array([7])));
  assert.equal(a.value, 7, "an upload-only scope still submits its copies");
  assert.equal(batch.stats.requestedSubmissions, 0); assert.equal(batch.stats.submissions, 1);
}
{
  const { host } = fixture({ staging: true });
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  const a = gpu.createBuffer({ size: 16, usage: 8 }), b = gpu.createBuffer({ size: 16, usage: 8 });
  const c = gpu.createBuffer({ size: 16, usage: 8 });
  const floats = new Float32Array([1.5, 2.5, 3.5, 4.5]);
  Object.defineProperty(floats, "BYTES_PER_ELEMENT", { value: 8 });
  const storage = Uint8Array.from({ length: 20 }, (_, i) => i).buffer, view = new DataView(storage, 4, 12);
  Object.defineProperty(view, "BYTES_PER_ELEMENT", { value: 8 });
  batch.run(() => {
    gpu.queue.writeBuffer(a, 4, floats, 1, 2);
    gpu.queue.writeBuffer(b, 0, view, 4, 4);
    gpu.queue.writeBuffer(c, 4, storage, 4, 4);
    floats.fill(0); new Uint8Array(storage).fill(255);
  });
  assert.deepEqual(Array.from(new Float32Array(a.data.buffer)), [0, 2.5, 3.5, 0], "TypedArray offsets use intrinsic element sizes");
  assert.deepEqual(Array.from(b.data.slice(0, 4)), [8, 9, 10, 11], "DataView offsets are bytes relative to its own view");
  assert.deepEqual(Array.from(c.data.slice(4, 8)), [4, 5, 6, 7], "ArrayBuffer offsets are bytes");
  assert.equal(batch.stats.bufferWrites, 1); assert.equal(batch.stats.stagedUploadBytes, 16);
  for (const invalid of [
    () => gpu.queue.writeBuffer(a, 2, new Uint32Array([9])),
    () => gpu.queue.writeBuffer(a, 0, new Uint16Array([9])),
    () => gpu.queue.writeBuffer(a, 0, new Uint32Array([9]), 2),
    () => gpu.queue.writeBuffer(a, 16, new Uint32Array([9]))
  ]) {
    assert.throws(() => batch.run(() => { gpu.queue.writeBuffer(a, 0, new Uint32Array([8])); invalid(); }),
      /invalid native writeBuffer/, "invalid calls retain native errors");
    assert.equal(a.value, 8, "earlier valid uploads precede a later invalid write");
  }
}
for (const lifecycle of ["destroy", "mapAsync", "unmap"]) {
  const { host, outputs } = fixture({ staging: true });
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  const buffer = gpu.createBuffer({ size: 16, usage: 8 });
  const group = gpu.createBindGroup({ entries: [{ resource: { buffer } }] });
  batch.run(() => {
    gpu.queue.writeBuffer(buffer, 0, new Uint32Array([5])); submitPaint(gpu, group);
    buffer[lifecycle]();
    assert.deepEqual(outputs, [5], `${lifecycle} follows queued GPU access to the buffer`);
  });
  assert.equal(batch.stats.resourceWriteBarriers, 1);
}
for (const kind of ["texture", "query"]) {
  const { host, submissions } = fixture();
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  const resource = kind === "texture" ? gpu.createTexture({}) : gpu.createQuerySet({});
  batch.run(() => {
    const encoder = gpu.createCommandEncoder();
    const descriptor = kind === "texture" ? { colorAttachments: [{ view: resource.createView() }] } : { occlusionQuerySet: resource };
    const pass = encoder.beginRenderPass(descriptor); pass.end(); gpu.queue.submit([encoder.finish()]);
    resource.destroy(); assert.equal(submissions.length, 1, `${kind} destruction submits earlier passes first`);
  });
  assert.equal(batch.stats.unknownBarriers, 0); assert.equal(batch.stats.resourceWriteBarriers, 1);
}
{
  const { host, device, outputs, submissions } = fixture({ staging: true });
  const buffer = device.createBuffer({ size: 16, usage: 8 });
  const oldGroup = device.createBindGroup({ entries: [{ resource: { buffer } }] });
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  batch.run(() => {
    for (let i = 1; i <= 3; i++) { gpu.queue.writeBuffer(buffer, 0, new Uint32Array([i])); submitPaint(gpu, oldGroup); }
  });
  assert.deepEqual(outputs, [1, 2, 3]);
  assert.equal(submissions.length, 4, "unknown bindings disable staging after one fallback instead of doubling every submit");
}
{
  const { host, device, outputs, submissions } = fixture();
  const oldEncoder = device.createCommandEncoder(), batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  batch.run(() => gpu.queue.submit((function* () { yield oldEncoder.finish(); })()));
  assert.equal(submissions[0].length, 1, "unknown submission iterators reach the native queue once");
  const buffer = { value: 6 };
  const group = gpu.createBindGroup({ entries: (function* () { yield { resource: { buffer } }; })() });
  batch.run(() => { submitPaint(gpu, group); gpu.queue.writeBuffer(buffer, 0, new Uint32Array([7])); });
  assert.deepEqual(outputs, [6], "one-shot bind group entries never appear to be known empty bindings");
  const known = gpu.createBindGroup({ entries: [{ resource: { buffer } }] });
  assert.throws(() => batch.run(() => {
    const encoder = gpu.createCommandEncoder(), pass = encoder.beginRenderPass({});
    pass.setBindGroup(0, known); pass.draw(); pass.end(); const command = encoder.finish();
    gpu.queue.submit([command]); gpu.queue.submit([command]);
  }), /already submitted/);
  assert.deepEqual(outputs, [6, 7], "duplicate command errors retain the first valid submission");
  assert.throws(() => batch.run(() => {
    submitPaint(gpu, known);
    const command = gpu.createCommandEncoder().finish(); gpu.queue.submit([command, command]);
  }), /already submitted/);
  assert.deepEqual(outputs, [6, 7, 7], "duplicates inside one request cannot invalidate an earlier valid request");
}
{
  const { host, device, outputs } = fixture({ staging: true });
  const originalCreate = device.createCommandEncoder;
  let failUpload = true;
  device.createCommandEncoder = function(descriptor) {
    if (descriptor?.label === "HEPR Three uniform copies" && failUpload) throw new Error("failed upload encoder");
    return originalCreate.call(device, descriptor);
  };
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  const buffer = gpu.createBuffer({ size: 16, usage: 8 });
  const group = gpu.createBindGroup({ entries: [{ resource: { buffer } }] });
  assert.throws(() => batch.run(() => { gpu.queue.writeBuffer(buffer, 0, new Uint32Array([1])); submitPaint(gpu, group); }),
    /failed upload encoder/);
  failUpload = false;
  batch.run(() => { gpu.queue.writeBuffer(buffer, 0, new Uint32Array([2])); submitPaint(gpu, group); });
  assert.deepEqual(outputs, [2], "a failed segment does not replay abandoned writes or draws on the next frame");
  const destroy = buffer.destroy;
  batch.dispose(); batch.dispose();
  assert.notEqual(buffer.destroy, destroy, "disposal restores resource lifecycle methods");
  assert.equal(buffer.destroyed, undefined, "disposal preserves borrowed buffers");
}
{
  const { host, device, submissions } = fixture();
  const oldTexture = device.createTexture({}), oldView = oldTexture.createView(), oldQuery = device.createQuerySet({});
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  batch.run(() => {
    const encoder = gpu.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: oldView }] });
    pass.end(); gpu.queue.submit([encoder.finish()]);
    assert.equal(submissions.length, 1, "old attachment views preserve normal submission");
  });
  assert.equal(batch.stats.unknownBarriers, 1);
  batch.run(() => {
    const view = gpu.createTexture({}).createView();
    const encoder = gpu.createCommandEncoder(), pass = encoder.beginRenderPass({
      colorAttachments: (function* () { yield { view }; })()
    });
    pass.end(); gpu.queue.submit([encoder.finish()]);
  });
  assert.equal(batch.stats.unknownBarriers, 1, "one-shot attachment descriptors preserve normal submission");
  for (const encode of [
    encoder => encoder.copyTextureToTexture({ texture: oldTexture }, { texture: gpu.createTexture({}) }, {}),
    encoder => encoder.writeTimestamp(oldQuery, 0),
    encoder => encoder.resolveQuerySet(oldQuery, 0, 1, { value: 0 }, 0)
  ]) {
    batch.run(() => {
      const encoder = gpu.createCommandEncoder(); encode(encoder); gpu.queue.submit([encoder.finish()]);
      const before = submissions.length;
      // Both preexisting resources are tracked when a copy/query command uses them.
      gpu.pushErrorScope("validation"); assert.equal(submissions.length, before + 1);
    });
    assert.equal(batch.stats.unknownBarriers, 0);
  }
  batch.run(() => {
    const encoder = gpu.createCommandEncoder(); encoder.copyTextureToTexture({ texture: oldTexture }, { texture: gpu.createTexture({}) }, {});
    gpu.queue.submit([encoder.finish()]); oldTexture.destroy();
  });
  assert.equal(batch.stats.resourceWriteBarriers, 1, "copy commands track old texture destruction");
  batch.run(() => {
    const encoder = gpu.createCommandEncoder(); encoder.writeTimestamp(oldQuery, 0);
    gpu.queue.submit([encoder.finish()]); oldQuery.destroy();
  });
  assert.equal(batch.stats.resourceWriteBarriers, 1, "query commands track old query-set destruction");
}
{
  const { host, outputs } = fixture({ staging: true });
  const batch = installThreeWebGpuSubmissionBatch(host), gpu = host.backend.device;
  batch.run(() => {
    for (let i = 1; i <= 17; i++) {
      const buffer = gpu.createBuffer({ size: 64, usage: 8 });
      const group = gpu.createBindGroup({ entries: [{ resource: { buffer } }] });
      const data = new Uint32Array(16); data[0] = i;
      gpu.queue.writeBuffer(buffer, 0, data); submitPaint(gpu, group);
    }
  });
  assert.deepEqual(outputs, Array.from({ length: 17 }, (_, i) => i + 1), "upload limits preserve every draw's value");
  assert.equal(batch.stats.bufferWrites, 2, "the upload arena obeys the device's 1024-byte buffer limit");
  const buffer = gpu.createBuffer({ size: 16, usage: 8 });
  batch.run(() => { gpu.queue.writeBuffer(buffer, 0, new Uint32Array([5])); buffer.destroy(); });
  assert.equal(buffer.value, 5, "buffer destruction flushes upload-only work");
  const otherHost = { backend: { isWebGPUBackend: true, device: gpu } };
  assert.equal(installThreeWebGpuSubmissionBatch(otherHost), batch, "hosts sharing a device share one ordering controller");
  batch.dispose();
  assert.notEqual(installThreeWebGpuSubmissionBatch(otherHost), batch, "disposing a shared controller permits fresh installation");
}
console.log("Three WebGPU submissions: staging, snapshots, queue ordering, native lifecycle and safe fallbacks passed");

function submitPaint(gpu, group) {
  const encoder = gpu.createCommandEncoder(), pass = encoder.beginRenderPass({});
  pass.setBindGroup(0, group); pass.draw(); pass.end();
  const list = [encoder.finish()]; gpu.queue.submit(list); list[0] = null;
}

function fixture({ staging = false } = {}) {
  const outputs = [], submissions = [];
  const used = new WeakSet();
  const queue = {
    submit(commands) {
      assert.equal(this, queue); const list = Array.from(commands);
      const requested = new Set();
      for (const command of list) {
        if (used.has(command) || requested.has(command)) throw new Error("command already submitted");
        requested.add(command);
      }
      submissions.push(list);
      for (const command of list) { used.add(command); for (const operation of command.operations) operation(); }
    },
    writeBuffer(buffer, offset, data, dataOffset = 0, size) {
      assert.equal(this, queue);
      if (!buffer.data) { buffer.value = data[0]; return; }
      const factor = ArrayBuffer.isView(data) && !(data instanceof DataView) ? data.BYTES_PER_ELEMENT : 1;
      const storage = ArrayBuffer.isView(data) ? data.buffer : data;
      const start = ArrayBuffer.isView(data) ? data.byteOffset : 0;
      const length = ArrayBuffer.isView(data) ? data.byteLength : data.byteLength;
      const bytes = (size ?? length / factor - dataOffset) * factor;
      if (offset % 4 || bytes < 0 || bytes % 4 || dataOffset < 0 || dataOffset * factor + bytes > length || offset + bytes > buffer.size ||
        (buffer.usage & 8) === 0 || buffer.mapState !== "unmapped") throw new Error("invalid native writeBuffer");
      buffer.data.set(new Uint8Array(storage, start + dataOffset * factor, bytes), offset);
      buffer.value = new DataView(buffer.data.buffer).getUint32(0, true);
    },
    writeTexture() { assert.equal(this, queue); },
    copyExternalImageToTexture() { assert.equal(this, queue); },
    onSubmittedWorkDone() { assert.equal(this, queue); return Promise.resolve(); }
  };
  Object.defineProperty(queue, "label", { get() { assert.equal(this, queue); return "queue"; } });
  const device = {
    queue, destroyed: false,
    createBindGroup(descriptor) { assert.equal(this, device); return { entries: Array.from(descriptor.entries ?? []) }; },
    createTexture() {
      assert.equal(this, device);
      const texture = { destroy() { assert.equal(this, texture); this.destroyed = true; },
        createView() { assert.equal(this, texture); return { texture, [Symbol.toStringTag]: "GPUTextureView" }; } };
      return texture;
    },
    createQuerySet() {
      assert.equal(this, device);
      const query = { destroy() { assert.equal(this, query); this.destroyed = true; } };
      return query;
    },
    createCommandEncoder() {
      assert.equal(this, device); const operations = [];
      const encoder = {
        beginRenderPass(descriptor) {
          assert.equal(this, encoder);
          const resources = Array.from(descriptor.colorAttachments ?? []).map(attachment => attachment.view.texture);
          if (descriptor.occlusionQuerySet) resources.push(descriptor.occlusionQuerySet);
          operations.push(() => { for (const resource of resources) assert.notEqual(resource.destroyed, true); });
          return createPass();
        },
        beginComputePass() { assert.equal(this, encoder); return createPass(); },
        copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
          assert.equal(this, encoder);
          operations.push(() => {
            assert.equal(source.destroyed, undefined); assert.equal(destination.destroyed, undefined);
            if (source.data && destination.data) {
              destination.data.set(source.data.subarray(sourceOffset, sourceOffset + size), destinationOffset);
              destination.value = new DataView(destination.data.buffer).getUint32(0, true);
            } else destination.value = source.value;
          });
        },
        copyBufferToTexture(source, destination) { assert.equal(this, encoder); operations.push(() => { destination.texture.value = source.buffer.value; }); },
        copyTextureToBuffer(source, destination) { assert.equal(this, encoder); operations.push(() => { destination.buffer.value = source.texture.value; }); },
        copyTextureToTexture(source, destination) {
          assert.equal(this, encoder); operations.push(() => {
            assert.notEqual(source.texture.destroyed, true); assert.notEqual(destination.texture.destroyed, true);
            destination.texture.value = source.texture.value;
          });
        },
        clearBuffer(buffer) { assert.equal(this, encoder); operations.push(() => { buffer.value = 0; }); },
        resolveQuerySet(set, _start, _count, buffer) {
          assert.equal(this, encoder); operations.push(() => { assert.notEqual(set.destroyed, true); buffer.value = 7; });
        },
        writeTimestamp(set) { assert.equal(this, encoder); operations.push(() => { assert.notEqual(set.destroyed, true); }); },
        futureBufferOperation() { assert.equal(this, encoder); },
        finish() { assert.equal(this, encoder); return { operations }; }
      };
      function createPass() {
        let buffers = [];
        const pass = {
          setBindGroup(_slot, group) { assert.equal(this, pass); buffers = group.entries.flatMap(entry => entry.resource?.buffer ? [entry.resource.buffer] : []); },
          setVertexBuffer(_slot, buffer) { assert.equal(this, pass); buffers.push(buffer); },
          setIndexBuffer(buffer) { assert.equal(this, pass); buffers.push(buffer); },
          draw() { assert.equal(this, pass); const sources = [...buffers]; operations.push(() => {
            for (const buffer of sources) { assert.notEqual(buffer.destroyed, true); outputs.push(buffer.value); }
          }); },
          drawIndexed() { assert.equal(this, pass); pass.draw(); },
          drawIndirect(buffer) { assert.equal(this, pass); buffers.push(buffer); pass.draw(); },
          drawIndexedIndirect(buffer) { assert.equal(this, pass); buffers.push(buffer); pass.draw(); },
          dispatchWorkgroupsIndirect(buffer) { assert.equal(this, pass); buffers.push(buffer); pass.draw(); },
          executeBundles() { assert.equal(this, pass); },
          end() { assert.equal(this, pass); }
        };
        return pass;
      }
      return encoder;
    },
    pushErrorScope() { assert.equal(this, device); },
    popErrorScope() { assert.equal(this, device); return Promise.resolve(null); },
    destroy() { assert.equal(this, device); this.destroyed = true; }
  };
  Object.defineProperty(device, "limits", { get() { assert.equal(this, device); return { maxBufferSize: 1024 }; } });
  if (staging) device.createBuffer = function(descriptor) {
    assert.equal(this, device);
    const buffer = { size: descriptor.size, usage: descriptor.usage, mapState: "unmapped",
      data: new Uint8Array(descriptor.size), value: 0,
      destroy() { assert.equal(this, buffer); this.destroyed = true; },
      mapAsync() { assert.equal(this, buffer); this.mapState = "mapped"; return Promise.resolve(); },
      unmap() { assert.equal(this, buffer); this.mapState = "unmapped"; }
    };
    return buffer;
  };
  const host = { backend: { isWebGPUBackend: true, device } };
  return { host, device, outputs, submissions };
}
