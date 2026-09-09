export interface TextChunk {
  /** Zero-based position within the file's chunk list. */
  index: number;
  /** Character offset of the chunk's first character in the file body. */
  start: number;
  text: string;
}

export interface IndexProgress {
  phase: 'scanning' | 'reading' | 'embedding';
  /** Items finished in this phase: files while scanning and reading, passages while embedding. */
  done: number;
  /** Items expected in this phase; 0 while scanning, when the count is unknown. */
  total: number;
  /** The file being worked on, for the status line. */
  currentFile: string | null;
}

export interface LibraryIndexStatus {
  files: number;
  chunks: number;
  /** Files known to have changed since the last update. */
  staleFiles: number;
  indexing: boolean;
  /** Where the running update stands; null when idle. */
  progress: IndexProgress | null;
  /** True when the last update was stopped early; what finished was kept. */
  cancelled: boolean;
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
  /** 1-based page for paginated documents (PDF); absent for plain text. */
  page?: number;
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
  /** 1-based page for paginated documents (PDF). */
  page?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  sources?: ChatSource[];
  error?: string;
}

export interface ThreadContext {
  title: string;
  date: string;
  context?: string;
  sourcePath?: string;
}

export interface ChatDraftState {
  drafts: Record<string, string>;
  pending: ThreadContext[];
}

export interface CreateConversationOptions { title?: string; context?: ThreadContext }
export interface ConversationPatch { title?: string; archived?: boolean }

export interface Conversation {
  id: string;
  title: string;
  context?: ThreadContext;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  context?: ThreadContext;
  archivedAt?: number;
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
/** Largest Markdown or text file that is read into the index. */
export const CHAT_INDEX_FILE_LIMIT = 1024 * 1024;
/** Largest PDF whose text is extracted; the extracted text is then held to CHAT_INDEX_FILE_LIMIT characters. */
export const CHAT_INDEX_PDF_LIMIT = 25 * 1024 * 1024;
/** Passages embedded per request, so a cancelled update loses at most one request's work. */
export const CHAT_EMBED_BATCH = 64;
