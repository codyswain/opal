import DatabaseManager from "@/main/database/db";
import { Item, ItemWithAIMetadata } from "@/main/database/types";
import logger from "@/main/logger";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import {
  ConflictError,
  NotFoundError,
  QueryExecutionError,
} from "@/main/database/errors";

interface ItemRepositoryDependencies {
  dbManager: DatabaseManager;
}

/**
 * ItemRepository - Manages operations on the items table
 * 
 * This class provides methods to interact with the items table in the database.
 * It includes functionality for retrieving items, renaming items, and creating folders.
 * 
 * @class ItemRepository
 * @static
 */
export class ItemRepository {
  private static instance: ItemRepository;
  private deps: ItemRepositoryDependencies;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(deps: ItemRepositoryDependencies) {
    this.deps = deps;
  }

  /**
   * Retrieves all items from the items table
   * @returns An array of items with their AIMetadata
   */
  public async getItems(): Promise<ItemWithAIMetadata[]> {
    const db = this.deps.dbManager.getDatabase();
    if (!db) throw new Error("Database not initialized");

    try {
      const items = (await db
        .prepare(
          `
        SELECT 
          i.id, 
          i.type, 
          i.path, 
          i.parent_path, 
          i.name, 
          i.created_at, 
          i.updated_at, 
          i.size, 
          i.is_mounted, 
          i.real_path, 
          a.summary, 
          a.tags
        FROM items i
        LEFT JOIN ai_metadata a 
          ON i.id = a.item_id
      `
        )
        .all()) as ItemWithAIMetadata[];

      if (items.length === 0) {
        throw new NotFoundError("Items", "No items found");
      }

      return items;
    } catch (error: unknown) {
      if (error instanceof NotFoundError) {
        logger.error(
          "Failed to retrieve items, no items found",
          error as Error
        );
        throw error;
      }

      logger.error(
        "Failed to retrieve items, query execution error",
        error as Error
      );
      throw new QueryExecutionError(
        "Failed to retrieve items",
        error as Error,
        "getItems"
      );
    }
  }

  /**
   * Renames an item in the items table
   * @param itemId - The id of the item to rename
   * @param newName - The new name of the item
   * @returns The new path of the item
   */
  public async renameItem(
    itemId: string,
    newName: string
  ): Promise<{ newPath: string; }> {
    const db = this.deps.dbManager.getDatabase();
    if (!db) throw new Error("Database not initialized");

    try {
      // Get the item to check if it exists and get its parent path
      const getItemStmt = db.prepare(`
        SELECT id, parent_path, type, name
        FROM items
        WHERE id = ?
      `);
      const item = getItemStmt.get(itemId) as Item | undefined;

      if (!item) {
        logger.error(`Item not found for id: ${itemId}`);
        throw new NotFoundError("Item", `Item not found for id: ${itemId}`);
      }

      // Create new path, handling null parent_path for top-level items
      const parentDir = item.parent_path === null ? '/' : item.parent_path;
      const newPath = path.join(parentDir, newName);

      // Check if an item with the new path already exists
      const checkExistingStmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM items
        WHERE path = ?
      `);
      const existingCount = (
        checkExistingStmt.get(newPath) as { count: number }
      ).count;
      if (existingCount > 0) {
        logger.error(`An item already exists at path: ${newPath}`);
        throw new ConflictError(
          "Item",
          `An item already exists at path: ${newPath}`
        );
      }

      // Use a transaction to update the item and its children (if it's a folder)
      const transaction = db.transaction(() => {
        // Update the item's name and path
        const updateStmt = db.prepare(`
          UPDATE items
          SET name = ?, path = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        updateStmt.run(newName, newPath, itemId);

        // If it's a folder, update all child paths
        if (item.type === "folder") {
          const updateChildrenStmt = db.prepare(`
            UPDATE items
            SET path = replace(path, ?, ?), updated_at = CURRENT_TIMESTAMP
            WHERE path LIKE ? || '%' AND path != ?
          `);
          updateChildrenStmt.run(item.path, newPath, item.path, item.path);
        }
      });
      logger.info(`Renaming item from ${item.path} to ${newPath}`);
      transaction();
      // TODO: implement renaming for mounted folder
      return { newPath };
    } catch (error) {
      logger.error("Error renaming item:", error);
      throw error;
    }
  }

  /**
   * Creates a new folder in the items table
   * @param parentPath - The path of the parent folder
   * @param folderName - The name of the new folder
   * @returns The id and path of the new folder
   */
  public async createFolder(
    parentPath: string | null,
    folderName: string
  ): Promise<{ id: string; path: string }> {
    const db = this.deps.dbManager.getDatabase();
    if (!db) throw new Error("Database not initialized");

    let finalFolderName = folderName;
    let finalPath: string;
    let counter = 1;
    const isTopLevel = !parentPath || parentPath === "/";
    const actualParentPath = isTopLevel ? null : parentPath;

    // Function to check if a path exists
    const checkPathExists = (p: string) => {
      const stmt = db.prepare("SELECT 1 FROM items WHERE path = ?");
      return stmt.get(p) !== undefined;
    };

    // Determine initial path
    finalPath = isTopLevel
      ? `/${finalFolderName}`
      : path.join(parentPath, finalFolderName);

    // Loop to find a unique name if the initial one exists
    while (checkPathExists(finalPath)) {
      finalFolderName = `${folderName} ${counter}`;
      finalPath = isTopLevel
        ? `/${finalFolderName}`
        : path.join(parentPath, finalFolderName);
      counter++;
    }

    try {
      const id = uuidv4();
      logger.info(
        `Creating folder: name=${finalFolderName}, path=${finalPath}, parent=${actualParentPath}`
      );

      const stmt = db.prepare(`
        INSERT INTO items (id, type, path, parent_path, name)
        VALUES (?, 'folder', ?, ?, ?)
      `);
      stmt.run(id, finalPath, actualParentPath, finalFolderName);

      return { id, path: finalPath };
    } catch (error) {
      logger.error("Error creating folder during insert:", error);
      throw error;
    }
  }
}
