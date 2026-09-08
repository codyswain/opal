import React, { useEffect } from 'react';
import { useJournalStore } from './journalStore';

export function JournalPanel({path, journal, hidden, onOpen}: {path:string; journal:string; hidden:boolean; onOpen:()=>void}) {
  const draft = useJournalStore(state => state.drafts[path]);
  const { seed, edit, save, reload } = useJournalStore.getState();
  useEffect(() => { seed(path, journal); }, [path, journal, seed]);
  useEffect(() => {
    if (draft?.status !== 'dirty') return;
    const timer = setTimeout(() => void save(path), 800);
    return () => clearTimeout(timer);
  }, [path, draft?.text, draft?.status, save]);
  useEffect(() => () => { void save(path); }, [path, save]);
  return <>
    {hidden ? <p className="today-empty">Your writing is hidden. Take your time.</p> :
      <textarea aria-label="Daily journal" className="today-journal" spellCheck placeholder="What is on your mind?" value={draft?.text ?? journal}
        onChange={event => edit(path, event.target.value)} onBlur={() => void save(path)} />}
    <div className="today-footnote">
      <span role="status">{draft?.status === 'saving' ? 'Saving…' : draft?.status === 'dirty' ? 'Unsaved changes' : draft?.status === 'error' ? 'Not saved' : 'Saved to your vault'}</span>
      <button onClick={() => void save(path)} disabled={!draft || draft.status === 'saved' || draft.status === 'saving'}>Save now</button>
      {!hidden && <button onClick={onOpen}>Open daily file ↗</button>}
    </div>
    {draft?.error && <div role="alert" className="today-error">{draft.error} Your draft remains available in this session. <button onClick={() => void save(path)}>Retry save</button><button onClick={() => {
      if (window.confirm('Discard this unsaved journal draft and load the current file? This does not change the vault file.')) void reload(path);
    }}>Use saved version</button></div>}
  </>;
}
