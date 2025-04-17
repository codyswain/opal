import { IpcMain, Dialog, BrowserWindow } from "electron";

import { SystemHandlers } from "./SystemHandlers"; 

export function registerSystemIPCHandlers(
  ipc: IpcMain,
  dialog: Dialog,
  browserWindow: typeof BrowserWindow
) {
  const systemHandlers = new SystemHandlers({
    ipc,
    dialog,
    browserWindow,
  });
  systemHandlers.registerAll();
}
