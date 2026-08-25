import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  if (mode === "lib") {
    return {
      // Keep worker chunks relative to the package entry so consumers do not
      // accidentally request them from the host application's root.
      base: "./",
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
          external: (id) => id === "three" || id.startsWith("three/")
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
          three: resolve(__dirname, "three-example.html"),
          roomOverlay: resolve(__dirname, "room-overlay-demo.html")
        }
      }
    }
  };
});
