<div align="center">

# Foliet

**A local-first scholarly PDF reader, ISO-compliant annotation studio, and AI-powered research workspace.**

<p>
  <img src="https://img.shields.io/badge/Tauri_v2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-0F172A?style=for-the-badge&logo=tailwindcss&logoColor=38BDF8" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
</p>

<p>
  <img src="https://img.shields.io/badge/PDF.js-EC1C24?style=flat-square&logo=adobeacrobatreader&logoColor=white" alt="PDF.js" />
  <img src="https://img.shields.io/badge/lopdf_(ISO_32000--1)-B7410E?style=flat-square&logo=rust&logoColor=white" alt="lopdf" />
  <img src="https://img.shields.io/badge/Zustand-443E38?style=flat-square&logo=react&logoColor=white" alt="Zustand" />
  <img src="https://img.shields.io/badge/Tiptap_Editor-111827?style=flat-square&logo=markdown&logoColor=white" alt="Tiptap" />
  <img src="https://img.shields.io/badge/Base_UI-007FFF?style=flat-square&logo=mui&logoColor=white" alt="Base UI" />
  <img src="https://img.shields.io/badge/Windows_%7C_macOS_%7C_Linux-Desktop_App-D97757?style=flat-square" alt="Cross-Platform Desktop" />
</p>

</div>

---

## Tech Stack

