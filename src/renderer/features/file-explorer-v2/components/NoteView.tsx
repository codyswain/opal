import React from "react";
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
  if (!selectedNode || !selectedNote) {
    return <div className="flex justify-center items-center h-full">Loading note...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      <div className="flex flex-col h-full max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center flex-grow">
            <Input
              type="text"
              value={selectedNode.name}
              readOnly
              className="text-2xl font-semibold border-none focus:ring-0 bg-background text-foreground flex-grow"
              aria-label="Note title"
            />
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