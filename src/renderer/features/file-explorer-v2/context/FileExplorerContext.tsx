import React, { ReactNode, createContext, useContext } from "react";
import { useFileExplorer } from "../hooks/useFileExplorer";

/**
 * Context for providing file explorer state and operations throughout the component tree
 */
const FileExplorerContext = createContext<ReturnType<typeof useFileExplorer> | undefined>(undefined);

/**
 * Provider component for the FileExplorerContext
 */
export const FileExplorerProvider: React.FC<{children: ReactNode }> = ({ children }) => {
  const explorer = useFileExplorer();
  return (
    <FileExplorerContext.Provider value={explorer}>
      {children}
    </FileExplorerContext.Provider>
  );
}

/**
 * Hook to access the FileExplorerContext
 */
export const useFileExplorerContext = () => {
  const context = useContext(FileExplorerContext);
  if (!context) throw new Error("useFileExplorerContext must be used within a FileExplorerProvider");
  return context;
} 