import type { RasterTilePlan, RasterTileSource } from "./rasterTiles";

/** Context-owned LRU. Cached textures count against the same budget as visible images. */
export class RasterResourceCache<T extends object> {
  private readonly identities = new WeakMap<Uint8Array, number>();
  private readonly keys = new WeakMap<T, string>();
  private readonly entries = new Map<string, { resource: T; bytes: number }>();
  private nextIdentity = 0;
  bytes = 0;
  private readonly release: (resource: T) => void;
  constructor(release: (resource: T) => void) { this.release = release; }

  private key(source: RasterTileSource & { matrix?: ArrayLike<number>; opacity?: number; pageIndex?: number; paintOrder?: number }, plan: RasterTilePlan,
    format?: string | null): string {
    const pixels = source.monochrome?.data ?? source.data;
    let identity = this.identities.get(pixels);
    if (identity === undefined) this.identities.set(pixels, identity = ++this.nextIdentity);
    return `${identity}:${source.width}:${source.height}:${plan.width}:${plan.height}:${plan.tiles.map(tile =>
      `${tile.x},${tile.y},${tile.width},${tile.height}`).join(";")}:${format ?? ""}:${source.opacity ?? 1}:${
      source.matrix ? Array.from(source.matrix).join(",") : ""}:${source.pageIndex ?? 0}:${source.paintOrder ?? 0}:${source.monochrome ? Array.from(source.monochrome.colors).join(",") : ""}`;
  }

  remember(resource: T, source: RasterTileSource & { matrix?: ArrayLike<number>; opacity?: number; pageIndex?: number; paintOrder?: number },
    plan: RasterTilePlan, format?: string | null): T {
    this.keys.set(resource, this.key(source, plan, format)); return resource;
  }

  take(source: RasterTileSource & { matrix?: ArrayLike<number>; opacity?: number; pageIndex?: number; paintOrder?: number }, plan: RasterTilePlan,
    format?: string | null): T | null {
    const key = this.key(source, plan, format), entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key); this.bytes -= entry.bytes;
    return entry.resource;
  }

  has(source: RasterTileSource & { matrix?: ArrayLike<number>; opacity?: number; pageIndex?: number; paintOrder?: number }, plan: RasterTilePlan,
    format?: string | null): boolean { return this.entries.has(this.key(source, plan, format)); }

  park(resource: T, bytes: number): void {
    const key = this.keys.get(resource);
    if (!key) { this.release(resource); return; }
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.bytes; this.release(previous.resource); this.entries.delete(key); }
    this.entries.set(key, { resource, bytes }); this.bytes += bytes;
  }

  trim(limit: number): void {
    for (const [key, entry] of this.entries) {
      if (this.bytes <= Math.max(0, limit)) break;
      this.entries.delete(key); this.bytes -= entry.bytes; this.release(entry.resource);
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) this.release(entry.resource);
    this.entries.clear(); this.bytes = 0;
  }
}
