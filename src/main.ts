import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH } from "./renderer/config/setup";
import { 
  closeDatabase, 
  initializeDatabase,
  registerEmbeddingIPCHandlers, 
  registerFileSystemIPCHandlers,
  registerDatabaseIPCHandlers,
  log 
} from "./main/index";
import { ensureAllTablesExist } from "./main/database/handlers";
import { registerCredentialIPCHandlers } from "./main/credentials/handlers";


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// Only run this check on Windows
if (process.platform === 'win32') { 
  if (require("electron-squirrel-startup")) {
    app.quit();
  }
}

// More reliable detection of development mode in Electron Forge
const isDevelopment = process.env.NODE_ENV === "development";
// Always consider it development mode when VITE_DEV_SERVER_URL is defined
const forceDevTools = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined';
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
    try {
      // Check if we're in development mode with Vite's dev server
      if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        log.info(`Loading URL: ${MAIN_WINDOW_VITE_DEV_SERVER_URL}`);
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      } else {
        // Production mode: load from the packaged files
        try {
          const rendererPath = typeof MAIN_WINDOW_VITE_NAME !== 'undefined' 
            ? `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html` 
            : '../renderer/main_window/index.html';
          
          const filePath = path.join(__dirname, rendererPath);
          log.info(`Loading file: ${filePath}`);
          mainWindow.loadFile(filePath);
        } catch (pathErr) {
          // Fallback approach if the above fails
          log.warn(`Error with standard path, trying fallback: ${pathErr.message}`);
          const fallbackPath = path.join(__dirname, '../renderer/main_window/index.html');
          log.info(`Loading fallback file: ${fallbackPath}`);
          mainWindow.loadFile(fallbackPath);
        }
      }
    } catch (err) {
      log.error(`Failed to load page: ${err.message}`);
      dialog.showErrorBox('Loading Error', `Failed to load application: ${err.message}`);
    }
  }

  loadPage();

  // Open dev tools if in development mode
  if (isDevelopment) {
    mainWindow.webContents.openDevTools();
    console.log("Opening DevTools - development mode:", isDevelopment, "forceDevTools:", forceDevTools);
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
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // Ensure app is ready before creating window.
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- Error Handling ---
process.on("uncaughtException", (error) => {
  log.error(`Uncaught exception: ${error}`);
  dialog.showErrorBox('An error occurred', error.message);
});

// --- Primary Initialization and Cleanup ---
app.whenReady().then(async () => {
  try {
    log.info("Initializing application...");
    
    await registerFileSystemIPCHandlers();
    log.info("File system IPC handlers registered");
    
    await registerDatabaseIPCHandlers();
    log.info("Database IPC handlers registered");
    
    await registerCredentialIPCHandlers();
    log.info("Credential IPC handlers registered");
    
    await registerEmbeddingIPCHandlers();
    log.info("Embedding IPC handlers registered");
    
    await initializeDatabase();
    log.info("Database initialized successfully");
    
    // Ensure all database tables exist with correct schema
    await ensureAllTablesExist();
    log.info("Database tables verified");
    
    createWindow();
    log.info("Application initialization completed");
  } catch (error) {
    log.error(`Error during app setup: ${error}`);
    dialog.showErrorBox('Initialization Error', `Failed to initialize the application: ${error.message}`);
  }
});

app.on('before-quit', async () => {
  try {
    await closeDatabase();
  } catch (error) {
    log.error("Error during app shutdown:", error);
  }
});