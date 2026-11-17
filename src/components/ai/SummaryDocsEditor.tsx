/**
 * Foliet - Rich Markdown Docs Editor (Tiptap)
 *
 * MIT Tiptap editor configured with StarterKit, CodeBlockLowlight,
 * @tiptap/markdown, a custom CropAwareImage NodeView that resolves
 * SQLite-backed `idb://crop-...` figure crop URIs transparently,
 * drag-and-drop image/figure insertion at exact cursor coordinates,
 * and a living PageCitationDecorator that turns `[Page X]` / `(Page X)`
 * references into clickable jump-and-spotlight badges.
 */

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import {
  Bold,
  Code,
  FileCode,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RagService } from "@/services/rag";
import { DocumentDatabase } from "@/services/storage/database";
import { useDocumentStore } from "@/stores/documentStore";
import { useRagStore } from "@/stores/ragStore";
import { cn } from "@/lib/utils";

const lowlight = createLowlight(common);
const resolvedCropCache = new Map<string, string>();
const pageCitationPluginKey = new PluginKey("folietPageCitations");
const PAGE_CITATION_REGEX =
  /(\[(?:[^\]\n]*?,\s*)?Page\s+(\d+)\])|(\(Page\s+(\d+)\))/gi;

async function spotlightPageFromCitation(pageNumber: number): Promise<void> {
  const activeDoc = useDocumentStore.getState().activeDoc;
  if (!activeDoc) return;

  try {
    const chunks = await RagService.getDocumentChunks(activeDoc.id);
    const pageChunks = chunks.filter((c) => c.pageNumber === pageNumber);
    if (pageChunks.length > 0) {
      const mergedRects = pageChunks
        .flatMap((c) => c.rectSegments ?? [])
        .slice(0, 48);
      useRagStore.getState().setActiveRagHighlight({
        chunkId: pageChunks[0].chunkId,
        docId: activeDoc.id,
        docTitle: activeDoc.title,
        pageNumber,
        text: pageChunks[0].text,
        similarityScore: 1.0,
        rectSegments: mergedRects.length > 0 ? mergedRects : undefined,
      });
      return;
    }
  } catch {
    // Fall back to page-level highlight if the document is not indexed
  }

  useRagStore.getState().setActiveRagHighlight({
    chunkId: `summary-citation-page-${pageNumber}`,
    docId: activeDoc.id,
    docTitle: activeDoc.title,
    pageNumber,
    text: `Summary citation on Page ${pageNumber}`,
    similarityScore: 1.0,
  });
}

function buildCitationDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") {
      return false;
    }
    if (!node.isText || !node.text) {
      return true;
    }

    PAGE_CITATION_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PAGE_CITATION_REGEX.exec(node.text)) !== null) {
      const pageStr = match[2] ?? match[4];
      const pageNum = Number(pageStr);
      if (!Number.isFinite(pageNum) || pageNum < 1) continue;

      const from = pos + match.index;
      const to = from + match[0].length;
      decorations.push(
        Decoration.inline(from, to, {
          "data-citation-page": String(pageNum),
          title: `Jump to Page ${pageNum} & spotlight chunks`,
          class:
            "inline-flex items-center rounded border border-[var(--accent-brand,#2563EB)]/35 bg-[var(--accent-brand,#2563EB)]/10 px-1.5 py-0 mx-0.5 font-mono text-[11px] font-medium text-[var(--accent-brand,#2563EB)] cursor-pointer transition-colors hover:bg-[var(--accent-brand,#2563EB)]/20",
        }),
      );
    }

    return true;
  });

  return DecorationSet.create(doc, decorations);
}

function createPageCitationExtension(
  onJumpRef: React.MutableRefObject<((page: number) => void) | undefined>,
) {
  return Extension.create({
    name: "pageCitationDecorator",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: pageCitationPluginKey,
          state: {
            init: (_config, state) => buildCitationDecorations(state.doc),
            apply: (tr, oldSet) =>
              tr.docChanged ? buildCitationDecorations(tr.doc) : oldSet,
          },
          props: {
            decorations(state) {
              return pageCitationPluginKey.getState(state);
            },
            handleDOMEvents: {
              click: (_view, event) => {
                const target = event.target as HTMLElement | null;
                const badge = target?.closest("[data-citation-page]");
                if (!badge) return false;

                const pageNum = Number(
                  badge.getAttribute("data-citation-page"),
                );
                if (!Number.isFinite(pageNum) || pageNum < 1) return false;

                onJumpRef.current?.(pageNum);
                void spotlightPageFromCitation(pageNum);
                return false;
              },
            },
          },
        }),
      ];
    },
  });
}

