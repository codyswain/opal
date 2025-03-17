import React from 'react';
import { useFileExplorerStore } from '../store/fileExplorerStore';
import FileItem from './FileItem';
import { FSEntry } from '@/types';

// ======================================================
// Type Definitions
// ======================================================

export interface FolderContentsProps {
  parentId: string | null;
  level?: number;
}

/**
 * FolderContents - Recursively renders the contents of a folder
 */
const FolderContents: React.FC<FolderContentsProps> = ({ parentId, level = 0 }) => {
  const { entities, ui } = useFileExplorerStore();
  
  // Get child entries for this parent
  const childEntries = Object.values(entities.nodes).filter(
    (node: FSEntry) => node.parentId === parentId
  );
  
  if (childEntries.length === 0) {
    return null;
  }
  
  return (
    <>
      {childEntries.map((entry: FSEntry, index) => (
        <div key={entry.id}>
          <FileItem 
            entry={entry} 
            level={level} 
            isLastChild={index === childEntries.length - 1} 
          />
          
          {/* Render children if this is an expanded folder */}
          {entry.type === 'folder' && 
           ui.expandedFolders.has(entry.id) && 
           <FolderContents parentId={entry.id} level={level + 1} />}
        </div>
      ))}
    </>
  );
};

export default FolderContents; 