import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: `${root}/dist-electron-renderer`,
    emptyOutDir: true,
  },
});
