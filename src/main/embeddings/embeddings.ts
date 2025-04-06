import { 
  Note, 
  SimilarNote, 
  Embedding,
  // FileNode, // Unused
  // DirectoryStructures // Unused
} from '@/renderer/shared/types';
// eslint-disable-next-line import/no-named-as-default
import OpenAI from 'openai'; // Reverted to default import and disabled rule
// import SqliteVss from 'sqlite-vss'; // Unused
// import path from 'path'; // Unused
// import fs from 'fs/promises'; // Unused
import * as nodeHtmlParser from "node-html-parser"; // Import the whole module
import { ChatCompletionMessageParam } from "openai/resources/chat";
// Import electron-log using require to avoid default import issues
const log = require('electron-log');
import DatabaseManager from "../database/db";
// import { AIMetadata, Item } from "../database/types"; // Unused

const TEXT_EMBEDDING_MODEL = "text-embedding-ada-002";
// const EMBEDDING_DIMENSION = 1536; // Unused

export class EmbeddingCreator {
  private openai: OpenAI;

  constructor(openai: OpenAI) {
    this.openai = openai;
  }

  async createEmbedding(content: string): Promise<Embedding> {
    return await this.openai.embeddings.create({
      model: TEXT_EMBEDDING_MODEL,
      input: content,
    });
  }

  async parseNoteForEmbedding(note: Note): Promise<string> {
    // Handle case where content might be undefined
    const content = note.content || '';
    const root = nodeHtmlParser.parse(content);
    const textContent = root.textContent.trim();
    return `${note.title}\n\n${textContent}`;
  }

  async saveEmbeddingToDatabase(noteId: string, embedding: Embedding): Promise<void> {
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDatabase();
    
    if (!db) throw new Error("Database not initialized");
    
    try {
      // Try a different approach completely - use a backup table
      log.info(`Attempting to save embedding for note ${noteId} with alternative method`);
      
      // First make sure our backup table exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS embeddings_backup (
          item_id TEXT PRIMARY KEY,
          embedding_data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Convert embedding to proper format for storage - base64 encode to avoid any data type issues
      const embeddingJson = JSON.stringify(embedding);
      const embeddingBase64 = Buffer.from(embeddingJson).toString('base64');
      log.info(`Embedding encoded to base64, length: ${embeddingBase64.length}`);
      
      // First store in our backup table
      db.prepare(`
        INSERT OR REPLACE INTO embeddings_backup (item_id, embedding_data)
        VALUES (?, ?)
      `).run(noteId, embeddingBase64);
      
      log.info(`Successfully saved embedding to backup table for note ${noteId}`);
      
      try {
        // Try saving to the main table too
        db.prepare(`
          DELETE FROM ai_metadata WHERE item_id = ?
        `).run(noteId);
        
        db.prepare(`
          INSERT INTO ai_metadata (item_id, embedding)
          VALUES (?, ?)
        `).run(noteId, embeddingBase64);
        
        log.info(`Successfully saved embedding to main table for note ${noteId}`);
      } catch (mainTableError) {
        log.warn(`Could not save to main table, will use backup: ${mainTableError.message}`);
      }
      
      // Update vector index if VSS is available
      await this.updateVectorIndex(noteId, embedding);
      
    } catch (error) {
      log.error(`Error saving embedding to database for note ${noteId}:`, error);
      throw new Error(`Failed to save embedding: ${error.message}`);
    }
  }
  
