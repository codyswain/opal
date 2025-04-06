import {
  Note,
  SimilarNote,
} from "@/renderer/shared/types";
import { ipcMain } from "electron";
import OpenAIApi from "openai";
import log from 'electron-log';
import DatabaseManager from "../database/db";
import { getOpenAIKey } from "../file-system/loader";
import { EmbeddingCreator, RAGChat, SimilaritySearcher } from "./embeddings";

let embeddingCreator: EmbeddingCreator;
let similaritySearcher: SimilaritySearcher;
let ragChat: RAGChat;
let openaiApiKey: string;

export async function registerEmbeddingIPCHandlers(){
  try {
    // Get OpenAI key
    openaiApiKey = await getOpenAIKey();
    
    if (!openaiApiKey) {
      log.warn("No OpenAI API key found. Embedding functionality will not work.");
      return;
    }
    
    log.info("Initializing OpenAI with API key");
    // Create OpenAI instance with the key
    const openaiClient = new OpenAIApi({ apiKey: openaiApiKey });
    
    // Initialize embedding classes
    embeddingCreator = new EmbeddingCreator(openaiClient);
    similaritySearcher = new SimilaritySearcher();
    ragChat = new RAGChat(openaiClient, embeddingCreator, similaritySearcher);
    
    log.info("Embedding handlers initialized successfully");

    // Register handlers
    registerIPCHandlers();
  } catch (error) {
    log.error("Failed to initialize embedding handlers:", error);
  }
}

