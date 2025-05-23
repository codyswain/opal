import React, { useEffect, useRef, useState } from "react";
import { FSEntry } from "@/types";
import { useFileExplorerStore } from "../store/fileExplorerStore";
import explorerStyles from "./styles/explorerStyles";
import { VerticalGuideLine, FileIcon } from "./elements/ExplorerElements";
import { formatLocalDate } from "@/renderer/shared/utils";
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
  onDragStart?: (itemId: string, e: React.DragEvent) => void;
  renamingItem: FSEntry | null;
  onRenameSubmit: (item: FSEntry, newName: string) => void;
  onRenameCancel: () => void;
}

/**
 * FileItem - Displays a single file, folder, or note in the explorer
 */
const FileItem: React.FC<FileItemProps> = ({
  entry,
  level,
  isLastChild,
  onContextMenu,
  onDragStart,
  renamingItem,
  onRenameSubmit,
  onRenameCancel,
}) => {
  const { 
    ui, 
    selectEntry, 
    toggleFolder, 
  } = useFileExplorerStore();
  const isSelected = ui.selectedId === entry.id;
  const isExpanded = ui.expandedFolders.has(entry.id);
  const isMounted = entry.isMounted;
  const isRenaming = renamingItem?.id === entry.id;

  // State for inline renaming input
  const [inputValue, setInputValue] = useState(entry.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // State to track if a double click is in progress
  const [isDoubleClickInProgress, setIsDoubleClickInProgress] =
    useState(false);
  const doubleClickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleClick = (/* _e: React.MouseEvent */) => {
    // For folders, detect potential double clicks
    if (entry.type === "folder") {
      // If this is the first click, set a timeout to handle it as a single click
      if (!isDoubleClickInProgress) {
        setIsDoubleClickInProgress(true);

        // Set a timeout to handle as a single click after 250ms
        doubleClickTimeoutRef.current = setTimeout(() => {
          setIsDoubleClickInProgress(false);
          selectEntry(entry.id); // Only select if it was a single click
        }, 250);
      } else {
        // This is a double click, clear the timeout to prevent selection
        if (doubleClickTimeoutRef.current) {
          clearTimeout(doubleClickTimeoutRef.current);
          doubleClickTimeoutRef.current = null;
        }
        setIsDoubleClickInProgress(false);

        // Handle double click by expanding/collapsing
        toggleFolder(entry.id);
      }
    } else {
      // For non-folders, just select on click
      selectEntry(entry.id);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (doubleClickTimeoutRef.current) {
        clearTimeout(doubleClickTimeoutRef.current);
      }
    };
  }, []);

  // Focus input when renaming starts
  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select(); // Select the text
      setInputValue(entry.name); // Reset input value to current name when renaming starts
    }
  }, [isRenaming, entry.name]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFolder(entry.id);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    onContextMenu(e, entry);
  };

  // Add handler for drag start
  const handleDragStart = (e: React.DragEvent) => {
    if (onDragStart) {
      // Prevent event propagation to avoid parent container handling
      e.stopPropagation();
      
      // Clear any existing data
      e.dataTransfer.clearData();
      
      // Set drag effect to copy
      e.dataTransfer.effectAllowed = 'copy';
      
      // Set item data
      e.dataTransfer.setData('application/opal-item-id', entry.id);
      e.dataTransfer.setData('application/opal-item-type', entry.type);
      e.dataTransfer.setData('application/opal-item-name', entry.name);
      e.dataTransfer.setData('text/plain', entry.name);
      
      // Call the parent's onDragStart as a callback
      onDragStart(entry.id, e);
      
      // Add this explicit logging to help debug
      console.log(`Starting drag of item: ${entry.name} (${entry.id}) - Type: ${entry.type}`);
    }
  };

  // Handle input changes for renaming
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  // Handle key presses in the input (Enter to submit, Escape to cancel)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim() && inputValue !== entry.name) {
        onRenameSubmit(entry, inputValue.trim());
      } else {
        onRenameCancel(); // Cancel if name hasn't changed or is empty
      }
    } else if (e.key === 'Escape') {
      onRenameCancel();
    }
  };

  // Handle blur: submit if changed, otherwise cancel
  const handleBlur = () => {
    if (inputValue.trim() && inputValue !== entry.name) {
      onRenameSubmit(entry, inputValue.trim());
    } else {
      onRenameCancel();
    }
  };

  return (
    <div className="relative group">
      {/* Render vertical guide lines for nesting */}
      {level > 0 &&
        Array.from({ length: level }).map((_, idx) => (
          <VerticalGuideLine
            key={idx}
            level={level}
            index={idx}
            isLastChild={isLastChild && idx === level - 1}
          />
        ))}

      {/* Item content with background that doesn't cover the lines */}
      <div
        className={`flex items-center py-${explorerStyles.itemPaddingY} px-${
          explorerStyles.itemPaddingX
        } ${explorerStyles.hoverBgColorClass} rounded cursor-pointer relative h-${
          explorerStyles.itemHeight
        } text-${explorerStyles.itemTextSize} ${
          isSelected ? explorerStyles.selectedTextColorClass : "text-[hsl(var(--foreground)_/_0.8)]"
        }`}
        style={{ paddingLeft: `${level * explorerStyles.indentationWidth}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        draggable={!!onDragStart}
        onDragStart={handleDragStart}
      >
        {/* Background div that doesn't cover the vertical lines */}
        {isSelected && (
          <div
            className={`absolute inset-0 ${explorerStyles.selectedBgColorClass} border-l-2 border-primary`}
            style={{
              left: `0px`,
              // backgroundColor: "rgb(37, 37, 38)", // Removed hardcoded color
              // borderLeft: "2px solid rgb(0, 122, 204)", // Removed hardcoded border
            }}
          />
        )}

        {/* Icon for entry type */}
        <FileIcon
          type={entry.type}
          isExpanded={isExpanded}
          onToggle={handleToggle}
          name={entry.name}
          isMounted={isMounted}
        />

        {/* Entry name or input field for renaming */}
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className={`z-10 relative bg-transparent border border-primary focus:outline-none focus:ring-1 focus:ring-primary text-${
              explorerStyles.itemTextSize
            } ml-${explorerStyles.iconMargin} flex-grow mr-2 px-1 rounded-sm text-[hsl(var(--foreground)_/_0.8)]`}
            style={{ minWidth: 0 }} // Allows input to shrink
            onClick={(e) => e.stopPropagation()} // Prevent click from propagating to the item click handler
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`truncate z-10 relative text-${
                  explorerStyles.itemTextSize
                } ml-${explorerStyles.iconMargin} ${
                  isMounted ? `${explorerStyles.mountedColorClass} font-medium` : ""
                }`}
              >
                {entry.name}
                {entry.type === "folder" && isMounted && (
                  <span className={`text-xs ${explorerStyles.mountedColorClass} ml-1`}>(mounted)</span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-xs">
              <div>Name: {entry.name}</div>
              <div>Path: {entry.path}</div>
              <div>Type: {entry.type}</div>
              <div>Created: {formatLocalDate(entry.metadata.createdAt)}</div>
              <div>Updated: {formatLocalDate(entry.metadata.updatedAt)}</div>
              {entry.type !== 'folder' && <div>Size: {entry.metadata.size} bytes</div>}
              {isMounted && <div>Mounted: Yes ({entry.realPath})</div>}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
};

export default FileItem;
