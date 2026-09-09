import React, { useEffect, useState } from 'react';
import { CalendarDays, FileText, Pencil } from 'lucide-react';
import { Button, IconButton } from '@/renderer/shared/ui';
import type { Conversation } from '@/types/chat';
import './threadWorkspace.css';

interface ThreadHeaderProps {
  conversation: Conversation | null;
  busy: boolean;
  onRename: (title: string) => Promise<boolean>;
  onOpenSource: (path: string) => void;
  onOpenDay: (date: string) => void;
}

export const ThreadHeader: React.FC<ThreadHeaderProps> = ({ conversation, busy, onRename, onOpenSource, onOpenDay }) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setEditing(false); setTitle(conversation?.title ?? ''); }, [conversation?.id]);
  const save = async () => {
    if (!title.trim() || saving || busy) return;
    setSaving(true);
    try { if (await onRename(title.trim())) setEditing(false); }
    finally { setSaving(false); }
  };
  const context = conversation?.context;
  const sourcePath = context?.sourcePath;
  const sourceName = sourcePath?.split(/[\\/]/).pop();
  return (
    <header className="thread-header">
      <div className="thread-eyebrow">{conversation ? 'Thread' : 'A thread of your own'}{conversation?.archivedAt != null && <span className="thread-archived-badge">Archived</span>}</div>
      {editing ? (
        <form className="thread-rename" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <input aria-label="Thread name" autoFocus maxLength={200} value={title} disabled={saving} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && !saving) { event.preventDefault(); setEditing(false); } }} />
          <Button type="submit" size="compact" disabled={!title.trim() || saving || busy}>Save</Button>
          <Button type="button" variant="ghost" size="compact" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      ) : (
        <div className="thread-header-title-row">
          <h1>{conversation?.title ?? 'What would you like to work through?'}</h1>
          {conversation && <IconButton label="Rename thread" disabled={busy} onClick={() => { setTitle(conversation.title); setEditing(true); }}><Pencil aria-hidden size={14} /></IconButton>}
        </div>
      )}
      {context && (
        <div className="thread-origin">
          <span className="thread-origin-title">From {context.title}</span>
          <div className="thread-origin-links">
            <button type="button" onClick={() => onOpenDay(context.date)}><CalendarDays aria-hidden size={12} /><time dateTime={context.date}>{context.date}</time></button>
            {sourcePath && <button type="button" title={sourcePath} onClick={() => onOpenSource(sourcePath)}><FileText aria-hidden size={12} /><span>{sourceName}</span></button>}
          </div>
          {context.context && <details className="thread-context"><summary>Original context</summary><p>{context.context}</p></details>}
        </div>
      )}
    </header>
  );
};
