// src/features/notes/hooks/useNotes.ts

import { v4 as uuidv4 } from "uuid";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Note,
  FileNode,
  DirectoryStructures,
  SimilarNote,
} from "@/shared/types";
import { toast } from "@/shared/components/Toast";

export const useNotes = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [directoryStructures, setDirectoryStructures] = useState<DirectoryStructures>({
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
  const [isLoadingMountedDirPaths, setIsLoadingMountedDirPaths] = useState(false);
  const [mountedDirPathsLoadError, setMountedDirPathsLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (activeFileNodeId) {
      const fileNode = directoryStructures.nodes[activeFileNodeId];
      if (fileNode) {
        setActiveFileNode(fileNode);
      } else {
        console.error("Could not find file node for id", activeFileNodeId);
      }
    }
  }, [activeFileNodeId, directoryStructures]);

  // Compute activeFileNode
  const activeFileNode = useMemo(() => {
    return activeFileNodeId ? directoryStructures.nodes[activeFileNodeId] : null;
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
          const loadedNote = await window.electron.loadNote(activeFileNode.fullPath);
          if (isCurrent) {
            setActiveNote(loadedNote);
          }
        } catch (err) {
          console.error("Failed to load note:", err);
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
      const topLevelDirPaths = await window.electron.getTopLevelFolders();
      const dirStructuresPromises = topLevelDirPaths.map(async (dirPath) => {
        try {
          const dirStructure = await window.electron.getDirectoryStructure(dirPath);
          return dirStructure;
        } catch (err) {
          console.error(`Failed to load directory structure for ${dirPath}:`, err);
          setError(err);
          return null;
        }
      });
      const dirStructures = await Promise.all(dirStructuresPromises);
      const newDirectoryStructures: DirectoryStructures = {
        rootIds: [],
        nodes: {},
      };
      dirStructures.forEach((dirStructure) => {
        if (dirStructure) {
          buildDirectoryStructures(dirStructure, null, newDirectoryStructures);
        }
      });
      setDirectoryStructures(newDirectoryStructures);
    } catch (err) {
      console.error("Failed to load top-level directories:", err);
      setError(err)
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
        await loadNotes();
        const newFileNodeId = findFileNodeIdByFullPath(savedNotePath);
        if (newFileNodeId) {
          setActiveFileNodeId(newFileNodeId);
        }
      } catch (error) {
        console.error("Error creating note:", error);
      }
    },
    [loadNotes, directoryStructures]
  );

  const saveNote = useCallback(
    async (updatedNote: Note) => {
      if (!activeFileNode || activeFileNode.type !== "note") {
        console.error("No active note file node");
        return;
      }
      try {
        const dirPath = activeFileNode.fullPath.substring(
          0,
          activeFileNode.fullPath.lastIndexOf("/")
        );
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
        console.error("Error saving note:", error);
        toast.error("Failed to save note. Please try again.");
      }
    },
    [activeFileNode]
  );

  const deleteFileNode = useCallback(
    async (fileNode: FileNode) => {
      try {
        await window.electron.deleteFileNode(fileNode.type, fileNode.fullPath);
        const topLevelFolderPaths = await window.electron.getTopLevelFolders();
        if (topLevelFolderPaths.includes(fileNode.fullPath)) {
          await window.electron.removeTopLevelFolder(fileNode.fullPath);
        }
        await loadNotes();
      } catch (error) {
        console.error("Error deleting file node:", error);
      }
    },
    [loadNotes]
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
      setError(`Failed to create folder: ${err instanceof Error ? err.message : String(err)}`);
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
      const dirPaths = await window.electron.getTopLevelFolders();
      setMountedDirPaths(dirPaths);
    } catch (error) {
      setMountedDirPathsLoadError("Failed to load top-level folders");
      console.error(error);
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
      await window.electron.addTopLevelFolder(result);
      await loadMountedDirPaths();
      await loadNotes();
    }
  }, [loadMountedDirPaths, loadNotes]);

  const createEmbedding = useCallback(async (): Promise<boolean> => {
    if (activeFileNode?.type === "note" && activeNote) {
      try {
        await window.electron.generateNoteEmbeddings(activeNote, activeFileNode);
        return true;
      } catch (error) {
        console.error(`Failed generating note embedding:`, error);
        return false;
      }
    } else {
      console.error(`Embedding creation triggered for invalid file node type`);
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
        console.error("Could not find file node for note", note);
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
        console.error("Could not find file node for note ID", noteId);
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
        console.error("Error performing RAG Chat:", error);
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
