/** Progress within one setup stage; omitted values mean the work is indeterminate. */
export interface EditorSetupProgress {
  stage: "loading" | "document" | "fields" | "session" | "display";
  value?: number;
}

export interface EditorSetupLoadingHandle {
  report(progress: EditorSetupProgress): void;
  finish(): void;
}

const labels: Record<EditorSetupProgress["stage"], string> = {
  loading: "Loading editing tools…",
  document: "Preparing full-quality pages…",
  fields: "Preparing form fields and fonts…",
  session: "Preparing editing controls…",
  display: "Drawing the editable document…"
};

/** A small viewer helper: allocate DOM and observe layout only during setup. */
export function createEditorSetupLoading(getCanvas: () => HTMLCanvasElement): {
  begin(initial?: EditorSetupProgress): EditorSetupLoadingHandle;
} {
  let current: (() => void) | null = null;
  return {
    begin(initial = { stage: "loading" }) {
      current?.();
      const canvas = getCanvas(), document = canvas.ownerDocument, window = document.defaultView;
      const overlay = document.createElement("div"); overlay.className = "hepr-editor-setup";
      const card = document.createElement("div"); card.className = "hepr-editor-setup-card";
      card.setAttribute("role", "status"); card.setAttribute("aria-live", "polite"); card.setAttribute("aria-atomic", "true");
      const heading = document.createElement("div"); heading.className = "hepr-editor-setup-heading";
      const spinner = document.createElement("span"); spinner.className = "hepr-editor-setup-spinner"; spinner.setAttribute("aria-hidden", "true");
      const title = document.createElement("strong"); title.textContent = "Loading Edit mode";
      heading.append(spinner, title);
      const detail = document.createElement("div"); detail.className = "hepr-editor-setup-detail";
      const label = document.createElement("span"), percentage = document.createElement("span"); percentage.className = "hepr-editor-setup-percentage";
      detail.append(label, percentage);
      const bar = document.createElement("progress"); bar.max = 1;
      card.append(heading, detail, bar); overlay.append(card);
      let closed = false, observed = canvas, observer: ResizeObserver | undefined;
      const position = (): void => {
        if (closed) return;
        const target = getCanvas(), rect = target.getBoundingClientRect();
        if (observer && observed !== target) { observer.unobserve(observed); observed = target; observer.observe(target); }
        overlay.style.left = `${rect.left}px`; overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${Math.max(0, rect.width)}px`; overlay.style.height = `${Math.max(0, rect.height)}px`;
      };
      const finish = (): void => {
        if (closed) return;
        closed = true; observer?.disconnect();
        window?.removeEventListener("resize", position);
        window?.removeEventListener("scroll", position, true);
        overlay.remove();
        if (current === finish) current = null;
      };
      const report = (progress: EditorSetupProgress): void => {
        if (closed || current !== finish) return;
        const text = labels[progress.stage];
        if (label.textContent !== text) label.textContent = text;
        if (bar.getAttribute("aria-label") !== text) bar.setAttribute("aria-label", text);
        if (progress.value !== undefined && Number.isFinite(progress.value)) {
          const value = Math.max(0, Math.min(1, progress.value));
          if (!bar.hasAttribute("value") || bar.value !== value) bar.value = value;
          const percent = `${Math.round(value * 100)}%`, description = `${text} ${percent}`;
          if (percentage.textContent !== percent) percentage.textContent = percent;
          if (bar.getAttribute("aria-valuetext") !== description) bar.setAttribute("aria-valuetext", description);
        } else {
          bar.removeAttribute("value"); bar.removeAttribute("aria-valuetext"); percentage.textContent = "";
        }
        if (getCanvas() !== observed) position();
      };
      current = finish;
      document.body.append(overlay); position();
      if (window && typeof window.ResizeObserver === "function") {
        observer = new window.ResizeObserver(position); observer.observe(canvas);
      }
      window?.addEventListener("resize", position);
      window?.addEventListener("scroll", position, { capture: true, passive: true });
      report(initial);
      return { report, finish };
    }
  };
}
