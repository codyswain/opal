import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import log from 'electron-log';

// Path to the old notes directory
const NOTES_DIR = path.join(app.getPath('userData'), 'notes');

/**
 * Removes the old notes directory after successful migration
 */
export async function cleanupOldNotes(): Promise<void> {
  try {
    log.info('Cleaning up old notes directory');
    
    // Check if notes directory exists
    try {
      await fs.access(NOTES_DIR);
    } catch (error) {
      log.info('Notes directory does not exist, no cleanup needed');
      return;
    }
    
    // Rename the directory first (safer than deleting directly)
    const backupDir = `${NOTES_DIR}_backup_${Date.now()}`;
    await fs.rename(NOTES_DIR, backupDir);
    
    log.info(`Old notes directory renamed to ${backupDir}`);
    
    // You could also delete the backup directory after a certain period
    // or provide a UI option to delete it manually
  } catch (error) {
    log.error('Error during cleanup:', error);
    throw error;
  }
} 