/**
 * Resolves an `idb://...` or `db://...` crop URI from SQLite (cached in memory),
 * or returns standard `data:` / `http(s):` URLs unchanged.
 */
export async function resolveCropImageSrc(src: string): Promise<string | null> {
  if (!src) return null;
  if (
    src.startsWith("data:") ||
    src.startsWith("http://") ||
    src.startsWith("https://")
  ) {
    return src;
  }

  const cached = resolvedCropCache.get(src);
  if (cached) return cached;

  if (
    src.startsWith("idb://") ||
    src.startsWith("db://") ||
    src.startsWith("crop-")
  ) {
    const dataUrl = await DocumentDatabase.getFigureCrop(src);
    if (dataUrl) {
      resolvedCropCache.set(src, dataUrl);
      return dataUrl;
    }
  }

  return null;
}

/**
 * Expands `idb://...` image links in exported Markdown to standalone data URIs
 * so exported `.md` files render figures in external Markdown viewers.
 */
export async function resolveMarkdownCropImages(
  markdown: string,
): Promise<string> {
  const matches = Array.from(
    markdown.matchAll(/!\[([^\]]*)\]\((idb:\/\/[^)\s]+|db:\/\/[^)\s]+)\)/g),
  );
  if (matches.length === 0) return markdown;

  let result = markdown;
  for (const match of matches) {
    const uri = match[2];
    const resolved = await resolveCropImageSrc(uri);
    if (resolved) {
      result = result.split(`(${uri})`).join(`(${resolved})`);
    }
  }
  return result;
}

const CropImageNodeView: React.FC<NodeViewProps> = ({
  node,
  selected,
  deleteNode,
  editor,
}) => {
  const rawSrc = String(node.attrs.src || "");
  const alt = String(node.attrs.alt || "");
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() => {
    if (
      rawSrc.startsWith("data:") ||
      rawSrc.startsWith("http://") ||
      rawSrc.startsWith("https://")
    ) {
      return rawSrc;
    }
    return resolvedCropCache.get(rawSrc) ?? null;
  });
  const [isMissing, setIsMissing] = useState(false);

  useEffect(() => {
    let active = true;
    setIsMissing(false);

    if (
      rawSrc.startsWith("data:") ||
      rawSrc.startsWith("http://") ||
      rawSrc.startsWith("https://")
    ) {
      setResolvedSrc(rawSrc);
      return;
    }

    const cached = resolvedCropCache.get(rawSrc);
    if (cached) {
      setResolvedSrc(cached);
      return;
    }

    resolveCropImageSrc(rawSrc)
      .then((url) => {
        if (!active) return;
        if (url) {
          setResolvedSrc(url);
        } else {
          setResolvedSrc(null);
          setIsMissing(true);
        }
      })
      .catch(() => {
        if (active) setIsMissing(true);
      });

    return () => {
      active = false;
    };
  }, [rawSrc]);

  return (
    <NodeViewWrapper className="my-4 not-prose select-none">
      <figure
        className={cn(
          "overflow-hidden rounded-xl border bg-muted/40 p-2 transition-colors duration-150 ease-[var(--ease-foliet)]",
          selected ? "border-[var(--accent-brand)]" : "border-border",
        )}
      >
        {resolvedSrc ? (
          <img
            src={resolvedSrc}
            alt={alt || "Captured PDF figure"}
            className="mx-auto max-h-[360px] w-auto max-w-full rounded-lg border border-border bg-white object-contain"
          />
        ) : (
          <div className="flex h-32 items-center justify-center gap-2 rounded-lg border border-border bg-card text-xs text-muted-foreground">
            <ImageIcon size={16} strokeWidth={1.5} />
            <span>
              {isMissing
                ? "Captured figure could not be loaded"
                : "Loading figure"}
            </span>
          </div>
        )}

        <figcaption className="mt-2 flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
          <span className="truncate">{alt || "Captured PDF figure"}</span>
          {editor.isEditable && (
            <button
              type="button"
              onClick={() => deleteNode()}
              title="Remove figure from summary"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-destructive"
            >
              <Trash2 size={13} strokeWidth={1.5} />
            </button>
          )}
        </figcaption>
      </figure>
    </NodeViewWrapper>
  );
};

const CropAwareImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CropImageNodeView);
  },
});

export interface SummaryDocsEditorHandle {
  insertImage: (attrs: { src: string; alt?: string }) => void;
  getMarkdown: () => string;
  scrollToHeading: (title: string) => void;
}

