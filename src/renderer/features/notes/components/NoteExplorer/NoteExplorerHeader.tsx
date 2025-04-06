import React from "react";
import { Button } from "@/renderer/shared/components/Button";
import { FolderPlus } from "lucide-react";
// import { useNotesContext } from "../../context/notesContext"; // Removed missing context import
// import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore"; // Unused import

// interface NoteExplorerHeaderProps {} // Removed empty interface

export const NoteExplorerHeader: React.FC = () => { // Removed Props type
  // const { startCreatingFolder, createNote } = useNotesContext(); // Removed missing context usage
  // const selectedId = useFileExplorerStore((state) => state.ui.selectedId); // Unused variable
  // const nodes = useFileExplorerStore((state) => state.entities.nodes); // Unused variable

  async function handleFolderCreation() {
    // Folder creation logic using store action (if needed)
    console.log("Folder creation triggered");
    // Replace with actual call: startCreatingFolder(selectedId || null);
  }

  /* // Unused function
  async function handleNoteCreation() {
    // Note creation logic using store action (if needed)
    console.log("Note creation triggered");
  }
  */

  return (
    <div className="flex items-center justify-between p-2 border-b border-gray-700">
      <span className="text-sm font-medium text-gray-400">NOTES</span>
      <div className="flex items-center space-x-1">
        <Button variant="ghost" size="sm" onClick={handleFolderCreation}>
          <FolderPlus className="w-4 h-4" />
        </Button>
        {/* Button for note creation removed as function is unused 
        <Button variant="ghost" size="sm" onClick={handleNoteCreation}>
          <Plus className="w-4 h-4" />
        </Button> 
        */}
      </div>
    </div>
  );
};