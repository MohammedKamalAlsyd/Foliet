export type PdfDarkModeSetting = "smart" | "original" | "force";

export type PdfPageClassification =
  | "standard-light"
  | "scanned-paper"
  | "already-dark"
  | "cover-or-artwork";

export type PdfPageOverride = "auto" | "dark" | "original";

export interface PdfPageAnalysisMeta {
  pageNumber: number;
  /** Extracted text character count on this page, if available */
  textLength?: number;
}

export interface PdfPageMetrics {
  p10Lum: number;
  p50Lum: number;
  p80Lum: number;
  p95Lum: number;
  darkRatio: number;
  lightRatio: number;
  pureWhiteRatio: number;
  midtoneRatio: number;
  paperDominance: number;
  colorfulRatio: number;
  richColorRatio: number;
  borderLum: number;
  borderDarkRatio: number;
  borderColorfulness: number;
  borderVariance: number;
  paperCastSaturation: number;
}

export interface PdfPageAppearanceAnalysis {
  classification: PdfPageClassification;
  /** CSS filter applied in "smart" dark mode (undefined = no filter) */
  smartFilter: string | undefined;
  /** CSS filter applied when dark mode is forced on this page */
  forceFilter: string;
  /** True when the rendered surface in smart mode is dark (for highlight blend mode) */
  smartIsDarkSurface: boolean;
  /** Short human-readable label for page badge / tooltip */
  reasonLabel: string;
  /** True when a standard light page also contains noticeable colored figures/photos */
  hasEmbeddedMedia: boolean;
  metrics: PdfPageMetrics;
}

export interface ResolvedPdfPageAppearance {
  filter: string | undefined;
  isDarkSurface: boolean;
  isInverted: boolean;
  classification: PdfPageClassification;
  reasonLabel: string;
  isOverridden: boolean;
  hasEmbeddedMedia: boolean;
}

/**
 * Standard warm Graphite inversion for crisp digital white pages:
 * - Maps #FFFFFF paper -> ~#19191B (matches Foliet's Graphite surface)
 * - Maps #000000 ink   -> ~#DCDCDC (comfortable off-white without halation)
 * - Preserves hues of colored text, links, and charts via hue-rotate(180deg)
 */
export const STANDARD_DARK_PDF_FILTER =
  "invert(0.915) hue-rotate(180deg) contrast(0.96) brightness(0.96)";

/** Subtle glare reduction for colorful covers, photography, and artwork plates */
export const COVER_COMFORT_FILTER = "brightness(0.88) contrast(1.03)";

/** Subtle surface blend for slides/pages that are already dark */
export const ALREADY_DARK_FILTER = "brightness(0.96)";

const HISTOGRAM_BINS = 32;
const SAMPLE_MAX_DIM = 96;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentileFromHistogram(
  bins: Uint32Array,
  total: number,
  percentile: number,
): number {
  if (total <= 0) return 1;
  const target = total * percentile;
  let cumulative = 0;
  for (let i = 0; i < bins.length; i++) {
    cumulative += bins[i];
    if (cumulative >= target) {
      return (i + 0.5) / bins.length;
    }
  }
  return 1;
}

function buildScannedDarkFilter(metrics: PdfPageMetrics): string {
  const contrastSpread = Math.max(0.15, metrics.p80Lum - metrics.p10Lum);
  // Lift yellowed/grey scanned paper up to ~0.98 before inversion
  const preBrightness = round2(
    clamp(0.98 / Math.max(0.55, metrics.p80Lum), 1.04, 1.38),
  );
  // Expand washed-out pencil/photocopy ink contrast before inversion
  const preContrast = round2(
    clamp(1.18 + (0.75 - Math.min(0.75, contrastSpread)) * 0.7, 1.15, 1.55),
  );

  // Neutralize sepia/yellowed paper cast before inverting so paper never turns muddy cyan.
  // If the scan has notable colored diagrams/annotations, keep mild saturation instead of grayscale.
  const colorNormalization =
    metrics.colorfulRatio >= 0.14
      ? "saturate(0.65)"
      : metrics.paperCastSaturation > 0.045
        ? "grayscale(0.84)"
        : "grayscale(0.55)";

  return `${colorNormalization} brightness(${preBrightness}) contrast(${preContrast}) invert(0.91) hue-rotate(180deg) brightness(0.95)`;
}

