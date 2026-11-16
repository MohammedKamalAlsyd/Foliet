This is **Response 2 of 3** for Phase 5. It adds the Light/Dark Tiptap + Lowlight styles to `src/styles/App.css` and creates the rich Markdown editor component `src/components/ai/SummaryDocsEditor.tsx` (with support for live `idb://` figure crop rendering).

---

### Step 1 — Full Code: `src/styles/App.css`

Changes from your existing file:
- Kept every existing line untouched.
- Appended `.foliet-docs-editor` typography and `.hljs-*` syntax-highlighting rules at the bottom using your Light and Dark Graphite + Terracotta tokens.

```css
/* src/styles/App.css */
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans:
    "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", "Geist Mono", ui-monospace, monospace;

  /* Map shadcn/Base UI tokens -> Foliet Graphite & Terracotta system */
  --color-background: var(--bg-page);
  --color-foreground: var(--text-primary);
  --color-card: var(--bg-card);
  --color-card-foreground: var(--text-primary);
  --color-popover: var(--bg-card);
  --color-popover-foreground: var(--text-primary);
  --color-primary: var(--btn-primary-bg);
  --color-primary-foreground: var(--btn-primary-fg);
  --color-secondary: var(--bg-raised);
  --color-secondary-foreground: var(--text-primary);
  --color-muted: var(--bg-raised);
  --color-muted-foreground: var(--text-muted);
  --color-accent: var(--bg-raised);
  --color-accent-foreground: var(--text-primary);
  --color-destructive: var(--semantic-negative);
  --color-destructive-foreground: #ffffff;
  --color-border: var(--hairline);
  --color-input: var(--hairline);
  --color-ring: var(--accent-brand);

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
}

:root {
  /* Graphite Light */
  --bg-deep: #f4f4f5;
  --bg-page: #fafafa;
  --bg-card: #ffffff;
  --bg-raised: #f4f4f5;
  --hairline: rgba(23, 23, 23, 0.08);
  --hairline-strong: rgba(23, 23, 23, 0.16);

  /* Three text roles */
  --text-primary: #171717;
  --text-secondary: #525252;
  --text-muted: #737373;

  /* Primary button (primary ink fill) & single world accent (bookmark terracotta) */
  --btn-primary-bg: #171717;
  --btn-primary-fg: #ffffff;
  --accent-brand: #b44327;
  --accent-brand-fg: #ffffff;
  --selection-bg: rgba(180, 67, 39, 0.18);

  /* Semantic */
  --semantic-positive: #16a34a;
  --semantic-negative: #dc2626;

  /* Surface elevation */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-float: 0 8px 24px rgba(0, 0, 0, 0.06);

  --ease-foliet: cubic-bezier(0.22, 1, 0.36, 1);
}

.dark {
  /* Graphite Dark */
  --bg-deep: #0f0f10;
  --bg-page: #141415;
  --bg-card: #19191b;
  --bg-raised: #232325;
  --hairline: rgba(237, 237, 237, 0.08);
  --hairline-strong: rgba(237, 237, 237, 0.16);

  /* Three text roles */
  --text-primary: #ededed;
  --text-secondary: #a1a1a6;
  --text-muted: #85858b;

  /* Primary button (off-white ramp) & single world accent (bookmark terracotta) */
  --btn-primary-bg: #ededed;
  --btn-primary-fg: #141415;
  --accent-brand: #df6a47;
  --accent-brand-fg: #141415;
  --selection-bg: rgba(223, 106, 71, 0.28);

  /* Semantic */
  --semantic-positive: #4cc38a;
  --semantic-negative: #e5484d;

  /* Dark depth comes from surface steps + hairlines */
  --shadow-sm: none;
  --shadow-float: 0 12px 32px rgba(0, 0, 0, 0.45);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background-color: var(--bg-page);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 20px;
  -webkit-font-smoothing: antialiased;
}

[data-tauri-drag-region] {
  -webkit-app-region: drag;
  user-select: none;
}

[data-tauri-drag-region] button,
[data-tauri-drag-region] input,
[data-tauri-drag-region] a,
.no-drag {
  -webkit-app-region: no-drag;
}

::selection {
  background-color: var(--selection-bg);
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--hairline-strong);
  border-radius: 9999px;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Signature: crisp keycap on 4px grid */
kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 16px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  background-color: var(--bg-raised);
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  user-select: none;
}

/* =========================================================================
   Foliet Summary Docs Editor (Tiptap + Lowlight, Light & Dark Graphite)
   ========================================================================= */

.foliet-docs-editor .ProseMirror {
  outline: none;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 22px;
}

.foliet-docs-editor .ProseMirror > * + * {
  margin-top: 12px;
}

.foliet-docs-editor .ProseMirror h1 {
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--text-primary);
  margin-top: 24px;
  margin-bottom: 8px;
}

.foliet-docs-editor .ProseMirror h1:first-child {
  margin-top: 0;
}

.foliet-docs-editor .ProseMirror h2 {
  font-size: 18px;
  line-height: 24px;
  font-weight: 600;
  color: var(--text-primary);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--hairline);
  margin-top: 20px;
  margin-bottom: 8px;
}

.foliet-docs-editor .ProseMirror h3 {
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 16px;
  margin-bottom: 4px;
}

.foliet-docs-editor .ProseMirror p {
  color: var(--text-primary);
}

.foliet-docs-editor .ProseMirror strong {
  font-weight: 600;
  color: var(--text-primary);
}

.foliet-docs-editor .ProseMirror ul {
  list-style-type: disc;
  padding-left: 20px;
}

.foliet-docs-editor .ProseMirror ol {
  list-style-type: decimal;
  padding-left: 20px;
}

.foliet-docs-editor .ProseMirror li + li {
  margin-top: 4px;
}

.foliet-docs-editor .ProseMirror blockquote {
  border-left: 2px solid var(--accent-brand);
  padding-left: 16px;
  color: var(--text-secondary);
  margin: 12px 0;
}

.foliet-docs-editor .ProseMirror hr {
  border: none;
  border-top: 1px solid var(--hairline);
  margin: 20px 0;
}

.foliet-docs-editor .ProseMirror code {
  font-family: var(--font-mono);
  font-size: 12.5px;
  background-color: var(--bg-raised);
  border: 1px solid var(--hairline);
  border-radius: 4px;
  padding: 1px 5px;
  color: var(--text-primary);
}

.foliet-docs-editor .ProseMirror pre {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 20px;
  background-color: var(--bg-deep);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  padding: 12px 16px;
  overflow-x: auto;
  color: var(--text-primary);
}

.foliet-docs-editor .ProseMirror pre code {
  background: transparent;
  border: none;
  padding: 0;
  font-size: inherit;
  color: inherit;
}

/* Lowlight syntax tokens — Light */
.foliet-docs-editor .hljs-comment,
.foliet-docs-editor .hljs-quote {
  color: #737373;
}

.foliet-docs-editor .hljs-keyword,
.foliet-docs-editor .hljs-selector-tag,
.foliet-docs-editor .hljs-subst {
  color: #b44327;
}

.foliet-docs-editor .hljs-number,
.foliet-docs-editor .hljs-literal,
.foliet-docs-editor .hljs-variable,
.foliet-docs-editor .hljs-template-variable {
  color: #0369a1;
}

.foliet-docs-editor .hljs-string,
.foliet-docs-editor .hljs-doctag {
  color: #15803d;
}

.foliet-docs-editor .hljs-title,
.foliet-docs-editor .hljs-section,
.foliet-docs-editor .hljs-built_in {
  color: #6d28d9;
}

.foliet-docs-editor .hljs-type,
.foliet-docs-editor .hljs-class .hljs-title {
  color: #b45309;
}

/* Lowlight syntax tokens — Dark */
.dark .foliet-docs-editor .hljs-comment,
.dark .foliet-docs-editor .hljs-quote {
  color: #85858b;
}

.dark .foliet-docs-editor .hljs-keyword,
.dark .foliet-docs-editor .hljs-selector-tag,
.dark .foliet-docs-editor .hljs-subst {
  color: #df6a47;
}

.dark .foliet-docs-editor .hljs-number,
.dark .foliet-docs-editor .hljs-literal,
.dark .foliet-docs-editor .hljs-variable,
.dark .foliet-docs-editor .hljs-template-variable {
  color: #60a5fa;
}

.dark .foliet-docs-editor .hljs-string,
.dark .foliet-docs-editor .hljs-doctag {
  color: #4cc38a;
}

.dark .foliet-docs-editor .hljs-title,
.dark .foliet-docs-editor .hljs-section,
.dark .foliet-docs-editor .hljs-built_in {
  color: #c4b5fd;
}

.dark .foliet-docs-editor .hljs-type,
.dark .foliet-docs-editor .hljs-class .hljs-title {
  color: #fbbf24;
}
```

---

### Step 2 — New File: `src/components/ai/SummaryDocsEditor.tsx`

Key features implemented:
- Tiptap `StarterKit` (with `codeBlock: false`), `CodeBlockLowlight` (`common` languages via `lowlight`), `Markdown` (`@tiptap/markdown`), and `CropAwareImage` (`@tiptap/extension-image` + custom React NodeView).
- `resolveCropImageSrc` + `resolveMarkdownCropImages` helpers with an in-memory cache so `idb://crop-...` images resolve asynchronously from `DocumentDatabase.getFigureCrop` inside the editor without storing huge base64 blobs inside the Markdown document itself, and can be expanded into self-contained `data:` URIs when exporting `.md`.
- Sticky Foliet toolbar with Undo/Redo, H1/H2/H3, Bold, Italic, Bullet/Ordered List, Blockquote, Inline Code, and Code Block.
- Smooth throttled Markdown syncing during LLM streaming (`editable` locked while streaming, editable immediately on completion).

