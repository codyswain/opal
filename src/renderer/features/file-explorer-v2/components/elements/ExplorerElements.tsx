import React from 'react';
import explorerStyles from '../styles/explorerStyles';

// ======================================================
// Type Definitions
// ======================================================

interface VerticalGuideLineProps {
  level: number;
  index: number;
  isLastChild: boolean;
}

interface FileIconProps {
  type: string;
  isExpanded?: boolean;
  onToggle?: (e: React.MouseEvent) => void;
}

interface LoadingStateProps {
  isLoading: boolean;
  error: string | null;
}

// ======================================================
// Helper Components
// ======================================================

/**
 * VerticalGuideLine - Renders the vertical guide lines for folder nesting
 */
export const VerticalGuideLine: React.FC<VerticalGuideLineProps> = ({ 
  level, 
  index, 
  isLastChild 
}) => (
  <div 
    className={`absolute border-l ${explorerStyles.lineColor}`}
    style={{ 
      left: `${index * explorerStyles.indentationWidth + explorerStyles.indentationOffset}px`, 
      top: 0, 
      height: '100%',
      // Hide the line for the current level if this is the last child
      display: index === level - 1 && isLastChild ? 'none' : 'block'
    }}
  />
);

/**
 * FileIcon - Renders the appropriate icon based on entry type
 */
export const FileIcon: React.FC<FileIconProps> = ({ 
  type, 
  isExpanded, 
  onToggle 
}) => (
  <span className={`mr-${explorerStyles.iconMargin} z-10 flex items-center`}>
    {type === 'folder' ? (
      <button 
        onClick={onToggle}
        className={`flex items-center justify-center w-${explorerStyles.iconSize} h-${explorerStyles.iconSize}`}
      >
        {isExpanded ? '📂' : '📁'}
      </button>
    ) : type === 'note' ? '📝' : '📄'}
  </span>
);

/**
 * LoadingState - Displays loading or error states
 */
export const LoadingState: React.FC<LoadingStateProps> = ({ 
  isLoading, 
  error 
}) => {
  if (isLoading) {
    return (
      <div className={`p-1.5 ${explorerStyles.loadingTextColor} text-${explorerStyles.itemTextSize}`}>
        Loading...
      </div>
    );
  }
  
  if (error) {
    return (
      <div className={`p-1.5 ${explorerStyles.errorTextColor} text-${explorerStyles.itemTextSize}`}>
        Error: {error}
      </div>
    );
  }
  
  return null;
}; 