import React, { useEffect, useCallback } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Placeholder } from "@tiptap/extension-placeholder";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { BulletList } from '@tiptap/extension-bullet-list';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { ListItem } from '@tiptap/extension-list-item';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { TextAlign } from '@tiptap/extension-text-align';
import { EditorView } from "@tiptap/pm/view";
import Toolbar from "@/renderer/features/notes/components/NoteEditor/Toolbar";
import '@/renderer/styles/NoteEditor.css';
import { configureLowlight } from "./editorConfig";

const lowlight = configureLowlight();

const USE_TABS = true; 
const SPACES_PER_TAB = 4;

interface NoteEditorProps {
  content: string;
  onUpdate: ({ editor }: { editor: any }) => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ content, onUpdate }) => {
  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
      }),
      Markdown,
      Placeholder.configure({
        placeholder: "Type '/' for commands...",
      }),
      BulletList.configure({
        keepMarks: true,
        keepAttributes: false,
      }),
      OrderedList.configure({
        keepMarks: true,
        keepAttributes: false,
        itemTypeName: 'listItem',
        HTMLAttributes: {
          class: 'ordered-list',
        },
      }),
      ListItem,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Link.configure({
        openOnClick: false,
      }),
      Image,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content: content || "",
    onUpdate: onUpdate,
    autofocus: true,
    editorProps: {
      attributes: {
        class: "prose prose-md dark:prose-invert focus:outline-none max-w-none h-full w-full overflow-auto leading-normal cursor-text",
      },
      handleKeyDown: (view: EditorView, event: KeyboardEvent): boolean => {
        if (event.key === 'Tab') {
          event.preventDefault();
          if (event.shiftKey) {
            // Outdent (move left) when Shift+Tab is pressed
            if (editor?.commands.liftListItem('listItem')) {
              return true;
            }
            return false;
          } else {
            // Indent (move right) when Tab is pressed
            if (editor?.commands.sinkListItem('listItem')) {
              return true;
            }
            // If not in a list, add indentation
            const { from, to } = editor.state.selection;
            const indentation = USE_TABS ? '\t' : ' '.repeat(SPACES_PER_TAB);
            editor.chain()
              .focus()
              .insertContent({ type: 'text', text: indentation })
              .setTextSelection(from + indentation.length)
              .run();
            return true;
          }
        }
        return false;
      },
    },
  });

  // Update editor content when it changes externally
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content, editor]);

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden p-4">
      <div className="sticky top-0 z-10 backdrop-blur-sm bg-background/90 border-b border-border/40 px-2 py-0.5 mb-1">
        <Toolbar editor={editor} />
      </div>
      <div
        className="flex-grow overflow-auto"
        onClick={() => {
          if (editor) {
            editor.chain().focus().run();
          }
        }}
      >
        <div className="min-h-full max-w-4xl mx-auto px-6 py-2 bg-card text-card-foreground rounded-lg shadow-lg">
          <EditorContent 
            className="prose-modern" 
            editor={editor} 
          />
        </div>
      </div>
    </div>
  );
};

export default NoteEditor;