```typescript
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
export async function resolveMarkdownCropImages(markdown: string): Promise<string> {
    const matches = Array.from(
        markdown.matchAll(/!\[([^\]]*)\]\((idb:\/\/[^)\s]+|db:\/\/[^)\s]+)\)/g)
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
                    selected
                        ? "border-[var(--accent-brand)]"
                        : "border-border"
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
                    <span className="truncate">
                        {alt || "Captured PDF figure"}
                    </span>
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
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
    >
        {children}
    </Button>
);

export const SummaryDocsEditor = forwardRef<
    SummaryDocsEditorHandle,
    SummaryDocsEditorProps
>(function SummaryDocsEditor({ markdown, isStreaming = false, onMarkdownChange }, ref) {
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
        [editor]
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
                        onClick={() =>
                            editor?.chain().focus().toggleBulletList().run()
                        }
                    >
                        <List size={14} strokeWidth={1.5} />
                    </ToolbarButton>
                    <ToolbarButton
                        label="Ordered List"
                        isActive={editor?.isActive("orderedList")}
                        disabled={controlsDisabled}
                        onClick={() =>
                            editor?.chain().focus().toggleOrderedList().run()
                        }
                    >
                        <ListOrdered size={14} strokeWidth={1.5} />
                    </ToolbarButton>
                    <ToolbarButton
                        label="Blockquote"
                        isActive={editor?.isActive("blockquote")}
                        disabled={controlsDisabled}
                        onClick={() =>
                            editor?.chain().focus().toggleBlockquote().run()
                        }
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
                        onClick={() =>
                            editor?.chain().focus().toggleCodeBlock().run()
                        }
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
                            Select highlights, sticky notes, figure crops, or chat takeaways on the left, then choose Generate to synthesize your document. You can also start typing directly here.
                        </div>
                    ) : null}
                    <EditorContent editor={editor} />
                </div>
            </div>
        </div>
    );
});
```

---

**Next (Response 3 of 3):** `src/components/ai/SummarizationWorkspace.tsx`, `src/components/ai/AiStudioSidebar.tsx` (Summarize tab launch panel + workspace host), and the minimal diff in `src/pages/ViewerView.tsx` (passing live annotations + crops). Let me know when you're ready for Response 3!
This is **Response 3 of 3** for Phase 5. It adds `src/components/ai/SummarizationWorkspace.tsx`, updates the Summarize tab in `src/components/ai/AiStudioSidebar.tsx`, and passes live annotations & crops from `src/pages/ViewerView.tsx` with minimal diff.

---

### Step 1 — New File: `src/components/ai/SummarizationWorkspace.tsx`

Key features implemented:
- Full-viewport split-screen workspace overlay with clean Foliet header bar: document title, `AiMascot` (`thinking` / `speaking` / `idle`), save status, **Summary Focus** selector (*Executive Brief*, *Study Notes*, *Technical & Code*), **Generate / Regenerate / Stop**, **Copy Markdown**, **Export `.md`** (via `@tauri-apps/plugin-dialog` `save` + `@tauri-apps/plugin-fs` `writeTextFile`, resolving `idb://` crops to data URIs on export), and **Close**.
- **Left Pane**: Page-grouped user **Highlights, Underlines & Sticky Notes** with color dots and checkboxes (all included by default), **Captured Figure Crops** with thumbnails, checkboxes, and one-click **Insert** into the editor at the cursor, plus a collapsible **Saved Lio Chat Takeaways** section.
- **Right Pane**: `SummaryDocsEditor` streaming directly from `useAiStore.generateStructuredSummary` and debounce-saving edits into `DocumentDatabase.saveSummary`.

