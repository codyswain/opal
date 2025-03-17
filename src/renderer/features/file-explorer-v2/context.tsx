import React, { ReactNode, createContext, useContext } from "react";
import { useFileExplorer } from "./useFileExplorer";

const FileExplorerContext = createContext<ReturnType<typeof useFileExplorer> | undefined>(undefined);

export const FileExplorerProvider: React.FC<{children: ReactNode }> = ({ children }) => {
  const explorer = useFileExplorer();
  return (
    <FileExplorerContext.Provider value={explorer}>
      {children}
    </FileExplorerContext.Provider>
  );
}


export const useFileExplorerContext = () => {
  const context = useContext(FileExplorerContext);
  if (!context) throw new Error("useFileExplorerContext must be used within a FileExplorerProvider");
  return context;
} 