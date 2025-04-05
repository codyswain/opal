import React, { /* useCallback, useEffect, useState */ } from 'react';
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
// import { Button } from '@/renderer/shared/components/Button';
// import { Loader2, RefreshCw } from 'lucide-react';
// import { toast } from '@/renderer/shared/components/Toast';
// import { SimilarNote } from '@/renderer/shared/types';
// import { NoteItem } from './RelatedNoteListItem';
// import { useFileExplorerStore } from '../../store/fileExplorerStore';
import { useRelatedNotes } from "./related-notes/useRelatedNotes";
import { RelatedNotesContent } from "./related-notes/RelatedNotesContent";

interface RelatedNotesProps {
  isOpen: boolean;
  onClose: () => void;
}

const RelatedNotes: React.FC<RelatedNotesProps> = ({ isOpen, onClose }) => {
  const { 
    similarNotes, 
    similarNotesIsLoading, 
    findSimilarNotes, 
    openNote 
  } = useRelatedNotes(isOpen);

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-grow w-full px-1">
        <RelatedNotesContent
          similarNotes={similarNotes}
          similarNotesIsLoading={similarNotesIsLoading}
          openNote={openNote}
        />
      </ScrollArea>
    </div>
  );
};

export default RelatedNotes; 