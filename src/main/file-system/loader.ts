import path from "path";
import fs from "fs/promises";
import { DirectoryEntry, Note } from "@/renderer/shared/types";
import logger from "../logger";

// Recursively create a tree representation of a directory
export const loadDirectoryStructure = async (dirPath: string): Promise<DirectoryEntry> => {
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
