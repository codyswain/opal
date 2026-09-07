export interface TextChunk {
  /** Zero-based position within the file's chunk list. */
  index: number;
  /** Character offset of the chunk's first character in the file body. */
  start: number;
  text: string;
}

export interface LibraryIndexStatus {
  files: number;
  chunks: number;
  /** Files known to have changed since the last update. */
  staleFiles: number;
  indexing: boolean;
  lastIndexedAt: number | null;
  error: string | null;
  /** Files skipped during the last update, with reasons. */
  skipped: { path: string; reason: string }[];
  /** True once an index exists on disk or in memory. */
  ready: boolean;
}

export interface IndexHit {
  path: string;
  chunkIndex: number;
  start: number;
  text: string;
  score: number;
}

export interface ChatSource {
  /** 1-based citation number as it appears in the answer. */
  n: number;
  path: string;
  name: string;
  excerpt: string;
  score: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  sources?: ChatSource[];
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ChatAnswer {
  message: ChatMessage;
  conversation: ConversationSummary;
}

export const CHAT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const CHAT_EMBEDDING_DIMENSIONS = 512;
export const CHAT_COMPLETION_MODEL = 'gpt-4o-mini';
export const CHAT_MAX_SOURCES = 8;
export const CHAT_SIMILARITY_FLOOR = 0.25;
export const CHAT_INDEX_FILE_LIMIT = 1024 * 1024;
