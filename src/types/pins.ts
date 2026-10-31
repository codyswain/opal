/** One opened folder's pinned files, as `<root>/.opal/pins.json` lists them. */
export interface RootPins {
  /** The opened folder. */
  root: string;
  /** Absolute paths, in the order the sidebar shows them. */
  pins: string[];
  /** The pins with no file there now: moved outside Opal, or not pulled yet. */
  missing: string[];
}
/** Narrows on `success` without strict null checks, as DiskResult does. */
export type PinsResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: string; data?: undefined };
export interface PinsAPI {
  /** Every opened folder's pins, read from its `.opal/pins.json`. */
  list: () => Promise<PinsResult<RootPins[]>>;
  /** Writes the whole ordered list of an opened folder's pins. */
  set: (root: string, paths: string[]) => Promise<PinsResult<RootPins>>;
}
declare global {
  interface Window {
    pinsAPI: PinsAPI;
  }
}
