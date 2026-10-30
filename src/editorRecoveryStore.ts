import type { EditorRecoveryEnvelope } from "./editorRecoveryCodec";

export interface EditorRecoveryMetadata { key: string; label: string; updatedAt: number; revision: number; protected: boolean }
export interface EditorRecoveryRecord extends EditorRecoveryMetadata { envelope: EditorRecoveryEnvelope }
export interface EditorRecoveryStore {
  get(key: string): Promise<EditorRecoveryRecord | undefined>;
  put(record: EditorRecoveryRecord): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<readonly EditorRecoveryMetadata[]>;
  close?(): void;
}

/** One latest draft per document, with small separate management metadata. */
export function createEditorRecoveryStore(factory: IDBFactory | undefined = globalThis.indexedDB): EditorRecoveryStore {
  let opening: Promise<IDBDatabase> | undefined, closed = false;
  const database = (): Promise<IDBDatabase> => {
    if (closed) return Promise.reject(new Error("Recovery storage is closed."));
    return opening ??= new Promise((resolve, reject) => {
      if (!factory) { reject(new Error("Browser recovery storage is unavailable.")); return; }
      const request = factory.open("hepr-editor-recovery", 1); let abandoned = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["drafts", "metadata"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "key" });
      };
      request.onerror = () => { abandoned = true; opening = undefined; reject(request.error ?? new Error("Could not open recovery storage.")); };
      request.onblocked = () => { abandoned = true; opening = undefined; reject(new Error("Recovery storage is blocked by another tab.")); };
      request.onsuccess = () => {
        const db = request.result; db.onversionchange = () => { db.close(); opening = undefined; };
        if (closed || abandoned) { db.close(); reject(new Error("Recovery storage is closed.")); } else resolve(db);
      };
    });
  };
  async function transact<T>(mode: IDBTransactionMode, operation: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(["drafts", "metadata"], mode); let value: T;
      tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error ?? new Error("Recovery storage failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Recovery storage was cancelled."));
      try { operation(tx, result => { value = result; }); } catch (error) { tx.abort(); reject(error); }
    });
  }
  return {
    get: key => transact("readonly", (tx, result) => { const request = tx.objectStore("drafts").get(key); request.onsuccess = () => result(request.result as EditorRecoveryRecord | undefined); }),
    async put(record) {
      if (record.protected && !record.envelope.encrypted) throw new Error("Protected recovery content must be encrypted.");
      const { envelope: _envelope, ...metadata } = record;
      await transact<void>("readwrite", tx => {
        const existing = tx.objectStore("metadata").get(record.key);
        existing.onsuccess = () => {
          if (existing.result && existing.result.updatedAt > record.updatedAt) return;
          tx.objectStore("drafts").put(record); tx.objectStore("metadata").put(metadata);
        };
      });
    },
    remove: key => transact<void>("readwrite", tx => { tx.objectStore("drafts").delete(key); tx.objectStore("metadata").delete(key); }),
    list: () => transact("readonly", (tx, result) => { const request = tx.objectStore("metadata").getAll(); request.onsuccess = () => result((request.result as EditorRecoveryMetadata[]).sort((a, b) => b.updatedAt - a.updatedAt)); }),
    close() { if (closed) return; closed = true; void opening?.then(db => db.close(), () => {}); }
  };
}
