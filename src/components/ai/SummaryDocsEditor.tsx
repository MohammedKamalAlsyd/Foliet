/**
 * Foliet - Rich Markdown Docs Editor (Tiptap)
 *
 * MIT Tiptap editor configured with StarterKit, CodeBlockLowlight,
 * @tiptap/markdown, and a custom CropAwareImage NodeView that resolves
 * SQLite-backed `idb://crop-...` figure crop URIs transparently.
 */

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
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
import { DocumentDatabase } from "@/services/storage/database";
import { cn } from "@/lib/utils";

const lowlight = createLowlight(common);
const resolvedCropCache = new Map<string, string>();

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
}

interface SummaryDocsEditorProps {
  markdown: string;
  isStreaming?: boolean;
  onMarkdownChange?: (nextMarkdown: string) => void;
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
  { markdown, isStreaming = false, onMarkdownChange },
  ref,
) {
  const lastSyncedMarkdownRef = useRef<string>(markdown);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreamingRef = useRef<boolean>(isStreaming);
  isStreamingRef.current = isStreaming;

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
    ],
    content: markdown || "",
    contentType: "markdown",
    editable: !isStreaming,
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
      <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">
        <div className="foliet-docs-editor mx-auto max-w-[720px] min-h-full">
          {!markdown && !isStreaming ? (
            <div className="mb-4 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
              Select highlights, sticky notes, figure crops, or chat takeaways
              on the left, then choose Generate to synthesize your document. You
              can also start typing directly here.
            </div>
          ) : null}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
});
