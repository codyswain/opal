import React, { useState, useRef, useEffect } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  ImperativePanelHandle,
} from "react-resizable-panels";
import NoteEditor from "@/renderer/features/notes/components/NoteEditor/NoteEditor"
import NoteExplorer from "@/renderer/features/notes/components/NoteExplorer/NoteExplorer";
import RightSidebar from "@/renderer/features/notes/components/RightSidebar/RightSidebar";
import { useNotesContext } from "@/renderer/features/notes/context/notesContext";

const Explorer: React.FC<{
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  setIsLeftSidebarOpen: (isOpen: boolean) => void;
  setIsRightSidebarOpen: (isOpen: boolean) => void;
}> = ({
  isLeftSidebarOpen,
  isRightSidebarOpen,
  setIsLeftSidebarOpen,
  setIsRightSidebarOpen,
}) => {
  const { activeNote } = useNotesContext();
  const [leftSidebarSize, setLeftSidebarSize] = useState(18);
  const [rightSidebarSize, setRightSidebarSize] = useState(25); // Increased default size for better readability

  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);

  const handlePanelCollapse = (panelName: string) => {
    switch (panelName) {
      case "leftSidebar":
        setIsLeftSidebarOpen(false);
        break;
      case "rightSidebar":
        setIsRightSidebarOpen(false);
        break;
    }
  };

  useEffect(() => {
    if (leftPanelRef.current) {
      if (isLeftSidebarOpen) {
        leftPanelRef.current.expand();
      } else {
        leftPanelRef.current.collapse();
      }
    }
  }, [isLeftSidebarOpen]);

  useEffect(() => {
    if (rightPanelRef.current) {
      if (isRightSidebarOpen) {
        rightPanelRef.current.expand();
      } else {
        rightPanelRef.current.collapse();
      }
    }
  }, [isRightSidebarOpen]);

  const handleResize = (panelName: string) => (size: number) => {
    switch (panelName) {
      case "leftSidebar":
        setLeftSidebarSize(size);
        break;
      case "rightSidebar":
        setRightSidebarSize(size);
        break;
    }
  };

  return (
    <PanelGroup direction="horizontal" className="h-screen w-screen">
      <Panel
        ref={leftPanelRef}
        defaultSize={leftSidebarSize}
        minSize={10}
        maxSize={40}
        onResize={handleResize("leftSidebar")}
        collapsible={true}
        onCollapse={() => handlePanelCollapse("leftSidebar")}
      >
        <NoteExplorer
          isOpen={isLeftSidebarOpen}
          onClose={() => setIsLeftSidebarOpen(false)}
        />
      </Panel>
      <PanelResizeHandle className="w-1 bg-border hover:bg-accent/50 cursor-ew-resize" />
      <Panel>
        {activeNote ? (
          <NoteEditor note={activeNote} />
        ) : (
          <div className="flex w-full h-full justify-center items-center">
            Please select a note
          </div>
        )}
      </Panel>
      <PanelResizeHandle className="w-1 bg-border hover:bg-accent/50 cursor-ew-resize" />
      <Panel
        ref={rightPanelRef}
        defaultSize={rightSidebarSize}
        minSize={15}
        maxSize={45}
        onResize={handleResize("rightSidebar")}
        collapsible={true}
        onCollapse={() => handlePanelCollapse("rightSidebar")}
      >
        <RightSidebar
          isOpen={isRightSidebarOpen}
          onClose={() => setIsRightSidebarOpen(false)}
        />
      </Panel>
    </PanelGroup>
  );
};

export default Explorer;
