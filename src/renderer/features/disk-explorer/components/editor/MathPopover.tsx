import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Button, Popover, PopoverAnchor, PopoverContent } from '@/renderer/shared/ui';
import { mathNodeAt } from './math';
import { pageMacros, renderTex } from './mathWidget';
import {
  applyTyped,
  clickedFormula,
  closeMathEditor,
  editorFor,
  mathEditor,
  mathWrite,
  notAFormula,
  restoreDollars,
  setMathEditor,
  switchDisplay,
  writeLive,
  type MathEditor,
} from './mathWrite';
import { syntaxTree } from '@codemirror/language';

const MAX_ROWS = 8;

/** Where the formula is on screen: its drawn element, or its first and last characters. */
function formulaRect(view: EditorView, editor: MathEditor): DOMRect {
  for (const element of view.contentDOM.querySelectorAll<HTMLElement>('.cm-math')) {
    let at: number;
    try { at = view.posAtDOM(element); } catch { continue; }
    if (at >= editor.from && at <= editor.to) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) return rect;
    }
  }
  const start = view.coordsAtPos(editor.from, 1);
  if (!start) return new DOMRect();
  const end = view.coordsAtPos(editor.to, -1);
  const right = end && end.top === start.top ? Math.max(end.right, start.left + 1) : start.left + 1;
  return new DOMRect(start.left, start.top, right - start.left, start.bottom - start.top);
}

/** The line and column of `at` in `text`. */
function lineColumn(text: string, at: number): { line: number; column: number } {
  const before = text.slice(0, at).split('\n');
  return { line: before.length - 1, column: before[before.length - 1].length };
}

interface MathPopoverProps {
  view: EditorView;
  editor: MathEditor;
}

/**
 * A document's formula popover: a live preview, the TeX, KaTeX's message,
 * and Inline/Display, "Not a formula" and Done. The TeX is written as you
 * type; closing it, by Done, Escape, a click elsewhere, the window losing
 * focus or the formula scrolling away, keeps what was written as one undo
 * step and puts the caret after the formula. It stays where it opened.
 */
