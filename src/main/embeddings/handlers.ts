import {
  Note,
  FileNode,
  DirectoryStructures,
  Embedding,
  SimilarNote,
} from "@/renderer/shared/types";
import { ipcMain } from "electron";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import { parse } from "node-html-parser";
import { getOpenAIKey } from "../file-system/loader";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { EmbeddingCreator, RAGChat, SimilaritySearcher } from "./embeddings";
import log from 'electron-log';

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
    const openai = new OpenAI({ apiKey: openaiApiKey });
    
    // Initialize embedding classes
    embeddingCreator = new EmbeddingCreator(openai);
    similaritySearcher = new SimilaritySearcher();
    ragChat = new RAGChat(openai, embeddingCreator, similaritySearcher);
    
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
          throw new Error("Embedding services not initialized");
        }
        
        const queryEmbedding = await embeddingCreator.createEmbedding(query);
        return await similaritySearcher.performSimilaritySearch(
          queryEmbedding
        );
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
        const openai = new OpenAI({ apiKey: openaiApiKey });
        embeddingCreator = new EmbeddingCreator(openai);
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