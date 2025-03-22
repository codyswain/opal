import React, { useState, useRef, useEffect } from "react";
import { Input } from "@/renderer/shared/components/Input";
import { Loader2, Check, ArrowLeft, ArrowRight } from "lucide-react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const { renameItem, goBack, goForward, canGoBack, canGoForward } = useFileExplorerStore();

  // Update title when selected node changes
  useEffect(() => {
    if (selectedNode) {
      setNewTitle(selectedNode.name);
    }
  }, [selectedNode]);

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

  if (!selectedNode || !selectedNote) {
    return <div className="flex justify-center items-center h-full">Loading note...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      <div className="flex flex-col h-full max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center flex-grow">
            {/* Navigation buttons */}
            <div className="flex items-center mr-3">
              <button 
                onClick={goBack}
                disabled={!canGoBack()}
                className={`p-1.5 rounded-md ${canGoBack() ? 'hover:bg-muted text-foreground' : 'opacity-50 cursor-not-allowed text-muted-foreground'}`}
                title="Go back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button 
                onClick={goForward}
                disabled={!canGoForward()}
                className={`p-1.5 rounded-md ml-1 ${canGoForward() ? 'hover:bg-muted text-foreground' : 'opacity-50 cursor-not-allowed text-muted-foreground'}`}
                title="Go forward"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {isEditing ? (
              <Input
                ref={inputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onBlur={handleRename}
                onKeyDown={handleKeyDown}
                className="text-2xl font-semibold bg-background text-foreground flex-grow"
                aria-label="Edit note title"
              />
            ) : (
              <Input
                type="text"
                value={selectedNode.name}
                readOnly
                onClick={() => setIsEditing(true)}
                className="text-2xl font-semibold border-none focus:ring-0 bg-background text-foreground flex-grow cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Note title"
              />
            )}
            {isRenamingSaving && <Loader2 className="h-4 w-4 animate-spin ml-2 text-muted-foreground" />}
            {isEditing && !isRenamingSaving && (
              <button 
                onClick={handleRename}
                className="ml-2 text-primary hover:text-primary/80"
              >
                <Check className="h-4 w-4" />
              </button>
            )}
            {isSaving && <Loader2 className="h-4 w-4 animate-spin ml-2 text-muted-foreground" />}
          </div>
          <div className="flex items-center space-x-2">
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
                    ? "Note saved"
                    : "Saving note..."}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex-grow">
          <NoteEditor 
            content={selectedNote.content || ""} 
            onUpdate={handleContentChange} 
          />
        </div>
      </div>
    </div>
  );
};

export default NoteView;