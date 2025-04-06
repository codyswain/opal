import React from "react";
import { cn } from "@/renderer/shared/utils";

interface ContextMenuProps {
  x: number;
  y: number;

  children: React.ReactNode;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, children }) => {
  return (
    <div
      className={cn(
        "absolute z-50 max-w-[200px] bg-popover",
        "text-popover-foreground rounded-md shadow-md",
        "overflow-hidden"
      )}
      style={{ top: y, left: x }}
    >
      {children}
    </div>
  );
};

export default ContextMenu;
