import { execFile } from 'child_process';
import { promisify } from 'util';
import type { LinkIndex } from '@/main/fs/LinkIndex';
import type { MutationQueue } from '@/main/fs/MutationQueue';
import type { FileStatus } from '@/types/files';

/** A dropped file by its path on disk, or a pasted one by its bytes and name. */
export type ImportSource = { path: string } | { bytes: Uint8Array; name: string };

/** Runs a program without a shell, as execFile does. */
export type RunFile = (
  file: string,
  args: readonly string[],
  options: { cwd?: string; timeout: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);
export const runFile: RunFile = (file, args, options) => execFileAsync(file, [...args], options);

/** Safe, user-facing errors; the IPC layer may show these messages verbatim. */
export class FilesError extends Error {
  constructor(message: string) { super(message); this.name = 'FilesError'; }
}

export interface StoreDependencies {
  /** The opened folder, resolved. */
  root: string;
  /** The files folder from the root's top, as `.opal/files.json` names it. */
  folder: string;
  links: Pick<LinkIndex, 'invalidateDirectories'>;
  queue?: MutationQueue;
  run?: RunFile;
  now?: () => Date;
}

/**
 * Where an opened folder keeps the files its pages embed. Pages link to a
 * file by its path from the folder's top and never name the store, so a
 * store that does not use git is one more class.
 */
export interface FileStore {
  /** Copies a file into `<folder>/YYYY-MM/` and returns its path from the root's top. */
  import(source: ImportSource): Promise<string>;
  /** Whether a stored file's bytes are on this Mac. `target` is resolved inside the root. */
  status(target: string): Promise<FileStatus>;
  /** Brings a stored file's bytes to this Mac, and answers its status after. */
  fetch(target: string): Promise<FileStatus>;
}
