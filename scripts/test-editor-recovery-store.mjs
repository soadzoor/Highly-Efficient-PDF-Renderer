import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
function fakeIndexedDb() {
  const tables = new Map(); let fail = false, closed = false;
  const database = {
    objectStoreNames: { contains: name => tables.has(name) }, createObjectStore(name) { tables.set(name, new Map()); }, close() { closed = true; },
    transaction(names, mode) {
      const backup = new Map(names.map(name => [name, new Map(tables.get(name))]));
      const tx = { pending: 0, done: false, error: null,
        abort() { if (tx.done) return; tx.done = true; for (const [name, data] of backup) tables.set(name, data); tx.onabort?.(); },
        objectStore(name) {
          const request = operation => {
            const req = {}; tx.pending++;
            setImmediate(() => {
              if (tx.done) return;
              try { if (fail && mode === "readwrite") throw new Error("Quota exceeded"); req.result = operation(); req.onsuccess?.(); }
              catch (error) { req.error = tx.error = error; req.onerror?.(); tx.abort(); return; }
              finally { tx.pending--; }
              setImmediate(complete);
            }); return req;
          };
          return { get: key => request(() => structuredClone(tables.get(name).get(key))), getAll: () => request(() => structuredClone([...tables.get(name).values()])),
            put: value => request(() => { tables.get(name).set(value.key, structuredClone(value)); return value.key; }), delete: key => request(() => tables.get(name).delete(key)) };
        }
      };
      const complete = () => { if (!tx.done && !tx.pending) { tx.done = true; tx.oncomplete?.(); } };
      setImmediate(complete); return tx;
    }
  };
  return { factory: { open() { const request = {}; setImmediate(() => { request.result = database; request.onupgradeneeded?.(); request.onsuccess?.(); }); return request; } },
    fail: value => { fail = value; }, get closed() { return closed; }, tables };
}
try {
  const { createEditorRecoveryStore } = await import("../src/editorRecoveryStore.ts");
  const fake = fakeIndexedDb(), store = createEditorRecoveryStore(fake.factory);
  const record = { key: "hash", label: "Document", revision: 1, updatedAt: 10, protected: false, envelope: { version: 1, encrypted: false, payload: Uint8Array.of(1, 2, 3) } };
  assert.equal(await store.get("hash"), undefined); await store.put(record);
  const loaded = await store.get("hash"); assert.deepEqual(loaded, record); loaded.envelope.payload[0] = 9;
  assert.equal((await store.get("hash")).envelope.payload[0], 1, "storage returns detached resource data");
  const list = await store.list(); assert.equal(list.length, 1); assert(!("envelope" in list[0]), "management does not load source/font/image payloads");
  await store.put({ ...record, revision: 0, updatedAt: 1 }); assert.equal((await store.get("hash")).revision, 1, "an older tab cannot replace a newer checkpoint");
  await store.put({ ...record, revision: 2, updatedAt: 20 }); assert.equal(fake.tables.get("drafts").size, 1, "only the latest record remains for a document");
  fake.fail(true); await assert.rejects(store.put({ ...record, revision: 3, updatedAt: 30 }), /Quota/); fake.fail(false);
  assert.equal((await store.get("hash")).revision, 2, "failed transaction retains its prior draft and metadata");
  await assert.rejects(store.put({ ...record, protected: true }), /encrypted/);
  await store.remove("hash"); assert.equal(await store.get("hash"), undefined); assert.equal((await store.list()).length, 0);
  store.close(); await Promise.resolve(); assert(fake.closed); await assert.rejects(store.get("hash"), /closed/);
  const absent = createEditorRecoveryStore(undefined); await assert.rejects(absent.get("x"), /unavailable/); absent.close();
  console.log("Recovery IndexedDB adapter: schema, detached reads, latest-only records, small metadata, atomic failure, protection and disposal passed.");
} finally { hooks.deregister(); }
