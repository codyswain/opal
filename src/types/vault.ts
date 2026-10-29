export interface VaultInfo {
  path: string;
  name: string;
}
export type VaultResult<T> =
  { success: true; data: T } | { success: false; error: string };
export interface VaultAPI {
  discover: () => Promise<VaultResult<VaultInfo[]>>;
  createDay: (root: string, date: string) => Promise<VaultResult<undefined>>;
}
declare global {
  interface Window {
    vaultAPI: VaultAPI;
  }
}
