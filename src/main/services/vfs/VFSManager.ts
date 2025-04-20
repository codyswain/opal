import { transformFileSystemData } from "@/main/database/transforms";
import logger from "@/main/logger";
import { FSEntry } from "@/types";
import type { ItemRepository } from "@/main/database/repositories/itemRepository";

interface VFSManagerDependencies {
  itemRepository: ItemRepository;
}

/**
 * Manages the Virtual File System (VFS)
 */
export class VFSManager {
  private static instance: VFSManager;
  private deps: VFSManagerDependencies;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(deps: VFSManagerDependencies) {
    this.deps = deps;
  }

  /**
   * Gets all items from the Virtual File System (VFS)
   * @returns A record of all items in the VFS
   */
  public async getItems(): Promise<Record<string, FSEntry>> {
    try {
      const items = await this.deps.itemRepository.getItems();
      const transformedItems = transformFileSystemData(items);
      return transformedItems;
    } catch (error) {
      logger.error("Error getting items from VFS:", error);
      throw error;
    }
  }

  /**
   * Creates a new folder in the VFS
   * @param parentPath - The path of the parent folder
   * @param folderName - The name of the new folder
   * @returns The new folder's ID and path
   */
  public async createFolder(parentPath: string | null, folderName: string): Promise<{id: string, path: string}> {
    try {
      return await this.deps.itemRepository.createFolder(parentPath, folderName);
    } catch (error) {
      logger.error("Error creating folder:", error);
      throw error;
    }
  }

  /**
   * Rename a folder in the VFS
   * @param folderPath - The path of the folder to rename
   * @param newName - The new name of the folder
   * @returns The new path of the folder
   */
  public async renameFolder(folderId: string, newName: string): Promise<string> {
    try {
      const { newPath } = await this.deps.itemRepository.renameItem(folderId, newName);
      return newPath;
    } catch (error) {
      logger.error("Error renaming folder:", error);
      throw error;
    }
  }

  /**
   * Rename a note in the VFS
   * @param notePath - The path of the note to rename
   * @param newName - The new name of the note
   * @returns The new path of the note
   */
  public async renameNote(noteId: string, newName: string): Promise<string> {
    try {
      const { newPath } = await this.deps.itemRepository.renameItem(noteId, newName);
      return newPath;
    } catch (error) {
      logger.error("Error renaming note:", error);
      throw error;
    }
  }
}
