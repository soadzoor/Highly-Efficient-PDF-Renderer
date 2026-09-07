import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  if (mode === "lib") {
    return {
      worker: { format: "es" },
      // Keep worker chunks relative to the package entry so consumers do not
      // accidentally request them from the host application's root.
      base: "./",
      publicDir: false,
      build: {
        lib: {
          entry: {
            index: resolve(__dirname, "src/index.ts"),
            node: resolve(__dirname, "src/nodePdfSource.ts"),
            "dense-pdf-worker": resolve(__dirname, "src/densePdfNodeWorkerEntry.ts"),
            "pdf-worker": resolve(__dirname, "src/pdf/pdfWorkerEntry.ts")
          },
          formats: ["es"],
          fileName: (_format, entryName) => `${entryName}.js`
        },
        outDir: "dist/lib",
        emptyOutDir: false,
        rollupOptions: {
          external: (id) => id === "three" || id.startsWith("three/")
        }
      }
    };
  }

  return {
    worker: { format: "es" },
    // Use relative asset URLs so builds work when hosted from a repo subpath on GitHub Pages.
    base: "./",
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          three: resolve(__dirname, "three-example.html"),
          roomOverlay: resolve(__dirname, "room-overlay-demo.html")
        }
      }
    }
  };
});
