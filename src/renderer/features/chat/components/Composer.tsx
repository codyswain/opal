import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, SendHorizontal, Square } from 'lucide-react';
import { Button, IconButton } from '@/renderer/shared/ui';
import './writingControls.css';

interface ComposerProps {
  sending: boolean;
  preparing?: boolean;
  onSend: (question: string) => void;
  onCancel: () => void;
  draft: string;
  onDraftChange: (text: string) => void;
  /** Text handed in from outside (a suggested question); adopted and focused when it changes. */
  prefill?: { text: string; seq: number } | null;
  saveStatus?: string;
  focusRequest?: number;
}

const QUESTION_LIMIT = 8000;

export const Composer: React.FC<ComposerProps> = ({ sending, onSend, onCancel, draft, onDraftChange, preparing = false, prefill = null, saveStatus, focusRequest = 0 }) => {
  const prefillRef = useRef<HTMLTextAreaElement>(null);
  const appliedPrefill = useRef<ComposerProps['prefill']>(null);
  const composing = useRef(false);
  const focusedRequest = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const helpId = useId();
  const limitId = useId();
  const overLimit = draft.length > QUESTION_LIMIT;
  const nearLimit = draft.length >= QUESTION_LIMIT * 0.9;

  useEffect(() => {
    if (!prefill || appliedPrefill.current === prefill) return;
    appliedPrefill.current = prefill;
    onDraftChange(draft ? `${draft}\n\n${prefill.text}` : prefill.text);
    prefillRef.current?.focus();
  }, [prefill, draft, onDraftChange]);

  useEffect(() => {
    if (focusRequest !== focusedRequest.current && !preparing && !sending) {
      prefillRef.current?.focus();
      focusedRequest.current = focusRequest;
    }
  }, [focusRequest, preparing, sending]);

  useLayoutEffect(() => {
    const textarea = prefillRef.current;
    if (!textarea) return;
    const resize = () => {
      if (expanded) {
        textarea.style.height = 'clamp(120px, 40vh, 360px)';
      } else {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(180, Math.max(60, textarea.scrollHeight))}px`;
      }
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        resize();
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [draft, expanded]);

  const submit = () => {
    const text = draft.trim();
    if (!text || sending || preparing || overLimit || composing.current) return;
    onSend(text);
  };

  return (
    <form className="writing-composer" data-expanded={expanded} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <div className="writing-surface">
        <textarea
          ref={prefillRef}
          disabled={preparing || sending}
          aria-label="Ask about your library"
          aria-describedby={`${helpId}${nearLimit ? ` ${limitId}` : ''}`}
          aria-invalid={overLimit || undefined}
          value={draft}
          rows={2}
          maxLength={QUESTION_LIMIT}
          placeholder="Make room for a thought…"
          onChange={(event) => onDraftChange(event.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !composing.current) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="writing-footer">
          <div className="writing-footer-notes">
            <span id={helpId} className="writing-keyboard-hint">Shift+Enter for a new line</span>
            {saveStatus && <span className="writing-save-status" role="status" aria-label="Draft storage">{saveStatus}</span>}
          </div>
          <div className="writing-actions">
            {nearLimit && <span id={limitId} className="writing-character-count" data-invalid={overLimit}>{draft.length.toLocaleString()} / 8,000{overLimit && <span className="sr-only"> characters. Shorten your message to send.</span>}</span>}
            <IconButton label={expanded ? 'Collapse writing room' : 'Expand writing room'} disabled={preparing || sending} aria-expanded={expanded} onClick={() => { setExpanded((value) => !value); prefillRef.current?.focus(); }}>
              {expanded ? <Minimize2 aria-hidden size={14} /> : <Maximize2 aria-hidden size={14} />}
            </IconButton>
            {sending ? (
              <Button type="button" variant="outline" onClick={onCancel} aria-label="Stop" className="writing-send"><Square aria-hidden size={14} /></Button>
            ) : (
              <Button type="submit" disabled={preparing || !draft.trim() || overLimit} aria-label="Send" className="writing-send"><SendHorizontal aria-hidden size={15} /></Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
};
