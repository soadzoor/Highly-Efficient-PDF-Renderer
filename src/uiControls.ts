import type { RendererApi } from "./rendererTypes";

type ColorRgba = [number, number, number, number];

type ColorRenderer = Pick<RendererApi, "setPageBackgroundColor" | "setVectorColorOverride">;

type AsyncOrSync = void | Promise<void>;

export interface UiControlElements {
  panOptimizationToggle: HTMLInputElement;
  segmentMergeToggle: HTMLInputElement;
  invisibleCullToggle: HTMLInputElement;
  strokeCurveToggle: HTMLInputElement;
  vectorTextOnlyToggle: HTMLInputElement;
  webGpuToggle: HTMLInputElement;
  maxPagesPerRowInput: HTMLInputElement;
  pageBackgroundColorInput: HTMLInputElement;
  pageBackgroundOpacitySlider: HTMLInputElement;
  pageBackgroundOpacityInput: HTMLInputElement;
  vectorColorInput: HTMLInputElement;
  vectorOpacitySlider: HTMLInputElement;
  vectorOpacityInput: HTMLInputElement;
}

export interface UiControlCallbacks {
  onPanOptimizationChange(enabled: boolean): void;
  onSegmentMergeChange(): AsyncOrSync;
  onInvisibleCullChange(): AsyncOrSync;
  onStrokeCurveChange(enabled: boolean): void;
  onVectorTextOnlyChange(enabled: boolean): void;
  onMaxPagesPerRowChange(maxPagesPerRow: number): AsyncOrSync;
  onWebGpuToggleChange(enabled: boolean): AsyncOrSync;
}

export interface UiControlManager {
  bindEventListeners(callbacks: UiControlCallbacks): void;
  readMaxPagesPerRowInput(): number;
  readPageBackgroundColorInput(): ColorRgba;
  readVectorColorOverrideInput(): ColorRgba;
  applyPageBackgroundColorFromControls(): void;
  applyVectorColorOverrideFromControls(): void;
  syncMaxPagesPerRowInputValue(): void;
}

