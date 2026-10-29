import logger from "@/main/logger";
import { isThemeReport, type ThemeReport } from "@/common/theme";
import type { IpcMain, Dialog, BrowserWindow } from "electron";
import * as fs from "fs-extra";

interface SystemHandlerDependencies {
  ipc: IpcMain;
  dialog: Dialog;
  browserWindow: typeof BrowserWindow;
  onThemeChanged: (report: ThemeReport) => void;
}

export class SystemHandlers {
  private deps: SystemHandlerDependencies;

  constructor(deps: SystemHandlerDependencies) {
    this.deps = deps;
  }

  registerAll(): void {
    this.registerCreateDirectoryOnDisk();
    this.registerOpenFolderDialog();
    this.registerReportTheme();
    this.registerFullScreenState();
    this.registerCloseWindow();
  }

  private registerCreateDirectoryOnDisk(): void {
    this.deps.ipc.handle(`system:create-directory-on-disk`, async (_, dirPath: string): Promise<{ success: boolean, error?: string }> => {
      try {
        await fs.mkdir(dirPath, { recursive: true });
        logger.info(`Directory created successfully at path: ${dirPath}`);
        return { success: true };
      } catch (error) {
        logger.error("Error creating directory:", error)
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  private registerOpenFolderDialog(): void {
    this.deps.ipc.handle(`system:open-folder-dialog`, async () => {
      const mainWindow = this.deps.browserWindow.getFocusedWindow();
      
      if (!mainWindow) {
        logger.warn("Attempted to open folder dialog with no focused window.");
        return { canceled: true, filePaths: [] };
      }
      
      const result = await this.deps.dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory']
      });
      
      return result;
    });
  }

  /** The renderer asks once at startup; main.ts pushes every later change. */
  private registerFullScreenState(): void {
    this.deps.ipc.handle('system:is-full-screen', (event) =>
      this.deps.browserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
    );
  }

  /** Close Tab with no tab left closes the window, as in Safari. */
  private registerCloseWindow(): void {
    this.deps.ipc.on('system:close-window', (event) => {
      this.deps.browserWindow.fromWebContents(event.sender)?.close();
    });
  }

  private registerReportTheme(): void {
    this.deps.ipc.on('system:report-theme', (_event, report: unknown) => {
      if (!isThemeReport(report)) return;
      this.deps.onThemeChanged(report);
    });
  }
}