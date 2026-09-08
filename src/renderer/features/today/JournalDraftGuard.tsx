import { useEffect } from 'react';
import { useJournalStore } from './journalStore';

/** Stay mounted above routes: failed drafts must also block closing from Files. */
export function JournalDraftGuard(): null {
  useEffect(() => {
    const beforeClose = (event: BeforeUnloadEvent) => {
      const store = useJournalStore.getState();
      const unsaved = Object.entries(store.drafts).filter(([,draft])=>draft.status !== 'saved');
      if (!unsaved.length) return;
      event.preventDefault();
      event.returnValue = '';
      for (const [path,draft] of unsaved) if(draft.status !== 'error') void store.save(path);
    };
    window.addEventListener('beforeunload', beforeClose);
    return () => window.removeEventListener('beforeunload', beforeClose);
  }, []);
  return null;
}
