import type { EditorFieldObject } from "./editorTypes";
import type { EditorFontRegistry } from "./editorFonts";
import type { PdfBox } from "./heprDocumentData";
import { isPdfDictionary, isPdfRef, type PdfDictionary, type PdfRef, type PdfValue } from "./pdf/nativeCos";
import { NativePdfWriter, pdfAsciiValue, pdfNameValue, pdfNumberValue, pdfStreamValue, pdfTextValue } from "./pdf/nativeWriter";
import { normalizePrimitiveColor } from "./colorInput";
import { editorFieldAnnotation } from "./editorFormFields";
import { setEditorPdfFieldReadOnly } from "./editorPdfFieldLocks";

/** Add real AcroForm fields without disturbing existing field roots/resources. */
export function createEditorPdfFieldWriter(writer: NativePdfWriter, fonts: EditorFontRegistry, signal?: AbortSignal,
  sourceNames: ReadonlySet<string> = new Set()) {
  const document = writer.document;
  const resolve = async (value: PdfValue | undefined): Promise<PdfValue | undefined> => isPdfRef(value)
    ? writer.get(value) ?? await document.resolveValue(value, signal) : value;
  const root = document.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
  const groups = new Map<string, { reference: PdfRef; dictionary: PdfDictionary; type: string; states: Set<string>; kids: PdfRef[]; locked: boolean; readOnly: boolean; flags: number }>();
  const fontEntries = new Map<string, PdfValue>(), fontResources = new Map<string, Promise<string>>();
  let initialFonts: PdfDictionary | undefined;
  const stream = async (bytes: Uint8Array | string, dictionary: PdfDictionary = new Map()): Promise<PdfRef> => {
    signal?.throwIfAborted();
    const input = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    if (input.length && typeof CompressionStream === "function") {
      const compressed = new Uint8Array(await new Response(new Blob([input as Uint8Array<ArrayBuffer>]).stream()
        .pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
      signal?.throwIfAborted();
      return writer.add(pdfStreamValue(compressed, new Map([...dictionary, ["Filter", pdfNameValue("FlateDecode")]])));
    }
    return writer.add(pdfStreamValue(input, dictionary));
  };
  const fontResource = async (object: EditorFieldObject): Promise<string> => {
    const asset = await fonts.resolve(object); signal?.throwIfAborted();
    let pending = fontResources.get(asset.id);
    if (!pending) {
      pending = (async () => {
        if (!initialFonts) {
          const catalog = root ? await resolve(root) : document.catalog;
          const acro = isPdfDictionary(catalog) ? await resolve(catalog.get("AcroForm")) : undefined;
          const resources = isPdfDictionary(acro) ? await resolve(acro.get("DR")) : undefined;
          const raw = isPdfDictionary(resources) ? await resolve(resources.get("Font")) : undefined;
          initialFonts = new Map(isPdfDictionary(raw) ? raw : []);
        }
        let name = `HEPRFieldFont${fontEntries.size + 1}`;
        while (initialFonts.has(name) || fontEntries.has(name)) name += "_";
        // Reserve the name before asynchronous font preparation.
        fontEntries.set(name, null);
        const hb = await import("harfbuzzjs"), face = new hb.Face(new hb.Blob(asset.bytes)), font = new hb.Font(face);
        const factor = 1000 / face.upem, extents = font.hExtents(), cff = !!face.referenceTable("CFF ") || !!face.referenceTable("CFF2");
        const file = await stream(asset.bytes, new Map<string, PdfValue>(cff
          ? [["Subtype", pdfNameValue("OpenType")]] : [["Length1", asset.bytes.length]]));
        const postscript = pdfNameValue(face.getName(6, "en") || asset.family.replace(/\s/g, ""));
        const descriptor = writer.add(new Map<string, PdfValue>([["Type", pdfNameValue("FontDescriptor")], ["FontName", postscript],
          ["FontFamily", pdfTextValue(asset.family)], ["FontWeight", asset.fontWeight], ["Flags", 32], ["FontBBox", [-1000, -1000, 3000, 3000]],
          ["Ascent", extents.ascender * factor], ["Descent", extents.descender * factor], ["CapHeight", extents.ascender * factor],
          ["ItalicAngle", asset.fontStyle === "italic" ? -12 : 0], ["StemV", 80], [cff ? "FontFile3" : "FontFile2", file]]));
        const unicode = new Map<number, string>();
        for (const point of face.collectUnicodes()) {
          signal?.throwIfAborted(); const glyph = font.nominalGlyph(point);
          if (glyph !== undefined && glyph > 0 && glyph <= 0xffff && !unicode.has(glyph)) unicode.set(glyph, String.fromCodePoint(point));
        }
        const mappings = [...unicode].sort(([a], [b]) => a - b).map(([glyph, text]) =>
          `<${glyph.toString(16).padStart(4, "0")}> <${Array.from({ length: text.length }, (_, index) => text.charCodeAt(index).toString(16).padStart(4, "0")).join("")}>`);
        const blocks: string[] = [];
        for (let index = 0; index < mappings.length; index += 100) {
          const rows = mappings.slice(index, index + 100); blocks.push(`${rows.length} beginbfchar\n${rows.join("\n")}\nendbfchar`);
        }
        const toUnicode = await stream(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /HEPRFieldUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${blocks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend end`);
        const descendant = writer.add(new Map<string, PdfValue>([["Type", pdfNameValue("Font")], ["Subtype", pdfNameValue(cff ? "CIDFontType0" : "CIDFontType2")],
          ["BaseFont", postscript], ["CIDSystemInfo", new Map<string, PdfValue>([["Registry", pdfAsciiValue("Adobe")], ["Ordering", pdfAsciiValue("Identity")], ["Supplement", 0]])],
          ["FontDescriptor", descriptor], ...(!cff ? [["CIDToGIDMap", pdfNameValue("Identity")] as [string, PdfValue]] : []),
          ["DW", 1000], ["W", [...unicode.keys()].sort((a, b) => a - b).flatMap(glyph => [glyph, [font.glyphHAdvance(glyph) * factor]])]]));
        const reference = writer.add(new Map<string, PdfValue>([["Type", pdfNameValue("Font")], ["Subtype", pdfNameValue("Type0")],
          ["BaseFont", postscript], ["Encoding", pdfNameValue("Identity-H")], ["DescendantFonts", [descendant]], ["ToUnicode", toUnicode]]));
        fontEntries.set(name, reference); return name;
      })();
      fontResources.set(asset.id, pending);
    }
    return pending;
  };
  return {
    async add(object: EditorFieldObject, options: {
      rectangle: PdfBox; page: PdfRef | null; flags: number; locked?: boolean; optionalContent?: PdfValue;
      appearance(object: EditorFieldObject): Promise<PdfRef>;
    }): Promise<PdfRef> {
      signal?.throwIfAborted();
      if ([...sourceNames].some(name => name === object.name || name.startsWith(object.name + ".") || object.name.startsWith(name + "."))) {
        throw new Error(`The PDF already contains a field named ${object.name} or one of its parent fields.`);
      }
      const metadata = editorFieldAnnotation(object).field!, button = metadata.type === "Btn", radio = object.fieldType === "radio";
      const onValue = object.onValue ?? "Yes";
      let group = groups.get(object.name);
      if (group && (!radio || group.type !== "radio" || group.states.has(onValue))) throw new Error(`Duplicate form field name or radio export value: ${object.name}.`);
      if (!group) {
        const dictionary = new Map<string, PdfValue>([["FT", pdfNameValue(metadata.type!)], ["T", pdfTextValue(object.name)], ["Ff", metadata.flags]]);
        if (object.tooltip) dictionary.set("TU", pdfTextValue(object.tooltip));
        if (object.maxLength !== undefined) dictionary.set("MaxLen", object.maxLength);
        if (object.options) dictionary.set("Opt", object.options.map(option => [pdfTextValue(option.value), pdfTextValue(option.label)]));
        if (!button) dictionary.set("Q", metadata.alignment ?? 0);
        const value = (input: typeof object.value): PdfValue => button ? pdfNameValue(input === true ? onValue
          : input === false || input === null || input === undefined || input === "" ? "Off" : String(input))
          : Array.isArray(input) ? input.map(item => pdfTextValue(item)) : pdfTextValue(String(input ?? ""));
        dictionary.set("V", value(metadata.value));
        if (object.defaultValue !== undefined) dictionary.set("DV", value(object.defaultValue));
        group = { reference: writer.add(dictionary), dictionary, type: object.fieldType, states: new Set(), kids: [],
          locked: false, readOnly: false, flags: metadata.flags }; groups.set(object.name, group);
      }
      group.locked ||= Boolean(options.locked); group.readOnly ||= Boolean(metadata.flags & 1);
      setEditorPdfFieldReadOnly(group.dictionary, group.flags, group.readOnly || group.locked, !group.readOnly && group.locked);
      group.states.add(onValue);
      const color = normalizePrimitiveColor(object.color ?? 0).map(pdfNumberValue).join(" ");
      const da = button ? `${color} rg` : `/${await fontResource(object)} ${pdfNumberValue(object.fontSize ?? 0)} Tf ${color} rg`;
      group.dictionary.set("DA", pdfAsciiValue(da));
      const widget = new Map<string, PdfValue>([["Type", pdfNameValue("Annot")], ["Subtype", pdfNameValue("Widget")], ["Parent", group.reference],
        ["NM", pdfTextValue(object.id)], ["Rect", [...options.rectangle]], ["F", options.flags], ["DA", pdfAsciiValue(da)],
        ["BS", new Map<string, PdfValue>([["W", object.strokeWidth ?? 1], ["S", pdfNameValue("S")]])],
        ["MK", new Map<string, PdfValue>([["BC", normalizePrimitiveColor(object.borderColor ?? "#777777")],
          ["BG", object.fill === null ? [] : normalizePrimitiveColor(object.fill ?? "#ffffff")],
          ...(button ? [["CA", pdfAsciiValue(radio ? "l" : "4")] as [string, PdfValue]] : [])])]]);
      if (options.page) widget.set("P", options.page);
      if (options.optionalContent !== undefined) widget.set("OC", options.optionalContent);
      if (!button && metadata.type === "Tx") widget.set("HEPRInputType", pdfNameValue(object.fieldType));
      if (button) {
        widget.set("AP", new Map([["N", new Map<string, PdfValue>([["Off", await options.appearance({ ...object, value: "Off" })],
          [onValue, await options.appearance({ ...object, value: onValue })]])]]));
        widget.set("AS", pdfNameValue(metadata.appearanceState ?? "Off"));
      } else {
        widget.set("AP", new Map([["N", await options.appearance(object)]]));
        if (object.fieldType === "dropdown" || object.fieldType === "list") {
          const selected = Array.isArray(metadata.value) ? metadata.value : [String(metadata.value ?? "")];
          group.dictionary.set("I", (object.options ?? []).flatMap((option, index) => selected.includes(option.value) ? [index] : []));
        }
      }
      const reference = writer.add(widget); group.kids.push(reference); return reference;
    },
    async finish(): Promise<void> {
      if (!groups.size) return;
      if (!root) throw new Error("The PDF catalog requires a full scene export to add form fields.");
      const currentCatalog = await resolve(root), catalog = new Map(isPdfDictionary(currentCatalog) ? currentCatalog : document.catalog);
      const rawAcro = catalog.get("AcroForm"), original = await resolve(rawAcro), acro = new Map(isPdfDictionary(original) ? original : []);
      const rawFields = acro.get("Fields"), oldFields = await resolve(rawFields);
      for (const group of groups.values()) { group.dictionary.set("Kids", group.kids); writer.set(group.reference, group.dictionary); }
      const fields = [...(Array.isArray(oldFields) ? oldFields : []), ...[...groups.values()].map(group => group.reference)];
      if (isPdfRef(rawFields)) writer.set(rawFields, fields); else acro.set("Fields", fields);
      if (fontEntries.size) {
        const rawResources = await resolve(acro.get("DR")), resources = new Map(isPdfDictionary(rawResources) ? rawResources : []);
        const rawFonts = await resolve(resources.get("Font")), entries = new Map(isPdfDictionary(rawFonts) ? rawFonts : []);
        for (const [name, reference] of fontEntries) entries.set(name, reference);
        resources.set("Font", entries); acro.set("DR", resources);
      }
      // Existing source widgets may rely on their document's appearance policy.
      // Newly added widgets always carry complete appearances of their own.
      if (!acro.has("NeedAppearances")) acro.set("NeedAppearances", false);
      if (isPdfRef(rawAcro)) writer.set(rawAcro, acro); else { catalog.set("AcroForm", acro); writer.set(root, catalog); }
    }
  };
}
