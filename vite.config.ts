import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { shaderCommentCompactionPlugin } from "./scripts/lib/compactShaderComments.mjs";

export default defineConfig(({ mode }) => {
  const sourceDir = `${resolve(import.meta.dirname, "src")}/`;
  if (mode === "lib") {
    return {
      plugins: [shaderCommentCompactionPlugin(sourceDir)],
      worker: { format: "es", plugins: () => [shaderCommentCompactionPlugin(sourceDir)] },
      // Keep worker chunks relative to the package entry so consumers do not
      // accidentally request them from the host application's root.
      base: "./",
      publicDir: false,
      build: {
        lib: {
          entry: {
            index: resolve(import.meta.dirname, "src/index.ts"),
            node: resolve(import.meta.dirname, "src/nodePdfSource.ts"),
            "pdf-to-hep-runtime": resolve(import.meta.dirname, "src/pdfToHepRuntime.ts"),
            "pdf-worker": resolve(import.meta.dirname, "src/pdf/pdfWorkerEntry.ts")
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
    plugins: [shaderCommentCompactionPlugin(sourceDir), {
      name: "package-version-label",
      transformIndexHtml(html) {
        const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"));
        return html.replaceAll("%HEPR_PACKAGE_VERSION%", version);
      }
    }],
    worker: { format: "es", plugins: () => [shaderCommentCompactionPlugin(sourceDir)] },
    // Use relative asset URLs so builds work when hosted from a repo subpath on GitHub Pages.
    base: "./",
    build: {
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, "index.html"),
          three: resolve(import.meta.dirname, "three-example.html"),
          roomOverlay: resolve(import.meta.dirname, "room-overlay-demo.html")
        }
      }
    }
  };
});
