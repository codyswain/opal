import React, { useEffect, useState } from 'react';
import { ArrowUpRight, MessageSquare } from 'lucide-react';
import type { ConversationSummary } from '@/types/chat';
import { useShell } from '@/renderer/features/shell';
import { useChatStore } from '../store/chatStore';
import { formatRelativeTime } from '@/common/relativeTime';

/** Only loads local thread summaries; opening Today never starts an AI request. */
export function ContinueThinking() {
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState(false);
  const { navigateTo } = useShell();
  useEffect(() => {
    let current = true;
    if (!window.chatAPI?.list) return;
    void window.chatAPI.list().then((response) => {
      if (current && response.success) setThreads(response.data.filter((item) => !item.archivedAt).slice(0, 3));
    }).catch(() => undefined);
    return () => { current = false; };
  }, []);
  if (!threads.length) return null;
  return <section className="today-continue" aria-label="Continue thinking">
    <div className="today-section-heading"><h2>Continue thinking</h2><button onClick={() => navigateTo('/chat')}>All threads <ArrowUpRight size={12} /></button></div>
    <div className="today-thread-list">{threads.map((thread) => <button key={thread.id} onClick={() => void (async () => {
      try {
        await useChatStore.getState().select(thread.id);
        if (useChatStore.getState().active?.id === thread.id) navigateTo('/chat');
        else setError(true);
      } catch { setError(true); }
    })()}><MessageSquare size={14} /><span><strong>{thread.title}</strong><small>{formatRelativeTime(thread.updatedAt, Date.now())}</small></span><ArrowUpRight size={13} /></button>)}</div>
    {error && <p role="alert">This thread could not be opened. Try again in Threads.</p>}
  </section>;
}
