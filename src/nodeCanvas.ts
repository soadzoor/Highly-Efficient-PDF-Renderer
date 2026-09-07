interface NodeCanvasProcess {
  readonly versions?: { readonly node?: string };
  getBuiltinModule?: (id: "module") => {
    createRequire: (url: string) => (specifier: string) => unknown;
  };
}

/** Load the optional native backend only when a Node raster operation needs it. */
export function loadNodeCanvas(): unknown {
  const nodeProcess = (globalThis as { readonly process?: NodeCanvasProcess }).process;
  if (!nodeProcess?.versions?.node) {
    return null;
  }
  if (typeof nodeProcess.getBuiltinModule !== "function") {
    throw new Error("HEPR Node.js raster operations require Node.js 22.13 or newer.");
  }

  try {
    // A runtime-created require keeps native addons out of consumer bundles,
    // including after minification. No bundler-specific ignore comment is needed.
    const requireCanvas = nodeProcess.getBuiltinModule("module").createRequire(import.meta.url);
    return requireCanvas("@napi-rs/canvas");
  } catch (cause) {
    throw new Error(
      'Unable to load the optional Node.js canvas backend. Install it with "npm install @napi-rs/canvas".',
      { cause }
    );
  }
}
