import { ipcMain, app, dialog, BrowserWindow } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import { Config } from "@/renderer/shared/types";
import * as keytar from 'keytar';

const APP_DATA_DIR = process.env.OPAL_DATA_DIR || path.join(__dirname, "../../../app-data");
const NOTES_DIR = path.join(APP_DATA_DIR, "notes");
const CONFIG_FILE = path.join(APP_DATA_DIR, "config.json");

const TREAD_KEYTAR_SERVICE = "TreadApp";
const TREAD_KEYTAR_ACCOUNT_OPENAI = "OpenAIKey";

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


  // Uncomment the handler for create-directory
  ipcMain.handle("create-directory", async (_, dirPath: string) => {
    try {
      // fs.mkdir now correctly uses the imported fs/promises version
      await fs.mkdir(dirPath, { recursive: true });
      console.log(`Directory created successfully at path: ${dirPath}`); // Added logging
    } catch (error) {
      console.error("Error creating directory:", error);
      throw error;
    }
  });

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
      const key = await keytar.getPassword(TREAD_KEYTAR_SERVICE, TREAD_KEYTAR_ACCOUNT_OPENAI);
      return key || ""; // Return empty string if key is not found (null)
    } catch (error) {
      console.error("Error retrieving OpenAI API key from keychain:", error);
      return ""; // Return empty string on error
    }
  });

  ipcMain.handle("set-openai-key", async (_, key: string) => {
    try {
      if (!key) {
        // If the key is empty or null, delete the credential
        await keytar.deletePassword(TREAD_KEYTAR_SERVICE, TREAD_KEYTAR_ACCOUNT_OPENAI);
      } else {
        // Otherwise, set the new key
        await keytar.setPassword(TREAD_KEYTAR_SERVICE, TREAD_KEYTAR_ACCOUNT_OPENAI, key);
      }
    } catch (error) {
      console.error("Error saving OpenAI API key to keychain:", error);
      throw error; // Rethrow the error to be handled by the caller
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