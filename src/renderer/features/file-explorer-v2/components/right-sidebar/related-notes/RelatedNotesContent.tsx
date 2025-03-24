import React from "react";
import { Loader2 } from "lucide-react";
import { SimilarNote } from "@/renderer/shared/types";
import { NoteItem } from "../RelatedNoteListItem";

interface RelatedNotesContentProps {
  similarNotes: SimilarNote[];
  similarNotesIsLoading: boolean;
  openNote: (note: SimilarNote) => void;
}

export const RelatedNotesContent: React.FC<RelatedNotesContentProps> = ({
  similarNotes,
  similarNotesIsLoading,
  openNote
}) => {
  return (
    <div className="py-2">
      {similarNotesIsLoading ? (
        <div className="flex items-center justify-center h-16">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : similarNotes.length > 0 ? (
        <div className="space-y-2">
          {similarNotes.map((note) => (
            <NoteItem key={note.id} note={note} openNote={openNote} />
          ))}
        </div>
      ) : (
        <p className="text-center text-muted-foreground py-4 text-xs">
          No similar notes found
        </p>
      )}
    </div>
  );
}; 