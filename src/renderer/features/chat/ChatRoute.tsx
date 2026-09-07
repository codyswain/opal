import React, { useEffect, useState } from 'react';
import { parentFsPath } from '@/common/fsPaths';
import { focusFile } from '@/renderer/features/disk-explorer/navigation';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import type { ChatSource } from '@/types/chat';
import { Composer } from './components/Composer';
import { ConversationList } from './components/ConversationList';
import { IndexStatusBar } from './components/IndexStatusBar';
import { MessageThread } from './components/MessageThread';
import { useChatStore } from './store/chatStore';

/** Chat over the library: conversations, a cited thread, and the index controls. */
export const ChatRoute: React.FC = () => {
  const { navigateFiles } = useShell();
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
  const removeConversation = useChatStore((state) => state.removeConversation);
  const send = useChatStore((state) => state.send);
  const cancel = useChatStore((state) => state.cancel);
  const updateIndex = useChatStore((state) => state.updateIndex);
  const cancelIndex = useChatStore((state) => state.cancelIndex);
  const [prefill, setPrefill] = useState<{ text: string; seq: number } | null>(null);

  useEffect(() => {
    useChatStore.getState().subscribe();
    void load();
  }, [load]);

  const openSource = (source: ChatSource) => {
    const parent = parentFsPath(source.path);
    if (!parent) return;
    recordOpened(source.path);
    navigateFiles(focusFile(parent, source.path));
  };

  return (
    <div className="flex h-full min-h-0" data-testid="chat-route">
      <ConversationList
        conversations={conversations}
        activeId={active?.id ?? null}
        onSelect={(id) => void select(id)}
        onNew={() => void startConversation()}
        onRemove={(id) => void removeConversation(id)}
      />
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Chat">
        <IndexStatusBar status={index} error={indexError} onUpdate={() => void updateIndex()} onCancel={() => void cancelIndex()} />
        <MessageThread
          messages={active?.messages ?? []}
          streaming={streaming}
          onOpenSource={openSource}
          onSuggest={(question) => setPrefill((previous) => ({ text: question, seq: (previous?.seq ?? 0) + 1 }))}
        />
        {error ? <p role="alert" className="px-4 py-1 text-xs text-destructive">{error}</p> : null}
        <Composer sending={sending} onSend={(question) => void send(question)} onCancel={cancel} prefill={prefill} />
      </section>
    </div>
  );
};
