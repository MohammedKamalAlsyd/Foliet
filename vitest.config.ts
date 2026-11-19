import path from "node:path";
import { createRequire } from "node:module";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const reactPdfEntry = require.resolve("react-pdf");
const pdfWorkerPath = createRequire(reactPdfEntry).resolve(
  "pdfjs-dist/build/pdf.worker.min.mjs",
);
const pdfjsDistDir = path.dirname(path.dirname(pdfWorkerPath));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "pdfjs-dist": pdfjsDistDir,
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.test.{ts,tsx}"],
    css: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
