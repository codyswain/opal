import React, { useState, useEffect, useCallback } from "react";
import { toast } from "@/renderer/shared/components/Toast";
import {cn} from '@/renderer/shared/utils/cn'
import { Loader2 } from "lucide-react";
import { Input } from "@/renderer/shared/components/Input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/renderer/shared/components/Tooltip";
import { Note } from "@/renderer/shared/types";
import { useNotesContext } from "../../context/notesContext";
import { useDebouncedCallback } from "use-debounce";
import "katex/dist/katex.min.css";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Placeholder } from "@tiptap/extension-placeholder";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import js from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import css from "highlight.js/lib/languages/css";
import "highlight.js/styles/github-dark.css";
import Toolbar from "./Toolbar";
import { BulletList } from '@tiptap/extension-bullet-list'
import { OrderedList } from '@tiptap/extension-ordered-list'
import { ListItem } from '@tiptap/extension-list-item'

const lowlight = createLowlight();
lowlight.register("js", js);
lowlight.register("python", python);
lowlight.register("css", css);
lowlight.register('typescript', js);
lowlight.register('html', js);
lowlight.register('json', js);
lowlight.register('markdown', js);
lowlight.register('sql', js);
lowlight.register('bash', js);

const USE_TABS = true; 
const SPACES_PER_TAB = 4;


interface NoteEditorProps {
  note: Note;
}

import '@/renderer/styles/NoteEditor.css'
import { EditorView } from "@tiptap/pm/view";

const NoteEditor: React.FC<NoteEditorProps> = ({ note }) => {
  const { saveNote, createEmbedding } = useNotesContext();

  const [localNote, setLocalNote] = useState(note);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingEmbedding, setIsGeneratingEmbedding] = useState(false);
  const [indicatorStatus, setIndicatorStatus] = useState<"green" | "yellow">("green");

  useEffect(() => {
    setLocalNote(note);
    if (editor && note.content !== editor.getHTML()) {
      editor.commands.setContent(note.content || "");
    }
  }, [note]);

  const debouncedSaveContent = useDebouncedCallback(
    async (updatedNote: Note) => {
      setIsSaving(true);
      try {
        await saveNote(updatedNote);
        setError(null);
        setIndicatorStatus("green");
      } catch (err) {
        setError("Failed to save note. Please try again.");
        toast("Error saving note", {
          description: "An error occurred while saving the note. Please try again.",
        });
      } finally {
        setIsSaving(false);
      }
    },
    1000,
    { leading: false, trailing: true }
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newTitle = e.target.value;
      setLocalNote((prev) => ({ ...prev, title: newTitle }));
      setIndicatorStatus("yellow");
      debouncedSaveContent({ ...localNote, title: newTitle });
    },
    [localNote, debouncedSaveContent]
  );

  const debouncedGenerateEmbedding = useDebouncedCallback(
    async () => {
      setIsGeneratingEmbedding(true);
      try {
        const success = await createEmbedding();
        if (success) {
          console.log("Embedding generated successfully");
        } else {
          console.error("Failed to generate embedding");
        }
      } catch (error) {
        console.error("Error generating embedding:", error);
      } finally {
        setIsGeneratingEmbedding(false);
      }
    },
    5000,
    { leading: false, trailing: true }
  );

  const handleContentChange = useCallback(
    ({ editor }: { editor: any }) => {
      const content = editor.getHTML();
      setLocalNote((prev) => {
        if (prev.content !== content) {
          const updatedNote = { ...prev, content };
          setIndicatorStatus("yellow");
          debouncedSaveContent(updatedNote);
          debouncedGenerateEmbedding();
          return updatedNote;
        }
        return prev;
      });
    },
    [debouncedSaveContent, debouncedGenerateEmbedding]
  );

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
        placeholder: "Start typing your note...",
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
      ListItem
    ],
    content: localNote.content || "",
    onUpdate: handleContentChange,
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
            // If not in a list, remove indentation (not implemented)
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

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden p-4">
      <div className="flex w-full justify-center items-center">
        <div className="flex items-center justify-between mb-4 w-full max-w-4xl">
          <div className="flex items-center flex-grow mr-2">
            <Input
              type="text"
              value={localNote.title}
              onChange={handleTitleChange}
              placeholder="Note Title"
              className="text-2xl font-semibold border-none focus:ring-0 bg-background text-foreground flex-grow"
              aria-label="Note title"
            />
            {isSaving && <Loader2 className="h-4 w-4 animate-spin ml-2 text-muted-foreground" />}
          </div>
          <div className="flex items-center space-x-2 mr-4">
            {isGeneratingEmbedding && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="h-10 w-10 flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Generating embedding...</p>
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    indicatorStatus === "green"
                      ? "bg-primary"
                      : "bg-secondary animate-pulse"
                  )}
                />
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {indicatorStatus === "green"
                    ? "Embedding up to date"
                    : "Embedding needs update"}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

      </div>

      <div className="flex w-full justify-center items-center">
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
          <EditorContent editor={editor}/>
        </div>
      </div>
      {error && <div className="text-destructive mt-2">{error}</div>}
    </div>
  );
};

export default NoteEditor;