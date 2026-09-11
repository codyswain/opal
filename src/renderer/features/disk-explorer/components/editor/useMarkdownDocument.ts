import { useCallback, useEffect, useRef, useState } from 'react';
import { useDocumentStatusStore } from '../../store/documentStatusStore';
import { parentFsPath } from '@/common/fsPaths';

export type MarkdownSaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

export interface MarkdownDocumentState {
  status: 'loading' | 'ready' | 'unavailable';
  /** Seed text for the editor; changes only on load and reload, never while typing. */
  body: string | null;
  /** Increments whenever the editor must re-seed from `body`. */
  seed: number;
  saveState: MarkdownSaveState;
  error: string | null;
  hasFrontmatter: boolean;
}

export interface MarkdownDocumentActions {
  onChange: (markdown: string) => void;
  flush: () => Promise<void>;
  reloadFromDisk: () => Promise<void>;
  keepMine: () => Promise<void>;
}

export const AUTOSAVE_DELAY_MS = 800;

const INITIAL: MarkdownDocumentState = {
  status: 'loading', body: null, seed: 0, saveState: 'clean', error: null, hasFrontmatter: false,
};

/**
 * Owns one Markdown file's edit lifecycle: load once, debounce writes against
 * the loaded revision, flush on demand, and surface an external change as a
 * conflict rather than overwriting it. Nothing is written for a clean file.
 */
export function useMarkdownDocument(path: string): MarkdownDocumentState & MarkdownDocumentActions {
  const [state, setState] = useState<MarkdownDocumentState>(INITIAL);
  const revision = useRef<string | null>(null);
  const latest = useRef<string>('');
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const inFlightWrite = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);

  const patch = useCallback((next: Partial<MarkdownDocumentState>) => {
    if (alive.current) setState((previous) => ({ ...previous, ...next }));
  }, []);

  const load = useCallback(async (reseed: boolean) => {
    const token = ++generation.current;
    let response: Awaited<ReturnType<typeof window.markdownAPI.read>>;
    try {
      response = await window.markdownAPI.read(path);
    } catch {
      response = { success: false, error: 'Could not open this note.' };
    }
    if (token !== generation.current || !alive.current) return;
    if (!response.success) {
      patch({ status: 'unavailable', error: response.error, body: null });
      return;
    }
    revision.current = response.data.revision;
    latest.current = response.data.body;
    dirty.current = false;
    setState((previous) => ({
      status: 'ready',
      body: response.data.body,
      seed: reseed ? previous.seed + 1 : previous.seed,
      saveState: 'clean',
      error: null,
      hasFrontmatter: response.data.hasFrontmatter,
    }));
  }, [path, patch]);

  const save = useCallback((): Promise<void> => {
    if (inFlight.current && inFlightWrite.current) return inFlightWrite.current;
    if (!dirty.current || revision.current === null) return Promise.resolve();
    inFlight.current = true;
    const text = latest.current;
    const basedOn = revision.current;
    patch({ saveState: 'saving', error: null });
    const run = (async () => {
      let response: Awaited<ReturnType<typeof window.markdownAPI.write>>;
      try {
        response = await window.markdownAPI.write(path, text, basedOn);
      } catch {
        response = { success: false, error: 'Could not save this note.' };
      }
      inFlight.current = false;
      inFlightWrite.current = null;
      if (!alive.current) return;
      if (!response.success) {
        patch({ saveState: response.conflict ? 'conflict' : 'error', error: response.error });
        return;
      }
      revision.current = response.data.revision;
      if (latest.current === text) {
        dirty.current = false;
        patch({ saveState: 'saved' });
      } else {
        // Typing continued while the write was in flight; the next save covers it.
        patch({ saveState: 'dirty' });
        timer.current = setTimeout(() => { timer.current = null; void save(); }, AUTOSAVE_DELAY_MS);
      }
    })();
    inFlightWrite.current = run;
    return run;
  }, [path, patch]);

  const onChange = useCallback((markdown: string) => {
    if (markdown === latest.current && !dirty.current) return;
    latest.current = markdown;
    dirty.current = true;
    setState((previous) =>
      previous.saveState === 'conflict' || previous.saveState === 'dirty' ? previous : { ...previous, saveState: 'dirty' }
    );
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void save(); }, AUTOSAVE_DELAY_MS);
  }, [save]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await save();
  }, [save]);

  const reloadFromDisk = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await load(true);
  }, [load]);

  const keepMine = useCallback(async () => {
    // A blur-triggered write may still be in flight (and about to conflict);
    // let it settle, then adopt the on-disk revision and write over it.
    if (inFlightWrite.current) await inFlightWrite.current;
    let response: Awaited<ReturnType<typeof window.markdownAPI.read>>;
    try {
      response = await window.markdownAPI.read(path);
    } catch {
      response = { success: false, error: 'Could not read this note.' };
    }
    if (!alive.current) return;
    if (!response.success) { patch({ saveState: 'error', error: response.error }); return; }
    revision.current = response.data.revision;
    dirty.current = true;
    await save();
  }, [path, patch, save]);

  useEffect(() => {
    alive.current = true;
    revision.current = null;
    latest.current = '';
    dirty.current = false;
    inFlight.current = false;
    setState(INITIAL);
    void load(true);
    return () => {
      alive.current = false;
      generation.current += 1;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      // Leaving the file saves what was typed; a conflict stays on disk untouched.
      if (dirty.current && revision.current !== null && !inFlight.current) {
        void window.markdownAPI.write(path, latest.current, revision.current);
      }
    };
  }, [path, load]);

  // A clean document follows external edits silently; a dirty one waits for the save to report a conflict.
  useEffect(() => {
    const folder = parentFsPath(path);
    return window.diskAPI.onChanged(({ directories }) => {
      if (!folder || !directories.includes(folder) || dirty.current || inFlight.current) return;
      void (async () => {
        let response: Awaited<ReturnType<typeof window.markdownAPI.read>>;
        try { response = await window.markdownAPI.read(path); } catch { return; }
        if (!alive.current || !response.success || dirty.current) return;
        if (response.data.revision !== revision.current) await load(true);
      })();
    });
  }, [path, load]);

  useEffect(() => {
    const handler = () => { void flush(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [flush]);

  // Publish the save state so the tab strip can show an unsaved dot or a problem.
  useEffect(() => {
    useDocumentStatusStore.getState().set(path, state.saveState);
  }, [path, state.saveState]);
  useEffect(() => () => useDocumentStatusStore.getState().clear(path), [path]);

  return { ...state, onChange, flush, reloadFromDisk, keepMine };
}
