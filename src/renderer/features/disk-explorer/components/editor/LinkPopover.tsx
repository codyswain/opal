import React, { useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { Pencil, Unlink } from 'lucide-react';
import { fileTreeLabel } from '@/common/fileKind';
import { Button, IconButton, Popover, PopoverAnchor, PopoverContent } from '@/renderer/shared/ui';
import type { DiskEntry } from '@/types/disk';
import { setLinkEditor, type LinkEditor } from './docMode';
import { linkBetween, removeLink, typedLinkText, writeLink, type LinkAt } from './formatCommands';
import { autolinkHref, docMode, drawnBlockAt, openLink } from './livePreview';
import { visibleSlice } from './visibleText';
import { openWikiLink, pageContext, parseWikiTarget } from './wikiLinks';
import { relativePath } from './fileActions';
import { findLinkTargets, folderOf, pickedText } from './linkPicker';

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

/**
 * The text and the address of a link, written when applied. The text field
 * shows the text as the page does; unchanged, the link keeps its text as
 * written, and typed text is written so it shows as typed.
 */
const LinkForm: React.FC<LinkFormProps> = ({ view, editor, link }) => {
  const { state } = view;
  const [written] = useState(() => (link ? { from: link.textFrom, to: link.textTo } : { from: editor.from, to: editor.to }));
  const [shown] = useState(() => (state.facet(docMode) ? visibleSlice(state, written.from, written.to) : state.sliceDoc(written.from, written.to)));
  const [text, setText] = useState(shown);
  const [url, setUrl] = useState(link?.target ?? '');
  return (
    <form
      className="flex w-72 flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!url.trim()) return;
        const { state: now } = view;
        const raw = text === shown ? now.sliceDoc(written.from, written.to) : now.facet(docMode) ? typedLinkText(text) : text;
        view.dispatch(writeLink(now, editor, raw, url.trim(), link), { effects: setLinkEditor.of(null) });
        view.focus();
      }}
    >
      <input aria-label="Text" value={text} onChange={(event) => setText(event.target.value)} className={fieldClass} />
      <input autoFocus aria-label="Link" placeholder="Paste or type a link" value={url} onChange={(event) => setUrl(event.target.value)} className={fieldClass} />
      <AddressMatches view={view} typed={url} wiki={link?.kind === 'wiki'} onPick={setUrl} />
      <Button type="submit" size="compact" className="self-end" disabled={!url.trim()}>Apply</Button>
    </form>
  );
};

/** A pick's address: a wiki target from the vault's top, or a path relative to the page with each segment encoded. */
function addressOf(view: EditorView, entry: DiskEntry, wiki: boolean): string {
  const target = pickedText(entry, view.state.facet(pageContext).path, false, true).target;
  if (wiki) return target;
  return relativePath(view.state.facet(pageContext).path, entry.path).split('/').map(encodeURIComponent).join('/');
}

/** Notes, documents and files matching what is typed in the address field, as the "[[" picker lists them. */
const AddressMatches: React.FC<{ view: EditorView; typed: string; wiki: boolean; onPick: (address: string) => void }> = ({ view, typed, wiki, onPick }) => {
  const [matches, setMatches] = useState<DiskEntry[]>([]);
  const query = /^[a-z][a-z0-9+.-]*:|^www\./i.test(typed.trim()) ? '' : typed.trim();
  useEffect(() => {
    let live = true;
    if (!query) {
      setMatches([]);
      return undefined;
    }
    const timer = setTimeout(() => { void findLinkTargets(query, 6).then((found) => { if (live) setMatches(found); }); }, 80);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  if (matches.length === 0) return null;
  return (
    <ul role="listbox" aria-label="Notes and files" data-testid="link-address-matches" className="-mt-1 flex flex-col">
      {matches.map((entry) => (
        <li key={entry.path} role="option" aria-selected={false}>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(addressOf(view, entry, wiki))}
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-ui text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <span className="min-w-0 truncate">{fileTreeLabel(entry.name, entry.kind)}</span>
            <span className="ml-auto min-w-0 truncate pl-2 text-metadata text-foreground-tertiary">{folderOf(entry.path)}</span>
          </button>
        </li>
      ))}
    </ul>
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
