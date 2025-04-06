import React from "react";
import ExplorerPanels from "./ExplorerPanels";

/**
 * Main Explorer component that provides the file explorer functionality
 */
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
    <ExplorerPanels
      isLeftSidebarOpen={isLeftSidebarOpen}
      isRightSidebarOpen={isRightSidebarOpen}
      setIsLeftSidebarOpen={setIsLeftSidebarOpen}
      setIsRightSidebarOpen={setIsRightSidebarOpen}
    />
  );
};

export default Explorer;
