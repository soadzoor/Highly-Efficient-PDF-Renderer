import type { VectorScene } from "./pdfVectorExtractor";
import type { HepLodOptions } from "./hepLod";
import { getCachedTextLod } from "./textLodCore";
import { shouldBuildTextLod } from "./textGreekLod";
import "./hepLodPrompt.css";

/** The unchecked default preserves the compact export; Escape cancels. */
export function promptForHepLod(scene: VectorScene, signal?: AbortSignal): Promise<HepLodOptions | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const cachedText = getCachedTextLod(scene);
  const vector = scene.segmentCount > 0;
  const text = cachedText ? cachedText.data !== null : shouldBuildTextLod(scene);
  if (!vector && !text) return Promise.resolve({});
  const dialog = document.createElement("dialog");
  dialog.className = "hep-lod-dialog";
  dialog.setAttribute("aria-labelledby", "hep-lod-title");
  const form = document.createElement("form");
  form.method = "dialog";
  const title = document.createElement("h2");
  title.id = "hep-lod-title";
  title.textContent = "Download HEP";
  const description = document.createElement("p");
  description.textContent = "Store levels of detail for faster loading. This increases file size. Leave unchecked for a smaller file.";
  form.append(title, description);
  const inputs: { key: "withVectorLod" | "withTextLod"; input: HTMLInputElement }[] = [];
  for (const [available, key, label] of [[vector, "withVectorLod", "Include vector LOD"],
    [text, "withTextLod", "Include text LOD"]] as const) {
    if (!available) continue;
    const row = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
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
    precision.disabled = true;
    const vectorInput = inputs.find(({ key }) => key === "withVectorLod")!.input;
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
      const options: HepLodOptions = {};
      for (const { key, input } of inputs) options[key] = input.checked;
      if (options.withVectorLod) options.vectorLodPrecision = precision.value === "compact" ? "compact" : "lossless";
      dialog.remove();
      resolve(dialog.returnValue === "download" ? options : null);
    }, { once: true });
    dialog.showModal();
    download.focus();
  });
}
