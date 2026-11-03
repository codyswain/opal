import React, { useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { Pencil, Unlink } from 'lucide-react';
import { Button, IconButton, Popover, PopoverAnchor, PopoverContent } from '@/renderer/shared/ui';
import { setLinkEditor, type LinkEditor } from './docMode';
import { linkBetween, removeLink, writeLink, type LinkAt } from './formatCommands';
import { autolinkHref, drawnBlockAt, openLink } from './livePreview';
import { openWikiLink, parseWikiTarget } from './wikiLinks';

/** Where the link sits on screen, from its first character on its first line. */
function linkRect(view: EditorView, from: number, to: number): DOMRect {
  // A link in a drawn table's cell has no text on the page; its drawn element stands in.
  const drawn = drawnBlockAt(view.state, from) && view.contentDOM.querySelector('.cm-md-cell-caret [data-href], .cm-md-cell-caret [data-wiki-target]');
  if (drawn) return drawn.getBoundingClientRect();
  const start = view.coordsAtPos(from, 1);
  if (!start) return new DOMRect();
  const end = view.coordsAtPos(to, -1);
  const right = end && end.top === start.top ? end.right : start.right;
  return new DOMRect(start.left, start.top, Math.max(0, right - start.left), start.bottom - start.top);
}

const fieldClass = 'h-control w-full rounded-control border border-border-strong bg-canvas px-2 text-ui text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus';

interface LinkFormProps {
  view: EditorView;
  editor: LinkEditor;
  link: LinkAt | null;
}

/** The text and the address of a link, written when applied. */
const LinkForm: React.FC<LinkFormProps> = ({ view, editor, link }) => {
  const { state } = view;
  const [text, setText] = useState(() => (link ? state.sliceDoc(link.textFrom, link.textTo) : state.sliceDoc(editor.from, editor.to)));
  const [url, setUrl] = useState(link?.target ?? '');
  return (
    <form
      className="flex w-72 flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!url.trim()) return;
        view.dispatch(writeLink(view.state, editor, text, url.trim(), link), { effects: setLinkEditor.of(null) });
        view.focus();
      }}
    >
      <input aria-label="Text" value={text} onChange={(event) => setText(event.target.value)} className={fieldClass} />
      <input autoFocus aria-label="Link" placeholder="Paste or type a link" value={url} onChange={(event) => setUrl(event.target.value)} className={fieldClass} />
      <Button type="submit" size="compact" className="self-end" disabled={!url.trim()}>Apply</Button>
    </form>
  );
};

interface LinkPopoverProps {
  view: EditorView;
  editor: LinkEditor;
}

/**
 * A document's link popover. A click in a link shows its address, which
 * opens it, with Edit and Remove; Cmd+K and Edit show its text and address
 * to change. It never takes the caret out of the text until a field is
 * wanted, and focus goes back to the text when it closes.
 */
export const LinkPopover: React.FC<LinkPopoverProps> = ({ view, editor }) => {
  const link = linkBetween(view.state, editor.from, editor.to);
  const content = useRef<HTMLDivElement>(null);
  const range = useRef(editor);
  range.current = editor;
  const anchor = useRef({ getBoundingClientRect: () => linkRect(view, range.current.from, range.current.to), contextElement: view.contentDOM });
  const close = () => view.dispatch({ effects: setLinkEditor.of(null) });
  const follow = () => {
    if (!link) return;
    if (link.kind === 'wiki') void openWikiLink(view, parseWikiTarget(link.target).target);
    else openLink(view, link.kind === 'url' ? autolinkHref(link.target) : link.target, false);
  };

  return (
    <Popover open onOpenChange={(open) => { if (!open) close(); }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        ref={content}
        side="bottom"
        className="min-w-0 p-2"
        data-testid="link-popover"
        // A click in a link leaves the caret in the text; the form's field takes focus itself.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Focus goes back to the text, unless a click outside put it somewhere else.
          const active = document.activeElement;
          if (!active || active === document.body || content.current?.contains(active)) view.focus();
        }}
      >
        {editor.editing ? (
          <LinkForm key={`${editor.from}:${editor.to}`} view={view} editor={editor} link={link} />
        ) : link ? (
          <div className="flex max-w-sm items-center gap-1">
            <button
              type="button"
              title={link.target}
              onClick={follow}
              className="min-w-0 truncate rounded-control px-1.5 text-left text-ui text-foreground underline decoration-foreground-tertiary underline-offset-2 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-focus"
            >
              {link.target}
            </button>
            <IconButton label="Edit link" shortcut="⌘K" onClick={() => view.dispatch({ effects: setLinkEditor.of({ ...editor, editing: true }) })}>
              <Pencil aria-hidden className="h-4 w-4" />
            </IconButton>
            {link.kind === 'url' ? null : (
              <IconButton
                label="Remove link"
                onClick={() => {
                  const removed = removeLink(view.state, link);
                  if (removed) view.dispatch(removed, { effects: setLinkEditor.of(null) });
                  view.focus();
                }}
              >
                <Unlink aria-hidden className="h-4 w-4" />
              </IconButton>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};
