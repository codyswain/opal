import type { App, BrowserWindow, Dialog, IpcMain } from 'electron';
import type { UnsavedPage } from '@/types/markdown';

export const FLUSH_TIMEOUT_MS = 3000;

export interface PendingSavesGuardDependencies {
  ipc: Pick<IpcMain, 'on'>;
  app: Pick<App, 'on' | 'quit'>;
  dialog: Pick<Dialog, 'showMessageBox'>;
  timeoutMs?: number;
}

/** The renderer's list of pages it could not save, as far as it is well formed. */
function unsavedPages(value: unknown): UnsavedPage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).filter((page): page is UnsavedPage =>
    typeof page?.name === 'string' && (page.copy === null || typeof page.copy === 'string'));
}

/**
 * Holds a window's close, and so the app's quit, until the renderer reports
 * that its pending page saves reached disk. Without it, text typed in the
 * last autosave delay before Cmd+Q or the close button would be lost. When a
 * page could not be saved, it asks before closing. A renderer that does not
 * answer in time is closed anyway.
 */
export class PendingSavesGuard {
  private quitting = false;
  private nextRequest = 1;
  private readonly waiting = new Map<number, (unsaved: UnsavedPage[]) => void>();

  constructor(private deps: PendingSavesGuardDependencies) {
    deps.app.on('before-quit', () => { this.quitting = true; });
    deps.ipc.on('markdown:flushed', (_event, requestId: unknown, unsaved: unknown) => {
      if (typeof requestId === 'number') this.waiting.get(requestId)?.(unsavedPages(unsaved));
    });
  }

  attach(window: BrowserWindow): void {
    let flushed = false;
    let flushing = false;
    window.on('close', (event) => {
      if (flushed || window.webContents.isDestroyed()) return;
      event.preventDefault();
      if (flushing) return;
      flushing = true;
      void this.flush(window).then(async (unsaved) => {
        if (unsaved.length > 0 && !(await this.closeAnyway(window, unsaved))) {
          // The held close already cancelled any quit; the window stays as it was.
          flushing = false;
          this.quitting = false;
          return;
        }
        flushed = true;
        // Holding the close also cancelled a quit in progress; resume it.
        if (this.quitting) this.deps.app.quit();
        else if (!window.isDestroyed()) window.close();
      });
    });
  }

  private flush(window: BrowserWindow): Promise<UnsavedPage[]> {
    const requestId = this.nextRequest;
    this.nextRequest += 1;
    return new Promise((resolve) => {
      const done = (unsaved: UnsavedPage[]) => {
        clearTimeout(timer);
        this.waiting.delete(requestId);
        resolve(unsaved);
      };
      const timer = setTimeout(() => done([]), this.deps.timeoutMs ?? FLUSH_TIMEOUT_MS);
      this.waiting.set(requestId, done);
      window.webContents.send('markdown:flush', requestId);
    });
  }

  /** Asks whether to close over pages whose text is not in their files, saying where each one's text is. */
  private async closeAnyway(window: BrowserWindow, unsaved: UnsavedPage[]): Promise<boolean> {
    if (window.isDestroyed()) return true;
    const { response } = await this.deps.dialog.showMessageBox(window, {
      type: 'warning',
      message: unsaved.length === 1 ? '1 note could not be saved' : `${unsaved.length} notes could not be saved`,
      detail: unsaved
        .map((page) => (page.copy ? `${page.name}: your changes are in ${page.copy}` : `${page.name}: your changes are only in the open page`))
        .join('\n'),
      buttons: ['Cancel', this.quitting ? 'Quit anyway' : 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
    });
    return response === 1;
  }
}
