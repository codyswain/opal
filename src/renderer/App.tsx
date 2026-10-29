import React, { useEffect } from "react";
import {
  HashRouter as Router,
  Navigate,
  useRoutes,
  type RouteObject,
} from "react-router-dom";
import "@/renderer/styles/index.css";

import { ThemeProvider } from "@/renderer/features/theme";
import { TooltipProvider } from "@/renderer/shared/components/Tooltip";
import { Toaster } from "@/renderer/shared/components/Toast";
import { SettingsDialog } from "@/renderer/features/settings";
import { AppCommands, CommandPalette } from "@/renderer/features/commands";
import { commandRegistry } from "@/renderer/features/commands/services/commandRegistry";
import {
  ConfirmDeleteDialog,
  FilesRoute,
  NameDialog,
} from "@/renderer/features/disk-explorer";
import {
  FILES_ROUTE_PATH,
  serializeFilesLocation,
} from "@/renderer/features/disk-explorer/navigation";
import {
  selectCurrentLocation,
  selectLaunchLocation,
  useTabsStore,
} from "@/renderer/features/disk-explorer/store/tabsStore";
import { openToday } from "@/renderer/features/shell/utils/openToday";
import { AppShell, ShellProvider, useShell } from "@/renderer/features/shell";

/**
 * Launch brings back the tabs of the last session. Today's page opens when
 * nothing came back or the day has changed since; without a vault the page
 * area is left to the files route.
 */
const StartPage: React.FC = () => {
  const { navigateFiles, navigateTo } = useShell();
  useEffect(() => {
    const files = () => {
      const shown = selectCurrentLocation(useTabsStore.getState());
      navigateTo(
        {
          pathname: FILES_ROUTE_PATH,
          search: shown ? serializeFilesLocation(shown) : "",
        },
        { replace: true },
      );
    };
    if (selectLaunchLocation(useTabsStore.getState())) {
      files();
      return;
    }
    void openToday(navigateFiles)
      .then((opened) => {
        if (!opened) files();
      })
      .catch(files);
    // Runs once per landing on "/"; navigation replaces this route.
  }, []);
  return null;
};

const APP_ROUTES: RouteObject[] = [
  { path: "/", element: <StartPage /> },
  { path: "/files", element: <FilesRoute /> },
  { path: "*", element: <Navigate to="/" replace /> },
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
          <ShellProvider>
            <AppCommands />
            <CommandPalette />
            <SettingsDialog />
            {/* File actions start from the sidebar tree and the folder view alike. */}
            <NameDialog />
            <ConfirmDeleteDialog />
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
