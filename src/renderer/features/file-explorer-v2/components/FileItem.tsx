import React, { useEffect } from "react";
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
}) => {
  const { ui, selectEntry, toggleFolder } = useFileExplorerStore();
  const isSelected = ui.selectedId === entry.id;
  const isExpanded = ui.expandedFolders.has(entry.id);
  const isMounted = entry.isMounted;

  // Format date for display in user's local timezone
  const formatDate = formatLocalDate;

  // State to track if a double click is in progress
  const [isDoubleClickInProgress, setIsDoubleClickInProgress] =
    React.useState(false);
  const doubleClickTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleClick = (e: React.MouseEvent) => {
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
      e.dataTransfer.setData('application/tread-item-id', entry.id);
      e.dataTransfer.setData('application/tread-item-type', entry.type);
      e.dataTransfer.setData('application/tread-item-name', entry.name);
      e.dataTransfer.setData('text/plain', entry.name);
      
      // Call the parent's onDragStart as a callback
      onDragStart(entry.id, e);
      
      // Add this explicit logging to help debug
      console.log(`Starting drag of item: ${entry.name} (${entry.id}) - Type: ${entry.type}`);
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
        } hover:bg-gray-800/30 rounded cursor-pointer relative h-${
          explorerStyles.itemHeight
        } text-${explorerStyles.itemTextSize} ${
          isSelected ? "text-white" : "text-gray-300"
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
            className="absolute inset-0"
            style={{
              left: `0px`,
              backgroundColor: "rgb(37, 37, 38)",
              borderLeft: "2px solid rgb(0, 122, 204)",
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

        {/* Entry name with timestamp tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={`truncate z-10 relative text-${
                explorerStyles.itemTextSize
              } ml-${explorerStyles.iconMargin} ${
                isMounted ? "text-green-400 font-medium" : ""
              }`}
            >
              {entry.name}
              {entry.type === "folder" && isMounted && (
                <span className="text-xs text-green-500 ml-1">(mounted)</span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Last updated: {formatDate(entry.metadata.updatedAt)}</p>
            <p>Created: {formatDate(entry.metadata.createdAt)}</p>
            {isMounted && entry.realPath && (
              <p className="text-green-400">Mounted from: {entry.realPath}</p>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};

export default FileItem;
