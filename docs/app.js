/* Foliet Landing Page — Interactive Preview, Lio Eye-Tracking & Live GitHub Releases */

const REPO_OWNER = "MohammedKamalAlsyd";
const REPO_NAME = "Foliet";
const RELEASES_LATEST_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RELEASES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

// 1. Theme toggle (Graphite Dark / Light)
const htmlEl = document.documentElement;
const themeToggle = document.getElementById("theme-toggle");

function syncThemeIcons() {
  const isDark = htmlEl.classList.contains("dark");
  const sun = document.getElementById("icon-sun");
  const moon = document.getElementById("icon-moon");
  if (sun && moon) {
    sun.style.display = isDark ? "block" : "none";
    moon.style.display = isDark ? "none" : "block";
  }
  if (themeToggle) {
    themeToggle.setAttribute(
      "aria-label",
      isDark ? "Switch to Graphite Light mode" : "Switch to Graphite Dark mode",
    );
  }
}

const savedTheme = localStorage.getItem("foliet_web_theme");
if (savedTheme === "light") {
  htmlEl.classList.remove("dark");
} else {
  htmlEl.classList.add("dark");
}
syncThemeIcons();

themeToggle?.addEventListener("click", () => {
  htmlEl.classList.toggle("dark");
  localStorage.setItem(
    "foliet_web_theme",
    htmlEl.classList.contains("dark") ? "dark" : "light",
  );
  syncThemeIcons();
});

// 2. Interactive Workspace Tab Switcher
const wsTabs = document.querySelectorAll(".ws-tab");
const wsPanels = document.querySelectorAll(".ws-panel");
const windowDocTitle = document.getElementById("window-doc-title");
const windowSavedBadge = document.getElementById("window-saved-badge");

const TAB_TITLES = {
  reader: { title: "Attention-Guided Retrieval in Technical Monographs.pdf", showSaved: true },
  rag: { title: "Attention-Guided Retrieval in Technical Monographs.pdf", showSaved: true },
  summary: { title: "Living Summary — Attention-Guided Retrieval", showSaved: true },
  library: { title: "Library", showSaved: false },
};

wsTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.ws;
    wsTabs.forEach((t) => t.classList.toggle("is-active", t === tab));
    wsPanels.forEach((p) => p.classList.toggle("is-active", p.dataset.wsPanel === target));

    const meta = TAB_TITLES[target];
    if (meta && windowDocTitle) {
      windowDocTitle.textContent = meta.title;
    }
    if (meta && windowSavedBadge) {
      windowSavedBadge.style.display = meta.showSaved ? "inline-flex" : "none";
    }
  });
});

// 3. Clickable Citation Spotlight Demo in Reader Panel
const spotlightTargets = document.querySelectorAll("[data-spotlight]");
document.querySelectorAll("[data-cite-target]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.citeTarget;
    spotlightTargets.forEach((el) => el.classList.remove("is-pulsing"));
    const match = document.querySelector(`[data-spotlight="${id}"]`);
    if (match) {
      match.classList.add("is-pulsing");
      setTimeout(() => match.classList.remove("is-pulsing"), 2200);
    }
  });
});

// 4. Clickable RAG Result Cards updating the Live Spotlight Banner
const ragCards = document.querySelectorAll("[data-rag-result]");
const ragBannerScore = document.getElementById("rag-banner-score");
const ragBannerText = document.getElementById("rag-banner-text");
const ragQuoteHighlight = document.getElementById("rag-quote-highlight");

ragCards.forEach((card) => {
  card.addEventListener("click", () => {
    ragCards.forEach((c) => c.classList.remove("is-selected"));
    card.classList.add("is-selected");
    if (ragBannerScore) ragBannerScore.textContent = `RAG Match (${card.dataset.ragScore})`;
    if (ragBannerText) ragBannerText.textContent = `${card.dataset.ragPage} · ${card.dataset.ragModel}`;
    if (ragQuoteHighlight) {
      ragQuoteHighlight.textContent = card.dataset.ragQuote;
      ragQuoteHighlight.classList.remove("is-pulsing");
      void ragQuoteHighlight.offsetWidth;
      ragQuoteHighlight.classList.add("is-pulsing");
    }
  });
});

// 5. Living Summary Focus Mode Switcher
const SUMMARY_CONTENT = {
  study: {
    heading: "Chapter 3 — Dense Retrieval & Hybrid Indexing",
    bullets: [
      "Local 384-dim ONNX models (MedEmbed-small-v0.1) achieve 0.853 NDCG@10 with zero external API latency.",
      "Line-aware overlapping chunks (32 lines, 6-line overlap) preserve paragraph equations and bounding rects.",
      "Burning annotations as ISO 32000-1 Form XObjects keeps highlights editable in Preview, Acrobat, and Zotero.",
    ],
    code: "// Rust SQLite vector lookup (rag/db.rs)\nlet score = cosine_similarity(&query_vec, &chunk_vec);\nif score >= query.similarity_threshold { hits.push(hit); }",
  },
  brief: {
    heading: "Executive Brief — Key Findings",
    bullets: [
      "HTTP 206 byte-range streaming cuts peak RAM usage on 400-page PDFs by avoiding full base64 IPC copies.",
      "Offline Rust embeddings enable instant cross-paper search on flights and air-gapped lab machines.",
      "All provider API keys stay encrypted at rest via AES-256-GCM backed by the OS Credential Manager.",
    ],
    code: "# Export formats ready\n- Standalone Markdown (.md) with expanded figures\n- Native Microsoft Word (.docx) with embedded PNG crops",
  },
  tech: {
    heading: "Technical & Code Synthesis",
    bullets: [
      "Custom Tauri protocol `foliet-pdf://` serves pooled file handles with 206 Partial Content headers.",
      "Encrypted secrets envelope stores version + random 12-byte nonce + AES-256-GCM ciphertext in `secrets.enc`.",
      "Copilot tool pipeline executes `navigate_to`, `highlight_passage`, `explain_figure`, and `add_figure_to_summary`.",
    ],
    code: "let nonce = Nonce::from_slice(&generate_random_bytes::<12>());\nlet ciphertext = cipher.encrypt(nonce, plaintext.as_ref())?;",
  },
};

