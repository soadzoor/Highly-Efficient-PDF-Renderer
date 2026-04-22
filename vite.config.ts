import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  if (mode === "lib") {
    return {
      publicDir: false,
      build: {
        lib: {
          entry: resolve(__dirname, "src/index.ts"),
          formats: ["es"],
          fileName: "index"
        },
        outDir: "dist/lib",
        emptyOutDir: false,
        rollupOptions: {
          external: ["three"]
        }
      }
    };
  }

  return {
    // Use relative asset URLs so builds work when hosted from a repo subpath on GitHub Pages.
    base: "./",
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          three: resolve(__dirname, "three-example.html")
        }
      }
    }
  };
});
