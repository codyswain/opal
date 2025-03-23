import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/renderer/shared/components/Button";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import { Loader2, RefreshCw, Target } from "lucide-react";
import { toast } from "@/renderer/shared/components/Toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/renderer/shared/components/Tooltip";
import { SimilarNote } from "@/renderer/shared/types";
import { useNotesContext } from "../../context/notesContext";
import { NoteItem } from "./RelatedNoteListItem";

interface RelatedNotesProps {
  isOpen: boolean;
  onClose: () => void;
}

const RelatedNotes: React.FC<RelatedNotesProps> = ({ isOpen, onClose }) => {
  const [similarNotes, setSimilarNotes] = useState<SimilarNote[]>([]);
  const [similarNotesIsLoading, setSimilarNotesIsLoading] =
    useState<boolean>(false);

  const { activeNote, openNote, directoryStructures } = useNotesContext();

  const findSimilarNotes = useCallback(async () => {
    if (!activeNote) {
      console.error("No active note");
      setSimilarNotes([]);
      setSimilarNotesIsLoading(false);
      return;
    }
    setSimilarNotesIsLoading(true);
    try {
      const similarNotes = await window.electron.findSimilarNotes(
        activeNote.content,
        directoryStructures
      );
      setSimilarNotes(
        similarNotes.filter(
          (note: SimilarNote) => note.id !== activeNote.id && note.score >= 0.5
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
  }, [activeNote?.id]);

  useEffect(() => {
    if (isOpen && activeNote) {
      findSimilarNotes();
    }
  }, [isOpen, activeNote?.id, findSimilarNotes]);

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-grow w-full px-4">
        <div className="py-4">
          {similarNotesIsLoading ? (
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
            <p className="text-center text-muted-foreground py-8">
              No similar notes found
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default RelatedNotes;
