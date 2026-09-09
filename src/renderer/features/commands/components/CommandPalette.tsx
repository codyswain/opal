import { classifyFile } from '@/common/fileKind';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeft, Search, Terminal } from 'lucide-react';
import { basenameFsPath, parentFsPath } from '@/common/fsPaths';
import { formatRelativeTime } from '@/common/relativeTime';
import { browseFiles, focusFile } from '@/renderer/features/disk-explorer/navigation';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { FileKindIcon } from '@/renderer/features/disk-explorer/components/fileKindIcon';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import type { DiskEntry } from '@/types/disk';
import { commandRegistry, type Command } from '../services/commandRegistry';
import { formatShortcut, rankCommands } from '../services/matchCommand';
import { usePaletteStore } from '../store/paletteStore';

type PaletteItem =
  | { kind: 'file'; entry: DiskEntry; hint: string; excerpt?: string }
  | { kind: 'command'; command: Command };

const FILE_LIMIT = 8;
const RECENT_LIMIT = 6;
const COMMAND_LIMIT_WITH_FILES = 5;
export const FILE_SEARCH_DEBOUNCE_MS = 120;

function useCommandList(): Command[] {
  const [commands, setCommands] = useState<Command[]>(() => commandRegistry.getAllCommands());
  useEffect(() => {
    const subscription = commandRegistry.getCommandsObservable().subscribe(setCommands);
    return () => subscription.unsubscribe();
  }, []);
  return commands;
}

/** "Vault › Projects › Atlas" for a path under an opened root. */
function locate(path: string, roots: readonly string[]): string {
  const folder = parentFsPath(path);
  if (!folder) return '';
  const root = roots.find((candidate) => folder === candidate || folder.startsWith(`${candidate}/`));
  if (!root) return folder;
  return [basenameFsPath(root), ...folder.slice(root.length).split('/').filter(Boolean)].join(' › ');
}

/**
 * One box for everything: files across the opened folders and every
 * registered command. Empty shows what was touched recently; a leading `>`
 * limits results to commands, as in most editors.
 */
