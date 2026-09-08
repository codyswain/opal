import React, { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { markdownExtensions } from "../disk-explorer/components/editor/editorExtensions";

/** Compare parsed meaning, so blank lines and rule markers don't force source mode.
 * Custom file syntax remains direct text; mounting never serializes back to the store. */
export function journalNeedsSource(
  original: string,
  serialized: string,
  render: (markdown: string) => string,
): boolean {
  return (
    /^---\r?\n[\s\S]*?\n---(?:\r?\n|$)/.test(original) ||
    /!\[|\[\[|(^|\n)\s*\[\^|<\/?[a-z!]|\$\$/i.test(original) ||
    render(original) !== render(serialized)
  );
}
export function JournalEditor({
  text,
  onChange,
  onSave,
}: {
  text: string;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };
  const lastText = useRef(text);
  const [source, setSource] = useState(false);
  const [fidelity, setFidelity] = useState(false);
  const extensions = useMemo(() => markdownExtensions(), []);
  const editor = useEditor({
    extensions,
    content: text,
    editorProps: {
      attributes: {
        class: "journal-prose",
        role: "textbox",
        "aria-label": "Daily journal",
        "aria-multiline": "true",
        spellcheck: "true",
      },
      handleKeyDown: (_view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          callbacks.current.onSave();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: updated }) => {
      const next = updated.storage.markdown.getMarkdown();
      lastText.current = next;
      callbacks.current.onChange(next);
    },
    onBlur: () => callbacks.current.onSave(),
  });
  useEffect(() => {
    if (!editor) return;
    if (lastText.current !== text) {
      editor.commands.setContent(text, false);
      lastText.current = text;
    }
    const needsSource = journalNeedsSource(
      text,
      editor.storage.markdown.getMarkdown(),
      (markdown) => editor.storage.markdown.parser.parse(markdown),
    );
    setFidelity(needsSource);
    if (needsSource) setSource(true);
    editor.setEditable(!source && !needsSource, false);
  }, [editor, text, source]);
  const showSource = source || fidelity;
  return (
    <div className="journal-writing" data-disk-shortcuts-ignore="true">
      <div className="journal-toolbar" aria-label="Journal controls">
        <div className="journal-formatting">
          {!showSource && editor && (
            <>
              <button
                aria-label="Bold"
                aria-pressed={editor.isActive("bold")}
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <strong>B</strong>
              </button>
              <button
                aria-label="Italic"
                aria-pressed={editor.isActive("italic")}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <em>I</em>
              </button>
              <button
                aria-label="Heading"
                aria-pressed={editor.isActive("heading")}
                onClick={() =>
                  editor.chain().focus().toggleHeading({ level: 2 }).run()
                }
              >
                H
              </button>
              <button
                aria-label="Bullet list"
                aria-pressed={editor.isActive("bulletList")}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                ☷
              </button>
              <button
                aria-label="Undo"
                disabled={!editor.can().undo()}
                onClick={() => editor.chain().focus().undo().run()}
              >
                ↶
              </button>
            </>
          )}
        </div>
        <button
          className="journal-source-toggle"
          aria-pressed={showSource}
          disabled={fidelity}
          onClick={() => setSource((value) => !value)}
        >
          {showSource ? "Markdown source" : "Source"}
        </button>
      </div>
      {fidelity && (
        <p className="journal-fidelity">
          This entry uses custom Markdown. Source mode keeps every detail
          intact.
        </p>
      )}
      {showSource ? (
        <textarea
          className="journal-source"
          aria-label="Journal Markdown source"
          spellCheck
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onSave}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === "s"
            ) {
              event.preventDefault();
              onSave();
            }
          }}
        />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}