```typescript
/**
 * Foliet - Split-Screen AI Summarization Workspace
 *
 * Pairs user-curated PDF highlights, underlines, sticky notes, figure crops,
 * and saved Lio chat takeaways (left pane) with a live Markdown-backed
 * Tiptap Docs editor (right pane) that auto-saves to SQLite.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import {
    Check,
    ChevronDown,
    ChevronRight,
    Copy,
    Download,
    ImagePlus,
    MessageSquare,
    RefreshCw,
    Square,
    X,
} from "lucide-react";
import { AiMascot, type MascotState } from "@/components/ai/AiMascot";
import {
    SummaryDocsEditor,
    resolveCropImageSrc,
    resolveMarkdownCropImages,
    type SummaryDocsEditorHandle,
} from "@/components/ai/SummaryDocsEditor";
import { Button } from "@/components/ui/button";
import type { SummaryFocusMode } from "@/services/llm";
import { RagService } from "@/services/rag";
import { DocumentDatabase } from "@/services/storage/database";
import { useAiStore } from "@/stores/aiStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSystemStore } from "@/stores/systemStore";
import {
    isCropAnnotation,
    isNoteAnnotation,
    isTextMarkupAnnotation,
    type CropAnnotation,
    type NoteAnnotation,
    type PdfAnnotation,
    type TextMarkupAnnotation,
} from "@/types/annotations";
import { cn } from "@/lib/utils";

interface SummarizationWorkspaceProps {
    annotations?: PdfAnnotation[];
}

const FOCUS_OPTIONS: Array<{ value: SummaryFocusMode; label: string }> = [
    { value: "executive", label: "Executive Brief" },
    { value: "study", label: "Study Notes" },
    { value: "technical", label: "Technical & Code" },
];

const CropThumbnail: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
    const [resolved, setResolved] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        resolveCropImageSrc(src)
            .then((url) => {
                if (active) setResolved(url);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [src]);

    if (!resolved) {
        return (
            <div className="flex h-20 w-full items-center justify-center rounded-md border border-border bg-muted text-[11px] text-muted-foreground">
                Loading figure
            </div>
        );
    }

    return (
        <img
            src={resolved}
            alt={alt}
            className="max-h-28 w-full rounded-md border border-border bg-white object-contain"
        />
    );
};

export const SummarizationWorkspace: React.FC<SummarizationWorkspaceProps> = ({
    annotations: liveAnnotations,
}) => {
    const activeDoc = useDocumentStore((s) => s.activeDoc);
    const theme = useSystemStore((s) => s.theme);

    const {
        isSummaryWorkspaceOpen,
        setSummaryWorkspaceOpen,
        summaryFocusMode,
        setSummaryFocusMode,
        activeSummary,
        isSummarizing,
        loadSummary,
        generateStructuredSummary,
        cancelSummaryStreaming,
        conversations,
        loadConversations,
    } = useAiStore();

    const editorRef = useRef<SummaryDocsEditorHandle | null>(null);
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingSaveMarkdownRef = useRef<string | null>(null);

    const [fallbackAnnotations, setFallbackAnnotations] = useState<PdfAnnotation[]>([]);
    const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());
    const [includedChatIds, setIncludedChatIds] = useState<Set<string>>(() => new Set());
    const [chatsExpanded, setChatsExpanded] = useState(false);

    const [draftMarkdown, setDraftMarkdown] = useState("");
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
    const [isCopied, setIsCopied] = useState(false);

    const docId = activeDoc?.id;
    const docTitle = activeDoc?.title || "Untitled Document";

    // Load summary, conversations, and fallback SQLite annotations when workspace opens
    useEffect(() => {
        if (!isSummaryWorkspaceOpen || !docId) return;

        loadSummary(docId);
        loadConversations(docId);

        if (!liveAnnotations) {
            DocumentDatabase.getAnnotations(docId)
                .then(setFallbackAnnotations)
                .catch(() => setFallbackAnnotations([]));
        }
    }, [isSummaryWorkspaceOpen, docId, liveAnnotations, loadSummary, loadConversations]);

    // Sync activeSummary from store into local editor draft
    useEffect(() => {
        setDraftMarkdown(activeSummary?.content ?? "");
    }, [activeSummary?.content]);

    const sourceAnnotations = liveAnnotations ?? fallbackAnnotations;

    // Group user markups, notes, and crops by page
    const { highlights, notes, crops, pages } = useMemo(() => {
        const hl: TextMarkupAnnotation[] = [];
        const nt: NoteAnnotation[] = [];
        const cr: CropAnnotation[] = [];
        const pageSet = new Set<number>();

        for (const a of sourceAnnotations) {
            if (isTextMarkupAnnotation(a) && a.text.trim()) {
                hl.push(a);
                pageSet.add(a.pageNumber);
            } else if (isNoteAnnotation(a) && a.comment.trim()) {
                nt.push(a);
                pageSet.add(a.pageNumber);
            } else if (isCropAnnotation(a)) {
                cr.push(a);
                pageSet.add(a.pageNumber);
            }
        }

        const sortedPages = Array.from(pageSet).sort((a, b) => a - b);
        return { highlights: hl, notes: nt, crops: cr, pages: sortedPages };
    }, [sourceAnnotations]);

    const nonEmptyConversations = useMemo(
        () => conversations.filter((c) => c.messages.length > 0),
        [conversations]
    );

    const toggleAnnotationIncluded = (id: string) => {
        setExcludedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleChatIncluded = (id: string) => {
        setIncludedChatIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Debounced auto-save to SQLite
    const flushAutoSave = useCallback(
        async (markdownToSave: string) => {
            if (!docId) return;
            setSaveStatus("saving");
            try {
                await DocumentDatabase.saveSummary(
                    docId,
                    markdownToSave,
                    activeSummary?.sourceSnapshot
                );
                pendingSaveMarkdownRef.current = null;
                setSaveStatus("saved");
            } catch {
                setSaveStatus("idle");
            }
        },
        [docId, activeSummary?.sourceSnapshot]
    );

    const handleEditorMarkdownChange = useCallback(
        (nextMd: string) => {
            setDraftMarkdown(nextMd);
            pendingSaveMarkdownRef.current = nextMd;
            setSaveStatus("saving");

            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
            }
            autoSaveTimerRef.current = setTimeout(() => {
                autoSaveTimerRef.current = null;
                flushAutoSave(nextMd);
            }, 700);
        },
        [flushAutoSave]
    );

    // Flush pending edits on unmount
    useEffect(() => {
        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
                autoSaveTimerRef.current = null;
            }
            if (pendingSaveMarkdownRef.current !== null && docId) {
                DocumentDatabase.saveSummary(
                    docId,
                    pendingSaveMarkdownRef.current,
                    activeSummary?.sourceSnapshot
                ).catch(() => {});
            }
        };
    }, [docId, activeSummary?.sourceSnapshot]);

    const handleClose = useCallback(async () => {
        if (isSummarizing) {
            cancelSummaryStreaming();
        }
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
        if (pendingSaveMarkdownRef.current !== null) {
            await flushAutoSave(pendingSaveMarkdownRef.current);
        }
        if (docId) {
            await loadSummary(docId);
        }
        setSummaryWorkspaceOpen(false);
    }, [
        isSummarizing,
        cancelSummaryStreaming,
        flushAutoSave,
        docId,
        loadSummary,
        setSummaryWorkspaceOpen,
    ]);

    const handleGenerate = async () => {
        if (!docId) return;

        const selectedHighlights = highlights
            .filter((h) => !excludedIds.has(h.id))
            .map((h) => ({
                pageNumber: h.pageNumber,
                toolType: h.toolType,
                text: h.text,
            }));

        const selectedNotes = notes
            .filter((n) => !excludedIds.has(n.id))
            .map((n) => ({
                pageNumber: n.pageNumber,
                comment: n.comment,
                contextSnippet: n.contextSnippet,
            }));

        const selectedCrops = crops
            .filter((c) => !excludedIds.has(c.id))
            .map((c) => ({
                id: c.id,
                pageNumber: c.pageNumber,
                imageUrl: c.imageUrl.startsWith("idb://")
                    ? c.imageUrl
                    : `idb://${c.id}`,
                caption: c.caption,
            }));

        const selectedChats = nonEmptyConversations
            .filter((c) => includedChatIds.has(c.id))
            .map((c) => ({
                title: c.title,
                excerpts: c.messages
                    .filter((m) => m.content.trim().length > 0)
                    .slice(-6)
                    .map(
                        (m) =>
                            `${m.role === "user" ? "Question" : "Lio"}: ${m.content
                                .trim()
                                .slice(0, 600)}`
                    ),
            }));

        let fallbackExcerpt: string | undefined;
        if (
            selectedHighlights.length === 0 &&
            selectedNotes.length === 0 &&
            selectedCrops.length === 0 &&
            selectedChats.length === 0
        ) {
            const chunks = await RagService.getDocumentChunks(docId).catch(() => []);
            if (chunks.length > 0) {
                fallbackExcerpt = chunks
                    .slice(0, 8)
                    .map((ch) => `[Page ${ch.pageNumber}] ${ch.text}`)
                    .join("\n\n");
            } else {
                toast.error(
                    "Select at least one highlight, note, crop, or chat takeaway to generate"
                );
                return;
            }
        }

        try {
            await generateStructuredSummary(docId, {
                docTitle,
                focusMode: summaryFocusMode,
                highlights: selectedHighlights,
                notes: selectedNotes,
                crops: selectedCrops,
                chatTakeaways: selectedChats,
                fallbackExcerpt,
            });
            setSaveStatus("saved");
        } catch (err: any) {
            toast.error(err?.message || "Failed to generate summary");
        }
    };

    const handleCopyMarkdown = async () => {
        const md = editorRef.current?.getMarkdown() ?? draftMarkdown;
        if (!md.trim()) {
            toast.error("Nothing to copy yet");
            return;
        }
        try {
            await navigator.clipboard.writeText(md);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 1800);
        } catch {
            toast.error("Failed to copy Markdown");
        }
    };

    const handleExportMarkdown = async () => {
        const rawMd = editorRef.current?.getMarkdown() ?? draftMarkdown;
        if (!rawMd.trim()) {
            toast.error("Nothing to export yet");
            return;
        }

        const safeName = docTitle
            .replace(/\.pdf$/i, "")
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "");

        try {
            const targetPath = await save({
                defaultPath: `${safeName || "summary"}-notes.md`,
                filters: [{ name: "Markdown", extensions: ["md"] }],
            });
            if (!targetPath) return;

            const exportContent = await resolveMarkdownCropImages(rawMd);
            await writeTextFile(targetPath, exportContent);
            toast.success("Exported Markdown");
        } catch (err: any) {
            toast.error(err?.message || "Failed to export Markdown");
        }
    };

    const mascotState: MascotState = isSummarizing
        ? draftMarkdown.length > 0
            ? "speaking"
            : "thinking"
        : "idle";

    if (!isSummaryWorkspaceOpen || !activeDoc) return null;

    const totalIncludedAnnotations =
        highlights.filter((h) => !excludedIds.has(h.id)).length +
        notes.filter((n) => !excludedIds.has(n.id)).length +
        crops.filter((c) => !excludedIds.has(c.id)).length;

    return (
        <div
            data-theme={theme}
            role="dialog"
            aria-modal="true"
            aria-label="Summarization Studio"
            className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
        >
            {/* Header Bar */}
            <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
                <div className="flex min-w-0 items-center gap-3">
                    <AiMascot size={20} state={mascotState} className="shrink-0" />
                    <div className="flex min-w-0 items-center gap-2">
                        <h2 className="truncate text-sm font-medium text-foreground">
                            {docTitle}
                        </h2>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                            {isSummarizing
                                ? "Generating"
                                : saveStatus === "saving"
                                ? "Saving"
                                : saveStatus === "saved" || activeSummary
                                ? "Saved"
                                : "Draft"}
                        </span>
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {/* Summary Focus Mode Selector */}
                    <select
                        aria-label="Summary focus"
                        value={summaryFocusMode}
                        disabled={isSummarizing}
                        onChange={(e) =>
                            setSummaryFocusMode(e.target.value as SummaryFocusMode)
                        }
                        className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-brand)]"
                    >
                        {FOCUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>

                    {/* Generate / Regenerate or Stop */}
                    {isSummarizing ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={cancelSummaryStreaming}
                            className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                        >
                            <Square size={12} fill="currentColor" />
                            <span>Stop</span>
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleGenerate}
                            className="h-8 gap-1.5 rounded-lg bg-[var(--accent-brand)] px-3 text-xs text-[var(--accent-brand-fg)] hover:opacity-90"
                        >
                            <RefreshCw size={13} strokeWidth={1.5} />
                            <span>
                                {draftMarkdown.trim() ? "Regenerate" : "Generate"}
                            </span>
                        </Button>
                    )}

                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleCopyMarkdown}
                        className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                    >
                        {isCopied ? (
                            <>
                                <Check size={13} strokeWidth={1.5} />
                                <span>Copied</span>
                            </>
                        ) : (
                            <>
                                <Copy size={13} strokeWidth={1.5} />
                                <span>Copy Markdown</span>
                            </>
                        )}
                    </Button>

                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleExportMarkdown}
                        className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                    >
                        <Download size={13} strokeWidth={1.5} />
                        <span>Export .md</span>
                    </Button>

                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={handleClose}
                        aria-label="Close Summarization Studio"
                        className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        <X size={16} strokeWidth={1.5} />
                    </Button>
                </div>
            </header>

            {/* Split-Screen Body */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* Left Pane: User Highlights, Notes, Figure Crops & Chat Takeaways */}
                <aside className="flex w-[340px] shrink-0 flex-col border-r border-border bg-[var(--bg-deep)] lg:w-[380px]">
                    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card/60 px-4">
                        <span className="text-xs font-medium text-foreground">
                            Source material
                        </span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {totalIncludedAnnotations} selected
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {pages.length === 0 ? (
                            <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
                                No highlights, sticky notes, or figure crops in this document yet. You can still generate from indexed chunks or include saved Lio chat takeaways below.
                            </div>
                        ) : (
                            pages.map((pageNum) => {
                                const pageHighlights = highlights.filter(
                                    (h) => h.pageNumber === pageNum
                                );
                                const pageNotes = notes.filter(
                                    (n) => n.pageNumber === pageNum
                                );
                                const pageCrops = crops.filter(
                                    (c) => c.pageNumber === pageNum
                                );

                                return (
                                    <section key={pageNum} className="space-y-2">
                                        <div className="flex items-center justify-between px-1">
                                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                                Page {pageNum}
                                            </span>
                                            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                                {pageHighlights.length +
                                                    pageNotes.length +
                                                    pageCrops.length}
                                            </span>
                                        </div>

                                        {/* Text Highlights & Underlines */}
                                        {pageHighlights.map((item) => {
                                            const checked = !excludedIds.has(item.id);
                                            return (
                                                <label
                                                    key={item.id}
                                                    className={cn(
                                                        "flex cursor-pointer items-start gap-2 rounded-xl border bg-card p-3 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                                                        checked
                                                            ? "border-border"
                                                            : "border-border/50 opacity-55"
                                                    )}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() =>
                                                            toggleAnnotationIncluded(
                                                                item.id
                                                            )
                                                        }
                                                        className="mt-0.5 shrink-0 accent-[var(--accent-brand)]"
                                                    />
                                                    <div className="min-w-0 flex-1 space-y-1">
                                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                                            <span
                                                                className="h-2 w-2 shrink-0 rounded-full"
                                                                style={{
                                                                    backgroundColor:
                                                                        item.color,
                                                                }}
                                                            />
                                                            <span className="capitalize">
                                                                {item.toolType}
                                                            </span>
                                                        </div>
                                                        <p className="leading-relaxed text-foreground">
                                                            {item.text}
                                                        </p>
                                                    </div>
                                                </label>
                                            );
                                        })}

                                        {/* Sticky Notes */}
                                        {pageNotes.map((note) => {
                                            const checked = !excludedIds.has(note.id);
                                            return (
                                                <label
                                                    key={note.id}
                                                    className={cn(
                                                        "flex cursor-pointer items-start gap-2 rounded-xl border bg-card p-3 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                                                        checked
                                                            ? "border-border"
                                                            : "border-border/50 opacity-55"
                                                    )}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() =>
                                                            toggleAnnotationIncluded(
                                                                note.id
                                                            )
                                                        }
                                                        className="mt-0.5 shrink-0 accent-[var(--accent-brand)]"
                                                    />
                                                    <div className="min-w-0 flex-1 space-y-1">
                                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                                            <span
                                                                className="h-2 w-2 shrink-0 rounded-full"
                                                                style={{
                                                                    backgroundColor:
                                                                        note.color,
                                                                }}
                                                            />
                                                            <span>Note</span>
                                                        </div>
                                                        <p className="leading-relaxed text-foreground">
                                                            {note.comment}
                                                        </p>
                                                    </div>
                                                </label>
                                            );
                                        })}

                                        {/* Captured Figure Crops */}
                                        {pageCrops.map((crop) => {
                                            const checked = !excludedIds.has(crop.id);
                                            const cropLabel =
                                                crop.caption ||
                                                `Figure (Page ${crop.pageNumber})`;
                                            return (
                                                <div
                                                    key={crop.id}
                                                    className={cn(
                                                        "rounded-xl border bg-card p-3 space-y-2 transition-colors duration-150 ease-[var(--ease-foliet)]",
                                                        checked
                                                            ? "border-border"
                                                            : "border-border/50 opacity-55"
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() =>
                                                                    toggleAnnotationIncluded(
                                                                        crop.id
                                                                    )
                                                                }
                                                                className="shrink-0 accent-[var(--accent-brand)]"
                                                            />
                                                            <span
                                                                className="h-2 w-2 shrink-0 rounded-full"
                                                                style={{
                                                                    backgroundColor:
                                                                        crop.color,
                                                                }}
                                                            />
                                                            <span>Figure crop</span>
                                                        </label>

                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            disabled={isSummarizing}
                                                            onClick={() =>
                                                                editorRef.current?.insertImage(
                                                                    {
                                                                        src: crop.imageUrl,
                                                                        alt: cropLabel,
                                                                    }
                                                                )
                                                            }
                                                            className="h-6 gap-1 rounded-md px-2 text-[11px] text-foreground hover:bg-muted"
                                                        >
                                                            <ImagePlus
                                                                size={12}
                                                                strokeWidth={1.5}
                                                            />
                                                            <span>Insert</span>
                                                        </Button>
                                                    </div>

                                                    <CropThumbnail
                                                        src={crop.imageUrl}
                                                        alt={cropLabel}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </section>
                                );
                            })
                        )}

                        {/* Collapsible Saved Lio Chat Takeaways */}
                        <section className="rounded-xl border border-border bg-card">
                            <button
                                type="button"
                                onClick={() => setChatsExpanded((v) => !v)}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-muted/50 rounded-xl transition-colors duration-150"
                            >
                                <span className="flex items-center gap-2">
                                    {chatsExpanded ? (
                                        <ChevronDown size={14} strokeWidth={1.5} />
                                    ) : (
                                        <ChevronRight size={14} strokeWidth={1.5} />
                                    )}
                                    <MessageSquare size={14} strokeWidth={1.5} />
                                    <span>Saved Lio Chat Takeaways</span>
                                </span>
                                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                    {includedChatIds.size}/{nonEmptyConversations.length}
                                </span>
                            </button>

                            {chatsExpanded && (
                                <div className="border-t border-border p-3 space-y-2">
                                    {nonEmptyConversations.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">
                                            No saved Lio conversations for this paper.
                                        </p>
                                    ) : (
                                        nonEmptyConversations.map((conv) => {
                                            const checked = includedChatIds.has(
                                                conv.id
                                            );
                                            const lastAssistant = [...conv.messages]
                                                .reverse()
                                                .find((m) => m.role === "assistant");
                                            return (
                                                <label
                                                    key={conv.id}
                                                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-background p-2 text-xs"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() =>
                                                            toggleChatIncluded(conv.id)
                                                        }
                                                        className="mt-0.5 shrink-0 accent-[var(--accent-brand)]"
                                                    />
                                                    <div className="min-w-0 flex-1 space-y-1">
                                                        <div className="truncate font-medium text-foreground">
                                                            {conv.title}
                                                        </div>
                                                        {lastAssistant && (
                                                            <p className="line-clamp-2 text-[11px] text-muted-foreground">
                                                                {lastAssistant.content}
                                                            </p>
                                                        )}
                                                    </div>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </section>
                    </div>
                </aside>

                {/* Right Pane: Tiptap Docs Editor */}
                <main className="min-w-0 flex-1 overflow-hidden">
                    <SummaryDocsEditor
                        ref={editorRef}
                        markdown={draftMarkdown}
                        isStreaming={isSummarizing}
                        onMarkdownChange={handleEditorMarkdownChange}
                    />
                </main>
            </div>
        </div>
    );
};
```

---

### Step 2 — Full Code: `src/components/ai/AiStudioSidebar.tsx`

Changes from your existing file:
- Replaced the Summarize placeholder with a quiet, 4px-grid launch panel displaying live counts of **Highlights**, **Underlines**, **Notes**, **Figure Crops**, and **Saved Chat Conversations**, plus whether a saved summary exists in SQLite (`doc_summaries`), and the **"Open Summarization Studio"** button.
- Mounted `<SummarizationWorkspace annotations={annotations} />`.

```typescript
/**
 * Foliet - AI Studio Resizable Right Sidebar Shell
 *
 * Houses Lio Chat, RAG Semantic Vector Search, and Document Summarization.
 * Mirrors the structure, styling, and drag-to-resize behavior of PdfSidebar,
 * persisting width to localStorage.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
    CheckCircle2,
    Database,
    FileText,
    MessageSquare,
    X,
} from "lucide-react";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { RagSearchPanel } from "@/components/ai/RagSearchPanel";
import { SummarizationWorkspace } from "@/components/ai/SummarizationWorkspace";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiStore } from "@/stores/aiStore";
import { useDocumentStore } from "@/stores/documentStore";
import {
    isCropAnnotation,
    isNoteAnnotation,
    isTextMarkupAnnotation,
    type PdfAnnotation,
} from "@/types/annotations";
import { cn } from "@/lib/utils";

interface AiStudioSidebarProps {
    isOpen: boolean;
    onJumpToPage: (page: number) => void;
    annotations?: PdfAnnotation[];
}

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 300;
const MAX_WIDTH = 620;
const WIDTH_STORAGE_KEY = "foliet:ai-sidebar-width";

const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

function readStoredWidth(): number {
    try {
        const raw = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
        return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : DEFAULT_WIDTH;
    } catch {
        return DEFAULT_WIDTH;
    }
}

export const AiStudioSidebar: React.FC<AiStudioSidebarProps> = ({
    isOpen,
    onJumpToPage,
    annotations = [],
}) => {
    const [width, setWidth] = useState<number>(readStoredWidth);
    const [isResizing, setIsResizing] = useState(false);

    const activeDoc = useDocumentStore((s) => s.activeDoc);
    const {
        activeAiTab,
        setActiveAiTab,
        setAiStudioOpen,
        activeSummary,
        loadSummary,
        conversations,
        setSummaryWorkspaceOpen,
    } = useAiStore();

    useEffect(() => {
        if (isOpen && activeDoc?.id) {
            loadSummary(activeDoc.id);
        }
    }, [isOpen, activeDoc?.id, loadSummary]);

    const sourceCounts = useMemo(() => {
        let highlights = 0;
        let underlines = 0;
        let notes = 0;
        let crops = 0;

        for (const a of annotations) {
            if (isTextMarkupAnnotation(a)) {
                if (a.toolType === "highlight") highlights += 1;
                else if (a.toolType === "underline") underlines += 1;
            } else if (isNoteAnnotation(a)) {
                notes += 1;
            } else if (isCropAnnotation(a)) {
                crops += 1;
            }
        }

        const chats = conversations.filter((c) => c.messages.length > 0).length;
        return { highlights, underlines, notes, crops, chats };
    }, [annotations, conversations]);

    const updateWidth = (next: number) => {
        const clamped = clampWidth(next);
        setWidth(clamped);
        try {
            localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
        } catch {
            // Ignore quota errors
        }
    };

    const handleResizePointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        setIsResizing(true);
        const startX = e.clientX;
        const startWidth = width;

        const onPointerMove = (moveEvt: PointerEvent) => {
            // Dragging cursor to the left expands the right sidebar
            const delta = moveEvt.clientX - startX;
            updateWidth(startWidth - delta);
        };

        const onPointerUp = () => {
            setIsResizing(false);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
    };

    if (!isOpen) return null;

    return (
        <>
            <aside
                style={{ width }}
                aria-label="AI Studio Sidebar"
                className="relative z-20 flex h-full shrink-0 flex-col border-l border-border bg-card shadow-[-4px_0_12px_rgba(0,0,0,0.03)] select-none"
            >
                <Tabs
                    value={activeAiTab === "chunks" || activeAiTab === "settings" ? "search" : activeAiTab}
                    onValueChange={(val) => setActiveAiTab(val as "chat" | "search" | "summary")}
                    className="flex h-full flex-col overflow-hidden"
                >
                    {/* 48px Top Tab Bar: Matches PdfSidebar & PdfToolbar alignment */}
                    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-muted/30 px-2.5">
                        <TabsList className="h-8 gap-0.5 rounded-lg bg-background/80 p-0.5 border border-border/60">
                            <TabsTrigger
                                value="chat"
                                className="h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                            >
                                <MessageSquare size={13} strokeWidth={1.5} />
                                <span>Chat</span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="search"
                                className="h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                            >
                                <Database size={13} strokeWidth={1.5} />
                                <span>RAG Search</span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="summary"
                                className="h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                            >
                                <FileText size={13} strokeWidth={1.5} />
                                <span>Summarize</span>
                            </TabsTrigger>
                        </TabsList>

                        {/* Close Studio Button */}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setAiStudioOpen(false)}
                            aria-label="Close AI Studio"
                            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <X size={15} strokeWidth={1.75} />
                        </Button>
                    </div>

                    {/* Tab 1: Persistent Chat */}
                    <TabsContent value="chat" className="m-0 flex-1 overflow-hidden p-0">
                        <AiChatPanel onJumpToPage={onJumpToPage} />
                    </TabsContent>

                    {/* Tab 2: RAG Search */}
                    <TabsContent value="search" className="m-0 flex-1 overflow-hidden p-0">
                        <RagSearchPanel onJumpToPage={onJumpToPage} />
                    </TabsContent>

                    {/* Tab 3: Summarization Studio Launch Panel */}
                    <TabsContent value="summary" className="m-0 flex-1 overflow-y-auto p-4">
                        <div className="space-y-4">
                            <div className="rounded-xl border border-border bg-background p-4 space-y-3">
                                <div className="space-y-1">
                                    <h3 className="text-sm font-medium text-foreground">
                                        Document synthesis
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        Synthesize your marked passages, sticky notes, figure crops, and Lio conversations into an editable Markdown document.
                                    </p>
                                </div>

                                {/* Source Counts Grid */}
                                <div className="divide-y divide-border rounded-lg border border-border bg-card">
                                    <div className="flex h-8 items-center justify-between px-3 text-xs">
                                        <span className="text-[var(--text-secondary)]">Highlights</span>
                                        <span className="font-mono tabular-nums text-foreground">
                                            {sourceCounts.highlights}
                                        </span>
                                    </div>
                                    <div className="flex h-8 items-center justify-between px-3 text-xs">
                                        <span className="text-[var(--text-secondary)]">Underlines</span>
                                        <span className="font-mono tabular-nums text-foreground">
                                            {sourceCounts.underlines}
                                        </span>
                                    </div>
                                    <div className="flex h-8 items-center justify-between px-3 text-xs">
                                        <span className="text-[var(--text-secondary)]">Notes</span>
                                        <span className="font-mono tabular-nums text-foreground">
                                            {sourceCounts.notes}
                                        </span>
                                    </div>
                                    <div className="flex h-8 items-center justify-between px-3 text-xs">
                                        <span className="text-[var(--text-secondary)]">Figure crops</span>
                                        <span className="font-mono tabular-nums text-foreground">
                                            {sourceCounts.crops}
                                        </span>
                                    </div>
                                    <div className="flex h-8 items-center justify-between px-3 text-xs">
                                        <span className="text-[var(--text-secondary)]">Saved conversations</span>
                                        <span className="font-mono tabular-nums text-foreground">
                                            {sourceCounts.chats}
                                        </span>
                                    </div>
                                </div>

                                {/* SQLite Saved Status */}
                                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                                    {activeSummary?.content ? (
                                        <span className="flex items-center gap-2 text-foreground">
                                            <CheckCircle2
                                                size={14}
                                                strokeWidth={1.5}
                                                className="text-[var(--semantic-positive)] shrink-0"
                                            />
                                            <span>Saved summary available</span>
                                        </span>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            No saved summary yet
                                        </span>
                                    )}
                                </div>

                                <Button
                                    type="button"
                                    onClick={() => setSummaryWorkspaceOpen(true)}
                                    disabled={!activeDoc}
                                    className="h-9 w-full rounded-lg bg-[var(--accent-brand)] text-xs font-medium text-[var(--accent-brand-fg)] hover:opacity-90"
                                >
                                    Open Summarization Studio
                                </Button>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>

                {/* Drag-to-resize handle on LEFT edge */}
                <div
                    role="separator"
                    tabIndex={0}
                    aria-orientation="vertical"
                    aria-label="Resize AI Studio sidebar"
                    aria-valuemin={MIN_WIDTH}
                    aria-valuemax={MAX_WIDTH}
                    aria-valuenow={width}
                    title="Drag to resize · Double-click to reset"
                    onPointerDown={handleResizePointerDown}
                    onDoubleClick={() => updateWidth(DEFAULT_WIDTH)}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowLeft") updateWidth(width + 16);
                        else if (e.key === "ArrowRight") updateWidth(width - 16);
                    }}
                    className={cn(
                        "absolute top-0 -left-1 z-20 h-full w-2 cursor-col-resize",
                        "after:absolute after:top-0 after:bottom-0 after:left-[3px] after:w-0.5 after:transition-colors after:duration-150 after:ease-[var(--ease-foliet)]",
                        isResizing
                            ? "after:bg-[var(--accent-brand)]"
                            : "hover:after:bg-[var(--accent-brand)]/60"
                    )}
                />
            </aside>

            <SummarizationWorkspace annotations={annotations} />
        </>
    );
};
```

---

### Step 3 — Full Code: `src/pages/ViewerView.tsx`

Changes from your existing file (minimal 4-line diff):
- Added memoized `studioAnnotations` combining `annotations` and `cropAnnotations`.
- Passed `annotations={studioAnnotations}` into `<AiStudioSidebar />` so live unsaved highlights, notes, and crops appear immediately in the Summarize tab and Summarization Studio.

```typescript
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, pdfjs } from "react-pdf";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { toast } from "sonner";
import { NoteEditorPortal } from "@/components/viewer/NoteEditorPortal";
import { PdfPage } from "@/components/viewer/PdfPage";
import { PdfSidebar } from "@/components/viewer/PdfSidebar";
import { AiStudioSidebar } from "@/components/ai/AiStudioSidebar";
import { PdfToolbar } from "@/components/viewer/PdfToolbar";
import { SearchOverlay } from "@/components/viewer/SearchOverlay";
import { ViewerHeader } from "@/components/viewer/ViewerHeader";
import { usePdfSearch } from "@/hooks/usePdfSearch";
import { useToolManager } from "@/hooks/useToolManager";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { PDF_DOCUMENT_OPTIONS, PdfService } from "@/services/pdf";
import { DocumentCatalogStorage } from "@/services/storage/catalog";
import { DocumentDatabase } from "@/services/storage/database";
import { SettingsStorage } from "@/services/storage/settings";
import { getActivePdfSource, useDocumentStore } from "@/stores/documentStore";
import { useAiStore } from "@/stores/aiStore";
import { useSystemStore } from "@/stores/systemStore";
import {
  type BurnableAnnotation,
  type CropAnnotation,
  type NoteAnnotation,
  type PdfAnnotation,
  isCropAnnotation,
  isNoteAnnotation,
} from "@/types/annotations";
import type {
  BookmarkItem,
  PageDimensions,
  PdfOutlineNode,
} from "@/types/document";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "@/styles/pdf-viewer.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const EMPTY_ANNOTS: PdfAnnotation[] = [];
const MAX_RENDERED_PAGES = 18;
const DEFAULT_DIM: PageDimensions = { width: 612, height: 792 };

