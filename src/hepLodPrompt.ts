import type { VectorScene } from "./pdfVectorExtractor";
import type { HepLodOptions } from "./hepLod";
import type { HepEncodingOptions } from "./hepBuilder";
import { getCachedTextLod } from "./textLodCore";
import { shouldBuildTextLod } from "./textGreekLod";
import "./hepLodPrompt.css";

export interface HepDownloadOptions extends HepLodOptions,
  Pick<HepEncodingOptions, "monochromeEncoding"> {
  downloadBothScanEncodings?: boolean;
}

/** Include available LODs and offer both lossless scan encodings; Escape cancels. */
export function promptForHepLod(scene: VectorScene, signal?: AbortSignal): Promise<HepDownloadOptions | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const cachedText = getCachedTextLod(scene);
  const vector = scene.segmentCount > 0;
  const text = cachedText ? cachedText.data !== null : shouldBuildTextLod(scene);
  const scans = scene.rasterLayers.some(layer => Boolean(layer.monochrome));
  if (!vector && !text && !scans) return Promise.resolve({});
  const dialog = document.createElement("dialog");
  dialog.className = "hep-lod-dialog";
  dialog.setAttribute("aria-labelledby", "hep-lod-title");
  const form = document.createElement("form");
  form.method = "dialog";
  const title = document.createElement("h2");
  title.id = "hep-lod-title";
  title.textContent = "Download HEP";
  form.append(title);
  if (vector || text) {
    const description = document.createElement("p");
    description.textContent = "Store levels of detail for faster loading. Uncheck for a smaller file. Your selected levels are kept." +
      (scans ? "" : " HEP files larger than the original PDF still download with a warning.");
    form.append(description);
  }
  const scanEncoding = document.createElement("select");
  if (scans) {
    const description = document.createElement("p");
    description.textContent = "Both scan formats preserve the same image quality. Faster opening stores decoded pixels; smaller files decode the original compressed scans when opened. Files larger than the original PDF still download with a warning.";
    const row = document.createElement("label");
    row.append(document.createTextNode("Scan export options"));
    scanEncoding.setAttribute("aria-label", "Scan export options");
    for (const [value, label] of [["packed", "Faster opening (larger file)"],
      ["jbig2", "Smaller file (slower opening)"], ["both", "Both (two files)"]]) {
      const option = document.createElement("option");
      option.value = value; option.textContent = label; scanEncoding.append(option);
    }
    scanEncoding.value = "both";
    row.append(scanEncoding);
    form.append(description, row);
  }
  const inputs: { key: "withVectorLod" | "withTextLod"; input: HTMLInputElement }[] = [];
  for (const [available, key, label] of [[vector, "withVectorLod", "Include vector LOD"],
    [text, "withTextLod", "Include text LOD"]] as const) {
    if (!available) continue;
    const row = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    row.append(input, document.createTextNode(label));
    form.append(row);
    inputs.push({ key, input });
  }
  const precision = document.createElement("select");
  if (vector) {
    const row = document.createElement("label");
    row.append(document.createTextNode("Vector precision"));
    precision.setAttribute("aria-label", "Vector LOD precision");
    for (const [value, label] of [["compact", "Compact (coarser distant detail)"], ["lossless", "Lossless"]]) {
      const option = document.createElement("option");
      option.value = value; option.textContent = label; precision.append(option);
    }
    const vectorInput = inputs.find(({ key }) => key === "withVectorLod")!.input;
    precision.disabled = !vectorInput.checked;
    vectorInput.addEventListener("change", () => { precision.disabled = !vectorInput.checked; });
    row.append(precision); form.append(row);
  }
  const actions = document.createElement("div");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.onclick = () => dialog.close("cancel");
  const download = document.createElement("button");
  download.type = "submit";
  download.value = "download";
  download.textContent = "Download";
  actions.append(cancel, download);
  form.append(actions);
  dialog.append(form);
  document.body.append(dialog);
  return new Promise(resolve => {
    const abort = (): void => dialog.close("cancel");
    signal?.addEventListener("abort", abort, { once: true });
    dialog.addEventListener("close", () => {
      signal?.removeEventListener("abort", abort);
      const options: HepDownloadOptions = {};
      for (const { key, input } of inputs) options[key] = input.checked;
      if (options.withVectorLod) options.vectorLodPrecision = precision.value === "compact" ? "compact" : "lossless";
      if (scans) {
        options.monochromeEncoding = scanEncoding.value === "packed" ? "packed" : "jbig2";
        options.downloadBothScanEncodings = scanEncoding.value === "both";
      }
      dialog.remove();
      resolve(dialog.returnValue === "download" ? options : null);
    }, { once: true });
    dialog.showModal();
    download.focus();
  });
}
