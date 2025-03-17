import { FSEntry, Note } from "@/types";
import { useEffect, useState } from "react";

/**
 * Hook for managing file explorer state and operations
 */
export const useFileExplorer = () => {
  const [items, setItems] = useState<Record<string, FSEntry> | undefined>(undefined);
  const [note, setNote] = useState<Note | undefined>(undefined);

  useEffect(() => {
    window.fileExplorer.getEntries().then(({ success, items }) => {
      if (success) {
        setItems(items);
      }
    });
  }, []);

  const getNote = (id: string) => {
    window.fileExplorer.getNote(id).then(({ success, note }) => {
      if (success) {
        setNote(note);
      }
    });
  }

  return { items, setItems, getNote, note };
} 