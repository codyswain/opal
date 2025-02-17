import { dialog, ipcMain } from "electron";

import { addTopLevelFolder, removeTopLevelFolder, getTopLevelFolders } from "./manager";

export async function registerConfigIPCHandlers(){
  ipcMain.handle("get-top-level-folders", async () => getTopLevelFolders());
  
  ipcMain.handle("add-top-level-folder", async (_, folderPath) => {
    await addTopLevelFolder(folderPath);
    return getTopLevelFolders();
  });

  ipcMain.handle("remove-top-level-folder", async (_, folderPath) => {
    await removeTopLevelFolder(folderPath);
    return getTopLevelFolders();
  });

  ipcMain.handle("open-folder-dialog", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Select Folder",
      title: "Select a folder to add as a top-level folder",
    });
    return result.canceled? null: result.filePaths; // Concise return
  });
}