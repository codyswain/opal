// src/features/notes/components/NoteExplorerContent.tsx

import React, { useEffect, useRef } from "react";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import { Loader, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/renderer/shared/components/input";
import { cn } from "@/renderer/shared/utils";
import { FSEntry } from "@/renderer/shared/types";
import type { FSExplorerState } from "@/types";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";

interface NoteExplorerContentProps {
  isLoadingFolders: boolean;
  loadError: string | null;
  fileSystemTree: { rootIds: string[]; nodes: Record<string, FSEntry> };
  selectedEntry: FSEntry | null;
  onSelectNote: (entry: FSEntry) => void;
  handleContextMenu: (
    e: React.MouseEvent,
    entry: FSEntry
  ) => void;
}

export const NoteExplorerContent: React.FC<NoteExplorerContentProps> = ({
  isLoadingFolders,
  loadError,
  fileSystemTree,
  selectedEntry,
  onSelectNote,
  handleContextMenu,
}) => {
  const toggleFolder = useFileExplorerStore((state: FSExplorerState) => state.toggleFolder);
  const expandedFolders = useFileExplorerStore((state: FSExplorerState) => state.ui.expandedFolders);
  const selectEntry = useFileExplorerStore((state: FSExplorerState) => state.selectEntry);
  const creatingFolderInParentId = useFileExplorerStore((state: FSExplorerState) => state.ui.creatingFolderInParentId);
  const newFolderName = useFileExplorerStore((state: FSExplorerState) => state.ui.newFolderName);
  const createFolderError = useFileExplorerStore((state: FSExplorerState) => state.ui.createFolderError);
  const setNewFolderName = useFileExplorerStore((state: FSExplorerState) => state.setNewFolderName);
  const confirmCreateFolder = useFileExplorerStore((state: FSExplorerState) => state.confirmCreateFolder);
  const cancelCreatingFolder = useFileExplorerStore((state: FSExplorerState) => state.cancelCreatingFolder);

  // For the folder that renders when creating a new folder
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (creatingFolderInParentId !== null) {
      newFolderInputRef.current?.focus();
    }
  }, [creatingFolderInParentId]);
  const handleNewFolderKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      confirmCreateFolder();
    } else if (e.key === 'Escape') {
      cancelCreatingFolder();
    }
  };

  const renderFileNode = (nodeId: string, depth = 0) => {
    const node = fileSystemTree.nodes[nodeId];
    if (!node) return null;

    const isExpanded = expandedFolders.has(node.id);
    const isSelected = selectedEntry?.id === node.id;

    // Add a container with relative positioning and the vertical line
    const nodeContainer = (content: React.ReactNode) => (
      <div className="relative" key={node.id}>
        {depth > 0 && (
          <div 
            className="absolute border-l border-muted-foreground/20" 
            style={{ 
              left: (depth - 1) * 16 + 8,
              top: 0,
              bottom: 0,
            }}
          />
        )}
        {content}
      </div>
    );

    if (node.type === "folder") {
      return nodeContainer(
        <div>
          <div
            className="flex items-center cursor-pointer hover:bg-accent/50 py-1 px-2"
            style={{ marginLeft: depth * 16 }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleFolder(node.id);
            }}
            onContextMenu={(e) => handleContextMenu(e, node)}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 mr-1" />
            ) : (
              <ChevronRight className="h-4 w-4 mr-1" />
            )}
            <span>{node.name}</span>
          </div>
          {isExpanded && node.children && node.children.map((childId: string) => renderFileNode(childId, depth + 1))}
          {creatingFolderInParentId === node.id && (
            <div className="ml-4 px-2 py-1">
              <Input
                variant="minimal"
                ref={newFolderInputRef}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={handleNewFolderKeyDown}
                onBlur={cancelCreatingFolder}
                placeholder="New folder name"
                className="w-full"
              />
            </div>
          )}
        </div>
      );
    } else if (node.type === "note") {
      return nodeContainer(
        <div
          className={cn(
            "flex items-center py-1 px-2 rounded-md cursor-pointer text-sm",
            isSelected
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          )}
          style={{ marginLeft: depth * 16 }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            selectEntry(node.id);
            onSelectNote(node);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleContextMenu(e, node);
          }}
        >
          <span className="truncate">{node.name}</span>
        </div>
      );
    }
    return null;
  };

  return (
    <ScrollArea className="h-[calc(100%-2.5rem)] w-full">
      {createFolderError && (
        <div className="text-red-500 text-sm p-2">{createFolderError}</div>
      )}
      <div className="p-2">
        {isLoadingFolders ? (
          <div className="flex items-center justify-center h-20">
            <Loader className="h-6 w-6 animate-spin" />
          </div>
        ) : loadError ? (
          <div className="text-red-500 text-sm p-2">{loadError}</div>
        ) : fileSystemTree.rootIds.length === 0 ? (
          <div className="text-sm text-muted-foreground p-2">
            No folders added yet.
          </div>
        ) : (
          fileSystemTree.rootIds.map((rootId) => renderFileNode(rootId))
        )}
      </div>
    </ScrollArea>
  );
};
