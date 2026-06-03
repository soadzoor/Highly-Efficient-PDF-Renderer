import type { RendererApi } from "./rendererTypes";
import type { VectorLodMode } from "./vectorStrokeLodCore";

type ColorRgba = [number, number, number, number];

type ColorRenderer = Pick<RendererApi, "setPageBackgroundColor" | "setVectorColorOverride">;

export interface UiControlElements {
  panOptimizationToggle: HTMLInputElement;
  vectorLodSelect: HTMLSelectElement;
  pageBackgroundColorInput: HTMLInputElement;
  pageBackgroundOpacitySlider: HTMLInputElement;
  pageBackgroundOpacityInput: HTMLInputElement;
  vectorColorInput: HTMLInputElement;
  vectorOpacitySlider: HTMLInputElement;
  vectorOpacityInput: HTMLInputElement;
}

export interface UiControlCallbacks {
  onVectorLodModeChange(mode: VectorLodMode): void;
  onPanOptimizationChange(enabled: boolean): void;
}

export interface UiControlManager {
  bindEventListeners(callbacks: UiControlCallbacks): void;
  readVectorLodModeInput(): VectorLodMode;
  readPanOptimizationInput(): boolean;
  readPageBackgroundColorInput(): ColorRgba;
  readVectorColorOverrideInput(): ColorRgba;
  applyPageBackgroundColorFromControls(): void;
  applyVectorColorOverrideFromControls(): void;
}

export function createUiControlManager(
  elements: UiControlElements,
  getRenderer: () => ColorRenderer
): UiControlManager {
  function readVectorLodModeInput(): VectorLodMode {
    const value = elements.vectorLodSelect.value;
    return value === "off" || value === "force" ? value : "auto";
  }

  function readPanOptimizationInput(): boolean {
    return elements.panOptimizationToggle.checked;
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

  function bindEventListeners(callbacks: UiControlCallbacks): void {
    elements.vectorLodSelect.addEventListener("change", () => {
      callbacks.onVectorLodModeChange(readVectorLodModeInput());
    });

    elements.panOptimizationToggle.addEventListener("change", () => {
      callbacks.onPanOptimizationChange(readPanOptimizationInput());
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
  }

  return {
    bindEventListeners,
    readVectorLodModeInput,
    readPanOptimizationInput,
    readPageBackgroundColorInput,
    readVectorColorOverrideInput,
    applyPageBackgroundColorFromControls,
    applyVectorColorOverrideFromControls
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
