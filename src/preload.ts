import type { VaultAPI } from "./types/vault";
import type { VaultDayChange } from "./types/day";
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import type { ThemeReport } from "./common/theme";
import type { OpenPageRequest } from "./common/opalLink";
import type { MarkdownCopyLabel, UnsavedPage } from "./types/markdown";

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
    commands: Array<{
      id: string;
      label: string;
      accelerator?: string;
      aliases?: string[];
    }>,
  ) => ipcRenderer.send("menu:commands", commands),
  onMenuCommand: (handler: (commandId: string) => void) => {
    const listener = (_event: IpcRendererEvent, commandId: string) =>
      handler(commandId);
    ipcRenderer.on("menu:invoke", listener);
    return () => ipcRenderer.removeListener("menu:invoke", listener);
  },
  closeWindow: () => ipcRenderer.send("system:close-window"),
  isFullScreen: () => ipcRenderer.invoke("system:is-full-screen"),
  onFullScreenChange: (handler: (fullScreen: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, fullScreen: boolean) =>
      handler(fullScreen);
    ipcRenderer.on("system:full-screen", listener);
    return () => ipcRenderer.removeListener("system:full-screen", listener);
  },
  onOpenPage: (handler: (request: OpenPageRequest) => void) => {
    const listener = (_event: IpcRendererEvent, request: OpenPageRequest) =>
      handler(request);
    ipcRenderer.on("system:open-page", listener);
    // Links that came before anything listened wait in main until this.
    ipcRenderer.send("system:open-page-ready");
    return () => ipcRenderer.removeListener("system:open-page", listener);
  },
});

contextBridge.exposeInMainWorld("credentialAPI", {
  getKey: (account: string) => ipcRenderer.invoke("credentials:get", account),
  setKey: (account: string, password: string) =>
    ipcRenderer.invoke("credentials:set", account, password),
  deleteKey: (account: string) =>
    ipcRenderer.invoke("credentials:delete", account),
});

/**
 * Every open editor, a stack's twelve among them, follows disk changes. One
 * IPC listener hands each change to all of them, so the count of listeners
 * on the channel stays at one.
 */
const diskChangeListeners = new Set<(payload: { directories: string[] }) => void>();
const fanOutDiskChange = (_event: IpcRendererEvent, payload: { directories: string[] }) => {
  for (const listener of [...diskChangeListeners]) listener(payload);
};

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
  searchContent: (query: string) => ipcRenderer.invoke("disk:search-content", query),
  onChanged: (callback: (payload: { directories: string[] }) => void) => {
    diskChangeListeners.add(callback);
    if (diskChangeListeners.size === 1) ipcRenderer.on("disk:changed", fanOutDiskChange);
    return () => {
      diskChangeListeners.delete(callback);
      if (diskChangeListeners.size === 0) ipcRenderer.removeListener("disk:changed", fanOutDiskChange);
    };
  },
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
});

// The main process holds a window's close until this answers, so it answers
// even when no page registered anything to flush.
// The answer lists the pages whose text did not reach their files.
let flushPendingSaves: (() => Promise<UnsavedPage[]>) | null = null;
ipcRenderer.on("markdown:flush", (_event, requestId: number) => {
  void Promise.resolve()
    .then(() => flushPendingSaves?.() ?? [])
    .catch(() => [])
    .then((unsaved) => ipcRenderer.send("markdown:flushed", requestId, unsaved));
});

contextBridge.exposeInMainWorld("markdownAPI", {
  read: (target: string) => ipcRenderer.invoke("markdown:read", target),
  properties: (target: string) =>
    ipcRenderer.invoke("markdown:properties", target),
  write: (target: string, body: string, expectedRevision: string) =>
    ipcRenderer.invoke("markdown:write", target, body, expectedRevision),
  create: (parentDir: string, baseName?: string) =>
    ipcRenderer.invoke("markdown:create", parentDir, baseName),
  saveCopy: (target: string, body: string, label: MarkdownCopyLabel) =>
    ipcRenderer.invoke("markdown:save-copy", target, body, label),
  resolveLinks: (from: string, targets: string[]) =>
    ipcRenderer.invoke("markdown:resolve-links", from, targets),
  setFlushHandler: (flush: () => Promise<UnsavedPage[]>) => {
    flushPendingSaves = flush;
  },
});

const vaultAPI: VaultAPI = {
  discover: () => ipcRenderer.invoke("vault:discover"),
  createDay: (root, date) => ipcRenderer.invoke("vault:create-day", root, date),
  day: (root, date) => ipcRenderer.invoke("vault:day", root, date),
  stack: (root, kind, head) => ipcRenderer.invoke("vault:stack", root, kind, head),
  checkDigestItem: (root, path, line, raw, checked) =>
    ipcRenderer.invoke("vault:check-digest-item", root, path, line, raw, checked),
  onDayChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, change: VaultDayChange) =>
      callback(change);
    ipcRenderer.on("vault:day-changed", listener);
    return () => ipcRenderer.removeListener("vault:day-changed", listener);
  },
};
contextBridge.exposeInMainWorld("vaultAPI", vaultAPI);
