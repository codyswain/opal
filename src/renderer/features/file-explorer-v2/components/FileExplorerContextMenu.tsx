import React from 'react';
import { FSEntry } from '@/types';
import { FilePlus, FolderPlus, HardDrive } from 'lucide-react';
import { useFileExplorerStore } from '../store/fileExplorerStore';
import {
  DropdownMenuItem,
  DropdownMenuContent,
} from "@/renderer/shared/components/DropdownMenu";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, children }) => {
  return (
    <div
      className="absolute z-50 min-w-[180px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg overflow-hidden"
      style={{ top: y, left: x }}
    >
      {children}
    </div>
  );
};

interface ContextMenuItemProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  className?: string;
}

const ContextMenuItem: React.FC<ContextMenuItemProps> = ({ icon: Icon, label, onClick, className }) => {
  return (
    <button
      className={`w-full px-3 py-2 text-sm flex items-center hover:bg-gray-100 dark:hover:bg-gray-700 ${className || ''}`}
      onClick={onClick}
    >
      <Icon className="mr-2 h-4 w-4" />
      <span>{label}</span>
    </button>
  );
};

interface FileExplorerContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    entry: FSEntry;
  } | null;
  onClose: () => void;
}

const FileExplorerContextMenu: React.FC<FileExplorerContextMenuProps> = ({ contextMenu, onClose }) => {
  const { createNote, createFolder, loadFileSystem } = useFileExplorerStore();
  
  if (!contextMenu) return null;
  const { x, y, entry } = contextMenu;

  const handleCreateNote = async () => {
    try {
      await createNote(entry.path, 'New Note.md');
    } catch (error) {
      console.error('Error creating note:', error);
    }
    
    onClose();
  };

  const handleCreateFolder = async () => {
    try {
      await createFolder(entry.path, 'New Folder');
    } catch (error) {
      console.error('Error creating folder:', error);
    }
    
    onClose();
  };

  // Access window.electron and window.fileExplorer using any type
  const electronApi = (window as any).electron;
  const fileExplorerApi = (window as any).fileExplorer;

  const handleMountFolder = async () => {
    try {
      // Use the electron openFolderDialog API to select a folder
      const result = await electronApi.openFolderDialog();
      
      if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return;
      }
      
      const selectedFolderPath = result.filePaths[0];
      
      // Call our mount folder API
      const mountResult = await fileExplorerApi.mountFolder(entry.path, selectedFolderPath);
      
      if (mountResult && mountResult.success) {
        // Reload the file system to show the mounted folder
        await loadFileSystem();
      } else {
        const errorMessage = mountResult?.error || 'Unknown error';
        console.error('Error mounting folder:', errorMessage);
        // You could show a notification to the user here
      }
    } catch (error) {
      console.error('Error mounting folder:', error);
    }
    
    onClose();
  };

  const handleUnmountFolder = async () => {
    try {
      // Check if this folder is mounted before attempting to unmount
      if (!entry.isMounted) {
        console.error('Cannot unmount a folder that is not mounted');
        return;
      }
      
      // Call the unmount folder API
      const unmountResult = await fileExplorerApi.unmountFolder(entry.path);
      
      if (unmountResult && unmountResult.success) {
        // Reload the file system to update the UI
        await loadFileSystem();
      } else {
        const errorMessage = unmountResult?.error || 'Unknown error';
        console.error('Error unmounting folder:', errorMessage);
        // You could show a notification to the user here
      }
    } catch (error) {
      console.error('Error unmounting folder:', error);
    }
    
    onClose();
  };

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {entry.type === 'folder' && (
        <>
          <ContextMenuItem
            icon={FilePlus}
            label="Create New Note"
            onClick={handleCreateNote}
          />
          <ContextMenuItem
            icon={FolderPlus}
            label="Create New Folder"
            onClick={handleCreateFolder}
          />
          <ContextMenuItem
            icon={HardDrive}
            label="Mount External Folder"
            onClick={handleMountFolder}
          />
          {entry.isMounted && (
            <ContextMenuItem
              icon={HardDrive}
              label="Unmount Folder"
              onClick={handleUnmountFolder}
              className="text-red-500"
            />
          )}
        </>
      )}
      {/* Add more context menu items as needed */}
    </ContextMenu>
  );
};

export default FileExplorerContextMenu; 