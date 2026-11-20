# 02 — PDF Streaming & ISO 32000-1 Annotation Burning

This sequence diagram shows how Foliet opens large PDFs without loading them into IPC memory, renders pages virtually, tracks edits with `zundo`, and burns annotations back into the PDF file with Rust `lopdf`.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as "ViewerView + PdfPage"
    participant Stores as "documentStore + annotationStore (zundo)"
    participant DB as "foliet.db (SQLite)"
    participant Proto as "foliet-pdf:// (lib.rs FILE_POOL)"
    participant Reader as "pdf_reader.rs"
    participant Exporter as "pdf_exporter/ (lopdf)"

    %% 1. Fast Document Open
    User->>UI: Open PDF (picker / drag-and-drop)
    UI->>Reader: invoke("open_pdf_document", filePath)
    Reader-->>Reader: Read trailer /ID or SHA-256 head 64KB -> docId
    Reader-->>UI: PdfOpenResult (docId, title, fileSize)
    UI->>Stores: openDocument(doc) + load annotations & bookmarks from DB
    DB-->>Stores: Saved annotations & crops

    %% 2. Lazy Background Annotation Extraction & Streaming
    par Background Embedded Extraction
        UI->>Reader: invoke("extract_pdf_annotations", filePath)
        Reader-->>UI: Embedded PDF annotations (mapped to normalized 0..1 coords)
    and HTTP 206 Byte-Range Streaming
        UI->>Proto: GET foliet-pdf://localhost/<path> (Range: bytes=0-1048575)
        Proto->>Proto: strip_visual_annotations() into 8-slot Memory FILE_POOL
        Proto-->>UI: 206 Partial Content (PDF byte chunks)
        UI-->>User: Virtualized PdfPage renders Canvas + TextLayer + Back-buffer
    end

    %% 3. In-Memory Annotation Editing & Undo/Redo
    User->>UI: Highlight / Underline / Sticky Note / Ink / Crop
    UI->>Stores: addAnnotation() -> pushes zundo history + sets isDirty = true
    UI->>DB: Persist working annotations/crops to SQLite

    opt Undo / Redo
        User->>UI: Press Ctrl+Z / Ctrl+Y
        UI->>Stores: zundo temporal.undo() / redo()
    end

    %% 4. Native ISO 32000-1 Burn & Save
    User->>UI: Press Ctrl+S (Burn & Save)
    UI->>Exporter: invoke("export_pdf", sourcePath, targetPath, annotations)
    Exporter->>Exporter: Strip prior visual annots, build Form XObject streams, lock /ID
    Exporter->>Proto: evict_cached_file(sourcePath)
    Exporter-->>User: Write updated ISO 32000-1 PDF to disk
    UI->>Stores: clearDirty() -> Titlebar shows "Saved"
```