export const CommandPalette: React.FC = () => {
  const open = usePaletteStore((state) => state.open);
  const initialQuery = usePaletteStore((state) => state.initialQuery);
  const hide = usePaletteStore((state) => state.hide);
  const roots = useDiskStore((state) => state.roots);
  const { navigateFiles } = useShell();
  const commands = useCommandList();
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<PaletteItem[]>([]);
  const [content, setContent] = useState<PaletteItem[]>([]);
  const [deep, setDeep] = useState(false);
  const [contentStatus, setContentStatus] = useState('');
  const [recent, setRecent] = useState<PaletteItem[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);

  const commandMode = query.trimStart().startsWith('>');
  const term = (commandMode ? query.trimStart().slice(1) : query).trim();

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setActive(0);
    setFiles([]);
    const token = ++request.current;
    void window.activityAPI.recent({ limit: RECENT_LIMIT * 2 }).then((response) => {
      if (token !== request.current || !response.success) return;
      const now = Date.now();
      setRecent(response.data.items
        .filter((item) => !item.entry.isDirectory)
        .slice(0, RECENT_LIMIT)
        .map((item) => ({ kind: 'file', entry: item.entry, hint: `${item.touchedKind === 'edited' ? 'Edited' : item.touchedKind === 'organized' ? 'Organized' : 'Opened'} ${formatRelativeTime(item.touchedAt, now)}` })));
    }).catch(() => undefined);
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open || commandMode || !term) { setFiles([]); return; }
    const token = ++request.current;
    setFiles([]);
    const timer = setTimeout(() => {
      void window.collectionsAPI.query(
        { version: 1, scope: { kind: 'all-roots' }, filters: [{ field: 'name', op: 'contains', value: term.slice(0, 200) }], sort: { field: 'touched', direction: 'desc' } },
        { limit: FILE_LIMIT }
      ).then((response) => {
        if (token !== request.current) return;
        if (!response.success) { setFiles([]); return; }
        setFiles(response.data.rows.map((row) => ({ kind: 'file', entry: row.entry, hint: locate(row.entry.path, roots) })));
      }).catch(() => { if (token === request.current) setFiles([]); });
    }, FILE_SEARCH_DEBOUNCE_MS);
    return () => { request.current += 1; clearTimeout(timer); };
  }, [open, term, commandMode, roots]);

  useEffect(() => { setDeep(false); }, [term, open]);
  useEffect(() => {
    let current = true;
    setContent([]);
    setContentStatus('');
    if (!open || commandMode || term.length < 2) return;
    setContentStatus(deep ? 'Searching current text files…' : 'Searching indexed contents…');
    const timer = setTimeout(() => {
      void window.chatAPI.searchContent(term.slice(0, 200), deep).then((response) => {
        if (!current) return;
        if (!response.success) { setContentStatus('Content search failed. Try again.'); return; }
        setContent(response.data.hits.map((hit) => ({ kind: 'file', entry: { path: hit.path, name: hit.name, kind: classifyFile(hit.name), isDirectory: false, size: 0, mtimeMs: 0 }, hint: locate(hit.path, roots), excerpt: hit.excerpt })));
        setContentStatus(`${deep ? 'Current Markdown and text files' : 'Indexed contents · may exclude new changes'}${response.data.incomplete ? ' · partial results (search limits or unreadable files)' : ''}`);
      }).catch(() => { if (current) setContentStatus('Content search failed. Try again.'); });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [open, commandMode, term, deep, roots]);

  const sections = useMemo((): { title: string; items: PaletteItem[] }[] => {
    const matched = rankCommands(commands, term, commandMode ? Infinity : term ? COMMAND_LIMIT_WITH_FILES : Infinity)
      .map((command): PaletteItem => ({ kind: 'command', command }));
    if (commandMode) return [{ title: 'Commands', items: matched }];
    if (!term) return [{ title: 'Recent', items: recent }, { title: 'Commands', items: matched }].filter((section) => section.items.length > 0);
    return [{ title: 'Files', items: files.map((item) => item.kind === 'file' ? (content.find((hit) => hit.kind === 'file' && hit.entry.path === item.entry.path) ?? item) : item) }, { title: deep ? 'Inside current text files' : 'Inside indexed files', items: content.filter((item) => item.kind === 'file' && !files.some((file) => file.kind === 'file' && file.entry.path === item.entry.path)) }, { title: 'Commands', items: matched }].filter((section) => section.items.length > 0);
  }, [commands, term, commandMode, recent, files, content, deep]);
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => { setActive(0); }, [term, commandMode]);
  useEffect(() => {
    if (active >= flat.length) setActive(Math.max(0, flat.length - 1));
  }, [flat.length, active]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const run = (item: PaletteItem) => {
    hide();
    if (item.kind === 'command') { commandRegistry.executeCommand(item.command.id); return; }
    const { path, isDirectory } = item.entry;
    if (isDirectory) { navigateFiles(browseFiles(path)); return; }
    const folder = parentFsPath(path);
    if (!folder) return;
    recordOpened(path);
    navigateFiles(focusFile(folder, path));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (flat.length ? (index + 1) % flat.length : 0)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (flat.length ? (index - 1 + flat.length) % flat.length : 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); const item = flat[active]; if (item) run(item); }
  };

  let position = -1;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) hide(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          aria-label="Search files and commands"
          data-testid="command-palette"
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-[14vh] z-50 w-[640px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-overlay border border-border-subtle bg-surface-raised text-foreground shadow-overlay outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          <DialogPrimitive.Title className="sr-only">Search files and commands</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Type to search files across your opened folders, or start with &gt; for commands.</DialogPrimitive.Description>
          <div className="flex items-center gap-3 border-b border-border-subtle px-4">
            <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search names and contents, or > for commands"
              aria-label="Search files and commands"
              aria-activedescendant={flat[active] ? `palette-item-${active}` : undefined}
              role="combobox"
              aria-expanded
              aria-controls="palette-results"
              aria-autocomplete="list"
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {commandMode ? <span className="rounded bg-surface-hover px-1.5 py-0.5 text-2xs text-muted-foreground">Commands</span> : null}
          </div>
          <div ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-1.5">
            {flat.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {term ? `Nothing matches “${term}”` : 'Open a folder to search its files.'}
              </p>
            ) : sections.map((section) => (
              <div key={section.title} role="group" aria-label={section.title}>
                <p className="px-2.5 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-foreground-tertiary">{section.title}</p>
                {section.items.map((item) => {
                  position += 1;
                  const index = position;
                  const selected = index === active;
                  const key = item.kind === 'file' ? item.entry.path : item.command.id;
                  return (
                    <div
                      key={key}
                      id={`palette-item-${index}`}
                      role="option"
                      aria-selected={selected}
                      data-index={index}
                      data-testid={item.kind === 'file' ? `palette-file-${item.entry.path}` : `palette-command-${item.command.id}`}
                      onMouseMove={() => setActive(index)}
                      onClick={() => run(item)}
                      className={`flex min-h-9 py-2 cursor-default items-center gap-3 rounded-row px-2.5 text-sm ${selected ? 'bg-surface-active text-foreground' : 'text-foreground-secondary'}`}
                    >
                      {item.kind === 'file' ? (
                        <>
                          <FileKindIcon kind={item.entry.kind} className="h-4 w-4" />
                          <span className="min-w-0 flex-1 truncate">
                            <span className="text-foreground">{item.entry.name}</span>
                            {item.excerpt && <span className="block truncate text-xs text-foreground-secondary">{item.excerpt}</span>}
                            {item.hint ? <span className="ml-2 text-2xs text-muted-foreground">{item.hint}</span> : null}
                          </span>
                        </>
                      ) : (
                        <>
                          <Terminal aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-foreground">{item.command.name}</span>
                          {item.command.shortcut?.[0] ? (
                            <kbd className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-sans text-2xs text-muted-foreground">{formatShortcut(item.command.shortcut[0])}</kbd>
                          ) : null}
                        </>
                      )}
                      {selected ? <CornerDownLeft aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {!commandMode && term.length >= 2 && <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-2 text-2xs text-muted-foreground">
            <span role="status">{contentStatus}</span>
            <button type="button" className="shrink-0 text-focus hover:underline" disabled={deep} onKeyDown={(event) => event.stopPropagation()} onClick={() => setDeep(true)}>{deep ? 'Local search' : 'Search current text files'}</button>
          </div>}
          <div className="flex items-center gap-4 border-t border-border-subtle px-4 py-2 text-2xs text-muted-foreground">
            <span><kbd className="font-sans">↑↓</kbd> navigate</span>
            <span><kbd className="font-sans">↵</kbd> open</span>
            <span><kbd className="font-sans">&gt;</kbd> commands</span>
            <span className="ml-auto"><kbd className="font-sans">esc</kbd> close</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
