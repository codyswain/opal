import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * A real 1x1 PNG. The bytes matter: the protocol handler streams them and
 * Chromium has to actually decode the result, which a text placeholder would
 * not exercise — and decoding is precisely what this task must prove works.
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export interface TempVault {
  root: string;
  cleanup: () => Promise<void>;
}

export async function createTempVault(): Promise<TempVault> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opal-e2e-vault-'));
  const root = path.join(dir, 'TestVault');

  await mkdir(path.join(root, 'Photos'), { recursive: true });
  await writeFile(path.join(root, 'Photos', 'alpha.png'), PNG_1X1);
  await writeFile(path.join(root, 'Photos', 'beta.png'), PNG_1X1);
  await writeFile(path.join(root, 'readme.md'), '# Test Vault\n');

  return { root, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Pre-registers a root by writing the store file the main process reads at
 * startup. This exists because Playwright cannot drive the native folder
 * picker, so "open a folder" has to be simulated at the persistence layer.
 *
 * Must be called before the app launches — RootRegistry.load() runs once,
 * inside app.whenReady().
 */
export async function seedRoots(userDataDir: string, roots: string[]): Promise<void> {
  await mkdir(userDataDir, { recursive: true });
  await writeFile(
    path.join(userDataDir, 'disk-roots.json'),
    JSON.stringify({ version: 1, roots }, null, 2),
    'utf-8'
  );
}
