import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/renderer/shared/ui';
import type { ChatMessage, ChatSource } from '@/types/chat';

interface MessageThreadProps {
  messages: ChatMessage[];
  streaming: string | null;
  onOpenSource: (source: ChatSource) => void;
}

const Sources: React.FC<{ sources: ChatSource[]; onOpen: (source: ChatSource) => void }> = ({ sources, onOpen }) => (
  <ol aria-label="Sources" className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2 text-xs">
    {sources.map((source) => (
      <li key={source.n} className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 font-medium tabular-nums">{source.n}</span>
        <span className="min-w-0 flex-1 truncate" title={source.path}>
          {source.name}
          {source.page ? <span className="text-muted-foreground"> · page {source.page}</span> : null}
        </span>
        <Button size="compact" variant="ghost" aria-label={`Open ${source.name}`} onClick={() => onOpen(source)}>
          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          Open
        </Button>
      </li>
    ))}
  </ol>
);

export const MessageThread: React.FC<MessageThreadProps> = ({ messages, streaming, onOpenSource }) => {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }); }, [messages.length, streaming]);

  if (messages.length === 0 && streaming === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Ask about anything in your library. Answers cite the files they come from.
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-4" data-testid="chat-thread">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {messages.map((message) => (
          <article
            key={message.id}
            data-testid={`chat-message-${message.role}`}
            className={message.role === 'user'
              ? 'self-end rounded-2xl bg-surface-selected px-4 py-2 text-sm'
              : 'rounded-2xl border border-border/60 bg-surface px-4 py-3 text-sm'}
          >
            {message.role === 'assistant' ? (
              <>
                {message.error ? (
                  <p role="alert" className="text-destructive">{message.error}</p>
                ) : (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  </div>
                )}
                {message.sources && message.sources.length > 0 ? <Sources sources={message.sources} onOpen={onOpenSource} /> : null}
              </>
            ) : (
              <p className="whitespace-pre-wrap">{message.content}</p>
            )}
          </article>
        ))}
        {streaming !== null ? (
          <article data-testid="chat-message-streaming" aria-live="polite" className="rounded-2xl border border-border/60 bg-surface px-4 py-3 text-sm">
            {streaming ? (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>
              </div>
            ) : (
              <span className="text-muted-foreground">Thinking…</span>
            )}
          </article>
        ) : null}
        <div ref={bottom} />
      </div>
    </div>
  );
};
