import React, { useState, useRef, useEffect } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  ImperativePanelHandle,
} from "react-resizable-panels";

import RightSidebar from "@/renderer/features/notes/components/RightSidebar/RightSidebar";
import ExplorerLeftPanel from "./ExplorerLeftPanel";
import ExploreCenterPanel from "./ExploreCenterPanel";

const ResizeHandle: React.FC<{ className?: string }> = ({ className }) => (
  <PanelResizeHandle
    className={`group relative w-1.5 transition-colors duration-200 flex items-center justify-center ${className}`}
  >
    <div className="absolute inset-y-0 left-1/2 w-[1px] bg-slate-200 dark:bg-slate-700/50" />
    <div className="absolute h-16 w-0.5 bg-transparent group-hover:bg-accent/70 rounded-full transition-all duration-300" />
    <div className="absolute inset-0 hover:bg-accent/10 transition-colors duration-200" />
  </PanelResizeHandle>
);

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
  const [leftSidebarSize, setLeftSidebarSize] = useState(18);
  const [rightSidebarSize, setRightSidebarSize] = useState(25);

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
        <ExplorerLeftPanel />
      </Panel>
      <ResizeHandle />
      <Panel>
        <ExploreCenterPanel />
      </Panel>
      <ResizeHandle />
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
