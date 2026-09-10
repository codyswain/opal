import { randomUUID } from 'crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import type { ChatDraftState, Conversation } from '@/types/chat';

export interface StoredConversation extends Conversation { titleIsManual?: boolean; unreadable?: boolean }

export const CHAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class UnreadableThreadError extends Error {
  constructor() { super('This thread could not be read. Its original file is kept in Opal’s application data for recovery.'); this.name = 'UnreadableThreadError'; }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optional = (value: unknown, check: (item: unknown) => boolean) => value === undefined || check(value);
const string = (value: unknown): value is string => typeof value === 'string';
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
function validConversation(value: unknown, id: string): boolean {
  if (!object(value) || value.id !== id || !string(value.title) || !number(value.createdAt) || !number(value.updatedAt) || !Array.isArray(value.messages)) return false;
  if (!optional(value.archivedAt, number) || !optional(value.pinnedAt, number) || !optional(value.titleIsManual, boolean)) return false;
  if (!optional(value.context, (context) => object(context) && string(context.title) && string(context.date) && optional(context.context, string) && optional(context.sourcePath, string))) return false;
  return value.messages.every((message) => object(message) && string(message.id) && (message.role === 'user' || message.role === 'assistant') && string(message.content) && number(message.createdAt) &&
    optional(message.error, string) && optional(message.cancelled, boolean) &&
    optional(message.retrieval, (retrieval) => object(retrieval) && (retrieval.method === 'calendar' || retrieval.method === 'semantic') && string(retrieval.summary)) &&
    optional(message.sources, (sources) => Array.isArray(sources) && sources.every((source) => object(source) && number(source.n) && source.n > 0 && string(source.path) && string(source.name) && string(source.excerpt) && number(source.score) && optional(source.page, (page) => number(page) && page > 0))));
}

/** Atomic JSON storage; only UUID filenames are conversations. */
export class ChatRepository {
  constructor(private directory: string) {}
  private file(id: string): string { return path.join(this.directory, `${id}.json`); }
  async list(): Promise<StoredConversation[]> {
    let names: string[];
    try { names = await readdir(this.directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const rows = await Promise.all(names.filter((name) => name.endsWith('.json') && CHAT_UUID.test(name.slice(0, -5))).map(async (name) => {
      const id = name.slice(0, -5);
      try { return await this.read(id); } catch {
        return { id, title: `Unreadable thread · ${id.slice(0, 8)}`, createdAt: 0, updatedAt: 0, messages: [], unreadable: true };
      }
    }));
    return rows.filter((row): row is StoredConversation => row !== null);
  }
  async read(id: string): Promise<StoredConversation | null> {
    try {
      const parsed = JSON.parse(await readFile(this.file(id), 'utf8')) as StoredConversation;
      if (!validConversation(parsed, id)) throw new UnreadableThreadError();
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new UnreadableThreadError();
    }
  }
  write(conversation: StoredConversation): Promise<void> { return this.atomicWrite(conversation.id, conversation); }
  remove(id: string): Promise<void> { return rm(this.file(id), { force: true }); }
  async readDrafts(): Promise<unknown> {
    try { return JSON.parse(await readFile(this.file('drafts'), 'utf8')); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { drafts: {}, pending: [] };
      throw error;
    }
  }
  writeDrafts(state: ChatDraftState): Promise<void> { return this.atomicWrite('drafts', state); }
  private async atomicWrite(id: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.file(id)}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
      await rename(temporary, this.file(id));
    } finally { await rm(temporary, { force: true }); }
  }
}
