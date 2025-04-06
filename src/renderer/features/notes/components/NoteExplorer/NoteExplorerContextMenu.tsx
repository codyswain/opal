// src/features/notes/components/NoteExplorer/NoteExplorerContextMenu.tsx

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
import { FSEntry } from "@/renderer/shared/types";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";
import type { FSExplorerState } from "@/types";

interface NoteExplorerContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    entry: FSEntry;
  } | null;
  onClose: () => void;
  onDelete: () => void;
  onCopyFilePath: (entry: FSEntry) => void;
  onOpenNoteInNewTab: (entry: FSEntry) => void;
}

const NoteExplorerContextMenu: React.FC<NoteExplorerContextMenuProps> = ({
  contextMenu,
  onClose,
  onDelete,
  onCopyFilePath,
  onOpenNoteInNewTab,
}) => {
  const startCreatingFolder = useFileExplorerStore((state: FSExplorerState) => state.startCreatingFolder);
  const createNote = useFileExplorerStore((state: FSExplorerState) => state.createNote);
  
  if (!contextMenu) return null;
  const { x, y, entry } = contextMenu;

  return (
    <ContextMenu x={x} y={y}>
      {(entry.type === "folder") && (
        <>
          <ContextMenuItem
            icon={FilePlus}
            label="New File"
            onClick={() => {
              createNote(entry.path, "Untitled Note");
              onClose();
            }}
          />
          <ContextMenuItem
            icon={FolderPlus}
            label="New Folder"
            onClick={() => {
              startCreatingFolder(entry.id);
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
      {entry.type === "note" && (
        <>
          <ContextMenuItem
            icon={Copy}
            label="Copy ID"
            onClick={() => {
              navigator.clipboard.writeText(entry.id || "");
              onClose();
            }}
          />
          <ContextMenuItem
            icon={Folder}
            label="Copy File Path"
            onClick={() => {
              onCopyFilePath(entry);
              onClose();
            }}
          />
          <ContextMenuItem
            icon={Pencil}
            label="Open in New Tab"
            onClick={() => {
              onOpenNoteInNewTab(entry);
              onClose();
            }}
          />
        </>
      )}
    </ContextMenu>
  );
};

export default NoteExplorerContextMenu;
