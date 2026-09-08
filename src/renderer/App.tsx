import React, { useEffect } from "react";
import { HashRouter as Router, Navigate, useRoutes } from "react-router-dom";
import "@/renderer/styles/index.css";

import { ThemeProvider } from "@/renderer/features/theme";
import { TooltipProvider } from "@/renderer/shared/components/Tooltip";
import { Toaster } from "@/renderer/shared/components/Toast";
import { Settings } from "@/renderer/features/settings";
import { AppCommands, CommandPalette } from "@/renderer/features/commands";
import { commandRegistry } from "@/renderer/features/commands/services/commandRegistry";
import { FilesRoute } from "@/renderer/features/disk-explorer";
import { ChatRoute } from "@/renderer/features/chat";
import { TodayRoute } from "@/renderer/features/today/TodayRoute";
import { JournalDraftGuard } from "@/renderer/features/today/JournalDraftGuard";
import { PrivacyBoundary } from "@/renderer/features/privacy/PrivacyBoundary";
import { usePrivacyStore } from "@/renderer/features/privacy/privacyStore";
import { COMMAND_IDS } from "@/common/commandIds";
import {
  AppShell,
  ShellProvider,
  type ShellRouteDescriptor,
  type ShellRouteObject,
} from "@/renderer/features/shell";
import { useSettingsStore } from "./store/settingsStore";

const FILES_ROUTE: ShellRouteDescriptor = {
  id: "files",
  header: { title: "Files" },
};

const TODAY_ROUTE: ShellRouteDescriptor = {
  id: "today",
  header: { title: "Today" },
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
    element: <Navigate to="/today" replace />,
    handle: { shell: TODAY_ROUTE },
  },
  { path: "/today", element: <TodayRoute />, handle: { shell: TODAY_ROUTE } },
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
    element: <Navigate to="/today" replace />,
    handle: { shell: TODAY_ROUTE },
  },
];

const AppRoutes: React.FC = () => useRoutes(APP_ROUTES);

const App: React.FC = () => {
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  useEffect(() => {
    return window.systemAPI.onMenuCommand((commandId) => {
      if (
        usePrivacyStore.getState().shielded &&
        commandId !== COMMAND_IDS.togglePrivacy
      )
        return;
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
      <ThemeProvider>
        <TooltipProvider>
          <PrivacyBoundary>
            <Toaster />
            <ShellProvider routes={APP_ROUTES} fallbackRoute={FALLBACK_ROUTE}>
              <AppCommands />
              <JournalDraftGuard />
              <CommandPalette />
              <AppShell>
                <AppRoutes />
              </AppShell>
            </ShellProvider>
          </PrivacyBoundary>
        </TooltipProvider>
      </ThemeProvider>
    </Router>
  );
};

export default App;
