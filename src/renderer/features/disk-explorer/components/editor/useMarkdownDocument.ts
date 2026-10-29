import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDocumentStatusStore } from '../../store/documentStatusStore';
import { basenameFsPath, parentFsPath } from '@/common/fsPaths';
import { mergeText, type MergeResult } from './mergeText';
import { registerPageFlush, trackPendingWrite } from './pendingSaves';

export type MarkdownSaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

export interface MarkdownDocumentState {
  status: 'loading' | 'ready' | 'unavailable';
  /** The text the editor opens with. Later disk changes reach the editor as edits, not here. */
  body: string | null;
  saveState: MarkdownSaveState;
  error: string | null;
  hasFrontmatter: boolean;
  /** Set while the page and the disk changed the same lines: the disk's side, for the editor to show beside the page's. */
  conflict: { disk: string } | null;
}

/** The open editor, as the document drives it. */
export interface MarkdownEditorHandle {
  getText: () => string;
  /** Moves the editor to `text` with the smallest edit, keeping cursor and scroll, outside undo history. */
  setText: (text: string) => void;
}

export interface MarkdownDocumentActions {
  onChange: (text: string) => void;
  flush: () => Promise<void>;
  attach: (editor: MarkdownEditorHandle) => () => void;
  /** Saves the page, which now holds a pick for every conflicting change, over the disk version. */
  resolveConflict: () => void;
}

export const AUTOSAVE_DELAY_MS = 800;
export const AUTOSAVE_MAX_WAIT_MS = 5000;

const INITIAL: MarkdownDocumentState = {
  status: 'loading', body: null, saveState: 'clean', error: null, hasFrontmatter: false, conflict: null,
};

type ReadResponse = Awaited<ReturnType<typeof window.markdownAPI.read>>;
type WriteResponse = Awaited<ReturnType<typeof window.markdownAPI.write>>;

/**
 * One Markdown file's edit lifecycle. `saved` is the text at `revision` on
 * disk and the base of every merge. Saves and disk checks run one at a time,
 * so neither sees the other half done.
 */
class MarkdownDocumentSession {
  private live = false;
  private revision: string | null = null;
  private saved = '';
  private latest = '';
  private editor: MarkdownEditorHandle | null = null;
  private conflict: { disk: string; revision: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirtySince: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  private unregister: (() => void) | null = null;
  private saveState: MarkdownSaveState = 'clean';

  constructor(private readonly path: string, private readonly update: (patch: Partial<MarkdownDocumentState>) => void) {}

  open(): void {
    this.live = true;
    this.revision = null;
    this.conflict = null;
    this.publish(INITIAL);
    // Closing the window or quitting waits for this, and keeps both sides of an open conflict.
    this.unregister = registerPageFlush(() => (this.conflict ? this.serial(() => this.keepBoth()) : this.flush()));
    void this.serial(() => this.load());
  }

  /** Leaving the page saves what was typed; the write is tracked so a quit right after still waits for it. */
  close(): void {
    this.live = false;
    this.cancelTimer();
    this.unregister?.();
    trackPendingWrite(this.serial(() => (this.conflict ? this.keepBoth() : this.write())).then(() => this.drain()));
  }

  onChange = (text: string): void => {
    this.latest = text;
    // A conflict stays until every change has a pick; nothing saves meanwhile.
    if (this.conflict) return;
    if (text === this.saved) {
      this.cancelTimer();
      if (this.saveState === 'dirty') this.publish({ saveState: 'clean' });
      return;
    }
    if (this.saveState !== 'dirty') this.publish({ saveState: 'dirty' });
    this.schedule();
  };

  flush = async (): Promise<void> => {
    this.cancelTimer();
    await this.serial(() => this.write());
    await this.drain();
  };

  attach = (editor: MarkdownEditorHandle): (() => void) => {
    this.editor = editor;
    // The disk may have moved on between load and mount.
    if (editor.getText() !== this.latest) editor.setText(this.latest);
    return () => { if (this.editor === editor) this.editor = null; };
  };

  resolveConflict = (): void => {
    const conflict = this.conflict;
    if (!conflict) return;
    this.conflict = null;
    this.saved = conflict.disk;
    this.revision = conflict.revision;
    this.publish({ conflict: null, saveState: this.latest === this.saved ? 'clean' : 'dirty' });
    void this.serial(() => this.write());
  };

  /** Checks the disk after a change in the file's folder and folds what changed into the page. */
  reconcile = (): Promise<void> => this.serial(() => this.reconcileNow());

  private serial(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Waits until no save or disk check is queued, including ones queued while waiting. */
  private async drain(): Promise<void> {
    let tail: Promise<void>;
    do {
      tail = this.queue;
      await tail;
    } while (tail !== this.queue);
  }

  /** Autosave about 800ms after the last change, and at least every 5s while typing goes on. */
  private schedule(): void {
    const now = Date.now();
    this.dirtySince ??= now;
    const wait = Math.max(0, Math.min(AUTOSAVE_DELAY_MS, this.dirtySince + AUTOSAVE_MAX_WAIT_MS - now));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.serial(() => this.write()); }, wait);
  }

  private cancelTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private publish(patch: Partial<MarkdownDocumentState>): void {
    if (!this.live) return;
    if (patch.saveState) this.saveState = patch.saveState;
    this.update(patch);
  }

  private show(text: string): void {
    this.latest = text;
    this.editor?.setText(text);
  }

