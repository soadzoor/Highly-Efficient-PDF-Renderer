import type { PDFLoadProgress } from "./loadProgress";

export const VIEWER_LOAD_DIAGNOSTICS_STORAGE_KEY = "hepr.viewer-load-diagnostics.v1";
const MAX_EVENTS = 120;
const PROGRESS_INTERVAL_MS = 1_000;

type LoadStatus = "loading" | "complete" | "failed" | "cancelled";

interface LoadEvent {
  phase: string;
  elapsedMs: number;
  /** Time since the previous checkpoint, including asynchronous work. */
  stepElapsedMs: number;
  details?: Record<string, unknown>;
}

interface LoadRecord {
  id: number;
  context: Record<string, unknown>;
  status: LoadStatus;
  startedAt: string;
  elapsedMs: number;
  /** A previous page stopped recording while this load was still active. */
  interrupted: boolean;
  events: LoadEvent[];
  droppedEvents: number;
  message?: string;
}

export interface ViewerLoadDiagnosticsOptions {
  storage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  timestamp?: () => string;
}

/**
 * Small, opt-in load breadcrumbs. Callers supply scalar resource estimates;
 * this recorder never retains a scene, queries a GPU, or samples a JS heap.
 * Checkpoints persist synchronously before the caller starts risky work.
 */
export class ViewerLoadDiagnostics {
  private readonly storage: ViewerLoadDiagnosticsOptions["storage"];
  private readonly now: () => number;
  private readonly timestamp: () => string;
  private readonly storageState = { available: false, error: null as string | null, recovered: false };
  private current: LoadRecord | null = null;
  private previous: LoadRecord | null = null;
  private nextId = 1;
  private startedNow = 0;
  private latestElapsed = 0;
  private lastProgressStage: string | null = null;
  private lastProgressMs = -Infinity;

  constructor(options: ViewerLoadDiagnosticsOptions = {}) {
    this.storage = options.storage;
    this.now = options.now ?? (() => performance.now());
    this.timestamp = options.timestamp ?? (() => new Date().toISOString());
    if (!this.storage) return;
    try {
      const saved = this.storage.getItem(VIEWER_LOAD_DIAGNOSTICS_STORAGE_KEY);
      this.storageState.available = true;
      if (saved === null) return;
      const envelope: unknown = JSON.parse(saved);
      if (!isEnvelope(envelope)) throw new Error("Saved load diagnostics were invalid and were ignored.");
      this.previous = envelope.current ?? envelope.previous;
      if (this.previous) {
        this.previous.interrupted ||= this.previous.status === "loading";
        this.nextId = this.previous.id + 1;
        this.storageState.recovered = true;
      }
    } catch (error) {
      this.storageState.error = errorMessage(error);
    }
  }

  start(context: Record<string, unknown>): number {
    if (this.current?.status === "loading") this.finish(this.current.id, "cancelled", "Superseded by another load.");
    if (this.current) this.previous = this.current;
    this.startedNow = this.now();
    this.latestElapsed = 0;
    this.lastProgressStage = null;
    this.lastProgressMs = -Infinity;
    this.current = {
      id: this.nextId++, context: jsonCopy(context), status: "loading", startedAt: this.timestamp(),
      elapsedMs: 0, interrupted: false, events: [], droppedEvents: 0
    };
    this.checkpoint(this.current.id, "start");
    return this.current.id;
  }

  checkpoint(id: number, phase: string, details?: Record<string, unknown>): void {
    if (!this.isActive(id)) return;
    this.appendEvent(phase, details);
    this.persist();
  }

  /** Driver failures can arrive after submission has completed. Keep their
   * breadcrumbs without changing the completed load's status or duration. */
  note(id: number, phase: string, details?: Record<string, unknown>): void {
    if (this.current?.id !== id) return;
    const finishedElapsed = this.current.status === "loading" ? null : this.current.elapsedMs;
    this.appendEvent(phase, details);
    if (finishedElapsed !== null) this.current.elapsedMs = finishedElapsed;
    this.persist();
  }

