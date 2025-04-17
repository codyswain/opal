import { IpcMain } from "electron";
import { VFSHandlers } from "./VfsHandlers";
import DatabaseManager from "@/main/database/db";

export function registerVFSIPCHandlers(ipc: IpcMain, dbManager: DatabaseManager) {
  const vfsHandlers = new VFSHandlers({
    ipc,
    dbManager,
  });
  vfsHandlers.registerAll();
}