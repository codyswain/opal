import React from "react";
import { Button } from "@/renderer/shared/components/Button";
import { Pencil, FolderPlus, Plus } from "lucide-react";
import { useNotesContext } from "../../context/notesContext";

interface NoteExplorerHeaderProps {
  onCreateNote: () => void;
  onCreateFolder: () => void;
}

export const NoteExplorerHeader: React.FC<NoteExplorerHeaderProps> = ({
  onCreateNote,
  onCreateFolder,
}) => {
  
  const {
    openDialogToMountDirpath
  } = useNotesContext();

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
          onClick={openDialogToMountDirpath}
          title="Add Top-Level Folder"
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};