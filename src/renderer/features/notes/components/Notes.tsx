import React, { useState, useRef } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  ImperativePanelHandle,
} from "react-resizable-panels";
import { Editor } from "@tiptap/react";
import { ScrollArea } from '@/renderer/shared/components/ScrollArea';
import NoteEditor from '../../file-explorer-v2/components/NoteEditor';
import NoteExplorer from "./NoteExplorer/NoteExplorer";
import RightSidebar from "./right-sidebar/RightSidebar";
import { useFileExplorerStore } from '@/renderer/features/file-explorer-v2/store/fileExplorerStore';

const Notes: React.FC<{
  isLeftSidebarOpen: boolean;
  setIsLeftSidebarOpen: (isOpen: boolean) => void;
  isRightSidebarOpen: boolean;
  setIsRightSidebarOpen: (isOpen: boolean) => void;
}> = ({ 
  isLeftSidebarOpen, 
  isRightSidebarOpen, 
  setIsRightSidebarOpen 
}) => {
  const { selectedId, updateNoteContent } = useFileExplorerStore(state => ({ // Removed unused nodes
    selectedId: state.ui.selectedId,
    updateNoteContent: state.updateNoteContent,
  }));
  const notes = useFileExplorerStore(state => state.entities.notes);
  const selectedNote = selectedId ? notes[selectedId] : null;

  const activeNote = selectedNote;
  const [leftSidebarSize, setLeftSidebarSize] = useState(18);
  const [rightSidebarSize, setRightSidebarSize] = useState(25);

  const leftPanelRef = useRef<ImperativePanelHandle>(null); // Use direct useRef
  const rightPanelRef = useRef<ImperativePanelHandle>(null); // Use direct useRef

  const handleEditorUpdate = ({ editor }: { editor: Editor }) => {
    if (activeNote) {
      const newContent = editor.getHTML();
      // Debounce or throttle this update if necessary
      updateNoteContent(activeNote.id, newContent);
    }
  };

  return (
    <PanelGroup direction="horizontal" className="flex-grow">
      {/* Left Sidebar (Note Explorer) */}
      {isLeftSidebarOpen && (
        <>
          <Panel
            id="notes-left-sidebar"
            ref={leftPanelRef}
            defaultSize={leftSidebarSize}
            minSize={10}
            maxSize={30}
            collapsible
            onCollapse={() => setLeftSidebarSize(0)}
            onExpand={() => setLeftSidebarSize(18)} // Restore default size
            onResize={(size) => setLeftSidebarSize(size)}
            className="bg-gray-850 flex flex-col"
          >
            <ScrollArea className="flex-grow">
              <NoteExplorer />
            </ScrollArea>
          </Panel>
          <PanelResizeHandle className="w-1 bg-gray-700 hover:bg-blue-500 transition-colors duration-200" />
        </>
      )}

      {/* Main Content Area (Note Editor) */}
      <Panel id="notes-main-content" className="flex-grow bg-gray-900">
        {activeNote ? (
          <NoteEditor 
            key={activeNote.id} // Add key to force re-render on note change
            content={activeNote.content} 
            onUpdate={handleEditorUpdate} 
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a note to view or edit.
          </div>
        )}
      </Panel>

      {/* Right Sidebar */}
      {isRightSidebarOpen && (
        <>
          <PanelResizeHandle className="w-1 bg-gray-700 hover:bg-blue-500 transition-colors duration-200" />
          <Panel
            id="notes-right-sidebar"
            ref={rightPanelRef}
            defaultSize={rightSidebarSize}
            minSize={15} // Adjusted min size
            maxSize={40} // Adjusted max size
            collapsible
            onCollapse={() => setIsRightSidebarOpen(false)} // Use prop setter
            onExpand={() => setIsRightSidebarOpen(true)} // Use prop setter
            onResize={(size) => setRightSidebarSize(size)}
            className="bg-gray-850 flex flex-col"
          >
            <RightSidebar isOpen={isRightSidebarOpen} onClose={() => setIsRightSidebarOpen(false)} />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
};

export default Notes;
