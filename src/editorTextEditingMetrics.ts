const EDITING_FONT_PREFIX = "hepr-text-input--";
const LEGACY_EDITING_FONT_PREFIX = "hepr-text-input:";

// A plain CSS identifier has the same name in FontFace, CSS and fontName.
// In particular, FontFace implementations can retain CSS quote characters.
function encodeFamilyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, char => `_${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function decodeFamilyPart(value: string): string | undefined {
  if (!/^(?:[a-zA-Z0-9-]|_[0-9a-f]{4})+$/.test(value)) return undefined;
  return value.replace(/_([0-9a-f]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function editingLineHeight(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("Textbox line height must be positive and finite.");
  return value;
}

/** Editing-only aliases keep normalized line boxes out of form controls and saved font identities. */
export function editorTextEditingFamily(fontId: string, lineHeight = 1.2): string {
  if (!fontId) throw new TypeError("An editing font requires its original font ID.");
  return `${EDITING_FONT_PREFIX}${encodeFamilyPart(String(editingLineHeight(lineHeight)))}--${encodeFamilyPart(fontId)}`;
}

/** Resolve a computed CSS family back to its portable font identity before reading rich text. */
export function editorTextEditingSourceFontId(family: string): string | undefined {
  const legacy = family.startsWith(LEGACY_EDITING_FONT_PREFIX);
  const prefix = legacy ? LEGACY_EDITING_FONT_PREFIX : EDITING_FONT_PREFIX;
  if (!family.startsWith(prefix)) return undefined;
  const separator = family.indexOf(legacy ? ":" : "--", prefix.length);
  if (separator < 0) return undefined;
  const value = legacy ? family.slice(prefix.length, separator) : decodeFamilyPart(family.slice(prefix.length, separator));
  const sourceFontId = legacy ? family.slice(separator + 1) : decodeFamilyPart(family.slice(separator + 2));
  const lineHeight = Number(value);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0 || String(lineHeight) !== value) return undefined;
  return sourceFontId || undefined;
}

/** Match the compiler's 80/20 baseline split for every font size on each CSS line. */
export function editorTextEditingDescriptors(lineHeight = 1.2): Pick<FontFaceDescriptors, "ascentOverride" | "descentOverride" | "lineGapOverride"> {
  const height = editingLineHeight(lineHeight);
  return { ascentOverride: `${height * 80}%`, descentOverride: `${height * 20}%`, lineGapOverride: "0%" };
}
