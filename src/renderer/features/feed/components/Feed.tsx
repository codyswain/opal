import React from "react";
import { useNavigate } from "react-router-dom";
// import { useNotesContext } from "../../notes/context/notesContext";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import { Clock } from "lucide-react";
import { FSEntry } from '@/types';
import { Note } from '@/renderer/shared/types';

const Feed: React.FC = () => {
  // const { recentNotes } = useNotesContext();
  const fileNodes = useFileExplorerStore(state => state.entities.nodes);
  // const selectEntry = useFileExplorerStore(state => state.selectEntry);
  // const navigate = useNavigate();

  // Dummy data or logic for recent notes since context is removed
  const recentNotes: Note[] = []; 

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold flex items-center">
          <Clock className="w-5 h-5 mr-2" />
          Recent Notes
        </h2>
      </div>
      
      <ScrollArea className="flex-grow p-4">
        {recentNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p>No recent notes yet</p>
            <p className="text-sm mt-1">Notes you interact with will appear here</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {recentNotes.map((note) => (
              <div
                key={note.id}
                className="p-3 border border-border rounded-md hover:bg-muted cursor-pointer transition-colors"
                // onClick={() => handleNoteClick(note)} // handleNoteClick is removed
              >
                <h3 className="font-medium mb-1">{note.title || `Note ${note.id.substring(0, 6)}`}</h3>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {note.content ? note.content.substring(0, 100) + '...' : 'No content'}
                </p>
                {/* Add date/time here if available */}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default Feed; 