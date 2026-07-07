// Performance diagnostics for comparing the native demos with the three.js
// example (the demo pages enable it when loaded with `?perf` in the URL).
// Library code only records numbers (and emits bake lifecycle events) when
// enabled, so applications that never enable it stay silent.

interface HeprPerfState {
  enabled: boolean;

  // Per-frame CPU spent inside HeprThreePdfObject.syncBeforeRender.
  syncMsTotal: number;
  syncMsMax: number;
  syncSamples: number;

  // Last applied direct-text draw shape (single pdf object assumed).
  textRangeMeshCount: number;
  textInstancesDrawn: number;

  noteSync(ms: number): void;
  drainSync(): { avgMs: number; maxMs: number; samples: number };
  event(name: string, data?: Record<string, unknown>): void;
}

export const heprPerf: HeprPerfState = {
  enabled: false,

  syncMsTotal: 0,
  syncMsMax: 0,
  syncSamples: 0,

  textRangeMeshCount: 0,
  textInstancesDrawn: 0,

  noteSync(ms: number): void {
    if (!this.enabled) {
      return;
    }
    this.syncMsTotal += ms;
    this.syncMsMax = Math.max(this.syncMsMax, ms);
    this.syncSamples += 1;
  },

  drainSync(): { avgMs: number; maxMs: number; samples: number } {
    const result = {
      avgMs: this.syncSamples > 0 ? this.syncMsTotal / this.syncSamples : 0,
      maxMs: this.syncMsMax,
      samples: this.syncSamples
    };
    this.syncMsTotal = 0;
    this.syncMsMax = 0;
    this.syncSamples = 0;
    return result;
  },

  event(name: string, data?: Record<string, unknown>): void {
    if (!this.enabled) {
      return;
    }
    console.log(`[HEPR-PERF] ${name}`, data ?? {});
  }
};
