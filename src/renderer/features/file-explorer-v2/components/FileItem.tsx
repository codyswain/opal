import React from 'react';
import { FSEntry } from '@/types';
import { useFileExplorerStore } from '../store/fileExplorerStore';
import explorerStyles from './styles/explorerStyles';
import { VerticalGuideLine, FileIcon } from './elements/ExplorerElements';
import { useFileExplorerContextMenu } from '../hooks/useFileExplorerContextMenu';
import { formatLocalDate, getLocalDate } from '@/renderer/shared/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/renderer/shared/components/Tooltip";

// ======================================================
// Type Definitions
// ======================================================

export interface FileItemProps {
  entry: FSEntry;
  level: number;
  isLastChild: boolean;
  onContextMenu: (e: React.MouseEvent, entry: FSEntry) => void;
}

/**
 * FileItem - Displays a single file, folder, or note in the explorer
 */
const FileItem: React.FC<FileItemProps> = ({ entry, level, isLastChild, onContextMenu }) => {
  const { ui, selectEntry, toggleFolder } = useFileExplorerStore();
  const isSelected = ui.selectedId === entry.id;
  const isExpanded = ui.expandedFolders.has(entry.id);
  
  // Format date for display in user's local timezone
  const formatDate = formatLocalDate;
  
  const handleClick = () => {
    selectEntry(entry.id);
  };
  
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFolder(entry.id);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    onContextMenu(e, entry);
  };
  
  return (
    <div className="relative">
      {/* Render vertical guide lines for nesting */}
      {level > 0 && Array.from({ length: level }).map((_, idx) => (
        <VerticalGuideLine 
          key={idx}
          level={level} 
          index={idx} 
          isLastChild={isLastChild} 
        />
      ))}
      
      {/* Item content with background that doesn't cover the lines */}
      <div 
        className={`flex items-center py-${explorerStyles.itemPaddingY} px-${explorerStyles.itemPaddingX} rounded cursor-pointer relative h-${explorerStyles.itemHeight} text-${explorerStyles.itemTextSize}`}
        style={{ paddingLeft: `${level * explorerStyles.indentationWidth + 4}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Background div that doesn't cover the vertical lines */}
        <div 
          className={`absolute inset-0 rounded ${isSelected ? explorerStyles.selectedBgColor : explorerStyles.hoverBgColor}`}
          style={{ left: `${level * explorerStyles.indentationWidth}px` }}
        />
        
        {/* Icon for entry type */}
        <FileIcon 
          type={entry.type} 
          isExpanded={isExpanded} 
          onToggle={handleToggle} 
        />
        
        {/* Entry name with timestamp tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`truncate z-10 relative text-${explorerStyles.itemTextSize}`}>
              {entry.name}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Last updated: {formatDate(entry.metadata.updatedAt)}</p>
            <p>Created: {formatDate(entry.metadata.createdAt)}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};

export default FileItem; 