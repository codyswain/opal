import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import log from 'electron-log';

interface Config {
  topLevelFolders: string[];
}

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
log.info(`Initialized CONFIG_FILE=${CONFIG_FILE}`);

async function readConfig(): Promise<Config> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);
    // Ensure topLevelFolders is always an array
    if (!Array.isArray(config.topLevelFolders)) {
      config.topLevelFolders = [];
    }
    return config;
  } catch (error) {
    log.error('Error reading config:', error);
    // Return default config if file doesn't exist or is invalid
    return { topLevelFolders: [] };
  }
}

async function writeConfig(config: Config): Promise<void> {
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    log.error('Error writing config:', error);
  }
}

export async function getTopLevelFolders(): Promise<string[]> {
  log.info('Entering getTopLevelFolders');
  const config = await readConfig();
  log.info('Exiting getTopLevelFolders');
  return config.topLevelFolders;
}

export async function addTopLevelFolder(folderPath: string): Promise<void> {
  log.info(`Adding top-level folder: ${folderPath}`);
  const config = await readConfig();
  if (!config.topLevelFolders.includes(folderPath)) {
    config.topLevelFolders.push(folderPath);
    await writeConfig(config);
  }
}

export async function removeTopLevelFolder(folderPath: string): Promise<void> {
  log.info(`Removing top-level folder: ${folderPath}`);
  const config = await readConfig();
  config.topLevelFolders = config.topLevelFolders.filter(path => path !== folderPath);
  await writeConfig(config);
}