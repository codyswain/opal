import { cn } from "@/renderer/shared/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/renderer/shared/components/Tooltip";
import { Target } from "lucide-react";

const getScoreColor = (score: number): string => {
  if (score >= 0.9) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.8) return "text-green-600 dark:text-green-400";
  if (score >= 0.7) return "text-yellow-600 dark:text-yellow-400";
  if (score >= 0.6) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
};

export const ScoreTooltip: React.FC<{ score: number }> = ({ score }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger>
        <span
          className={cn(
            `text-xs font-medium flex items-center flex-shrink-0`,
            `${getScoreColor(score)} `
          )}
        >
          <Target className="h-2.5 w-2.5 mr-0.5 opacity-60" />
          {score.toFixed(2)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">Similarity score: {score.toFixed(2)}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
); 