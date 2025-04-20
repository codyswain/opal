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
 * It includes functionality for retrieving items, renaming items, and deleting them.
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

  public async deleteItem(itemId: string): Promise<void> {
    const db = this.deps.dbManager.getDatabase();
    if (!db) throw new Error("Database not initialized");

    try {
      // Start transaction
      const transaction = db.transaction(() => {
        // 1. Find the item itself and all its descendants using path prefix
        // We need both the original item and descendants for deletion.
        const getRootItemStmt = db.prepare("SELECT id, path FROM items WHERE id = ?");
        const rootItem = getRootItemStmt.get(itemId) as { id: string; path: string } | undefined;

        if (!rootItem) {
          logger.warn(`Item not found for deletion with id: ${itemId}`);
          // Optionally throw if the root item absolutely must exist
          // throw new NotFoundError("Item", `Item not found for id: ${itemId}`);
          return; // Nothing to delete if root item doesn't exist
        }

        const getDescendantsStmt = db.prepare(
          "SELECT id, path FROM items WHERE path LIKE ? || '/%' AND id != ?"
        );
        const descendants = getDescendantsStmt.all(rootItem.path, rootItem.id) as { id: string; path: string }[];

        // Combine root item and descendants
        const itemsToDelete = [rootItem, ...descendants];

        if (itemsToDelete.length === 0) {
           // Should not happen if rootItem was found, but defensive check
           logger.warn(`No items identified for deletion with root id: ${itemId}`);
           return; // Nothing to delete
        }

        const itemIdsToDelete = itemsToDelete.map((item) => item.id);
        logger.info(`Identified ${itemIdsToDelete.length} items (including descendants) for deletion starting with root id: ${itemId}`);

        // Helper to delete from related tables
        const deleteRelated = (tableName: string, columnName: string) => {
          if (itemIdsToDelete.length === 0) return; // Nothing to delete
          // Limit the number of parameters per statement if necessary (e.g., SQLite limit is often 999 or 32766)
          const BATCH_SIZE = 900; // Example batch size, adjust if needed
          for (let i = 0; i < itemIdsToDelete.length; i += BATCH_SIZE) {
            const batchIds = itemIdsToDelete.slice(i, i + BATCH_SIZE);
            if (batchIds.length === 0) continue;
            const placeholders = batchIds.map(() => "?").join(",");
            const deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE ${columnName} IN (${placeholders})`);
            const result = deleteStmt.run(...batchIds); // Use spread operator
            logger.info(`Deleted ${result.changes} rows from ${tableName} (batch ${i / BATCH_SIZE + 1}) for deletion rooted at item id: ${itemId}`);
          }
        };

        // 2. Delete related data from other tables for ALL items first
        deleteRelated("ai_metadata", "item_id");
        deleteRelated("embedded_items", "embedded_item_id");
        deleteRelated("embeddings_backup", "item_id");
        deleteRelated("notes", "item_id");
        deleteRelated("mounted_folders", "virtual_item_id");
        // Add any other tables that have a foreign key to items.id here

        // Helper function to count slashes (depth)
        const getPathDepth = (p: string | null | undefined): number => {
          if (!p) return 0; // Handle null/undefined paths (e.g., root)
          return (p.match(/\//g) || []).length;
        };

        // 3. Sort items by path depth (descending) using slash count
        itemsToDelete.sort((a, b) => getPathDepth(b.path) - getPathDepth(a.path));

        // 4. Delete items from the 'items' table in the sorted order
        const deleteItemStmt = db.prepare("DELETE FROM items WHERE id = ?");
        let deletedItemsCount = 0;
        for (const item of itemsToDelete) {
          const result = deleteItemStmt.run(item.id);
          deletedItemsCount += result.changes;
        }
        logger.info(`Deleted ${deletedItemsCount} rows from items table for deletion rooted at item id: ${itemId}`);

        if (deletedItemsCount !== itemsToDelete.length) {
            logger.warn(`Expected to delete ${itemsToDelete.length} items but only deleted ${deletedItemsCount}. This might indicate concurrent modifications.`);
        }

      }); // End transaction definition

      // Execute transaction
      transaction();

      logger.info(`Successfully deleted item and descendants for id: ${itemId}`);

    } catch (error: unknown) {
      // Keep specific error checks if needed, otherwise generalize
       if (error instanceof NotFoundError) {
         // This might occur if the initial getRootItemStmt fails, though we handle the 'undefined' case
         logger.error(`NotFoundError during delete operation for item id ${itemId}:`, error);
         throw error;
       }
      logger.error(`Error deleting item with id ${itemId}:`, error as Error);
      throw new QueryExecutionError(
        `Failed to delete item with id ${itemId}`,
        error as Error,
        "deleteItem"
      );
    }
  }
}