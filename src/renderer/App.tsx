import React, { useCallback, useEffect } from "react";
import {
  HashRouter as Router,
  Navigate,
  useRoutes,
} from "react-router-dom";
import "@/renderer/styles/index.css";

import { ThemeProvider } from "@/renderer/features/theme";
import { TooltipProvider } from "@/renderer/shared/components/Tooltip";
import { Toaster } from "@/renderer/shared/components/Toast";
import { Settings } from "@/renderer/features/settings";
import { usePref } from "@/renderer/shared/prefs/usePref";
import { useCommands } from "@/renderer/features/commands";
import { Command, commandRegistry } from "@/renderer/features/commands/services/commandRegistry";
import { COMMAND_IDS } from "@/common/commandIds";
import { KBar, KBarActionsProvider } from "@/renderer/features/kbar";
import { FilesRoute, useDiskStore } from "@/renderer/features/disk-explorer";
import { ChatRoute } from "@/renderer/features/chat";
import {
  AppShell,
  ShellProvider,
  useShellStore,
  type ShellRouteDescriptor,
  type ShellRouteObject,
} from "@/renderer/features/shell";
import { useSettingsStore } from "./store/settingsStore";

const FILES_ROUTE: ShellRouteDescriptor = {
  id: "files",
  header: { title: "Files" },
};

const CHAT_ROUTE: ShellRouteDescriptor = {
  id: "chat",
  header: { title: "Chat" },
};

const SETTINGS_ROUTE: ShellRouteDescriptor = {
  id: "settings",
  header: { title: "Settings" },
};

const FALLBACK_ROUTE: ShellRouteDescriptor = {
  id: "opal",
  header: { title: "Opal" },
};

const APP_ROUTES: ShellRouteObject[] = [
  {
    path: "/",
    element: <Navigate to="/files" replace />,
    handle: { shell: FILES_ROUTE },
  },
  {
    path: "/files",
    element: <FilesRoute />,
    handle: { shell: FILES_ROUTE },
  },
  {
    path: "/chat",
    element: <ChatRoute />,
    handle: { shell: CHAT_ROUTE },
  },
  {
    path: "/settings",
    element: (
      <div className="h-full overflow-auto">
        <Settings />
      </div>
    ),
    handle: { shell: SETTINGS_ROUTE },
  },
  {
    path: "*",
    element: <Navigate to="/files" replace />,
    handle: { shell: FILES_ROUTE },
  },
];

const AppRoutes: React.FC = () => useRoutes(APP_ROUTES);

const App: React.FC = () => {
  const { registerCommand, unregisterCommand } = useCommands();
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const toggleLeftSidebar = useShellStore((state) => state.toggleSidebar);
  const toggleRightSidebar = useShellStore((state) => state.toggleInspector);
  const [isBottomPaneOpen, setIsBottomPaneOpen] = usePref(
    "isBottomPaneOpen",
    true
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
            <Toaster />
            <ShellProvider
              routes={APP_ROUTES}
              fallbackRoute={FALLBACK_ROUTE}
            >
              <AppShell>
                <AppRoutes />
              </AppShell>
            </ShellProvider>
          </TooltipProvider>
        </ThemeProvider>
      </KBarActionsProvider>
    </Router>
  );
};

export default App;
