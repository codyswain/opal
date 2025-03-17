import { FSEntry } from "@/types";
import { useEffect, useState } from "react";

export const useFileExplorer = () => {
  const [items, setItems] = useState<Record<string, FSEntry> | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);

  useEffect(() => {
    window.fileExplorer.getEntries().then(({ success, items }) => {
      if (success) {
        setItems(items);
      }
    });
  }, []);


  const getNote = (id: string) => {
    window.fileExplorer.getNote(id).then(({ success, content }) => {
      if (success) {
        setNote(content);
      }
    });
  }

  return { items, setItems, getNote, note };
}