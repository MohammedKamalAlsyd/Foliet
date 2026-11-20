# 03 — AI Copilot, Offline Rust ONNX RAG & Summary Compression

This diagram covers two core AI workflows:
1. **Offline Rust ONNX RAG + Lio Copilot Tool Execution**
2. **Zero-Highlight Summary Studio + Token Compressor Pipeline**

```mermaid
flowchart LR
    subgraph Indexing["A. Offline Rust ONNX Indexing (src-tauri/src/rag/)"]
        PdfFile["Source PDF"] --> Extract["pdf_text.rs\nExtract lines + normalized rects"]
        Extract --> Chunk["Chunker\n32-line window, 6-line overlap"]
        Chunk --> Embed["embedder.rs (ort + tokenizers)\n384-dim f32 vectors (MedEmbed)"]
        Embed --> RagDb[("rag.db\nSQLite WAL")]
    end

    subgraph ChatFlow["B. Lio Chat & Active PDF Tools (chatStore.ts)"]
        UserQ["User Question\n(+ optional Selection snippet)"] --> RagQuery["rag_search\nCosine similarity + Top-K"]
        RagDb --> RagQuery
        RagQuery --> RagComp["tokenCompressor:\ncompressRagPassages()\nDedupe overlap lines"]
        History["Previous Chat Turns"] --> HistComp["tokenCompressor:\ncompressChatHistory()\nKeep last 6 turns verbatim"]
        RagComp --> LlmCall["Vercel AI SDK\n(OpenRouter / OpenAI / Anthropic / Gemini / Ollama)"]
        HistComp --> LlmCall
        LlmCall -->|"Tool calls (maxSteps: 3)"| Tools["buildCopilotTools()"]
        Tools --> T1["navigate_to(page)"]
        Tools --> T2["highlight_passage(page, text)"]
        Tools --> T3["explain_figure(page)"]
        Tools --> T4["add_figure_to_summary(page)"]
        T1 --> ViewerJump["Viewer jumps & spotlights [Page X]"]
        T2 --> AnnotAdd["Persists highlight annotation"]
        T4 --> SummaryInsert["Dispatches foliet:insert-summary-image"]
    end
```

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Studio as "SummarizationWorkspace (Summarize Tab)"
    participant Store as "summaryStore.ts"
    participant Utils as "summaryUtils.ts"
    participant Comp as "tokenCompressor.ts"
    participant LLM as "LlmService (providers.ts)"
    participant DB as "foliet.db (doc_summaries & backups)"

    User->>Studio: Pick scope (Entire Document or Chapter), Style (Study/Brief/Technical), optional Notes/Chats
    User->>Studio: Click starter chip, "Summarize", or type custom prompt
    Studio->>Store: generateChapterSummary / generateFullBookSummary / modifySummaryWithInstruction

    Store->>DB: Snapshot existing summary into doc_summary_backups (enables Restore)
    Store->>Utils: fetchCompressedRangeText(docId, pdfProxy, startPage, endPage)
    Utils->>Utils: Read rag.db chunks OR fallback PdfService.extractPageRangeText()
    Utils->>Comp: compressDocumentText(rawText, maxChars)
    Comp-->>Utils: Strip running headers/footers, rejoin hyphens, drop References, fit salience budget
    Utils-->>Store: Compressed PDF text + CompressionStats (-XX% tokens)

    opt Optional Context (only if toggled & non-empty)
        Utils->>Utils: Collect deduplicated highlights, notes, chat excerpts, and idb:// vision crops
    end

    Store->>LLM: streamChat(compact systemPrompt + compressed PDF text + optional context)
    loop Streaming chunks
        LLM-->>Store: Markdown token chunk
        Store-->>Studio: Stream live into Tiptap SummaryDocsEditor
    end

    Store->>DB: Save final Markdown to doc_summaries
    User->>Studio: Edit manually -> 700ms debounced auto-save (flushes immediately on close)
```
