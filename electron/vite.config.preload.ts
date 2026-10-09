// Configures the Electron preload bundle.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    target: "node22",
    outDir: `${root}/dist-electron`,
    emptyOutDir: false,
    lib: {
      entry: `${root}/electron/preload.ts`,
      formats: ["cjs"],
      fileName: () => "preload.cjs",
    },
    rolldownOptions: {
      external: [/^node:/, "electron"],
    },
  },
});
