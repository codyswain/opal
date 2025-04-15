import React, { useState, useEffect, useMemo } from 'react';
// import { motion } from 'framer-motion'; // Removed unused import causing error
import { FSEntry } from '@/renderer/shared/types';
import { 
  ChevronDown, 
  ChevronUp, 
  Clock, 
  Folder, 
  List, 
  Grid, 
  FileIcon,
  Edit3,
  Image,
} from "lucide-react"; // Removed Calendar, FileText
import { formatLocalDate } from '@/renderer/shared/utils';

interface FolderViewProps {
  selectedNode: FSEntry;
  entities: {
    nodes: Record<string, FSEntry>
  };
  selectEntry: (id: string) => void;
}

type SortField = 'name' | 'updatedAt' | 'createdAt' | 'type';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'list' | 'grid';

const FolderView: React.FC<FolderViewProps> = ({ 
  selectedNode, 
  entities, 
  selectEntry 
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [imageCache, setImageCache] = useState<Record<string, string>>({});

  // Load thumbnails for images
  useEffect(() => {
    if (!selectedNode?.children?.length) return;
    
    const loadImages = async () => {
      const newImageCache: Record<string, string> = {};
      
      // Get all children that are images
      const imageNodes = selectedNode.children
        .map(childId => entities.nodes[childId])
        .filter(node => node && isImage(node));
      
      // Load images in parallel
      await Promise.all(imageNodes.map(async (node) => {
        if (node.path && !newImageCache[node.id]) {
          try {
            const result = await window.syncAPI.getImageData(node.path);
            if (result.success) {
              newImageCache[node.id] = result.dataUrl;
            }
          } catch (error) {
            console.error(`Failed to load image ${node.path}:`, error);
          }
        }
      }));
      
      setImageCache(newImageCache);
    };
    
    loadImages();
  }, [selectedNode?.children, entities.nodes]);

  // Toggle sort direction or change sort field
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Get file/folder icon based on type
  const getIcon = (type: string, entry: FSEntry) => {
    // Check if it's an image file with a real path
    if (isImage(entry)) {
      return <Image className="w-4 h-4 text-purple-500" />;
    }

    switch (type) {
      case 'folder':
        return <Folder className="w-4 h-4 text-blue-500" />;
      case 'note':
        return <Edit3 className="w-4 h-4 text-green-500" />;
      default:
        return <FileIcon className="w-4 h-4 text-gray-500" />;
    }
  };

  // Check if a file is an image
  const isImage = (entry: FSEntry): boolean => {
    if (!entry.path) return false;
    
    const extension = entry.name.split('.').pop()?.toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(`.${extension}`);
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
          
          // Then sort images
          const aIsImage = isImage(a);
          const bIsImage = isImage(b);
          if (aIsImage && !bIsImage) return sortDirection === 'asc' ? 1 : -1;
          if (!aIsImage && bIsImage) return sortDirection === 'asc' ? -1 : 1;
        }
        
        // Then sort by the selected field
        if (sortField === 'name') {
          return sortDirection === 'asc' 
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        } else if (sortField === 'updatedAt') {
          const dateA = new Date(a.metadata.updatedAt).getTime();
          const dateB = new Date(b.metadata.updatedAt).getTime();
          return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
        } else if (sortField === 'createdAt') {
          const dateA = new Date(a.metadata.createdAt).getTime();
          const dateB = new Date(b.metadata.createdAt).getTime();
          return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
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
      <div className="p-3 border-b flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Folder className="w-4 h-4 text-blue-500" />
            <h2 className="text-lg font-semibold">{selectedNode?.name}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setViewMode('list')}
              className={`p-1 rounded-md ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-1 rounded-md ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
              title="Grid view"
            >
              <Grid className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* Sort controls */}
        <div className="flex flex-wrap gap-1 text-xs">
          <button 
            onClick={() => handleSort('name')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md ${sortField === 'name' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
          >
            Name
            {sortField === 'name' && (
              sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            )}
          </button>
          <button 
            onClick={() => handleSort('type')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md ${sortField === 'type' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
          >
            Type
            {sortField === 'type' && (
              sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            )}
          </button>
          <button 
            onClick={() => handleSort('updatedAt')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md ${sortField === 'updatedAt' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
          >
            Modified
            {sortField === 'updatedAt' && (
              sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            )}
          </button>
          <button 
            onClick={() => handleSort('createdAt')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md ${sortField === 'createdAt' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
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
        {viewMode === 'list' ? (
          // List view - table layout
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
                        {getIcon(child.type, child)}
                        <span className="truncate">{child.name}</span>
                      </div>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                      {formatLocalDate(child.metadata.updatedAt)}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground whitespace-nowrap hidden md:table-cell">
                      {formatLocalDate(child.metadata.createdAt)}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground whitespace-nowrap hidden md:table-cell">
                      {child.type !== 'folder' ? getFileSize(child.metadata.size) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          // Grid view - more compact with smaller previews
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {sortedChildren.map((child) => (
              <div 
                key={child.id}
                onClick={() => selectEntry(child.id)}
                className="flex flex-col bg-card hover:bg-card/80 rounded-md cursor-pointer border border-muted overflow-hidden transition-all hover:shadow-sm"
              >
                {/* Preview area showing thumbnails for images */}
                <div className="h-16 bg-muted/20 flex items-center justify-center">
                  {isImage(child) && imageCache[child.id] ? (
                    <img 
                      src={imageCache[child.id]} 
                      alt={child.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    getIcon(child.type, child)
                  )}
                </div>
                
                {/* More compact info area */}
                <div className="p-2 text-xs">
                  <div className="font-medium truncate">{child.name}</div>
                  <div className="flex items-center gap-1 mt-1 text-muted-foreground text-[10px]">
                    <Clock className="w-3 h-3" />
                    <span className="truncate">{formatLocalDate(child.metadata.updatedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Empty state */}
        {(!selectedNode?.children || selectedNode.children.length === 0) && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
            <Folder className="w-10 h-10 mb-2 opacity-20" />
            <p className="text-sm">This folder is empty</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FolderView;