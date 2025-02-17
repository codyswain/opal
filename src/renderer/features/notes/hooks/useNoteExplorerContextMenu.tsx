// src/features/notes/hooks/useNoteExplorerContextMenu.tsx

import { FileNode } from "@/renderer/shared/types";
import { useState, useCallback, useEffect } from "react";

interface ContextMenuState {
  x: number;
  y: number;
  fileNode: FileNode;
}

export const useNoteExplorerContextMenu = () => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (
      e: React.MouseEvent,
      fileNode: FileNode
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        fileNode
      });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    const handleGlobalClick = () => {
      closeContextMenu();
    };

    if (contextMenu) {
      document.addEventListener("click", handleGlobalClick);
    }

    return () => {
      document.removeEventListener("click", handleGlobalClick);
    };
  }, [contextMenu, closeContextMenu]);

  return { contextMenu, handleContextMenu, closeContextMenu };
};
