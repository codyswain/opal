import React, { useState, useCallback } from "react";
import { useDebouncedCallback } from "use-debounce";
import { useFileExplorerStore } from "../store/fileExplorerStore";
import { toast } from "@/renderer/shared/components/Toast";
import FolderView from "./FolderView";
import NoteView from "./NoteView";
import ImageView from "./ImageView";

function ExploreCenterPanel() {
  const { entities, ui, selectEntry, updateNoteContent } = useFileExplorerStore();
  const [isSaving, setIsSaving] = useState(false);
  const [indicatorStatus, setIndicatorStatus] = useState<"green" | "yellow">("green");

  // Get the current note if a note is selected
  const selectedNote = ui.selectedId ? entities.notes[ui.selectedId] : null;
  const selectedNode = ui.selectedId ? entities.nodes[ui.selectedId] : null;

  // Check if the selected node is an image
  const isImage = (node: typeof selectedNode): boolean => {
    if (!node || !node.realPath) return false;
    
    const extension = node.name.split('.').pop()?.toLowerCase();
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
    
    return !!extension && imageExtensions.includes(extension);
  };

  // Debounce save to prevent too many saves
  const debouncedSaveContent = useDebouncedCallback(
    async (noteId: string, content: string) => {
      if (!selectedNode || selectedNode.type !== 'note') {
        console.error('Cannot save content for non-note item:', noteId);
        toast("Error saving note", {
          description: "This item is not a note and cannot be edited.",
        });
        return;
      }

      setIsSaving(true);
      try {
        const success = await updateNoteContent(noteId, content);
        if (success) {
          setIndicatorStatus("green");
        } else {
          throw new Error("Failed to save note");
        }
      } catch (err) {
        console.error('Error saving note:', err);
        setIndicatorStatus("green"); // Reset indicator to avoid showing perpetual "saving" state
        toast("Error saving note", {
          description: "An error occurred while saving the note. Please try again.",
        });
      } finally {
        setIsSaving(false);
      }
    },
    1000,
    { leading: false, trailing: true }
  );

  // Content change handler
  const handleContentChange = useCallback(
    ({ editor }: { editor: any }) => {
      if (ui.selectedId) {
        const content = editor.getHTML();
        if (selectedNote && selectedNote.content !== content) {
          setIndicatorStatus("yellow");
          debouncedSaveContent(ui.selectedId, content);
        }
      }
    },
    [ui.selectedId, selectedNote, debouncedSaveContent]
  );

  if (selectedNode?.type === 'folder') {
    return (
      <FolderView 
        selectedNode={selectedNode} 
        entities={entities} 
        selectEntry={selectEntry} 
      />
    );
  } else if (selectedNode?.type === 'note') {
    return (
      <NoteView
        selectedNode={selectedNode}
        selectedNote={selectedNote!}
        isSaving={isSaving}
        indicatorStatus={indicatorStatus}
        handleContentChange={handleContentChange}
      />
    );
  } else if (isImage(selectedNode)) {
    return <ImageView selectedNode={selectedNode!} />;
  } else {
    return <div className="flex justify-center items-center h-full">Select a file or folder to view</div>;
  }
}

export default ExploreCenterPanel;