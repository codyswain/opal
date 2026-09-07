import React from 'react';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { formatRelativeTime } from '@/common/relativeTime';
import { Button, IconButton } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import type { ConversationSummary } from '@/types/chat';

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRemove: (id: string) => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({ conversations, activeId, onSelect, onNew, onRemove }) => (
  <aside aria-label="Conversations" className="flex h-full w-64 shrink-0 flex-col border-r border-border/60">
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-metadata font-medium uppercase tracking-[0.08em] text-foreground-tertiary">Conversations</span>
      <Button size="compact" variant="ghost" onClick={onNew}>
        <Plus aria-hidden className="h-3.5 w-3.5" />
        New
      </Button>
    </div>
    {conversations.length === 0 ? (
      <p className="px-3 py-2 text-control text-foreground-tertiary">Ask a question to start one.</p>
    ) : (
      <ul className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {conversations.map((conversation) => (
          <li key={conversation.id} className="group flex items-center">
            <button
              type="button"
              aria-current={conversation.id === activeId ? 'true' : undefined}
              onClick={() => onSelect(conversation.id)}
              className={cn(
                'flex min-w-0 flex-1 flex-col rounded-row px-2 py-1.5 text-left text-ui text-foreground-secondary hover:bg-surface-hover hover:text-foreground',
                conversation.id === activeId && 'bg-surface-selected text-foreground'
              )}
            >
              <span className="flex items-center gap-2">
                <MessageSquare aria-hidden className="h-3.5 w-3.5 shrink-0 text-icon" />
                <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
              </span>
              <span className="pl-5 text-2xs text-foreground-tertiary">{formatRelativeTime(conversation.updatedAt, Date.now())}</span>
            </button>
            <IconButton label={`Remove conversation ${conversation.title}`} size="compact" onClick={() => onRemove(conversation.id)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
            </IconButton>
          </li>
        ))}
      </ul>
    )}
  </aside>
);
