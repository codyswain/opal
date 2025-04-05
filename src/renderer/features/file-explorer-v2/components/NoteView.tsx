import React, { useState, useRef, useEffect } from "react";
import { Input } from "@/renderer/shared/components/Input";
import { Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/renderer/shared/components/Tooltip";
import { cn } from '@/renderer/shared/utils/cn';
import NoteEditor from "./NoteEditor";
import { FSEntry, Note } from "@/types";
import { useFileExplorerStore } from "../store/fileExplorerStore";

interface NoteViewProps {
  selectedNode: FSEntry;
  selectedNote: Note;
  isSaving: boolean;
  indicatorStatus: "green" | "yellow";
  handleContentChange: ({ editor }: { editor: any }) => void;
}

const NoteView: React.FC<NoteViewProps> = ({
  selectedNode,
  selectedNote,
  isSaving,
  indicatorStatus,
  handleContentChange,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [newTitle, setNewTitle] = useState(selectedNode?.name || "");
  const [isRenamingSaving, setIsRenamingSaving] = useState(false);
  const [wordCount, setWordCount] = useState({ words: 0, characters: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const { renameItem } = useFileExplorerStore();

  // Update title when selected node changes
  useEffect(() => {
    if (selectedNode) {
      setNewTitle(selectedNode.name);
    }
  }, [selectedNode]);

  // Initialize word count when note changes
  useEffect(() => {
    if (selectedNote && selectedNote.content) {
      // Extract text from the HTML content
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = selectedNote.content;
      const text = tempDiv.textContent || '';
      
      const words = text.split(/\s+/).filter((word: string) => word.length > 0).length;
      const characters = text.length;
      setWordCount({ words, characters });
    } else {
      setWordCount({ words: 0, characters: 0 });
    }
  }, [selectedNote]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRename = async () => {
    if (!selectedNode || newTitle === selectedNode.name || !newTitle.trim()) {
      setIsEditing(false);
      setNewTitle(selectedNode?.name || "");
      return;
    }

    setIsRenamingSaving(true);
    try {
      const success = await renameItem(selectedNode.id, newTitle);
      if (!success) {
        // Reset to original name if rename failed
        setNewTitle(selectedNode.name);
      }
    } catch (error) {
      console.error("Error renaming note:", error);
      setNewTitle(selectedNode.name);
    } finally {
      setIsRenamingSaving(false);
      setIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRename();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setNewTitle(selectedNode?.name || "");
    }
  };

  const handleEditorUpdate = ({ editor, wordCount }: { editor: any, wordCount?: { words: number, characters: number } }) => {
    // Update word count if provided by the editor
    if (wordCount) {
      setWordCount(wordCount);
    }
    
    // Call the original content change handler with just the editor
    handleContentChange({ editor });
  };

  if (!selectedNode || !selectedNote) {
    return <div className="flex justify-center items-center h-full">Loading note...</div>;
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="flex justify-between items-center border-b border-border bg-background/95 sticky top-0 z-10">
        <div className="flex-1 flex items-center max-w-[900px] w-full mx-auto px-6 py-3 sm:px-4 xs:px-3">
          {isEditing ? (
            <div className="flex-1 flex items-center">
              <Input
                ref={inputRef}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleRename}
                className="h-9 text-lg font-medium"
              />
              {isRenamingSaving && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            </div>
          ) : (
            <div
              className="text-xl font-medium leading-tight truncate cursor-pointer hover:text-primary transition-colors"
              onClick={() => setIsEditing(true)}
              title={selectedNode.name}
            >
              {selectedNode.name}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-background">
        <NoteEditor
          key={selectedNode.id}
          content={selectedNote.content}
          onUpdate={handleEditorUpdate}
          noteId={selectedNode.id}
        />
      </div>
      
      <div className="border-t border-border sticky bottom-0 bg-background/90 backdrop-blur-sm">
        <div className="flex justify-between items-center max-w-[900px] w-full mx-auto px-6 py-1.5 text-xs text-muted-foreground sm:px-4 xs:px-3">
          <div>
            {wordCount.words} words · {wordCount.characters} characters
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger>
                <div
                  className={cn(
                    "w-2 h-2 rounded-full transition-colors",
                    indicatorStatus === "green" ? "bg-green-500" : "bg-yellow-500"
                  )}
                />
              </TooltipTrigger>
              <TooltipContent>
                <p>{indicatorStatus === "green" ? "Saved" : "Saving..."}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoteView;