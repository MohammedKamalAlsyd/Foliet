import { describe, expect, it } from "vitest";
import {
  ALREADY_DARK_FILTER,
  COVER_COMFORT_FILTER,
  STANDARD_DARK_PDF_FILTER,
  classifyPagePixels,
  resolvePdfPageAppearance,
} from "@/utils/pdfDarkMode";

/**
 * Helper to synthesize a downsampled RGBA page buffer for deterministic testing.
 */
function makePageBuffer(
  width: number,
  height: number,
  paintPixel: (x: number, y: number, w: number, h: number) => [number, number, number, number?],
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = paintPixel(x, y, width, height);
      const i = (y * width + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return buf;
}

describe("Intelligent PDF Dark Mode Classifier", () => {
  it("classifies a clean digital white PDF page as standard-light and applies warm Graphite inversion", () => {
    // 88% crisp white #FFFFFF paper + 12% dark text lines in the interior
    const rgba = makePageBuffer(64, 80, (x, y, w, h) => {
      const inTextBox = x >= 8 && x < w - 8 && y >= 10 && y < h - 10;
      const isTextRow = inTextBox && y % 6 === 0;
      return isTextRow ? [18, 18, 18] : [255, 255, 255];
    });

    const result = classifyPagePixels(rgba, 64, 80, {
      pageNumber: 3,
      textLength: 1400,
    });

    expect(result.classification).toBe("standard-light");
    expect(result.smartFilter).toBe(STANDARD_DARK_PDF_FILTER);
    expect(result.smartIsDarkSurface).toBe(true);
    expect(result.hasEmbeddedMedia).toBe(false);
  });

  it("preserves already-dark slide decks without inverting them into blinding white", () => {
    // Dark #181A20 Keynote slide background with crisp off-white text rows
    const rgba = makePageBuffer(64, 48, (x, y, w, h) => {
      const inText = x >= 8 && x < w - 8 && y >= 12 && y < h - 12 && y % 6 === 0;
      return inText ? [235, 235, 240] : [24, 26, 32];
    });

    const result = classifyPagePixels(rgba, 64, 48, {
      pageNumber: 5,
      textLength: 260,
    });

    expect(result.classification).toBe("already-dark");
    expect(result.smartFilter).toBe(ALREADY_DARK_FILTER);
    expect((result.smartFilter ?? "").includes("invert(")).toBe(false);
    expect(result.smartIsDarkSurface).toBe(true);
  });

  it("preserves a colorful full-bleed book cover on page 1 without inverting artwork", () => {
    // Rich blue-to-terracotta gradient book cover with white title area
    const rgba = makePageBuffer(64, 80, (x, y, w, h) => {
      if (y >= 16 && y <= 24 && x >= 12 && x <= w - 12) {
        return [250, 250, 250]; // title text band
      }
      const t = y / h;
      return [
        Math.round(35 + t * 185),
        Math.round(75 + (1 - t) * 70),
        Math.round(190 - t * 130),
      ];
    });

    const result = classifyPagePixels(rgba, 64, 80, {
      pageNumber: 1,
      textLength: 42,
    });

    expect(result.classification).toBe("cover-or-artwork");
    expect(result.smartFilter).toBe(COVER_COMFORT_FILTER);
    expect((result.smartFilter ?? "").includes("invert(")).toBe(false);
    expect(result.reasonLabel).toBe("Cover preserved");
  });

  it("preserves full-page continuous-tone black-and-white photography without negative inversion", () => {
    // Smoothly shaded grayscale portrait / micrograph spanning shadows, midtones, highlights
    const rgba = makePageBuffer(64, 80, (x, y, w, h) => {
      const wave =
        0.5 +
        0.32 * Math.sin((x / w) * Math.PI * 2.5) * Math.cos((y / h) * Math.PI * 2.1);
      const v = Math.round(Math.max(15, Math.min(235, wave * 255)));
      return [v, v, v];
    });

    const result = classifyPagePixels(rgba, 64, 80, {
      pageNumber: 14,
      textLength: 0,
    });

    expect(result.classification).toBe("cover-or-artwork");
    expect(result.smartFilter).toBe(COVER_COMFORT_FILTER);
    expect((result.smartFilter ?? "").includes("invert(")).toBe(false);
  });

  it("detects yellowed/sepia scanned textbook pages and applies adaptive pre-normalization before inversion", () => {
    // Aged yellowed paper #DDD0B5 (lum ~0.82, warm cast) + faint dark brown/grey scanned ink
    const rgba = makePageBuffer(64, 80, (x, y, w, h) => {
      const inText = x >= 8 && x < w - 8 && y >= 10 && y < h - 10 && y % 5 === 0;
      if (inText) return [62, 56, 48];
      // Slight scanner grain across the yellowed paper
      const noise = ((x * 13 + y * 7) % 9) - 4;
      return [221 + noise, 208 + noise, 181 + noise];
    });

    const result = classifyPagePixels(rgba, 64, 80, {
      pageNumber: 12,
      textLength: 0,
    });

    expect(result.classification).toBe("scanned-paper");
    expect(result.smartFilter).toContain("grayscale(");
    expect(result.smartFilter).toContain("brightness(");
    expect(result.smartFilter).toContain("contrast(");
    expect(result.smartFilter).toContain("invert(");
    expect(result.smartIsDarkSurface).toBe(true);
  });

  it("detects dim grey photocopy scans even when OCR text layer is present", () => {
    // Dim #B6B6B6 grey paper + washed-out #484848 text
    const rgba = makePageBuffer(64, 80, (x, y, w, h) => {
      const inText = x >= 8 && x < w - 8 && y >= 10 && y < h - 10 && y % 5 === 0;
      return inText ? [72, 72, 72] : [182, 182, 182];
    });

    const result = classifyPagePixels(rgba, 64, 80, {
      pageNumber: 9,
      textLength: 1850, // OCR'd scan still has text layer!
    });

    expect(result.classification).toBe("scanned-paper");
    expect(result.smartFilter).toContain("invert(");
    expect(result.smartIsDarkSurface).toBe(true);
  });

  it("still darkens a white academic paper that contains a moderate embedded color chart", () => {
    // 72% white paper, 10% black text, 18% colorful embedded plot in the middle
    const rgba = makePageBuffer(64, 80, (x, y, w, h) => {
      if (x >= 18 && x < 46 && y >= 24 && y < 44) {
        return x % 2 === 0 ? [37, 99, 235] : [220, 38, 38]; // embedded chart
      }
      const inText = x >= 8 && x < w - 8 && y >= 8 && y < h - 8 && y % 6 === 0;
      return inText ? [20, 20, 20] : [255, 255, 255];
    });

    const result = classifyPagePixels(rgba, 64, 80, {
      pageNumber: 4,
      textLength: 1100,
    });

    expect(result.classification).toBe("standard-light");
    expect(result.hasEmbeddedMedia).toBe(true);
    expect(result.smartFilter).toBe(STANDARD_DARK_PDF_FILTER);
  });

  it("falls back safely on tiny or JSDOM-mocked empty buffers without throwing", () => {
    const result = classifyPagePixels(new Uint8ClampedArray(4), 1, 1, {
      pageNumber: 1,
    });

    expect(result.classification).toBe("standard-light");
    expect(result.smartFilter).toBe(STANDARD_DARK_PDF_FILTER);
  });

  it("resolves global modes (light theme, original, smart, force) and per-page overrides accurately", () => {
    const coverRgba = makePageBuffer(64, 80, () => [220, 145, 70]);
    const coverAnalysis = classifyPagePixels(coverRgba, 64, 80, {
      pageNumber: 1,
      textLength: 20,
    });
    expect(coverAnalysis.classification).toBe("cover-or-artwork");

    // Light app theme -> never alters PDF page
    const inLightApp = resolvePdfPageAppearance({
      isAppDark: false,
      setting: "smart",
      override: "auto",
      analysis: coverAnalysis,
    });
    expect(inLightApp.filter).toBeUndefined();
    expect(inLightApp.isInverted).toBe(false);

    // Dark app + Smart mode on cover -> preserves cover (not inverted)
    const smartCover = resolvePdfPageAppearance({
      isAppDark: true,
      setting: "smart",
      override: "auto",
      analysis: coverAnalysis,
    });
    expect(smartCover.filter).toBe(COVER_COMFORT_FILTER);
    expect(smartCover.isInverted).toBe(false);

    // Dark app + Per-page dark override on cover -> forces dark
    const forcedPageCover = resolvePdfPageAppearance({
      isAppDark: true,
      setting: "smart",
      override: "dark",
      analysis: coverAnalysis,
    });
    expect(forcedPageCover.filter).toBe(STANDARD_DARK_PDF_FILTER);
    expect(forcedPageCover.isInverted).toBe(true);
    expect(forcedPageCover.isOverridden).toBe(true);

    // Dark app + Global original paper -> no filter
    const globalOriginal = resolvePdfPageAppearance({
      isAppDark: true,
      setting: "original",
      override: "auto",
      analysis: coverAnalysis,
    });
    expect(globalOriginal.filter).toBeUndefined();
  });
});
