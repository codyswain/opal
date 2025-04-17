import logger from "@/main/logger";
import DatabaseManager from "../db";
import { NotFoundError, QueryExecutionError } from "../errors";
import { ItemWithAIMetadata } from "../types";

export async function getItems(): Promise<ItemWithAIMetadata[]> {
  const db = DatabaseManager.getInstance().getDatabase();
  if (!db) throw new Error("Database not initialized");

  try {
    const items = await db.prepare(`
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
    `).all() as (ItemWithAIMetadata)[];

    if (items.length === 0) {
      throw new NotFoundError("Items", "No items found");
    }

    return items;
  } catch (error: unknown){
    if (error instanceof NotFoundError){
      logger.error("Failed to retrieve items, no items found", error as Error);
      throw error;
    }

    logger.error("Failed to retrieve items, query execution error", error as Error);
    throw new QueryExecutionError("Failed to retrieve items", error as Error, "getItems");
  }
}

