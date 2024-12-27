import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { setupFileSystem } from "./main/fileSystem";
import {
  addTopLevelFolder,
  getTopLevelFolders,
  removeTopLevelFolder,
} from "./main/configManager";
import { setupEmbeddingService } from "./main/embeddings";
import log from "./main/logger";
import { DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH } from "./renderer/config/setup";


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
const isDevelopment = process.env.NODE_ENV === "development";

// More lenient CSP
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  // This is used for Ollama 
  "connect-src 'self' https: ws: http://localhost:11434",
  "media-src 'self' https:",
];

const createWindow = () => {
  log.info(`Creating main window; windowWidth: ${DEFAULT_WINDOW_WIDTH}, windowHeight: ${DEFAULT_WINDOW_HEIGHT}`);
  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // Block the render process from having direct NodeJS access
      nodeIntegration: false,
      // Separate JS context for render process from the main process
      contextIsolation: true,
      // Restricts what the render process can do at a system level
      sandbox: true,
    },
  });

  // Set Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [CSP.join("; ")],
        },
      });
    }
  );

  // Load the main page (which will contain the navigation)
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    log.info(`Loading URL: ${MAIN_WINDOW_VITE_DEV_SERVER_URL}`);
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    const filePath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    log.info(`Loading file: ${filePath}`);
    mainWindow.loadFile(filePath);
  }

  // Open the DevTools in development
  if (isDevelopment){
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-finish-load', () => {
    log.info('Main window finished loading');
  });

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    log.error(`Failed to load page: ${errorCode} - ${errorDescription}`);
  });
};

// Set up IPC listeners for window controls
ipcMain.on("minimize-window", () => {
  log.info('Minimizing window');
  mainWindow?.minimize();
});

ipcMain.on("maximize-window", () => {
  if (mainWindow?.isMaximized()) {
    log.info('Unmaximizing window');
    mainWindow.unmaximize();
  } else {
    log.info('Maximizing window');
    mainWindow?.maximize();
  }
});

ipcMain.on("close-window", () => {
  log.info('Closing window');
  mainWindow?.close();
});

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {

  // Log permission errors
  process.on('uncaughtException', (error) => {
    console.log('error-1', error)
  });

  try {
    await setupFileSystem();
    log.info('File system setup complete');
    await setupEmbeddingService();
    log.info('Embedding service setup complete');
    createWindow();
  } catch (error) {
    log.error(`Error during app setup: ${error}`);
  }
});

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    log.info('All windows closed, quitting app');
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    log.info('Activating app, creating new window');
    createWindow();
  }
});

// Add error handling
process.on("uncaughtException", (error) => {
  log.error(`Uncaught exception: ${error}`);
  dialog.showErrorBox('An error occurred', error.message);
});

// IPC handlers for top-level folder management
ipcMain.handle("get-top-level-folders", async () => {
  log.info('Getting top-level folders');
  return getTopLevelFolders();
});

ipcMain.handle("add-top-level-folder", async (_, folderPath) => {
  log.info(`Adding top-level folder: ${folderPath}`);
  await addTopLevelFolder(folderPath);
  return getTopLevelFolders();
});

ipcMain.handle("remove-top-level-folder", async (_, folderPath) => {
  log.info(`Removing top-level folder: ${folderPath}`);
  await removeTopLevelFolder(folderPath);
  return getTopLevelFolders();
});

// Folder selection dialog handler
ipcMain.handle("open-folder-dialog", async () => {
  log.info('Opening folder dialog');
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Select Folder",
    title: "Select a folder to add as a top-level folder",
  });

  if (!result.canceled && result.filePaths.length > 0) {
    log.info(`Folder selected: ${result.filePaths[0]}`);
    return result.filePaths[0];
  }
  log.info('Folder selection cancelled');
  return null;
});