import React from "react";
import { useNavigate } from "react-router-dom";
import { useNotesContext } from "../../notes/context/notesContext";
import { useFileExplorerStore } from "../../file-explorer-v2/store/fileExplorerStore";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import { Clock } from "lucide-react";
import { Note, FSEntry } from "@/renderer/shared/types";

// Local formatDate function
const formatDate = (dateString: string): string => {
  if (!dateString) return "Unknown";
  
  try {
    const date = new Date(dateString);
    
    // Check if the date is today
    const today = new Date();
    const isToday = 
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
    
    if (isToday) {
      return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Check if the date is yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();
    
    if (isYesterday) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Format date for other days
    return date.toLocaleDateString([], { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  } catch (error) {
    console.error("Error formatting date:", error);
    return "Invalid date";
  }
};

// Accept props again
const Feed: React.FC = () => {
  const { recentNotes } = useNotesContext();
  const fileNodes = useFileExplorerStore(state => state.entities.nodes);
  const selectEntry = useFileExplorerStore(state => state.selectEntry);
  const navigate = useNavigate();

  // Find the FSEntry that corresponds to a note
  const findFileNodeForNote = (note: Note): FSEntry | null => {
    const nodes = fileNodes;
    
    // Find the FSEntry whose ID matches the Note's ID
    for (const nodeId in nodes) {
      const node = nodes[nodeId];
      if (
        node.type === "note" &&
        node.id === note.id
      ) {
        return node;
      }
    }
    
    return null;
  };

  const handleNoteClick = (note: Note) => {
    const fsEntry = findFileNodeForNote(note);
    if (fsEntry) {
      selectEntry(fsEntry.id);
      
      // Navigate to the explorer view after selecting a note
      navigate("/explorer");
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="p-4 border-b border-border">
        <h1 className="text-xl font-semibold flex items-center">
          <Clock className="h-5 w-5 mr-2" />
          Recent Notes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your most recently viewed and edited notes
        </p>
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
                onClick={() => handleNoteClick(note)}
                className="p-4 border border-border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
              >
                <h3 className="font-medium">{note.title}</h3>
                <div className="flex justify-between items-center mt-2">
                  <p className="text-sm text-muted-foreground">
                    Last updated: {formatDate(note.updatedAt)}
                  </p>
                </div>
                {note.content && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                    {note.content.replace(/[#*`]/g, "")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default Feed; 