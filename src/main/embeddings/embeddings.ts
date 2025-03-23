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

const TEXT_EMBEDDING_MODEL = "text-embedding-ada-002";

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
      // SQLite expects binary data for BLOB columns
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
    } catch (error) {
      console.error(`Error saving embedding to database for note ${noteId}:`, error);
      throw new Error(`Failed to save embedding: ${error.message}`);
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
    
    // Sort by score and get top results
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

      // Create embedding for the query
      const queryEmbedding = await this.embeddingCreator.createEmbedding(
        userMessage.content
      );

      // Find relevant notes
      const similarNotes = await this.similaritySearcher.performSimilaritySearch(
        queryEmbedding
      );

      // Prepare the context for the assistant
      let contextText = "";
      for (const note of similarNotes) {
        const truncatedContent = note.content.slice(0, 2000); // Limit content length
        contextText += `Note ID: ${note.id}\nTitle: ${note.title}\nContent:\n${truncatedContent}\n\n`;
      }

      // Construct the system prompt without undefined variables
      const systemPrompt = `You are a helpful assistant. Use the provided notes to answer the user's question. When you refer to a note, include a clickable link in the format [Note Title](note://noteId).`;

      // Build the messages for OpenAI API
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        { role: "assistant", content: `Here are some relevant notes:\n${contextText}` },
        ...(conversation as ChatCompletionMessageParam[]),
      ];
  
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4", // Corrected model name
        messages: messages,
      });
      const assistantMessage = completion.choices[0].message;
      const finishReason = completion.choices[0].finish_reason;

      if (finishReason === "content_filter") {
        console.error("Assistant's reply was blocked by content filter.");
        throw new Error("Assistant's reply was blocked due to content policy.");
      }

      return assistantMessage;
    } catch (error) {
      console.error("Error in RAG Chat:", error);
      throw error;
    }
  }
}