/*
 * Foliet Landing Page Controller
 * - 3D Perspective Screen Stack rotation & workspace switching
 * - Live Lio Mascot eye tracking
 * - Scroll-triggered SVG chart & pipeline animations (IntersectionObserver)
 * - Dynamic semver-sorted GitHub Releases resolver
 */

const REPO_OWNER = "MohammedKamalAlsyd";
const REPO_NAME = "Foliet";
const RELEASES_LATEST_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RELEASES_LATEST_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RELEASES_LIST_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=10`;

// ============================================================================
// 1. Graphite Dark / Light Theme Toggle
// ============================================================================

const htmlEl = document.documentElement;
const themeBtn = document.getElementById("theme-toggle");

function updateThemeIcons() {
  const isDark = htmlEl.classList.contains("dark");
  const sun = document.getElementById("icon-sun");
  const moon = document.getElementById("icon-moon");
  if (sun && moon) {
    sun.style.display = isDark ? "block" : "none";
    moon.style.display = isDark ? "none" : "block";
  }
}

const storedTheme = localStorage.getItem("foliet_web_theme");
if (storedTheme === "light") {
  htmlEl.classList.remove("dark");
} else {
  htmlEl.classList.add("dark");
}
updateThemeIcons();

themeBtn?.addEventListener("click", () => {
  htmlEl.classList.toggle("dark");
  localStorage.setItem(
    "foliet_web_theme",
    htmlEl.classList.contains("dark") ? "dark" : "light",
  );
  updateThemeIcons();
});

// ============================================================================
// 2. 3D Stacked Application Screens Rotating to Inner Angle
// ============================================================================

const screenStack = document.getElementById("screen-stack");
const stackTabs = Array.from(document.querySelectorAll(".stack-tab"));
const screens = Array.from(document.querySelectorAll(".stacked-screen"));
const angleToggleBtn = document.getElementById("angle-toggle");
const angleToggleLabel = document.getElementById("angle-toggle-label");

const SCREEN_ORDER = ["reader", "summary", "library"];

function setActiveScreen(activeKey) {
  const activeIdx = SCREEN_ORDER.indexOf(activeKey);
  if (activeIdx === -1) return;

  stackTabs.forEach((tab) => {
    const isMatch = tab.dataset.screenTarget === activeKey;
    tab.classList.toggle("is-active", isMatch);
    tab.setAttribute("aria-selected", isMatch ? "true" : "false");
  });

  screens.forEach((screen) => {
    const key = screen.dataset.screenKey;
    const idx = SCREEN_ORDER.indexOf(key);
    const relativePos = (idx - activeIdx + SCREEN_ORDER.length) % SCREEN_ORDER.length;
    screen.setAttribute("data-stack-pos", String(relativePos));
  });
}

stackTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveScreen(tab.dataset.screenTarget);
  });
});

// Clicking any background screen in the 3D stack rotates it to the front
screens.forEach((screen) => {
  screen.addEventListener("click", (e) => {
    const pos = screen.getAttribute("data-stack-pos");
    if (pos && pos !== "0") {
      e.preventDefault();
      setActiveScreen(screen.dataset.screenKey);
    }
  });
});

angleToggleBtn?.addEventListener("click", () => {
  if (!screenStack) return;
  const is3d = screenStack.classList.toggle("is-3d");
  screenStack.classList.toggle("is-flat", !is3d);
  angleToggleBtn.classList.toggle("is-angled", is3d);
  if (angleToggleLabel) {
    angleToggleLabel.textContent = is3d ? "3D inner angle" : "Flat focus view";
  }
});

// ============================================================================
// 3. Interactive [Page 2] Citation Spotlighting & Summary Focus Modes
// ============================================================================

document.querySelectorAll("[data-cite-trigger]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const targetId = btn.dataset.citeTrigger;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.classList.add("is-highlighted");
    setTimeout(() => target.classList.remove("is-highlighted"), 2000);
  });
});

const SUMMARY_MODES = {
  study: {
    title: "Chapter 3 — Dense Retrieval & Hybrid Indexing",
    items: [
      "Local 384-dim ONNX models (MedEmbed-small-v0.1) reach 0.853 NDCG@10 with zero external API latency.",
      "Overlapping 32-line windows (6-line overlap) preserve equations and normalized line bounding rects.",
      "Burning annotations as ISO 32000-1 Form XObjects keeps markups editable in Preview, Acrobat, and Zotero.",
    ],
    code: "// src-tauri/src/rag/db.rs\nlet score = cosine_similarity(&query_vec, &chunk_vec);\nif score >= query.similarity_threshold { hits.push(hit); }",
  },
  executive: {
    title: "Executive Brief — Core Architecture Takeaways",
    items: [
      "HTTP 206 byte-range streaming holds RAM flat at 68 MB on 500-page PDFs by avoiding base64 IPC copies.",
      "In-process Rust embeddings enable instant cross-library search offline on flights or lab machines.",
      "All provider API keys stay encrypted in secrets.enc via AES-256-GCM and the OS Credential Manager.",
    ],
    code: "// Export targets\n// 1. Standalone Markdown (.md) with expanded idb:// PNG crops\n// 2. Microsoft Word (.docx) with native figure dimensions",
  },
  technical: {
    title: "Technical & Code — AES-256-GCM Envelope & Range Server",
    items: [
      "Custom Tauri protocol foliet-pdf:// serves 8 pooled file handles with 206 Partial Content headers.",
      "Every save_api_secret call generates a fresh 12-byte OsRng nonce before writing secrets.enc.",
      "Copilot tool set runs navigate_to, highlight_passage, explain_figure, and add_figure_to_summary.",
    ],
    code: "let nonce_bytes = generate_random_bytes::<12>();\nlet ciphertext = cipher.encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_ref())?;",
  },
};

const focusBtns = document.querySelectorAll("[data-focus-mode]");
const summaryTitleEl = document.getElementById("summary-mode-title");
const summaryListEl = document.getElementById("summary-mode-list");
const summaryCodeEl = document.getElementById("summary-mode-code");

focusBtns.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const mode = SUMMARY_MODES[btn.dataset.focusMode];
    if (!mode) return;
    focusBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
    if (summaryTitleEl) summaryTitleEl.textContent = mode.title;
    if (summaryListEl) {
      summaryListEl.innerHTML = mode.items.map((item) => `<li>${item}</li>`).join("");
    }
    if (summaryCodeEl) summaryCodeEl.textContent = mode.code;
  });
});

// ============================================================================
// 4. Lio Mascot Cursor-Tracking Pupils
// ============================================================================

const lioMascots = document.querySelectorAll("[data-lio-mascot]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reducedMotion && lioMascots.length > 0) {
  window.addEventListener(
    "pointermove",
    (e) => {
      lioMascots.forEach((svg) => {
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        const factor = Math.min(dist / 240, 1);
        const angle = Math.atan2(dy, dx);
        const px = (Math.cos(angle) * factor * 2.1).toFixed(2);
        const py = (Math.sin(angle) * factor * 2.1).toFixed(2);
        svg.querySelectorAll(".lio-pupil").forEach((g) => {
          g.setAttribute("transform", `translate(${px}, ${py})`);
        });
      });
    },
    { passive: true },
  );
}

// ============================================================================
// 5. Scroll-Triggered Chart & Pipeline Animations (IntersectionObserver)
// ============================================================================

const animatedSections = document.querySelectorAll("[data-observe-anim]");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("is-visible", entry.isIntersecting);
      });
    },
    { threshold: 0.18 },
  );
  animatedSections.forEach((el) => observer.observe(el));
} else {
  animatedSections.forEach((el) => el.classList.add("is-visible"));
}

// ============================================================================
// 6. Dynamic Best/Latest GitHub Release Resolver (Semver-Aware)
// ============================================================================

function detectOS() {
  const ua = (navigator.userAgent || "").toLowerCase();
  const plat = (navigator.platform || "").toLowerCase();
  if (ua.includes("win") || plat.includes("win")) return "windows";
  if (ua.includes("mac") || plat.includes("mac")) return "macos";
  if (ua.includes("linux") || plat.includes("linux")) return "linux";
  return "windows";
}

function parseSemverScore(tag) {
  const clean = String(tag || "").replace(/^v/i, "").trim();
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return 0;
  return (
    Number(match[1]) * 1_000_000 +
    Number(match[2]) * 1_000 +
    Number(match[3])
  );
}

const currentOS = detectOS();
const osCard = document.getElementById(`dl-card-${currentOS}`);
if (osCard) {
  osCard.classList.add("is-detected");
  const slot = osCard.querySelector("[data-detected-slot]");
  if (slot) slot.textContent = "Detected OS";
}

const heroDownloadBtn = document.getElementById("hero-download-btn");
const heroDownloadText = document.getElementById("hero-download-text");
const HERO_OS_TEXT = {
  windows: "Download for Windows",
  macos: "Download for macOS",
  linux: "Download for Linux",
};
if (heroDownloadText) {
  heroDownloadText.textContent = HERO_OS_TEXT[currentOS] || "Download Foliet";
}

async function fetchBestRelease() {
  // 1. Query GitHub's /releases/latest (always returns the newest published non-prerelease)
  try {
    const latestRes = await fetch(RELEASES_LATEST_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (latestRes.ok) {
      const release = await latestRes.json();
      if (release && !release.draft) return release;
    }
  } catch {
    // Fall through to list endpoint
  }

  // 2. Fallback: fetch release list and pick the highest semver release with assets
  try {
    const listRes = await fetch(RELEASES_LIST_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!listRes.ok) return null;
    const list = await listRes.json();
    if (!Array.isArray(list) || list.length === 0) return null;

    const published = list.filter((r) => !r.draft);
    if (published.length === 0) return null;

    published.sort((a, b) => {
      const diff = parseSemverScore(b.tag_name) - parseSemverScore(a.tag_name);
      if (diff !== 0) return diff;
      return new Date(b.published_at || 0) - new Date(a.published_at || 0);
    });
    return published[0];
  } catch {
    return null;
  }
}

async function wireDynamicReleaseDownloads() {
  const release = await fetchBestRelease();
  if (!release) return;

  const tag = release.tag_name || "v0.1.1";
  const assets = Array.isArray(release.assets) ? release.assets : [];

  document.querySelectorAll("[data-release-version]").forEach((el) => {
    el.textContent = tag;
  });

  if (release.published_at) {
    const dateStr = release.published_at.slice(0, 10);
    const dateEl = document.getElementById("release-published-date");
    if (dateEl) dateEl.textContent = `Published ${dateStr}`;
  }

  const pickAsset = (regex) =>
    assets.find((a) => regex.test(a.name) && !a.name.endsWith(".sig"));

  const winExe = pickAsset(/\.exe$/i);
  const winMsi = pickAsset(/\.msi$/i);
  const macDmg = pickAsset(/\.dmg$/i);
  const macTar = pickAsset(/\.app\.tar\.gz$/i);
  const linuxAppImage = pickAsset(/\.AppImage$/i);
  const linuxDeb = pickAsset(/\.deb$/i);

  const bindAsset = (id, asset) => {
    const link = document.getElementById(id);
    if (link && asset?.browser_download_url) {
      link.href = asset.browser_download_url;
    }
  };

  bindAsset("dl-win-exe", winExe);
  bindAsset("dl-win-msi", winMsi);
  bindAsset("dl-mac-dmg", macDmg || macTar);
  bindAsset("dl-linux-appimage", linuxAppImage);
  bindAsset("dl-linux-deb", linuxDeb);

  const bestForVisitor =
    currentOS === "windows"
      ? winExe || winMsi
      : currentOS === "macos"
        ? macDmg || macTar
        : linuxAppImage || linuxDeb;

  if (heroDownloadBtn) {
    heroDownloadBtn.href =
      bestForVisitor?.browser_download_url ||
      release.html_url ||
      RELEASES_LATEST_PAGE;
  }
}

void wireDynamicReleaseDownloads();
