import React, { useCallback, useEffect, useState } from "react";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";

import { Loader2 } from "lucide-react";
import { toast } from "@/renderer/shared/components/Toast";
import { SimilarNote } from "@/renderer/shared/types";
import { NoteItem } from "./RelatedNoteListItem";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";


interface RelatedNotesProps {
  isOpen: boolean;

}

const RelatedNotes: React.FC<RelatedNotesProps> = ({ isOpen }) => {
  const [similarNotes, setSimilarNotes] = useState<SimilarNote[]>([]);
  const [similarNotesIsLoading, setSimilarNotesIsLoading] =
    useState<boolean>(false);

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
      // Using findSimilarNotes from the window.electron API
      const similarNotes = await window.electron.findSimilarNotes(
        selectedNote.content,
        {} // Empty directory structures since we're using SQLite embeddings now
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

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-grow w-full px-1">
        <div className="p-2">
          {
            similarNotesIsLoading ? (
              <div className="flex items-center justify-center h-20">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : similarNotes.length > 0 ? (
              <div className="space-y-4">
                {similarNotes.map((note) => (
                  <NoteItem key={note.id} note={note} openNote={openNote} />
                ))}
              </div>
            ) : (
              <div className="text-center text-sm text-muted-foreground mt-4">
                No similar notes found.
              </div>
            )
          }
        </div>
      </ScrollArea>
    </div>
  );
};

export default RelatedNotes;
