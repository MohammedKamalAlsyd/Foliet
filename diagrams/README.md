# Foliet Architecture Diagrams

Visual reference explaining Foliet's frontend, Rust backend, storage, AI/RAG pipelines, encrypted secret storage, and auto-updater architecture.

> **Viewing Tip:** GitHub renders Mermaid diagrams natively when you open any `.md` file below. In VS Code, install the *Markdown Preview Mermaid Support* extension to view them inline.

## Diagram Index

1. **[01 — High-Level System Architecture](./01-system-architecture.md)**
   Full component map across React UI, Zustand stores, services/token compressor, Tauri IPC / custom URI protocol, Rust modules, and local databases.
2. **[02 — PDF Streaming & ISO 32000-1 Annotation Burning](./02-pdf-streaming-and-annotations.md)**
   Sequence of opening a PDF (`SHA-256` / `/ID` hashing), HTTP `206 Partial Content` streaming via `foliet-pdf://`, virtualized rendering, Undo/Redo, and `lopdf` Form XObject burning.
3. **[03 — AI Copilot, Offline Rust ONNX RAG & Summary Compression](./03-ai-rag-and-summary-pipeline.md)**
   How local ONNX embeddings (`ort` + `tokenizers` + `rag.db`), Lio's 4 active PDF tools, deterministic prompt compression (`tokenCompressor.ts`), and the Summarize studio work together.
4. **[04 — Encrypted Secrets Vault & Signed Auto-Updater](./04-secrets-and-auto-updater.md)**
   AES-256-GCM `secrets.enc` + OS Credential Manager (`keyring`) key lifecycle, legacy plaintext scrubbing, and GitHub Actions release + `tauri-plugin-updater` dirty-document safety guard.
