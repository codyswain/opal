import React, { useEffect } from "react";
import { HashRouter as Router, Navigate, useRoutes } from "react-router-dom";
import "@/renderer/styles/index.css";

import { ThemeProvider } from "@/renderer/features/theme";
import { TooltipProvider } from "@/renderer/shared/components/Tooltip";
import { Toaster } from "@/renderer/shared/components/Toast";
import { SettingsDialog } from "@/renderer/features/settings";
import { AppCommands, CommandPalette } from "@/renderer/features/commands";
import { commandRegistry } from "@/renderer/features/commands/services/commandRegistry";
import { FilesRoute } from "@/renderer/features/disk-explorer";
import { FILES_ROUTE_PATH } from "@/renderer/features/disk-explorer/navigation";
import { openToday } from "@/renderer/features/shell/utils/openToday";
import {
  AppShell,
  ShellProvider,
  useShell,
  type ShellRouteDescriptor,
  type ShellRouteObject,
} from "@/renderer/features/shell";

const FILES_ROUTE: ShellRouteDescriptor = {
  id: "files",
  header: { title: "Files" },
};

const FALLBACK_ROUTE: ShellRouteDescriptor = {
  id: "opal",
  header: { title: "Opal" },
};

/** Launch lands on today's page; without a vault it falls back to the Library. */
const StartPage: React.FC = () => {
  const { navigateFiles, navigateTo } = useShell();
  useEffect(() => {
    const library = () => navigateTo(FILES_ROUTE_PATH, { replace: true });
    void openToday(navigateFiles, "replace")
      .then((opened) => {
        if (!opened) library();
      })
      .catch(library);
    // Runs once per landing on "/"; navigation replaces this route.
  }, []);
  return null;
};

const APP_ROUTES: ShellRouteObject[] = [
  {
    path: "/",
    element: <StartPage />,
    handle: { shell: FALLBACK_ROUTE },
  },
  {
    path: "/files",
    element: <FilesRoute />,
    handle: { shell: FILES_ROUTE },
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
    handle: { shell: FALLBACK_ROUTE },
  },
];

const AppRoutes: React.FC = () => useRoutes(APP_ROUTES);

const App: React.FC = () => {
  useEffect(() => {
    return window.systemAPI.onMenuCommand((commandId) => {
      try {
        commandRegistry.executeCommand(commandId);
      } catch (error) {
        console.warn(`Menu dispatched an unknown command: ${commandId}`, error);
      }
    });
  }, []);

  return (
    <Router>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <ShellProvider routes={APP_ROUTES} fallbackRoute={FALLBACK_ROUTE}>
            <AppCommands />
            <CommandPalette />
            <SettingsDialog />
            <AppShell>
              <AppRoutes />
            </AppShell>
          </ShellProvider>
        </TooltipProvider>
      </ThemeProvider>
    </Router>
  );
};

export default App;