  progress(id: number, progress: PDFLoadProgress): void {
    if (!this.isActive(id)) return;
    const elapsed = this.elapsed();
    if (progress.stage === this.lastProgressStage && elapsed - this.lastProgressMs < PROGRESS_INTERVAL_MS) return;
    this.lastProgressStage = progress.stage;
    this.lastProgressMs = elapsed;
    // Copy only load metadata, never an arbitrary payload attached by a caller.
    const details: Record<string, unknown> = { value: progress.value };
    for (const key of ["executionPath", "sourceType", "unit", "processed", "total", "pageIndex", "pageCount",
      "sourcePageIndex", "sourcePageCount"] as const) {
      if (progress[key] !== undefined) details[key] = progress[key];
    }
    this.checkpoint(id, `progress.${progress.stage}`, details);
  }

  finish(id: number, status: Exclude<LoadStatus, "loading">, message?: string): void {
    if (!this.isActive(id)) return;
    this.appendEvent(status);
    this.current!.status = status;
    if (message !== undefined) this.current!.message = message;
    this.persist();
  }

  report() {
    const current = this.current ? { ...this.current, elapsedMs: this.current.status === "loading"
      ? this.elapsed() : this.current.elapsedMs } : null;
    return jsonCopy({
      diagnosticsVersion: 1,
      storage: this.storageState,
      current,
      previous: this.previous,
      notes: [
        "An interrupted loading record means the page stopped recording before completion; it does not confirm a crash or out-of-memory condition.",
        "Elapsed times include asynchronous waits. Resource estimates do not measure total browser or GPU memory.",
        "Saved checkpoints are best effort; a browser process termination can lose the latest write."
      ]
    });
  }

  json(): string { return JSON.stringify(this.report(), null, 2); }

  private isActive(id: number): boolean { return this.current?.id === id && this.current.status === "loading"; }

  private elapsed(): number {
    this.latestElapsed = Math.max(this.latestElapsed, this.now() - this.startedNow, 0);
    return this.latestElapsed;
  }

  private appendEvent(phase: string, details?: Record<string, unknown>): void {
    const record = this.current!;
    const elapsed = this.elapsed();
    const event: LoadEvent = { phase, elapsedMs: elapsed,
      stepElapsedMs: elapsed - (record.events.at(-1)?.elapsedMs ?? 0) };
    if (details !== undefined) event.details = jsonCopy(details);
    record.elapsedMs = elapsed;
    if (record.events.length === MAX_EVENTS) { record.events.shift(); record.droppedEvents++; }
    record.events.push(event);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(VIEWER_LOAD_DIAGNOSTICS_STORAGE_KEY, JSON.stringify({
        diagnosticsVersion: 1, current: this.current, previous: this.previous
      }));
      this.storageState.available = true;
    } catch (error) {
      this.storageState.available = false;
      this.storageState.error = errorMessage(error);
    }
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** Detach metadata and keep reports JSON-safe even for unusual debug values. */
function jsonCopy<T>(value: T): T {
  const seen = new WeakSet<object>();
  return JSON.parse(JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === "bigint") return String(entry);
    if (typeof entry === "object" && entry !== null) {
      if (seen.has(entry)) return "[Circular or shared reference]";
      seen.add(entry);
    }
    return entry;
  })) as T;
}

function isRecord(value: unknown): value is LoadRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<LoadRecord>;
  return Number.isSafeInteger(record.id) && record.id! > 0 && record.id! < Number.MAX_SAFE_INTEGER &&
    typeof record.context === "object" && record.context !== null && !Array.isArray(record.context) &&
    ["loading", "complete", "failed", "cancelled"].includes(record.status ?? "") &&
    typeof record.startedAt === "string" && Number.isFinite(record.elapsedMs) && record.elapsedMs! >= 0 &&
    typeof record.interrupted === "boolean" && Number.isSafeInteger(record.droppedEvents) && record.droppedEvents! >= 0 &&
    (record.message === undefined || typeof record.message === "string") &&
    Array.isArray(record.events) && record.events.length <= MAX_EVENTS && record.events.every(event =>
      typeof event === "object" && event !== null && typeof event.phase === "string" &&
      Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0 && Number.isFinite(event.stepElapsedMs) && event.stepElapsedMs >= 0 &&
      (event.details === undefined || (typeof event.details === "object" && event.details !== null && !Array.isArray(event.details))));
}

function isEnvelope(value: unknown): value is { diagnosticsVersion: 1; current: LoadRecord | null; previous: LoadRecord | null } {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as { diagnosticsVersion?: unknown; current?: unknown; previous?: unknown };
  return envelope.diagnosticsVersion === 1 && (envelope.current === null || isRecord(envelope.current)) &&
    (envelope.previous === null || isRecord(envelope.previous));
}
