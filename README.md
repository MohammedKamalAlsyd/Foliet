<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="Foliet App Icon" width="84" height="84" />

# Foliet

**A local-first scholarly PDF reader, ISO-compliant annotation studio, offline ONNX semantic search engine, and AI research workspace.**

<p>
  <a href="https://github.com/MohammedKamalAlsyd/Foliet/releases/latest">
    <img src="https://img.shields.io/github/v/release/MohammedKamalAlsyd/Foliet?style=for-the-badge&color=B44327&label=Download" alt="Latest Release" />
  </a>
  <a href="https://github.com/MohammedKamalAlsyd/Foliet/actions/workflows/test.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/MohammedKamalAlsyd/Foliet/test.yml?style=for-the-badge&label=CI%20Tests" alt="CI Tests" />
  </a>
  <a href="https://mohammedkamalalsyd.github.io/Foliet/">
    <img src="https://img.shields.io/badge/Website-Live_Preview-171717?style=for-the-badge" alt="Website" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-16A34A?style=for-the-badge" alt="MIT License" />
  </a>
</p>

<p>
  <img src="https://img.shields.io/badge/Tauri_v2-24C8D8?style=flat-square&logo=tauri&logoColor=white" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/React_19-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/ONNX_Runtime-005CED?style=flat-square&logo=onnx&logoColor=white" alt="ONNX Runtime" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/AES--256--GCM-16A34A?style=flat-square&logo=letsencrypt&logoColor=white" alt="AES-256-GCM" />
</p>

