import {
  Note,
  FileNode,
  DirectoryStructures,
  Embedding,
  SimilarNote,
} from "@/renderer/shared/types";
import OpenAI from "openai";
import { parse } from "node-html-parser";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import DatabaseManager from "../database/db";
import { AIMetadata, Item } from "../database/types";
import log from 'electron-log';

const TEXT_EMBEDDING_MODEL = "text-embedding-ada-002";
const EMBEDDING_DIMENSION = 1536; // OpenAI's text-embedding-ada-002 dimension

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
    const root = parse(content);
    const textContent = root.textContent.trim();
    return `${note.title}\n\n${textContent}`;
  }

  async saveEmbeddingToDatabase(noteId: string, embedding: Embedding): Promise<void> {
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDatabase();
    
    if (!db) throw new Error("Database not initialized");
    
    try {
      // Check if embedding already exists for this note
      const existingStmt = db.prepare(`
        SELECT * FROM ai_metadata WHERE item_id = ?
      `);
      
      const existingMetadata = existingStmt.get(noteId) as AIMetadata | undefined;
      
      // Convert embedding to proper format for storage
      const embeddingJson = JSON.stringify(embedding);
      
      if (existingMetadata) {
        // Update existing record
        const updateStmt = db.prepare(`
          UPDATE ai_metadata
          SET embedding = ?
          WHERE item_id = ?
        `);
        updateStmt.run(embeddingJson, noteId);
      } else {
        // Insert new record
        const insertStmt = db.prepare(`
          INSERT INTO ai_metadata (item_id, embedding)
          VALUES (?, ?)
        `);
        insertStmt.run(noteId, embeddingJson);
      }
      
      // Update vector index if VSS is available
      this.updateVectorIndex(noteId, embedding);
      
    } catch (error) {
      console.error(`Error saving embedding to database for note ${noteId}:`, error);
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
      }
      
      // Insert into vector index
      // Convert the embedding array to a buffer using Float32Array
      const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);
      
      db.prepare(`
        INSERT INTO vector_index(embedding, item_id) VALUES (?, ?)
      `).run(vectorBuffer, noteId);
      
      log.info(`Updated vector index for note ${noteId}`);
      
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
    
    // Query all notes that have embeddings
    const stmt = db.prepare(`
      SELECT i.id, a.embedding 
      FROM items i
      JOIN ai_metadata a ON i.id = a.item_id
      WHERE i.type = 'note' AND a.embedding IS NOT NULL
    `);
    
    const rows = stmt.all() as { id: string, embedding: string }[];
    
    // Parse the embedding JSON from string
    return rows.map(row => ({
      id: row.id,
      embedding: JSON.parse(row.embedding) as Embedding
    }));
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
      const vssEnabled = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='vector_index'
      `).get();
      
      if (vssEnabled) {
        // Use VSS for similarity search
        return await this.performVSSSimilaritySearch(queryEmbedding, limit);
      } else {
        // Fall back to manual cosine similarity calculation
        return await this.performManualSimilaritySearch(queryEmbedding, limit);
      }
    } catch (error) {
      log.warn("Error checking for VSS availability:", error);
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
      // Query the VSS index for similar vectors
      const similarVectors = db.prepare(`
        SELECT item_id, distance 
        FROM vector_index 
        WHERE vss_search(embedding, ?) 
        LIMIT ?
      `).all(vectorBuffer, limit) as { item_id: string, distance: number }[];
      
      log.info(`VSS search returned ${similarVectors.length} similar notes`);
      
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
    
    // Calculate similarity scores
    const notesWithScores = notesWithEmbeddings.map(note => {
      const score = this.cosineSimilarity(
        queryEmbedding.data[0].embedding,
        note.embedding.data[0].embedding
      );
      return { id: note.id, score };
    });
    
    const topResults = notesWithScores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
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