const modePills = document.querySelectorAll("[data-summary-mode]");
const summaryHeading = document.getElementById("summary-heading");
const summaryBullets = document.getElementById("summary-bullets");
const summaryCode = document.getElementById("summary-code");

modePills.forEach((pill) => {
  pill.addEventListener("click", () => {
    const mode = pill.dataset.summaryMode;
    const data = SUMMARY_CONTENT[mode];
    if (!data) return;
    modePills.forEach((p) => p.classList.toggle("is-active", p === pill));
    if (summaryHeading) summaryHeading.textContent = data.heading;
    if (summaryBullets) {
      summaryBullets.innerHTML = data.bullets.map((b) => `<li>${b}</li>`).join("");
    }
    if (summaryCode) summaryCode.textContent = data.code;
  });
});

// 6. Lio Mascot Cursor-Tracking Pupils & Natural Blinking
const lioSvgs = document.querySelectorAll("[data-lio-mascot]");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!prefersReducedMotion && lioSvgs.length > 0) {
  window.addEventListener(
    "pointermove",
    (e) => {
      lioSvgs.forEach((svg) => {
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        const intensity = Math.min(dist / 260, 1);
        const angle = Math.atan2(dy, dx);
        const px = (Math.cos(angle) * intensity * 2.1).toFixed(2);
        const py = (Math.sin(angle) * intensity * 2.1).toFixed(2);
        svg.querySelectorAll(".lio-pupil").forEach((pupil) => {
          pupil.setAttribute("transform", `translate(${px}, ${py})`);
        });
      });
    },
    { passive: true },
  );
}

// 7. OS Detection & Live GitHub Releases Asset Wiring
function detectPlatform() {
  const ua = (navigator.userAgent || "").toLowerCase();
  const platform = (navigator.platform || "").toLowerCase();
  if (ua.includes("win") || platform.includes("win")) return "windows";
  if (ua.includes("mac") || platform.includes("mac")) return "macos";
  if (ua.includes("linux") || platform.includes("linux")) return "linux";
  return "windows";
}

const detectedOS = detectPlatform();
const osCardMap = {
  windows: document.getElementById("dl-card-windows"),
  macos: document.getElementById("dl-card-macos"),
  linux: document.getElementById("dl-card-linux"),
};

Object.entries(osCardMap).forEach(([os, card]) => {
  if (os === detectedOS && card) {
    card.classList.add("is-recommended");
    const badge = document.createElement("span");
    badge.className = "dl-rec-badge";
    badge.textContent = "Detected OS";
    card.appendChild(badge);
  }
});

const heroPrimaryBtn = document.getElementById("hero-download-btn");
const heroDownloadLabel = document.getElementById("hero-download-label");
const OS_LABELS = {
  windows: "Download for Windows",
  macos: "Download for macOS (Apple Silicon)",
  linux: "Download for Linux",
};
if (heroDownloadLabel) {
  heroDownloadLabel.textContent = OS_LABELS[detectedOS] || "Download Foliet";
}

async function hydrateLatestRelease() {
  try {
    const res = await fetch(RELEASES_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const release = await res.json();
    const version = release.tag_name || "";
    const assets = Array.isArray(release.assets) ? release.assets : [];

    if (version) {
      document.querySelectorAll("[data-release-version]").forEach((el) => {
        el.textContent = version;
      });
    }

    const findAsset = (re) =>
      assets.find((a) => re.test(a.name) && !a.name.endsWith(".sig"));

    const winExe = findAsset(/\.exe$/i);
    const winMsi = findAsset(/\.msi$/i);
    const macDmg = findAsset(/\.dmg$/i);
    const linuxAppImage = findAsset(/\.AppImage$/i);
    const linuxDeb = findAsset(/\.deb$/i);

    const wireLink = (id, asset) => {
      const el = document.getElementById(id);
      if (el && asset?.browser_download_url) {
        el.href = asset.browser_download_url;
      }
    };

    wireLink("dl-win-exe", winExe);
    wireLink("dl-win-msi", winMsi);
    wireLink("dl-mac-dmg", macDmg);
    wireLink("dl-linux-appimage", linuxAppImage);
    wireLink("dl-linux-deb", linuxDeb);

    // Wire Hero primary CTA directly to the user's detected OS installer
    const primaryAsset =
      detectedOS === "windows"
        ? winExe || winMsi
        : detectedOS === "macos"
          ? macDmg
          : linuxAppImage || linuxDeb;

    if (heroPrimaryBtn && primaryAsset?.browser_download_url) {
      heroPrimaryBtn.href = primaryAsset.browser_download_url;
    } else if (heroPrimaryBtn && release.html_url) {
      heroPrimaryBtn.href = release.html_url;
    }
  } catch {
    // Graceful fallback: all links already point to GitHub Releases latest
    if (heroPrimaryBtn) heroPrimaryBtn.href = RELEASES_LATEST_URL;
  }
}

void hydrateLatestRelease();
