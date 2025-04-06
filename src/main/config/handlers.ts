import { dialog, ipcMain } from "electron";


export async function registerConfigIPCHandlers(){
  ipcMain.handle("open-folder-dialog", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Select Folder",
      title: "Select a folder to add as a top-level folder",
    });
    return result.canceled? null: result.filePaths; // Concise return
  });
}