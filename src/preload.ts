import type { ChatDraftState, CreateConversationOptions, ConversationPatch } from './types/chat';
import type { VaultAPI } from "./types/vault";
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import type { ThemeReport } from "./common/theme";

/* 
  The preload script runs in an isolated context. (since contextIsolation is 
  enabled in main.ts.)

  It calls contextBridge which provides a secure way to bridge across isolated
  contexts. exposeInMainWorld, exposes these methods in the main world. 
  Confusingly, the main world is the JS context that your renderer (e.g., React)
  runs in. 

  So the preload script runs in an isolated context, but it exposes IPC methods,
  and these IPC methods provide a bridge between the main electron process, and
  the renderer process. 

  |--Main Process--|--Preload Script--|--Renderer Process--|
  After preload script runs
  |--Main Process--|   <--IPC-->   |--Renderer Process--|
*/

contextBridge.exposeInMainWorld("systemAPI", {
  reportTheme: (report: ThemeReport) =>
    ipcRenderer.send("system:report-theme", report),
  openFolderDialog: () => ipcRenderer.invoke(`system:open-folder-dialog`),
  createDirectoryOnDisk: (dirPath: string) =>
    ipcRenderer.invoke(`system:create-directory-on-disk`, dirPath),
  reportCommands: (
    commands: Array<{ id: string; label: string; accelerator?: string }>,
  ) => ipcRenderer.send("menu:commands", commands),
  onMenuCommand: (handler: (commandId: string) => void) => {
    const listener = (_event: IpcRendererEvent, commandId: string) =>
      handler(commandId);
    ipcRenderer.on("menu:invoke", listener);
    return () => ipcRenderer.removeListener("menu:invoke", listener);
  },
});

contextBridge.exposeInMainWorld("credentialAPI", {
  getKey: (account: string) => ipcRenderer.invoke("credentials:get", account),
  setKey: (account: string, password: string) =>
    ipcRenderer.invoke("credentials:set", account, password),
  deleteKey: (account: string) =>
    ipcRenderer.invoke("credentials:delete", account),
});

contextBridge.exposeInMainWorld("diskAPI", {
  openFolder: () => ipcRenderer.invoke("disk:open-folder"),
  listRoots: () => ipcRenderer.invoke("disk:list-roots"),
  removeRoot: (rootPath: string) =>
    ipcRenderer.invoke("disk:remove-root", rootPath),
  readDirectory: (dirPath: string) =>
    ipcRenderer.invoke("disk:read-directory", dirPath),
  createDirectory: (parentDir: string, name: string) =>
    ipcRenderer.invoke("disk:create-directory", parentDir, name),
  readTextFile: (target: string) =>
    ipcRenderer.invoke("disk:read-text-file", target),
  rename: (target: string, nextName: string) =>
    ipcRenderer.invoke("disk:rename", target, nextName),
  move: (target: string, destinationDir: string) =>
    ipcRenderer.invoke("disk:move", target, destinationDir),
  trash: (target: string) => ipcRenderer.invoke("disk:trash", target),
  reveal: (target: string) => ipcRenderer.invoke("disk:reveal", target),
  openExternal: (target: string) =>
    ipcRenderer.invoke("disk:open-external", target),
  stat: (target: string) => ipcRenderer.invoke("disk:stat", target),
  onChanged: (callback: (payload: { directories: string[] }) => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: { directories: string[] },
    ) => callback(payload);
    ipcRenderer.on("disk:changed", listener);
    return () => ipcRenderer.removeListener("disk:changed", listener);
  },
});

contextBridge.exposeInMainWorld("metadataAPI", {
  read: (target: string) => ipcRenderer.invoke("metadata:read", target),
  saveProperties: (
    target: string,
    properties: { tags: string[]; description: string },
    expectedRevision: string,
  ) =>
    ipcRenderer.invoke(
      "metadata:save-properties",
      target,
      properties,
      expectedRevision,
    ),
  addRelated: (target: string, relatedTarget: string) =>
    ipcRenderer.invoke("metadata:add-related", target, relatedTarget),
  removeRelated: (target: string, edgeId: string) =>
    ipcRenderer.invoke("metadata:remove-related", target, edgeId),
});

contextBridge.exposeInMainWorld("activityAPI", {
  record: (target: string, kind: "opened") =>
    ipcRenderer.invoke("activity:record", target, kind),
  recent: (query?: { limit?: number }) =>
    ipcRenderer.invoke("activity:recent", query ?? {}),
  clear: () => ipcRenderer.invoke("activity:clear"),
  onChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("activity:changed", listener);
    return () => ipcRenderer.removeListener("activity:changed", listener);
  },
});

