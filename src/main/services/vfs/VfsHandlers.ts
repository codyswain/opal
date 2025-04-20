import { FSEntry } from "@/types";
import { IpcMain } from "electron";
import { VFSManager } from "@/main/services/vfs/VfsManager";
import { IPCResponse } from "@/types/ipc";
import logger from "@/main/logger";

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
    this.registerDeleteFolder();
    this.registerDeleteNote();
  }

  private registerGetItems(): void {
    this.deps.ipc.handle(
      `vfs:get-items`,
      async (): Promise<IPCResponse<Record<string, FSEntry>>> => {
        try {
          const items = await this.deps.vfsManager.getItems();
          return { success: true, data: items };
        } catch (error) {
          logger.error("Error getting items:", error);
          return { success: false, error: "Failed to get items" };
        }
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
        try {
          const result = await this.deps.vfsManager.createFolder(
            parentPath,
            folderName
          );
          return { success: true, data: result };
        } catch (error) {
          logger.error("Error creating folder:", error);
          return { success: false, error: "Failed to create folder" };
        }
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
        try {
          const newPath = await this.deps.vfsManager.renameFolder(
            folderId,
            newName
          );
          return { success: true, data: { newPath } };
        } catch (error) {
          logger.error("Error renaming folder:", error);
          return { success: false, error: "Failed to rename folder" };
        }
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
        try {
          const newPath = await this.deps.vfsManager.renameNote(
            noteId,
            newName
          );
          return { success: true, data: { newPath } };
        } catch (error) {
          logger.error("Error renaming note:", error);
          return { success: false, error: "Failed to rename note" };
        }
      }
    );
  }

  private registerDeleteFolder(): void {
    this.deps.ipc.handle(
      `vfs:delete-folder`,
      async (_, folderId: string): Promise<IPCResponse> => {
        try {
          await this.deps.vfsManager.deleteFolder(folderId);
          return { success: true };
        } catch (error) {
          logger.error("Error deleting folder:", error);
          return { success: false, error: "Failed to delete folder" };
        }
      }
    );
  }

  private registerDeleteNote(): void {
    this.deps.ipc.handle(
      `vfs:delete-note`,
      async (_, noteId: string): Promise<IPCResponse> => {
        try {
          await this.deps.vfsManager.deleteNote(noteId);
          return { success: true };
        } catch (error) {
          logger.error("Error deleting note:", error);
          return { success: false, error: "Failed to delete note" };
        }
      }
    );
  }
}
