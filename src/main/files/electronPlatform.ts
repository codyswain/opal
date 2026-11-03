import { app, BrowserWindow, clipboard, dialog, nativeImage, shell } from 'electron';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import type { FilesPlatform } from './FilesService';

/** What the files service asks of macOS, through Electron. Tests pass their own. */
export function electronFilesPlatform(): FilesPlatform {
  return {
    openPath: (file) => shell.openPath(file),
    showItemInFolder: (file) => shell.showItemInFolder(file),
    // Launch Services answers for a file URL with the app that opens that file's type.
    appName: async (file) => app.getApplicationNameForProtocol(pathToFileURL(file).href).replace(/\.app$/, '') || null,
    quickLook: (file, name) => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      window?.previewFile(file, name);
    },
    thumbnail: async (file, px) => {
      const image = await nativeImage.createThumbnailFromPath(file, { width: px, height: px });
      if (image.isEmpty()) return null;
      return px > 512 ? { bytes: image.toJPEG(85), type: 'image/jpeg' } : { bytes: image.toPNG(), type: 'image/png' };
    },
    // Slack, Gmail and Finder take a file URL on the pasteboard as the file itself.
    copyFileToClipboard: (file) => clipboard.writeBuffer('public.file-url', Buffer.from(pathToFileURL(file).href)),
    copyImageToClipboard: (file) => {
      const image = nativeImage.createFromPath(file);
      if (image.isEmpty()) return false;
      clipboard.writeImage(image);
      return true;
    },
    saveDialog: async (name) => {
      const window = BrowserWindow.getFocusedWindow();
      const options = { defaultPath: path.join(os.homedir(), 'Downloads', name) };
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },
    startDrag: async (sender, file) => {
      const icon = await app.getFileIcon(file, { size: 'normal' }).catch(() => nativeImage.createEmpty());
      sender.startDrag({ file, icon });
    },
  };
}
