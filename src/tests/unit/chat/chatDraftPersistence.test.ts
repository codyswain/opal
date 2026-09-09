import { beforeEach, expect, it, vi } from 'vitest';
import { useChatHandoffStore as drafts } from '@/renderer/features/chat/store/chatHandoffStore';
import { useChatStore } from '@/renderer/features/chat/store/chatStore';
import { installChatApi } from '@/tests/helpers/chatApi';

beforeEach(() => { useChatStore.getState().reset(); drafts.getState().reset(); });

it('restores an unsent draft after renderer state is discarded without sending anything', async () => {
  const api = installChatApi();
  await drafts.getState().hydrate();
  drafts.getState().setDraft('new', 'A thought to continue tomorrow');
  expect(await drafts.getState().flush()).toBe(true);
  drafts.getState().reset();
  await drafts.getState().hydrate();
  expect(drafts.getState().drafts.new).toBe('A thought to continue tomorrow');
  expect(api.ask).not.toHaveBeenCalled();
  expect(api.indexUpdate).not.toHaveBeenCalled();
});

it('keeps the latest edit when a slower disk save is in progress', async () => {
  const api = installChatApi();
  await drafts.getState().hydrate();
  const save = vi.mocked(api.saveDraftState).getMockImplementation();
  if (!save) throw new Error('Missing mock');
  let release!: () => void;
  vi.mocked(api.saveDraftState).mockImplementationOnce(async (state) => {
    await new Promise<void>((resolve) => { release = resolve; });
    return save(state);
  });
  drafts.getState().setDraft('new', 'First');
  await vi.waitFor(() => expect(release).toBeDefined());
  drafts.getState().setDraft('new', 'Newest');
  release();
  expect(await drafts.getState().flush()).toBe(true);
  drafts.getState().reset();
  await drafts.getState().hydrate();
  expect(drafts.getState().drafts.new).toBe('Newest');
});

it('keeps unsaved text and reports disk failure until a retry succeeds', async () => {
  const api = installChatApi();
  await drafts.getState().hydrate();
  vi.mocked(api.saveDraftState).mockResolvedValueOnce({ success: false, error: 'Disk full' });
  drafts.getState().setDraft('new', 'Do not lose this');
  expect(await drafts.getState().flush()).toBe(false);
  expect(drafts.getState()).toMatchObject({ dirty: true, persistenceError: 'Disk full', drafts: { new: 'Do not lose this' } });
  expect(await drafts.getState().flush()).toBe(true);
  expect(drafts.getState().dirty).toBe(false);
});

it('does not overwrite unreadable draft storage', async () => {
  const api = installChatApi();
  vi.mocked(api.getDraftState).mockResolvedValue({ success: false, error: 'Draft file needs recovery' });
  drafts.getState().prepare({ title: 'A task', date: '2026-09-09' });
  expect(await drafts.getState().flush()).toBe(false);
  expect(api.saveDraftState).not.toHaveBeenCalled();
  expect(drafts.getState().pending).toHaveLength(1);
});
