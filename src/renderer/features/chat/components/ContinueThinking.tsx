import React, { useEffect, useState } from 'react';
import { ArrowUpRight, MessageSquare, Pin } from 'lucide-react';
import type { ConversationSummary } from '@/types/chat';
import { useShell } from '@/renderer/features/shell';
import { useChatStore } from '../store/chatStore';
import { formatRelativeTime } from '@/common/relativeTime';

/** Only loads local thread summaries; opening Today never starts an AI request. */
export function ContinueThinking() {
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const { navigateTo } = useShell();
  useEffect(() => {
    let current = true;
    if (!window.chatAPI?.list) return;
    setLoading(true);
    void window.chatAPI.list().then((response) => {
      if (!current) return;
      if (!response.success) { setLoadError(true); return; }
      setLoadError(false);
      setThreads(response.data.filter((item) => !item.archivedAt && !item.unreadable).sort((a, b) => Number(b.pinnedAt != null) - Number(a.pinnedAt != null) || b.updatedAt - a.updatedAt).slice(0, 3));
    }).catch(() => { if (current) setLoadError(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [retry]);
  if (!threads.length && !loadError) return null;
  return <section className="today-continue" aria-label="Continue thinking">
    <div className="today-section-heading"><h2>Continue thinking</h2><button onClick={() => navigateTo('/chat')}>All threads <ArrowUpRight size={12} /></button></div>
    {loadError && <div className="today-thread-load-error"><p role="alert">Could not load your threads. Your saved files are unchanged.</p><button type="button" disabled={loading} aria-label="Retry loading threads" onClick={() => setRetry(value => value + 1)}>{loading ? 'Loading…' : 'Try again'}</button></div>}
    <div className="today-thread-list">{threads.map((thread) => <button key={thread.id} onClick={() => void (async () => {
      try {
        await useChatStore.getState().select(thread.id);
        if (useChatStore.getState().active?.id === thread.id) navigateTo('/chat');
        else setError(true);
      } catch { setError(true); }
    })()}>{thread.pinnedAt != null ? <Pin size={14} aria-label="Pinned" /> : <MessageSquare size={14} />}<span><strong>{thread.title}</strong><small>{formatRelativeTime(thread.updatedAt, Date.now())}</small></span><ArrowUpRight size={13} /></button>)}</div>
    {error && <p role="alert">This thread could not be opened. Try again in Threads.</p>}
  </section>;
}
