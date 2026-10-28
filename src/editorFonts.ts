import { BUNDLED_STANDARD_FONT_ASSETS } from "./standardFontResolver";
import type { EditorTextObject, EditorTextRun } from "./editorTypes";

export interface EditorFont {
  readonly id: string;
  readonly family: string;
  readonly fontWeight: number;
  readonly fontStyle: "normal" | "italic";
  readonly bytes: Uint8Array;
}
export interface EditorFontOptions { family?: string; fontWeight?: number | "normal" | "bold"; fontStyle?: string }
export interface EditorFontRegistry {
  list(): readonly EditorFont[];
  get(id: string): EditorFont;
  register(bytes: Uint8Array, options?: EditorFontOptions): Promise<EditorFont>;
  loadBundled(family?: string, style?: EditorFontOptions): Promise<EditorFont>;
  resolve(style: Pick<EditorTextObject, "fontId" | "fontFamily" | "fontWeight" | "fontStyle"> | EditorTextRun): Promise<EditorFont>;
  requestLocalFonts(): Promise<EditorFont[]>;
  dispose(): void;
}
/** Font bytes are owned by the editor session, never persisted in HEP. */
export function createEditorFontRegistry(options: {
  loadAsset?: (url: URL) => Promise<Uint8Array>;
} = {}): EditorFontRegistry {
  const fonts = new Map<string, EditorFont>(); const pending = new Map<string, Promise<EditorFont>>();
  const styles = (style: EditorFontOptions) => ({ fontWeight: style.fontWeight === "bold" ? 700
    : typeof style.fontWeight === "number" ? style.fontWeight : 400,
    fontStyle: (style.fontStyle === "italic" || style.fontStyle === "oblique" ? "italic" : "normal") as "normal" | "italic" });
  const api: EditorFontRegistry = {
    list: () => [...fonts.values()],
    get(id) { const font = fonts.get(id); if (!font) throw new RangeError(`Unknown font ${id}.`); return font; },
    async register(input, metadata = {}) {
      if (!(input instanceof Uint8Array) || input.length < 12) throw new TypeError("Import a valid TTF or OTF font.");
      const bytes = input.slice();
      const signature = new DataView(bytes.buffer).getUint32(0);
      if (signature !== 0x00010000 && signature !== 0x4f54544f && signature !== 0x74727565) throw new TypeError("Import an outline TTF or OTF font.");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const id = "font-" + [...digest].map(n => n.toString(16).padStart(2, "0")).join("");
      if (fonts.has(id)) return fonts.get(id)!;
      const hb = await import("harfbuzzjs");
      const face = new hb.Face(new hb.Blob(bytes));
      if (!(face.upem > 0) || (face.referenceTable("head")?.length ?? 0) < 54) throw new TypeError("The font has no valid OpenType face.");
      if (!face.referenceTable("glyf") && !face.referenceTable("CFF ") && !face.referenceTable("CFF2")) throw new TypeError("This font has no vector outlines. Choose an outline TTF or OTF font.");
      const family = metadata.family || face.getName(16, "en") || face.getName(1, "en");
      const subfamily = face.getName(2, "en") || "";
      const font: EditorFont = Object.freeze({ id, family: family || "Imported font", bytes,
        ...styles({ fontWeight: /bold/i.test(subfamily) ? 700 : 400,
          fontStyle: /italic|oblique/i.test(subfamily) ? "italic" : "normal", ...metadata }) });
      fonts.set(id, font); return font;
    },
    async loadBundled(family = "Liberation Sans", style = {}) {
      const resolved = styles(style); const mono = /mono|courier/i.test(family), serif = /serif|times/i.test(family) && !/sans/i.test(family);
      const stem = mono ? "mono" : serif ? "serif" : "sans";
      const suffix = resolved.fontWeight >= 600 ? resolved.fontStyle === "italic" ? "bold-italic" : "bold"
        : resolved.fontStyle === "italic" ? "italic" : "regular";
      const key = `liberation-${stem}-${suffix}` as keyof typeof BUNDLED_STANDARD_FONT_ASSETS;
      let promise = pending.get(key);
      if (!promise) {
        const asset = BUNDLED_STANDARD_FONT_ASSETS[key];
        promise = (async () => {
          let bytes: Uint8Array;
          if (options.loadAsset) bytes = await options.loadAsset(asset.url);
          else { const response = await fetch(asset.url); if (!response.ok) throw new Error(`Could not load ${asset.id}: ${response.status}`); bytes = new Uint8Array(await response.arrayBuffer()); }
          return api.register(bytes, { family: `Liberation ${mono ? "Mono" : serif ? "Serif" : "Sans"}`, ...resolved });
        })();
        pending.set(key, promise); promise.catch(() => pending.delete(key));
      }
      return promise;
    },
    async resolve(style) {
      if (style.fontId) {
        const selected = api.get(style.fontId), requested = styles({
          fontWeight: style.fontWeight ?? selected.fontWeight, fontStyle: style.fontStyle ?? selected.fontStyle
        });
        const exact = [...fonts.values()].find(font => font.family === selected.family && font.fontWeight === requested.fontWeight && font.fontStyle === requested.fontStyle);
        if (exact) return exact;
        if (/^Liberation (Sans|Serif|Mono)$/.test(selected.family)) return api.loadBundled(selected.family, requested);
        return selected;
      }
      const normalized = styles(style);
      const found = [...fonts.values()].find(font => font.family === style.fontFamily &&
        font.fontWeight === normalized.fontWeight && font.fontStyle === normalized.fontStyle);
      return found ?? api.loadBundled(style.fontFamily, style);
    },
    async requestLocalFonts() {
      const query = (globalThis as typeof globalThis & { queryLocalFonts?: () => Promise<{ family: string; style: string; blob(): Promise<Blob> }[]> }).queryLocalFonts;
      if (!query) throw new Error("Installed-font access is unavailable in this browser. Import a TTF or OTF file instead.");
      const result: EditorFont[] = [];
      for (const font of await query()) result.push(await api.register(new Uint8Array(await (await font.blob()).arrayBuffer()), {
        family: font.family, fontWeight: /bold/i.test(font.style) ? 700 : 400,
        fontStyle: /italic|oblique/i.test(font.style) ? "italic" : "normal"
      }));
      return result;
    },
    dispose() { fonts.clear(); pending.clear(); }
  };
  return api;
}
