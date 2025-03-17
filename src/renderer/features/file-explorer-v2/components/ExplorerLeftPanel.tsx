import React, { useEffect } from 'react';
import { useFileExplorerStore } from '../store/fileExplorerStore';
import explorerStyles from './styles/explorerStyles';
import { LoadingState } from './elements/ExplorerElements';
import FolderContents from './FolderContents';
import { useFileExplorerContextMenu } from '../hooks/useFileExplorerContextMenu';
import FileExplorerContextMenu from './FileExplorerContextMenu';

/**
 * ExplorerLeftPanel - Main component for the file explorer panel
 * 
 * This component is responsible for:
 * 1. Loading the file system data
 * 2. Displaying the header
 * 3. Showing loading/error states
 * 4. Rendering the folder contents
 * 5. Handling context menu interactions
 */
export default function ExplorerLeftPanel() {
  const { loading, loadFileSystem } = useFileExplorerStore();
  const { contextMenu, handleContextMenu, closeContextMenu } = useFileExplorerContextMenu();

  // Load file system data on component mount
  useEffect(() => {
    loadFileSystem();
  }, [loadFileSystem]);

  return (
    <div className="flex flex-col h-full w-full overflow-auto">
      {/* Header */}
      <div className={`p-1.5 font-semibold border-b text-${explorerStyles.headerTextSize}`}>
        Files
      </div>
      
      {/* Content area */}
      <div className="flex-1 overflow-auto p-1.5">
        <LoadingState isLoading={loading.isLoading} error={loading.error} />
        
        {!loading.isLoading && !loading.error && (
          <FolderContents 
            parentId={null} 
            onContextMenu={handleContextMenu}
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