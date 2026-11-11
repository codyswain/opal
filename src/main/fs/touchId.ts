import type { HiddenFilesDependencies } from './HiddenFiles';
import type { TouchIdStub } from '@/main/testProfile';

/** The two calls Electron's systemPreferences offers on macOS; missing elsewhere. */
export interface TouchIdSystem {
  canPromptTouchID?: () => boolean;
  promptTouchID?: (reason: string) => Promise<void>;
}

export const NO_TOUCH_ID = 'This Mac cannot ask for Touch ID now, so hidden files stay hidden.';

/**
 * The prompt HiddenFiles asks. Electron's promptTouchID asks for Touch ID
 * and offers the account password from the same dialog; canPromptTouchID is
 * false on a Mac with no Touch ID sensor in reach (no sensor, or the lid
 * closed with no Touch ID keyboard), and then nothing is shown. A test stub
 * stands in only when `stub` is set, which touchIdStub allows only for an
 * unpackaged run under the test profile.
 */
export function touchIdPrompt(
  system: TouchIdSystem,
  stub: TouchIdStub | null,
): Pick<HiddenFilesDependencies, 'prompt' | 'canPrompt'> {
  if (stub) {
    return {
      canPrompt: () => (stub === 'none' ? { ok: false, reason: NO_TOUCH_ID } : { ok: true }),
      prompt: async () => {
        if (stub !== 'pass') throw new Error('Touch ID did not pass.');
      },
    };
  }
  return {
    canPrompt: () =>
      typeof system.canPromptTouchID === 'function' && typeof system.promptTouchID === 'function' && system.canPromptTouchID()
        ? { ok: true }
        : { ok: false, reason: NO_TOUCH_ID },
    prompt: async (reason) => {
      if (typeof system.promptTouchID !== 'function') throw new Error(NO_TOUCH_ID);
      await system.promptTouchID(reason);
    },
  };
}