export function createFallbackAnalysis(): PdfPageAppearanceAnalysis {
  return {
    classification: "standard-light",
    smartFilter: STANDARD_DARK_PDF_FILTER,
    forceFilter: STANDARD_DARK_PDF_FILTER,
    smartIsDarkSurface: true,
    reasonLabel: "Dark page",
    hasEmbeddedMedia: false,
    metrics: {
      p10Lum: 0.1,
      p50Lum: 0.98,
      p80Lum: 1,
      p95Lum: 1,
      darkRatio: 0.08,
      lightRatio: 0.9,
      pureWhiteRatio: 0.88,
      midtoneRatio: 0.02,
      paperDominance: 0.88,
      colorfulRatio: 0,
      richColorRatio: 0,
      borderLum: 1,
      borderDarkRatio: 0,
      borderColorfulness: 0,
      borderVariance: 0,
      paperCastSaturation: 0,
    },
  };
}

/**
 * Pure, deterministic classifier over an RGBA pixel buffer (downsampled page).
 * Handles digital white papers, yellowed/grey scanned pages, already-dark slides,
 * colorful covers, and full-bleed photographic/artwork pages.
 */
export function classifyPagePixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  meta: PdfPageAnalysisMeta = { pageNumber: 1 },
): PdfPageAppearanceAnalysis {
  const pixelCount = width * height;
  if (
    width < 4 ||
    height < 4 ||
    pixelCount <= 0 ||
    rgba.length < pixelCount * 4
  ) {
    return createFallbackAnalysis();
  }

  const histogram = new Uint32Array(HISTOGRAM_BINS);
  const borderMarginX = Math.max(1, Math.floor(width * 0.08));
  const borderMarginY = Math.max(1, Math.floor(height * 0.08));

  let opaqueCount = 0;
  let darkCount = 0;
  let lightCount = 0;
  let pureWhiteCount = 0;
  let midtoneCount = 0;
  let colorfulCount = 0;
  let richColorCount = 0;

  let borderCount = 0;
  let borderLumSum = 0;
  let borderLumSqSum = 0;
  let borderDarkCount = 0;
  let borderColorfulCount = 0;

  // Store lightweight luminance + saturation arrays for second-pass paper cast calculation
  const lums = new Float32Array(pixelCount);
  const sats = new Float32Array(pixelCount);
  const valid = new Uint8Array(pixelCount);

  for (let y = 0; y < height; y++) {
    const isBorderY = y < borderMarginY || y >= height - borderMarginY;
    for (let x = 0; x < width; x++) {
      const pIdx = y * width + x;
      const offset = pIdx * 4;
      const a = rgba[offset + 3];
      if (a < 16) continue;

      const r = rgba[offset] / 255;
      const g = rgba[offset + 1] / 255;
      const b = rgba[offset + 2] / 255;

      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const maxC = r > g ? (r > b ? r : b) : g > b ? g : b;
      const minC = r < g ? (r < b ? r : b) : g < b ? g : b;
      const sat = maxC > 0.001 ? (maxC - minC) / maxC : 0;

      valid[pIdx] = 1;
      lums[pIdx] = lum;
      sats[pIdx] = sat;
      opaqueCount++;

      const bin = Math.min(
        HISTOGRAM_BINS - 1,
        Math.max(0, Math.floor(lum * HISTOGRAM_BINS)),
      );
      histogram[bin]++;

      if (lum < 0.35) darkCount++;
      if (lum > 0.72) lightCount++;
      if (lum > 0.94 && sat < 0.05) pureWhiteCount++;
      if (lum >= 0.25 && lum <= 0.75) midtoneCount++;
      if (sat > 0.26 && maxC > 0.18) colorfulCount++;
      if (sat > 0.38 && maxC > 0.22) richColorCount++;

      const isBorder =
        isBorderY || x < borderMarginX || x >= width - borderMarginX;
      if (isBorder) {
        borderCount++;
        borderLumSum += lum;
        borderLumSqSum += lum * lum;
        if (lum < 0.38) borderDarkCount++;
        if (sat > 0.22 && maxC > 0.16) borderColorfulCount++;
      }
    }
  }

  if (opaqueCount < 16) {
    return createFallbackAnalysis();
  }

  const p10Lum = percentileFromHistogram(histogram, opaqueCount, 0.1);
  const p50Lum = percentileFromHistogram(histogram, opaqueCount, 0.5);
  const p80Lum = percentileFromHistogram(histogram, opaqueCount, 0.8);
  const p95Lum = percentileFromHistogram(histogram, opaqueCount, 0.95);

  // Measure concentration of pixels around the dominant paper tone (p80Lum +- 0.10)
  const p80Bin = Math.min(
    HISTOGRAM_BINS - 1,
    Math.max(0, Math.floor(p80Lum * HISTOGRAM_BINS)),
  );
  const bandRadius = 3; // ~ +/- 0.094 luminance
  let paperBandCount = 0;
  for (
    let i = Math.max(0, p80Bin - bandRadius);
    i <= Math.min(HISTOGRAM_BINS - 1, p80Bin + bandRadius);
    i++
  ) {
    paperBandCount += histogram[i];
  }
  const paperDominance = paperBandCount / opaqueCount;

  // Measure average saturation of bright paper pixels to catch sepia/yellowed scans
  const paperFloor = Math.max(0.5, p80Lum - 0.12);
  let paperSatSum = 0;
  let paperSatCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (valid[i] && lums[i] >= paperFloor) {
      paperSatSum += sats[i];
      paperSatCount++;
    }
  }
  const paperCastSaturation =
    paperSatCount > 0 ? paperSatSum / paperSatCount : 0;

  const darkRatio = darkCount / opaqueCount;
  const lightRatio = lightCount / opaqueCount;
  const pureWhiteRatio = pureWhiteCount / opaqueCount;
  const midtoneRatio = midtoneCount / opaqueCount;
  const colorfulRatio = colorfulCount / opaqueCount;
  const richColorRatio = richColorCount / opaqueCount;

  const borderLum = borderCount > 0 ? borderLumSum / borderCount : p80Lum;
  const borderDarkRatio = borderCount > 0 ? borderDarkCount / borderCount : 0;
  const borderColorfulness =
    borderCount > 0 ? borderColorfulCount / borderCount : 0;
  const borderVariance =
    borderCount > 0
      ? Math.sqrt(
          Math.max(0, borderLumSqSum / borderCount - borderLum * borderLum),
        )
      : 0;

  const metrics: PdfPageMetrics = {
    p10Lum,
    p50Lum,
    p80Lum,
    p95Lum,
    darkRatio,
    lightRatio,
    pureWhiteRatio,
    midtoneRatio,
    paperDominance,
    colorfulRatio,
    richColorRatio,
    borderLum,
    borderDarkRatio,
    borderColorfulness,
    borderVariance,
    paperCastSaturation,
  };

  const hasEmbeddedMedia = colorfulRatio > 0.08;
  const sparseText =
    meta.textLength === undefined ? true : meta.textLength < 100;

  // 1. Already-dark pages (dark slide decks, dark covers, dark diagrams) -> DO NOT INVERT
  const isAlreadyDark =
    p80Lum < 0.44 ||
    (darkRatio > 0.55 && lightRatio < 0.3) ||
    (borderDarkRatio > 0.65 && p50Lum < 0.42);

  if (isAlreadyDark) {
    return {
      classification: "already-dark",
      smartFilter: ALREADY_DARK_FILTER,
      forceFilter: STANDARD_DARK_PDF_FILTER,
      smartIsDarkSurface: true,
      reasonLabel: "Already dark",
      hasEmbeddedMedia,
      metrics,
    };
  }

  // 2. Book covers, full-bleed photography & colorful artwork plates -> DO NOT INVERT
  const isPageOneCover =
    meta.pageNumber === 1 &&
    ((colorfulRatio > 0.2 && pureWhiteRatio < 0.58) ||
      borderColorfulness > 0.28 ||
      (midtoneRatio > 0.45 && paperDominance < 0.42 && pureWhiteRatio < 0.3));

  const isFullBleedArtworkOrPhoto =
    (colorfulRatio > 0.32 && lightRatio < 0.55) ||
    (richColorRatio > 0.24 && pureWhiteRatio < 0.4) ||
    (borderColorfulness > 0.48 && pureWhiteRatio < 0.42) ||
    (midtoneRatio > 0.48 &&
      paperDominance < 0.4 &&
      pureWhiteRatio < 0.2 &&
      sparseText);

  if (isPageOneCover || isFullBleedArtworkOrPhoto) {
    return {
      classification: "cover-or-artwork",
      smartFilter: COVER_COMFORT_FILTER,
      forceFilter: STANDARD_DARK_PDF_FILTER,
      smartIsDarkSurface: p50Lum < 0.48,
      reasonLabel:
        meta.pageNumber === 1 ? "Cover preserved" : "Artwork preserved",
      hasEmbeddedMedia: true,
      metrics,
    };
  }

  // 3. Scanned / yellowed / greyish / noisy paper -> Adaptive normalization before inversion
  const isYellowedOrGreyScan =
    p80Lum >= 0.44 &&
    p80Lum <= 0.935 &&
    pureWhiteRatio < 0.28 &&
    (paperCastSaturation > 0.045 || borderVariance > 0.028 || p80Lum < 0.87);

  const isLowTextNoisyScan =
    meta.textLength !== undefined &&
    meta.textLength < 35 &&
    pureWhiteRatio < 0.45 &&
    (paperCastSaturation > 0.035 || borderVariance > 0.025 || p80Lum < 0.9);

  if (isYellowedOrGreyScan || isLowTextNoisyScan) {
    const scannedFilter = buildScannedDarkFilter(metrics);
    return {
      classification: "scanned-paper",
      smartFilter: scannedFilter,
      forceFilter: scannedFilter,
      smartIsDarkSurface: true,
      reasonLabel: "Scanned enhanced",
      hasEmbeddedMedia,
      metrics,
    };
  }

  // 4. Standard digital white-background page -> Warm Graphite dark inversion
  return {
    classification: "standard-light",
    smartFilter: STANDARD_DARK_PDF_FILTER,
    forceFilter: STANDARD_DARK_PDF_FILTER,
    smartIsDarkSurface: true,
    reasonLabel: hasEmbeddedMedia ? "Dark · media" : "Dark page",
    hasEmbeddedMedia,
    metrics,
  };
}