  private async updateVectorIndex(noteId: string, embedding: Embedding): Promise<void> {
    try {
      const dbManager = DatabaseManager.getInstance();
      const db = dbManager.getDatabase();
      
      if (!db) throw new Error("Database not initialized");
      
      // Check if vector_index table exists (will exist if VSS extension is loaded)
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='vector_index'
      `).get();
      
      if (!tableExists) {
        // VSS extension probably not loaded, silently return
        log.warn("Vector index table doesn't exist, can't update vector");
        return;
      }
      
      // Get the embedding vector
      const vector = embedding.data[0].embedding;
      
      // Check if the item already exists in the vector index
      const existingVectorItem = db.prepare(`
        SELECT item_id FROM vector_index WHERE item_id = ?
      `).get(noteId);
      
      if (existingVectorItem) {
        // Delete the existing vector first
        db.prepare(`
          DELETE FROM vector_index WHERE item_id = ?
        `).run(noteId);
        log.info(`Deleted existing vector index entry for note ${noteId}`);
      }
      
      try {
        // Insert into vector index
        // Convert the embedding array to a buffer using Float32Array
        const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);
        
        db.prepare(`
          INSERT INTO vector_index(embedding, item_id) VALUES (?, ?)
        `).run(vectorBuffer, noteId);
        
        log.info(`Updated vector index for note ${noteId}`);
      } catch (vssError) {
        log.warn(`Could not insert into VSS index: ${vssError.message}`);
      }
      
    } catch (error) {
      // Don't throw the error - if VSS isn't available, this is expected to fail
      log.warn(`VSS integration: Could not update vector index for note ${noteId}:`, error);
    }
  }
}

export class SimilaritySearcher {
  async findNotesWithEmbeddings(): Promise<{ id: string, embedding: Embedding }[]> {
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDatabase();
    
    if (!db) throw new Error("Database not initialized");
    
    // Try to get embeddings from the main table first
    const mainTableStmt = db.prepare(`
      SELECT i.id, a.embedding 
      FROM items i
      JOIN ai_metadata a ON i.id = a.item_id
      WHERE i.type = 'note' AND a.embedding IS NOT NULL
    `);
    
    const mainRows = mainTableStmt.all() as { id: string, embedding: string }[];
    log.info(`Found ${mainRows.length} notes with embeddings in main table.`);
    
    // If we found embeddings in the main table, use those
    if (mainRows.length > 0) {
      // Parse the embedding JSON from string
      return mainRows.map(row => {
        try {
          // Check if the embedding is base64 encoded
          if (row.embedding.startsWith('eyJvYmplY3QiOiJs')) {
            // This looks like base64, try to decode it
            const jsonStr = Buffer.from(row.embedding, 'base64').toString();
            return {
              id: row.id,
              embedding: JSON.parse(jsonStr) as Embedding
            };
          } else {
            // Regular JSON string
            return {
              id: row.id,
              embedding: JSON.parse(row.embedding) as Embedding
            };
          }
        } catch (error) {
          log.error(`Error parsing embedding for note ${row.id}:`, error);
          throw error;
        }
      });
    }
    
    // If we didn't find any in the main table, check our backup table
    log.info(`No embeddings found in main table, checking backup table`);
    
    // Check if backup table exists
    const backupTableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='embeddings_backup'
    `).get();
    
    if (!backupTableExists) {
      log.warn("No backup table found either, no embeddings available");
      return [];
    }
    
    // Query the backup table
    const backupStmt = db.prepare(`
      SELECT e.item_id as id, e.embedding_data as embedding 
      FROM embeddings_backup e
      JOIN items i ON e.item_id = i.id
      WHERE i.type = 'note'
    `);
    
    const backupRows = backupStmt.all() as { id: string, embedding: string }[];
    log.info(`Found ${backupRows.length} notes with embeddings in backup table.`);
    
    // Parse the embedding JSON from the backup table
    return backupRows.map(row => {
      try {
        // The data in backup is always base64 encoded
        const jsonStr = Buffer.from(row.embedding, 'base64').toString();
        return {
          id: row.id,
          embedding: JSON.parse(jsonStr) as Embedding
        };
      } catch (error) {
        log.error(`Error parsing embedding from backup for note ${row.id}:`, error);
        throw error;
      }
    });
  }