export function createUiControlManager(
  elements: UiControlElements,
  getRenderer: () => ColorRenderer
): UiControlManager {
  function readMaxPagesPerRowInput(): number {
    const parsed = Math.trunc(Number(elements.maxPagesPerRowInput.value));
    if (!Number.isFinite(parsed)) {
      return 10;
    }
    return clamp(parsed, 1, 100);
  }

  function readPageBackgroundOpacityPercent(value: string): number {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed)) {
      return 100;
    }
    return clamp(parsed, 0, 100);
  }

  function readVectorOpacityPercent(value: string): number {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return clamp(parsed, 0, 100);
  }

  function setPageBackgroundOpacityControls(opacityPercent: number): void {
    const normalized = clamp(Math.trunc(opacityPercent), 0, 100);
    elements.pageBackgroundOpacityInput.value = String(normalized);
    elements.pageBackgroundOpacitySlider.value = String(normalized);
  }

  function setVectorOpacityControls(opacityPercent: number): void {
    const normalized = clamp(Math.trunc(opacityPercent), 0, 100);
    elements.vectorOpacityInput.value = String(normalized);
    elements.vectorOpacitySlider.value = String(normalized);
  }

  function readPageBackgroundColorInput(): ColorRgba {
    const hex = elements.pageBackgroundColorInput.value || "#ffffff";
    const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
    const opacityPercent = readPageBackgroundOpacityPercent(elements.pageBackgroundOpacityInput.value);
    setPageBackgroundOpacityControls(opacityPercent);
    const alpha = opacityPercent / 100;
    if (!match) {
      return [1, 1, 1, alpha];
    }

    const packed = Number.parseInt(match[1], 16);
    if (!Number.isFinite(packed)) {
      return [1, 1, 1, alpha];
    }

    const red = ((packed >> 16) & 0xff) / 255;
    const green = ((packed >> 8) & 0xff) / 255;
    const blue = (packed & 0xff) / 255;
    return [red, green, blue, alpha];
  }

  function readVectorColorOverrideInput(): ColorRgba {
    const hex = elements.vectorColorInput.value || "#000000";
    const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
    const opacityPercent = readVectorOpacityPercent(elements.vectorOpacityInput.value);
    setVectorOpacityControls(opacityPercent);
    const opacity = opacityPercent / 100;
    if (!match) {
      return [0, 0, 0, opacity];
    }

    const packed = Number.parseInt(match[1], 16);
    if (!Number.isFinite(packed)) {
      return [0, 0, 0, opacity];
    }

    const red = ((packed >> 16) & 0xff) / 255;
    const green = ((packed >> 8) & 0xff) / 255;
    const blue = (packed & 0xff) / 255;
    return [red, green, blue, opacity];
  }

  function applyPageBackgroundColorFromControls(): void {
    const pageBackgroundColor = readPageBackgroundColorInput();
    getRenderer().setPageBackgroundColor(
      pageBackgroundColor[0],
      pageBackgroundColor[1],
      pageBackgroundColor[2],
      pageBackgroundColor[3]
    );
  }

  function applyVectorColorOverrideFromControls(): void {
    const vectorColorOverride = readVectorColorOverrideInput();
    getRenderer().setVectorColorOverride(
      vectorColorOverride[0],
      vectorColorOverride[1],
      vectorColorOverride[2],
      vectorColorOverride[3]
    );
  }

  function syncMaxPagesPerRowInputValue(): void {
    elements.maxPagesPerRowInput.value = String(readMaxPagesPerRowInput());
  }

  function bindEventListeners(callbacks: UiControlCallbacks): void {
    elements.panOptimizationToggle.addEventListener("change", () => {
      callbacks.onPanOptimizationChange(elements.panOptimizationToggle.checked);
    });

    elements.segmentMergeToggle.addEventListener("change", () => {
      void callbacks.onSegmentMergeChange();
    });

    elements.invisibleCullToggle.addEventListener("change", () => {
      void callbacks.onInvisibleCullChange();
    });

    elements.strokeCurveToggle.addEventListener("change", () => {
      callbacks.onStrokeCurveChange(elements.strokeCurveToggle.checked);
    });

    elements.vectorTextOnlyToggle.addEventListener("change", () => {
      callbacks.onVectorTextOnlyChange(elements.vectorTextOnlyToggle.checked);
    });

    elements.pageBackgroundColorInput.addEventListener("input", () => {
      applyPageBackgroundColorFromControls();
    });

    elements.pageBackgroundOpacitySlider.addEventListener("input", () => {
      const opacityPercent = readPageBackgroundOpacityPercent(elements.pageBackgroundOpacitySlider.value);
      setPageBackgroundOpacityControls(opacityPercent);
      applyPageBackgroundColorFromControls();
    });

    elements.pageBackgroundOpacityInput.addEventListener("input", () => {
      const opacityPercent = readPageBackgroundOpacityPercent(elements.pageBackgroundOpacityInput.value);
      setPageBackgroundOpacityControls(opacityPercent);
      applyPageBackgroundColorFromControls();
    });

    elements.vectorColorInput.addEventListener("input", () => {
      applyVectorColorOverrideFromControls();
    });

    elements.vectorOpacitySlider.addEventListener("input", () => {
      const opacityPercent = readVectorOpacityPercent(elements.vectorOpacitySlider.value);
      setVectorOpacityControls(opacityPercent);
      applyVectorColorOverrideFromControls();
    });

    elements.vectorOpacityInput.addEventListener("input", () => {
      const opacityPercent = readVectorOpacityPercent(elements.vectorOpacityInput.value);
      setVectorOpacityControls(opacityPercent);
      applyVectorColorOverrideFromControls();
    });

    elements.maxPagesPerRowInput.addEventListener("change", () => {
      const maxPagesPerRow = readMaxPagesPerRowInput();
      elements.maxPagesPerRowInput.value = String(maxPagesPerRow);
      void callbacks.onMaxPagesPerRowChange(maxPagesPerRow);
    });

    elements.webGpuToggle.addEventListener("change", () => {
      void callbacks.onWebGpuToggleChange(elements.webGpuToggle.checked);
    });
  }

  return {
    bindEventListeners,
    readMaxPagesPerRowInput,
    readPageBackgroundColorInput,
    readVectorColorOverrideInput,
    applyPageBackgroundColorFromControls,
    applyVectorColorOverrideFromControls,
    syncMaxPagesPerRowInputValue
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
