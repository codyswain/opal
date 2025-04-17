import DatabaseManager from "@/main/database/db";
import { getItems } from "@/main/database/repositories/itemRepository";
import { transformFileSystemData } from "@/main/database/transforms";
import logger from "@/main/logger";
import { FSEntry } from "@/types";
import { IpcMain } from "electron";

interface VFSHandlerDependencies {
  ipc: IpcMain;
  dbManager: DatabaseManager;
}

export class VFSHandlers {
  private deps: VFSHandlerDependencies;

  constructor(deps: VFSHandlerDependencies) {
    this.deps = deps;
  }

  registerAll(): void {
    this.registerGetItems();
  }

  private registerGetItems(): void {
    this.deps.ipc.handle(`vfs:get-items`, async (): Promise<{ success: boolean, items: Record<string, FSEntry> }> => {
      try {
        const items = await getItems();
        const transformedItems = transformFileSystemData(items);
        return { success: true, items: transformedItems };
      } catch (error) {
        logger.error("Error getting items:", error);
        return { success: false, items: {} };
      }
    });
  }
}