  async performSimilaritySearch(
    queryEmbedding: OpenAI.Embeddings.CreateEmbeddingResponse,
    limit = 10
  ): Promise<SimilarNote[]> {
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDatabase();
    
    if (!db) throw new Error("Database not initialized");
    
    try {
      // Check if vector_index exists (which means VSS is loaded)
      log.info("Checking if vector_index table exists...");
      const vssEnabled = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='vector_index'
      `).get();
      
      if (vssEnabled) {
        log.info("Vector search table found, using VSS for similarity search");
        // Use VSS for similarity search
        return await this.performVSSSimilaritySearch(queryEmbedding, limit);
      } else {
        log.info("Vector search table not found, falling back to manual cosine similarity");
        // Fall back to manual cosine similarity calculation
        return await this.performManualSimilaritySearch(queryEmbedding, limit);
      }
    } catch (error) {
      log.error("Error checking for VSS availability:", error);
      // Fall back to manual cosine similarity
      return await this.performManualSimilaritySearch(queryEmbedding, limit);
    }
  }
  
  // The VSS-based implementation that uses the SQLite extension
  async performVSSSimilaritySearch(
    queryEmbedding: OpenAI.Embeddings.CreateEmbeddingResponse,
    limit = 10
  ): Promise<SimilarNote[]> {
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDatabase();
    
    if (!db) throw new Error("Database not initialized");
    
    // Convert the embedding array to a buffer for the VSS query
    const vector = queryEmbedding.data[0].embedding;
    const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);
    
    try {
      // First, make sure we have embeddings in the vector_index table
      const countVectors = db.prepare(`
        SELECT COUNT(*) as count FROM vector_index
      `).get() as { count: number };
      
      log.info(`Vector index contains ${countVectors.count} embeddings`);
      
      if (countVectors.count === 0) {
        log.warn("Vector index is empty, migrating embeddings");
        
        // First check if we have a backup table
        const backupTableExists = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='embeddings_backup'
        `).get();
        
        // If we have a backup table, restore embeddings from there first
        if (backupTableExists) {
          log.info("Found backup table, trying to restore embeddings from there");
          
          // Get all embeddings from the backup table
          const backupRows = db.prepare(`
            SELECT item_id, embedding_data 
            FROM embeddings_backup
          `).all() as { item_id: string, embedding_data: string }[];
          
          log.info(`Found ${backupRows.length} embeddings in backup table`);
          
          if (backupRows.length > 0) {
            let successCount = 0;
            
            // Process each embedding
            for (const row of backupRows) {
              try {
                // Decode the base64 embedding
                const jsonStr = Buffer.from(row.embedding_data, 'base64').toString();
                const embedding = JSON.parse(jsonStr) as Embedding;
                
                // Get the embedding vector
                const vector = embedding.data[0].embedding;
                
                // Convert the vector to a buffer and insert into the VSS index
                const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);
                
                db.prepare(`
                  INSERT INTO vector_index(embedding, item_id) VALUES (?, ?)
                `).run(vectorBuffer, row.item_id);
                
                // Also restore to the main table if missing
                const existsInMain = db.prepare(`
                  SELECT item_id FROM ai_metadata WHERE item_id = ?
                `).get(row.item_id);
                
                if (!existsInMain) {
                  db.prepare(`
                    INSERT INTO ai_metadata (item_id, embedding) VALUES (?, ?)
                  `).run(row.item_id, row.embedding_data);
                }
                
                successCount++;
              } catch (error) {
                log.warn(`Error restoring embedding for item ${row.item_id}:`, error);
              }
            }
            
            log.info(`Successfully restored ${successCount} of ${backupRows.length} embeddings from backup`);
          }
        }
        
        // Get all notes with embeddings from main table as fallback
        const notesWithEmbeddings = await this.findNotesWithEmbeddings();
        
        log.info(`Found ${notesWithEmbeddings.length} notes with embeddings to add to vector index`);
        
        // If we still don't have any embeddings, we can't continue
        if (notesWithEmbeddings.length === 0) {
          log.warn("No embeddings found in either main or backup table, cannot perform similarity search");
          return [];
        }
        
        // Insert each embedding into the VSS index
        for (const note of notesWithEmbeddings) {
          try {
            // Get the embedding vector
            const vector = note.embedding.data[0].embedding;
            
            // Convert the vector to a buffer
            const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);
            
            // Insert into the VSS index
            db.prepare(`
              INSERT INTO vector_index(embedding, item_id) VALUES (?, ?)
            `).run(vectorBuffer, note.id);
          } catch (error) {
            log.warn(`Error adding embedding for note ${note.id} to vector index:`, error);
          }
        }
        
        // Re-check the count
        const updatedCount = db.prepare(`
          SELECT COUNT(*) as count FROM vector_index
        `).get() as { count: number };
        
        log.info(`Vector index now contains ${updatedCount.count} embeddings`);
        
        if (updatedCount.count === 0) {
          log.warn("Still no embeddings in vector index, falling back to manual method");
          return this.performManualSimilaritySearch(queryEmbedding, limit);
        }
      }
      
      // Query the VSS index for similar vectors
      log.info("Performing VSS search with query embedding");
      const similarVectors = db.prepare(`
        SELECT item_id, distance 
        FROM vector_index 
        WHERE vss_search(embedding, ?) 
        LIMIT ?
      `).all(vectorBuffer, limit) as { item_id: string, distance: number }[];
      
      log.info(`VSS search returned ${similarVectors.length} similar notes`);
      
      if (similarVectors.length === 0) {
        log.warn("VSS search returned no results, falling back to manual method");
        return this.performManualSimilaritySearch(queryEmbedding, limit);
      }
   
      // Fetch complete note details for the similar vectors
      const results: SimilarNote[] = [];
      
      for (const vector of similarVectors) {
        // Convert VSS distance to cosine similarity score (distance → similarity)
        // VSS returns cosine distance (1 - cosine similarity)
        const score = 1 - vector.distance;
        
        // Get note details
        const noteStmt = db.prepare(`
          SELECT i.id, i.name as title, n.content
          FROM items i
          JOIN notes n ON i.id = n.item_id
          WHERE i.id = ?
        `);
        
        const note = noteStmt.get(vector.item_id) as SimilarNote;
        
        if (note) {
          results.push({
            ...note,
            score
          });
        }
      }
      
      return results;
    } catch (error) {
      log.error("Error in VSS similarity search:", error);
      // Fall back to manual cosine similarity
      return this.performManualSimilaritySearch(queryEmbedding, limit);
    }
  }
  
  // The original implementation as fallback
  async performManualSimilaritySearch(
    queryEmbedding: OpenAI.Embeddings.CreateEmbeddingResponse,
    limit = 10
  ): Promise<SimilarNote[]> {
    log.info("Using manual cosine similarity calculation as fallback");
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDatabase();
    
    if (!db) throw new Error("Database not initialized");
    
    // Get all notes with embeddings
    const notesWithEmbeddings = await this.findNotesWithEmbeddings();
    
    log.info(`Found ${notesWithEmbeddings.length} notes with embeddings for manual similarity calculation`);
    
    if (notesWithEmbeddings.length === 0) {
      log.warn("No notes with embeddings found for similarity search");
      return [];
    }
    
    // Calculate similarity scores
    const notesWithScores = notesWithEmbeddings.map(note => {
      try {
        const score = this.cosineSimilarity(
          queryEmbedding.data[0].embedding,
          note.embedding.data[0].embedding
        );
        return { id: note.id, score };
      } catch (error) {
        log.warn(`Error calculating similarity for note ${note.id}:`, error);
        return { id: note.id, score: 0 }; // Default to 0 score on error
      }
    });
    
    // Sort by score and limit results
    const topResults = notesWithScores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    log.info(`Top ${topResults.length} similar notes have scores ranging from ${topResults[0]?.score || 0} to ${topResults[topResults.length-1]?.score || 0}`);
    
    // Fetch complete note details for the top results
    const results: SimilarNote[] = [];
    
    for (const result of topResults) {
      // Get note details
      const noteStmt = db.prepare(`
        SELECT i.id, i.name as title, n.content
        FROM items i
        JOIN notes n ON i.id = n.item_id
        WHERE i.id = ?
      `);
      
      const note = noteStmt.get(result.id) as SimilarNote;
      
      if (note) {
        results.push({
          ...note,
          score: result.score
        });
      }
    }
    
    return results;
  }

  cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, _, i) => sum + a[i] * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }
}

