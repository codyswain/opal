import type { App, BrowserWindow, IpcMain } from 'electron';

export const FLUSH_TIMEOUT_MS = 3000;

export interface PendingSavesGuardDependencies {
  ipc: Pick<IpcMain, 'on'>;
  app: Pick<App, 'on' | 'quit'>;
  timeoutMs?: number;
}

/**
 * Holds a window's close, and so the app's quit, until the renderer reports
 * that its pending page saves reached disk. Without it, text typed in the
 * last autosave delay before Cmd+Q or the close button would be lost. A
 * renderer that does not answer in time is closed anyway.
 */
export class PendingSavesGuard {
  private quitting = false;
  private nextRequest = 1;
  private readonly waiting = new Map<number, () => void>();

  constructor(private deps: PendingSavesGuardDependencies) {
    deps.app.on('before-quit', () => { this.quitting = true; });
    deps.ipc.on('markdown:flushed', (_event, requestId: unknown) => {
      if (typeof requestId === 'number') this.waiting.get(requestId)?.();
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
      void this.flush(window).then(() => {
        flushed = true;
        // Holding the close also cancelled a quit in progress; resume it.
        if (this.quitting) this.deps.app.quit();
        else if (!window.isDestroyed()) window.close();
      });
    });
  }

  private flush(window: BrowserWindow): Promise<void> {
    const requestId = this.nextRequest;
    this.nextRequest += 1;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiting.delete(requestId);
        resolve();
      };
      const timer = setTimeout(done, this.deps.timeoutMs ?? FLUSH_TIMEOUT_MS);
      this.waiting.set(requestId, done);
      window.webContents.send('markdown:flush', requestId);
    });
  }
}
