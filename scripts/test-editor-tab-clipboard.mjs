import assert from "node:assert/strict";
import { editorTabClipboard } from "../src/editorTabClipboard.ts";

const format = "hepr-editor-tab-clipboard";
function environment() {
  const channels = new Set(), messages = [];
  class Channel extends EventTarget {
    constructor(name) { super(); this.name = name; channels.add(this); }
    postMessage(message) {
      messages.push(structuredClone(message));
      for (const other of [...channels]) if (other !== this && other.name === this.name)
        other.dispatchEvent(new MessageEvent("message", { data: structuredClone(message) }));
    }
    close() { channels.delete(this); }
  }
  const window = actor => Object.assign(new EventTarget(), { crypto: { randomUUID: () => actor }, BroadcastChannel: Channel });
  const broadcast = message => { for (const channel of [...channels]) channel.dispatchEvent(new MessageEvent("message", { data: structuredClone(message) })); };
  return { channels, messages, window, broadcast };
}

{
  const env = environment(), aWindow = env.window("a"), a = editorTabClipboard(aWindow), b = editorTabClipboard(env.window("b"));
  assert.equal(editorTabClipboard(aWindow), a, "document replacement reuses the tab's memory clipboard");
  assert.equal(a.hasValue(), false); assert.equal(b.hasValue(), false); assert.equal(a.getId(), null);
  let changes = 0; const unsubscribe = b.subscribe(() => changes++);
  const bytes = Uint8Array.of(1, 2, 3), id = a.publish(bytes, 10);
  bytes[0] = 99;
  assert.equal(changes, 1); assert.equal(b.hasValue(), true); assert.equal(b.get().id, id); assert.equal(b.getId(), id);
  assert.deepEqual([...b.get().bytes], [1, 2, 3]);
  const received = b.get(); received.bytes[1] = 88;
  assert.deepEqual([...b.get().bytes], [1, 2, 3], "consumers own their imported bytes");
  assert.deepEqual([...a.get().bytes], [1, 2, 3], "receiver mutations cannot alter source bytes");
  const c = editorTabClipboard(env.window("c"));
  assert.equal(c.get().id, id, "a new tab requests the existing clipboard");
  aWindow.dispatchEvent(new Event("pagehide"));
  assert.equal(env.channels.size, 2);
  const later = editorTabClipboard(env.window("d"));
  assert.equal(later.get().id, id, "existing receiver tabs retain copies after the source tab closes");
  unsubscribe(); b.clear(); assert.equal(changes, 1); assert.equal(c.hasValue(), false); assert.equal(later.hasValue(), false); assert.equal(b.getId(), null);
  assert.equal(a.hasValue(), true, "a suspended tab retains its state until resumed");
  aWindow.dispatchEvent(new Event("pageshow"));
  assert.equal(a.hasValue(), false, "resuming refreshes the newer clear tombstone");
}
{
  const env = environment(), aWindow = env.window("a"), a = editorTabClipboard(aWindow), b = editorTabClipboard(env.window("b"));
  const old = a.publish(Uint8Array.of(1), 100);
  const newest = b.publish(Uint8Array.of(2), 200);
  assert.equal(a.publish(Uint8Array.of(3), 150), null, "an older asynchronous export cannot replace a newer remote copy");
  assert.equal(a.get().id, newest); assert.equal(b.get().id, newest);
  const stale = env.messages.find(message => message.kind === "state" && JSON.stringify([message.revision.time, message.revision.actor, message.revision.sequence]) === old);
  env.broadcast(stale); assert.equal(a.get().id, newest); assert.equal(b.get().id, newest);
  aWindow.dispatchEvent(new Event("pagehide")); b.publish(Uint8Array.of(4), 300); aWindow.dispatchEvent(new Event("pageshow"));
  assert.deepEqual([...a.get().bytes], [4], "back-forward cache restoration reconnects and requests missed data");
  const current = a.get().id;
  for (const message of [null, { format, version: 2, kind: "request" },
    { format, version: 1, kind: "state", revision: { time: 999, actor: "bad", sequence: 1 }, bytes: {} },
    { format, version: 1, kind: "state", revision: { time: NaN, actor: "bad", sequence: 1 }, bytes: null }]) env.broadcast(message);
  assert.equal(a.get().id, current, "malformed and incompatible messages cannot replace a valid clipboard");
}
{
  const previousNow = Date.now;
  Date.now = () => 1000;
  try {
    const env = environment(), a = editorTabClipboard(env.window("z")), b = editorTabClipboard(env.window("a"));
    a.publish(Uint8Array.of(1)); b.clear(); assert.equal(a.hasValue(), false, "a same-tick clear wins over an observed copy regardless of tab ID");
    const copy = b.beginCopy(); assert(b.publish(Uint8Array.of(2), copy), "a fresh same-tick copy succeeds after clearing");
    assert.deepEqual([...a.get().bytes], [2]);
    const next = a.beginCopy(); assert(a.publish(Uint8Array.of(3), next), "a new same-tick copy supersedes an observed remote clipboard");
    assert.deepEqual([...b.get().bytes], [3]);
    const old = a.beginCopy(), newer = a.beginCopy();
    assert.equal(a.publish(Uint8Array.of(4), old), null, "newer local capture intent supersedes an older asynchronous export");
    assert(a.publish(Uint8Array.of(5), newer));
    const beforeClear = a.beginCopy(); b.clear();
    assert.equal(a.publish(Uint8Array.of(6), beforeClear), null, "a received clear supersedes earlier capture intent");
  } finally { Date.now = previousNow; }
}
{
  const window = Object.assign(new EventTarget(), { crypto: { randomUUID: () => "offline" } });
  const clipboard = editorTabClipboard(window);
  const pooled = Buffer.from([9, 7, 8, 9]).subarray(1, 3);
  clipboard.publish(pooled, 100); pooled.fill(0);
  assert.deepEqual([...clipboard.get().bytes], [7, 8], "fallback storage snapshots exact Buffer views");
  assert.throws(() => clipboard.publish("not bytes"), /bytes/);
  assert.throws(() => clipboard.publish(new Uint8Array(), NaN), /time/);
  clipboard.clear(); assert.equal(clipboard.get(), null);
}
{
  const window = Object.assign(new EventTarget(), { crypto: { randomUUID: () => "blocked" },
    BroadcastChannel: class { constructor() { throw new Error("Blocked"); } } });
  const clipboard = editorTabClipboard(window); clipboard.publish(Uint8Array.of(5), 100);
  assert.deepEqual([...clipboard.get().bytes], [5], "blocked messaging leaves local object copy/paste available");
}
console.log("Editor tab clipboard: detached cross-tab copies, new-tab handshake, source closure, ordering, clear and page lifecycle passed.");
