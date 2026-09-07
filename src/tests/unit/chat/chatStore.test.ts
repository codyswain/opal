import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@/renderer/features/chat/store/chatStore';
import { installChatApi } from '@/tests/helpers/chatApi';

beforeEach(() => { useChatStore.getState().reset(); });

describe('chatStore', () => {
  it('loads conversations and index status, selecting the newest conversation', async () => {
    const api = installChatApi({ status: { ready: true, files: 3, chunks: 9 } });
    await api.create();
    const second = await api.create();
    await useChatStore.getState().load();
    const state = useChatStore.getState();
    expect(state.conversations.map((conversation) => conversation.id)).toEqual([second.data?.id, api.conversations.keys().next().value]);
    expect(state.active?.id).toBe(second.data?.id);
    expect(state.index).toMatchObject({ ready: true, files: 3 });
    expect(state.loaded).toBe(true);
  });

  it('sends a question, streams the answer, then adopts the persisted conversation with sources', async () => {
    const api = installChatApi({ sources: [{ n: 1, path: '/Vault/atlas.md', name: 'atlas.md', excerpt: 'x', score: 0.9 }] });
    await useChatStore.getState().load();
    expect(useChatStore.getState().active).toBeNull();
    await useChatStore.getState().send('What is the atlas?');
    const state = useChatStore.getState();
    expect(state.sending).toBe(false);
    expect(state.streaming).toBeNull();
    expect(state.active?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(state.active?.messages[1].sources?.[0].name).toBe('atlas.md');
    expect(state.active?.messages[1].content).toContain('Answer to "What is the atlas?"');
    expect(state.conversations[0].title).toBe('What is the atlas?');
    expect(api.ask).toHaveBeenCalledTimes(1);
  });

  it('keeps the question and shows the error when the answer fails', async () => {
    installChatApi({ failWith: 'Add your OpenAI API key in Settings to use Chat.' });
    await useChatStore.getState().load();
    await useChatStore.getState().send('Anything?');
    const state = useChatStore.getState();
    expect(state.error).toMatch(/API key/);
    expect(state.active?.messages[0]).toMatchObject({ role: 'user', content: 'Anything?' });
    expect(state.active?.messages[1]).toMatchObject({ role: 'assistant', error: expect.stringMatching(/API key/) });
    expect(state.sending).toBe(false);
  });

  it('updates the index and follows change notifications', async () => {
    const api = installChatApi();
    useChatStore.getState().subscribe();
    await useChatStore.getState().load();
    expect(useChatStore.getState().index?.ready).toBe(false);
    await useChatStore.getState().updateIndex();
    expect(useChatStore.getState().index).toMatchObject({ ready: true, files: 2, chunks: 5 });
    api.setStatus({ staleFiles: 4 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useChatStore.getState().index?.staleFiles).toBe(4);
    await useChatStore.getState().removeConversation(useChatStore.getState().active?.id ?? 'none');
  });
});
