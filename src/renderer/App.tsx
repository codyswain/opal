import React, { useCallback, useEffect } from "react";
import {
  HashRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom";
import "@/renderer/index.css";

import { ThemeProvider } from "@/renderer/features/theme";
import { TooltipProvider } from "@/renderer/shared/components/Tooltip";
import { Toaster } from "@/renderer/shared/components/Toast";
import { Navbar, navbarItems } from "@/renderer/features/navbar";
import { Settings, SettingsProvider } from "@/renderer/features/settings";
import useLocalStorage from "@/renderer/shared/hooks/useLocalStorage";
import { useCommands } from "@/renderer/features/commands";
import { Command } from "@/renderer/features/commands/services/commandRegistry";
import { KBar, KBarActionsProvider } from "@/renderer/features/kbar";
import { Explorer } from "@/renderer/features/file-explorer-v2";

const App: React.FC = () => {
  const { registerCommand, unregisterCommand } = useCommands();

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useLocalStorage(
    "isLeftSidebarOpen",
    true
  );
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useLocalStorage(
    "isRightSidebarOpen",
    true
  );
  const [isBottomPaneOpen, setIsBottomPaneOpen] = useLocalStorage(
    "isBottomPaneOpen",
    true
  );

  const toggleLeftSidebar = useCallback(
    () => setIsLeftSidebarOpen(!isLeftSidebarOpen),
    [isLeftSidebarOpen]
  );
  const toggleRightSidebar = useCallback(
    () => setIsRightSidebarOpen(!isRightSidebarOpen),
    [isRightSidebarOpen]
  );
  const toggleBottomPane = useCallback(
    () => setIsBottomPaneOpen(!isBottomPaneOpen),
    [isBottomPaneOpen]
  );

  useEffect(() => {
    const commands: Command[] = [
      {
        id: "pane.toggleLeft",
        name: "Toggle Left Pane",
        type: "paneToggle",
        keywords: ["pane", "toggle"],
        perform: toggleLeftSidebar,
      },
      {
        id: "pane.toggleRight",
        name: "Toggle Right Pane",
        type: "paneToggle",
        keywords: ["pane", "toggle"],
        perform: toggleRightSidebar,
      },
      {
        id: "pane.toggleBottom",
        name: "Toggle Bottom Pane",
        type: "paneToggle",
        keywords: ["pane", "toggle"],
        perform: toggleBottomPane,
      },
    ];

    commands.forEach(registerCommand);

    return () => {
      commands.forEach((command) => unregisterCommand(command));
    };
  }, [
    registerCommand,
    unregisterCommand,
    toggleLeftSidebar,
    toggleRightSidebar,
    toggleBottomPane,
  ]);

  return (
    <Router>
      <KBarActionsProvider>
        <KBar />
        <ThemeProvider>
          <SettingsProvider>
            <TooltipProvider>
              <div className="flex flex-col h-screen w-screen overflow-hidden">
                <Toaster />
                <div className="flex flex-col flex-grow overflow-hidden">
                  <Navbar
                    toggleLeftSidebar={toggleLeftSidebar}
                    toggleRightSidebar={toggleRightSidebar}
                    isLeftSidebarOpen={isLeftSidebarOpen}
                    isRightSidebarOpen={isRightSidebarOpen}
                    items={navbarItems}
                  />
                  <main className="flex-grow overflow-hidden mt-10">
                    <Routes>
                      <Route
                        path="/"
                        element={<Navigate to="/explorer" replace />}
                      />

                      <Route path="/settings" element={<Settings />} />

                      <Route
                        path="/explorer"
                        element={
                          <Explorer
                            isLeftSidebarOpen={isLeftSidebarOpen}
                            isRightSidebarOpen={isRightSidebarOpen}
                            setIsLeftSidebarOpen={setIsLeftSidebarOpen}
                            setIsRightSidebarOpen={setIsRightSidebarOpen}
                          />
                        }
                      />
                    </Routes>
                  </main>
                </div>
              </div>
            </TooltipProvider>
          </SettingsProvider>
        </ThemeProvider>
      </KBarActionsProvider>
    </Router>
  );
};

export default App;
