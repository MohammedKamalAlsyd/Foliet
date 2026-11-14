import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import { createRequire } from "node:module";

const host = process.env.TAURI_DEV_HOST;
const require = createRequire(import.meta.url);
const reactPdfEntry = require.resolve("react-pdf");
const pdfWorkerPath = createRequire(reactPdfEntry).resolve(
  "pdfjs-dist/build/pdf.worker.min.mjs",
);
const pdfjsDistDir = path.dirname(path.dirname(pdfWorkerPath));



export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "pdfjs-dist": pdfjsDistDir,
    },
  },
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
