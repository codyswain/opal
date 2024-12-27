import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/renderer/shared/components/Tooltip";
import { SimilarNote } from "@/renderer/shared/types";
import { Target } from "lucide-react";

const getScoreColor = (score: number): string => {
  if (score >= 0.9) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.8) return "text-green-600 dark:text-green-400";
  if (score >= 0.7) return "text-yellow-600 dark:text-yellow-400";
  if (score >= 0.6) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
};

const stripHtmlTags = (content: string): string => {
  return content.replace(/<[^>]*>/g, "");
};

const truncateContent = (content: string, maxLength: number): string => {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "...";
};

const ScoreTooltip: React.FC<{ score: number }> = ({ score }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger>
        <span
          className={`text-sm font-medium flex items-center flex-shrink-0 ${getScoreColor(
            score
          )}`}
        >
          <Target className="h-3 w-3 mr-1 opacity-60" />
          {score.toFixed(2)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>Similarity score: {score.toFixed(2)}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const NoteItem: React.FC<{
  note: SimilarNote;
  openNote: (note: SimilarNote) => void;
}> = ({ note, openNote }) => {
  return (
    <div
      className="cursor-pointer hover:bg-accent/10 p-3 rounded transition-colors duration-200 w-full"
      onClick={() => openNote(note)}
    >
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-semibold truncate mr-2">{note.title}</h3>
        <ScoreTooltip score={note.score} />
      </div>
      <div className="text-sm text-muted-foreground">
        {truncateContent(stripHtmlTags(note.content), 100)}
      </div>
    </div>
  );
};