function registerIPCHandlers() {
  ipcMain.handle(
    "generate-note-embeddings",
    async (_, noteId: string, note: Note): Promise<void> => {
      try {
        if (!embeddingCreator) {
          throw new Error("Embedding creator not initialized");
        }
        
        const parsedContent = await embeddingCreator.parseNoteForEmbedding(note);
        const embedding = await embeddingCreator.createEmbedding(parsedContent);
        await embeddingCreator.saveEmbeddingToDatabase(noteId, embedding);
      } catch (error) {
        log.error("Error generating note embeddings:", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "perform-similarity-search",
    async (
      _,
      query: string
    ): Promise<SimilarNote[]> => {
      try {
        if (!embeddingCreator || !similaritySearcher) {
          log.warn("Embedding services not initialized, try initializing now");
          
          // Try to initialize if not done yet
          try {
            if (!openaiApiKey) {
              openaiApiKey = await getOpenAIKey();
            }
            
            if (!openaiApiKey) {
              log.error("No OpenAI API key found. Cannot perform similarity search.");
              throw new Error("OpenAI API key is required for similarity search");
            }
            
            const openaiClient = new OpenAIApi({ apiKey: openaiApiKey });
            embeddingCreator = new EmbeddingCreator(openaiClient);
            similaritySearcher = new SimilaritySearcher();
            log.info("Embedding services initialized on demand");
          } catch (initError) {
            log.error("Failed to initialize embedding services:", initError);
            throw initError;
          }
        }
        
        log.info(`Performing similarity search for query of length ${query.length}`);
        const queryEmbedding = await embeddingCreator.createEmbedding(query);
        log.info(`Created query embedding, vector length: ${queryEmbedding.data[0].embedding.length}`);
        
        const similarNotes = await similaritySearcher.performSimilaritySearch(
          queryEmbedding
        );
        
        log.info(`Similarity search returned ${similarNotes.length} similar notes`);
        return similarNotes;
      } catch (error) {
        log.error("Error performing similarity search:", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "perform-rag-chat",
    async (
      _,
      conversation: { role: string; content: string }[]
    ): Promise<{ role: string; content: string }> => {
      try {
        if (!ragChat) {
          throw new Error("RAG chat service not initialized");
        }
        
        return await ragChat.performRAGChat(conversation);
      } catch (error) {
        log.error("Error performing RAG chat:", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "clear-vector-index",
    async (): Promise<{ success: boolean, message?: string }> => {
      try {
        const dbManager = DatabaseManager.getInstance();
        const db = dbManager.getDatabase();
        
        if (!db) throw new Error("Database not initialized");
        
        // Check if vector_index exists
        const tableExists = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='vector_index'
        `).get();
        
        if (!tableExists) {
          log.warn("Vector index table not found, nothing to clear");
          return { success: true, message: "No vector index found to clear" };
        }
        
        // Clear the vector index table
        log.info("Clearing vector index table");
        db.prepare('DELETE FROM vector_index').run();
        
        // Verify the table is empty
        const count = db.prepare('SELECT COUNT(*) as count FROM vector_index').get() as { count: number };
        log.info(`Vector index table now has ${count.count} rows`);
        
        return { success: true, message: "Vector index cleared successfully" };
      } catch (error) {
        log.error("Error clearing vector index:", error);
        return { success: false, message: `Failed to clear vector index: ${error.message}` };
      }
    }
  );

  ipcMain.handle(
    "regenerate-all-embeddings",
    async (): Promise<{ success: boolean, count?: number, message?: string }> => {
      try {
        const dbManager = DatabaseManager.getInstance();
        const db = dbManager.getDatabase();
        
        if (!db) throw new Error("Database not initialized");
        
        // Get all notes from the database
        const notes = db.prepare(`
          SELECT i.id, i.name, n.content
          FROM items i
          JOIN notes n ON i.id = n.item_id
          WHERE i.type = 'note'
        `).all() as { id: string, name: string, content: string }[];
        
        log.info(`Found ${notes.length} notes to regenerate embeddings for`);
        
        if (notes.length === 0) {
          return { success: true, count: 0, message: "No notes found to process" };
        }
        
        let successCount = 0;
        let errorCount = 0;
        
        // Process notes in batches of 10 to avoid overwhelming the system
        const batchSize = 10;
        for (let i = 0; i < notes.length; i += batchSize) {
          const batch = notes.slice(i, i + batchSize);
          
          // Process each note in the batch
          await Promise.all(batch.map(async (note) => {
            try {
              await generateEmbeddingsForNote(note.id, note.content, note.name);
              successCount++;
            } catch (error) {
              log.error(`Error generating embedding for note ${note.id}:`, error);
              errorCount++;
            }
          }));
          
          log.info(`Processed ${Math.min(i + batchSize, notes.length)} of ${notes.length} notes`);
        }
        
        return { 
          success: true, 
          count: successCount,
          message: `Successfully regenerated embeddings for ${successCount} notes. ${errorCount} errors.`
        };
      } catch (error) {
        log.error("Error regenerating embeddings:", error);
        return { success: false, message: `Failed to regenerate embeddings: ${error.message}` };
      }
    }
  );
}

// Function to generate embeddings for a note - can be called after a note is saved
export async function generateEmbeddingsForNote(noteId: string, noteContent: string, noteTitle: string): Promise<void> {
  try {
    // Check if necessary services are initialized
    if (!embeddingCreator) {
      // Try to initialize the embedding creator if it's not already initialized
      if (!openaiApiKey) {
        openaiApiKey = await getOpenAIKey();
      }
      
      if (!openaiApiKey) {
        log.warn("No OpenAI API key found. Skipping embedding generation.");
        return;
      }
      
      try {
        const openaiClient = new OpenAIApi({ apiKey: openaiApiKey });
        embeddingCreator = new EmbeddingCreator(openaiClient);
        log.info("Embedding creator initialized on-demand");
      } catch (initError) {
        log.error("Failed to initialize embedding creator:", initError);
        return;
      }
    }

    log.info(`Generating embeddings for note ${noteId}`);
    log.info(`Note title: "${noteTitle}", Content length: ${noteContent ? noteContent.length : 0}`);
    
    // Create a note object with required fields
    const note = {
      id: noteId,
      title: noteTitle,
      content: noteContent || ''
    };
    
    try {
      // Parse the note content for embedding
      const parsedContent = await embeddingCreator.parseNoteForEmbedding(note);
      log.info(`Parsed content length: ${parsedContent.length}`);
      
      if (!parsedContent || parsedContent.length < 5) {
        log.warn(`Skipping embedding generation for note ${noteId} due to insufficient content`);
        return;
      }
      
      // Create the embedding
      const embedding = await embeddingCreator.createEmbedding(parsedContent);
      log.info(`Embedding created successfully: ${embedding ? 'Yes' : 'No'}`);
      
      if (!embedding || !embedding.data || !embedding.data[0]) {
        log.warn(`No valid embedding data returned for note ${noteId}`);
        return;
      }
      
      // Save the embedding to the database
      await embeddingCreator.saveEmbeddingToDatabase(noteId, embedding);
      log.info(`Successfully generated and stored embeddings for note ${noteId}`);
    } catch (innerError) {
      log.error(`Inner error during embedding generation for note ${noteId}:`, innerError);
      if (innerError.stack) {
        log.error(`Stack trace: ${innerError.stack}`);
      }
      throw innerError;
    }
  } catch (error) {
    log.error(`Error generating embeddings for note ${noteId}:`, error);
    if (error.response) {
      log.error(`OpenAI API error: ${JSON.stringify(error.response.data || {})}`);
    }
    // This is non-blocking, so we just log the error and continue
  }
}