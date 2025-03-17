import React from 'react';
import { FSEntry } from '@/types';
import { FilePlus, FolderPlus, Trash2, Copy, Edit } from 'lucide-react';
import { useFileExplorerStore } from '../store/fileExplorerStore';

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
  const { createNote } = useFileExplorerStore();
  
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

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {entry.type === 'folder' && (
        <ContextMenuItem
          icon={FilePlus}
          label="Create New Note"
          onClick={handleCreateNote}
        />
      )}
      {/* Add more context menu items as needed */}
    </ContextMenu>
  );
};

export default FileExplorerContextMenu; 