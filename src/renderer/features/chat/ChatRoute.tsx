import React, { useEffect, useState, useRef } from 'react';
import { parentFsPath } from '@/common/fsPaths';
import { focusFile } from '@/renderer/features/disk-explorer/navigation';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import type { ChatSource } from '@/types/chat';
import { ThreadHeader } from './components/ThreadHeader';
import { Composer } from './components/Composer';
import { ConversationList } from './components/ConversationList';
import { IndexStatusBar } from './components/IndexStatusBar';
import { MessageThread } from './components/MessageThread';
import { useChatHandoffStore } from './store/chatHandoffStore';
import { useChatStore } from './store/chatStore';

/** Chat over the library: conversations, a cited thread, and the index controls. */
export const ChatRoute: React.FC = () => {
  const { navigateFiles, navigateTo } = useShell();
  const submitting = useRef(false);
  const [preparingSend, setPreparingSend] = useState(false);
  const conversations = useChatStore((state) => state.conversations);
  const active = useChatStore((state) => state.active);
  const streaming = useChatStore((state) => state.streaming);
  const sending = useChatStore((state) => state.sending);
  const error = useChatStore((state) => state.error);
  const index = useChatStore((state) => state.index);
  const indexError = useChatStore((state) => state.indexError);
  const load = useChatStore((state) => state.load);
  const select = useChatStore((state) => state.select);
  const startConversation = useChatStore((state) => state.startConversation);
  const updateConversation = useChatStore((state) => state.updateConversation);
  const send = useChatStore((state) => state.send);
  const cancel = useChatStore((state) => state.cancel);
  const updateIndex = useChatStore((state) => state.updateIndex);
  const cancelIndex = useChatStore((state) => state.cancelIndex);
  const draftId = active?.id ?? 'new';
  const drafts = useChatHandoffStore((state) => state.drafts);
  const draft = drafts[draftId] ?? '';
  const hydrated = useChatHandoffStore((state) => state.hydrated);
  const dirty = useChatHandoffStore((state) => state.dirty);
  const persistenceError = useChatHandoffStore((state) => state.persistenceError);
  const setDraft = useChatHandoffStore((state) => state.setDraft);
  const pending = useChatHandoffStore((state) => state.pending);
  const processing = useChatHandoffStore((state) => state.processing);
  const handoffError = useChatHandoffStore((state) => state.error);
  const consume = useChatHandoffStore((state) => state.consume);
  useEffect(() => {
    if (pending.length && !processing && !handoffError && !sending && !preparingSend) void consume();
  }, [pending, processing, handoffError, sending, preparingSend, consume]);
  const [prefill, setPrefill] = useState<{ text: string; seq: number } | null>(null);

  useEffect(() => {
    useChatStore.getState().subscribe();
    void useChatHandoffStore.getState().hydrate();
    void load();
  }, [load]);

  const openSource = (source: ChatSource) => {
    const parent = parentFsPath(source.path);
    if (!parent) return;
    recordOpened(source.path);
    navigateFiles(focusFile(parent, source.path));
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden" data-testid="chat-route">
      <ConversationList
        conversations={conversations}
        activeId={active?.id ?? null}
        onSelect={(id) => { setPrefill(null); void select(id); }}
        onNew={() => { setPrefill(null); void startConversation(); }}
        onArchive={(id, archived) => void updateConversation(id, { archived })}
        drafts={drafts}
        busy={sending || processing || preparingSend}
      />
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Chat">
        <ThreadHeader conversation={active} busy={sending || processing || preparingSend}
          onRename={(title) => active ? updateConversation(active.id, { title }) : Promise.resolve(false)}
          onOpenSource={(path) => openSource({ path, name: '', n: 1, excerpt: '', score: 0 })}
          onOpenDay={(date) => navigateTo(`/today?date=${encodeURIComponent(date)}`)} />
        <IndexStatusBar status={index} error={indexError} onUpdate={() => void updateIndex()} onCancel={() => void cancelIndex()} />
        <MessageThread
          messages={active?.messages ?? []}
          streaming={streaming}
          onOpenSource={openSource}
          onSuggest={active?.archivedAt ? undefined : (question) => setPrefill((previous) => ({ text: question, seq: (previous?.seq ?? 0) + 1 }))}
        />
        {handoffError ? <div role="alert" className="px-4 py-2 text-sm text-destructive">{handoffError} <button type="button" className="underline" onClick={() => void consume()}>Retry draft</button></div> : null}
        {error && !handoffError ? <p role="alert" className="px-4 py-1 text-xs text-destructive">{error}</p> : null}
        {processing ? <p role="status" aria-label="Preparing task draft" className="px-4 py-2 text-xs text-muted-foreground">Preparing task draft…</p> : null}
        {persistenceError ? <div role="alert" className="px-4 py-2 text-sm text-destructive">{persistenceError} <button className="underline" onClick={() => void useChatHandoffStore.getState().flush()}>Retry saving</button></div> : null}
        {active?.archivedAt ? (
          <div className="px-6 py-4 text-sm text-muted-foreground">This thread is archived. Its history and draft are kept. <button className="underline" onClick={() => void updateConversation(active.id, { archived: false })}>Restore thread</button></div>
        ) : <>
          <Composer preparing={processing || preparingSend || !hydrated} draft={draft} onDraftChange={(text) => setDraft(draftId, text)} sending={sending}
            onSend={(question) => void (async () => {
              if (submitting.current) return;
              submitting.current = true;
              setPreparingSend(true);
              try {
              if (!await useChatHandoffStore.getState().flush()) return;
              let id = draftId;
              if (id === 'new') {
                const created = await startConversation();
                if (!created) return;
                id = created;
                setDraft(id, question);
                setDraft('new', '');
                if (!await useChatHandoffStore.getState().flush()) return;
              }
              const accepted = await send(question, id);
              if (accepted && useChatHandoffStore.getState().drafts[id]?.trim() === question.trim()) setDraft(id, '');
              } finally { submitting.current = false; setPreparingSend(false); }
            })()} onCancel={cancel} prefill={prefill} />
          <p className="px-6 pb-2 text-2xs text-muted-foreground" role="status" aria-label="Draft storage">{!hydrated ? 'Loading saved drafts…' : dirty ? 'Saving draft…' : draft ? 'Draft saved on this Mac' : 'Threads are saved on this Mac'}</p>
        </>}
      </section>
    </div>
  );
};