export const MathPopover: React.FC<MathPopoverProps> = ({ view, editor }) => {
  const [field, setField] = useState(editor.tex);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const caret = useRef<number | null>(null);
  const shown = useRef(editor);
  shown.current = editor;
  const value = useRef(field);
  value.current = field;
  const display = editor.kind !== 'inline';
  const macros = view.state.field(pageMacros, false) ?? undefined;
  const rendered = useMemo(() => (field.trim() ? renderTex(field.trim(), display, macros) : null), [field, display, macros]);
  // Fixed where it opened, so the popover never jumps while the formula's size changes.
  const anchorRect = useRef<DOMRect | null>(null);
  if (!anchorRect.current) {
    anchorRect.current = clickedFormula.get(view) ?? formulaRect(view, editor);
    clickedFormula.delete(view);
  }
  const anchor = useRef({ getBoundingClientRect: () => anchorRect.current ?? new DOMRect(), contextElement: view.contentDOM });

  // An edit from elsewhere to the formula shows its new TeX.
  useEffect(() => {
    if (editor.version > 0) setField(editor.tex);
  }, [editor.version]);

  useLayoutEffect(() => {
    const element = fieldRef.current;
    if (!element || caret.current === null) return;
    element.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  const close = (keepFocus = true) => {
    if (!view.state.field(mathEditor, false)) return;
    closeMathEditor(view, value.current, keepFocus);
  };

  // Closes keeping what was written when the window loses focus, the formula scrolls out of view, or the page goes.
  useEffect(() => {
    const onBlur = () => close(false);
    const onScroll = () => {
      const rect = formulaRect(view, shown.current);
      const box = view.scrollDOM.getBoundingClientRect();
      if (rect.bottom < box.top || rect.top > box.bottom) close(false);
    };
    window.addEventListener('blur', onBlur);
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('blur', onBlur);
      view.scrollDOM.removeEventListener('scroll', onScroll);
      if (view.dom.isConnected && view.state.field(mathEditor, false)) closeMathEditor(view, value.current, false);
    };
  }, [view]);

  const onInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const typed = applyTyped(field, event.target.value, event.target.selectionStart, editor.table);
    setField(typed.value);
    caret.current = typed.caret;
    const current = view.state.field(mathEditor, false);
    if (!current) return;
    writeLive(view, current, typed.value, (tex) => renderTex(tex, current.kind !== 'inline', macros).error === null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey || editor.kind !== 'block'))) {
      event.preventDefault();
      close();
    } else if (event.key === 'Backspace' && editor.dollars && field === '') {
      event.preventDefault();
      restoreDollars(view);
    }
  };

  const toggleDisplay = (toDisplay: boolean) => {
    if (toDisplay === display) return;
    const current = view.state.field(mathEditor, false);
    if (!current) return;
    const result = switchDisplay(view.state, current);
    if (result.problem) {
      view.dispatch({ effects: setMathEditor.of({ ...current, problem: result.problem }) });
      return;
    }
    view.dispatch({ changes: result.changes, annotations: [mathWrite.of('live'), Transaction.addToHistory.of(false)] });
    const node = mathNodeAt(syntaxTree(view.state), result.anchor, -1);
    if (!node) return;
    const next = editorFor(view.state, node);
    view.dispatch({ effects: setMathEditor.of({ ...next, id: current.id, opening: current.opening, version: current.version }) });
    setField(next.tex);
  };

  const notFormula = () => {
    const current = view.state.field(mathEditor, false);
    if (!current) return;
    const live = view.state.sliceDoc(current.from, current.to);
    if (live !== current.opening) {
      view.dispatch({ changes: { from: current.from, to: current.to, insert: current.opening }, annotations: [mathWrite.of('restore'), Transaction.addToHistory.of(false)] });
    }
    const changes = notAFormula(view.state, current.from, current.from + current.opening.length);
    view.dispatch({ changes: changes ?? [], effects: setMathEditor.of(null), annotations: [mathWrite.of('final')], userEvent: 'input.math' });
    view.focus();
  };

  const rows = Math.min(MAX_ROWS, Math.max(1, field.split('\n').length));
  const problem = editor.problem ?? rendered?.error ?? null;
  const at = rendered?.errorAt ?? null;
  const spot = at !== null && editor.problem === null ? lineColumn(field.trim(), at) : null;

  return (
    <Popover open onOpenChange={(open) => { if (!open) close(); }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        ref={content}
        side="bottom"
        align="center"
        className="w-auto max-w-none p-3"
        data-testid="math-popover"
        aria-label="Formula"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          fieldRef.current?.focus();
          fieldRef.current?.setSelectionRange(field.length, field.length);
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="opal-math-popover">
          <div className="opal-math-preview" aria-hidden>
            {rendered === null ? (
              <span className="opal-math-preview-empty">Type TeX below</span>
            ) : rendered.error === null ? (
              <span dangerouslySetInnerHTML={{ __html: rendered.html }} />
            ) : editor.lastGood ? (
              <span dangerouslySetInnerHTML={{ __html: renderTex(editor.lastGood, display, macros).html }} />
            ) : (
              <span className="opal-math-preview-empty">Nothing to show yet</span>
            )}
          </div>
          <textarea
            ref={fieldRef}
            aria-label="TeX"
            className="opal-math-field"
            rows={rows}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            value={field}
            placeholder={display ? '\\int_0^1 f(x)\\,dx' : 'E = mc^2'}
            onChange={onInput}
            onKeyDown={onKeyDown}
          />
          <div className="opal-math-problem" role="status" aria-live="polite">
            {problem && spot && spot.line === 0 && spot.column < 48 ? (
              <span className="opal-math-problem-caret" aria-hidden>{`${' '.repeat(spot.column)}^`}</span>
            ) : null}
            {problem}
          </div>
          <div className="opal-math-footer">
            <div className="opal-math-segments" role="group" aria-label="Formula layout">
              <button type="button" className="opal-math-segment" aria-pressed={!display} onClick={() => toggleDisplay(false)}>Inline</button>
              <button type="button" className="opal-math-segment" aria-pressed={display} disabled={editor.table} onClick={() => toggleDisplay(true)}>Display</button>
            </div>
            <span className="flex-1" />
            {editor.opening ? <button type="button" className="opal-math-quiet" onClick={notFormula}>Not a formula</button> : null}
            <Button size="compact" onClick={() => close()}>Done</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
