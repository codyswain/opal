import { stat } from 'fs/promises';
import path from 'path';
import { opalLinkPath, type OpenPageRequest } from '@/common/opalLink';
import type { RootRegistry } from '@/main/fs/RootRegistry';

export const OPEN_PAGE_CHANNEL = 'system:open-page';

/** The renderer's webContents, as far as links need it. */
export interface LinkReceiver {
  send: (channel: string, request: OpenPageRequest) => void;
  isDestroyed: () => boolean;
}

interface Dependencies {
  registry: Pick<RootRegistry, 'assertAllowed'>;
  /** The opened vaults' folders. A relative link path is read in the first. */
  vaults: () => Promise<string[]>;
}

/**
 * Links from other apps (`opal://open?path=...`, handed over by macOS) wait
 * here until the renderer listens, then go to it as files to open. macOS
 * sends the link that launched the app before the window exists.
 */
export class OpalLinks {
  private waiting: string[] = [];
  private receiver: LinkReceiver | null = null;

  constructor(private deps: Dependencies) {}

  receive(url: string): void {
    this.waiting.push(url);
    void this.deliver();
  }

  /** The renderer listens from now on. */
  attach(receiver: LinkReceiver): void {
    this.receiver = receiver;
    void this.deliver();
  }

  /** The renderer stopped listening, as when its window reloads. */
  detach(receiver: LinkReceiver): void {
    if (this.receiver === receiver) this.receiver = null;
  }

  private async deliver(): Promise<void> {
    const receiver = this.receiver;
    if (!receiver || receiver.isDestroyed()) return;
    for (const url of this.waiting.splice(0)) {
      const request = await this.request(url);
      // A window closed while the path resolved: the next one gets the link.
      if (receiver.isDestroyed()) this.waiting.push(url);
      else receiver.send(OPEN_PAGE_CHANNEL, request);
    }
  }

  /** The file a link names, checked against the opened folders. */
  async request(url: string): Promise<OpenPageRequest> {
    const linkPath = opalLinkPath(url);
    if (!linkPath) return { error: `Opal links look like opal://open?path=<path>, not ${url}` };
    let target = linkPath;
    if (!path.isAbsolute(target)) {
      const [vault] = await this.deps.vaults();
      if (!vault) return { error: `No opened folder is a vault, so Opal can't open ${linkPath}.` };
      target = path.join(vault, target);
    }
    try {
      const real = await this.deps.registry.assertAllowed(target);
      if (!(await stat(real)).isFile()) return { error: `${linkPath} is a folder, not a file.` };
      return { path: real };
    } catch {
      return { error: `${linkPath} is not a file in an opened folder.` };
    }
  }
}
