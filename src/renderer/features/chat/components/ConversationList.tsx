import React, { useState } from 'react';
import { Archive, ArchiveRestore, Plus, Search, Pin, PinOff, RotateCcw } from 'lucide-react';
import { formatRelativeTime } from '@/common/relativeTime';
import { Button, IconButton } from '@/renderer/shared/ui';
import type { ConversationSummary } from '@/types/chat';
import './threadWorkspace.css';

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onArchive: (id: string, archived: boolean) => void;
  onPin?: (id: string, pinned: boolean) => void;
  onRecoverDraft?: (id: string) => void;
  busy?: boolean;
  drafts?: Record<string, string>;
}

export const ConversationList: React.FC<ConversationListProps> = ({ conversations, activeId, onSelect, onNew, onArchive, onPin, onRecoverDraft, busy = false, drafts = {} }) => {
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const visible = conversations.filter((conversation) =>
    (conversation.archivedAt != null) === archived &&
    [conversation.title, conversation.context?.title, conversation.context?.context, conversation.context?.sourcePath, conversation.context?.date, drafts[conversation.id]]
      .some((value) => value?.toLocaleLowerCase().includes(query))
  ).sort((a, b) => Number(b.pinnedAt != null) - Number(a.pinnedAt != null) || b.updatedAt - a.updatedAt);

  const stranded = !archived && onRecoverDraft ? Object.entries(drafts).filter(([id, text]) => id !== 'new' && text.trim() && !conversations.some((thread) => thread.id === id) && (!query || text.toLocaleLowerCase().includes(query) || 'saved writing'.includes(query))) : [];

  const showScratch = !archived && Boolean(drafts.new?.trim()) &&
    (!query || 'unfinished thought'.includes(query) || drafts.new.toLocaleLowerCase().includes(query));

  return (
    <aside aria-label="Threads" className="thread-sidebar">
      <div className="thread-sidebar-heading">
        <span className="thread-eyebrow">Your threads</span>
        <Button size="compact" variant="ghost" onClick={onNew} disabled={busy}><Plus aria-hidden className="h-3.5 w-3.5" />New</Button>
      </div>
      <label className="thread-search">
        <Search aria-hidden size={14} />
        <input type="search" aria-label="Search threads" placeholder="Search names, context & drafts…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <div className="thread-filters" role="group" aria-label="Thread status">
        <button type="button" aria-pressed={!archived} onClick={() => setArchived(false)}>Active</button>
        <button type="button" aria-pressed={archived} onClick={() => setArchived(true)}>Archived</button>
      </div>
      {stranded.length > 0 && <section className="thread-recovery" aria-label="Saved recovery copies">
        <p>Saved recovery copies</p><span>Open a copy in a new thread. The original stays protected.</span>
        {stranded.map(([id], index) => <button key={id} type="button" disabled={busy} onClick={() => onRecoverDraft?.(id)} aria-label={`Recover saved writing ${index + 1}`}><RotateCcw aria-hidden size={13} />Saved writing {index + 1}</button>)}
      </section>}
      {visible.length === 0 && !showScratch ? stranded.length ? null : (
        <div className="thread-list-empty">
          <p>{query ? 'No matching threads' : archived ? 'No archived threads' : 'Room for your next thought'}</p>
          <span>{query ? 'Try a name, source, date, or word from your draft.' : archived ? 'Threads you archive will be kept here.' : 'Start a thread, or pick up a task from your day.'}</span>
        </div>
      ) : (
        <ul className="thread-list">
          {showScratch && <li className="thread-list-row" data-active={activeId === 'new' || activeId === null}>
            <button type="button" className="thread-list-select" aria-current={activeId === 'new' || activeId === null ? 'true' : undefined} disabled={busy} onClick={() => onSelect('new')}>
              <span className="thread-list-title">Unfinished thought</span>
              <span className="thread-list-meta"><span className="thread-draft">Draft</span></span>
            </button>
          </li>}
          {visible.map((conversation) => (
            <li key={conversation.id} className="thread-list-row" data-active={conversation.id === activeId}>
              <button type="button" aria-current={conversation.id === activeId ? 'true' : undefined} onClick={() => onSelect(conversation.id)} disabled={busy} className="thread-list-select">
                <span className="thread-list-title">{conversation.title}</span>
                {conversation.context?.title && <span className="thread-list-context">{conversation.context.title}</span>}
                <span className="thread-list-meta">{conversation.pinnedAt != null && <span className="thread-pin-label"><Pin aria-hidden size={10} />Pinned</span>}<span>{conversation.unreadable ? 'File kept for recovery' : formatRelativeTime(conversation.updatedAt, Date.now())}</span>{drafts[conversation.id]?.trim() && <span className="thread-draft">Draft</span>}</span>
              </button>
              {conversation.unreadable && drafts[conversation.id]?.trim() && onRecoverDraft && <IconButton label={`Recover draft for ${conversation.title}`} size="compact" onClick={() => onRecoverDraft(conversation.id)} disabled={busy}><RotateCcw aria-hidden size={14} /></IconButton>}
              {onPin && !archived && !conversation.unreadable && <IconButton label={`${conversation.pinnedAt != null ? 'Unpin' : 'Pin'} thread ${conversation.title}`} size="compact" onClick={() => onPin(conversation.id, conversation.pinnedAt == null)} disabled={busy} className="thread-archive-action">
                {conversation.pinnedAt != null ? <PinOff aria-hidden size={14} /> : <Pin aria-hidden size={14} />}
              </IconButton>}
              {!conversation.unreadable && <IconButton label={`${archived ? 'Restore' : 'Archive'} thread ${conversation.title}`} size="compact" onClick={() => onArchive(conversation.id, !archived)} disabled={busy} className="thread-archive-action">
                {archived ? <ArchiveRestore aria-hidden size={14} /> : <Archive aria-hidden size={14} />}
              </IconButton>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
};
