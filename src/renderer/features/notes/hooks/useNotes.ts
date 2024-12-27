// src/features/notes/hooks/useNotes.ts

import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Note,
  FileNode,
  DirectoryStructures,
  SimilarNote,
  FileNodeMap,
} from "@/renderer/shared/types";
import { toast } from "@/renderer/shared/components/Toast";

export const useNotes = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [directoryStructures, setDirectoryStructures] =
    useState<DirectoryStructures>({
      rootIds: [],
      nodes: {},
    });
  const [activeFileNodeId, setActiveFileNodeId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // File System Explorer State
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [currentPath, setCurrentPath] = useState<string>("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Mounted Folder States
  const [mountedDirPaths, setMountedDirPaths] = useState<string[]>([]);
  const [isLoadingMountedDirPaths, setIsLoadingMountedDirPaths] =
    useState(false);
  const [mountedDirPathsLoadError, setMountedDirPathsLoadError] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (activeFileNodeId) {
      const fileNode = directoryStructures.nodes[activeFileNodeId];
      if (fileNode) {
        setActiveFileNode(fileNode);
      } else {
        log.error("Could not find file node for id", activeFileNodeId);
      }
    }
  }, [activeFileNodeId, directoryStructures]);

  // Compute activeFileNode
  const activeFileNode = useMemo(() => {
    return activeFileNodeId
      ? directoryStructures.nodes[activeFileNodeId]
      : null;
  }, [activeFileNodeId, directoryStructures]);

  // Update functions to use activeFileNodeId
  const setActiveFileNode = useCallback((node: FileNode) => {
    setActiveFileNodeId(node.id);
  }, []);

  // Load the active note based on the active file node
  useEffect(() => {
    let isCurrent = true;

    const loadActiveNote = async () => {
      if (activeFileNode?.type === "note") {
        try {
          const loadedNote = await window.electron.loadNote(
            activeFileNode.fullPath
          );
          if (isCurrent) {
            setActiveNote(loadedNote);
          }
        } catch (err) {
          log.error("Failed to load note:", err);
          if (isCurrent) {
            setActiveNote(null);
          }
        }
      } else {
        if (isCurrent) {
          setActiveNote(null);
        }
      }
    };
    loadActiveNote();

    return () => {
      isCurrent = false;
    };
  }, [activeFileNode]);

  const loadNotes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      log.info("Starting to load notes...");
      const topLevelDirPaths = await window.electron.getTopLevelFolders();
      log.info("Top level folders:", topLevelDirPaths);
      
      const dirStructuresPromises = topLevelDirPaths.map(async (dirPath) => {
        try {
          log.info(`Loading directory structure for: ${dirPath}`);
          const dirStructure = await window.electron.getDirectoryStructure(dirPath);
          log.info(`Successfully loaded structure for ${dirPath}:`, dirStructure);
          return dirStructure;
        } catch (err) {
          log.error(`Failed to load directory structure for ${dirPath}:`, err);
          setError(err);
          return null;
        }
      });

      const dirStructures = await Promise.all(dirStructuresPromises);
      log.info('All directory structures:', dirStructures);

      const newDirectoryStructures: DirectoryStructures = {
        rootIds: [],
        nodes: {},
      };

      dirStructures.forEach((dirStructure, index) => {
        if (dirStructure) {
          log.info(`Building structure for directory ${index}`);
          buildDirectoryStructures(dirStructure, null, newDirectoryStructures);
        }
      });

      log.info('Final directory structures:', newDirectoryStructures);
      setDirectoryStructures(newDirectoryStructures);
    } catch (err) {
      log.error("Failed to load notes:", err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const buildDirectoryStructures = (
    dirStructure: any,
    parentId: string | null,
    directoryStructures: DirectoryStructures
  ) => {
    const id = uuidv4();
    const fileNode: FileNode = {
      id,
      name: dirStructure.name,
      type: dirStructure.type,
      parentId,
      fullPath: dirStructure.fullPath,
      childIds: [],
    };
    if (dirStructure.type === "note" && dirStructure.noteMetadata) {
      fileNode.noteMetadata = dirStructure.noteMetadata;
    }
    directoryStructures.nodes[id] = fileNode;
    if (!parentId) {
      directoryStructures.rootIds.push(id);
    } else {
      const parent = directoryStructures.nodes[parentId];
      if (parent) {
        parent.childIds = parent.childIds || [];
        parent.childIds.push(id);
      }
    }
    if (dirStructure.children) {
      dirStructure.children.forEach((child: any) => {
        buildDirectoryStructures(child, id, directoryStructures);
      });
    }
  };

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const createNote = useCallback(
    async (dirPath: string) => {
      const timestamp = new Date().toISOString();
      const newNote: Note = {
        id: uuidv4(),
        title: "Untitled Note",
        content: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      try {
        const savedNotePath = await window.electron.saveNote(newNote, dirPath);

        log.info("saved new note path", savedNotePath);
        log.info("full path passed in =", dirPath);

        // Create a new FileNode for the note
        const newFileNodeId = uuidv4();
        const newFileNode: FileNode = {
          id: newFileNodeId,
          name: newNote.title,
          type: "note",
          parentId: null, // We'll update this later
          fullPath: savedNotePath,
          childIds: [],
          noteMetadata: {
            id: newNote.id,
            title: newNote.title,
            // Add other metadata as needed
          },
        };

        // Update the directory structure
        setDirectoryStructures((prevStructures) => {
          const updatedNodes: FileNodeMap = { ...prevStructures.nodes };
          const parentNode = Object.values(updatedNodes).find(
            (node) =>
              node.type === "directory" &&
              node.fullPath === savedNotePath.split("/").slice(0, -1).join("/")
          );

          log.info('parent node fullepath=', parentNode.fullPath)

          if (parentNode) {
            log.info('newFileNode.parentId', newFileNode.parentId)
            newFileNode.parentId = parentNode.id;
            updatedNodes[parentNode.id] = {
              ...parentNode,
              childIds: [...parentNode.childIds, newFileNodeId],
            };
          } else {
            // If no parent found, add to root
            prevStructures.rootIds.push(newFileNodeId);
          }

          updatedNodes[newFileNodeId] = newFileNode;

          return {
            ...prevStructures,
            nodes: updatedNodes,
          };
        });

        setActiveFileNodeId(newFileNodeId);
      } catch (error) {
        log.error("Error creating note:", error);
      }
    },
    [setDirectoryStructures, setActiveFileNodeId]
  );

  const saveNote = useCallback(
    async (updatedNote: Note) => {
      if (!activeFileNode || activeFileNode.type !== "note") {
        log.error("No active note file node");
        return;
      }
      try {
        const dirPath = activeFileNode.fullPath.substring(0, activeFileNode.fullPath.lastIndexOf("/"));
        await window.electron.saveNote(updatedNote, dirPath);

        // Correctly update the directoryStructures
        setDirectoryStructures((prevStructures) => {
          const updatedNodes = { ...prevStructures.nodes }; // Clone nodes object
          const nodeId = activeFileNode.id;
          const node = updatedNodes[nodeId];
          if (node) {
            updatedNodes[nodeId] = {
              ...node, // Create a new node object
              name: updatedNote.title,
              noteMetadata: {
                ...node.noteMetadata,
                title: updatedNote.title,
              },
            };
          }
          return {
            ...prevStructures,
            nodes: updatedNodes, // Use the updated nodes object
          };
        });

        // No need to update activeFileNode explicitly; it will update via useMemo
      } catch (error) {
        log.error("Error saving note:", error);
        toast.error("Failed to save note. Please try again.");
      }
    },
    [activeFileNode]
  );

  const deleteFileNode = useCallback(
    async (fileNode: FileNode) => {
      try {
        await window.electron.deleteFileNode(fileNode.type, fileNode.fullPath);

        // Update directory structures
        setDirectoryStructures((prevStructures) => {
          const updatedNodes = { ...prevStructures.nodes };
          const updatedRootIds = [...prevStructures.rootIds];

          // Remove the node
          delete updatedNodes[fileNode.id];

          // Remove from parent's childIds
          if (fileNode.parentId) {
            const parentNode = updatedNodes[fileNode.parentId];
            if (parentNode) {
              parentNode.childIds = parentNode.childIds.filter(
                (id) => id !== fileNode.id
              );
            }
          } else {
            // Remove from rootIds if it's a top-level node
            const rootIndex = updatedRootIds.indexOf(fileNode.id);
            if (rootIndex !== -1) {
              updatedRootIds.splice(rootIndex, 1);
            }
          }

          // Recursively remove all children
          const removeChildren = (nodeId: string) => {
            const node = updatedNodes[nodeId];
            if (node) {
              node.childIds.forEach(removeChildren);
              delete updatedNodes[nodeId];
            }
          };
          fileNode.childIds.forEach(removeChildren);

          return {
            rootIds: updatedRootIds,
            nodes: updatedNodes,
          };
        });

        // If it was a top-level folder, remove it from mountedDirPaths
        const topLevelFolderPaths = await window.electron.getTopLevelFolders();
        log.info("Top level folder paths:", topLevelFolderPaths);
        if (topLevelFolderPaths.includes(fileNode.fullPath)) {
          log.info(`Removing top-level folder: ${fileNode.fullPath}`);
          await window.electron.removeTopLevelFolder(fileNode.fullPath);
          setMountedDirPaths((prev) =>
            prev.filter((path) => path !== fileNode.fullPath)
          );
        }

        // Clear active node if it was deleted
        if (activeFileNodeId === fileNode.id) {
          setActiveFileNodeId(null);
          setActiveNote(null);
        }
      } catch (error) {
        log.error("Error deleting file node:", error);
        toast.error("Failed to delete file. Please try again.");
      }
    },
    [activeFileNodeId, setActiveFileNodeId, setActiveNote]
  );

  const toggleDirectory = useCallback((fileNode: FileNode) => {
    setExpandedDirs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(fileNode.id)) {
        newSet.delete(fileNode.id);
      } else {
        newSet.add(fileNode.id);
      }
      return newSet;
    });
  }, []);

  const handleCreateFolder = useCallback((fileNode: FileNode) => {
    setActiveFileNode(fileNode);
    setIsCreatingFolder(true);
    setNewFolderName("");
    setError(null);
  }, []);

  const confirmCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) {
      setError("Folder name cannot be empty");
      return;
    }

    const invalidChars = /[<>:"/\\|?*\p{C}]/u;
    if (invalidChars.test(newFolderName)) {
      setError("Folder name contains invalid characters");
      return;
    }

    if (!activeFileNode) {
      setError("No active directory selected");
      return;
    }

    try {
      await window.electron.createDirectory(
        `${activeFileNode.fullPath}/${newFolderName.trim()}`
      );
      setIsCreatingFolder(false);
      setNewFolderName("");
      setError(null);
      await loadNotes();
    } catch (err) {
      setError(
        `Failed to create folder: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      log.error("Failed to create folder:", err);
    }
  }, [activeFileNode, newFolderName, loadNotes]);

  const cancelCreateFolder = useCallback(() => {
    setIsCreatingFolder(false);
    setNewFolderName("");
    setError(null);
  }, []);

  const loadMountedDirPaths = useCallback(async () => {
    setIsLoadingMountedDirPaths(true);
    setMountedDirPathsLoadError(null);

    try {
      const mountedDirPaths = await window.electron.getTopLevelFolders();
      setMountedDirPaths(mountedDirPaths);

      if (mountedDirPaths.length === 0) {
        log.info('No mounted directory paths found');
      }
    } catch (error) {
      log.error('Error loading mounted directory paths:', error);
      setMountedDirPathsLoadError('Failed to load mounted directory paths');
    } finally {
      setIsLoadingMountedDirPaths(false);
    }
  }, []);

  useEffect(() => {
    loadMountedDirPaths();
  }, [loadMountedDirPaths]);

  const openDialogToMountDirpath = useCallback(async () => {
    const result = await window.electron.openFolderDialog();
    if (result) {
      log.info(`Adding top-level folder: ${result}`);
      await window.electron.addTopLevelFolder(result);
      await loadMountedDirPaths();
      await loadNotes();
    }
  }, [loadMountedDirPaths, loadNotes]);

  const createEmbedding = useCallback(async (): Promise<boolean> => {
    if (activeFileNode?.type === "note" && activeNote) {
      try {
        await window.electron.generateNoteEmbeddings(
          activeNote,
          activeFileNode
        );
        return true;
      } catch (error) {
        log.error(`Failed generating note embedding:`, error);
        return false;
      }
    } else {
      log.error(`Embedding creation triggered for invalid file node type`);
      return false;
    }
  }, [activeFileNode, activeNote]);

  const getFileNodeFromNote = useCallback(
    (note: Note): FileNode | null => {
      const fileNode = Object.values(directoryStructures.nodes).find(
        (node) => node.type === "note" && node.noteMetadata?.id === note.id
      );
      return fileNode || null;
    },
    [directoryStructures]
  );

  const getFileNodeFromPath = useCallback(
    (fullPath: string): FileNode | null => {
      const fileNode = Object.values(directoryStructures.nodes).find(
        (node) => node.fullPath === fullPath
      );
      return fileNode || null;
    },
    [directoryStructures]
  );

  const findFileNodeIdByFullPath = useCallback(
    (fullPath: string): string | null => {
      const fileNode = Object.values(directoryStructures.nodes).find(
        (node) => node.fullPath === fullPath
      );
      return fileNode ? fileNode.id : null;
    },
    [directoryStructures]
  );

  const openNote = useCallback(
    (note: Note) => {
      const fileNode = getFileNodeFromNote(note);
      if (fileNode) {
        setActiveFileNodeId(fileNode.id);
      } else {
        log.error("Could not find file node for note", note);
      }
    },
    [getFileNodeFromNote]
  );

  const openNoteById = useCallback(
    (noteId: string) => {
      const fileNode = Object.values(directoryStructures.nodes).find(
        (node) => node.type === "note" && node.noteMetadata?.id === noteId
      );
      if (fileNode) {
        setActiveFileNodeId(fileNode.id);
      } else {
        log.error("Could not find file node for note ID", noteId);
      }
    },
    [directoryStructures, setActiveFileNodeId]
  );

  const performRAGChat = useCallback(
    async (conversation: { role: string; content: string }[]) => {
      try {
        const assistantMessage = await window.electron.performRAGChat(
          conversation,
          directoryStructures
        );
        return assistantMessage;
      } catch (error) {
        log.error("Error performing RAG Chat:", error);
        throw error;
      }
    },
    [directoryStructures]
  );

  return {
    notes,
    directoryStructures,
    isLoading,
    createNote,
    saveNote,
    loadNotes,
    activeFileNodeId,
    setActiveFileNodeId,
    activeNote,
    activeFileNode,
    setActiveFileNode,
    deleteFileNode,
    expandedDirs,
    toggleDirectory,
    currentPath,
    setCurrentPath,
    handleCreateFolder,
    newFolderState: {
      isCreatingFolder,
      newFolderName,
      setNewFolderName,
      confirmCreateFolder,
      cancelCreateFolder,
      error,
    },
    openDialogToMountDirpath,
    createEmbedding,
    getFileNodeFromNote,
    getFileNodeFromPath,
    openNote,
    error,
    performRAGChat,
    openNoteById,
  };
};
