import { useEffect } from 'react';
import { useChatHandoffStore } from '../store/chatHandoffStore';

/** Protect outstanding writes even after navigating away from Threads. */
export function ChatDraftGuard(): null {
  useEffect(() => {
    void useChatHandoffStore.getState().hydrate();
    const guard = (event: BeforeUnloadEvent) => {
      const state = useChatHandoffStore.getState();
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
      if (!state.persistenceError) void state.flush();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  return null;
}
