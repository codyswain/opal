import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH } from "./renderer/config/setup";
import { closeDatabase, initializeDatabase } from "./main/database";
import { registerConfigIPCHandlers, registerEmbeddingIPCHandlers, registerFileSystemIPCHandlers, log } from "./main/index";
import { registerDatabaseIPCHandlers, ensureAllTablesExist } from "./main/database/handlers";


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

const isDevelopment = process.env.NODE_ENV === "development";
let mainWindow: BrowserWindow | null = null;

// CSP Configuration
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: ws: http://localhost:11434", // Ollama
  "media-src 'self' https:",
].join("; "); // Join CSP directives


const createWindow = () => {
  log.info(`Creating main window; windowWidth: ${DEFAULT_WINDOW_WIDTH}, windowHeight: ${DEFAULT_WINDOW_HEIGHT}`);

  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
      ...details.responseHeaders,
        "Content-Security-Policy": [CSP],
      },
    });
  });

  const loadPage = () => {  // Helper function for loading page
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      log.info(`Loading URL: ${MAIN_WINDOW_VITE_DEV_SERVER_URL}`);
      mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      const filePath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
      log.info(`Loading file: ${filePath}`);
      mainWindow.loadFile(filePath);
    }
  }

  loadPage();

  if (isDevelopment) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-finish-load', () => {
    log.info('Main window finished loading');
  });

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    log.error(`Failed to load page: ${errorCode} - ${errorDescription}`);
  });
};

// --- Window Control IPC Handlers
ipcMain.on("minimize-window", () => { mainWindow?.minimize(); });
ipcMain.on("maximize-window", () => {
  mainWindow?.isMaximized()? mainWindow.unmaximize(): mainWindow?.maximize();
});
ipcMain.on("close-window", () => { mainWindow?.close(); });


// --- App Lifecycle Events 
app.on("window-all-closed", () => {
  if (process.platform!== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- Error Handling ---
process.on("uncaughtException", (error) => {
  log.error(`Uncaught exception: ${error}`);
  dialog.showErrorBox('An error occurred', error.message);
});

// --- Primary Initialization and Cleanup ---
app.whenReady().then(async () => {
  process.on('uncaughtException', (error) => { // Keep this for early errors
    console.log('error-1', error);
  });

  try {
    await registerFileSystemIPCHandlers();
    await registerDatabaseIPCHandlers();
    await registerConfigIPCHandlers();
    await registerEmbeddingIPCHandlers();
    await initializeDatabase();
    
    // Ensure all database tables exist with correct schema
    await ensureAllTablesExist();
    log.info("Database tables verified");
    
    createWindow();
  } catch (error) {
    log.error(`Error during app setup: ${error}`);
  }
});

app.on('before-quit', async () => {
  try {
    await closeDatabase();
  } catch (error) {
    log.error("Error during app shutdown:", error);
  }
});