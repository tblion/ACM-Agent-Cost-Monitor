// Configures the Electron main-process TypeScript bundle.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    target: "node22",
    outDir: `${root}/dist-electron`,
    emptyOutDir: true,
    lib: {
      entry: `${root}/electron/main.ts`,
      formats: ["es"],
      fileName: () => "main.js",
    },
    rolldownOptions: {
      external: [/^node:/, "electron"],
    },
  },
});
