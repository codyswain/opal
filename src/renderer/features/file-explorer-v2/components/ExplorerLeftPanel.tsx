import React, { useEffect } from 'react';
import { useFileExplorerStore } from '../store/fileExplorerStore';
import explorerStyles from './styles/explorerStyles';
import { LoadingState } from './elements/ExplorerElements';
import FolderContents from './FolderContents';
import { useFileExplorerContextMenu } from '../hooks/useFileExplorerContextMenu';
import FileExplorerContextMenu from './FileExplorerContextMenu';
import { FilePlus, FolderPlus } from 'lucide-react';

/**
 * ExplorerLeftPanel - Main component for the file explorer panel
 * 
 * This component is responsible for:
 * 1. Loading the file system data
 * 2. Displaying the header with create buttons
 * 3. Showing loading/error states
 * 4. Rendering the folder contents
 * 5. Handling context menu interactions
 * 6. Supporting drag operations for embedding items in notes
 */
export default function ExplorerLeftPanel() {
  const { loading, loadFileSystem, createNote, createFolder, ui, entities } = useFileExplorerStore();
  const { contextMenu, handleContextMenu, closeContextMenu } = useFileExplorerContextMenu();

  // Load file system data on component mount
  useEffect(() => {
    loadFileSystem();
  }, [loadFileSystem]);

  // Handle creating a new note
  const handleCreateNote = async () => {
    const selectedId = ui.selectedId;
    let parentPath = '/';
    
    if (selectedId) {
      const selectedNode = entities.nodes[selectedId];
      if (selectedNode) {
        if (selectedNode.type === 'folder') {
          parentPath = selectedNode.path;
        } else if (selectedNode.parentId) {
          // If a note is selected, create at the same level
          const parentNode = entities.nodes[selectedNode.parentId];
          if (parentNode) {
            parentPath = parentNode.path;
          }
        }
      }
    }
    
    await createNote(parentPath, 'New Note.md');
  };

  // Handle creating a new folder
  const handleCreateFolder = async () => {
    const selectedId = ui.selectedId;
    let parentPath = '/';
    
    if (selectedId) {
      const selectedNode = entities.nodes[selectedId];
      if (selectedNode) {
        if (selectedNode.type === 'folder') {
          parentPath = selectedNode.path;
        } else if (selectedNode.parentId) {
          // If a note is selected, create at the same level
          const parentNode = entities.nodes[selectedNode.parentId];
          if (parentNode) {
            parentPath = parentNode.path;
          }
        }
      }
    }
    
    await createFolder(parentPath, 'New Folder');
  };

  // Function to make items draggable for embedding in notes
  const makeItemDraggable = (itemId: string, event: React.DragEvent) => {
    // Since the FileItem component now handles setting the data directly,
    // this function primarily serves as a callback handler and for logging
    console.log(`Drag started for item ${itemId}`, entities.nodes[itemId]);
    
    // We don't need to set the data here anymore since FileItem does it
    // But we can still log for debugging
    const item = entities.nodes[itemId];
    if (item) {
      console.log(`Item being dragged: ${item.name} (${item.id}) - Type: ${item.type}`);
    }
  };

  return (
    <div className="flex flex-col h-full w-full overflow-auto">
      {/* Header with action buttons */}
      <div className="flex justify-between items-center p-1 border-b border-gray-800">
        <div className="text-sm font-medium">Files</div>
        <div className="flex space-x-1">
          <button
            className="p-1 hover:bg-gray-700/30 rounded"
            onClick={handleCreateNote}
            title="Create new note"
          >
            <FilePlus size={16} />
          </button>
          <button
            className="p-1 hover:bg-gray-700/30 rounded"
            onClick={handleCreateFolder}
            title="Create new folder"
          >
            <FolderPlus size={16} />
          </button>
        </div>
      </div>
      
      {/* Content area */}
      <div className="flex-1 overflow-auto px-1.5 py-1">
        <LoadingState isLoading={loading.isLoading} error={loading.error} />
        
        {!loading.isLoading && !loading.error && (
          <FolderContents 
            parentId={null} 
            onContextMenu={handleContextMenu}
            onDragStart={makeItemDraggable}
          />
        )}
        
        {/* Context Menu */}
        <FileExplorerContextMenu 
          contextMenu={contextMenu} 
          onClose={closeContextMenu} 
        />
      </div>
    </div>
  );
}