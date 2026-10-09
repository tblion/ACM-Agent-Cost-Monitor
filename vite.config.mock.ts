// Configures the renderer for browser development with deterministic demo data.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => ({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_OPENCODE_MOCK": JSON.stringify("true"),
    "import.meta.env.VITE_E2E": JSON.stringify(process.env.VITE_E2E === "true" ? "true" : "false"),
  },
  server: {
    port: 1421,
    strictPort: true,
  },
}));
