import type { IpcMain } from 'electron';
import path from 'path';
import type { HiddenResult, HiddenState } from '@/types/hidden';
import logger from '@/main/logger';
import { CannotPromptError, type HiddenFiles } from './HiddenFiles';
import { HiddenPathError, PathNotAllowedError, type RootRegistry } from './RootRegistry';

/** The most paths one `hidden:blocked` call checks: every tab and a stack's sections. */
const BLOCKED_LIMIT = 1000;

const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 32768 && !value.includes('\0') && path.isAbsolute(value);

const invalid = (): HiddenResult<never> => ({ success: false, error: 'Invalid hidden files request.' });

export interface HiddenHandlerDependencies {
  ipc: Pick<IpcMain, 'handle'>;
  hidden: HiddenFiles;
  registry: RootRegistry;
}

/**
 * The renderer's way to hidden files. Showing them always goes through the
 * prompt in HiddenFiles.show; there is no other way to Shown.
 */
export class HiddenHandlers {
  constructor(private deps: HiddenHandlerDependencies) {}

  registerAll(): void {
    const { ipc, hidden, registry } = this.deps;
    const state = (): HiddenState => ({ shown: hidden.isShown() });
    ipc.handle('hidden:state', () => this.respond(async () => state()));
    ipc.handle('hidden:show', async (): Promise<HiddenResult<HiddenState>> => {
      try {
        await hidden.show();
        return { success: true, data: state() };
      } catch (error) {
        // A failed or cancelled prompt changes nothing; a Mac that cannot ask says why.
        if (error instanceof CannotPromptError) return { success: false, error: error.message };
        return { success: false, error: 'Touch ID did not pass, so hidden files stay hidden.' };
      }
    });
    ipc.handle('hidden:hide', () => this.respond(async () => {
      await hidden.hide();
      return state();
    }));
    ipc.handle('hidden:add', (_, target: unknown) =>
      isPath(target)
        ? this.respond(async () => {
          await hidden.add(await registry.assertAllowed(target));
        })
        : invalid());
    ipc.handle('hidden:remove', (_, target: unknown) =>
      isPath(target)
        ? this.respond(async () => {
          // Unhiding is offered only on a row that shows, so while hidden there is nothing to unhide.
          if (!hidden.isShown()) throw new HiddenPathError();
          await hidden.remove(await registry.assertAllowed(target));
        })
        : invalid());
    ipc.handle('hidden:blocked', (_, paths: unknown) =>
      Array.isArray(paths) && paths.length <= BLOCKED_LIMIT && paths.every(isPath)
        ? this.respond(async () => {
          const seeing = registry.seeingHidden();
          const blocked = await registry.blocked();
          return Promise.all(paths.map(async (target) => {
            try {
              return blocked(await seeing.assertAllowed(target));
            } catch {
              // Outside the opened folders or gone: not a hidden file.
              return false;
            }
          }));
        })
        : invalid());
  }

  private async respond<T>(operation: () => Promise<T>, fallback = 'The hidden files could not be changed.'): Promise<HiddenResult<T>> {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      if (error instanceof HiddenPathError || error instanceof PathNotAllowedError) return { success: false, error: error.message };
      if (error instanceof Error && error.message) return { success: false, error: error.message };
      logger.error(fallback, error instanceof Error ? error : undefined);
      return { success: false, error: fallback };
    }
  }
}
