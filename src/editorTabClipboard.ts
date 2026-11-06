export interface EditorTabClipboardValue { id: string; bytes: Uint8Array }
export interface EditorTabClipboard {
  hasValue(): boolean;
  /** Compare cached imports without copying the binary payload. */
  getId(): string | null;
  /** Return an owned payload; importing it cannot mutate another tab's clipboard. */
  get(): EditorTabClipboardValue | null;
  /** Reserve an intent before asynchronous capture/export starts. */
  beginCopy(): number;
  /** Use the copy operation's start time so an older asynchronous export cannot replace a newer copy. */
  publish(bytes: Uint8Array, startedAt?: number): string | null;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

interface Revision { time: number; actor: string; sequence: number }
interface ClipboardState { revision: Revision; bytes: Uint8Array | null }
const coordinators = new WeakMap<Window, EditorTabClipboard>();
const format = "hepr-editor-tab-clipboard", channelName = "hepr-editor-clipboard-v1";
const compare = (a: Revision, b: Revision): number => a.time - b.time || a.sequence - b.sequence || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0);
const revisionId = (revision: Revision): string => JSON.stringify([revision.time, revision.actor, revision.sequence]);

/** Memory-only sharing between editor tabs on the same origin; never stores a source document. */
export function editorTabClipboard(window: Window & typeof globalThis): EditorTabClipboard {
  const existing = coordinators.get(window); if (existing) return existing;
  const actor = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const listeners = new Set<() => void>();
  let state: ClipboardState | null = null, channel: BroadcastChannel | null = null, sequence = 0, reserved = -1, hidden = false;
  const notify = (): void => { for (const listener of listeners) listener(); };
  const send = (message: object): void => {
    try { channel?.postMessage({ format, version: 1, ...message }); }
    catch { /* Keep local copying usable when cross-tab messaging is unavailable. */ }
  };
  const sendState = (): void => { if (state) send({ kind: "state", ...state }); };
  const receive = (event: MessageEvent): void => {
    const message = event.data;
    if (!message || message.format !== format || message.version !== 1) return;
    if (message.kind === "request") { sendState(); return; }
    if (message.kind !== "state") return;
    const revision = message.revision as Revision | undefined;
    if (!revision || !Number.isSafeInteger(revision.time) || revision.time < 0 || typeof revision.actor !== "string" || !revision.actor ||
      !Number.isSafeInteger(revision.sequence) || revision.sequence < 1 || revision.actor === actor ||
      message.bytes !== null && !(message.bytes instanceof Uint8Array)) return;
    if (state && compare(revision, state.revision) <= 0) return;
    sequence = Math.max(sequence, revision.sequence);
    state = { revision: { ...revision }, bytes: message.bytes === null ? null : new Uint8Array(message.bytes) };
    notify();
  };
  function connect(): void {
    if (hidden || channel || !window.BroadcastChannel) return;
    try {
      channel = new window.BroadcastChannel(channelName);
      channel.addEventListener("message", receive);
      send({ kind: "request" });
    } catch { channel?.close(); channel = null; }
  }
  function beginCopy(): number {
    reserved = Math.max(Date.now(), (state?.revision.time ?? -1) + 1, reserved + 1);
    return reserved;
  }
  function write(bytes: Uint8Array | null, startedAt = beginCopy()): string | null {
    if (!Number.isSafeInteger(startedAt) || startedAt < 0) throw new TypeError("Clipboard copy time must be a nonnegative integer.");
    if (startedAt < reserved || state && state.revision.actor !== actor && startedAt === state.revision.time) return null;
    const revision = { time: startedAt, actor, sequence: ++sequence };
    if (state && compare(revision, state.revision) < 0) return null;
    reserved = Math.max(reserved, startedAt);
    state = { revision, bytes: bytes === null ? null : new Uint8Array(bytes) };
    notify(); sendState(); return revisionId(revision);
  }
  const clipboard: EditorTabClipboard = {
    hasValue: () => state?.bytes !== null && state?.bytes !== undefined,
    getId: () => state?.bytes ? revisionId(state.revision) : null,
    get: () => state?.bytes ? { id: revisionId(state.revision), bytes: new Uint8Array(state.bytes) } : null,
    beginCopy,
    publish(bytes, startedAt) { if (!(bytes instanceof Uint8Array)) throw new TypeError("Clipboard payload must be bytes."); return write(bytes, startedAt); },
    clear() { write(null, beginCopy()); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
  };
  coordinators.set(window, clipboard);
  window.addEventListener("pagehide", () => { hidden = true; channel?.close(); channel = null; });
  window.addEventListener("pageshow", () => { hidden = false; connect(); });
  connect();
  return clipboard;
}
