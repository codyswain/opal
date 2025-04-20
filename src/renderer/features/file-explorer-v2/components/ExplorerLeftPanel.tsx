import React, { useEffect, useState } from "react";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";
import { LoadingState } from "@/renderer/features/file-explorer-v2/components/elements/ExplorerElements";
import FolderContents from "@/renderer/features/file-explorer-v2/components/FolderContents";
import { useFileExplorerContextMenu } from "@/renderer/features/file-explorer-v2/hooks/useFileExplorerContextMenu";
import FileExplorerContextMenu from "@/renderer/features/file-explorer-v2/components/FileExplorerContextMenu";
import { FilePlus, FolderPlus } from "lucide-react";
import { FSEntry } from "@/types";

/**
 * ExplorerLeftPanel - Main component for the file explorer panel
 *
 * This component is responsible for:
 * 1. Loading the file system data
 * 2. Displaying the header with create buttons
 * 3. Showing loading/error states
 * 4. Rendering the folder contents
 * 5. Handling context menu interactions
 * 6. Supporting drag operations for embedding items in notes
 */
export default function ExplorerLeftPanel() {
  const {
    loading,
    loadVirtualFileSystem,
    createNote,
    createFolder,
    renameFolder,
    renameNote,
    ui,
    entities,
    loadVirtualFileSystem: reloadFS,
  } = useFileExplorerStore();
  const { contextMenu, handleContextMenu, closeContextMenu } =
    useFileExplorerContextMenu();

  // State to track which item is currently being renamed
  const [renamingItem, setRenamingItem] = useState<FSEntry | null>(null);

  // Load file system data on component mount
  useEffect(() => {
    loadVirtualFileSystem();
  }, [loadVirtualFileSystem]);

  // Handle creating a new note
  const handleCreateNote = async () => {
    const selectedId = ui.selectedId;
    let parentPath = "/";

    if (selectedId) {
      const selectedNode = entities.nodes[selectedId];
      if (selectedNode) {
        if (selectedNode.type === "folder") {
          parentPath = selectedNode.path;
        } else if (selectedNode.parentId) {
          // If a note is selected, create at the same level
          const parentNode = entities.nodes[selectedNode.parentId];
          if (parentNode) {
            parentPath = parentNode.path;
          }
        }
      }
    }

    await createNote(parentPath, "New Note");
  };

  // Handlers button for top level folder creation
  const handleCreateFolder = async () => {
    // TODO: change createFolder to take name as first param
    await createFolder(null, "New Folder"); // Pass null for parentPath
  };

  const handleStartRename = (entry: FSEntry) => {
    setRenamingItem(entry);
    closeContextMenu(); // Close context menu when renaming starts
  };

  // Handle the actual rename operation
  const handleRenameSubmit = async (item: FSEntry, newName: string) => {
    if (!newName.trim()) {
      console.error("New name cannot be empty.");
      setRenamingItem(null); // Cancel rename if name is empty
      return;
    }
    try {
      console.log(
        `Attempting rename id=${item.id} (path: ${item.path}) to ${newName}`
      );
      let success = false;
      if (item.type === "folder") {
        success = await renameFolder(item.id, newName);
      } else if (item.type === "note") {
        success = await renameNote(item.id, newName);
      }

      if (success) {
        // Reload the FS for a folder
        // TODO: just reload the folder portion of the VFS
        if (item.type === "folder") {
          await reloadFS();
        }
        console.log(
          `Successfully renamed ${item.type} ${item.id} to ${newName}`
        );
      } else {
        console.error(
          "Error renaming item:",
          "Rename operation failed in store."
        );
        // TODO: Optionally show an error notification to the user
      }
    } catch (error) {
      console.error("Error during rename operation:", error);
      // TODO: Optionally show an error notification to the user
    } finally {
      setRenamingItem(null); // Stop renaming regardless of success or failure
    }
  };

  // Cancel the renaming process
  const handleRenameCancel = () => {
    setRenamingItem(null);
  };

  // Corrected function signature and implementation
  const handleDragStart = (itemId: string, event: React.DragEvent<Element>) => {
    // Prevent default browser drag behavior if necessary (usually handled by setting draggable=true)
    // event.preventDefault();

    const item = entities.nodes[itemId];
    if (item) {
      console.log(`Drag started for item ${item.id}: ${item.name}`);
      // Set custom data for the drop target (e.g., NoteEditor)
      event.dataTransfer.setData("application/opal-item-id", item.id);
      event.dataTransfer.setData("application/opal-item-type", item.type);
      event.dataTransfer.setData("application/opal-item-name", item.name);
      // Optional: Set drag effect
      event.dataTransfer.effectAllowed = "copy";
    } else {
      console.error(`Item with ID ${itemId} not found for drag start.`);
    }
  };

  return (
    <div className="flex flex-col h-full w-full overflow-auto bg-secondary">
      <div className="flex justify-between items-center p-1 border-b border-[hsl(var(--border))] bg-secondary">
        <div className="text-sm font-medium">Files</div>
        <div className="flex space-x-1">
          <button
            className="p-1 hover:bg-accent/50 rounded"
            onClick={handleCreateNote}
            title="Create new note"
          >
            <FilePlus size={16} />
          </button>
          <button
            className="p-1 hover:bg-accent/50 rounded"
            onClick={handleCreateFolder}
            title="Create new folder"
          >
            <FolderPlus size={16} />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto px-1.5 py-1">
        <LoadingState isLoading={loading.isLoading} error={loading.error} />

        {!loading.isLoading && !loading.error && (
          <FolderContents
            level={0}
            parentId={null}
            onContextMenu={handleContextMenu}
            onDragStart={handleDragStart}
            renamingItem={renamingItem}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={handleRenameCancel}
          />
        )}

        {/* Context Menu */}
        <FileExplorerContextMenu
          contextMenu={contextMenu}
          onClose={closeContextMenu}
          onStartRename={handleStartRename}
        />
      </div>
    </div>
  );
}
