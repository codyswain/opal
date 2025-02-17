import React from "react";
import { Settings } from "lucide-react";
import { Button } from "@/renderer/shared/components/Button";
import { toast } from "@/renderer/shared/components/Toast";
import { useNoteExplorerContextMenu } from "../../hooks/useNoteExplorerContextMenu";
import { NoteExplorerHeader } from "./NoteExplorerHeader";
import NoteExplorerContextMenu from "./NoteExplorerContextMenu";
import { NoteExplorerContent } from "./NoteExplorerContent";
import { useNotesContext } from "../../context/notesContext";

interface NoteExplorerProps {
  isOpen: boolean;
  onClose: () => void;
}

const NoteExplorer: React.FC<NoteExplorerProps> = ({ isOpen, onClose }) => {
  const { contextMenu, handleContextMenu, closeContextMenu } = useNoteExplorerContextMenu();
  const {
    directoryStructures,
    createNote,
    activeFileNode,
    setActiveFileNode,
    deleteFileNode,
    handleCreateFolder,
    isLoading,
    error
  } = useNotesContext();                              

  const handleDelete = () => {
    if (contextMenu?.fileNode) {
      deleteFileNode(contextMenu.fileNode)
    }
  }

  return (
    <div className="h-full flex flex-col bg-background border-r border-border">
      <NoteExplorerContextMenu
        contextMenu={contextMenu}
        onClose={closeContextMenu}
        onDelete={handleDelete}
        onCopyFilePath={() => {console.log('IMPLEMENT COPY FILE PATH')}}
        onOpenNoteInNewTab={() => {console.log('IMPLEMENT OPEN NOTE IN NEW TAB')}}
      />
      <NoteExplorerHeader
        onCreateNote={() => createNote(activeFileNode?.fullPath || "/")}
        onCreateFolder={() => handleCreateFolder(activeFileNode || null)}
      />
      <NoteExplorerContent
        isLoadingFolders={isLoading}
        loadError={error}
        directoryStructures={directoryStructures}
        selectedFileNode={activeFileNode}
        onSelectNote={setActiveFileNode}
        handleContextMenu={handleContextMenu}
      />
      <div className="mt-auto p-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => toast("Settings feature is not implemented yet")}
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default NoteExplorer;