contextBridge.exposeInMainWorld("collectionsAPI", {
  query: (query: unknown, page?: { offset?: number; limit?: number }) =>
    ipcRenderer.invoke("collections:query", query, page ?? {}),
  tags: () => ipcRenderer.invoke("collections:tags"),
  onChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("collections:changed", listener);
    return () => ipcRenderer.removeListener("collections:changed", listener);
  },
});

contextBridge.exposeInMainWorld("viewsAPI", {
  list: () => ipcRenderer.invoke("views:list"),
  create: (definition: unknown) =>
    ipcRenderer.invoke("views:create", definition),
  save: (id: string, definition: unknown, expectedRevision: string) =>
    ipcRenderer.invoke("views:save", id, definition, expectedRevision),
  duplicate: (id: string) => ipcRenderer.invoke("views:duplicate", id),
  remove: (id: string) => ipcRenderer.invoke("views:remove", id),
  restore: (undoToken: string) =>
    ipcRenderer.invoke("views:restore", undoToken),
  onChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("views:changed", listener);
    return () => ipcRenderer.removeListener("views:changed", listener);
  },
});

contextBridge.exposeInMainWorld("markdownAPI", {
  read: (target: string) => ipcRenderer.invoke("markdown:read", target),
  write: (target: string, body: string, expectedRevision: string) =>
    ipcRenderer.invoke("markdown:write", target, body, expectedRevision),
  create: (parentDir: string, baseName?: string) =>
    ipcRenderer.invoke("markdown:create", parentDir, baseName),
});

contextBridge.exposeInMainWorld("chatAPI", {
  list: () => ipcRenderer.invoke("chat:list"),
  get: (id: string) => ipcRenderer.invoke("chat:get", id),
  create: (options?: CreateConversationOptions) => ipcRenderer.invoke("chat:create", options),
  update: (id: string, patch: ConversationPatch) => ipcRenderer.invoke("chat:update", id, patch),
  getDraftState: () => ipcRenderer.invoke("chat:drafts-get"),
  saveDraftState: (state: ChatDraftState) => ipcRenderer.invoke("chat:drafts-save", state),
  remove: (id: string) => ipcRenderer.invoke("chat:remove", id),
  searchContent: (query: string, deep?: boolean) => ipcRenderer.invoke("chat:search-content", query, deep),
  indexStatus: () => ipcRenderer.invoke("chat:index-status"),
  indexUpdate: () => ipcRenderer.invoke("chat:index-update"),
  indexCancel: () => ipcRenderer.invoke("chat:index-cancel"),
  onIndexChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("chat:index-changed", listener);
    return () => ipcRenderer.removeListener("chat:index-changed", listener);
  },
  // One response channel per question; `null` ends the stream.
  ask: (
    conversationId: string,
    question: string,
    onDelta: (delta: string) => void,
    onError: (error: string) => void,
  ) => {
    const channel = `chat:answer:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const listener = (
      _event: IpcRendererEvent,
      payload: { delta?: string; error?: string } | null,
    ) => {
      if (payload === null) {
        ipcRenderer.removeListener(channel, listener);
        return;
      }
      if (payload.error) onError(payload.error);
      else if (payload.delta) onDelta(payload.delta);
    };
    ipcRenderer.on(channel, listener);
    const result = ipcRenderer.invoke(
      "chat:ask",
      conversationId,
      question,
      channel,
    );
    return {
      result,
      cancel: () => ipcRenderer.removeListener(channel, listener),
    };
  },
});

const vaultAPI: VaultAPI = {
  discover: () => ipcRenderer.invoke("vault:discover"),
  readDay: (root, date) => ipcRenderer.invoke("vault:read-day", root, date),
  createDay: (root, date) => ipcRenderer.invoke("vault:create-day", root, date),
  saveJournal: (path, original, next) =>
    ipcRenderer.invoke("vault:save-journal", path, original, next),
  addFocus: (root, date, input) =>
    ipcRenderer.invoke("vault:add-focus", root, date, input),
  updateFocus: (root, date, id, patch) =>
    ipcRenderer.invoke("vault:update-focus", root, date, id, patch),
  listDrafts: () => ipcRenderer.invoke("vault:list-drafts"),
  putDraft: (draft) => ipcRenderer.invoke("vault:put-draft", draft),
  clearDraft: (path, version) =>
    ipcRenderer.invoke("vault:clear-draft", path, version),
};
contextBridge.exposeInMainWorld("vaultAPI", vaultAPI);
