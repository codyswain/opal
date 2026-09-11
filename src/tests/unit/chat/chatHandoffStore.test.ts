import { beforeEach, expect, it, vi } from 'vitest';
import { useChatStore } from '@/renderer/features/chat/store/chatStore';
import { useChatHandoffStore } from '@/renderer/features/chat/store/chatHandoffStore';
import { installChatApi } from '@/tests/helpers/chatApi';

beforeEach(() => {
  useChatStore.getState().reset();
  useChatHandoffStore.getState().reset();
  localStorage.clear();
});

it('queues drafts locally and serializes consumption while conversation creation is delayed', async () => {
  const api = installChatApi();
  const create = api.create;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(api.create).mockImplementationOnce(async () => { await gate; return create(); });
  const handoff = useChatHandoffStore.getState();
  handoff.prepare({ title: 'First task', date: '2026-09-08' });
  expect(api.create).not.toHaveBeenCalled();
  expect(api.list).not.toHaveBeenCalled();
  const first = handoff.consume();
  await handoff.consume();
  handoff.prepare({ title: 'Second task', date: '2026-09-09' });
  release();
  await first;
  expect(api.conversations.size).toBe(2);
  expect(Object.values(useChatHandoffStore.getState().drafts)).toEqual([
    expect.stringContaining('First task'), expect.stringContaining('Second task'),
  ]);
  expect(useChatHandoffStore.getState().pending).toEqual([]);
  expect(api.ask).not.toHaveBeenCalled();
  expect(api.indexUpdate).not.toHaveBeenCalled();
});
