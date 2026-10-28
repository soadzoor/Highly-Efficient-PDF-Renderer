/** A reusable handwritten signature. Points remain vectors in local coordinates. */
export interface EditorSignature {
  id: string;
  name: string;
  paths: number[][];
  width: number;
  height: number;
}

const STORAGE_KEY = "hepr.signatures.v1";

export function validateEditorSignature(value: unknown): value is EditorSignature {
  if (!value || typeof value !== "object") return false;
  const item = value as EditorSignature;
  return typeof item.id === "string" && item.id.length > 0 && typeof item.name === "string" &&
    Number.isFinite(item.width) && item.width > 0 && Number.isFinite(item.height) && item.height > 0 &&
    Array.isArray(item.paths) && item.paths.length > 0 && item.paths.every(path =>
      Array.isArray(path) && path.length >= 4 && path.length % 2 === 0 && path.every(Number.isFinite));
}

/** No application count limit; storage failures are reported to the caller. */
export function createEditorSignatureLibrary(storage: Pick<Storage, "getItem" | "setItem">) {
  function read(): EditorSignature[] {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || !data.every(validateEditorSignature)) {
      throw new Error("Saved signatures could not be read. Export or clear the browser's HEPR signature storage before replacing it.");
    }
    return data;
  }
  function write(items: EditorSignature[]): void {
    // setItem is atomic: a quota or privacy error leaves the existing library intact.
    storage.setItem(STORAGE_KEY, JSON.stringify(items));
  }
  return {
    list: read,
    save(signature: EditorSignature): void {
      if (!validateEditorSignature(signature)) throw new TypeError("Invalid handwritten signature.");
      const items = read(), index = items.findIndex(item => item.id === signature.id);
      if (index < 0) items.push(signature); else items[index] = signature;
      write(items);
    },
    remove(id: string): void { write(read().filter(item => item.id !== id)); }
  };
}

/** Normalize captured screen points without discarding their original shape. */
export function normalizeEditorSignature(paths: readonly (readonly number[])[], name: string, id: string): EditorSignature {
  const valid = paths.filter(path => path.length >= 4);
  if (!valid.length) throw new Error("Draw a signature before saving it.");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of valid) for (let i = 0; i < path.length; i += 2) {
    if (!Number.isFinite(path[i]) || !Number.isFinite(path[i + 1])) throw new TypeError("Invalid signature point.");
    minX = Math.min(minX, path[i]); maxX = Math.max(maxX, path[i]);
    minY = Math.min(minY, path[i + 1]); maxY = Math.max(maxY, path[i + 1]);
  }
  return { id, name: name.trim() || "Signature", width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1),
    paths: valid.map(path => path.map((value, index) => value - (index % 2 ? minY : minX))) };
}
