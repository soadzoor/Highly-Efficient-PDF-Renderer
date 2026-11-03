/** File kinds shared by window drops and editor document imports. */
export function droppedFileKind(file: { name: string; type: string }): "pdf" | "hep" | "image" | null {
  const name = file.name.toLowerCase(), type = file.type.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (/\.(hep|zip)$/.test(name) || ["application/x-hep", "application/zip", "application/x-zip-compressed"].includes(type)) return "hep";
  if (/\.(png|jpe?g|webp)$/.test(name) || ["image/png", "image/jpeg", "image/webp"].includes(type)) return "image";
  return null;
}