/**
 * Downsamples a rendered PDF.js canvas onto a tiny offscreen canvas (<1ms)
 * and classifies its visual characteristics for intelligent dark mode.
 * Never mutates the source canvas.
 */
export function analyzePdfCanvas(
  canvas: HTMLCanvasElement,
  meta: PdfPageAnalysisMeta,
): PdfPageAppearanceAnalysis {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
    return createFallbackAnalysis();
  }

  try {
    const aspect = canvas.width / canvas.height;
    let sampleW: number;
    let sampleH: number;
    if (aspect >= 1) {
      sampleW = Math.min(SAMPLE_MAX_DIM, canvas.width);
      sampleH = Math.max(8, Math.round(sampleW / aspect));
    } else {
      sampleH = Math.min(SAMPLE_MAX_DIM, canvas.height);
      sampleW = Math.max(8, Math.round(sampleH * aspect));
    }

    const probe = document.createElement("canvas");
    probe.width = sampleW;
    probe.height = sampleH;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    if (!ctx) return createFallbackAnalysis();

    ctx.drawImage(canvas, 0, 0, sampleW, sampleH);
    const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
    return classifyPagePixels(imgData.data, sampleW, sampleH, meta);
  } catch {
    return createFallbackAnalysis();
  }
}

/**
 * Resolves the final visual appearance for a PDF page given:
 * - App dark theme state (`isAppDark`)
 * - Global PDF dark mode setting (`setting`)
 * - Optional per-page override (`override`)
 * - Analyzed page characteristics (`analysis`, or null before initial render)
 */