const sameBookmarks = (a: BookmarkItem[], b: BookmarkItem[]) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.id === b[i].id &&
      x.pageNumber === b[i].pageNumber &&
      x.title === b[i].title,
  );

const sameCrops = (a: CropAnnotation[], b: CropAnnotation[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id);

export function ViewerView() {
  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const setDirtySource = useDocumentStore((s) => s.setDirtySource);
  const clearDirty = useDocumentStore((s) => s.clearDirty);
  const setDocPageCount = useDocumentStore((s) => s.setDocPageCount);
  const shortcutModifier = useSystemStore((s) => s.shortcutModifier);
  const isAiStudioOpen = useAiStore((s) => s.isAiStudioOpen);

  const [pdfProxy, setPdfProxy] = useState<any | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState<number>(() =>
    Math.max(1, activeDoc?.lastPage || 1),
  );
  const [totalPages, setTotalPages] = useState<number>(() =>
    Math.max(1, activeDoc?.pages || 1),
  );
  const [zoomLevel, setZoomLevel] = useState<number>(
    () => activeDoc?.zoom || 100,
  );
  const [renderZoom, setRenderZoom] = useState<number>(
    () => activeDoc?.zoom || 100,
  );
  const [isCtrlHeld, setIsCtrlHeld] = useState(false);

  const [outline, setOutline] = useState<PdfOutlineNode[]>([]);
  const [pageLabels, setPageLabels] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [cropAnnotations, setCropAnnotations] = useState<CropAnnotation[]>([]);
  const [pageDimensions, setPageDimensions] = useState<
    Record<number, PageDimensions>
  >({});

  const [renderedPages, setRenderedPages] = useState<Set<number>>(() => {
    const start = Math.max(1, activeDoc?.lastPage || 1);
    return new Set([Math.max(1, start - 1), start, start + 1]);
  });

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteAnchorPos, setNoteAnchorPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pagesContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefsMap = useRef<Map<number, HTMLElement>>(new Map());
  const pageRefCallbacksRef = useRef<
    Map<number, (el: HTMLElement | null) => void>
  >(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visiblePagesRef = useRef<Set<number>>(new Set());
  const programmaticScrollRef = useRef(false);
  const pendingRestorePageRef = useRef<number | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZoomRef = useRef<number>(activeDoc?.zoom || 100);
  const lastScrollTopRef = useRef(0);
  const scrollDirectionRef = useRef<1 | -1>(1);
  const isJumpingScrollRef = useRef(false);
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const seededDocRef = useRef<string | null>(null);
  const hasEditedAnnotationsRef = useRef(false);
  const savedBookmarksRef = useRef<BookmarkItem[]>([]);
  const savedCropsRef = useRef<CropAnnotation[]>([]);
  const prevPageAnnotsRef = useRef<Map<number, PdfAnnotation[]>>(new Map());

  const toolManager = useToolManager();
  const {
    state: annotations,
    set: setAnnotations,
    undo,
    redo,
    canUndo,
    canRedo,
    reset: resetAnnotations,
    isDirty: isAnnotDirty,
    markSaved,
  } = useUndoRedo<PdfAnnotation[]>([]);

  const studioAnnotations = useMemo(
    () => [...annotations, ...cropAnnotations],
    [annotations, cropAnnotations],
  );

  const pdfSource = useMemo(
    () => getActivePdfSource(activeDoc),
    [activeDoc?.filePath],
  );
  const noopRegisterPageRef = useCallback(() => {}, []);

  // Stable wrapper refs so IntersectionObserver never loses or thrashes observed nodes
  const registerPageRef = useCallback(
    (pageNumber: number, el: HTMLElement | null) => {
      const prev = pageRefsMap.current.get(pageNumber);
      if (prev === el) return;
      if (prev) {
        observerRef.current?.unobserve(prev);
      }
      if (el) {
        pageRefsMap.current.set(pageNumber, el);
        observerRef.current?.observe(el);
      } else {
        pageRefsMap.current.delete(pageNumber);
      }
    },
    [],
  );

  const getPageRefCallback = useCallback(
    (pageNumber: number) => {
      let cb = pageRefCallbacksRef.current.get(pageNumber);
      if (!cb) {
        cb = (el: HTMLElement | null) => registerPageRef(pageNumber, el);
        pageRefCallbacksRef.current.set(pageNumber, cb);
      }
      return cb;
    },
    [registerPageRef],
  );

  const syncRenderedPages = useCallback(
    (anchorPage: number, maxPages: number) => {
      const dir = scrollDirectionRef.current;
      const startOffset = dir === 1 ? -2 : -4;
      const endOffset = dir === 1 ? 4 : 2;

      setRenderedPages((prev) => {
        const next = new Set<number>(prev);
        for (const p of visiblePagesRef.current) {
          if (p >= 1 && p <= maxPages) next.add(p);
        }
        for (let d = startOffset; d <= endOffset; d++) {
          const p = anchorPage + d;
          if (p >= 1 && p <= maxPages) next.add(p);
        }

        const candidate =
          next.size > MAX_RENDERED_PAGES
            ? new Set(
                Array.from(next)
                  .filter((p) => p >= 1 && p <= maxPages)
                  .sort(
                    (a, b) =>
                      Math.abs(a - anchorPage) - Math.abs(b - anchorPage),
                  )
                  .slice(0, MAX_RENDERED_PAGES),
              )
            : next;

        if (
          candidate.size === prev.size &&
          Array.from(candidate).every((p) => prev.has(p))
        ) {
          return prev;
        }
        return candidate;
      });
    },
    [],
  );

  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, PdfAnnotation[]>();
    for (const a of annotations) {
      const list = grouped.get(a.pageNumber);
      if (list) list.push(a);
      else grouped.set(a.pageNumber, [a]);
    }
    const nextCache = new Map<number, PdfAnnotation[]>();
    for (const [pageNum, list] of grouped) {
      const prev = prevPageAnnotsRef.current.get(pageNum);
      if (
        prev &&
        prev.length === list.length &&
        prev.every((item, i) => item === list[i])
      ) {
        nextCache.set(pageNum, prev);
      } else {
        nextCache.set(pageNum, list);
      }
    }
    prevPageAnnotsRef.current = nextCache;
    return nextCache;
  }, [annotations]);

  const editingNote = useMemo(() => {
    if (!editingNoteId) return null;
    const found = annotations.find((a) => a.id === editingNoteId);
    return found && isNoteAnnotation(found) ? found : null;
  }, [annotations, editingNoteId]);

  useEffect(() => {
    setDirtySource("annotations", isAnnotDirty);
  }, [isAnnotDirty, setDirtySource]);

  useEffect(() => {
    setDirtySource(
      "bookmarks",
      !sameBookmarks(bookmarks, savedBookmarksRef.current),
    );
  }, [bookmarks, setDirtySource]);

  useEffect(() => {
    setDirtySource("crops", !sameCrops(cropAnnotations, savedCropsRef.current));
  }, [cropAnnotations, setDirtySource]);

  useEffect(() => {
    SettingsStorage.getPreferences()
      .then((prefs) => setSidebarOpen(prefs.sidebarOpen))
      .catch(() => {});
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      SettingsStorage.savePreferences({ sidebarOpen: next }).catch(() => {});
      return next;
    });
  }, []);

  // Debounce live canvas re-render during rapid zooming so CSS-scale carries 60fps feedback
  useEffect(() => {
    if (renderZoom === zoomLevel) return;
    const timer = setTimeout(() => {
      setRenderZoom(zoomLevel);
    }, 140);
    return () => clearTimeout(timer);
  }, [zoomLevel, renderZoom]);

  // Keep viewport reading center anchored proportionally when zoom changes
  useLayoutEffect(() => {
    const prevZoom = prevZoomRef.current;
    prevZoomRef.current = zoomLevel;
    if (
      prevZoom === zoomLevel ||
      !scrollRef.current ||
      pendingRestorePageRef.current !== null
    ) {
      return;
    }
    const container = scrollRef.current;
    const ratio = zoomLevel / prevZoom;
    const centerY = container.scrollTop + container.clientHeight / 2;
    programmaticScrollRef.current = true;
    container.scrollTop = Math.max(
      0,
      centerY * ratio - container.clientHeight / 2,
    );
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, [zoomLevel]);

  const jumpToPage = useCallback(
    (pageNum: number) => {
      const target = Math.min(totalPages, Math.max(1, pageNum));
      const container = scrollRef.current;
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
      }
      programmaticScrollRef.current = true;
      setCurrentPage(target);
      syncRenderedPages(target, totalPages);

      requestAnimationFrame(() => {
        const el = pageRefsMap.current.get(target);
        if (container && el) {
          const topDelta =
            el.getBoundingClientRect().top -
            container.getBoundingClientRect().top;
          container.scrollTo({
            top: Math.max(0, container.scrollTop + topDelta - 24),
            behavior: "auto",
          });
        }
        restoreTimerRef.current = setTimeout(() => {
          programmaticScrollRef.current = false;
          pendingRestorePageRef.current = null;
        }, 60);
      });
    },
    [totalPages, syncRenderedPages],
  );

  const search = usePdfSearch(pdfProxy, jumpToPage);

  // Reset per-document state & load saved annotations/bookmarks
  useEffect(() => {
    if (!activeDoc?.id) return;
    const docId = activeDoc.id;
    const initialPage = Math.max(1, activeDoc.lastPage || 1);
    const initialPages = Math.max(1, activeDoc.pages || 1);
    const initialZoom = activeDoc.zoom || 100;
    let active = true;

    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    programmaticScrollRef.current = false;
    setPdfProxy(null);
    setOutline([]);
    setPageLabels([]);
    setPageDimensions({});
    setEditingNoteId(null);
    setNoteAnchorPos(null);
    setTotalPages(initialPages);
    setZoomLevel(initialZoom);
    setRenderZoom(initialZoom);
    prevZoomRef.current = initialZoom;
    setCurrentPage(initialPage);
    setRenderedPages(
      new Set(
        [initialPage - 1, initialPage, initialPage + 1, initialPage + 2].filter(
          (p) => p >= 1 && p <= initialPages,
        ),
      ),
    );
    visiblePagesRef.current.clear();
    pendingRestorePageRef.current = initialPage > 1 ? initialPage : null;
    seededDocRef.current = null;
    hasEditedAnnotationsRef.current = false;

    Promise.all([
      DocumentDatabase.getAnnotations(docId),
      DocumentDatabase.getBookmarks(docId),
    ])
      .then(([savedAnnots, savedBookmarks]) => {
        if (!active) return;
        const source =
          savedAnnots.length > 0
            ? savedAnnots
            : (activeDoc.extractedAnnotations ?? []);
        const nonCrop = source.filter((a) => !isCropAnnotation(a));
        const crops = source.filter(isCropAnnotation);

        resetAnnotations(nonCrop);
        savedCropsRef.current = crops;
        setCropAnnotations(crops);
        savedBookmarksRef.current = savedBookmarks;
        setBookmarks(savedBookmarks);
        clearDirty();

        if (savedAnnots.length > 0 || activeDoc.extractedAnnotations) {
          seededDocRef.current = docId;
        }
      })
      .catch(() => toast.error("Failed to load saved annotations"));

    return () => {
      active = false;
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    };
  }, [activeDoc?.id, resetAnnotations, clearDirty]);

  // Apply lazy extracted annotations only if user hasn't edited yet
  useEffect(() => {
    if (
      !activeDoc?.id ||
      seededDocRef.current === activeDoc.id ||
      hasEditedAnnotationsRef.current ||
      !activeDoc.extractedAnnotations?.length ||
      isAnnotDirty
    ) {
      return;
    }
    seededDocRef.current = activeDoc.id;
    resetAnnotations(
      activeDoc.extractedAnnotations.filter((a) => !isCropAnnotation(a)),
    );
  }, [
    activeDoc?.id,
    activeDoc?.extractedAnnotations,
    isAnnotDirty,
    resetAnnotations,
  ]);

  // Track latest reading state for debounced + guaranteed unmount/switch flush
  const readingStateRef = useRef({
    docId: "",
    lastPage: 1,
    zoom: 100,
    pageCount: 1,
    annotationCount: 0,
    ready: false,
  });

  readingStateRef.current = {
    docId: activeDoc?.id ?? "",
    lastPage: currentPage,
    zoom: zoomLevel,
    pageCount: totalPages,
    annotationCount: annotations.length + cropAnnotations.length,
    ready: Boolean(pdfProxy) && pendingRestorePageRef.current === null,
  };

  useEffect(() => {
    if (!activeDoc?.id || !pdfProxy || pendingRestorePageRef.current !== null) {
      return;
    }
    const { docId, lastPage, zoom, pageCount, annotationCount } =
      readingStateRef.current;
    const timer = setTimeout(() => {
      DocumentCatalogStorage.updateDocument(docId, {
        lastPage,
        zoom,
        pageCount,
        annotationCount,
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [
    activeDoc?.id,
    pdfProxy,
    currentPage,
    zoomLevel,
    totalPages,
    annotations.length,
    cropAnnotations.length,
  ]);

  // Flush reading position immediately on close / doc change / window unload
  useEffect(() => {
    const flush = () => {
      const s = readingStateRef.current;
      if (s.docId && s.ready) {
        DocumentCatalogStorage.updateDocument(s.docId, {
          lastPage: s.lastPage,
          zoom: s.zoom,
          pageCount: s.pageCount,
          annotationCount: s.annotationCount,
        }).catch(() => {});
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [activeDoc?.id]);

  // Pre-render surrounding pages smoothly as currentPage advances
  useEffect(() => {
    if (!pdfProxy || isJumpingScrollRef.current) return;
    syncRenderedPages(currentPage, totalPages);
  }, [pdfProxy, currentPage, totalPages, syncRenderedPages]);

  const totalPagesRef = useRef(totalPages);
  totalPagesRef.current = totalPages;

  // IntersectionObserver with generous 1500px margin so pages mount before scrolling into view
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !pdfProxy) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNum = Number(
            (entry.target as HTMLElement).dataset.pageNumber,
          );
          if (!pageNum) continue;
          if (entry.isIntersecting) visiblePagesRef.current.add(pageNum);
          else visiblePagesRef.current.delete(pageNum);
        }
        if (!isJumpingScrollRef.current) {
          syncRenderedPages(
            readingStateRef.current.lastPage,
            totalPagesRef.current,
          );
        }
      },
      { root, rootMargin: "1500px 0px" },
    );

    observerRef.current = observer;
    for (const el of pageRefsMap.current.values()) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [pdfProxy, syncRenderedPages]);

  // Scroll spy (O(log N) binary search via viewport rects) + directional pre-render
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let rafId: number | null = null;

    const releaseLocksOnUserInput = () => {
      pendingRestorePageRef.current = null;
      programmaticScrollRef.current = false;
    };

    const detectCurrentPage = () => {
      const listEl = pagesContainerRef.current;
      if (!listEl || listEl.children.length === 0) return;

      const containerRect = container.getBoundingClientRect();
      const focalY = containerRect.top + containerRect.height * 0.35;
      const children = listEl.children;
      let lo = 0;
      let hi = children.length - 1;
      let bestIdx = 0;

      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const rect = (children[mid] as HTMLElement).getBoundingClientRect();
        if (focalY < rect.top) {
          bestIdx = mid;
          hi = mid - 1;
        } else if (focalY > rect.bottom) {
          bestIdx = mid;
          lo = mid + 1;
        } else {
          bestIdx = mid;
          break;
        }
      }

      if (bestIdx > 0) {
        const currRect = (
          children[bestIdx] as HTMLElement
        ).getBoundingClientRect();
        const prevRect = (
          children[bestIdx - 1] as HTMLElement
        ).getBoundingClientRect();
        if (
          focalY < currRect.top &&
          Math.abs(prevRect.bottom - focalY) < Math.abs(currRect.top - focalY)
        ) {
          bestIdx -= 1;
        }
      } else if (bestIdx < children.length - 1) {
        const currRect = (
          children[bestIdx] as HTMLElement
        ).getBoundingClientRect();
        const nextRect = (
          children[bestIdx + 1] as HTMLElement
        ).getBoundingClientRect();
        if (
          focalY > currRect.bottom &&
          Math.abs(nextRect.top - focalY) < Math.abs(currRect.bottom - focalY)
        ) {
          bestIdx += 1;
        }
      }

      const matchedPage = bestIdx + 1;
      setCurrentPage((prev) => (prev !== matchedPage ? matchedPage : prev));
    };

    const onScroll = () => {
      const nowTop = container.scrollTop;
      const signedDelta = nowTop - lastScrollTopRef.current;
      const absDelta = Math.abs(signedDelta);
      lastScrollTopRef.current = nowTop;

      if (signedDelta > 2) scrollDirectionRef.current = 1;
      else if (signedDelta < -2) scrollDirectionRef.current = -1;

      // Only defer rendering on huge scrollbar drags (> 900px in a single event)
      if (absDelta > 900 && !programmaticScrollRef.current) {
        isJumpingScrollRef.current = true;
      }

      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
      }
      scrollSettleTimerRef.current = setTimeout(() => {
        isJumpingScrollRef.current = false;
        if (
          !programmaticScrollRef.current &&
          pendingRestorePageRef.current === null
        ) {
          detectCurrentPage();
        }
        syncRenderedPages(
          readingStateRef.current.lastPage,
          totalPagesRef.current,
        );
      }, 75);

      if (
        programmaticScrollRef.current ||
        pendingRestorePageRef.current !== null ||
        rafId !== null
      ) {
        return;
      }

      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (
          programmaticScrollRef.current ||
          pendingRestorePageRef.current !== null
        ) {
          return;
        }
        detectCurrentPage();
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", releaseLocksOnUserInput, {
      passive: true,
    });
    container.addEventListener("pointerdown", releaseLocksOnUserInput, {
      passive: true,
    });
    container.addEventListener("touchstart", releaseLocksOnUserInput, {
      passive: true,
    });

    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", releaseLocksOnUserInput);
      container.removeEventListener("pointerdown", releaseLocksOnUserInput);
      container.removeEventListener("touchstart", releaseLocksOnUserInput);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
      }
    };
  }, [syncRenderedPages, pdfSource, pdfProxy]);

  const burnableAnnotations = useMemo(
    () =>
      annotations.filter(
        (a): a is BurnableAnnotation => a.toolType !== "area_select",
      ),
    [annotations],
  );

  const executeSave = useCallback(async (): Promise<boolean> => {
    if (!activeDoc?.id) return false;
    const docId = activeDoc.id;

    try {
      await Promise.all([
        DocumentDatabase.saveAnnotations(docId, [
          ...annotations,
          ...cropAnnotations,
        ]),
        DocumentDatabase.saveBookmarks(docId, bookmarks),
        DocumentCatalogStorage.updateDocument(docId, {
          lastPage: currentPage,
          zoom: zoomLevel,
          pageCount: totalPages,
          annotationCount: annotations.length + cropAnnotations.length,
        }),
      ]);

      if (activeDoc.filePath) {
        await PdfService.burnAndSave(activeDoc.filePath, burnableAnnotations);
      }

      savedBookmarksRef.current = bookmarks;
      savedCropsRef.current = cropAnnotations;
      markSaved();
      clearDirty();
      toast.success("Saved");
      return true;
    } catch (err: any) {
      console.error("Failed to save PDF", err);
      toast.error(err?.message || "Failed to save PDF");
      return false;
    }
  }, [
    activeDoc,
    annotations,
    cropAnnotations,
    bookmarks,
    currentPage,
    zoomLevel,
    totalPages,
    burnableAnnotations,
    markSaved,
    clearDirty,
  ]);

  // Keyboard shortcuts & Ctrl/Cmd hyperlink modifier
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") setIsCtrlHeld(true);

      const inSearch = document.activeElement === search.searchInputRef.current;
      if (search.isSearchOpen && inSearch) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.shiftKey ? search.handleSearchPrev() : search.handleSearchNext();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          search.closeSearch();
          return;
        }
      }

      const tag = document.activeElement?.tagName;
      if ((tag === "INPUT" || tag === "TEXTAREA") && !inSearch) return;

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === "s") {
          e.preventDefault();
          executeSave();
        } else if (key === "f") {
          e.preventDefault();
          search.openSearch();
        } else if (key === "z") {
          e.preventDefault();
          if (e.shiftKey) canRedo && redo();
          else canUndo && undo();
        } else if (key === "y") {
          e.preventDefault();
          canRedo && redo();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") setIsCtrlHeld(false);
    };
    const onBlur = () => setIsCtrlHeld(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [search, executeSave, canUndo, canRedo, undo, redo]);

  // Ctrl/Cmd + Wheel zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoomLevel((z) =>
          Math.min(500, Math.max(25, z + (e.deltaY < 0 ? 10 : -10))),
        );
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pdfSource, pdfProxy]);

  const currentLabel = pageLabels[currentPage - 1] || String(currentPage);
  const isBookmarked = bookmarks.some((b) => b.pageNumber === currentPage);

  const toggleBookmark = useCallback(
    (page = currentPage) => {
      setBookmarks((prev) =>
        prev.some((b) => b.pageNumber === page)
          ? prev.filter((b) => b.pageNumber !== page)
          : [
              ...prev,
              {
                id: `bm-${Date.now()}`,
                pageNumber: page,
                title: `Page ${pageLabels[page - 1] || page}`,
                createdAt: new Date().toISOString(),
              },
            ],
      );
    },
    [currentPage, pageLabels],
  );

  const handleFitToWidth = useCallback(() => {
    if (!scrollRef.current) return;
    const avail = scrollRef.current.clientWidth - 48;
    const dim = pageDimensions[currentPage] ?? pageDimensions[1] ?? DEFAULT_DIM;
    if (dim.width > 0) {
      setZoomLevel(
        Math.min(500, Math.max(25, Math.floor((avail / dim.width) * 100))),
      );
    }
  }, [pageDimensions, currentPage]);

  const handleAddAnnotation = useCallback(
    (annot: PdfAnnotation) => {
      hasEditedAnnotationsRef.current = true;
      setAnnotations((prev) => [...prev, annot]);
    },
    [setAnnotations],
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      hasEditedAnnotationsRef.current = true;
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [setAnnotations],
  );

  const handleNoteClick = useCallback(
    (note: NoteAnnotation, pos: { x: number; y: number }) => {
      setEditingNoteId(note.id);
      setNoteAnchorPos(pos);
    },
    [],
  );

  const handleAddFigureCrop = useCallback(
    async (crop: {
      pageNumber: number;
      imageUrl: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }) => {
      if (!activeDoc?.id) return;
      const id = `crop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await DocumentDatabase.saveFigureCrop(id, crop.imageUrl, activeDoc.id);
      setCropAnnotations((prev) => [
        {
          id,
          pageNumber: crop.pageNumber,
          toolType: "area_select",
          color: "#06B6D4",
          imageUrl: `idb://${id}`,
          createdAt: new Date().toISOString(),
          x: crop.x,
          y: crop.y,
          width: crop.width,
          height: crop.height,
        },
        ...prev,
      ]);
      toast.success("Figure captured");
    },
    [activeDoc?.id],
  );

  const handleDimensionsDiscovered = useCallback(
    (p: number, width: number, height: number) => {
      setPageDimensions((prev) =>
        prev[p]?.width === width && prev[p]?.height === height
          ? prev
          : { ...prev, [p]: { width, height } },
      );
    },
    [],
  );

  const handleDocumentItemClick = useCallback(
    async ({ pageNumber, dest }: { pageNumber?: number; dest?: unknown }) => {
      if (pageNumber) return jumpToPage(pageNumber);
      if (dest && pdfProxy) {
        try {
          const target =
            typeof dest === "string"
              ? await pdfProxy.getDestination(dest)
              : dest;
          if (Array.isArray(target) && target[0]) {
            jumpToPage((await pdfProxy.getPageIndex(target[0])) + 1);
          }
        } catch {}
      }
    },
    [jumpToPage, pdfProxy],
  );

  const handleDocumentLoadSuccess = useCallback(
    async (loaded: any) => {
      const count = loaded.numPages;
      setPdfProxy(loaded);
      setTotalPages(count);
      if (activeDoc?.id) setDocPageCount(activeDoc.id, count);

      const targetPage = Math.min(
        count,
        Math.max(1, pendingRestorePageRef.current ?? 1),
      );
      if (targetPage > 1) {
        programmaticScrollRef.current = true;
        setCurrentPage(targetPage);
        setRenderedPages(
          new Set(
            [
              targetPage - 2,
              targetPage - 1,
              targetPage,
              targetPage + 1,
              targetPage + 2,
              targetPage + 3,
            ].filter((p) => p >= 1 && p <= count),
          ),
        );
        requestAnimationFrame(() => {
          const el = pageRefsMap.current.get(targetPage);
          const container = scrollRef.current;
          if (container && el) {
            const topDelta =
              el.getBoundingClientRect().top -
              container.getBoundingClientRect().top;
            container.scrollTo({
              top: Math.max(0, container.scrollTop + topDelta - 24),
              behavior: "auto",
            });
          }
          restoreTimerRef.current = setTimeout(() => {
            programmaticScrollRef.current = false;
            pendingRestorePageRef.current = null;
          }, 80);
        });
      } else {
        pendingRestorePageRef.current = null;
        setRenderedPages(
          new Set([1, 2, 3, 4].filter((p) => p >= 1 && p <= count)),
        );
      }

      const [nextOutline, nextLabels] = await Promise.all([
        PdfService.extractOutline(loaded).catch(() => []),
        PdfService.extractPageLabels(loaded).catch(() => null),
      ]);
      setOutline(nextOutline);
      if (nextLabels) setPageLabels(nextLabels);
    },
    [activeDoc?.id, setDocPageCount],
  );

  const handleDocumentLoadError = useCallback((err: Error) => {
    toast.error(err?.message || "Failed to load PDF");
  }, []);

  if (!activeDoc || !pdfSource) return null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-deep)]">
      {/* Row 1: Full-width ViewerHeader */}
      <ViewerHeader
        currentPage={currentPage}
        totalPages={totalPages}
        currentLabel={currentLabel}
        zoomLevel={zoomLevel}
        isSidebarOpen={sidebarOpen}
        isCurrentPageBookmarked={isBookmarked}
        shortcutModifier={shortcutModifier}
        onToggleSidebar={toggleSidebar}
        onJumpToPage={jumpToPage}
        onCommitPageInput={(val) => {
          const clean = val.trim();
          const idx = pageLabels.findIndex(
            (l) => l.toLowerCase() === clean.toLowerCase(),
          );
          if (idx !== -1) return jumpToPage(idx + 1);
          const n = parseInt(clean, 10);
          if (!Number.isNaN(n)) jumpToPage(n);
        }}
        onZoomChange={setZoomLevel}
        onResetZoom={() => setZoomLevel(100)}
        onFitToWidth={handleFitToWidth}
        onToggleBookmark={() => toggleBookmark(currentPage)}
        onOpenSearch={search.openSearch}
      />

      {/* Row 2+: Sidebar on left, Toolbar + PDF canvas on right */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <PdfSidebar
          isOpen={sidebarOpen}
          outline={outline}
          bookmarks={bookmarks}
          crops={cropAnnotations}
          currentPage={currentPage}
          pageLabels={pageLabels}
          onJumpToPage={jumpToPage}
          onAddBookmark={(p) => toggleBookmark(p)}
          onDeleteBookmark={(id) => {
            setBookmarks((prev) => prev.filter((b) => b.id !== id));
          }}
          onDeleteCrop={async (id) => {
            await DocumentDatabase.deleteFigureCrop(id);
            setCropAnnotations((prev) => prev.filter((c) => c.id !== id));
          }}
        />

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <PdfToolbar
            presets={toolManager.presets}
            activeState={toolManager.activeState}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            onTogglePreset={toolManager.togglePreset}
            onSetSelectMode={toolManager.setSelectMode}
            onSetStrokeWidth={toolManager.setStrokeWidth}
            onSetUnderlineStyle={toolManager.setUnderlineStyle}
            onAddPreset={toolManager.addPreset}
            onUpdatePreset={toolManager.updatePreset}
            onRemovePreset={toolManager.removePreset}
            onResetPresets={toolManager.resetPresets}
          />

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <SearchOverlay
              isOpen={search.isSearchOpen}
              searchQuery={search.searchQuery}
              isSearching={search.isSearching}
              totalMatches={search.searchResults.length}
              currentMatchIndex={search.currentMatchIndex}
              searchInputRef={search.searchInputRef}
              onQueryChange={(q) => {
                search.setSearchQuery(q);
                search.executeSearch(q);
              }}
              onNext={search.handleSearchNext}
              onPrev={search.handleSearchPrev}
              onClose={search.closeSearch}
            />

            <div
              ref={scrollRef}
              className={`relative flex-1 overflow-auto p-6 ${isCtrlHeld ? "ctrl-active" : ""}`}
            >
              <Document
                file={pdfSource}
                options={PDF_DOCUMENT_OPTIONS}
                externalLinkTarget="_blank"
                externalLinkRel="noopener noreferrer"
                onItemClick={handleDocumentItemClick}
                onLoadSuccess={handleDocumentLoadSuccess}
                onLoadError={handleDocumentLoadError}
                loading={null}
              >
                <div
                  ref={pagesContainerRef}
                  className="mx-auto flex flex-col items-center gap-6"
                >
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (pageNum) => {
                      const dim =
                        pageDimensions[pageNum] ??
                        pageDimensions[1] ??
                        DEFAULT_DIM;
                      const w = Math.round((dim.width * zoomLevel) / 100);
                      const h = Math.round((dim.height * zoomLevel) / 100);

                      return (
                        <div
                          key={pageNum}
                          ref={getPageRefCallback(pageNum)}
                          data-page-number={pageNum}
                        >
                          {renderedPages.has(pageNum) ? (
                            <PdfPage
                              pageNumber={pageNum}
                              zoomLevel={zoomLevel}
                              renderZoomLevel={renderZoom}
                              estimatedWidth={dim.width}
                              estimatedHeight={dim.height}
                              activeTool={toolManager.activeState.toolType}
                              activeColor={toolManager.activeState.color}
                              activeStrokeWidth={
                                toolManager.activeState.strokeWidth
                              }
                              activeUnderlineStyle={
                                toolManager.activeState.underlineStyle
                              }
                              pageAnnotations={
                                annotationsByPage.get(pageNum) ?? EMPTY_ANNOTS
                              }
                              registerPageRef={noopRegisterPageRef}
                              onAddAnnotation={handleAddAnnotation}
                              onDeleteAnnotation={handleDeleteAnnotation}
                              onNoteClick={handleNoteClick}
                              onAddFigureCrop={handleAddFigureCrop}
                              onDimensionsDiscovered={
                                handleDimensionsDiscovered
                              }
                            />
                          ) : (
                            <div
                              style={{ width: w, height: h }}
                              aria-hidden="true"
                              className="rounded-sm border border-border bg-white shadow-[var(--shadow-sm)]"
                            />
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
              </Document>
            </div>

            {isCtrlHeld && (
              <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-[var(--shadow-sm)]">
                Links active
              </div>
            )}
          </div>
        </div>

        {/* Resizable Right AI Studio Sidebar */}
        <AiStudioSidebar
          isOpen={isAiStudioOpen}
          onJumpToPage={jumpToPage}
          annotations={studioAnnotations}
        />
      </div>

      <NoteEditorPortal
        note={editingNote}
        anchorPos={noteAnchorPos}
        onClose={() => {
          setEditingNoteId(null);
          setNoteAnchorPos(null);
        }}
        onUpdateNote={(updated) => {
          hasEditedAnnotationsRef.current = true;
          setAnnotations((prev) =>
            prev.map((a) => (a.id === updated.id ? updated : a)),
          );
        }}
        onDeleteNote={(id) => {
          hasEditedAnnotationsRef.current = true;
          setAnnotations((prev) => prev.filter((a) => a.id !== id));
          setEditingNoteId(null);
          setNoteAnchorPos(null);
        }}
      />
    </div>
  );
}

export default ViewerView;
```

---

### Local Verification Checklist

After installing the packages from Response 1 and applying the files from Responses 1–3, run locally:

```bash
npx tsc --noEmit
npm run build
```

Then verify in the app (`npm run tauri dev`):
1. Open a PDF, add highlights, underlines, sticky notes, and a figure crop (`area_select`).
2. Confirm the **Summarize** tab shows live counts and **Open Summarization Studio** opens the split-screen workspace cleanly in both **Light** and **Dark** mode.
3. Click **Generate** and confirm streamed Markdown, fenced code blocks (Lowlight), and embedded `idb://...` figure crops render cleanly in the Tiptap editor.
4. Click **Insert** on a figure crop card, edit text in the right pane, close and reopen the workspace to confirm SQLite auto-save restores your exact edits, and test **Copy Markdown** and **Export `.md`**.