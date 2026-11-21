#!/usr/bin/env node
/**
 * Builds an unsigned Windows x64 MSIX package for Microsoft Store submission
 * from the compiled Tauri release binary (`src-tauri/target/release/foliet.exe`).
 *
 * Environment variables (set these from Microsoft Partner Center -> Product Identity):
 *   MSIX_IDENTITY_NAME            e.g. "MohammedKamalAlsyd.Foliet"
 *   MSIX_PUBLISHER                e.g. "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
 *   MSIX_PUBLISHER_DISPLAY_NAME   e.g. "Mohammed Kamal Alsyd"
 *
 * Usage:
 *   1. Build release binary (Store mode disables external self-updater):
 *      VITE_STORE_BUILD=true pnpm tauri build --no-bundle
 *   2. Package MSIX:
 *      node scripts/build-msix.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const pkgJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
);
const rawVersion = String(pkgJson.version || "0.1.0").split("-")[0];
const versionParts = rawVersion.split(".").map((n) => Number.parseInt(n, 10) || 0);
while (versionParts.length < 3) versionParts.push(0);
// Microsoft Store requires a 4-part version with the 4th segment reserved as 0
const msixVersion = `${versionParts[0]}.${versionParts[1]}.${versionParts[2]}.0`;

const identityName =
  process.env.MSIX_IDENTITY_NAME?.trim() || "MohammedKamalAlsyd.Foliet";
const publisher =
  process.env.MSIX_PUBLISHER?.trim() || "CN=MohammedKamalAlsyd";
const publisherDisplayName =
  process.env.MSIX_PUBLISHER_DISPLAY_NAME?.trim() || "Mohammed Kamal Alsyd";

const usingPlaceholderPublisher = !process.env.MSIX_PUBLISHER?.trim();

function xmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function findMakeAppx() {
  if (process.env.MAKEAPPX_PATH && fs.existsSync(process.env.MAKEAPPX_PATH)) {
    return process.env.MAKEAPPX_PATH;
  }

  const kitsBinDir = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  if (fs.existsSync(kitsBinDir)) {
    const versions = fs
      .readdirSync(kitsBinDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    for (const ver of versions) {
      const candidate = path.join(kitsBinDir, ver, "x64", "makeappx.exe");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return "makeappx.exe";
}

function main() {
  if (process.platform !== "win32") {
    console.error("MSIX packaging requires Windows (MakeAppx.exe).");
    process.exit(1);
  }

  const releaseDir = path.join(rootDir, "src-tauri", "target", "release");
  const exePath = path.join(releaseDir, "foliet.exe");
  if (!fs.existsSync(exePath)) {
    console.error(
      `Missing compiled binary: ${exePath}\nRun: VITE_STORE_BUILD=true pnpm tauri build --no-bundle`,
    );
    process.exit(1);
  }

  const templatePath = path.join(
    rootDir,
    "src-tauri",
    "msix",
    "AppxManifest.template.xml",
  );
  const assetsSrcDir = path.join(rootDir, "src-tauri", "msix", "Assets");
  const bundleDir = path.join(releaseDir, "bundle", "msix");
  const stageDir = path.join(bundleDir, "stage");
  const outMsix = path.join(bundleDir, `foliet_${rawVersion}_x64.msix`);

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(stageDir, "Assets"), { recursive: true });

  // Copy main executable and any sibling runtime DLLs (e.g. WebView2Loader / ONNX)
  fs.copyFileSync(exePath, path.join(stageDir, "foliet.exe"));
  for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".dll")) {
      fs.copyFileSync(
        path.join(releaseDir, entry.name),
        path.join(stageDir, entry.name),
      );
    }
  }

  // Copy MSIX Store visual assets
  if (!fs.existsSync(assetsSrcDir)) {
    console.error(`Missing MSIX Assets directory: ${assetsSrcDir}`);
    process.exit(1);
  }
  for (const entry of fs.readdirSync(assetsSrcDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
      fs.copyFileSync(
        path.join(assetsSrcDir, entry.name),
        path.join(stageDir, "Assets", entry.name),
      );
    }
  }

  // Render AppxManifest.xml
  const template = fs.readFileSync(templatePath, "utf8");
  const manifest = template
    .replace(/__IDENTITY_NAME__/g, xmlEscape(identityName))
    .replace(/__PUBLISHER__/g, xmlEscape(publisher))
    .replace(/__PUBLISHER_DISPLAY_NAME__/g, xmlEscape(publisherDisplayName))
    .replace(/__VERSION__/g, xmlEscape(msixVersion));

  fs.writeFileSync(path.join(stageDir, "AppxManifest.xml"), manifest, "utf8");

  const makeAppx = findMakeAppx();
  console.log(`Packing MSIX (${msixVersion}) with: ${makeAppx}`);
  console.log(`  Identity Name: ${identityName}`);
  console.log(`  Publisher:     ${publisher}`);
  if (usingPlaceholderPublisher) {
    console.warn(
      "  Warning: MSIX_PUBLISHER env var is not set. Before uploading to Microsoft Partner Center,\n" +
        "           set MSIX_IDENTITY_NAME, MSIX_PUBLISHER, and MSIX_PUBLISHER_DISPLAY_NAME from Partner Center.",
    );
  }

  execFileSync(makeAppx, ["pack", "/v", "/o", "/d", stageDir, "/p", outMsix], {
    stdio: "inherit",
  });

  console.log(`\nMSIX package created: ${outMsix}`);
}

main();
