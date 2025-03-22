import React, { useEffect, useCallback, useState } from "react";
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
import { cn } from '@/renderer/shared/utils/cn';
import '@/renderer/styles/NoteEditor.css';
import { configureLowlight } from "./editorConfig";
import Toolbar from "@/renderer/features/notes/components/NoteEditor/Toolbar";

// Create a simple extension for keyboard shortcuts
const KeyboardShortcuts = {
  name: 'keyboardShortcuts',
  addKeyboardShortcuts() {
    return {
      'Mod-b': () => this.editor.commands.toggleBold(),
      'Mod-i': () => this.editor.commands.toggleItalic(),
      'Mod-u': () => this.editor.commands.toggleUnderline(),
      'Mod-k': () => this.editor.commands.toggleLink(),
    };
  },
};

// Simple FileHandler component
const FileHandler = ({ children, onFileDrop }: { children: React.ReactNode, onFileDrop: (files: File[]) => void }) => {
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      onFileDrop(files);
    }
  };
  
  return (
    <div 
      className="w-full h-full"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
};

const lowlight = configureLowlight();

const USE_TABS = true; 
const SPACES_PER_TAB = 4;

interface NoteEditorProps {
  content: string;
  onUpdate: ({ editor }: { editor: any }) => void;
  readOnly?: boolean;
  filePath?: string;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ 
  content, 
  onUpdate,
  readOnly = false,
  filePath
}) => {
  const [wordCount, setWordCount] = useState({ words: 0, characters: 0 });
  
  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        history: {
          depth: 100,
          newGroupDelay: 500,
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
        HTMLAttributes: {
          class: 'code-block',
        },
      }),
      Markdown.configure({
        transformPastedText: true,
      }),
      Placeholder.configure({
        placeholder: "Type '/' for commands...",
        emptyEditorClass: 'is-editor-empty',
      }),
      BulletList.configure({
        keepMarks: true,
        keepAttributes: false,
        HTMLAttributes: {
          class: 'bullet-list',
        },
      }),
      OrderedList.configure({
        keepMarks: true,
        keepAttributes: false,
        itemTypeName: 'listItem',
        HTMLAttributes: {
          class: 'ordered-list',
        },
      }),
      ListItem.configure({
        HTMLAttributes: {
          class: 'list-item',
        },
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: 'task-list',
        },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: 'task-item',
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'editor-table',
        },
      }),
      TableRow,
      TableHeader,
      TableCell,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'editor-link',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
        validate: url => /^https?:\/\//.test(url) || url.startsWith('#'),
      }),
      Image.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: 'editor-image',
        },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: 'left',
      }),
    ],
    content: content || "",
    onUpdate: ({ editor }) => {
      onUpdate({ editor });
      
      // Update word count
      const text = editor.getText();
      const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
      const characterCount = text.length;
      
      setWordCount({
        words: wordCount,
        characters: characterCount,
      });
    },
    autofocus: !readOnly,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-md dark:prose-invert focus:outline-none max-w-none h-full w-full overflow-auto leading-normal cursor-text",
          readOnly && "editor-readonly"
        ),
      },
      handleKeyDown: (view: EditorView, event: KeyboardEvent): boolean => {
        if (readOnly) return false;
        
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
        
        // Handle keyboard shortcuts
        if (event.key === 'b' && (event.ctrlKey || event.metaKey)) {
          editor.chain().focus().toggleBold().run();
          return true;
        }
        
        if (event.key === 'i' && (event.ctrlKey || event.metaKey)) {
          editor.chain().focus().toggleItalic().run();
          return true;
        }
        
        return false;
      },
      handleDrop: (view, event, slice, moved) => {
        // Handle dropped content and files
        if (!moved && event.dataTransfer?.files.length) {
          const files = Array.from(event.dataTransfer.files);
          const imageFiles = files.filter(file => file.type.startsWith('image/'));
          
          if (imageFiles.length > 0) {
            // Show image upload modal or handle image insert directly
            event.preventDefault();
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
  
  // Handle file drop for image upload
  const handleFileDrop = useCallback((files: File[]) => {
    if (!editor) return;
    
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    imageFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          editor.chain().focus().setImage({ src: result }).run();
        }
      };
      reader.readAsDataURL(file);
    });
  }, [editor]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 backdrop-blur-sm bg-background/80 border-b border-border/30 px-1 py-0.5">
        {!readOnly && (
          <div className="flex justify-between items-center">
            <div className="text-xs text-muted-foreground ml-auto">
              {wordCount.words} words · {wordCount.characters} characters
            </div>
          </div>
        )}
        
        {!readOnly && (
          <Toolbar editor={editor} />
        )}
      </div>
      
      <div className="flex-grow overflow-auto relative">
        <FileHandler onFileDrop={handleFileDrop}>
          <div className="overflow-auto min-h-full px-4 py-2">
            <EditorContent 
              className="prose-modern" 
              editor={editor} 
            />
          </div>
        </FileHandler>
      </div>
    </div>
  );
};

export default NoteEditor;