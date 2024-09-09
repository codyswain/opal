import React from 'react';
import { cn } from '@/shared/utils';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, children }) => {
  return (
    <div
      className={cn(
        "absolute z-50 min-w-[200px] bg-popover text-popover-foreground",
        "rounded-md shadow-md overflow-hidden"
      )}
      style={{ top: y, left: x }}
    >
      {children}
    </div>
  );
};

export default ContextMenu;