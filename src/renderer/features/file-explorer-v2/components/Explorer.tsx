import React from "react";
import { FileExplorerProvider } from "../context";
import ExplorerPanels from "./ExplorerPanels";

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
  return (
    <FileExplorerProvider>
      <ExplorerPanels
        isLeftSidebarOpen={isLeftSidebarOpen}
        isRightSidebarOpen={isRightSidebarOpen}
        setIsLeftSidebarOpen={setIsLeftSidebarOpen}
        setIsRightSidebarOpen={setIsRightSidebarOpen}
      />
    </FileExplorerProvider>
  );
};

export default Explorer;
