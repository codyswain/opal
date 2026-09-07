import React, { useState } from 'react';
import { SendHorizontal, Square } from 'lucide-react';
import { Button } from '@/renderer/shared/ui';

interface ComposerProps {
  sending: boolean;
  onSend: (question: string) => void;
  onCancel: () => void;
}

export const Composer: React.FC<ComposerProps> = ({ sending, onSend, onCancel }) => {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const text = draft.trim();
    if (!text || sending) return;
    onSend(text);
    setDraft('');
  };
  return (
    <form
      className="flex shrink-0 items-end gap-2 border-t border-border/60 px-4 py-3"
      onSubmit={(event) => { event.preventDefault(); submit(); }}
    >
      <textarea
        aria-label="Ask about your library"
        value={draft}
        rows={Math.min(6, Math.max(1, draft.split('\n').length))}
        placeholder="Ask about your files… Enter to send, Shift+Enter for a new line"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
        }}
        className="min-h-9 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      {sending ? (
        <Button type="button" variant="outline" onClick={onCancel} aria-label="Stop">
          <Square aria-hidden className="h-4 w-4" />
        </Button>
      ) : (
        <Button type="submit" disabled={!draft.trim()} aria-label="Send">
          <SendHorizontal aria-hidden className="h-4 w-4" />
        </Button>
      )}
    </form>
  );
};
