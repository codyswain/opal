/** What a refused read of a hidden path says, in the main process and the renderer alike. */
export const HIDDEN_MESSAGE = 'This file is hidden.';

/** Whether hidden files show: Hidden on every launch, Shown after Touch ID. */
export interface HiddenState {
  shown: boolean;
}

/** Narrows on `success` without strict null checks, as DiskResult does. */
export type HiddenResult<T = undefined> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: string; data?: undefined };

export interface HiddenAPI {
  state: () => Promise<HiddenResult<HiddenState>>;
  /** Asks for Touch ID, and shows hidden files when it passes. A cancelled or failed prompt changes nothing. */
  show: () => Promise<HiddenResult<HiddenState>>;
  /** Hides hidden files again, with no prompt. */
  hide: () => Promise<HiddenResult<HiddenState>>;
  /** Adds a file or folder to its opened folder's `.opal/hidden.json`. */
  add: (target: string) => Promise<HiddenResult>;
  /** Takes a file or folder out of the list. Only while shown. */
  remove: (target: string) => Promise<HiddenResult>;
  /**
   * For paths the renderer already holds (its tabs, the sections of a stack):
   * whether each is hidden and refused now. Says nothing about any other path.
   */
  blocked: (paths: string[]) => Promise<HiddenResult<boolean[]>>;
  onChanged: (callback: (state: HiddenState) => void) => () => void;
}

declare global {
  interface Window {
    hiddenAPI: HiddenAPI;
  }
}