export function resolvePdfPageAppearance(params: {
  isAppDark: boolean;
  setting: PdfDarkModeSetting;
  override: PdfPageOverride;
  analysis: PdfPageAppearanceAnalysis | null;
}): ResolvedPdfPageAppearance {
  const { isAppDark, setting, override, analysis } = params;
  const effectiveAnalysis = analysis ?? createFallbackAnalysis();

  if (!isAppDark || setting === "original") {
    return {
      filter: undefined,
      isDarkSurface:
        analysis?.classification === "already-dark"
          ? true
          : false,
      isInverted: false,
      classification: effectiveAnalysis.classification,
      reasonLabel: "Original",
      isOverridden: false,
      hasEmbeddedMedia: effectiveAnalysis.hasEmbeddedMedia,
    };
  }

  if (override === "original") {
    return {
      filter: undefined,
      isDarkSurface: effectiveAnalysis.classification === "already-dark",
      isInverted: false,
      classification: effectiveAnalysis.classification,
      reasonLabel: "Original (page)",
      isOverridden: true,
      hasEmbeddedMedia: effectiveAnalysis.hasEmbeddedMedia,
    };
  }

  if (override === "dark" || setting === "force") {
    const filter =
      effectiveAnalysis.classification === "scanned-paper"
        ? effectiveAnalysis.forceFilter
        : STANDARD_DARK_PDF_FILTER;
    return {
      filter,
      isDarkSurface: true,
      isInverted: true,
      classification: effectiveAnalysis.classification,
      reasonLabel:
        override === "dark"
          ? "Forced dark (page)"
          : effectiveAnalysis.classification === "scanned-paper"
            ? "Scanned enhanced"
            : "Forced dark",
      isOverridden: override === "dark",
      hasEmbeddedMedia: effectiveAnalysis.hasEmbeddedMedia,
    };
  }

  // Smart mode (default when app is dark)
  // Before the canvas has rendered its first frame, apply standard dark filter so pages never flash white.
  if (!analysis) {
    return {
      filter: STANDARD_DARK_PDF_FILTER,
      isDarkSurface: true,
      isInverted: true,
      classification: "standard-light",
      reasonLabel: "Dark page",
      isOverridden: false,
      hasEmbeddedMedia: false,
    };
  }

  const isInverted =
    analysis.classification === "standard-light" ||
    analysis.classification === "scanned-paper";

  return {
    filter: analysis.smartFilter,
    isDarkSurface: analysis.smartIsDarkSurface,
    isInverted,
    classification: analysis.classification,
    reasonLabel: analysis.reasonLabel,
    isOverridden: false,
    hasEmbeddedMedia: analysis.hasEmbeddedMedia,
  };
}
