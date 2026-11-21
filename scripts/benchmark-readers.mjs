#!/usr/bin/env node
/**
 * Foliet Cross-Reader & Engine Performance Benchmark Suite
 *
 * Benchmarks:
 *   1. Cross-reader desktop comparison (auto-discovers installed readers):
 *      - Foliet (Tauri v2 / Rust + PDF.js)
 *      - Microsoft Edge (PDFium)
 *      - Google Chrome / Chromium (PDFium)
 *      - Mozilla Firefox (PDF.js)
 *      - Okular (Poppler)
 *      - SumatraPDF (MuPDF)
 *      - Evince (Poppler)
 *      Measures: cold launch to window (ms), full process-tree settled & peak
 *      RAM (MB), total process-tree CPU time (ms), and binary footprint (MB)
 *      across generated 10-page, 100-page, and 500-page PDFs.
 *
 *   2. Foliet internal engine micro-benchmarks (runs anywhere, including headless CI):
 *      - Smart PDF Dark Mode pixel classifier (ms/page across 4 page archetypes)
 *      - Prompt Context Token Compressor (tokens saved % & ms across 10p/100p/500p)
 *      - HTTP 206 Byte-Range streaming I/O vs full-file Base64 IPC overhead
 *
 * Usage:
 *   node scripts/benchmark-readers.mjs
 *   node scripts/benchmark-readers.mjs --engine-only
 *   node scripts/benchmark-readers.mjs --readers=foliet,edge,chrome,sumatra --sizes=10,100,500
 *   node scripts/benchmark-readers.mjs --foliet-bin=./src-tauri/target/release/foliet.exe
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

// ============================================================================
// CLI Argument Parsing
// ============================================================================
function parseArgs(argv) {
  const opts = {
    engineOnly: false,
    readers: null, // null = all detected readers
    sizes: [10, 100, 500],
    settleMs: 3500,
    folietBin: null,
    outDir: path.join(ROOT_DIR, "benchmarks", "results"),
  };

  for (const raw of argv) {
    if (raw === "--engine-only") {
      opts.engineOnly = true;
    } else if (raw.startsWith("--readers=")) {
      opts.readers = raw
        .slice("--readers=".length)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (raw.startsWith("--sizes=")) {
      const parsed = raw
        .slice("--sizes=".length)
        .split(",")
        .map((n) => Number.parseInt(n.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (parsed.length > 0) opts.sizes = parsed;
    } else if (raw.startsWith("--settle-ms=")) {
      const ms = Number.parseInt(raw.slice("--settle-ms=".length), 10);
      if (Number.isFinite(ms) && ms >= 500) opts.settleMs = ms;
    } else if (raw.startsWith("--foliet-bin=")) {
      opts.folietBin = path.resolve(raw.slice("--foliet-bin=".length));
    } else if (raw.startsWith("--out=")) {
      opts.outDir = path.resolve(raw.slice("--out=".length));
    }
  }
  return opts;
}

// ============================================================================
// 1. Valid ISO 32000-1 Synthetic Multi-Page PDF Generator
// ============================================================================
function escapePdfText(str) {
  return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function generateSyntheticPdf(pageCount, outputPath) {
  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length; // 1-based PDF object number
  };

  const catalogId = addObj(""); // placeholder 1
  const pagesId = addObj(""); // placeholder 2
  const fontId = addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );

  const pageIds = [];
  const sampleParagraphs = [
    "Dense semantic retrieval accelerates scholarly reading workflows by mapping multi-page academic manuscripts into compact 384-dimensional vectors.",
    "Asynchronous HTTP 206 byte-range streaming serves 256 KB PDF windows directly from local disk handles without full-file Base64 IPC serialization.",
    "Native ISO 32000-1 Form XObject appearance streams ensure highlights, underlines, and freehand strokes remain interoperable across external readers.",
    "Per-page pixel classification inspects downsampled luminance histograms in under one millisecond to preserve book covers and normalize aged scans.",
    "AES-256-GCM encrypted credential storage combines OS keyring master keys with random 12-byte nonces to keep provider API secrets protected at rest.",
  ];

  for (let p = 1; p <= pageCount; p++) {
    const lines = [
      "BT",
      "/F1 13 Tf",
      "54 748 Td",
      `(${escapePdfText(`Foliet Benchmark Monograph — Section ${Math.ceil(p / 10)} (Page ${p} of ${pageCount})`)}) Tj`,
      "/F1 9.5 Tf",
      "0 -24 Td",
      "13.5 TL",
    ];

    for (let row = 0; row < 44; row++) {
      const sentence = sampleParagraphs[(p + row) % sampleParagraphs.length];
      const text = `[p.${p} L${row + 1}] ${sentence.slice(0, 96)}`;
      lines.push(`(${escapePdfText(text)}) Tj T*`);
    }
    lines.push("ET");

    const streamStr = lines.join("\n");
    const streamLen = Buffer.byteLength(streamStr, "latin1");
    const contentId = addObj(
      `<< /Length ${streamLen} >>\nstream\n${streamStr}\nendstream`,
    );
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks = [Buffer.from("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n", "latin1")];
  let byteOffset = chunks[0].length;
  const xrefOffsets = [0];

  for (let i = 0; i < objects.length; i++) {
    xrefOffsets.push(byteOffset);
    const entry = Buffer.from(
      `${i + 1} 0 obj\n${objects[i]}\nendobj\n`,
      "latin1",
    );
    chunks.push(entry);
    byteOffset += entry.length;
  }

  const xrefStart = byteOffset;
  const xrefLines = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...xrefOffsets
      .slice(1)
      .map((off) => `${String(off).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>`,
    "startxref",
    String(xrefStart),
    "%%EOF\n",
  ];
  chunks.push(Buffer.from(xrefLines.join("\n"), "latin1"));

  const finalBuf = Buffer.concat(chunks);
  fs.writeFileSync(outputPath, finalBuf);
  return {
    pageCount,
    filePath: outputPath,
    sizeBytes: finalBuf.length,
    sizeMb: +(finalBuf.length / (1024 * 1024)).toFixed(2),
  };
}

// ============================================================================
// 2. Foliet Internal Engine Micro-Benchmarks
// ============================================================================
function makeSyntheticRgba(w, h, paintFn) {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paintFn(x, y, w, h);
      const i = (y * w + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function makeSyntheticExtractedDoc(pageCount) {
  const pages = [];
  for (let p = 1; p <= pageCount; p++) {
    pages.push(
      [
        `[Page ${p}]`,
        "Journal of Local-First Scholarly Computing  Vol. 14",
        `Section ${Math.ceil(p / 10)}: Dense Retrieval & Byte-Range Architecture`,
        "In-process quantized ONNX encoders reduce cold-start latency to 14 ms while keeping",
        "unpublished technical manu- scripts strictly offline on user workstations.",
        `Key finding (${p}): Storing normalized line bounding rectangles alongside overlapping`,
        "32-line windows preserves 98.4% NDCG@10 retrieval accuracy across arbitrary zoom scales.",
        "However, repeated running headers, pagination numbers, and trailing citation boilerplate",
        "often inflate prompt token counts unnecessarily during LLM chapter synthesis.",
        `Page ${p} of ${pageCount}`,
      ].join("\n"),
    );
  }
  pages.push(
    "\nReferences\n" +
      Array.from(
        { length: Math.min(80, pageCount) },
        (_, i) =>
          `[${i + 1}] Author, A. (2025). Retrieval benchmark study #${i + 1}. IEEE Transactions.`,
      ).join("\n"),
  );
  return pages.join("\n\n");
}

async function runEngineBenchmarks(generatedPdfs) {
  const { classifyPagePixels } = await import(
    pathToFileURL(path.join(ROOT_DIR, "src", "utils", "pdfDarkMode.ts")).href
  );
  const { compressDocumentText } = await import(
    pathToFileURL(path.join(ROOT_DIR, "src", "utils", "tokenCompressor.ts"))
      .href
  );

  // A. Smart PDF Dark Mode Pixel Classifier (72x96 probe canvas)
  const probeW = 72;
  const probeH = 96;
  const archetypes = [
    {
      name: "Digital white page",
      meta: { pageNumber: 4, textLength: 1400 },
      buf: makeSyntheticRgba(probeW, probeH, (x, y, w, h) =>
        x >= 8 && x < w - 8 && y >= 10 && y < h - 10 && y % 6 === 0
          ? [18, 18, 18]
          : [255, 255, 255],
      ),
    },
    {
      name: "Colorful Page 1 cover",
      meta: { pageNumber: 1, textLength: 40 },
      buf: makeSyntheticRgba(probeW, probeH, (_x, y, _w, h) => {
        const t = y / h;
        return [
          Math.round(40 + t * 180),
          Math.round(80 + (1 - t) * 70),
          Math.round(190 - t * 120),
        ];
      }),
    },
    {
      name: "Yellowed scanned textbook",
      meta: { pageNumber: 12, textLength: 0 },
      buf: makeSyntheticRgba(probeW, probeH, (x, y, w, h) =>
        x >= 8 && x < w - 8 && y >= 10 && y < h - 10 && y % 5 === 0
          ? [60, 54, 46]
          : [220, 207, 180],
      ),
    },
    {
      name: "Already-dark slide deck",
      meta: { pageNumber: 7, textLength: 260 },
      buf: makeSyntheticRgba(probeW, probeH, (x, y, w, h) =>
        x >= 8 && x < w - 8 && y >= 12 && y < h - 12 && y % 6 === 0
          ? [235, 235, 240]
          : [22, 24, 30],
      ),
    },
  ];

  // Warm up V8 JIT
  for (const a of archetypes) {
    for (let i = 0; i < 15; i++) classifyPagePixels(a.buf, probeW, probeH, a.meta);
  }

  const darkModeResults = archetypes.map((a) => {
    const runs = 150;
    const samples = [];
    let classification = "";
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const res = classifyPagePixels(a.buf, probeW, probeH, a.meta);
      samples.push(performance.now() - t0);
      classification = res.classification;
    }
    samples.sort((x, y) => x - y);
    const meanMs = samples.reduce((s, v) => s + v, 0) / samples.length;
    const p95Ms = samples[Math.floor(samples.length * 0.95)];
    return {
      archetype: a.name,
      classification,
      meanMs: +meanMs.toFixed(3),
      p95Ms: +p95Ms.toFixed(3),
      pagesPerSec: Math.round(1000 / Math.max(0.001, meanMs)),
    };
  });

  // B. Prompt Context Token Compressor
  const compressorResults = [10, 100, 500].map((pages) => {
    const raw = makeSyntheticExtractedDoc(pages);
    // Warm up once
    compressDocumentText(raw, { maxChars: 11500, stripReferences: true });
    const t0 = performance.now();
    const res = compressDocumentText(raw, {
      maxChars: 11500,
      stripReferences: true,
    });
    const elapsedMs = performance.now() - t0;
    return {
      pages,
      originalTokens: res.estimatedOriginalTokens,
      compressedTokens: res.estimatedCompressedTokens,
      savedPercent: res.savedPercent,
      elapsedMs: +elapsedMs.toFixed(2),
    };
  });

  // C. Byte-Range Streaming I/O vs Full-File Base64 IPC (on largest generated PDF)
  const largestPdf = generatedPdfs[generatedPdfs.length - 1];
  const chunkSize = 256 * 1024;
  const rangeOffsets = [
    0,
    Math.floor(largestPdf.sizeBytes * 0.25),
    Math.floor(largestPdf.sizeBytes * 0.5),
    Math.floor(largestPdf.sizeBytes * 0.75),
    Math.max(0, largestPdf.sizeBytes - chunkSize),
  ];

  // Simulate 5x HTTP 206 Range reads (initial trailer + first visible viewport)
  const tRange0 = performance.now();
  const fd = fs.openSync(largestPdf.filePath, "r");
  let totalRangeBytes = 0;
  const buf = Buffer.allocUnsafe(chunkSize);
  for (const offset of rangeOffsets) {
    const len = Math.min(chunkSize, Math.max(0, largestPdf.sizeBytes - offset));
    if (len > 0) {
      totalRangeBytes += fs.readSync(fd, buf, 0, len, offset);
    }
  }
  fs.closeSync(fd);
  const rangeMs = performance.now() - tRange0;

  // Simulate naive full-file read + Base64 IPC payload
  const tBase64_0 = performance.now();
  const fullBytes = fs.readFileSync(largestPdf.filePath);
  const b64Payload = fullBytes.toString("base64");
  const base64Ms = performance.now() - tBase64_0;

  return {
    darkModeResults,
    compressorResults,
    ioStreaming: {
      pdfPages: largestPdf.pageCount,
      pdfSizeMb: largestPdf.sizeMb,
      http206Ms: +rangeMs.toFixed(2),
      http206TransferredKb: Math.round(totalRangeBytes / 1024),
      fullBase64Ms: +base64Ms.toFixed(2),
      fullBase64PayloadKb: Math.round(Buffer.byteLength(b64Payload, "utf8") / 1024),
    },
  };
}

// ============================================================================
// 3. Cross-Reader Discovery & Isolated Process-Tree Benchmarking
// ============================================================================
function firstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function whichBinary(name) {
  try {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const out = execFileSync(cmd, [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return out && fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

function discoverReaders(opts) {
  const isWin = process.platform === "win32";
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const candidates = isWin
    ? [
        {
          id: "foliet",
          name: "Foliet",
          engine: "Tauri v2 / Rust + PDF.js",
          exe: firstExisting([
            opts.folietBin,
            path.join(ROOT_DIR, "src-tauri", "target", "release", "foliet.exe"),
            path.join(localAppData, "foliet", "foliet.exe"),
            path.join(programFiles, "foliet", "foliet.exe"),
          ]),
          buildArgs: (pdfPath) => [pdfPath],
        },
        {
          id: "edge",
          name: "Microsoft Edge",
          engine: "Chromium / PDFium",
          exe: firstExisting([
            path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
            path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
          ]),
          buildArgs: (pdfPath, profileDir) => [
            `--user-data-dir=${profileDir}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-sync",
            "--new-window",
            pathToFileURL(pdfPath).href,
          ],
        },
        {
          id: "chrome",
          name: "Google Chrome",
          engine: "Chromium / PDFium",
          exe: firstExisting([
            path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
            path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
            path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
          ]),
          buildArgs: (pdfPath, profileDir) => [
            `--user-data-dir=${profileDir}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-sync",
            "--new-window",
            pathToFileURL(pdfPath).href,
          ],
        },
        {
          id: "firefox",
          name: "Mozilla Firefox",
          engine: "Gecko / PDF.js",
          exe: firstExisting([
            path.join(programFiles, "Mozilla Firefox", "firefox.exe"),
            path.join(programFilesX86, "Mozilla Firefox", "firefox.exe"),
          ]),
          buildArgs: (pdfPath, profileDir) => [
            "-no-remote",
            "-profile",
            profileDir,
            pathToFileURL(pdfPath).href,
          ],
        },
        {
          id: "sumatra",
          name: "SumatraPDF",
          engine: "MuPDF (C)",
          exe: firstExisting([
            path.join(programFiles, "SumatraPDF", "SumatraPDF.exe"),
            path.join(localAppData, "SumatraPDF", "SumatraPDF.exe"),
            whichBinary("SumatraPDF.exe"),
          ]),
          buildArgs: (pdfPath) => ["-reuse-instance", pdfPath],
        },
        {
          id: "okular",
          name: "Okular",
          engine: "KDE / Poppler (C++)",
          exe: firstExisting([
            path.join(programFiles, "Okular", "bin", "okular.exe"),
            whichBinary("okular.exe"),
          ]),
          buildArgs: (pdfPath) => ["--unique", pdfPath],
        },
      ]
    : [
        {
          id: "foliet",
          name: "Foliet",
          engine: "Tauri v2 / Rust + PDF.js",
          exe: firstExisting([
            opts.folietBin,
            path.join(ROOT_DIR, "src-tauri", "target", "release", "foliet"),
            whichBinary("foliet"),
          ]),
          buildArgs: (pdfPath) => [pdfPath],
        },
        {
          id: "okular",
          name: "Okular",
          engine: "KDE / Poppler (C++)",
          exe: whichBinary("okular"),
          buildArgs: (pdfPath) => [pdfPath],
        },
        {
          id: "evince",
          name: "Evince",
          engine: "GNOME / Poppler (C)",
          exe: whichBinary("evince"),
          buildArgs: (pdfPath) => [pdfPath],
        },
        {
          id: "firefox",
          name: "Mozilla Firefox",
          engine: "Gecko / PDF.js",
          exe: whichBinary("firefox"),
          buildArgs: (pdfPath, profileDir) => [
            "-no-remote",
            "-profile",
            profileDir,
            pathToFileURL(pdfPath).href,
          ],
        },
        {
          id: "chrome",
          name: "Google Chrome / Chromium",
          engine: "Chromium / PDFium",
          exe:
            whichBinary("google-chrome") ||
            whichBinary("chromium") ||
            whichBinary("chromium-browser"),
          buildArgs: (pdfPath, profileDir) => [
            `--user-data-dir=${profileDir}`,
            "--no-first-run",
            "--disable-extensions",
            "--no-sandbox",
            pathToFileURL(pdfPath).href,
          ],
        },
      ];

  return candidates.filter((c) => {
    if (!c.exe) return false;
    if (opts.readers && !opts.readers.includes(c.id)) return false;
    return true;
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sampleProcessTreeWindows(rootPid) {
  const psScript = [
    `$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, KernelModeTime, UserModeTime`,
    `$byParent = @{}`,
    `foreach ($p in $all) { if (-not $byParent.ContainsKey($p.ParentProcessId)) { $byParent[$p.ParentProcessId] = @() }; $byParent[$p.ParentProcessId] += $p.ProcessId }`,
    `$queue = New-Object System.Collections.Queue`,
    `$seen = New-Object System.Collections.Generic.HashSet[int]`,
    `$queue.Enqueue(${rootPid}); [void]$seen.Add(${rootPid})`,
    `while ($queue.Count -gt 0) { $cur = $queue.Dequeue(); if ($byParent.ContainsKey($cur)) { foreach ($child in $byParent[$cur]) { if ($seen.Add($child)) { $queue.Enqueue($child) } } } }`,
    `$matched = $all | Where-Object { $seen.Contains([int]$_.ProcessId) }`,
    `$ws = ($matched | Measure-Object WorkingSetSize -Sum).Sum`,
    `$cpuTicks = (($matched | Measure-Object KernelModeTime -Sum).Sum + ($matched | Measure-Object UserModeTime -Sum).Sum)`,
    `$hasWin = $false`,
    `foreach ($pidItem in $seen) { try { $gp = Get-Process -Id $pidItem -ErrorAction Stop; if ($gp.MainWindowHandle -ne 0) { $hasWin = $true; break } } catch {} }`,
    `[PSCustomObject]@{ count = @($matched).Count; ramMb = [math]::Round($ws / 1MB, 1); cpuMs = [math]::Round($cpuTicks / 10000, 0); hasWindow = $hasWin } | ConvertTo-Json -Compress`,
  ].join("; ");

  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", psScript],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 6000 },
    ).trim();
    return JSON.parse(out);
  } catch {
    return { count: 0, ramMb: 0, cpuMs: 0, hasWindow: false };
  }
}

function sampleProcessTreeLinux(rootPid) {
  try {
    const entries = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n));
    const procs = new Map();
    for (const pidStr of entries) {
      try {
        const stat = fs.readFileSync(`/proc/${pidStr}/stat`, "utf8");
        const closeParen = stat.lastIndexOf(")");
        const rest = stat.slice(closeParen + 2).split(" ");
        const ppid = Number.parseInt(rest[1], 10);
        const utime = Number.parseInt(rest[11], 10) || 0;
        const stime = Number.parseInt(rest[12], 10) || 0;
        const status = fs.readFileSync(`/proc/${pidStr}/status`, "utf8");
        const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
        const rssKb = rssMatch ? Number.parseInt(rssMatch[1], 10) : 0;
        procs.set(Number.parseInt(pidStr, 10), { ppid, rssKb, ticks: utime + stime });
      } catch {
        // Process exited between readdir and readFile
      }
    }

    const seen = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, info] of procs.entries()) {
        if (seen.has(info.ppid) && !seen.has(pid)) {
          seen.add(pid);
          changed = true;
        }
      }
    }

    let count = 0;
    let totalRssKb = 0;
    let totalTicks = 0;
    for (const pid of seen) {
      const info = procs.get(pid);
      if (info) {
        count++;
        totalRssKb += info.rssKb;
        totalTicks += info.ticks;
      }
    }
    return {
      count,
      ramMb: +(totalRssKb / 1024).toFixed(1),
      cpuMs: Math.round((totalTicks / 100) * 1000),
      hasWindow: count > 0,
    };
  } catch {
    return { count: 0, ramMb: 0, cpuMs: 0, hasWindow: false };
  }
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: 5000,
      });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already exited
    }
  }
}

async function benchmarkSingleReader(reader, pdfInfo, settleMs) {
  const profileDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `foliet-bench-${reader.id}-`),
  );
  const args = reader.buildArgs(pdfInfo.filePath, profileDir);
  const binSizeMb = +(fs.statSync(reader.exe).size / (1024 * 1024)).toFixed(1);

  const t0 = performance.now();
  const child = spawn(reader.exe, args, {
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: false,
  });

  let windowReadyMs = null;
  let peakRamMb = 0;
  let settledSample = { count: 0, ramMb: 0, cpuMs: 0, hasWindow: false };
  let failed = false;

  child.on("error", () => {
    failed = true;
  });

  const sampleFn =
    process.platform === "win32"
      ? sampleProcessTreeWindows
      : sampleProcessTreeLinux;

  try {
    const deadline = performance.now() + 12000;
    while (!failed && performance.now() < deadline) {
      const sample = sampleFn(child.pid);
      if (sample.ramMb > peakRamMb) peakRamMb = sample.ramMb;
      if (sample.hasWindow && windowReadyMs === null) {
        windowReadyMs = Math.round(performance.now() - t0);
        break;
      }
      if (sample.count === 0 && performance.now() - t0 > 1500) break;
      await sleep(180);
    }

    // Wait for page rasterization & memory to settle while recording peak RAM
    const settleEnd = performance.now() + settleMs;
    while (!failed && performance.now() < settleEnd) {
      const sample = sampleFn(child.pid);
      if (sample.ramMb > peakRamMb) peakRamMb = sample.ramMb;
      settledSample = sample;
      await sleep(450);
    }
  } finally {
    killProcessTree(child.pid);
    await sleep(300);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Ignore locked temp profile files
    }
  }

  return {
    readerId: reader.id,
    readerName: reader.name,
    engine: reader.engine,
    pdfPages: pdfInfo.pageCount,
    pdfSizeMb: pdfInfo.sizeMb,
    binarySizeMb: binSizeMb,
    windowReadyMs: windowReadyMs ?? null,
    settledRamMb: settledSample.ramMb,
    peakRamMb: +peakRamMb.toFixed(1),
    processCount: settledSample.count,
    cpuMs: settledSample.cpuMs,
    ok: !failed && peakRamMb > 0,
  };
}

// ============================================================================
// 4. Markdown Report Builder
// ============================================================================
function buildMarkdownReport(report) {
  const lines = [
    "# Foliet Performance & Cross-Reader Benchmark Report",
    "",
    `- **Generated:** ${report.generatedAt}`,
    `- **Host OS:** ${report.system.platform} ${report.system.release} (${report.system.arch})`,
    `- **CPU:** ${report.system.cpuModel} (${report.system.cpuCores} cores)`,
    `- **System RAM:** ${report.system.totalRamGb} GB`,
    `- **Node.js:** ${report.system.nodeVersion}`,
    "",
    "---",
    "",
    "## 1. Cross-Reader Desktop Comparison",
    "",
  ];

  if (report.readerBenchmarks.length === 0) {
    lines.push(
      "_Cross-reader GUI benchmarks were skipped (`--engine-only` or no GUI PDF readers detected in this environment)._",
      "",
    );
  } else {
    lines.push(
      "> **Fair Process-Tree Methodology:** Every reader is launched cold with an isolated temporary user profile and measured across its **entire recursive process tree** (including WebView2 / Chromium renderer & GPU subprocesses).",
      "",
      "| PDF Reader | Rendering Engine | Test PDF | Launch → Window | Settled RAM | Peak RAM | Processes | CPU Time |",
      "| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |",
    );

    for (const r of report.readerBenchmarks) {
      const launch = r.windowReadyMs !== null ? `${r.windowReadyMs} ms` : "n/a";
      const statusSuffix = r.ok ? "" : " *(failed)*";
      lines.push(
        `| **${r.readerName}**${statusSuffix} | ${r.engine} | ${r.pdfPages}p (${r.pdfSizeMb} MB) | ${launch} | **${r.settledRamMb} MB** | ${r.peakRamMb} MB | ${r.processCount} | ${r.cpuMs} ms |`,
      );
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "## 2. Foliet Core Engine Micro-Benchmarks",
    "",
    "### A. Intelligent PDF Dark Mode Classifier (`src/utils/pdfDarkMode.ts`)",
    "",
    "| Page Archetype (72×96 probe) | Classification | Mean Latency | p95 Latency | Throughput |",
    "| :--- | :--- | ---: | ---: | ---: |",
  );

  for (const d of report.engine.darkModeResults) {
    lines.push(
      `| ${d.archetype} | \`${d.classification}\` | **${d.meanMs} ms** | ${d.p95Ms} ms | ${d.pagesPerSec.toLocaleString()} pages/s |`,
    );
  }

  lines.push(
    "",
    "### B. Prompt Context Token Compressor (`src/utils/tokenCompressor.ts`)",
    "",
    "| Document Length | Original Tokens | Compressed Tokens | Tokens Saved | Latency |",
    "| ---: | ---: | ---: | ---: | ---: |",
  );

  for (const c of report.engine.compressorResults) {
    lines.push(
      `| ${c.pages} pages | ${c.originalTokens.toLocaleString()} | **${c.compressedTokens.toLocaleString()}** | **-${c.savedPercent}%** | ${c.elapsedMs} ms |`,
    );
  }

  const io = report.engine.ioStreaming;
  lines.push(
    "",
    "### C. Byte-Range Streaming (`foliet-pdf://` HTTP 206) vs. Full-File Base64 IPC",
    "",
    "| Strategy (`" + `${io.pdfPages}-page / ${io.pdfSizeMb} MB PDF` + "`) | Payload Transferred | Latency |",
    "| :--- | ---: | ---: |",
    `| **HTTP 206 Byte-Range Streaming (5 × 256 KB)** | **${io.http206TransferredKb.toLocaleString()} KB** | **${io.http206Ms} ms** |`,
    `| Full-File Read + Base64 IPC Encoding | ${io.fullBase64PayloadKb.toLocaleString()} KB | ${io.fullBase64Ms} ms |`,
    "",
  );

  return lines.join("\n");
}

// ============================================================================
// Main Entrypoint
// ============================================================================
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(opts.outDir, { recursive: true });

  const tmpPdfDir = fs.mkdtempSync(path.join(os.tmpdir(), "foliet-bench-pdfs-"));
  const generatedPdfs = [];

  try {
    console.log("Generating synthetic ISO 32000-1 benchmark PDFs...");
    for (const pages of opts.sizes) {
      const pdfPath = path.join(tmpPdfDir, `foliet-bench-${pages}p.pdf`);
      const info = generateSyntheticPdf(pages, pdfPath);
      generatedPdfs.push(info);
      console.log(`  - ${pages} pages -> ${info.sizeMb} MB (${pdfPath})`);
    }

    console.log("\nRunning Foliet core engine micro-benchmarks...");
    const engine = await runEngineBenchmarks(generatedPdfs);

    const readerBenchmarks = [];
    if (!opts.engineOnly) {
      const readers = discoverReaders(opts);
      console.log(
        `\nDetected PDF readers (${readers.length}): ${readers.map((r) => r.name).join(", ") || "none"}`,
      );

      for (const reader of readers) {
        for (const pdfInfo of generatedPdfs) {
          console.log(
            `  Benchmarking ${reader.name} on ${pdfInfo.pageCount}p (${pdfInfo.sizeMb} MB)...`,
          );
          const result = await benchmarkSingleReader(
            reader,
            pdfInfo,
            opts.settleMs,
          );
          readerBenchmarks.push(result);
          console.log(
            `    -> window=${result.windowReadyMs ?? "n/a"}ms | settled=${result.settledRamMb}MB | peak=${result.peakRamMb}MB | procs=${result.processCount}`,
          );
        }
      }
    }

    const cpus = os.cpus();
    const report = {
      generatedAt: new Date().toISOString(),
      system: {
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
        cpuModel: cpus[0]?.model?.trim() || "Unknown CPU",
        cpuCores: cpus.length,
        totalRamGb: +(os.totalmem() / 1024 ** 3).toFixed(1),
        nodeVersion: process.version,
      },
      readerBenchmarks,
      engine,
    };

    const markdown = buildMarkdownReport(report);
    const mdPath = path.join(opts.outDir, "latest-benchmark.md");
    const jsonPath = path.join(opts.outDir, "latest-benchmark.json");
    fs.writeFileSync(mdPath, markdown, "utf8");
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, "utf8");
    }

    console.log(`\nBenchmark report written to:\n  - ${mdPath}\n  - ${jsonPath}\n`);
    console.log(markdown);
  } finally {
    try {
      fs.rmSync(tmpPdfDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
