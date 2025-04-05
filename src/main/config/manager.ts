import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import log from 'electron-log';

interface Config {
  topLevelFolders: string[];
}

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
log.info(`Initialized CONFIG_FILE=${CONFIG_FILE}`);

// Function definitions commented out as they were unused according to linter
// export const readConfig = async (): Promise<Config | null> => {
//   // ...
// };

// export const writeConfig = async (config: Config): Promise<void> => {
//   // ...
// };