export class RAGChat {
  private openai: OpenAI;
  private embeddingCreator: EmbeddingCreator;
  private similaritySearcher: SimilaritySearcher;

  constructor(
    openai: OpenAI,
    embeddingCreator: EmbeddingCreator,
    similaritySearcher: SimilaritySearcher
  ) {
    this.openai = openai;
    this.embeddingCreator = embeddingCreator;
    this.similaritySearcher = similaritySearcher;
  }

  async performRAGChat(
    conversation: { role: string; content: string }[]
  ): Promise<{ role: string; content: string }> {
    try {
      // Get the last user message
      const userMessage = conversation.filter((msg) => msg.role === "user").pop();
      
      if (!userMessage) throw new Error("No user message found in conversation");
      
      // Generate embedding for the user query
      const queryEmbedding = await this.embeddingCreator.createEmbedding(userMessage.content);
      
      // Get similar notes as context
      const similarNotes = await this.similaritySearcher.performSimilaritySearch(queryEmbedding, 5);
      
      // Format the notes as context
      const context = similarNotes.map(note => 
        `Note Title: ${note.title}\n\nContent: ${note.content.substring(0, 300)}${note.content.length > 300 ? '...' : ''}\n\n`
      ).join('---\n\n');
      
      // Prepare system message with context
      const systemMessage: ChatCompletionMessageParam = {
        role: "system",
        content: `You are a helpful assistant that answers questions based on the user's notes. 
                  Use the following notes as context to answer the user's query, but don't explicitly 
                  mention that you're using their notes unless it's necessary for the answer.
                  
                  Context from notes:
                  ${context}`
      };
      
      // Ensure proper typing for the conversations
      const recentMessages = conversation.slice(-5).map(msg => {
        return {
          role: msg.role === "user" || msg.role === "assistant" || msg.role === "system" 
            ? msg.role 
            : "user",  // Default to user if invalid role
          content: msg.content
        } as ChatCompletionMessageParam;
      });
      
      // Prepare messages for the chat completion
      const messages = [
        systemMessage,
        ...recentMessages
      ];
      
      // Generate completion
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo", // You can adjust the model
        messages,
        temperature: 0.7,
      });
      
      return {
        role: "assistant",
        content: completion.choices[0].message.content || "I don't have an answer for that."
      };
    } catch (error) {
      console.error("Error in RAG chat:", error);
      return {
        role: "assistant",
        content: "I encountered an error while processing your request. Please try again later."
      };
    }
  }
}