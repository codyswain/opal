import React, { useState, useRef, useEffect } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  ImperativePanelHandle,
} from "react-resizable-panels";

import RightSidebar from "@/renderer/features/file-explorer-v2/components/right-sidebar/RightSidebar";
import ExplorerLeftPanel from "./ExplorerLeftPanel";
import ExploreCenterPanel from "./ExploreCenterPanel";

const ResizeHandle: React.FC<{
  className?: string;
}> = ({ className }) => (
  <PanelResizeHandle
    className={`group relative w-px flex items-center justify-center bg-border data-[resize-handle-state=hover]:bg-[hsl(var(--primary)_/_0.7)] transition-colors duration-300 ${className}`}
  ></PanelResizeHandle>
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
