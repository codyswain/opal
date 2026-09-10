import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, MessageSquareText } from 'lucide-react';
import { Button } from '@/renderer/shared/ui';
import type { ChatMessage, ChatSource } from '@/types/chat';

interface MessageThreadProps {
  messages: ChatMessage[];
  streaming: string | null;
  hasDraft?: boolean;
  focusMessage?: { messageId: string; sequence: number } | null;
  onOpenSource: (source: ChatSource) => void;
  /** Fills the composer with a starter question. */
  onSuggest?: (question: string) => void;
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

export const SUGGESTED_QUESTIONS = [
  'What did I write about most recently?',
  'Summarize the notes in my library',
  'Which files mention a deadline?',
  'What are the open to-dos across my notes?',
];

export const MessageThread: React.FC<MessageThreadProps> = ({ messages, streaming, onOpenSource, onSuggest, hasDraft = false, focusMessage = null }) => {
  const bottom = useRef<HTMLDivElement>(null);
  const messageNodes = useRef(new Map<string, HTMLElement>());
  const handledTarget = useRef<typeof focusMessage>(null);
  useEffect(() => {
    if (focusMessage) {
      const node = messageNodes.current.get(focusMessage.messageId);
      if (node && handledTarget.current !== focusMessage) {
        node.scrollIntoView?.({ block: 'center' });
        node.focus({ preventScroll: true });
        handledTarget.current = focusMessage;
      }
      if (node) return;
    }
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, streaming, focusMessage]);

  if (messages.length === 0 && streaming === null) {
    return (
      <div className="thread-welcome" data-draft={hasDraft} data-testid="chat-empty">
        <span aria-hidden className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-focus/10 text-focus">
          <MessageSquareText className="h-6 w-6" />
        </span>
        <p className="text-base font-medium text-foreground">{hasDraft ? 'Pick up your thought' : 'A place to keep thinking'}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hasDraft ? 'Your draft is ready below. Take it wherever you want to go.' : 'A little room to untangle an idea, make a decision, or connect what you know.'}</p>
        {onSuggest && !hasDraft ? (
          <ul className="mt-6 flex max-w-lg flex-wrap justify-center gap-2" aria-label="Suggested questions">
            {SUGGESTED_QUESTIONS.map((question) => (
              <li key={question}>
                <button
                  type="button"
                  onClick={() => onSuggest(question)}
                  className="rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-xs text-foreground-secondary transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground"
                >
                  {question}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-4" data-testid="chat-thread">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {messages.map((message) => (
          <article
            key={message.id}
            ref={(node) => { if (node) messageNodes.current.set(message.id, node); else messageNodes.current.delete(message.id); }}
            tabIndex={-1}
            data-search-match={focusMessage?.messageId === message.id || undefined}
            data-testid={`chat-message-${message.role}`}
            className={message.role === 'user'
              ? 'self-end rounded-2xl bg-surface-selected px-4 py-2 text-sm'
              : 'thread-answer'}
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
                {message.cancelled && <p role="status" className="mt-2 text-xs text-muted-foreground">Stopped{message.content ? ' · partial answer saved' : ' before an answer was generated'}</p>}
                {message.retrieval && <details className="thread-retrieval-evidence">
                  <summary>{message.retrieval.method === 'calendar' ? 'Daily notes checked' : 'Library context checked'}</summary>
                  <p>{message.retrieval.summary}</p>
                </details>}
                {message.sources && message.sources.length > 0 ? <Sources sources={message.sources} onOpen={onOpenSource} /> : null}
              </>
            ) : (
              <p className="whitespace-pre-wrap">{message.content}</p>
            )}
          </article>
        ))}
        {streaming !== null ? (
          <article data-testid="chat-message-streaming" aria-live="polite" className="thread-answer">
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
