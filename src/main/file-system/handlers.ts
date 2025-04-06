import { ipcMain, app, dialog, BrowserWindow } from "electron";
import fs from "fs/promises";
import path from "path";
import { Config } from "@/renderer/shared/types";

const CONFIG_FILE = path.join(app.getPath("userData"), "config.json");

export async function registerFileSystemIPCHandlers(){
  // Ensure the notes directory exists
  // await fs.mkdir(NOTES_DIR, { recursive: true });

  // // Ensure the config file exists
  // try {
  //   await fs.access(CONFIG_FILE);
  // } catch {
  //   await fs.writeFile(CONFIG_FILE, JSON.stringify({}));
  // }

  // ipcMain.handle("get-directory-structure", async (_, dirPath: string) => {
  //   if (!dirPath || typeof dirPath !== 'string') {
  //     console.error('dirPath is not a string or is undefined');
  //     throw new Error('dirPath is not a string or is undefined');
  //   }

  //   try {
  //     const dirStructure = await loadDirectoryStructure(dirPath);
  //     return dirStructure;
  //   } catch (error) {
  //     console.error(`Error loading directory structure for dirPath=${dirPath}`);
  //     throw error;
  //   }
  // });

  // ipcMain.handle("load-note", async (_, notePath: string) => {
  //   try {
  //     const noteContent = await fs.readFile(notePath, "utf-8");
  //     const note: Note = JSON.parse(noteContent);
  //     return note;
  //   } catch (error) {
  //     console.error("Error loading note:", error);
  //     throw error;
  //   }
  // });

  // ipcMain.handle("save-note", async (_, note: Note, dirPath: string) => {
  //   try {
  //     const fileName = `${note.id}.json`;
  //     const filePath = path.join(dirPath, fileName);
  //     await fs.mkdir(dirPath, { recursive: true });
  //     await fs.writeFile(filePath, JSON.stringify(note));
  //     console.log(`Note saved successfully at filePath=${filePath}`);
  //     return filePath;
  //   } catch (error) {
  //     console.error("Error saving note:", error);
  //     throw error;
  //   }
  // });

  // ipcMain.handle("delete-file-node", async (_, fileNodeType: string, fileNodePath: string) => {
  // try {
  //   if (fileNodeType === "directory") {
  //     // Deletes the directory and all its contents, including embedding files
  //     await fs.rm(fileNodePath, { recursive: true, force: true });
  //   } else if (fileNodeType === "note") {
  //     // Delete the note file
  //     await fs.unlink(fileNodePath);

  //     // Construct the embedding file path
  //     const embeddingFilePath = fileNodePath.replace(/\.json$/, ".embedding.json");

  //     // Attempt to delete the embedding file
  //     try {
  //       await fs.unlink(embeddingFilePath);
  //       console.log(`Embedding file deleted at path: ${embeddingFilePath}`);
  //     } catch (error: any) {
  //       if (error.code !== "ENOENT") {
  //         // Log errors other than file not existing
  //         console.error(`Error deleting embedding file at path: ${embeddingFilePath}`, error);
  //       }
  //       // If the embedding file doesn't exist, ignore the error
  //     }
  //   }
  // } catch (err) {
  //   console.error(`Error deleting fileNode with path: ${fileNodePath}`, err);
  // }
  // });


  // ipcMain.handle("create-directory", async (_, dirPath: string) => {
  //   try {
  //     await fs.mkdir(dirPath, { recursive: true });
  //   } catch (error) {
  //     console.error("Error creating directory:", error);
  //     throw error;
  //   }
  // });

  // ipcMain.handle("delete-directory", async (_, dirPath: string) => {
  //   try {
  //     await fs.rm(dirPath, { recursive: true, force: true });
  //   } catch (error) {
  //     console.error("Error deleting directory:", error);
  //     throw error;
  //   }
  // });

  // ipcMain.handle("get-note-path", async (_, noteId: string) => {
  //   return path.join(NOTES_DIR, `${noteId}.json`);
  // });

  ipcMain.handle("get-openai-key", async () => {
    try {
      const config = await fs.readFile(CONFIG_FILE, "utf-8");
      return JSON.parse(config).openaiApiKey || "";
    } catch (error) {
      console.error("Error reading OpenAI API key:", error);
      return "";
    }
  });

  ipcMain.handle("set-openai-key", async (_, key: string) => {
    try {
      let config: Config = {};
      try {
        const configContent = await fs.readFile(CONFIG_FILE, "utf-8");
        config = JSON.parse(configContent);
      } catch (error) {
        // If the file doesn't exist or is invalid, start with an empty config
        config = {};
      }
      config.openaiApiKey = key;
      await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error("Error saving OpenAI API key:", error);
      throw error;
    }
  });

  ipcMain.handle('dialog:openDirectory', async () => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    
    if (!mainWindow) {
      return { canceled: true };
    }
    
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    
    return result;
  });

  // Add handler for getting top-level folders
  ipcMain.handle("get-top-level-folders", async () => {
    try {
      let config: Config = {};
      try {
        const configContent = await fs.readFile(CONFIG_FILE, "utf-8");
        config = JSON.parse(configContent);
      } catch (error) {
        // If the file doesn't exist or is invalid, assume no folders configured
        console.warn("Config file not found or invalid, returning empty topLevelFolders array.", error);
        return []; // Return empty array if config can't be read
      }
      // Return the topLevelFolders array, or an empty array if it doesn't exist
      return config.topLevelFolders || [];
    } catch (error) {
      console.error("Error reading top-level folders:", error);
      // In case of unexpected errors during processing
      return [];
    }
  });
}