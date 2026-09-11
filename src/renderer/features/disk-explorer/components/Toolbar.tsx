import React from 'react';
import { ChevronDown, FilePlus, FolderPlus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/renderer/shared/ui';
import { useDiskStore } from '../store/diskStore';
import { useFilesNavigation } from '../navigation/FilesNavigationContext';

/** The folder's create actions, in one small menu at the head of the toolbar. */
export const Toolbar: React.FC<{ dirPath: string }> = ({ dirPath }) => {
  const navigation = useFilesNavigation();

  const newNote = async () => {
    const result = await window.markdownAPI.create(dirPath);
    if (!result.success) { toast.error(result.error); return; }
    await useDiskStore.getState().loadDirectory(dirPath, { force: true });
    navigation.openFile(result.data.path);
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label="New"
          data-testid="toolbar-new"
          data-disk-shortcuts-ignore="true"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors duration-100 hover:bg-surface-hover hover:text-foreground"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          New
          <ChevronDown aria-hidden className="h-3 w-3" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="min-w-40">
        <MenuItem data-testid="toolbar-new-note" onSelect={() => void newNote()}>
          <FilePlus aria-hidden className="h-3.5 w-3.5" />
          <span className="ml-2">Note</span>
        </MenuItem>
        <MenuItem data-testid="toolbar-new-folder" onSelect={() => useDiskStore.getState().beginNewFolder(dirPath)}>
          <FolderPlus aria-hidden className="h-3.5 w-3.5" />
          <span className="ml-2">Folder</span>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
};
