// src/features/notes/components/NoteExplorerContextMenu.tsx

import React from "react";
import ContextMenu from "@/renderer/shared/components/ContextMenu/ContextMenu";
import ContextMenuItem from "@/renderer/shared/components/ContextMenu/ContextMenuItem";
import {
  FilePlus,
  FolderPlus,
  Trash2,
  Copy,
  Folder,
  Pencil,
} from "lucide-react";
import { FileNode } from "@/renderer/shared/types";
import { useNotesContext } from "../../context/notesContext";

interface NoteExplorerContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    fileNode: FileNode;
  } | null;
  onClose: () => void;
  onDelete: () => void;
  onCopyFilePath: (fileNode: FileNode) => void;
  onOpenNoteInNewTab: (fileNode: FileNode) => void;
}

const NoteExplorerContextMenu: React.FC<NoteExplorerContextMenuProps> = ({
  contextMenu,
  onClose,
  onDelete,
  onCopyFilePath,
  onOpenNoteInNewTab,
}) => {
  const { handleCreateFolder, createNote } = useNotesContext();
  if (!contextMenu) return null;
  const { x, y, fileNode } = contextMenu;

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {(fileNode.type === "directory") && (
        <>
          <ContextMenuItem
            icon={FilePlus}
            label="New File"
            onClick={() => {
              createNote(fileNode.fullPath);
              onClose();
            }}
          />
          <ContextMenuItem
            icon={FolderPlus}
            label="New Folder"
            onClick={() => {
              handleCreateFolder(fileNode);
              onClose();
            }}
          />
        </>
      )}
      <ContextMenuItem
        icon={Trash2}
        label="Delete"
        onClick={() => {
          onDelete();
          onClose();
        }}
        className="text-destructive"
      />
      {fileNode.type === "note" && (
        <>
          <ContextMenuItem
            icon={Copy}
            label="Copy ID"
            onClick={() => {
              navigator.clipboard.writeText(fileNode.noteMetadata?.id || "");
              onClose();
            }}
          />
          <ContextMenuItem
            icon={Folder}
            label="Copy File Path"
            onClick={() => {
              onCopyFilePath(fileNode);
              onClose();
            }}
          />
          <ContextMenuItem
            icon={Pencil}
            label="Open in New Tab"
            onClick={() => {
              onOpenNoteInNewTab(fileNode);
              onClose();
            }}
          />
        </>
      )}
    </ContextMenu>
  );
};

export default NoteExplorerContextMenu;
