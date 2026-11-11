/** A build of Opal: the short git commit and the time it was built. */
export interface BuildIdentity {
  commit: string;
  /** ISO 8601, UTC, to the second. */
  builtAt: string;
}

/** A newer build one of the update sources offers. */
export interface AvailableUpdate extends BuildIdentity {
  /** One line on what changed. */
  notes: string;
}

/** What the renderer shows about updates. */
export interface UpdateState {
  /** The running build, or null when it was built without an identity. */
  current: BuildIdentity | null;
  /** The newest build the sources offer, when it differs from the running one and is later. */
  available: AvailableUpdate | null;
  /** Whether the sidebar shows "Update ready": false for a build rolled back from. */
  showRow: boolean;
  /** Whether a build Opal installed earlier is kept and older than the running one. */
  canRollBack: boolean;
  /** Set from the start of an install or a roll back until Opal closes, or the attempt fails. */
  busy: 'installing' | 'rolling-back' | null;
}

/** Narrows on `success`, as HiddenResult does. */
export type UpdateResult<T = undefined> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: string; data?: undefined };

export interface UpdatesAPI {
  state: () => Promise<UpdateResult<UpdateState>>;
  /** Checks every source now. A failed source is skipped. */
  check: () => Promise<UpdateResult<UpdateState>>;
  /** Installs the available build: Opal closes and the new build opens. */
  install: () => Promise<UpdateResult>;
  /** Puts back the newest earlier build Opal kept: Opal closes and that build opens. */
  rollBack: () => Promise<UpdateResult>;
  onChanged: (callback: (state: UpdateState) => void) => () => void;
}

declare global {
  interface Window {
    updatesAPI: UpdatesAPI;
  }
}
