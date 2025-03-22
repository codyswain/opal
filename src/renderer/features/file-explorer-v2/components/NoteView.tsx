import React, { useState, useRef, useEffect } from "react";
import { Input } from "@/renderer/shared/components/Input";
import { Loader2, Check, ArrowLeft, ArrowRight, Edit3 } from "lucide-react";
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
    <div className="flex flex-col h-full">
      {/* Header with note name and controls - made consistent with FolderView */}
      <div className="p-4 border-b flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button 
              onClick={goBack}
              disabled={!canGoBack()}
              className={`p-1.5 rounded-md ${canGoBack() ? 'hover:bg-muted' : 'opacity-50 cursor-not-allowed'}`}
              title="Go back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button 
              onClick={goForward}
              disabled={!canGoForward()}
              className={`p-1.5 rounded-md ${canGoForward() ? 'hover:bg-muted' : 'opacity-50 cursor-not-allowed'}`}
              title="Go forward"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            
            {isEditing ? (
              <div className="flex items-center">
                <Input
                  ref={inputRef}
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={handleKeyDown}
                  className="text-xl font-semibold bg-transparent h-8 px-2"
                  aria-label="Edit note title"
                />
                {isRenamingSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                ) : (
                  <button onClick={handleRename} className="ml-1 p-1 hover:bg-muted rounded">
                    <Check className="h-4 w-4" />
                  </button>
                )}
              </div>
            ) : (
              <div 
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1 cursor-pointer group"
              >
                <h2 className="text-xl font-semibold">{selectedNode.name}</h2>
                <Edit3 className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50" />
              </div>
            )}
          </div>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center">
                {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    indicatorStatus === "green"
                      ? "bg-primary"
                      : "bg-secondary animate-pulse"
                  )}
                />
              </div>
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

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-4xl mx-auto w-full">
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