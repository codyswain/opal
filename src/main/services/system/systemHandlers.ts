import logger from "@/main/logger";
import { IpcMain, Dialog, BrowserWindow } from "electron";
import * as fs from "fs-extra";

interface SystemHandlerDependencies {
  ipc: IpcMain;
  dialog: Dialog;
  browserWindow: typeof BrowserWindow;
}

export class SystemHandlers {
  private deps: SystemHandlerDependencies;

  constructor(deps: SystemHandlerDependencies) {
    this.deps = deps;
  }

  registerAll(): void {
    this.registerCreateDirectoryOnDisk();
    this.registerOpenFolderDialog();
    this.registerMinimizeWindow();
    this.registerMaximizeWindow();
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

  private registerMinimizeWindow(): void {
    this.deps.ipc.on("system:minimize-window", () => {
      const window = this.deps.browserWindow.getFocusedWindow();
      window?.minimize();
    });
  }

  private registerMaximizeWindow(): void {
    this.deps.ipc.on("system:maximize-window", () => {
      const window = this.deps.browserWindow.getFocusedWindow();
      if (window) {
        window.isMaximized() ? window.unmaximize() : window.maximize();
      }
    });
  }

  private registerCloseWindow(): void {
    this.deps.ipc.on("system:close-window", () => {
      const window = this.deps.browserWindow.getFocusedWindow();
      window?.close();
    });
  }
}
