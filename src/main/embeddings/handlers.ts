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

export async function registerEmbeddingIPCHandlers(){
  const openaiApiKey = await getOpenAIKey();
  const openai = new OpenAI({ apiKey: openaiApiKey });
  const embeddingCreator = new EmbeddingCreator(openai);
  const similaritySearcher = new SimilaritySearcher();
  const ragChat = new RAGChat(openai, embeddingCreator, similaritySearcher);

  ipcMain.handle(
    "generate-note-embeddings",
    async (_, note: Note, fileNode: FileNode): Promise<Embedding> => {
      try {
        const parsedContent = await embeddingCreator.parseNoteForEmbedding(note);
        const embedding = await embeddingCreator.createEmbedding(parsedContent);
        const embeddingFullPath = path.join(
          path.dirname(fileNode.fullPath),
          `${note.id}.embedding.json`
        );
        await embeddingCreator.saveEmbedding(embedding, embeddingFullPath);
        return embedding;
      } catch (error) {
        console.error("Error generating note embeddings:", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "perform-similarity-search",
    async (
      _,
      query: string,
      directoryStructures: DirectoryStructures
    ): Promise<SimilarNote[]> => {
      try {
        const queryEmbedding = await embeddingCreator.createEmbedding(query);
        const embeddingPaths = await similaritySearcher.findEmbeddingPaths(
          directoryStructures
        );
        return await similaritySearcher.performSimilaritySearch(
          queryEmbedding,
          embeddingPaths
        );
      } catch (error) {
        console.error("Error performing similarity search:", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "perform-rag-chat",
    async (
      _,
      conversation: { role: string; content: string }[],
      directoryStructures: DirectoryStructures
    ): Promise<{ role: string; content: string }> => {
      return await ragChat.performRAGChat(conversation, directoryStructures);
    }
  );
}