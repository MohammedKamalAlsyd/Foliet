#!/usr/bin/env node
/**
 * Synchronizes the application version across:
 *   1. package.json
 *   2. src-tauri/tauri.conf.json
 *   3. src-tauri/Cargo.toml ([package].version)
 *
 * Usage:
 *   node scripts/bump-version.mjs <patch|minor|major|X.Y.Z>
 *   node scripts/bump-version.mjs --check
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const PACKAGE_JSON_PATH = path.join(rootDir, "package.json");
const TAURI_CONF_PATH = path.join(rootDir, "src-tauri", "tauri.conf.json");
const CARGO_TOML_PATH = path.join(rootDir, "src-tauri", "Cargo.toml");

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function readCargoPackageVersion(tomlText) {
  const match = tomlText.match(
    /(\[package\][\s\S]*?^\s*version\s*=\s*")([^"]+)(")/m,
  );
  if (!match) {
    throw new Error("Could not locate [package] version in src-tauri/Cargo.toml");
  }
  return match[2];
}

function replaceCargoPackageVersion(tomlText, nextVersion) {
  let replaced = false;
  const updated = tomlText.replace(
    /(\[package\][\s\S]*?^\s*version\s*=\s*")([^"]+)(")/m,
    (_full, prefix, _oldVersion, suffix) => {
      replaced = true;
      return `${prefix}${nextVersion}${suffix}`;
    },
  );
  if (!replaced) {
    throw new Error("Failed to update [package] version in src-tauri/Cargo.toml");
  }
  return updated;
}

function computeNextVersion(currentVersion, arg) {
  const cleaned = arg.replace(/^v/, "");
  if (SEMVER_RE.test(cleaned)) {
    return cleaned;
  }

  const parsed = currentVersion.match(SEMVER_RE);
  if (!parsed) {
    throw new Error(`Current package.json version is not valid semver: ${currentVersion}`);
  }
  const major = Number(parsed[1]);
  const minor = Number(parsed[2]);
  const patch = Number(parsed[3]);

  switch (arg) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(
        `Invalid version argument "${arg}". Expected patch, minor, major, or X.Y.Z`,
      );
  }
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "Usage: node scripts/bump-version.mjs <patch|minor|major|X.Y.Z|--check>",
    );
    process.exit(1);
  }

  const pkgRaw = fs.readFileSync(PACKAGE_JSON_PATH, "utf8");
  const tauriRaw = fs.readFileSync(TAURI_CONF_PATH, "utf8");
  const cargoRaw = fs.readFileSync(CARGO_TOML_PATH, "utf8");

  const pkgJson = JSON.parse(pkgRaw);
  const tauriJson = JSON.parse(tauriRaw);
  const cargoVersion = readCargoPackageVersion(cargoRaw);

  if (arg === "--check") {
    const versions = {
      "package.json": pkgJson.version,
      "src-tauri/tauri.conf.json": tauriJson.version,
      "src-tauri/Cargo.toml": cargoVersion,
    };
    const unique = new Set(Object.values(versions));
    if (unique.size !== 1) {
      console.error("Version mismatch detected across manifests:", versions);
      process.exit(1);
    }
    console.log(`All manifests synchronized at v${pkgJson.version}`);
    return;
  }

  const nextVersion = computeNextVersion(pkgJson.version, arg);

  pkgJson.version = nextVersion;
  tauriJson.version = nextVersion;

  const pkgEol = detectEol(pkgRaw);
  const tauriEol = detectEol(tauriRaw);

  const nextPkgRaw =
    JSON.stringify(pkgJson, null, 2).replace(/\n/g, pkgEol) +
    (pkgRaw.endsWith("\n") ? pkgEol : "");
  const nextTauriRaw =
    JSON.stringify(tauriJson, null, 2).replace(/\n/g, tauriEol) +
    (tauriRaw.endsWith("\n") ? tauriEol : "");
  const nextCargoRaw = replaceCargoPackageVersion(cargoRaw, nextVersion);

  fs.writeFileSync(PACKAGE_JSON_PATH, nextPkgRaw, "utf8");
  fs.writeFileSync(TAURI_CONF_PATH, nextTauriRaw, "utf8");
  fs.writeFileSync(CARGO_TOML_PATH, nextCargoRaw, "utf8");

  console.log(`Updated version to ${nextVersion} across:`);
  console.log("  - package.json");
  console.log("  - src-tauri/tauri.conf.json");
  console.log("  - src-tauri/Cargo.toml");
  console.log(`\nNext steps:\n  git commit -am "chore: release v${nextVersion}"\n  git tag v${nextVersion}\n  git push origin main --tags`);
}

main();
