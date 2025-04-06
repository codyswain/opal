import React from "react";
import { Button } from "@/renderer/shared/components/Button";
import { FolderPlus } from "lucide-react";
import { useNotesContext } from "../../context/notesContext";

export const NoteExplorerHeader: React.FC = () => {
  
  useNotesContext();



  async function handleFolderCreation() {
    const result = await window.electron.openFolderDialog();
    if (!result.canceled && result.filePaths.length > 0) {
      try {
        const response = await window.electron.addRootFolder(result.filePaths[0]);
        console.log('response: ', response);
      } catch (error) {
        console.error('Error adding folder:', error);
      }
    }
  }

  return (
    <div className="flex justify-between items-center p-2 h-10 border-b border-border">
      <span className="font-semibold text-sm">Files</span>
      <div className="flex">
        {/* TODO: implement */}
        {/* <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 mr-1"
          onClick={onCreateNote}
          title="New Note"
        >
          <Pencil className="h-4 w-4" />
        </Button> */}
        {/* <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 mr-1"
          onClick={onCreateFolder}
          title="New Folder"
        >
          <FolderPlus className="h-4 w-4" />
        </Button> */}
  
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleFolderCreation}
          title="New Top Level Button to Load with SQLite"
        >
          <FolderPlus className="h-4 w-4" />
        </Button>

        {/* <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={openDialogToMountDirpath}
          title="Add Top-Level Folder"
        >
          <FolderPlus className="h-4 w-4" />
        </Button> */}
      </div>
    </div>
  );
};