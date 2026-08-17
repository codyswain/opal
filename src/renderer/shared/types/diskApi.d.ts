import type { DiskEntry, DirectoryListing, DiskResult, TextFileContents } from '@/types/disk';

export interface DiskAPI {
  openFolder: () => Promise<DiskResult<{ root: string | null }>>;
  listRoots: () => Promise<DiskResult<string[]>>;
  removeRoot: (rootPath: string) => Promise<DiskResult>;
  readDirectory: (dirPath: string) => Promise<DiskResult<DirectoryListing>>;
  readTextFile: (target: string) => Promise<DiskResult<TextFileContents>>;
  reveal: (target: string) => Promise<DiskResult>;
  openExternal: (target: string) => Promise<DiskResult>;
  stat: (target: string) => Promise<DiskResult<DiskEntry>>;
  onChanged: (callback: (payload: { directories: string[] }) => void) => () => void;
}

declare global {
  interface Window {
    diskAPI: DiskAPI;
  }
}
