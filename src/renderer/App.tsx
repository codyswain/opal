import React, { useCallback, useEffect } from "react";
import {
  HashRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom";
import "@/renderer/styles/index.css";

import { ThemeProvider } from "@/renderer/features/theme";
import { TooltipProvider } from "@/renderer/shared/components/Tooltip";
import { Toaster } from "@/renderer/shared/components/Toast";
import { Navbar, navbarItems } from "@/renderer/features/navbar";
import { Settings } from "@/renderer/features/settings";
import { usePref } from "@/renderer/shared/prefs/usePref";
import { useCommands } from "@/renderer/features/commands";
import { Command, commandRegistry } from "@/renderer/features/commands/services/commandRegistry";
import { COMMAND_IDS } from "@/common/commandIds";
import { KBar, KBarActionsProvider } from "@/renderer/features/kbar";
import { Explorer } from "@/renderer/features/file-explorer-v2";
import { DiskExplorer, useDiskStore } from "@/renderer/features/disk-explorer";
import { useSettingsStore } from "./store/settingsStore";

const App: React.FC = () => {
  const { registerCommand, unregisterCommand } = useCommands();
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = usePref(
    "isLeftSidebarOpen",
    true
  );
  const [isRightSidebarOpen, setIsRightSidebarOpen] = usePref(
    "isRightSidebarOpen",
    true
  );
  const [isBottomPaneOpen, setIsBottomPaneOpen] = usePref(
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
        id: COMMAND_IDS.toggleLeftPane,
        name: "Toggle Left Pane",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+B"],
        keywords: ["pane", "toggle"],
        perform: toggleLeftSidebar,
      },
      {
        id: COMMAND_IDS.toggleRightPane,
        name: "Toggle Right Pane",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+Alt+B"],
        keywords: ["pane", "toggle"],
        perform: toggleRightSidebar,
      },
      {
        id: COMMAND_IDS.toggleBottomPane,
        name: "Toggle Bottom Pane",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+J"],
        keywords: ["pane", "toggle"],
        perform: toggleBottomPane,
      },
      {
        id: COMMAND_IDS.openFolder,
        name: "Open Folder on Disk",
        type: "navigation",
        shortcut: ["CmdOrCtrl+O"],
        keywords: ["files", "folder", "open", "disk"],
        perform: () => { void useDiskStore.getState().openFolder(); },
      },
      {
        id: COMMAND_IDS.openSettings,
        name: "Settings…",
        type: "navigation",
        shortcut: ["CmdOrCtrl+,"],
        keywords: ["settings", "preferences"],
        perform: () => { window.location.hash = "#/settings"; },
      },
    ];

    commands.forEach(registerCommand);

    // Tell main what exists, so the menu and the palette can never disagree.
    window.systemAPI.reportCommands(
      commands.map((command) => ({
        id: command.id,
        label: command.name,
        accelerator: command.shortcut?.[0],
      }))
    );

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

  useEffect(() => {
    return window.systemAPI.onMenuCommand((commandId) => {
      try {
        commandRegistry.executeCommand(commandId);
      } catch (error) {
        console.warn(`Menu dispatched an unknown command: ${commandId}`, error);
      }
    });
  }, []);

  useEffect(() => {
    loadSettings(); // load settings on app mount
  }, [loadSettings]);

  return (
    <Router>
      <KBarActionsProvider>
        <KBar />
        <ThemeProvider>
          
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
                      <Route path="/files" element={<DiskExplorer />} />
                    </Routes>
                  </main>
                </div>
              </div>
            </TooltipProvider>
        </ThemeProvider>
      </KBarActionsProvider>
    </Router>
  );
};

export default App;