[Download Latest Release](https://github.com/MohammedKamalAlsyd/Foliet/releases/latest) · [Features](#main-features) · [Security](#security--privacy) · [Keyboard Shortcuts](#keyboard-shortcuts) · [Development](#development--building)

</div>

---

## Download & Installation

Pre-built desktop installers with built-in automatic updates are published on [GitHub Releases](https://github.com/MohammedKamalAlsyd/Foliet/releases/latest) (or via the [Foliet Download Page](https://mohammedkamalalsyd.github.io/Foliet/), which detects your OS automatically):

### Which File Should I Download?

| Platform | Architecture | Recommended File | Alternative |
| :--- | :--- | :--- | :--- |
| **Windows** | x64 (`Windows 10/11`) | `Foliet-<ver>-windows-x86_64-setup.exe` *(NSIS installer)* | `Foliet-<ver>-windows-x86_64.msi` *(enterprise MSI)* |
| **macOS** | Apple Silicon (`arm64`, macOS 13.4+) | `Foliet-<ver>-macos-aarch64.dmg` | — |
| **Linux (Debian / Ubuntu)** | x64 (`Ubuntu 24.04+`) | `Foliet-<ver>-linux-x86_64.deb` | `Foliet-<ver>-linux-x86_64.AppImage` *(portable)* |
| **Linux (Fedora / RHEL)** | x64 | `Foliet-<ver>-linux-x86_64.rpm` | `Foliet-<ver>-linux-x86_64.AppImage` *(portable)* |

> **What about `latest.json` and `*.app.tar.gz`?**  
> You do **not** need to download those files manually — they are used automatically by Foliet's in-app updater (cryptographic Minisign signatures are embedded directly inside `latest.json`).

### OS Installation Notes

- **Windows (SmartScreen Notice):**  
  Direct GitHub downloads are currently not Authenticode-signed, so Windows Defender SmartScreen may display *"Windows protected your PC — Unknown publisher"* on first install. Click **More info → Run anyway** to proceed. Once installed, future updates run directly inside Foliet via Minisign verification without re-triggering browser SmartScreen warnings. *(Microsoft Store MSIX packaging is also included in this repository — see [Building for Microsoft Store (MSIX)](#building-for-microsoft-store-msix) below.)*
- **macOS (Gatekeeper Notice):**  
  Open the `.dmg`, drag **Foliet** into **Applications**, and on first launch **Right-click (Control-click) → Open → Open** (or allow it under **System Settings → Privacy & Security → Open Anyway**). If macOS reports the unsigned binary as quarantined/damaged, clear the download quarantine attribute once in Terminal:
  ```bash
  xattr -cr /Applications/foliet.app
  ```
- **Linux:**  
  No signing warnings. Install with:
  ```bash
  # Ubuntu / Debian (.deb)
  sudo apt install ./Foliet-*-linux-x86_64.deb

  # Portable AppImage (any modern distro)
  chmod +x Foliet-*-linux-x86_64.AppImage && ./Foliet-*-linux-x86_64.AppImage
  ```

> **Auto-Updates:** Standalone GitHub builds check for signed releases on startup (and on demand via the Titlebar update button) using `tauri-plugin-updater`. If you have unsaved annotations open, Foliet always prompts before restarting so edits are never lost.

---

## Main Features

### 1. Local-First Research Library
- **Instant Import & Drag-and-Drop:** Open PDFs via the system picker, OS `.pdf` file association, or drag-and-drop directly onto the window.
- **Collections & Smart Filters:** Organize papers into custom collections (create, rename, delete, or assign via right-click context menu) and filter by **All papers**, **Recent** (7-day window), or **Annotated**.
- **Reading Continuity:** Tracks page counts, file sizes, annotation counts, RAG indexing status, last visited page, scroll offset, and zoom level per document.

### 2. High-Performance Rust PDF Engine
- **Byte-Range Streaming Protocol (`foliet-pdf://`):** Custom asynchronous Rust URI scheme serves local PDFs via HTTP `206 Partial Content` range requests with an in-memory pooled file cache—eliminating base64 IPC memory spikes on large textbooks and monographs.
- **Virtualized Windowed Rendering:** Powered by `@tanstack/react-virtual` with persistent back-buffer canvases for flicker-free zooming (`Fit to Width`, presets, and `Ctrl/Cmd + Wheel`).
- **Navigation & Search:** Embedded PDF Table of Contents outline, custom page bookmarks, `Ctrl/Cmd`-click internal/external hyperlinks, and fast asynchronous full-text search.

### 3. ISO 32000-1 Annotation Engine & Native PDF Burning
- **Complete Markup Suite:** **Highlight**, **Underline** (`solid`, `squiggle`, `dashed`), **Strikethrough**, **Sticky Notes** (debounced floating editor), **Freehand Ink** (`perfect-freehand`), **Eraser** (click & drag-to-erase), and **Figure Area Crop**.
- **Customizable Tool Presets:** Configure labels, ink colors, stroke width, underline style, and single-key shortcuts in the **Tool Customizer** modal.
- **Native Rust PDF Export (`lopdf`):** Burns annotations directly into the source PDF as standard ISO 32000-1 Form XObject appearance streams (preserving existing annotations and document trailer IDs) with full revision-tracked **Undo / Redo** (`zundo`) and unsaved-changes close protection.
- **Figure Cropping:** Capture high-DPI PNG regions from any page, manage them in the **Figures** sidebar, and drag-and-drop them directly into your summaries.

### 4. "Lio" AI Research Companion & Interactive Copilot Tools
- **Per-Paper Persistent Chat (`AiChatPanel`):** SQLite-backed conversation history with live streaming, abort/stop controls, OpenRouter live web search toggle, clickable `[Page N]` citation chips that spotlight the target page, and **Lio**—an interactive SVG mascot with cursor-tracking eyes and mood states.
- **Agentic PDF Copilot Tools (Vercel AI SDK):** Lio can actively interact with your PDF via 4 built-in tools:
  - `navigate_to` — Jump the viewer to a cited page and inspect its contents.
  - `highlight_passage` — Create a persistent highlight on a key finding on any page.
  - `explain_figure` — Capture and visually analyze a page figure with multimodal models.
  - `add_figure_to_summary` — Crop a figure and insert it directly into your Living Summary.
- **Selection Context Bar:** Selecting text in `Select` mode reveals a floating bar to **Search Web** or **Ask Lio** with the quote and page number attached automatically.
- **Bring Your Own Provider:** Supports **OpenRouter**, **OpenAI**, **Anthropic**, **Google AI Studio**, and 100% local **Ollama**.

### 5. Local Rust ONNX RAG & Cross-Library Semantic Search
- **Offline Rust Vector Engine (`ort` + `tokenizers` + `rusqlite`):** Run dense semantic embeddings locally in Rust with downloadable Hugging Face ONNX models (`MedEmbed-small-v0.1`, `all-MiniLM-L12-v2`, `GIST-all-MiniLM-L6-v2`, `Ivysaur`, `GTE-Micro-v4`)—or switch to **Voyage AI**, **OpenAI**, or **Ollama** embeddings.
- **Single-Paper or Full-Library Search:** Tune `Top-K`, similarity threshold, chunk size, and overlap; inspect indexed chunks; click any result to jump across papers with an on-page **RAG Match (%)** spotlight banner.

### 6. Split-Screen Living Summary Studio
- **Source-Anchored Synthesis:** Ground summaries in your highlights, underlines, sticky notes, cropped figures, and saved Lio conversations—chapter-by-chapter or full-document.
- **Focus Modes & Rich Editor:** Generate **Executive Brief**, **Study Notes**, or **Technical & Code** syntheses inside a **Tiptap** Markdown editor with `lowlight` syntax highlighting, inline `idb://` figure resolution, drag-and-drop image embedding, and previous-snapshot rollback.
- **Auto-Save & Portable Export:** Auto-saves continuously to SQLite and exports cleanly to **Standalone Markdown (`.md`)** or **Microsoft Word (`.docx`)** with embedded figures.

---

## Security & Privacy

- **Zero Telemetry & Local-First Storage:** Your PDFs, SQLite databases (`foliet.db`, `rag.db`), annotations, figure crops, and local embeddings stay strictly on your machine.
- **AES-256-GCM Encrypted API Keys at Rest:** API keys are **never** stored in `localStorage`, `settings.json`, or SQLite. They exist only in memory on the frontend and are persisted in `secrets.enc` inside your app data directory using **AES-256-GCM** with a fresh random 12-byte nonce per write.
- **OS Credential Manager Master Key:** The 256-bit master key is generated lazily and stored in your operating system's native keychain (**Windows Credential Manager**, **macOS Keychain**, or **Linux Secret Service** via `keyring`), with automatic legacy plaintext scrubbing on upgrade.
- **Signed Auto-Updates:** Releases are cryptographically signed via Minisign (`tauri-plugin-updater`) and verified before installation.

---

## Tech Stack

| Layer | Technologies | Role in Foliet |
| :--- | :--- | :--- |
| **Desktop Shell & Backend** | Tauri v2, Rust | Frameless native windowing, `foliet-pdf://` byte-range streaming, SHA-256 ID hashing, encrypted secrets (`aes-gcm`, `keyring`), and signed auto-updates |
| **PDF Rendering & Burning** | PDF.js (`react-pdf`), `lopdf` | Virtualized canvas/text rendering, search extraction, and ISO 32000-1 Form XObject annotation burning |
| **Local RAG & Vector Search** | `ort` (ONNX Runtime), `tokenizers`, `rusqlite` | In-process Rust PDF text chunking, local ONNX embeddings, cosine vector search, and model downloads |
| **Frontend & UI** | React 19, TypeScript, Tailwind CSS v4, Base UI, Framer Motion | Graphite Light/Dark theme system, resizable split workspaces, accessible dialogs/menus |
| **State & Rich Text** | Zustand, Zundo, Tiptap + `lowlight`, `docx` | Modular stores, revisioned Undo/Redo, Living Summary Markdown editor, and `.md`/`.docx` export |
| **AI Providers** | Vercel AI SDK (`ai`), OpenRouter, OpenAI, Anthropic, Google Gemini, Ollama | Streaming chat, tool calling, multimodal figure inspection, and chapter synthesis |

---

## Keyboard Shortcuts

| Context | Shortcut | Action |
| :--- | :--- | :--- |
| **Library** | `Ctrl/Cmd + K` | Focus library search |
| **Viewer** | `Ctrl/Cmd + F` | Open in-document search |
| **Viewer** | `Ctrl/Cmd + S` | Save & burn annotations to PDF |
| **Viewer** | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` (`Ctrl + Y`) | Undo / Redo annotation changes |
| **Viewer** | `Ctrl/Cmd + Wheel` | Zoom in / out |
| **Viewer** | `Ctrl/Cmd + Click` | Open internal/external PDF hyperlink |
| **Tools** | `V` · `H` · `U` · `S` · `N` · `I` · `A` · `E` | Select · Highlight · Underline · Strikethrough · Note · Ink · Figure Crop · Eraser |

---

## Development & Building

### Prerequisites
- **Node.js 22+** and **pnpm 12+**
- **Rust (stable)** and Tauri v2 platform prerequisites ([Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/))

### Run Locally
```bash
pnpm install
pnpm tauri dev
```

### Verification & Tests
```bash
pnpm exec tsc --noEmit                  # TypeScript typecheck
pnpm test                               # Vitest end-to-end workflow test suite (35 tests)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests (AES-256-GCM secrets)
pnpm run version:check                  # Verify version sync across package.json, Cargo.toml, tauri.conf.json
```

### Cutting a Release
```bash
pnpm run version:bump 0.1.3             # Syncs package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
git commit -am "chore: release v0.1.3"
git tag v0.1.3
git push origin main --tags             # Triggers .github/workflows/release.yml
```

### Building for Microsoft Store (MSIX)
Foliet includes an unsigned Windows x64 **MSIX** packaging pipeline for Microsoft Store submission (where Microsoft signs the package with its trusted Store certificate for zero SmartScreen warnings):

1. Register a free ($0) individual developer account at [storedeveloper.microsoft.com](https://storedeveloper.microsoft.com), reserve **Foliet** in Partner Center, and copy your **Product Identity** fields (`Package/Identity/Name`, `Package/Identity/Publisher`, and `Package/Properties/PublisherDisplayName`).
2. Add those 3 values as GitHub Actions **Secrets** or **Variables** in your repository (`MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER`, `MSIX_PUBLISHER_DISPLAY_NAME`).
3. On every release tag (or manual **Release Foliet** workflow run), GitHub Actions builds a Store-mode binary (`VITE_STORE_BUILD=true`, which disables external self-updates per Store policy) and uploads `windows-msix-store-package` (`foliet_<version>_x64.msix`) ready to submit in Partner Center.

To build the `.msix` locally on Windows (requires Windows 10/11 SDK `MakeAppx.exe`):
```powershell
$env:VITE_STORE_BUILD = "true"
$env:MSIX_IDENTITY_NAME = "YourPartnerCenter.IdentityName"
$env:MSIX_PUBLISHER = "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
$env:MSIX_PUBLISHER_DISPLAY_NAME = "Mohammed Kamal Alsyd"
pnpm tauri build --no-bundle
pnpm run msix:build
```

---

## Project Structure

```text
foliet/
├── .github/workflows/
│   ├── test.yml                        # Fast CI typecheck, Vitest suite, and Vite build
│   └── release.yml                     # Cross-platform signed Tauri builds (Windows, macOS arm64, Linux)
├── docs/                               # Static landing page (ready for GitHub Pages / Netlify)
├── scripts/
│   └── bump-version.mjs                # Manifest version synchronizer & checker
├── src/
│   ├── components/
│   │   ├── ai/                         # Lio chat, interactive SVG mascot, RAG panel, Living Summary studio
│   │   ├── libraryview/                # Library dashboard table & collections sidebar
│   │   ├── modals/                     # ConfirmModal, ToolCustomizerModal, UpdateModal
│   │   ├── ui/                         # Base UI + Tailwind v4 primitives
│   │   ├── viewer/                     # Virtualized PdfPage, layers (Markup/Ink/Crop/Note), Toolbar, Search
│   │   ├── Logo.tsx                    # Foliet geometric folio brand mark
│   │   └── Titlebar.tsx                # OS-adaptive titlebar, unsaved status, update check & theme toggle
│   ├── constants/                      # LLM/embedding presets, default tool presets & cursors
│   ├── hooks/                          # Library catalog, pointer tools, search, PDF session, zoom, tool manager
│   ├── pages/                          # LibraryView & ViewerView
│   ├── services/                       # LLM SDK/tools, PDF IPC, RAG IPC, encrypted secrets, updater, SQLite/store
│   ├── stores/                         # Modular Zustand stores (aiConfig, aiStudio, annotation, chat, document, library, rag, summary, system, tool)
│   └── test/                           # Vitest fakes, real PDF fixtures, & end-to-end workflow tests
└── src-tauri/
    └── src/
        ├── pdf_exporter/               # ISO 32000-1 Form XObject annotation writer (`lopdf`)
        ├── rag/                        # Rust ONNX embedder (`ort`), tokenizer, SQLite vector DB, HF downloader
        ├── secrets.rs                  # AES-256-GCM encrypted API key store + OS keyring integration
        ├── pdf_reader.rs               # SHA-256 PDF ID hashing & embedded annotation extraction
        └── lib.rs                      # Tauri v2 setup, plugins, `foliet-pdf://` byte-range server, IPC commands
```

---

## License

Released under the [MIT License](LICENSE).

