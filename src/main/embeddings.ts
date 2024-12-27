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
import { getOpenAIKey } from "./fileSystem";
import { ChatCompletionMessageParam } from "openai/resources/chat";

const TEXT_EMBEDDING_MODEL = "text-embedding-ada-002";

class EmbeddingCreator {
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
    const root = parse(note.content);
    const textContent = root.textContent.trim();
    return `${note.title}\n\n${textContent}`;
  }

  async saveEmbedding(embedding: Embedding, filePath: string): Promise<void> {
    const embeddingDirPath = path.dirname(filePath);
    await fs.mkdir(embeddingDirPath, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(embedding));
  }
}

class SimilaritySearcher {
  async findEmbeddingPaths(
    directoryStructures: DirectoryStructures
  ): Promise<string[]> {
    const embeddingPaths: string[] = [];

    const traverseStructure = async (fileNode: FileNode) => {
      if (fileNode.type === "note" && fileNode.noteMetadata) {
        const embeddingPath = `${path.dirname(fileNode.fullPath)}/${
          fileNode.noteMetadata.id
        }.embedding.json`;
        try {
          await fs.access(embeddingPath);
          embeddingPaths.push(embeddingPath);
        } catch (error) {
          // Embedding file doesn't exist, skip
        }
      }
      if (fileNode.childIds) {
        for (const childId of fileNode.childIds) {
          const childNode = directoryStructures.nodes[childId];
          if (childNode) {
            await traverseStructure(childNode);
          }
        }
      }
    };

    for (const rootId of directoryStructures.rootIds) {
      const rootNode = directoryStructures.nodes[rootId];
      if (rootNode) {
        await traverseStructure(rootNode);
      }
    }

    return embeddingPaths;
  }

  async performSimilaritySearch(
    queryEmbedding: OpenAI.Embeddings.CreateEmbeddingResponse,
    embeddingPaths: string[]
  ): Promise<SimilarNote[]> {
    const results: SimilarNote[] = [];

    for (const embeddingPath of embeddingPaths) {
      const embeddingContent = await fs.readFile(embeddingPath, "utf-8");
      const embedding = JSON.parse(embeddingContent) as Embedding;
      const score = this.cosineSimilarity(
        queryEmbedding.data[0].embedding,
        embedding.data[0].embedding
      );
      const notePath = embeddingPath.replace(".embedding.json", ".json");
      const noteContent = await fs.readFile(notePath, "utf-8");
      const note = JSON.parse(noteContent) as SimilarNote;

      results.push({ ...note, score });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 10); // Return top 5 results
  }

  cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, _, i) => sum + a[i] * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }
}

class RAGChat {
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
    conversation: { role: string; content: string }[],
    directoryStructures: DirectoryStructures
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
      const embeddingPaths = await this.similaritySearcher.findEmbeddingPaths(
        directoryStructures
      );
      const similarNotes = await this.similaritySearcher.performSimilaritySearch(
        queryEmbedding,
        embeddingPaths
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

export const setupEmbeddingService = async (): Promise<void> => {
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
};
