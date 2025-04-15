import React from 'react';
import explorerStyles from '../styles/explorerStyles';
import { 
  ChevronRight, 
  ChevronDown, 
  FileText, 
  FileJson, 
  FileCode, 
  Database, 
  File 
} from 'lucide-react';

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
  name?: string;
  isMounted?: boolean;
}

interface LoadingStateProps {
  isLoading: boolean;
  error: string | null;
}

// Helper function to get file extension
const getFileExtension = (filename: string): string => {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
};

// ======================================================
// Helper Components
// ======================================================

/**
 * VerticalGuideLine - Renders the vertical guide lines for folder nesting
 */
export const VerticalGuideLine: React.FC<VerticalGuideLineProps> = ({ 
  index, 
  isLastChild 
}) => (
  <div 
    className={`absolute border-l ${explorerStyles.lineColorClass}`}
    style={{ 
      left: `${index * explorerStyles.indentationWidth + 10}px`, 
      top: 0, 
      bottom: isLastChild ? '50%' : 0,
      height: isLastChild ? 'auto' : '100%',
    }}
  />
);

/**
 * FileIcon - Renders the appropriate icon based on entry type and file extension
 */
export const FileIcon: React.FC<FileIconProps> = ({ 
  type, 
  isExpanded, 
  onToggle,
  name = '',
  isMounted = false
}) => {
  // Determine icon based on file extension
  const getFileIcon = () => {
    const ext = getFileExtension(name);
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
        return <FileCode size={14} className="text-blue-400" />;
      case 'json':
        return <FileJson size={14} className="text-yellow-400" />;
      case 'sql':
        return <Database size={14} className="text-yellow-500" />;
      default:
        return <FileText size={14} className="text-muted-foreground" />;
    }
  };

  return (
    <span className="z-10 flex items-center">
      {type === 'folder' ? (
        <button 
          onClick={onToggle}
          className={`flex items-center justify-center w-5 h-5 ${isMounted ? explorerStyles.mountedColorClass : 'text-muted-foreground'} hover:text-foreground`}
        >
          {isExpanded ? 
            <ChevronDown size={16} className="stroke-[1.5]" /> : 
            <ChevronRight size={16} className="stroke-[1.5]" />
          }
        </button>
      ) : (
        <span className="flex w-5 h-5 justify-center items-center">
          {getFileIcon()}
        </span>
      )}
    </span>
  );
};

/**
 * LoadingState - Displays loading or error states
 */
export const LoadingState: React.FC<LoadingStateProps> = ({ 
  isLoading, 
  error 
}) => {
  if (isLoading) {
    return (
      <div className={`p-1 ${explorerStyles.loadingTextColorClass} text-${explorerStyles.itemTextSize}`}>
        Loading...
      </div>
    );
  }
  
  if (error) {
    return (
      <div className={`p-1 ${explorerStyles.errorTextColorClass} text-${explorerStyles.itemTextSize}`}>
        Error: {error}
      </div>
    );
  }
  
  return null;
}; 