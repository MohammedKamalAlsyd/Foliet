import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "fixtures",
);

export const SAMPLE_1PAGE_PATH = path.join(FIXTURES_DIR, "sample-1page.pdf");
export const SAMPLE_2PAGE_PATH = path.join(FIXTURES_DIR, "sample-2page.pdf");

let cachedPdfjs: any | null = null;

async function getPdfjsLegacy(): Promise<any> {
  if (cachedPdfjs) return cachedPdfjs;
  const require = createRequire(import.meta.url);
  const reactPdfEntry = require.resolve("react-pdf");
  const legacyPath = createRequire(reactPdfEntry).resolve(
    "pdfjs-dist/legacy/build/pdf.mjs",
  );
  cachedPdfjs = await import("file:///" + legacyPath.replace(/\\/g, "/"));
  return cachedPdfjs;
}

export function readFixtureBytes(fixturePath: string): Uint8Array {
  const buf = fs.readFileSync(fixturePath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function loadPdfFixture(fixturePath: string): Promise<{
  bytes: Uint8Array;
  pdfProxy: any;
  destroy: () => Promise<void>;
}> {
  const bytes = readFixtureBytes(fixturePath);
  const pdfjs = await getPdfjsLegacy();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const pdfProxy = await loadingTask.promise;
  return {
    bytes,
    pdfProxy,
    destroy: async () => {
      await loadingTask.destroy();
    },
  };
}
