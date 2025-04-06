import React, { useMemo } from 'react';
import { Settings } from "lucide-react";
import { Button } from "@/renderer/shared/components/Button";
import { toast } from "@/renderer/shared/components/Toast";
import { useNoteExplorerContextMenu } from "../../hooks/useNoteExplorerContextMenu";
import { NoteExplorerHeader } from './NoteExplorerHeader';
import { NoteExplorerContent } from './NoteExplorerContent';
import NoteExplorerContextMenu from './NoteExplorerContextMenu';
import { useFileExplorerStore } from '@/renderer/features/file-explorer-v2/store/fileExplorerStore';
import type { FSExplorerState } from '@/renderer/features/file-explorer-v2/store/types';
import { FSEntry } from '@/types';

const NoteExplorer: React.FC = () => {
  const { contextMenu, handleContextMenu, closeContextMenu } = useNoteExplorerContextMenu();
  const nodes = useFileExplorerStore((state: FSExplorerState) => state.entities.nodes);
  const selectedId = useFileExplorerStore((state: FSExplorerState) => state.ui.selectedId);
  const loading = useFileExplorerStore((state: FSExplorerState) => state.loading);
  const selectEntry = useFileExplorerStore((state: FSExplorerState) => state.selectEntry);

  const rootIds = useMemo(() => {
    return Object.values(nodes)
      .filter((node: FSEntry) => node.parentId === null)
      .map((node: FSEntry) => node.id);
  }, [nodes]);

  const selectedEntry = selectedId ? nodes[selectedId] : null;
  const fileSystemTree = { rootIds, nodes };

  const handleDelete = () => {
    const entryToDelete = contextMenu?.entry;
    if (entryToDelete) {
      console.warn("Delete logic needs refactoring using entry ID/path and store action");
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
      <NoteExplorerHeader />
      <NoteExplorerContent
        isLoadingFolders={loading.isLoading}
        loadError={loading.error}
        fileSystemTree={fileSystemTree}
        selectedEntry={selectedEntry}
        onSelectNote={(entry: FSEntry) => selectEntry(entry.id)}
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