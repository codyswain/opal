import { SearchHighlight } from './SearchHighlight';
import { classifyFile, fileTreeLabel } from '@/common/fileKind';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { focusFile } from '@/renderer/features/disk-explorer/navigation';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { vaultFolder, vaultRelativePath } from '@/renderer/features/disk-explorer/components/tabLabels';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import type { DiskEntry } from '@/types/disk';
import { commandRegistry, type Command } from '../services/commandRegistry';
import { formatShortcut, rankCommands, sentenceCase } from '../services/matchCommand';
import { usePaletteStore } from '../store/paletteStore';

type PaletteItem =
  | { kind: 'file'; entry: DiskEntry; excerpt?: string }
  | { kind: 'command'; command: Command };

const itemKey = (item: PaletteItem): string => item.kind === 'file' ? `file:${item.entry.path}` : `command:${item.command.id}`;

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

/**
 * One box for everything: files across the opened folders and every
 * registered command. Empty shows what was touched recently; a leading `>`
 * limits results to commands, as in most editors. A file is one line, as in
 * Obsidian's quick switcher: its name as the tree shows it, then its folder.
 * New Tab asks only for a file.
 */
export const CommandPalette: React.FC = () => {
  const open = usePaletteStore((state) => state.open);
  const initialQuery = usePaletteStore((state) => state.initialQuery);
  const newTabMode = usePaletteStore((state) => state.newTab);
  const hide = usePaletteStore((state) => state.hide);
  const roots = useDiskStore((state) => state.roots);
  const { navigateFiles } = useShell();
  const commands = useCommandList();
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<PaletteItem[]>([]);
  const [content, setContent] = useState<PaletteItem[]>([]);
  const [contentStatus, setContentStatus] = useState('');
  const [recent, setRecent] = useState<PaletteItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [namesLoading, setNamesLoading] = useState(false);
  const [namesError, setNamesError] = useState(false);
  const [contentError, setContentError] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);

  const commandMode = query.trimStart().startsWith('>');
  const term = (commandMode ? query.trimStart().slice(1) : query).trim();

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setActiveKey(null);
    setFiles([]);
    const token = ++request.current;
    void window.activityAPI.recent({ limit: RECENT_LIMIT }).then((response) => {
      if (token !== request.current || !response.success) return;
      setRecent(response.data.items.map((item) => ({ kind: 'file', entry: item.entry })));
    }).catch(() => undefined);
  }, [open, initialQuery]);

  useEffect(() => {
    setNamesError(false);
    if (!open || commandMode || !term) { setFiles([]); setNamesLoading(false); return; }
    setNamesLoading(true);
    const token = ++request.current;
    setFiles([]);
    const timer = setTimeout(() => {
      void window.collectionsAPI.query(
        // Files only, as in Obsidian's quick switcher; folders open in the tree.
        { version: 1, scope: { kind: 'all-roots' }, filters: [{ field: 'name', op: 'contains', value: term.slice(0, 200) }, { field: 'kind', op: 'not-in', values: ['directory'] }], sort: { field: 'touched', direction: 'desc' } },
        { limit: FILE_LIMIT }
      ).then((response) => {
        if (token !== request.current) return;
        setNamesLoading(false);
        if (!response.success) { setFiles([]); setNamesError(true); return; }
        setFiles(response.data.rows.map((row) => ({ kind: 'file', entry: row.entry })));
      }).catch(() => { if (token === request.current) { setFiles([]); setNamesLoading(false); setNamesError(true); } });
    }, FILE_SEARCH_DEBOUNCE_MS);
    return () => { request.current += 1; clearTimeout(timer); };
  }, [open, term, commandMode, searchRevision]);

  useEffect(() => {
    let current = true;
    setContent([]);
    setContentStatus('');
    setContentError(false);
    if (!open || commandMode || term.length < 2) return;
    setContentStatus('Searching inside files…');
    const timer = setTimeout(() => {
      void window.diskAPI.searchContent(term.slice(0, 200)).then((response) => {
        if (!current) return;
        if (!response.success) { setContentStatus('Content search failed. Try again.'); setContentError(true); return; }
        setContent(response.data.hits.map((hit) => ({ kind: 'file', entry: { path: hit.path, name: hit.name, kind: classifyFile(hit.name), isDirectory: false, size: 0, mtimeMs: 0 }, excerpt: hit.excerpt })));
        setContentStatus(response.data.incomplete ? 'Partial results: search limits reached or some files were unreadable' : '');
      }).catch(() => { if (current) { setContentStatus('Content search failed. Try again.'); setContentError(true); } });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [open, commandMode, term, searchRevision]);

  const sections = useMemo((): { title: string; items: PaletteItem[] }[] => {
    const matched = rankCommands(commands.filter((command) => !command.hidden), term, commandMode ? Infinity : term ? COMMAND_LIMIT_WITH_FILES : Infinity)
      .map((command): PaletteItem => ({ kind: 'command', command }));
    if (commandMode) return [{ title: 'Commands', items: matched }];
    // A new tab is for a file, so New Tab lists no commands unless asked with `>`.
    const commandSection = { title: 'Commands', items: newTabMode ? [] : matched };
    if (!term) return [{ title: 'Recent', items: recent }, commandSection].filter((section) => section.items.length > 0);
    const named = new Set(files.map((item) => (item.kind === 'file' ? item.entry.path : '')));
    return [
      { title: 'Files', items: files },
      { title: 'Inside files', items: content.filter((item) => item.kind === 'file' && !named.has(item.entry.path)) },
      commandSection,
    ].filter((section) => section.items.length > 0);
  }, [commands, term, commandMode, newTabMode, recent, files, content]);
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  const active = Math.max(0, flat.findIndex((item) => itemKey(item) === activeKey));
  useEffect(() => { setActiveKey(null); }, [term, commandMode]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  /** Files open in the current tab; Cmd+Enter, or a palette opened by New Tab, opens a new one. */
  const run = (item: PaletteItem, newTab = newTabMode) => {
    hide();
    if (item.kind === 'command') { commandRegistry.executeCommand(item.command.id, { newTab }); return; }
    recordOpened(item.entry.path);
    navigateFiles(focusFile(item.entry.path), { newTab });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveKey(flat.length ? itemKey(flat[(active + 1) % flat.length]) : null); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveKey(flat.length ? itemKey(flat[(active - 1 + flat.length) % flat.length]) : null); }
    else if (event.key === 'Enter') { event.preventDefault(); const item = flat[active]; if (item) run(item, newTabMode || event.metaKey || event.ctrlKey); }
  };

  let position = -1;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) hide(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 dark:bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          aria-label="Search files and commands"
          data-testid="command-palette"
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-[14vh] z-50 w-[640px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-dialog border border-border-overlay bg-surface-raised text-foreground shadow-overlay outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          <DialogPrimitive.Title className="sr-only">Search files and commands</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Type to search files across your opened folders, or start with &gt; for commands.</DialogPrimitive.Description>
          <div className="flex items-center gap-2.5 border-b border-border-subtle px-3.5">
            <Search aria-hidden className="h-4 w-4 shrink-0 text-icon" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={newTabMode ? 'Open a file in a new tab' : 'Search files, or > for commands'}
              aria-label="Search files and commands"
              aria-activedescendant={flat[active] ? `palette-item-${active}` : undefined}
              role="combobox"
              aria-expanded
              aria-controls="palette-results"
              aria-autocomplete="list"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-tertiary"
            />
          </div>
          <div ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-1.5">
            {flat.length === 0 ? (
              <p className="px-3 py-6 text-center text-ui text-foreground-tertiary">
                {term ? namesLoading || contentStatus.startsWith('Searching') ? 'Searching…' : namesError || contentError ? 'Search could not finish. You can try again.' : `Nothing matches “${term}”` : 'Open a folder to search its files.'}
              </p>
            ) : sections.map((section) => (
              <div key={section.title} role="group" aria-label={section.title} className="pb-1">
                <p className="px-2.5 pb-1 pt-2 text-label text-foreground-tertiary">{section.title}</p>
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
                      title={item.kind === 'file' ? vaultRelativePath(item.entry.path, roots) : undefined}
                      onMouseMove={() => setActiveKey(itemKey(item))}
                      onClick={(event) => run(item, newTabMode || event.metaKey || event.ctrlKey)}
                      className={`flex cursor-default flex-col justify-center rounded-row px-2.5 text-ui ${item.kind === 'file' && item.excerpt ? 'py-1.5' : 'h-row'} ${selected ? 'bg-surface-active' : ''}`}
                    >
                      {item.kind === 'file' ? (
                        <>
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="min-w-0 max-w-[75%] shrink-0 truncate text-foreground"><SearchHighlight text={fileTreeLabel(item.entry.name, item.entry.kind)} query={term} /></span>
                            <span className="min-w-0 flex-1 truncate text-foreground-tertiary">{vaultFolder(item.entry.path, roots)}</span>
                          </span>
                          {item.excerpt ? <span className="mt-0.5 truncate text-control text-foreground-secondary"><SearchHighlight text={item.excerpt} query={term} /></span> : null}
                        </>
                      ) : (
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-foreground">{sentenceCase(item.command.name)}</span>
                          {item.command.shortcut?.[0] ? (
                            <span className="shrink-0 text-metadata tabular-nums text-foreground-tertiary">{formatShortcut(item.command.shortcut[0])}</span>
                          ) : null}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {!commandMode && term && (namesError || contentError) && <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-3.5 py-2 text-control">
            <span role="alert" className="font-medium text-foreground">{namesError ? 'Filename search could not finish.' : 'Content search could not finish.'}</span>
            <button type="button" className="shrink-0 font-medium text-foreground underline underline-offset-2" onKeyDown={(event) => event.stopPropagation()} onClick={() => setSearchRevision((value) => value + 1)}>Retry search</button>
          </div>}
          {!commandMode && term.length >= 2 && contentStatus && <div className="border-t border-border-subtle px-3.5 py-2 text-metadata text-foreground-tertiary">
            <span role="status">{contentStatus}</span>
          </div>}
          <div className="flex items-center gap-4 border-t border-border-subtle px-3.5 py-2 text-metadata text-foreground-tertiary">
            <span>↑↓ navigate</span>
            {newTabMode ? (
              <span>↵ open in new tab</span>
            ) : (
              <>
                <span>↵ open</span>
                <span>⌘↵ new tab</span>
              </>
            )}
            <span className="ml-auto">esc close</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
