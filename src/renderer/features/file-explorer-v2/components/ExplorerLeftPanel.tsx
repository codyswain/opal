import { useFileExplorerStore } from "../store";
import { useEffect } from "react";
import { FSEntry } from "@/types";

// File item component to display a single file, folder, or note
const FileItem = ({ entry, level }: { entry: FSEntry; level: number }) => {
  const { ui, selectEntry, toggleFolder } = useFileExplorerStore();
  const isSelected = ui.selectedId === entry.id;
  const isExpanded = ui.expandedFolders.has(entry.id);
  
  const handleClick = () => {
    selectEntry(entry.id);
  };
  
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFolder(entry.id);
  };
  
  return (
    <div>
      <div 
        className={`flex items-center p-1 rounded cursor-pointer ${isSelected ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        onClick={handleClick}
      >
        {/* Icon for different entry types */}
        <span className="mr-2">
          {entry.type === 'folder' ? (
            <button onClick={handleToggle}>
              {isExpanded ? '📂' : '📁'}
            </button>
          ) : entry.type === 'note' ? '📝' : '📄'}
        </span>
        <span className="truncate">{entry.name}</span>
      </div>
    </div>
  );
};

// Recursive component to render folder contents
const FolderContents = ({ parentId, level = 0 }: { parentId: string | null; level?: number }) => {
  const { entities, ui } = useFileExplorerStore();
  
  // Get child entries for this parent
  const childEntries = Object.values(entities.nodes).filter(
    node => node.parentId === parentId
  );
  
  return (
    <>
      {childEntries.map(entry => (
        <div key={entry.id}>
          <FileItem entry={entry} level={level} />
          
          {/* Render children if this is an expanded folder */}
          {entry.type === 'folder' && 
           ui.expandedFolders.has(entry.id) && 
           <FolderContents parentId={entry.id} level={level + 1} />}
        </div>
      ))}
    </>
  );
};

export default function ExplorerLeftPanel() {
  const { loading, loadFileSystem } = useFileExplorerStore();

  useEffect(() => {
    loadFileSystem();
  }, [loadFileSystem]);

  return (
    <div className="flex flex-col h-full w-full overflow-auto">
      <div className="p-2 font-semibold border-b">Files</div>
      
      <div className="flex-1 overflow-auto p-2">
        {loading.isLoading ? (
          <div className="p-2 text-gray-500">Loading...</div>
        ) : loading.error ? (
          <div className="p-2 text-red-500">Error: {loading.error}</div>
        ) : (
          <FolderContents parentId={null} />
        )}
      </div>
    </div>
  );
}