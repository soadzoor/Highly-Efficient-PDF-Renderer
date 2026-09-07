import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const {
  createRemoteRangePdfSource,
  servePdfRangeSource
} = await import("../src/pdf/rangeTransport.ts");

const [hostEndpoint, workerEndpoint] = linkedEndpoints();
const input = Uint8Array.from({ length: 200 }, (_, index) => index);
let closeCount = 0;
let hostReadAborted = false;
const host = servePdfRangeSource({
  kind: "range",
  byteLength: input.length,
  async read(offset, length, signal) {
    signal.throwIfAborted();
    if (offset === 100) {
      await new Promise((resolve, reject) => {
        const abort = () => {
          hostReadAborted = true;
          reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    return input.slice(offset, offset + length);
  },
  close() {
    closeCount += 1;
  }
}, hostEndpoint);
const remote = createRemoteRangePdfSource(input.length, workerEndpoint, "fixture.pdf");

assert.deepEqual(await remote.read(23, 71, new AbortController().signal), input.slice(23, 94));
assert.deepEqual(await remote.read(0, 0, new AbortController().signal), new Uint8Array());
await assert.rejects(
  remote.read(190, 11, new AbortController().signal),
  RangeError
);

const cancellation = new AbortController();
const reason = new Error("cancel remote range read");
const pendingCancelledRead = remote.read(100, 10, cancellation.signal);
await Promise.resolve();
await Promise.resolve();
cancellation.abort(reason);
await assert.rejects(pendingCancelledRead, (error) => error === reason);
await Promise.resolve();
await Promise.resolve();
assert.equal(hostReadAborted, true, "worker cancellation must abort the matching host callback");
assert.equal(
  workerEndpoint.received.some((message) =>
    message.type === "pdf-range-result" && message.requestId === 2
  ),
  false,
  "an aborted host callback must not emit a late terminal result"
);

await remote.close();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(closeCount, 1);
await host.close();
assert.equal(closeCount, 1);

await testUnexpectedHostByteCounts(servePdfRangeSource, createRemoteRangePdfSource);
await testRemoteEndpointFailures(createRemoteRangePdfSource);
await testHostCloseFailure(servePdfRangeSource, createRemoteRangePdfSource);

console.log("PDF worker range transport tests passed.");
hooks.deregister();

function linkedEndpoints() {
  const left = endpoint();
  const right = endpoint();
  left.send = (message) => queueMicrotask(() => right.dispatch(message));
  right.send = (message) => queueMicrotask(() => left.dispatch(message));
  return [left, right];
}

function endpoint() {
  const listeners = new Set();
  return {
    send: null,
    received: [],
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage(message) {
      this.send(message);
    },
    dispatch(message) {
      this.received.push(message);
      for (const listener of listeners) listener({ data: message });
    }
  };
}

async function testUnexpectedHostByteCounts(serve, createRemote) {
  for (const delta of [-1, 1]) {
    const [hostEndpoint, workerEndpoint] = linkedEndpoints();
    const host = serve({
      kind: "range",
      byteLength: 20,
      async read(_offset, length) {
        return new Uint8Array(length + delta);
      }
    }, hostEndpoint);
    const remote = createRemote(20, workerEndpoint);
    await assert.rejects(
      remote.read(3, 5, new AbortController().signal),
      (error) => error?.code === "source-read"
    );
    await remote.close();
    await host.close();
  }
}

async function testRemoteEndpointFailures(createRemote) {
  const throwing = endpoint();
  throwing.send = () => { throw new Error("endpoint terminated"); };
  const failed = createRemote(10, throwing);
  await assert.rejects(
    failed.read(0, 1, new AbortController().signal),
    (error) => error?.code === "source-read" && /send/.test(error.message)
  );
  await failed.close();

  const malformed = endpoint();
  malformed.send = (message) => {
    if (message.type !== "pdf-range-read") return;
    queueMicrotask(() => malformed.dispatch({
      type: "pdf-range-result",
      requestId: message.requestId,
      ok: true,
      bytes: "not bytes"
    }));
  };
  const malformedRemote = createRemote(10, malformed);
  await assert.rejects(
    malformedRemote.read(0, 1, new AbortController().signal),
    (error) => error?.code === "source-read"
  );
  await malformedRemote.close();

  const silent = endpoint();
  silent.send = () => undefined;
  const pendingRemote = createRemote(10, silent);
  const pending = pendingRemote.read(0, 1, new AbortController().signal);
  await pendingRemote.close();
  await assert.rejects(pending, (error) => error?.code === "closed");
}

async function testHostCloseFailure(serve, createRemote) {
  const [hostEndpoint, workerEndpoint] = linkedEndpoints();
  let closeCount = 0;
  const closeError = new Error("range source close failed");
  const host = serve({
    kind: "range",
    byteLength: 1,
    async read() { return Uint8Array.of(1); },
    close() {
      closeCount += 1;
      throw closeError;
    }
  }, hostEndpoint);
  const remote = createRemote(1, workerEndpoint);
  await remote.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(host.close(), (error) => error === closeError);
  await assert.rejects(host.close(), (error) => error === closeError);
  assert.equal(closeCount, 1, "host close failures must retain one idempotent close operation");
}
