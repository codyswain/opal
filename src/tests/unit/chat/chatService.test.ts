import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile, symlink, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { IpcMain } from 'electron';
import type { ChatDraftState } from '@/types/chat';
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
  });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('ChatService', () => {
  it('reads the actual last ten calendar days, including files created after indexing', async () => {
    now = new Date(2026, 8, 9, 12).getTime();
    await writeFile(path.join(root, '2023-10-14.md'), 'I collected data over the last 10 days.');
    await index.update();
    await writeFile(path.join(root, '2026-08-30.md'), 'Outside requested window.');
    await writeFile(path.join(root, '2026-08-31.md'), 'First day: planting lavender.');
    await writeFile(path.join(root, '2026-09-09.md'), 'Today: finished the garden.');
    const conversation = await service.create();
    await service.ask(conversation.id, 'okay tell me about the last 10 days', () => undefined);
    const prompt = completions.prompts[0][0].content;
    expect(prompt).toContain('2026-08-31 through 2026-09-09');
    expect(prompt).toContain('planting lavender');
    expect(prompt).toContain('finished the garden');
    expect(prompt).not.toContain('2023-10-14');
    expect(prompt).not.toContain('Outside requested window');
    expect(prompt).toContain('8 days without readable dated notes');
    expect((await service.get(conversation.id))?.messages.at(-1)?.retrieval).toMatchObject({ method: 'calendar', summary: expect.stringContaining('8 days without readable dated notes') });
  });

  it('uses the newest dated note for most recent, excludes future notes, and reports missing periods', async () => {
    now = new Date(2026, 8, 9, 12).getTime();
    await writeFile(path.join(root, '2026-09-08.md'), 'Newest actual entry.');
    await writeFile(path.join(root, '2027-01-01.md'), 'Future planning.');
    const conversation = await service.create();
    await service.ask(conversation.id, 'What did I write about most recently?', () => undefined);
    expect(completions.prompts[0][0].content).toContain('Newest actual entry');
    expect(completions.prompts[0][0].content).not.toContain('Future planning');
    await service.ask(conversation.id, 'What about today?', () => undefined);
    expect(completions.prompts[1][0].content).toContain('No readable dated notes');
    expect(completions.prompts[1][0].content).not.toContain('Newest actual entry');
  });

  it('groups passages from a file into one citation and never presents uncited files as sources', async () => {
    await index.update();
    vi.spyOn(index, 'search').mockReturnValue([
      { path: path.join(root, 'atlas.md'), chunkIndex: 0, start: 0, text: 'First evidence', score: 1 },
      { path: path.join(root, 'atlas.md'), chunkIndex: 1, start: 500, text: 'Second evidence', score: 0.9 },
    ]);
    completions.stream = async (messages) => { completions.prompts.push(messages); return 'An answer without citations.'; };
    const conversation = await service.create();
    const answer = await service.ask(conversation.id, 'Atlas?', () => undefined);
    const prompt = completions.prompts[0][0].content;
    expect(prompt).toContain('Second evidence');
    expect(prompt).not.toContain('[2] atlas.md');
    expect(answer.message.sources).toEqual([]);
  });

  it('finds literal body text locally and deep search reads files absent from the index', async () => {
    await index.update();
    const indexed = await index.searchContent('patience');
    expect(indexed.hits.map((hit) => hit.name)).toEqual(['recipes.md']);
    expect(indexed.hits[0].excerpt).toContain('patience');
    await writeFile(path.join(root, 'new.md'), 'A hidden keyword: foxglove.');
    expect((await index.searchContent('foxglove')).hits).toEqual([]);
    expect((await index.searchContent('foxglove', true)).hits[0]).toMatchObject({ name: 'new.md', excerpt: 'A hidden keyword: foxglove.' });
    expect(completions.prompts).toEqual([]);
  });

  it('keeps deep search and calendar retrieval inside opened non-hidden files', async () => {
    now = new Date(2026, 8, 9, 12).getTime();
    await mkdir(path.join(root, '.private'));
    await writeFile(path.join(root, '.private', '2026-09-09.md'), 'excluded keyword');
    const outside = path.join(tmp, '2026-09-09.md');
    await writeFile(outside, 'excluded keyword');
    await symlink(outside, path.join(root, '2026-09-09.md'));
    expect((await index.searchContent('excluded', true)).hits).toEqual([]);
    const conversation = await service.create();
    await service.ask(conversation.id, 'What happened today?', () => undefined);
    expect(completions.prompts[0][0].content).not.toContain('excluded keyword');
    await expect(index.searchContent('', true)).rejects.toThrow();
  });

  it('cancels the actual stream and keeps the partial answer across reload', async () => {
    const conversation = await service.create();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let received: AbortSignal | undefined;
    completions.stream = async (_messages, onDelta, signal) => {
      received = signal;
      onDelta('A partial thought');
      started();
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    };
    const result = service.ask(conversation.id, 'Help me think', () => undefined);
    await ready;
    expect(service.cancel(conversation.id)).toBe(true);
    const answer = await result;
    expect(received?.aborted).toBe(true);
    expect(answer.message).toMatchObject({ content: 'A partial thought', cancelled: true });
    expect((await service.get(conversation.id))?.messages.at(-1)).toMatchObject({ content: 'A partial thought', cancelled: true });
    expect(service.cancel(conversation.id)).toBe(false);
  });

  it('isolates damaged thread files without hiding healthy threads or changing the damaged bytes', async () => {
    const healthy = await service.create({ title: 'Keep thinking' });
    const damaged = await service.create({ title: 'Damaged fixture' });
    const file = path.join(tmp, 'library', 'chat', `${damaged.id}.json`);
    await writeFile(file, '{broken');
    const listed = await service.list();
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: healthy.id, title: 'Keep thinking' }),
      expect.objectContaining({ id: damaged.id, unreadable: true }),
    ]));
    await expect(service.get(damaged.id)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('{broken');
    const drafts: ChatDraftState = { drafts: { [healthy.id]: 'Keep this new writing', [damaged.id]: 'Recover this writing' }, pending: [] };
    await service.saveDraftState(drafts);
    expect(await service.getDraftState()).toEqual(drafts);
    await writeFile(file, JSON.stringify({ ...damaged, messages: [{ id: 'invalid', role: 'assistant', content: 123, createdAt: 1 }] }));
    expect((await service.list()).find((item) => item.id === damaged.id)?.unreadable).toBe(true);
    await expect(service.update(damaged.id, { title: 'Do not overwrite' })).rejects.toThrow();
    expect(JSON.parse(await readFile(file, 'utf8')).messages[0].content).toBe(123);
  });

  it('creates, lists, titles, persists and removes conversations', async () => {
    const conversation = await service.create();
    expect(conversation).toMatchObject({ title: 'New conversation', messages: [] });
    expect((await service.list()).map((summary) => summary.id)).toEqual([conversation.id]);
    expect(await service.get(conversation.id)).toEqual(conversation);
    await service.remove(conversation.id);
    expect(await service.list()).toEqual([]);
    expect(await service.get(conversation.id)).toBeNull();
    await expect(service.get('nope')).rejects.toThrow(ChatError);
    for (let i = 0; i < 35; i += 1) await service.create();
    expect((await readdir(path.join(tmp, 'library', 'chat'))).filter((name) => name.endsWith('.json'))).toHaveLength(35);
  });

  it('reloads context, manual titles, archives and drafts without calling AI', async () => {
    noKey = true;
    const context = { title: 'Atlas', date: '2026-09-09', context: 'Map research', sourcePath: '/atlas.md' };
    const conversation = await service.create({ title: 'Research', context });
    await service.update(conversation.id, { title: 'My research', archived: true });
    const drafts = { drafts: { [conversation.id]: 'Unsent thought', new: 'Scratch thought' }, pending: [context] };
    await service.saveDraftState(drafts);
    const reloaded = new ChatService({ directory: path.join(tmp, 'library', 'chat'), index, now: () => now++, clients: async () => { throw new Error('Must not call AI'); } });
    expect(await reloaded.getDraftState()).toEqual(drafts);
    expect(await reloaded.get(conversation.id)).toMatchObject({ title: 'My research', context, archivedAt: expect.any(Number) });
    expect(await reloaded.list()).toHaveLength(1);
    await reloaded.update(conversation.id, { archived: false });
    expect((await reloaded.get(conversation.id))?.archivedAt).toBeUndefined();
  });

  it('persists pins independently of archives and sorts pins before newer threads', async () => {
    noKey = true;
    const first = await service.create({ title: 'First' });
    const second = await service.create({ title: 'Second' });
    const pinned = await service.update(first.id, { pinned: true });
    expect(pinned.pinnedAt).toEqual(expect.any(Number));
    expect((await service.update(first.id, { pinned: true })).pinnedAt).toBe(pinned.pinnedAt);
    await service.update(second.id, { pinned: true });
    const newest = await service.create({ title: 'Newest unpinned' });
    expect((await service.list()).map((item) => item.id)).toEqual([second.id, first.id, newest.id]);
    await service.update(first.id, { archived: true });
    const reloaded = new ChatService({ directory: path.join(tmp, 'library', 'chat'), index, now: () => now++, clients: async () => { throw new Error('Must not call AI'); } });
    expect(await reloaded.get(first.id)).toMatchObject({ pinnedAt: pinned.pinnedAt, archivedAt: expect.any(Number) });
    expect((await reloaded.list())[0]).toMatchObject({ id: first.id, pinnedAt: pinned.pinnedAt });
    const unpinned = await reloaded.update(first.id, { pinned: false });
    expect(unpinned.pinnedAt).toBeUndefined();
    expect(unpinned.archivedAt).toEqual(expect.any(Number));
    expect((await reloaded.list()).map((item) => item.id)).toEqual([second.id, first.id, newest.id]);
    await expect(reloaded.update(first.id, { pinned: 'yes' })).rejects.toThrow();
  });

  it('preserves metadata edited while an answer streams', async () => {
    const conversation = await service.create({ title: 'New conversation' });
    let finish!: (answer: string) => void;
    let started!: () => void;
    const streaming = new Promise<void>((resolve) => { started = resolve; });
    completions.stream = async () => { started(); return new Promise<string>((resolve) => { finish = resolve; }); };
    const answer = service.ask(conversation.id, 'Question', () => undefined);
    await streaming;
    expect((await service.get(conversation.id))?.title).toBe('New conversation');
    await expect(service.ask(conversation.id, 'Another', () => undefined)).rejects.toThrow(/already/);
    await expect(service.remove(conversation.id)).rejects.toThrow(/answer/);
    await service.update(conversation.id, { title: 'Renamed during answer', archived: true, pinned: true });
    finish('Answer');
    expect((await answer).conversation.pinnedAt).toEqual(expect.any(Number));
    expect(await service.get(conversation.id)).toMatchObject({ title: 'Renamed during answer', pinnedAt: expect.any(Number), archivedAt: expect.any(Number), messages: [expect.objectContaining({ role: 'user' }), expect.objectContaining({ role: 'assistant' })] });
  });

  it('rejects invalid metadata and refuses to overwrite corrupt drafts', async () => {
    await expect(service.create({ title: ' ' })).rejects.toThrow();
    await expect(service.create({ context: { title: 'x', date: 2 } } as never)).rejects.toThrow();
    const conversation = await service.create();
    await expect(service.update(conversation.id, { archived: 'yes' } as never)).rejects.toThrow();
    await expect(service.update(conversation.id, { messages: [] } as never)).rejects.toThrow();
    await expect(service.update('00000000-0000-4000-8000-000000000000', { title: 'Gone' })).rejects.toThrow();
    await expect(service.saveDraftState({ drafts: JSON.parse('{"__proto__":"bad"}'), pending: [] })).rejects.toThrow();
    await writeFile(path.join(tmp, 'library', 'chat', 'drafts.json'), '{broken');
    await expect(service.getDraftState()).rejects.toThrow();
    await expect(service.saveDraftState({ drafts: {}, pending: [] })).rejects.toThrow();
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

  it('allows supplied context without indexed files, and keeps the question when the key is missing', async () => {
    const conversation = await service.create();
    await service.ask(conversation.id, 'Anything?', () => undefined);
    expect(completions.prompts[0][0].content).toContain('not indexed yet');
    expect(completions.prompts[0][0].content).toContain('context the person provides');
    expect(completions.prompts[0][0].content).toContain('A source path in a message is a reference, not evidence that you read that file.');
    noKey = true;
    await expect(service.ask(conversation.id, 'Still there?', () => undefined)).rejects.toThrow(/API key/);
    const stored = await service.get(conversation.id);
    expect(stored?.messages.at(-2)).toMatchObject({ role: 'user', content: 'Still there?' });
    expect(stored?.messages.at(-1)?.error).toMatch(/API key/);
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
  it('only lets the requesting window stop its own answer channel', async () => {
    const handlers = new Map<string, (event: { sender: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } }, ...args: unknown[]) => Promise<unknown>>();
    const ipc = { handle: (channel: string, handler: (event: { sender: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } }, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as IpcMain;
    new ChatHandlers({ ipc, service, index }).registerAll();
    const owner = { isDestroyed: () => false, send: vi.fn() };
    const other = { isDestroyed: () => false, send: vi.fn() };
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    completions.stream = async (_messages, onDelta, signal) => {
      onDelta('Partial'); started();
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    };
    const conversation = await service.create();
    const answer = handlers.get('chat:ask')?.({ sender: owner }, conversation.id, 'Question', 'chat:answer:test');
    await ready;
    expect(await handlers.get('chat:cancel')?.({ sender: other }, 'chat:answer:test')).toMatchObject({ data: false });
    expect(await handlers.get('chat:cancel')?.({ sender: owner }, 'chat:answer:test')).toMatchObject({ data: true });
    expect(await answer).toMatchObject({ success: true, data: { message: { cancelled: true, content: 'Partial' } } });
    expect(await handlers.get('chat:cancel')?.({ sender: owner }, 'chat:answer:test')).toMatchObject({ data: false });
  });

  it('registers channels, validates the answer channel, streams frames and ends with null', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipc = { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as IpcMain;
    new ChatHandlers({ ipc, service, index }).registerAll();
    expect([...handlers.keys()].sort()).toEqual(['chat:ask', 'chat:cancel', 'chat:create', 'chat:drafts-get', 'chat:drafts-save', 'chat:get', 'chat:index-cancel', 'chat:index-status', 'chat:index-update', 'chat:list', 'chat:remove', 'chat:search-content', 'chat:search-messages', 'chat:update']);
    const frames: unknown[] = [];
    const event = { sender: { isDestroyed: () => false, send: (_channel: string, payload: unknown) => frames.push(payload) } };
    const invoke = (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing ${channel}`);
      return handler(event, ...args);
    };
    expect(await invoke('chat:search-messages', ' ', false)).toMatchObject({ success: false });
    expect(await invoke('chat:search-messages', 'garden', false)).toMatchObject({ success: true, data: { hits: [], incomplete: false } });
    await invoke('chat:index-update');
    expect(await invoke('chat:index-cancel')).toMatchObject({ success: true, data: { indexing: false } });
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


it('searches stored message text locally with archive scope and unreadable-file coverage', async () => {
  noKey = true;
  const first = await service.create({ title: 'Garden' });
  const archived = await service.create({ title: 'Older' });
  await writeFile(path.join(tmp, 'library/chat', first.id + '.json'), JSON.stringify({ ...first, messages: [{ id: 'm1', role: 'user', content: 'Remember the SOLSTICE planting plan', createdAt: 1 }] }));
  await writeFile(path.join(tmp, 'library/chat', archived.id + '.json'), JSON.stringify({ ...archived, archivedAt: 2, messages: [{ id: 'm2', role: 'assistant', content: 'Solstice notes', createdAt: 2 }] }));
  const damaged = path.join(tmp, 'library/chat/11111111-1111-4111-8111-111111111111.json');
  await writeFile(damaged, '{broken');
  expect(await service.searchMessages('solstice', false)).toEqual({ hits: [{ id: first.id, messageId: 'm1', excerpt: 'Remember the SOLSTICE planting plan' }], incomplete: true });
  expect((await service.searchMessages('SOLSTICE', true)).hits).toEqual([{ id: archived.id, messageId: 'm2', excerpt: 'Solstice notes' }]);
  await expect(service.searchMessages(' ', false)).rejects.toThrow();
  await expect(service.searchMessages('x'.repeat(201), false)).rejects.toThrow();
  await expect(service.searchMessages('solstice', 'yes')).rejects.toThrow();
  expect(await readFile(damaged, 'utf8')).toBe('{broken');
  expect(completions.prompts).toHaveLength(0);
});


it('caps message matches at fifty distinct threads and bounds excerpts', async () => {
  noKey = true;
  await mkdir(path.join(tmp, 'library/chat'), { recursive: true });
  await Promise.all(Array.from({ length: 51 }, async (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    await writeFile(path.join(tmp, 'library/chat', id + '.json'), JSON.stringify({ id, title: 'Thread', createdAt: 1, updatedAt: index, messages: [
      { id: 'm1', role: 'user', content: 'Before '.repeat(100) + 'solstice' + ' after'.repeat(100), createdAt: 1 },
      { id: 'm2', role: 'assistant', content: 'Solstice again', createdAt: 2 }
    ] }));
  }));
  const result = await service.searchMessages('solstice', false);
  expect(result.incomplete).toBe(true);
  expect(result.hits).toHaveLength(50);
  expect(new Set(result.hits.map(hit => hit.id)).size).toBe(50);
  expect(result.hits[0].id).toBe('00000000-0000-4000-8000-000000000050');
  expect(result.hits.every(hit => hit.excerpt.length < 200 && hit.excerpt.includes('solstice'))).toBe(true);
});
