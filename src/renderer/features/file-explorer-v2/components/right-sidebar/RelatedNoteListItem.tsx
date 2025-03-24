import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/renderer/shared/components/Tooltip";
import { SimilarNote } from "@/renderer/shared/types";
import { Target } from "lucide-react";
import { ScoreTooltip } from "./RelatedNoteScore";
import { cn } from "@/renderer/shared/utils";

const stripHtmlTags = (content: string): string => {
  return content.replace(/<[^>]*>/g, "");
};

const truncateContent = (content: string, maxLength: number): string => {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "...";
};

export const NoteItem: React.FC<{
  note: SimilarNote;
  openNote: (note: SimilarNote) => void;
}> = ({ note, openNote }) => {
  return (
    <div 
      className={cn(
        "w-full cursor-pointer hover:bg-gray-700/30 rounded-md p-1.5",
        "transition-colors duration-200"
      )} 
      onClick={() => openNote(note)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          openNote(note);
        }
      }}
    >
      <div className="flex flex-row justify-between w-full items-center">
        <div style={{ flex: 4, flexDirection: "column" }} className="mr-1">
          <div className="flex justify-start w-full">
            <h3 className="font-medium truncate mr-2 text-xs">{note.title}</h3>
          </div>
          <div className="flex justify-start w-full">
            <p className="text-wrap break-all text-left text-muted-foreground text-xs">
              {truncateContent(stripHtmlTags(note.content).trim(), 80)}
            </p>
          </div>
        </div>
        <div style={{ flex: 1 }} className="flex justify-end">
          <ScoreTooltip score={note.score} />
        </div>
      </div>
    </div>
  );
}; 