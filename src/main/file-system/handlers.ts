import { ipcMain, dialog, BrowserWindow } from "electron";
import * as fs from "fs-extra";

export async function registerFileSystemIPCHandlers(){

  // Uncomment the handler for create-directory
  ipcMain.handle("create-directory", async (_, dirPath: string) => {
    try {
      // fs.mkdir now correctly uses the imported fs/promises version
      await fs.mkdir(dirPath, { recursive: true });
      console.log(`Directory created successfully at path: ${dirPath}`); // Added logging
    } catch (error) {
      console.error("Error creating directory:", error);
      throw error;
    }
  });

  ipcMain.handle('dialog:openDirectory', async () => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    
    if (!mainWindow) {
      return { canceled: true };
    }
    
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    
    return result;
  });
}