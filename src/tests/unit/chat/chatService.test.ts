import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { IpcMain } from 'electron';
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { ChatError, ChatService, type ChatCompletionClient } from '@/main/chat/ChatService';
import { ChatHandlers } from '@/main/chat/ChatHandlers';
import { LibraryTextIndex } from '@/main/chat/LibraryTextIndex';
import { normalize, type EmbeddingProvider } from '@/main/chat/EmbeddingProvider';
import { RootRegistry } from '@/main/fs/RootRegistry';

function provider(): EmbeddingProvider {
  // Each distinct word owns a dimension, so unrelated texts score exactly zero.
  const vocabulary = new Map<string, number>();
  return {
    dimensions: 256,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Float32Array(256);
        for (const word of text.toLowerCase().split(/\W+/)) {
          if (!word) continue;
          if (!vocabulary.has(word)) vocabulary.set(word, vocabulary.size % 256);
          vector[vocabulary.get(word) as number] += 1;
        }
        return normalize(vector);
      });
    },
  };
}

let tmp: string;
let root: string;
let registry: RootRegistry;
let index: LibraryTextIndex;
let service: ChatService;
let completions: ChatCompletionClient & { prompts: { role: string; content: string }[][] };
let noKey = false;
let now = 1_800_000_000_000;

beforeEach(async () => {
  noKey = false;
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-chat-service-'));
  root = path.join(tmp, 'root');
  await mkdir(root);
  await writeFile(path.join(root, 'atlas.md'), '# Atlas\n\nThe atlas project maps mountains and rivers in detail.\n');
  await writeFile(path.join(root, 'recipes.md'), '# Recipes\n\nSourdough bread needs flour, water, salt and patience.\n');
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
  const embeddings = provider();
  index = new LibraryTextIndex({ registry, directory: path.join(tmp, 'library', 'index'), provider: async () => embeddings, now: () => now });
  completions = {
    prompts: [],
    async stream(messages, onDelta) {
      completions.prompts.push(messages);
      const text = 'Mountains are mapped by the atlas project [1]. Nothing here about bread.';
      for (const part of text.split(' ')) onDelta(`${part} `);
      return text;
    },
  };
  service = new ChatService({
    directory: path.join(tmp, 'library', 'chat'),
    index,
    clients: async () => {
      if (noKey) throw new ChatError('Add your OpenAI API key in Settings to use Chat.');
      return { embeddings, completions };
    },
    now: () => now++,
    maxConversations: 3,
  });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('ChatService', () => {
  it('creates, lists, titles, persists and removes conversations', async () => {
    const conversation = await service.create();
    expect(conversation).toMatchObject({ title: 'New conversation', messages: [] });
    expect((await service.list()).map((summary) => summary.id)).toEqual([conversation.id]);
    expect(await service.get(conversation.id)).toEqual(conversation);
    await service.remove(conversation.id);
    expect(await service.list()).toEqual([]);
    expect(await service.get(conversation.id)).toBeNull();
    await expect(service.get('nope')).rejects.toThrow(ChatError);
    for (let i = 0; i < 5; i += 1) await service.create();
    expect((await readdir(path.join(tmp, 'library', 'chat'))).filter((name) => name.endsWith('.json'))).toHaveLength(3);
  });

  it('answers from indexed sources, streams deltas, cites, and persists both messages', async () => {
    await index.update();
    const conversation = await service.create();
    const deltas: string[] = [];
    const answer = await service.ask(conversation.id, 'What maps the mountains?', (delta) => deltas.push(delta));
    expect(deltas.join('')).toContain('Mountains are mapped');
    expect(answer.message.role).toBe('assistant');
    expect(answer.message.sources?.map((source) => [source.n, source.name])).toEqual([[1, 'atlas.md']]);
    expect(answer.conversation.title).toBe('What maps the mountains?');
    const system = completions.prompts[0][0].content;
    expect(system).toContain('[1] atlas.md');
    expect(system).toContain('atlas project maps mountains');
    const stored = await service.get(conversation.id);
    expect(stored?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(stored?.messages[1].content).toContain('[1]');
  });

  it('tells the person to index first when nothing is indexed, and keeps the question when the key is missing', async () => {
    const conversation = await service.create();
    await service.ask(conversation.id, 'Anything?', () => undefined);
    expect(completions.prompts[0][0].content).toContain('not indexed yet');
    noKey = true;
    await expect(service.ask(conversation.id, 'Still there?', () => undefined)).rejects.toThrow(/API key/);
    const stored = await service.get(conversation.id);
    expect(stored?.messages.at(-1)).toMatchObject({ role: 'user', content: 'Still there?' });
    await expect(service.ask(conversation.id, '   ', () => undefined)).rejects.toThrow(/Ask a question/);
  });

  it('records a completion failure on the assistant message', async () => {
    await index.update();
    const conversation = await service.create();
    completions.stream = async () => { throw new Error('rate limited'); };
    await expect(service.ask(conversation.id, 'Mountains?', () => undefined)).rejects.toThrow(/rate limited/);
    const stored = await service.get(conversation.id);
    expect(stored?.messages.at(-1)).toMatchObject({ role: 'assistant', error: 'rate limited' });
  });
});

describe('ChatHandlers', () => {
  it('registers channels, validates the answer channel, streams frames and ends with null', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipc = { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as IpcMain;
    new ChatHandlers({ ipc, service, index }).registerAll();
    expect([...handlers.keys()].sort()).toEqual(['chat:ask', 'chat:create', 'chat:get', 'chat:index-status', 'chat:index-update', 'chat:list', 'chat:remove']);
    const frames: unknown[] = [];
    const event = { sender: { isDestroyed: () => false, send: (_channel: string, payload: unknown) => frames.push(payload) } };
    const invoke = (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing ${channel}`);
      return handler(event, ...args);
    };
    await invoke('chat:index-update');
    const created = await invoke('chat:create') as { data: { id: string } };
    expect(await invoke('chat:ask', created.data.id, 'Mountains?', 'bad channel')).toMatchObject({ success: false });
    const answered = await invoke('chat:ask', created.data.id, 'Mountains?', 'chat:answer:abc-123') as { success: boolean };
    expect(answered.success).toBe(true);
    expect(frames.at(-1)).toBeNull();
    expect(frames.slice(0, -1).every((frame) => typeof (frame as { delta?: string }).delta === 'string')).toBe(true);
    expect(await invoke('chat:index-status')).toMatchObject({ success: true, data: { ready: true } });
    expect(await invoke('chat:get', 'nope')).toMatchObject({ success: false, error: /Invalid/ });
  });
});
