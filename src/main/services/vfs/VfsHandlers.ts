import { FSEntry } from "@/types";
import { IpcMain } from "electron";
import { VFSManager } from "@/main/services/vfs/VFSManager";
import { IPCResponse } from "@/types/ipc";

interface VFSHandlerDependencies {
  ipc: IpcMain;
  vfsManager: VFSManager;
}

export class VFSHandlers {
  private deps: VFSHandlerDependencies;

  constructor(deps: VFSHandlerDependencies) {
    this.deps = deps;
  }

  registerAll(): void {
    this.registerGetItems();
    this.registerCreateFolder();
    this.registerRenameFolder();
    this.registerRenameNote();
  }

  private registerGetItems(): void {
    this.deps.ipc.handle(
      `vfs:get-items`,
      async (): Promise<IPCResponse<Record<string, FSEntry>>> => {
        const items = await this.deps.vfsManager.getItems();
        return { success: true, data: items };
      }
    );
  }

  private registerCreateFolder(): void {
    this.deps.ipc.handle(
      `vfs:create-folder`,
      async (
        _,
        parentPath: string | null,
        folderName: string
      ): Promise<IPCResponse<{ id: string; path: string }>> => {
        const result = await this.deps.vfsManager.createFolder(
          parentPath,
          folderName
        );
        return { success: true, data: result };
      }
    );
  }

  private registerRenameFolder(): void {
    this.deps.ipc.handle(
      `vfs:rename-folder`,
      async (
        _,
        folderId: string,
        newName: string
      ): Promise<IPCResponse<{ newPath: string }>> => {
        const newPath = await this.deps.vfsManager.renameFolder(
          folderId,
          newName
        );
        return { success: true, data: { newPath } };
      }
    );
  }

  private registerRenameNote(): void {
    this.deps.ipc.handle(
      `vfs:rename-note`,
      async (
        _,
        noteId: string,
        newName: string
      ): Promise<IPCResponse<{ newPath: string }>> => {
        const newPath = await this.deps.vfsManager.renameNote(
          noteId,
          newName
        );
        return { success: true, data: { newPath } };
      }
    );
  }
}
