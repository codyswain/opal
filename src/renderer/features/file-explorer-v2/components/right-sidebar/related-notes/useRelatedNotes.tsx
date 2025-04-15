import { useState, useCallback, useEffect } from "react";
import { toast } from "@/renderer/shared/components/Toast";
import { SimilarNote } from "@/renderer/shared/types";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";

export const useRelatedNotes = (isOpen: boolean) => {
  const [similarNotes, setSimilarNotes] = useState<SimilarNote[]>([]);
  const [similarNotesIsLoading, setSimilarNotesIsLoading] = useState<boolean>(false);

  const { entities, ui, selectEntry } = useFileExplorerStore();
  const selectedId = ui.selectedId;
  const selectedNote = selectedId && entities.notes[selectedId];

  const findSimilarNotes = useCallback(async () => {
    if (!selectedNote || !selectedId) {
      console.error("No active note");
      setSimilarNotes([]);
      setSimilarNotesIsLoading(false);
      return;
    }
    
    setSimilarNotesIsLoading(true);
    
    try {
      
      const similarNotes = await window.vfsAPI.findSimilarNotes(
        selectedNote.content,
        { rootIds: [], nodes: {} }
      );
      
      setSimilarNotes(
        similarNotes.filter(
          (note: SimilarNote) => note.id !== selectedId && note.score >= 0.5
        )
      );
    } catch (error) {
      console.error("Error finding similar notes:", error);
      toast("Failed to find similar notes", {
        description: "An error occurred while searching for similar notes.",
      });
      setSimilarNotes([]);
    } finally {
      setSimilarNotesIsLoading(false);
    }
  }, [selectedNote, selectedId]);

  // Function to open a note using fileExplorerStore
  const openNote = useCallback((note: SimilarNote) => {
    selectEntry(note.id);
  }, [selectEntry]);

  useEffect(() => {
    if (isOpen && selectedNote && selectedId) {
      findSimilarNotes();
    }
  }, [isOpen, selectedId, selectedNote, findSimilarNotes]);

  return {
    similarNotes,
    similarNotesIsLoading,
    findSimilarNotes,
    openNote
  };
}; 