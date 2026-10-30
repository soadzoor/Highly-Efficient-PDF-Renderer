import type { EditorSession, EditorState } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import { createEditorRecoveryCodec, encodeEditorRecoveryGraph } from "./editorRecoveryCodec";
import { createEditorRecoveryStore, type EditorRecoveryMetadata, type EditorRecoveryStore } from "./editorRecoveryStore";

export interface EditorRecoveryController {
  probe(): Promise<EditorRecoveryMetadata | undefined>;
  hasPendingDecision(): boolean;
  restore(): Promise<void>;
  discard(key?: string): Promise<void>;
  list(): Promise<readonly EditorRecoveryMetadata[]>;
  draftChanged(): void;
  flush(): Promise<void>;
  dispose(): void;
}
export interface EditorRecoveryStatus { state: "saving" | "saved" | "error"; updatedAt?: number; message?: string }

/** Hash the original file bytes when available; never use names as identity. */
export async function editorRecoveryDocumentKey(source: { bytes?: Uint8Array; scene?: VectorScene }, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted(); const bytes = source.bytes ?? (source.scene ? encodeEditorRecoveryGraph(source.scene) : undefined);
  if (!bytes) throw new TypeError("Recovery requires source file bytes or a complete source scene.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)); signal?.throwIfAborted();
  return `sha256:${Array.from(digest, value => value.toString(16).padStart(2, "0")).join("")}`;
}

/** Debounced committed snapshots; gestures and View frames do no recovery work. */
export function createEditorRecovery(options: {
  session: EditorSession; key: string; label: string; password?: string; protected?: boolean;
  store?: EditorRecoveryStore; debounceMs?: number;
  getDraft?(): unknown | Promise<unknown>;
  applyDraft?(draft: unknown): void | Promise<void>;
  isInteracting?(): boolean;
  onStatus?(status: EditorRecoveryStatus): void;
  onError?(error: unknown): void;
}): EditorRecoveryController {
  const { session } = options, owned = !options.store, store = options.store ?? createEditorRecoveryStore();
  const codec = createEditorRecoveryCodec(options), lifetime = new AbortController();
  const delay = options.debounceMs ?? 1500;
  let disposed = false, restoring = false, generation = 0, observedRevision = session.revision;
  let timer: ReturnType<typeof setTimeout> | undefined, idle: number | undefined, active: Promise<void> | undefined, work: AbortController | undefined;
  let pending = false, lastError = "";
  let decisionPending = true, ownedRecord = false;
  const idleHost = globalThis as typeof globalThis & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  function cancelScheduled(): void {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (idle !== undefined) { idleHost.cancelIdleCallback?.(idle); idle = undefined; }
  }
  function report(error: unknown): void {
    if (disposed || error instanceof DOMException && error.name === "AbortError") return;
    const message = error instanceof Error ? error.message : String(error);
    options.onStatus?.({ state: "error", message });
    if (message !== lastError) { lastError = message; options.onError?.(error); }
  }
  function schedule(invalidate = true): void {
    if (disposed || restoring) return;
    if (invalidate) { generation++; work?.abort(); }
    pending = true; cancelScheduled();
    timer = setTimeout(() => {
      timer = undefined;
      if (idleHost.requestIdleCallback) idle = idleHost.requestIdleCallback(() => { idle = undefined; void run(false); }, { timeout: 2000 });
      else void run(false);
    }, delay);
  }
  async function run(force: boolean): Promise<void> {
    if (disposed || restoring) return;
    cancelScheduled();
    if (decisionPending) { pending = true; return; }
    if (active) { pending = true; await active; if (force) return run(true); return; }
    if (session.getState().previewing || !force && options.isInteracting?.()) { schedule(false); return; }
    if (!force && !pending) return;
    pending = false; const token = generation, revision = session.revision, abort = new AbortController(); work = abort;
    const signal = AbortSignal.any([lifetime.signal, abort.signal]);
    const task = (async () => {
      options.onStatus?.({ state: "saving" });
      const draft = await options.getDraft?.(); signal.throwIfAborted();
      const snapshot = await session.captureRecovery({ signal }); signal.throwIfAborted();
      if (generation !== token || session.revision !== revision || session.getState().previewing || !force && options.isInteracting?.()) { pending = true; return; }
      const envelope = await codec.encode(snapshot, draft, signal); signal.throwIfAborted();
      if (generation !== token || session.revision !== revision) { pending = true; return; }
      const updatedAt = Date.now();
      await store.put({ key: options.key, label: options.protected || options.password !== undefined ? "Protected PDF" : options.label,
        protected: envelope.encrypted, updatedAt, revision, envelope }); signal.throwIfAborted();
      ownedRecord = true; decisionPending = false; lastError = ""; options.onStatus?.({ state: "saved", updatedAt });
    })().catch(report);
    active = task;
    try { await task; } finally { if (active === task) active = undefined; if (work === abort) work = undefined; if (pending && !disposed && !restoring) schedule(false); }
  }
  const unsubscribe = session.subscribe((state: EditorState) => {
    if (disposed || restoring || state.previewing) return;
    if (state.revision !== observedRevision) { observedRevision = state.revision; schedule(); }
  });
  async function probe(): Promise<EditorRecoveryMetadata | undefined> {
    if (disposed) return;
    try {
      const record = await store.get(options.key); if (disposed) return;
      decisionPending = Boolean(record) && !ownedRecord;
      if (!decisionPending && pending) schedule(false);
      if (record) { const { envelope: _envelope, ...metadata } = record; return metadata; }
    } catch (error) { decisionPending = false; report(error); }
  }
  // Never overwrite an older matching draft before Restore/Discard is chosen.
  const initialProbe = probe();
  return {
    async probe() { await initialProbe; return probe(); },
    hasPendingDecision: () => decisionPending,
    async restore() {
      if (disposed) throw new Error("Recovery controls are disposed.");
      await initialProbe; lifetime.signal.throwIfAborted();
      restoring = true; pending = false; cancelScheduled(); generation++; work?.abort(); await active;
      try {
        const record = await store.get(options.key); lifetime.signal.throwIfAborted();
        if (!record) { ownedRecord = false; decisionPending = false; return; }
        const recovered = await codec.decode(record.envelope, lifetime.signal); lifetime.signal.throwIfAborted();
        await session.restoreRecovery(recovered.snapshot, { signal: lifetime.signal }); lifetime.signal.throwIfAborted();
        await options.applyDraft?.(recovered.draft); observedRevision = session.revision;
        ownedRecord = true; decisionPending = false;
        options.onStatus?.({ state: "saved", updatedAt: record.updatedAt });
      } finally { restoring = false; }
    },
    async discard(key = options.key) {
      if (disposed) return;
      const shouldCheckpoint = key === options.key && session.getState().dirty;
      await initialProbe; if (disposed) return;
      if (key === options.key) { generation++; pending = false; cancelScheduled(); work?.abort(); await active; }
      await store.remove(key);
      if (key === options.key) { ownedRecord = false; decisionPending = false; if (shouldCheckpoint) schedule(); }
    },
    list: () => store.list(),
    draftChanged: () => schedule(),
    flush: () => run(true),
    dispose() { if (disposed) return; disposed = true; generation++; cancelScheduled(); lifetime.abort(); unsubscribe(); if (owned) store.close?.(); }
  };
}
