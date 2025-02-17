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
import { cn } from "@/renderer/shared/utils/cn";

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
        "w-full cursor-pointer hover:bg-accent/50 rounded-md p-2",
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
      <div className="flex flex-row justify-between w-full">
        <div style={{ flex: 4, flexDirection: "column" }}>
          <div className="flex justify-start w-full">
            <h3 className="font-semibold truncate mr-2">{note.title}</h3>
          </div>
          <div className="flex justify-start w-full">
            <p className="text-wrap break-all text-left text-muted-foreground text-sm">
              {truncateContent(stripHtmlTags(note.content).trim(), 100)}
            </p>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <ScoreTooltip score={note.score} />
        </div>
      </div>
    </div>
  );
};
