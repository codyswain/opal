import React, { useRef, useEffect } from "react";
import {
  Panel,
  PanelGroup,
  ImperativePanelHandle,
} from "react-resizable-panels";
import {
  usePaneLayout,
  sizesFor,
  PaneHandle,
} from "@/renderer/shared/components/panes";

import RightSidebar from "@/renderer/features/file-explorer-v2/components/right-sidebar/RightSidebar";
import ExplorerLeftPanel from "./ExplorerLeftPanel";
import ExploreCenterPanel from "./ExploreCenterPanel";

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
  const { sizes, onLayout } = usePaneLayout("explorer", [18, 57, 25]);

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

  return (
    <PanelGroup direction="horizontal" className="h-screen w-screen" onLayout={onLayout}>
      <Panel
        ref={leftPanelRef}
        defaultSize={sizesFor(sizes, 0, 18)}
        minSize={10}
        maxSize={40}
        collapsible={true}
        onCollapse={() => handlePanelCollapse("leftSidebar")}
      >
        <ExplorerLeftPanel />
      </Panel>
      <PaneHandle />
      <Panel>
        <ExploreCenterPanel />
      </Panel>
      <PaneHandle />
      <Panel
        ref={rightPanelRef}
        defaultSize={sizesFor(sizes, 2, 25)}
        minSize={15}
        maxSize={45}
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