| Layer                       | Technologies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Role in Foliet                                                                                                                                  |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop Shell & Backend** | ![Tauri](https://img.shields.io/badge/Tauri_v2-24C8D8?style=flat-square&logo=tauri&logoColor=white) ![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)                                                                                                                                                                                                                                                                                                                               | Native window management, `foliet-pdf` HTTP `206` byte-range streaming server, file I/O, and SHA-256 document ID hashing                        |
| **PDF Parsing & Exporting** | ![PDF.js](https://img.shields.io/badge/PDF.js-EC1C24?style=flat-square&logo=adobeacrobatreader&logoColor=white) ![lopdf](https://img.shields.io/badge/lopdf-B7410E?style=flat-square&logo=rust&logoColor=white)                                                                                                                                                                                                                                                                                                                 | Canvas/text-layer rendering, search extraction, and native Rust ISO 32000-1 Form XObject annotation burning                                     |
| **Frontend & Styling**      | ![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) ![Tailwind](https://img.shields.io/badge/Tailwind_CSS_v4-0F172A?style=flat-square&logo=tailwindcss&logoColor=38BDF8) ![Base UI](https://img.shields.io/badge/Base_UI-007FFF?style=flat-square&logo=mui&logoColor=white)                                                                                       | Modular desktop UI, custom Graphitic Light/Dark theme tokens, and accessible dialogs/menus                                                      |
| **State & Rich Text**       | ![Zustand](https://img.shields.io/badge/Zustand-443E38?style=flat-square&logo=react&logoColor=white) ![Tiptap](https://img.shields.io/badge/Tiptap_+_lowlight-111827?style=flat-square&logo=markdown&logoColor=white)                                                                                                                                                                                                                                                                                                           | Reactive AI/document/system stores and live Markdown synthesis editing with syntax-highlighted code blocks                                      |
| **Local Persistence**       | ![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white) ![Tauri Store](https://img.shields.io/badge/Tauri_LazyStore-24C8D8?style=flat-square&logo=tauri&logoColor=white)                                                                                                                                                                                                                                                                                                            | Local storage for annotations, figure crops, chat threads, summaries (`foliet.db`), catalog (`library.json`), and preferences (`settings.json`) |
| **Supported AI Providers**  | ![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=flat-square&logo=openai&logoColor=white) ![Anthropic](https://img.shields.io/badge/Anthropic-191919?style=flat-square&logo=anthropic&logoColor=white) ![Gemini](https://img.shields.io/badge/Google_Gemini-4285F4?style=flat-square&logo=googlegemini&logoColor=white) ![OpenRouter](https://img.shields.io/badge/OpenRouter-6366F1?style=flat-square) ![Ollama](<https://img.shields.io/badge/Ollama_(Local)-000000?style=flat-square&logo=ollama&logoColor=white>) | Direct SSE / NDJSON streaming across cloud APIs and local models                                                                                |

---

## Main Features

### 1. Local-First Research Library

- **Instant Import & Drag-and-Drop:** Open PDFs via the system file picker or drag-and-drop directly onto the library or reader window.
- **Collections & Smart Filters:** Group papers into custom collections (create, rename, delete, or assign via right-click context menu) and filter by **All papers**, **Recent** (7-day window), or **Annotated**.
- **Reading State Continuity:** Tracks document file sizes, page counts, annotation counts, last visited page, and zoom level per paper.

### 2. High-Performance PDF Engine

- **Byte-Range URI Streaming:** Custom Rust `foliet-pdf` protocol serves PDFs via HTTP `206 Partial Content` range requests, avoiding heavy base64/IPC memory copies.
- **Virtualized Windowed Rendering:** Uses `IntersectionObserver` and directional pre-rendering alongside a persistent back-buffer canvas for flicker-free zooming (`Fit to Width`, presets, and `Ctrl/Cmd + Wheel`).
- **Navigation & Search:** Embedded PDF Table of Contents outline, custom page bookmarks, `Ctrl/Cmd`-click internal/external hyperlinks, and fast in-document text search.

### 3. Annotation Engine & Native PDF Burning

- **Complete Markup Suite:** Supports **Highlight**, **Underline** (`solid`, `squiggle`, `dashed`), **Strikethrough**, **Sticky Notes**, **Freehand Ink**, **Eraser**, and **Figure Area Crop**.
- **Customizable Tool Presets:** Edit tool labels, colors (presets, native picker, or hex codes), pen thickness, underline styles, and single-key shortcuts via the **Tool Customizer** modal.
- **ISO 32000-1 Export (`lopdf`):** Burns annotations directly into the source PDF as standard Form XObject appearance streams while preserving existing embedded annotations and document trailer IDs, with full Undo/Redo history.
- **Figure Cropping:** Capture regions from any page as high-DPI PNG crops, review them in the **Figures** sidebar, and embed them directly into research notes.

### 4. AI Studio & "Lio" Research Companion

- **Lio Chat (`AiChatPanel`):** Per-paper persistent SQLite conversations with clickable page citations, Markdown code blocks, and an interactive SVG mascot (`AiMascot`) featuring live cursor-tracking eyes and mood animations.
- **Selection Context Popover:** Selecting text in `Select` mode reveals a floating action bar to **Search Web** or **Ask Lio** with the passage and page number attached automatically.
- **RAG Semantic Search:** Search across the active paper or the entire library with configurable `Top-K`, similarity thresholds, chunk inspection, and on-page visual match highlighting.

### 5. Split-Screen Summarization Studio

- **Source-Anchored Synthesis:** Pick specific highlights, underlines, sticky notes, figure crops, and saved Lio chat takeaways in the left pane to ground AI-generated syntheses.
- **Focus Modes & Live Markdown Editor:** Generate **Executive Brief**, **Study Notes**, or **Technical & Code** documents inside a Tiptap editor with syntax-highlighted code blocks and resolved inline figure crops.
- **Auto-Save & `.md` Export:** Continuously saves drafts to SQLite and exports clean standalone Markdown files.

### 6. Native Desktop Shell

- **OS-Adaptive Titlebar & Themes:** Custom frameless window chrome with native macOS traffic lights or Windows/Linux window controls, live unsaved-change indicators, and **Graphite Light / Dark** theming.

---

## Keyboard Shortcuts

| Context     | Shortcut                                      | Action                                                                             |
| :---------- | :-------------------------------------------- | :--------------------------------------------------------------------------------- |
| **Library** | `Ctrl/Cmd + K`                                | Focus library search                                                               |
| **Viewer**  | `Ctrl/Cmd + F`                                | Open in-document search                                                            |
| **Viewer**  | `Ctrl/Cmd + S`                                | Save & burn annotations to PDF                                                     |
| **Viewer**  | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Y`               | Undo / Redo annotation changes                                                     |
| **Viewer**  | `Ctrl/Cmd + Wheel`                            | Zoom in / out                                                                      |
| **Viewer**  | `Ctrl/Cmd + Click`                            | Open internal/external PDF hyperlink                                               |
| **Tools**   | `V` · `H` · `U` · `S` · `N` · `I` · `A` · `E` | Select · Highlight · Underline · Strikethrough · Note · Ink · Figure Crop · Eraser |

---

## File Structure

```text
foliet/
├── src/
│   ├── components/
│   │   ├── ai/                         # AI Studio, Lio chat, RAG search, and summarization UI
│   │   │   ├── AiChatPanel.tsx         # Persistent per-paper chat panel with streaming & citations
│   │   │   ├── AiMascot.tsx            # Interactive SVG Lio mascot with eye tracking & mood states
│   │   │   ├── AiStudioSidebar.tsx     # Resizable right sidebar housing Chat, RAG, and Summary tabs
│   │   │   ├── RagSearchPanel.tsx      # Semantic search, indexing controls, and chunk inspector
│   │   │   ├── SummarizationWorkspace.tsx # Split-screen source selector & synthesis studio
│   │   │   └── SummaryDocsEditor.tsx   # Tiptap Markdown editor with lowlight & crop image resolution
│   │   ├── libraryview/                # Library dashboard components
│   │   │   ├── DocumentTable.tsx       # Paper list with metadata & right-click context actions
│   │   │   └── LibrarySidebar.tsx      # Navigation filters, collections manager, and storage stats
│   │   ├── modals/                     # Application dialogs
│   │   │   ├── ConfirmModal.tsx        # Reusable destructive/confirmation alert modal
│   │   │   └── ToolCustomizerModal.tsx # Preset editor for tool types, ink colors, and shortcuts
│   │   ├── ui/                         # Base UI primitives (Base UI + Tailwind CSS)
│   │   │   ├── alert-dialog.tsx
│   │   │   ├── button.tsx
│   │   │   ├── context-menu.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── input.tsx
│   │   │   ├── popover.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── tabs.tsx
│   │   │   └── tooltip.tsx
│   │   ├── viewer/                     # PDF reading & annotation workspace components
│   │   │   ├── NoteEditorPortal.tsx    # Floating sticky-note editor anchored to note pins
│   │   │   ├── PdfPage.tsx             # Page renderer with back-buffer canvas, markups, ink, & crop layers
│   │   │   ├── PdfSidebar.tsx          # Resizable left sidebar (Outline, Bookmarks, Figure Crops)
│   │   │   ├── PdfToolbar.tsx          # Undo/Redo, tool presets split-button, and AI Studio toggle
│   │   │   ├── SearchOverlay.tsx       # Floating in-document text search bar
│   │   │   ├── SelectionActionBar.tsx  # Floating "Search Web" / "Ask Lio" text-selection popover
│   │   │   └── ViewerHeader.tsx        # Zoom controls, page navigation, search, and bookmark triggers
│   │   ├── Logo.tsx                    # Foliet SVG brand mark and full logo component
│   │   └── Titlebar.tsx                # Custom OS-aware window titlebar & unsaved-state indicator
│   ├── constants/
│   │   ├── models.ts                   # LLM presets, embedding model presets, & default RAG parameters
│   │   └── tools.ts                    # Default annotation tool presets & ink color palette
│   ├── hooks/
│   │   ├── useLibraryCatalog.ts        # Library CRUD, PDF import, and collection state management
│   │   ├── usePdfSearch.ts             # Asynchronous page-text caching and search navigation
│   │   ├── useToolManager.ts           # Active tool state, keyboard shortcuts, and preset persistence
│   │   └── useUndoRedo.ts              # Revision-tracked undo/redo history hook with dirty detection
│   ├── lib/
│   │   └── utils.ts                    # Classname merging utility (`cn`)
│   ├── pages/
│   │   ├── LibraryView.tsx             # Library home view with drag-and-drop PDF opening
│   │   └── ViewerView.tsx              # Main PDF reading, annotation, and AI Studio view
│   ├── services/
│   │   ├── storage/
│   │   │   ├── catalog.ts              # Persistent library catalog & collections (`library.json`)
│   │   │   ├── database.ts             # SQLite persistence for annotations, crops, chats, & summaries
│   │   │   └── settings.ts             # User preferences, tool presets, & AI settings (`settings.json`)
│   │   ├── llm.ts                      # Multi-provider LLM streaming & structured prompt builders
│   │   ├── pdf.ts                      # Tauri IPC wrapper for PDF opening, extraction, & burning
│   │   ├── platform.ts                 # OS detection and shortcut modifier helpers
│   │   ├── rag.ts                      # Typed RAG IPC service (with local mock fallback support)
│   │   └── window.ts                   # Tauri window lifecycle & maximize/close event wrapper
│   ├── stores/
│   │   ├── aiStore.ts                  # Zustand store for LLM config, chats, RAG, & summarization
│   │   ├── documentStore.ts            # Zustand store for active document & multi-source dirty state
│   │   └── systemStore.ts              # Zustand store for OS platform metadata & light/dark theme
│   ├── styles/
│   │   ├── App.css                     # Tailwind theme tokens, Graphite palette, & global base styles
│   │   ├── editor.css                  # Tiptap ProseMirror & lowlight syntax-highlighting styles
│   │   └── pdf-viewer.css              # PDF text-selection & Ctrl-click hyperlink layer styles
│   ├── types/
│   │   ├── annotations.ts              # Annotation models (`TextMarkup`, `Ink`, `Note`, `Crop`) & guards
│   │   ├── catalog.ts                  # Persisted `CatalogItem` interface
│   │   ├── chat.ts                     # LLM providers, chat messages, conversations, & AI state types
│   │   ├── document.ts                 # Document metadata, outline nodes, & bookmark types
│   │   ├── embedding.ts                # Embedding providers, chunks, RAG catalog, & search result types
│   │   ├── props.ts                    # Shared component prop types (`LogoProps`, `TitlebarProps`)
│   │   └── tools.ts                    # Tool types, underline styles, & preset interfaces
│   ├── App.tsx                         # Root layout, view switcher, and unsaved-changes guard
│   ├── main.tsx                        # React application entry point
│   └── vite-env.d.ts                   # Vite TypeScript environment definitions
└── src-tauri/
    └── src/
        ├── pdf_exporter/               # Modular ISO 32000-1 PDF annotation writer
        │   ├── annotations.rs          # Form XObject appearance builders (highlight, ink, note, etc.)
        │   ├── geometry.rs             # Page crop/media box, rotation, & coordinate normalization
        │   └── mod.rs                  # `lopdf` annotation burning & visual-annotation stripping
        ├── lib.rs                      # Tauri setup, plugins, `foliet-pdf` range server, & IPC commands
        ├── main.rs                     # Desktop binary entry point
        ├── pdf_exporter.rs             # Legacy/standalone PDF exporter module
        ├── pdf_models.rs               # Serde DTOs shared between Rust and TypeScript
        └── pdf_reader.rs               # Fast PDF ID hashing (`SHA-256`/trailer) & annotation extractor
```
