import type { VaultDay, VaultDayChange } from "./day";
import type { StackKind, VaultStack } from "./stack";

export interface VaultInfo {
  path: string;
  name: string;
}
export type VaultResult<T> =
  { success: true; data: T } | { success: false; error: string };
/** A digest checkbox after a tick: its line in the body and that line as written now. */
export interface DigestItemTick {
  line: number;
  raw: string;
  checked: boolean;
}
export interface VaultAPI {
  discover: () => Promise<VaultResult<VaultInfo[]>>;
  /** The page Today opens for the date, created from the vault's template when missing. */
  createDay: (root: string, date: string) => Promise<VaultResult<{ path: string }>>;
  /** Everything the vault holds for the date. */
  day: (root: string, date: string) => Promise<VaultResult<VaultDay>>;
  /** The files a stack headed by `head` shows, in order. Fails when `head` does not start a stack of `kind`. */
  stack: (root: string, kind: StackKind, head: string) => Promise<VaultResult<VaultStack>>;
  /**
   * Ticks or clears a digest checkbox. `line` and `raw` are the item's `at`,
   * as `day` read it; the main process refuses when that line changed since.
   */
  checkDigestItem: (
    root: string,
    path: string,
    line: number,
    raw: string,
    checked: boolean,
  ) => Promise<VaultResult<DigestItemTick>>;
  /** Called when a day asked for with `day` reads differently on disk. Returns the unsubscribe. */
  onDayChanged: (callback: (change: VaultDayChange) => void) => () => void;
}
declare global {
  interface Window {
    vaultAPI: VaultAPI;
  }
}
