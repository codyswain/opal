import { FSEntry } from "@/types";
import React, { useState, useMemo } from "react";
import { format } from "date-fns";
import { 
  ChevronDown, 
  ChevronUp, 
  Calendar, 
  Clock, 
  FileText, 
  Folder, 
  List, 
  Grid, 
  FileIcon,
  Edit3
} from "lucide-react";

interface FolderViewProps {
  selectedNode: FSEntry;
  entities: {
    nodes: Record<string, FSEntry>
  };
  selectEntry: (id: string) => void;
}

type SortField = 'name' | 'updatedAt' | 'createdAt' | 'type';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'compact' | 'normal';

const FolderView: React.FC<FolderViewProps> = ({ 
  selectedNode, 
  entities, 
  selectEntry 
}) => {
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [viewMode, setViewMode] = useState<ViewMode>('normal');

  // Toggle sort direction or change sort field
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), 'MMM d, yyyy h:mm a');
    } catch (e) {
      return 'Unknown date';
    }
  };

  // Get file/folder icon based on type
  const getIcon = (type: string) => {
    switch (type) {
      case 'folder':
        return <Folder className="w-5 h-5 text-blue-500" />;
      case 'note':
        return <Edit3 className="w-5 h-5 text-green-500" />;
      default:
        return <FileIcon className="w-5 h-5 text-gray-500" />;
    }
  };

  // Sort and filter children
  const sortedChildren = useMemo(() => {
    if (!selectedNode?.children?.length) return [];
    
    return [...selectedNode.children]
      .map(childId => entities.nodes[childId])
      .filter(Boolean)
      .sort((a, b) => {
        // First sort by type (folders first)
        if (sortField === 'type') {
          if (a.type === 'folder' && b.type !== 'folder') return sortDirection === 'asc' ? 1 : -1;
          if (a.type !== 'folder' && b.type === 'folder') return sortDirection === 'asc' ? -1 : 1;
        }
        
        // Then sort by the selected field
        if (sortField === 'name') {
          return sortDirection === 'asc' 
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        } else if (sortField === 'updatedAt') {
          return sortDirection === 'asc'
            ? new Date(a.metadata.updatedAt).getTime() - new Date(b.metadata.updatedAt).getTime()
            : new Date(b.metadata.updatedAt).getTime() - new Date(a.metadata.updatedAt).getTime();
        } else if (sortField === 'createdAt') {
          return sortDirection === 'asc'
            ? new Date(a.metadata.createdAt).getTime() - new Date(b.metadata.createdAt).getTime()
            : new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime();
        }
        
        return 0;
      });
  }, [selectedNode?.children, entities.nodes, sortField, sortDirection]);

  // Get file size in human-readable format
  const getFileSize = (size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with folder name and controls */}
      <div className="p-4 border-b flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{selectedNode?.name}</h2>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setViewMode('compact')}
              className={`p-1.5 rounded-md ${viewMode === 'compact' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
              title="Compact view"
            >
              <List className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('normal')}
              className={`p-1.5 rounded-md ${viewMode === 'normal' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
              title="Normal view"
            >
              <Grid className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* Sort controls */}
        <div className="flex flex-wrap gap-2 text-sm">
          <button 
            onClick={() => handleSort('name')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md ${sortField === 'name' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
          >
            Name
            {sortField === 'name' && (
              sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            )}
          </button>
          <button 
            onClick={() => handleSort('type')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md ${sortField === 'type' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
          >
            Type
            {sortField === 'type' && (
              sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            )}
          </button>
          <button 
            onClick={() => handleSort('updatedAt')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md ${sortField === 'updatedAt' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
          >
            Modified
            {sortField === 'updatedAt' && (
              sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            )}
          </button>
          <button 
            onClick={() => handleSort('createdAt')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md ${sortField === 'createdAt' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
          >
            Created
            {sortField === 'createdAt' && (
              sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>
      
      {/* Content area */}
      <div className="flex-1 overflow-auto p-2">
        {viewMode === 'compact' ? (
          // Compact view - table layout
          <div className="w-full">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-left p-2 font-medium">Name</th>
                  <th className="text-left p-2 font-medium">Modified</th>
                  <th className="text-left p-2 font-medium hidden md:table-cell">Created</th>
                  <th className="text-left p-2 font-medium hidden md:table-cell">Size</th>
                </tr>
              </thead>
              <tbody>
                {sortedChildren.map((child) => (
                  <tr 
                    key={child.id}
                    onClick={() => selectEntry(child.id)}
                    className="hover:bg-muted/50 cursor-pointer border-b border-muted/30"
                  >
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        {getIcon(child.type)}
                        <span>{child.name}</span>
                      </div>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {formatDate(child.metadata.updatedAt)}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground hidden md:table-cell">
                      {formatDate(child.metadata.createdAt)}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground hidden md:table-cell">
                      {child.type !== 'folder' ? getFileSize(child.metadata.size) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          // Normal view - grid with previews
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedChildren.map((child) => (
              <div 
                key={child.id}
                onClick={() => selectEntry(child.id)}
                className="flex flex-col bg-card hover:bg-card/80 rounded-lg cursor-pointer border border-muted overflow-hidden transition-all hover:shadow-md"
              >
                {/* Preview area */}
                <div className="h-32 bg-muted/30 flex items-center justify-center p-4">
                  {getIcon(child.type)}
                </div>
                
                {/* Info area */}
                <div className="p-3">
                  <div className="font-medium truncate">{child.name}</div>
                  <div className="flex flex-col mt-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>Modified {formatDate(child.metadata.updatedAt)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>Created {formatDate(child.metadata.createdAt)}</span>
                    </div>
                    {child.type !== 'folder' && child.type !== 'note' && (
                      <div className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        <span>{getFileSize(child.metadata.size)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Empty state */}
        {(!selectedNode?.children || selectedNode.children.length === 0) && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
            <Folder className="w-12 h-12 mb-2 opacity-30" />
            <p>This folder is empty</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FolderView;