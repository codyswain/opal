// src/features/notes/hooks/useNoteExplorerContextMenu.tsx

import { FSEntry } from "@/renderer/shared/types";
import { useState, useCallback, useEffect } from "react";

interface ContextMenuState {
  x: number;
  y: number;
  entry: FSEntry;
}

export const useNoteExplorerContextMenu = () => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (
      e: React.MouseEvent,
      entry: FSEntry
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        entry
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