interface SummaryDocsEditorProps {
  markdown: string;
  isStreaming?: boolean;
  onMarkdownChange?: (nextMarkdown: string) => void;
  onJumpToPage?: (page: number) => void;
}

interface ToolbarButtonProps {
  label: string;
  isActive?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  label,
  isActive,
  disabled,
  onClick,
  children,
}) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    title={label}
    aria-label={label}
    aria-pressed={isActive}
    disabled={disabled}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className={cn(
      "h-7 w-7 rounded-md transition-colors duration-150 ease-[var(--ease-foliet)]",
      isActive
        ? "bg-accent text-foreground border border-border"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    )}
  >
    {children}
  </Button>
);

export const SummaryDocsEditor = forwardRef<
  SummaryDocsEditorHandle,
  SummaryDocsEditorProps
>(function SummaryDocsEditor(
  { markdown, isStreaming = false, onMarkdownChange, onJumpToPage },
  ref,
) {
  const lastSyncedMarkdownRef = useRef<string>(markdown);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreamingRef = useRef<boolean>(isStreaming);
  const onJumpToPageRef = useRef(onJumpToPage);
  const [isDragOver, setIsDragOver] = useState(false);

  isStreamingRef.current = isStreaming;
  onJumpToPageRef.current = onJumpToPage;

  const citationExtension = useMemo(
    () => createPageCitationExtension(onJumpToPageRef),
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: "plaintext",
      }),
      CropAwareImage.configure({
        inline: false,
        allowBase64: true,
      }),
      Markdown,
      citationExtension,
    ],
    content: markdown || "",
    contentType: "markdown",
    editable: !isStreaming,
    editorProps: {
      handleDrop: (view, event, _slice, moved) => {
        if (moved || isStreamingRef.current) return false;
        setIsDragOver(false);

        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        const dropPos = coords?.pos ?? view.state.selection.to;

        // 1. Dropped Foliet figure crop from PdfSidebar
        const cropPayload = event.dataTransfer?.getData(
          "application/x-foliet-crop",
        );
        if (cropPayload) {
          event.preventDefault();
          try {
            const parsed = JSON.parse(cropPayload) as {
              src?: string;
              alt?: string;
            };
            if (parsed?.src) {
              const imgNode = view.state.schema.nodes.image?.create({
                src: parsed.src,
                alt: parsed.alt || "Captured PDF figure",
              });
              if (imgNode) {
                const tr = view.state.tr.insert(dropPos, imgNode);
                view.dispatch(tr);
                view.focus();
                return true;
              }
            }
          } catch {
            // Fall through
          }
        }

        // 2. Dropped OS image file
        const files = Array.from(event.dataTransfer?.files ?? []);
        const imageFile = files.find((f) => f.type.startsWith("image/"));
        if (imageFile) {
          event.preventDefault();
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl =
              typeof reader.result === "string" ? reader.result : null;
            if (!dataUrl) return;
            const imgNode = view.state.schema.nodes.image?.create({
              src: dataUrl,
              alt: imageFile.name || "Embedded image",
            });
            if (imgNode) {
              const safePos = Math.min(dropPos, view.state.doc.content.size);
              const tr = view.state.tr.insert(safePos, imgNode);
              view.dispatch(tr);
              view.focus();
            }
          };
          reader.readAsDataURL(imageFile);
          return true;
        }

        return false;
      },
      handleDOMEvents: {
        dragover: (_view, event) => {
          const types = Array.from(event.dataTransfer?.types ?? []);
          if (
            types.includes("application/x-foliet-crop") ||
            types.includes("Files")
          ) {
            event.preventDefault();
            setIsDragOver(true);
            return true;
          }
          return false;
        },
        dragleave: () => {
          setIsDragOver(false);
          return false;
        },
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      if (isStreamingRef.current) return;
      const nextMd = activeEditor.getMarkdown();
      lastSyncedMarkdownRef.current = nextMd;
      onMarkdownChange?.(nextMd);
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      insertImage: ({ src, alt }) => {
        if (!editor || isStreamingRef.current) return;
        editor
          .chain()
          .focus()
          .setImage({ src, alt: alt || "Captured PDF figure" })
          .run();
      },
      getMarkdown: () => editor?.getMarkdown() ?? lastSyncedMarkdownRef.current,
      scrollToHeading: (title: string) => {
        if (!editor) return;
        const normalized = title.toLowerCase().trim();
        const headings = Array.from(
          editor.view.dom.querySelectorAll("h1, h2, h3"),
        ) as HTMLElement[];
        const target = headings.find(
          (h) => (h.textContent || "").toLowerCase().trim() === normalized,
        );
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    }),
    [editor],
  );

  // Toggle editability cleanly when streaming starts/finishes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!isStreaming);
  }, [editor, isStreaming]);

  // Sync external Markdown updates (initial load, regeneration, or streaming chunks)
  useEffect(() => {
    if (!editor) return;
    if (markdown === lastSyncedMarkdownRef.current) return;

    const applyContent = () => {
      lastSyncedMarkdownRef.current = markdown;
      editor.commands.setContent(markdown || "", {
        emitUpdate: false,
        contentType: "markdown",
      });
    };

    if (isStreaming) {
      if (streamTimerRef.current) return;
      streamTimerRef.current = setTimeout(() => {
        streamTimerRef.current = null;
        applyContent();
      }, 64);
      return;
    }

    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    applyContent();
  }, [editor, markdown, isStreaming]);

  useEffect(() => {
    return () => {
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
      }
    };
  }, []);

  const controlsDisabled = !editor || isStreaming;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Sticky Formatting Toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-3">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <ToolbarButton
            label="Undo"
            disabled={controlsDisabled || !editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={14} strokeWidth={1.5} />
          </ToolbarButton>
          <ToolbarButton
            label="Redo"
            disabled={controlsDisabled || !editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={14} strokeWidth={1.5} />
          </ToolbarButton>

          <div className="mx-1 h-4 w-px bg-border" />

          <ToolbarButton
            label="Heading 1"
            isActive={editor?.isActive("heading", { level: 1 })}
            disabled={controlsDisabled}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 1 }).run()
            }
          >
            <Heading1 size={14} strokeWidth={1.5} />
          </ToolbarButton>
          <ToolbarButton
            label="Heading 2"
            isActive={editor?.isActive("heading", { level: 2 })}
            disabled={controlsDisabled}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 size={14} strokeWidth={1.5} />
          </ToolbarButton>
          <ToolbarButton
            label="Heading 3"
            isActive={editor?.isActive("heading", { level: 3 })}
            disabled={controlsDisabled}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 3 }).run()
            }
          >
            <Heading3 size={14} strokeWidth={1.5} />
          </ToolbarButton>

          <div className="mx-1 h-4 w-px bg-border" />

          <ToolbarButton
            label="Bold"
            isActive={editor?.isActive("bold")}
            disabled={controlsDisabled}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold size={14} strokeWidth={1.5} />
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            isActive={editor?.isActive("italic")}
            disabled={controlsDisabled}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic size={14} strokeWidth={1.5} />
          </ToolbarButton>

          <div className="mx-1 h-4 w-px bg-border" />

          <ToolbarButton
            label="Bullet List"
            isActive={editor?.isActive("bulletList")}
            disabled={controlsDisabled}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List size={14} strokeWidth={1.5} />
          </ToolbarButton>
          <ToolbarButton
            label="Ordered List"
            isActive={editor?.isActive("orderedList")}
            disabled={controlsDisabled}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={14} strokeWidth={1.5} />
          </ToolbarButton>
          <ToolbarButton
            label="Blockquote"
            isActive={editor?.isActive("blockquote")}
            disabled={controlsDisabled}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote size={14} strokeWidth={1.5} />
          </ToolbarButton>

          <div className="mx-1 h-4 w-px bg-border" />

          <ToolbarButton
            label="Inline Code"
            isActive={editor?.isActive("code")}
            disabled={controlsDisabled}
            onClick={() => editor?.chain().focus().toggleCode().run()}
          >
            <Code size={14} strokeWidth={1.5} />
          </ToolbarButton>
          <ToolbarButton
            label="Code Block"
            isActive={editor?.isActive("codeBlock")}
            disabled={controlsDisabled}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            <FileCode size={14} strokeWidth={1.5} />
          </ToolbarButton>
        </div>

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {isStreaming ? "Writing" : "Markdown"}
        </span>
      </div>

      {/* Document Surface */}
      <div
        className={cn(
          "flex-1 overflow-y-auto px-5 py-5 sm:px-7 transition-colors",
          isDragOver &&
            "bg-[var(--accent-brand,#2563EB)]/5 ring-2 ring-inset ring-[var(--accent-brand,#2563EB)]/40",
        )}
      >
        <div className="foliet-docs-editor mx-auto max-w-[720px] min-h-full">
          {!markdown && !isStreaming ? (
            <div className="mb-4 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
              Select a chapter (or Full Book) and click Generate below, drag
              figures from the left Figures tab, or start typing directly.
            </div>
          ) : null}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
});
