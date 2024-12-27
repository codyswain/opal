import { ipcMain, app } from "electron";
import fs from "fs/promises";
import path from "path";
import { Config, DirectoryEntry, Note, NoteMetadata } from "@/renderer/shared/types";
import { v4 as uuidv4 } from "uuid";
import logger from "./logger";
const NOTES_DIR = path.join(app.getPath("userData"), "notes");

// Special delimiter used for parsing notes from non-notes
const NOTE_DELIMITER = "___";

// Create a config file path
const CONFIG_FILE = path.join(app.getPath("userData"), "config.json");

export const setupFileSystem = async () => {
  // Ensure the notes directory exists
  await fs.mkdir(NOTES_DIR, { recursive: true });

  // Ensure the config file exists
  try {
    await fs.access(CONFIG_FILE);
  } catch {
    await fs.writeFile(CONFIG_FILE, JSON.stringify({}));
  }

  ipcMain.handle("get-directory-structure", async (_, dirPath: string) => {
    try {
      const dirStructure = await loadDirectoryStructure(dirPath);
      return dirStructure;
    } catch (error) {
      console.error(`Error loading directory structure for dirPath=${dirPath}`);
      throw error;
    }
  });

  ipcMain.handle("load-note", async (_, notePath: string) => {
    try {
      const noteContent = await fs.readFile(notePath, "utf-8");
      const note: Note = JSON.parse(noteContent);
      return note;
    } catch (error) {
      console.error("Error loading note:", error);
      throw error;
    }
  });

  ipcMain.handle("save-note", async (_, note: Note, dirPath: string) => {
    try {
      const fileName = `${note.id}.json`;
      const filePath = path.join(dirPath, fileName);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(note));
      console.log(`Note saved successfully at filePath=${filePath}`);
      return filePath;
    } catch (error) {
      console.error("Error saving note:", error);
      throw error;
    }
  });

  ipcMain.handle("delete-file-node", async (_, fileNodeType: string, fileNodePath: string) => {
  try {
    if (fileNodeType === "directory") {
      // Deletes the directory and all its contents, including embedding files
      await fs.rm(fileNodePath, { recursive: true, force: true });
    } else if (fileNodeType === "note") {
      // Delete the note file
      await fs.unlink(fileNodePath);

      // Construct the embedding file path
      const embeddingFilePath = fileNodePath.replace(/\.json$/, ".embedding.json");

      // Attempt to delete the embedding file
      try {
        await fs.unlink(embeddingFilePath);
        console.log(`Embedding file deleted at path: ${embeddingFilePath}`);
      } catch (error: any) {
        if (error.code !== "ENOENT") {
          // Log errors other than file not existing
          console.error(`Error deleting embedding file at path: ${embeddingFilePath}`, error);
        }
        // If the embedding file doesn't exist, ignore the error
      }
    }
  } catch (err) {
    console.error(`Error deleting fileNode with path: ${fileNodePath}`, err);
  }
  });


  ipcMain.handle("create-directory", async (_, dirPath: string) => {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      console.error("Error creating directory:", error);
      throw error;
    }
  });

  ipcMain.handle("delete-directory", async (_, dirPath: string) => {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      console.error("Error deleting directory:", error);
      throw error;
    }
  });

  ipcMain.handle("get-note-path", async (_, noteId: string) => {
    return path.join(NOTES_DIR, `${noteId}.json`);
  });

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
};

// Recursively create a tree representation of a directory
const loadDirectoryStructure = async (dirPath: string): Promise<DirectoryEntry> => {
  console.log(`Loading directory structure for path: ${dirPath}`);
  const dirName = path.basename(dirPath);
  const structure: DirectoryEntry = {
    name: dirName,
    type: "directory",
    fullPath: dirPath,
    children: [],
  };

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    logger.debug(`Found ${entries.length} entries in ${dirPath}`);

    for (const entry of entries) {
      const childPath = path.join(dirPath, entry.name);
      logger.debug(`Processing entry: ${entry.name} in ${dirPath}`);

      if (entry.isDirectory()) {
        const childStructure = await loadDirectoryStructure(childPath);
        structure.children?.push(childStructure);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        !entry.name.endsWith(".embedding.json")
      ) {
        try {
          const noteContent = await fs.readFile(childPath, "utf-8");
          const note: Note = JSON.parse(noteContent);
          structure.children?.push({
            name: note.title,
            type: "note",
            noteMetadata: {
              id: note.id,
              title: note.title,
            },
            fullPath: childPath,
          });
        } catch (error) {
          console.error(`Error reading note file ${childPath}:`, error);
        }
      }
    }

    return structure;
  } catch (error) {
    console.error(`Error loading directory structure for ${dirPath}:`, error);
    throw error;
  }
};

export const getOpenAIKey = async (): Promise<string> => {
  try {
    const configContent = await fs.readFile(CONFIG_FILE, "utf-8");
    const config = JSON.parse(configContent);
    return config.openaiApiKey || "";
  } catch (error) {
    console.error("Error reading OpenAI API key:", error);
    return "";
  }
};
