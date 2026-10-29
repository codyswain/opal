import type { VaultDay, VaultDayChange } from "./day";

export interface VaultInfo {
  path: string;
  name: string;
}
export type VaultResult<T> =
  { success: true; data: T } | { success: false; error: string };
export interface VaultAPI {
  discover: () => Promise<VaultResult<VaultInfo[]>>;
  /** The page Today opens for the date, created from the vault's template when missing. */
  createDay: (root: string, date: string) => Promise<VaultResult<{ path: string }>>;
  /** Everything the vault holds for the date. */
  day: (root: string, date: string) => Promise<VaultResult<VaultDay>>;
  /** Called when a day asked for with `day` reads differently on disk. Returns the unsubscribe. */
  onDayChanged: (callback: (change: VaultDayChange) => void) => () => void;
}
declare global {
  interface Window {
    vaultAPI: VaultAPI;
  }
}
