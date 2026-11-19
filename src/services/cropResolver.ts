/**
 * Foliet - Shared Figure Crop Resolver & Bounded LRU Cache
 *
 * Centralizes resolution and caching of SQLite-backed `idb://` / `db://` / `crop-`
 * figure URIs across SummaryDocsEditor, summaryExport, PdfSidebar, chatTools,
 * and summaryUtils without pulling heavy UI or editor modules into the viewer bundle.
 */

import { DocumentDatabase } from "@/services/storage/database";

const MAX_CROP_CACHE_ENTRIES = 30;
const resolvedCropCache = new Map<string, string>();
const inFlightCrops = new Map<string, Promise<string | null>>();

const MARKDOWN_CROP_IMAGE_RE =
  /(!\[[^\]]*\]\()((?:idb|db):\/\/[^)\s]+)((?:\s+[^)]*)?\))/g;

function isDirectUrl(src: string): boolean {
  return (
    src.startsWith("data:") ||
    src.startsWith("http://") ||
    src.startsWith("https://")
  );
}

function isStoredCropUri(src: string): boolean {
  return (
    src.startsWith("idb://") ||
    src.startsWith("db://") ||
    src.startsWith("crop-")
  );
}

function normalizeCropCacheKey(key: string): string {
  return key.replace(/^(?:idb|db):\/\//, "").replace(/^(crop-)+/, "");
}

export function getCachedCrop(key: string): string | null {
  if (!key) return null;
  const normalized = normalizeCropCacheKey(key);
  const cached = resolvedCropCache.get(normalized);
  if (cached === undefined) return null;
  resolvedCropCache.delete(normalized);
  resolvedCropCache.set(normalized, cached);
  return cached;
}

function setCachedCrop(key: string, value: string): void {
  const normalized = normalizeCropCacheKey(key);
  if (resolvedCropCache.has(normalized)) {
    resolvedCropCache.delete(normalized);
  }
  resolvedCropCache.set(normalized, value);
  while (resolvedCropCache.size > MAX_CROP_CACHE_ENTRIES) {
    const oldestKey = resolvedCropCache.keys().next().value;
    if (oldestKey === undefined) break;
    resolvedCropCache.delete(oldestKey);
  }
}

export function clearResolvedCropCache(uriOrId?: string): void {
  if (!uriOrId) {
    resolvedCropCache.clear();
    return;
  }
  const normalized = normalizeCropCacheKey(uriOrId);
  resolvedCropCache.delete(normalized);
}

/**
 * Resolves an `idb://...`, `db://...`, or `crop-...` URI from SQLite
 * (backed by an in-memory LRU cache and in-flight deduplication),
 * or returns standard `data:` / `http(s):` URLs unchanged.
 */
export async function resolveCropImageSrc(src: string): Promise<string | null> {
  if (!src) return null;
  if (isDirectUrl(src)) return src;

  const cached = getCachedCrop(src);
  if (cached) return cached;

  if (!isStoredCropUri(src)) return null;

  const normalized = normalizeCropCacheKey(src);
  const pending = inFlightCrops.get(normalized);
  if (pending) return pending;

  const request = DocumentDatabase.getFigureCrop(src)
    .then((dataUrl) => {
      if (dataUrl) {
        setCachedCrop(normalized, dataUrl);
        return dataUrl;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      inFlightCrops.delete(normalized);
    });

  inFlightCrops.set(normalized, request);
  return request;
}

/**
 * Expands `idb://...` / `db://...` image links in exported Markdown to standalone
 * data URIs so exported `.md` files render figures in external Markdown viewers.
 */
export async function resolveMarkdownCropImages(
  markdown: string,
): Promise<string> {
  const uris = new Set<string>();
  for (const match of markdown.matchAll(MARKDOWN_CROP_IMAGE_RE)) {
    uris.add(match[2]);
  }
  if (uris.size === 0) return markdown;

  const resolvedMap = new Map<string, string>();
  await Promise.all(
    Array.from(uris).map(async (uri) => {
      const resolved = await resolveCropImageSrc(uri);
      if (resolved) {
        resolvedMap.set(uri, resolved);
      }
    }),
  );
  if (resolvedMap.size === 0) return markdown;

  return markdown.replace(
    MARKDOWN_CROP_IMAGE_RE,
    (full, prefix: string, uri: string, suffix: string) => {
      const resolved = resolvedMap.get(uri);
      return resolved ? `${prefix}${resolved}${suffix}` : full;
    },
  );
}
