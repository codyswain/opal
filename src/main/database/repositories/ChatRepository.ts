import { randomUUID } from 'crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import type { ChatDraftState, Conversation } from '@/types/chat';

export interface StoredConversation extends Conversation { titleIsManual?: boolean }

export const CHAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const rows = await Promise.all(names.filter((name) => name.endsWith('.json') && CHAT_UUID.test(name.slice(0, -5))).map((name) => this.read(name.slice(0, -5))));
    return rows.filter((row): row is StoredConversation => row !== null);
  }
  async read(id: string): Promise<StoredConversation | null> {
    try {
      const parsed = JSON.parse(await readFile(this.file(id), 'utf8')) as StoredConversation;
      return parsed && parsed.id === id && Array.isArray(parsed.messages) ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
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
