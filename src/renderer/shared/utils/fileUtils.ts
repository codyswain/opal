// Use the globally exposed electron API from the preload script
const electron = (window as any).electron;

export async function createDirectoryIfNotExists(dirPath: string): Promise<void> {
  // Check existence and creation should be handled in the main process via IPC
  // if (!fs.existsSync(dirPath)) {
  //   fs.mkdirSync(dirPath, { recursive: true });
  // }
  try {
    await electron.createDirectory(dirPath);
    console.log(`Directory creation requested via IPC for path: ${dirPath}`);
  } catch (error) {
    console.error(`Error creating directory via IPC for path ${dirPath}:`, error);
    // Re-throw or handle the error as appropriate for your application
    throw error; 
  }
}

// Assuming saveNoteToFile might also need adjustment if it uses fs directly
// If saveNoteToFile also uses fs, it needs similar refactoring
// export function saveNoteToFile(note: Note, filePath: string): void { ... }
