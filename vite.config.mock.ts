import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Vite config for running the frontend in a standard browser
// (accessibility audit / UI rendering) with a Tauri API mock.
export default defineConfig(() => ({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_OPENCODE_MOCK": JSON.stringify("true"),
    "import.meta.env.VITE_E2E": JSON.stringify(process.env.VITE_E2E === "true" ? "true" : "false"),
  },
  resolve: {
    alias: {
      "@tauri-apps/api/core": path.resolve(import.meta.dirname, "src/mock/tauri-mock.ts"),
      "@tauri-apps/api/event": path.resolve(import.meta.dirname, "src/mock/tauri-mock.ts"),
    },
  },
  server: {
    port: 1421,
    strictPort: true,
  },
}));
