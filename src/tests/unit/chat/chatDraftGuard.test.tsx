import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatDraftGuard } from '@/renderer/features/chat/components/ChatDraftGuard';
import { useChatHandoffStore } from '@/renderer/features/chat/store/chatHandoffStore';
import { installChatApi } from '@/tests/helpers/chatApi';

beforeEach(() => useChatHandoffStore.getState().reset());
it('protects failed draft writes on any route and permits closing after retry succeeds', async () => {
  const api = installChatApi();
  render(<ChatDraftGuard />);
  await waitFor(() => expect(useChatHandoffStore.getState().hydrated).toBe(true));
  vi.mocked(api.saveDraftState).mockResolvedValueOnce({ success: false, error: 'Disk full' });
  useChatHandoffStore.getState().setDraft('new', 'Do not lose this');
  await useChatHandoffStore.getState().flush();
  const blocked = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(blocked);
  expect(blocked.defaultPrevented).toBe(true);
  await useChatHandoffStore.getState().flush();
  const saved = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(saved);
  expect(saved.defaultPrevented).toBe(false);
});
