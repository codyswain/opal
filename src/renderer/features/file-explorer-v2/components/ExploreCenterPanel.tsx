import React, { useState, useCallback } from "react";
import { useDebouncedCallback } from "use-debounce";
import { useFileExplorerStore } from "../store/fileExplorerStore";
import { toast } from "@/renderer/shared/components/Toast";
import FolderView from "./FolderView";
import NoteView from "./NoteView";

function ExploreCenterPanel() {
  const { entities, ui, selectEntry, getNote } = useFileExplorerStore();
  const [isSaving, setIsSaving] = useState(false);
  const [indicatorStatus, setIndicatorStatus] = useState<"green" | "yellow">("green");

  // Get the current note if a note is selected
  const selectedNote = ui.selectedId ? entities.notes[ui.selectedId] : null;
  const selectedNode = ui.selectedId ? entities.nodes[ui.selectedId] : null;

  // Debounce save to prevent too many saves
  const debouncedSaveContent = useDebouncedCallback(
    async (noteId: string, content: string) => {
      setIsSaving(true);
      try {
        // await saveNote(noteId, content);
        setIndicatorStatus("green");
      } catch (err) {
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
  } else {
    return <div className="flex justify-center items-center h-full">Select a file or folder to view</div>;
  }
}

export default ExploreCenterPanel;