  private async load(): Promise<void> {
    let response: ReadResponse;
    try {
      response = await window.markdownAPI.read(this.path);
    } catch {
      response = { success: false, error: 'Could not open this note.' };
    }
    if (!response.success) {
      this.publish({ status: 'unavailable', error: response.error, body: null });
      return;
    }
    this.revision = response.data.revision;
    this.saved = this.latest = response.data.body;
    this.publish({ status: 'ready', body: response.data.body, saveState: 'clean', error: null, hasFrontmatter: response.data.hasFrontmatter });
  }

  private async write(): Promise<void> {
    if (this.conflict || this.revision === null) return;
    const text = this.latest;
    if (text === this.saved) return;
    this.dirtySince = null;
    this.publish({ saveState: 'saving', error: null });
    let response: WriteResponse;
    try {
      response = await window.markdownAPI.write(this.path, text, this.revision);
    } catch {
      response = { success: false, error: 'Could not save this note.' };
    }
    if (!response.success) {
      if (response.conflict) {
        // Still unsaved until the disk check below folds the two versions together.
        this.publish({ saveState: 'dirty' });
        return this.reconcileNow();
      }
      this.publish({ saveState: 'error', error: response.error });
      return;
    }
    this.revision = response.data.revision;
    this.saved = text;
    if (this.latest === text) {
      this.publish({ saveState: 'saved' });
    } else {
      // Typing went on while the write was in flight; the next save covers it.
      this.publish({ saveState: 'dirty' });
      if (this.live) this.schedule();
    }
  }

  /**
   * A clean page follows the disk. A dirty one merges: changes on different
   * lines combine and save; changes to the same lines become a conflict the
   * editor shows, or, once the page is closed, a copy that keeps both.
   */
  private async reconcileNow(): Promise<void> {
    if (this.revision === null) return;
    let response: ReadResponse;
    try { response = await window.markdownAPI.read(this.path); } catch { return; }
    // A file that went away or became unreadable stays as typed; the next save reports it.
    if (!response.success) return;
    const { body: disk, revision, hasFrontmatter } = response.data;
    if (revision === (this.conflict?.revision ?? this.revision)) return;
    const merged: MergeResult = this.latest === this.saved ? { clean: true, text: disk } : mergeText(this.saved, this.latest, disk);
    if (merged.clean) {
      this.conflict = null;
      this.show(merged.text);
      this.saved = disk;
      this.revision = revision;
      if (merged.text === disk) {
        this.publish({ conflict: null, hasFrontmatter, saveState: 'clean' });
        return;
      }
      this.publish({ conflict: null, hasFrontmatter, saveState: 'dirty' });
      void this.serial(() => this.write());
      return;
    }
    this.cancelTimer();
    this.show(merged.mine);
    this.conflict = { disk, revision };
    if (!this.live) return this.keepBoth();
    this.publish({ saveState: 'conflict', conflict: { disk: merged.disk }, error: null, hasFrontmatter });
  }

  /**
   * Settles an open conflict without a pick: the page's text goes to a copy
   * next to the file, and the page takes the disk version.
   */
  private async keepBoth(): Promise<void> {
    const conflict = this.conflict;
    const folder = parentFsPath(this.path);
    if (!conflict || !folder) return;
    const name = basenameFsPath(this.path).replace(/\.md$/i, '');
    const text = this.latest;
    try {
      const created = await window.markdownAPI.create(folder, `${name} (conflicted copy)`);
      if (!created.success) throw new Error(created.error);
      const copy = await window.markdownAPI.read(created.data.path);
      if (!copy.success) throw new Error(copy.error);
      const written = await window.markdownAPI.write(created.data.path, text, copy.data.revision);
      if (!written.success) throw new Error(written.error);
      toast(`Your version of ${name} was saved as ${basenameFsPath(created.data.path).replace(/\.md$/i, '')}.`);
    } catch {
      toast.error(`Could not save your version of ${name}. It is still open in the page.`);
      return;
    }
    this.conflict = null;
    this.show(conflict.disk);
    this.saved = conflict.disk;
    this.revision = conflict.revision;
    this.publish({ conflict: null, saveState: 'clean' });
  }
}

/**
 * Owns one Markdown file's edit lifecycle: load once, autosave against the
 * loaded revision, follow disk changes, and merge them into unsaved edits.
 * Nothing is written for a clean file.
 */
export function useMarkdownDocument(path: string): MarkdownDocumentState & MarkdownDocumentActions {
  const [state, setState] = useState<MarkdownDocumentState>(INITIAL);
  const session = useMemo(
    () => new MarkdownDocumentSession(path, (patch) => setState((previous) => ({ ...previous, ...patch }))),
    [path]
  );

  useEffect(() => {
    session.open();
    return () => session.close();
  }, [session]);

  useEffect(() => {
    const folder = parentFsPath(path);
    return window.diskAPI.onChanged(({ directories }) => {
      if (folder && directories.includes(folder)) void session.reconcile();
    });
  }, [path, session]);

  // A reload of the renderer gets no close request from the main process.
  useEffect(() => {
    const handler = () => { void session.flush(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [session]);

  // Publish the save state so the tab strip can show an unsaved dot or a problem.
  useEffect(() => {
    useDocumentStatusStore.getState().set(path, state.saveState);
  }, [path, state.saveState]);
  useEffect(() => () => useDocumentStatusStore.getState().clear(path), [path]);

  return { ...state, onChange: session.onChange, flush: session.flush, attach: session.attach, resolveConflict: session.resolveConflict };
}
