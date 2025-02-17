import React from "react";
import { Button } from "@/renderer/shared/components/Button";
import { LucideIcon } from "lucide-react";
import { cn } from "../../utils";

interface ContextMenuItemProps {
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
}

const ContextMenuItem: React.FC<ContextMenuItemProps> = ({
  icon: Icon,
  label,
  onClick,
  className,
}) => {
  return (
    <Button
      variant="ghost"
      className={cn(
        "w-full px-2 py-1.5 text-sm",
        className
      )}
      onClick={onClick}
    >
      <div className="w-full flex flex-row items-center justify-start">
        {Icon && <Icon className="mr-2 h-4 w-4 shrink-0" />}
        <span className="truncate">{label}</span>
      </div>
    </Button>
  );
};

export default ContextMenuItem;
