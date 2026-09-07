import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  nativeTheme,
  screen,
  Menu,
} from "electron";
import path from "path";
import {
  DEFAULT_BROWSER_WINDOW_HEIGHT,
  DEFAULT_BROWSER_WINDOW_WIDTH,
} from "@/common/constants";
import {
  closeDatabase,
  initializeDatabase,
  registerEmbeddingIPCHandlers,
  registerDatabaseIPCHandlers,
  log,
} from "@/main/index";
import { ensureAllTablesExist } from "@/main/database/handlers";
import { SystemHandlers } from "@/main/services/system/SystemHandlers";
import { CredentialHandlers } from "@/main/services/credentials/CredentialHandlers";
import { VFSManager } from "@/main/services/vfs/VfsManager";
import { VFSHandlers } from "@/main/services/vfs/VfsHandlers";
import { CredentialManager } from "@/main/services/credentials/CredentialManager";
import DatabaseManager from "@/main/database/db";
import { ItemRepository } from "@/main/database/repositories/itemRepository";
import { RootRegistry } from "@/main/fs/RootRegistry";
import { WindowStateStore } from "@/main/window/WindowStateStore";
import { AppMenu } from "@/main/menu/AppMenu";
import {
  resolveBounds,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
} from "@/main/window/windowBounds";
import { DiskReader } from "@/main/fs/DiskReader";
import { DiskHandlers } from "@/main/fs/DiskHandlers";
import { DiskWatcher } from "@/main/fs/DiskWatcher";
import { FileWriter } from "@/main/fs/FileWriter";
import { ThumbnailService } from "@/main/fs/ThumbnailService";
import { MetadataService } from "@/main/fs/MetadataService";
import { MetadataHandlers } from "@/main/fs/MetadataHandlers";
import { ActivityStore } from "@/main/activity/ActivityStore";
import { ActivityService } from "@/main/activity/ActivityService";
import { ActivityHandlers } from "@/main/activity/ActivityHandlers";
import { activityStorePath, libraryDirectory } from "@/main/library/libraryPaths";
import { ViewRepository } from "@/main/views/ViewRepository";
import { ViewHandlers } from "@/main/views/ViewHandlers";
import { CollectionIndex } from "@/main/collections/CollectionIndex";
import { CollectionQueryService } from "@/main/collections/CollectionQueryService";
import { CollectionHandlers } from "@/main/collections/CollectionHandlers";
import {
  OPAL_FILE_SCHEME,
  OPAL_THUMB_SCHEME,
  registerOpalFileScheme,
  registerOpalFileProtocol,
  registerOpalThumbProtocol,
} from "@/main/protocol/opalFile";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// Only run this check on Windows
if (process.platform === "win32") {
  if (require("electron-squirrel-startup")) {
    app.quit();
  }
}

// More reliable detection of development mode in Electron Forge
const isDevelopment = process.env.NODE_ENV === "development";
// Always consider it development mode when VITE_DEV_SERVER_URL is defined
const forceDevTools = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined";
const WINDOW_BACKGROUND = {
  light: "#FCFCFD",
  dark: "#161617",
} as const;
let mainWindow: BrowserWindow | null = null;

// CSP Configuration
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: https: ${OPAL_FILE_SCHEME}: ${OPAL_THUMB_SCHEME}:`,
  "font-src 'self' data:",
  `connect-src 'self' https: ws: http://localhost:11434 ${OPAL_FILE_SCHEME}:`, // Ollama + disk assets
  `media-src 'self' https: ${OPAL_FILE_SCHEME}:`,
  `object-src 'self' ${OPAL_FILE_SCHEME}:`,
  `frame-src 'self' ${OPAL_FILE_SCHEME}:`,
].join("; "); // Join CSP directives

// Must run at module load, before app.whenReady() — Electron requires
// privileged schemes to be declared before the protocol layer initializes.
registerOpalFileScheme();

// In development the app runs inside Electron's own bundle, so getName() would
// report "Electron" and title the macOS app menu with it. productName is what
// the packaged app uses; set it here so both builds read "Opal".
app.setName("Opal");

const createWindow = () => {
  log.info(
    `Creating main window; windowWidth: ${DEFAULT_BROWSER_WINDOW_WIDTH}, windowHeight: ${DEFAULT_BROWSER_WINDOW_HEIGHT}`
  );

  const displays = screen.getAllDisplays().map((display) => display.workArea);
  const saved = resolveBounds(windowStateStore.get(), displays, {
    width: DEFAULT_BROWSER_WINDOW_WIDTH,
    height: DEFAULT_BROWSER_WINDOW_HEIGHT,
  });

  // Painting the window's own background before the renderer loads is what
  // removes the white flash. A saved resolved hint wins; first launch follows
  // the OS, matching the inline pre-paint resolver's `system` default.
  const systemTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  const resolvedTheme = windowStateStore.getThemeHint(systemTheme);

  mainWindow = new BrowserWindow({
    width: saved?.width ?? DEFAULT_BROWSER_WINDOW_WIDTH,
    height: saved?.height ?? DEFAULT_BROWSER_WINDOW_HEIGHT,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: WINDOW_BACKGROUND[resolvedTheme],
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (saved?.isMaximized) mainWindow.maximize();

  // Reveal only once the first frame is ready. Without this the user sees an
  // empty window for the duration of the renderer's startup.
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Debounced because macOS emits resize and move continuously during a drag;
  // writing the file on every event would mean hundreds of writes per gesture.
  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // getNormalBounds returns the pre-maximize rectangle, so un-maximizing
      // after a restart restores a useful size rather than a full-screen one.
      const { x, y, width, height } = mainWindow.getNormalBounds();
      void windowStateStore.save({
        x, y, width, height,
        isMaximized: mainWindow.isMaximized(),
      });
    }, 400);
  };

  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);
  mainWindow.on("maximize", scheduleSave);
  mainWindow.on("unmaximize", scheduleSave);

  mainWindow.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { x, y, width, height } = mainWindow.getNormalBounds();
    void windowStateStore.save({
      x, y, width, height,
      isMaximized: mainWindow.isMaximized(),
    });
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [CSP],
        },
      });
    }
  );

  const loadPage = () => {
    // Helper function for loading page
    try {
      // Check if we're in development mode with Vite's dev server
      if (
        typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" &&
        MAIN_WINDOW_VITE_DEV_SERVER_URL
      ) {
        log.info(`Loading URL: ${MAIN_WINDOW_VITE_DEV_SERVER_URL}`);
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      } else {
        // Production mode: load from the packaged files
        try {
          const rendererPath =
            typeof MAIN_WINDOW_VITE_NAME !== "undefined"
              ? `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
              : "../renderer/main_window/index.html";

          const filePath = path.join(__dirname, rendererPath);
          log.info(`Loading file: ${filePath}`);
          mainWindow.loadFile(filePath);
        } catch (pathErr) {
          // Fallback approach if the above fails
          log.warn(
            `Error with standard path, trying fallback: ${pathErr.message}`
          );
          const fallbackPath = path.join(
            __dirname,
            "../renderer/main_window/index.html"
          );
          log.info(`Loading fallback file: ${fallbackPath}`);
          mainWindow.loadFile(fallbackPath);
        }
      }
    } catch (err) {
      log.error(`Failed to load page: ${err.message}`);
      dialog.showErrorBox(
        "Loading Error",
        `Failed to load application: ${err.message}`
      );
    }
  };

  loadPage();

  // Open dev tools if in development mode
  if (isDevelopment || forceDevTools) {
    mainWindow.webContents.openDevTools();
    console.log(
      "Opening DevTools - development mode:",
      isDevelopment,
      "forceDevTools:",
      forceDevTools
    );
  }

  mainWindow.webContents.on("did-finish-load", () => {
    log.info("Main window finished loading");
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_, errorCode, errorDescription) => {
      log.error(`Failed to load page: ${errorCode} - ${errorDescription}`);
    }
  );

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

// --- App Lifecycle Events
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
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
  dialog.showErrorBox("An error occurred", error.message);
});

// --- IPC Handlers ---
const dbManager = DatabaseManager.getInstance();
const dbItemRepository = new ItemRepository({ dbManager });
const vfsManager = new VFSManager({ itemRepository: dbItemRepository });

const systemHandlers = new SystemHandlers({
  ipc: ipcMain,
  dialog,
  browserWindow: BrowserWindow,
  onThemeChanged: (report) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(WINDOW_BACKGROUND[report.resolved]);
    }
    void windowStateStore.saveTheme(report);
  },
});

const credentialHandlers = new CredentialHandlers({
  ipc: ipcMain,
  credentialManager: CredentialManager.getInstance(),
});

const vfsHandlers = new VFSHandlers({ ipc: ipcMain, vfsManager });

// OPAL_TEST_USER_DATA_DIR lets the E2E suite point the roots file at a temp
// directory, mirroring the existing OPAL_TEST_DB_DIR convention. Without it,
// tests would write into the real app's user data and corrupt the user's
// actual list of opened folders.
const userDataDir = process.env.OPAL_TEST_USER_DATA_DIR || app.getPath("userData");
const windowStateStore = new WindowStateStore({
  storePath: path.join(userDataDir, "window-state.json"),
});

const appMenu = new AppMenu({
  menu: Menu,
  appName: app.getName(),
  send: (commandId) => {
    BrowserWindow.getFocusedWindow()?.webContents.send("menu:invoke", commandId);
  },
});

// Install an empty menu immediately so the app never shows Electron's stock
// developer menu, even for the moment before the renderer reports its commands.
appMenu.install([]);

// Registered at module scope: doing it inside createWindow would add a
// duplicate listener each time the window is reopened from the dock.
ipcMain.on("menu:commands", (_event, commands) => {
  appMenu.install(Array.isArray(commands) ? commands : []);
});

const rootRegistry = new RootRegistry({
  storePath: path.join(userDataDir, "disk-roots.json"),
});
const diskReader = new DiskReader({ registry: rootRegistry });
const activityStore = new ActivityStore({ storePath: activityStorePath(userDataDir) });
// Collections re-evaluate after index, root or activity changes; one coalesced
// event covers all three so the renderer never reloads twice for one cause.
let collectionsChangedTimer: NodeJS.Timeout | null = null;
const notifyCollectionsChanged = () => {
  if (collectionsChangedTimer) return;
  collectionsChangedTimer = setTimeout(() => {
    collectionsChangedTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("collections:changed", {});
  }, 150);
};
const collectionIndex = new CollectionIndex({
  registry: rootRegistry,
  onChanged: notifyCollectionsChanged,
});
const activityService = new ActivityService({
  registry: rootRegistry,
  store: activityStore,
  statEntry: (target) => diskReader.statEntry(target),
  onChanged: () => {
    notifyCollectionsChanged();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("activity:changed", {});
  },
});
const viewRepository = new ViewRepository({
  libraryDirectory: libraryDirectory(userDataDir),
  onChanged: () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("views:changed", {});
  },
});
const collectionQueryService = new CollectionQueryService({
  registry: rootRegistry,
  index: collectionIndex,
  activity: activityStore,
});
const metadataService = new MetadataService({
  registry: rootRegistry,
  activity: activityService,
});
const diskWatcher = new DiskWatcher({
  onChanged: (directories) => {
    collectionIndex.invalidateDirectories(directories);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("disk:changed", { directories });
  },
  onMetadataChanged: () => metadataService.invalidate(),
});
const fileWriter = new FileWriter({
  registry: rootRegistry,
  metadata: metadataService,
  activity: activityService,
  trashItem: (fullPath) => shell.trashItem(fullPath),
});
const thumbnailService = new ThumbnailService({
  registry: rootRegistry,
  cacheDir: path.join(userDataDir, "thumbnails"),
  createThumbnail: (sourcePath, maxSize) =>
    nativeImage.createThumbnailFromPath(sourcePath, maxSize),
});
const diskHandlers = new DiskHandlers({
  ipc: ipcMain,
  registry: rootRegistry,
  reader: diskReader,
  showOpenDialog: async () => {
    const window = BrowserWindow.getFocusedWindow();
    const options = { properties: ["openDirectory" as const] };
    return window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options);
  },
  shell: {
    showItemInFolder: (fullPath) => shell.showItemInFolder(fullPath),
    openPath: (fullPath) => shell.openPath(fullPath),
  },
  watcher: diskWatcher,
  writer: fileWriter,
  onRootsChanged: () => {
    collectionIndex.invalidateAll();
    notifyCollectionsChanged();
  },
});
const metadataHandlers = new MetadataHandlers({
  ipc: ipcMain,
  service: metadataService,
});
const activityHandlers = new ActivityHandlers({
  ipc: ipcMain,
  service: activityService,
});
const collectionHandlers = new CollectionHandlers({
  ipc: ipcMain,
  service: collectionQueryService,
});
const viewHandlers = new ViewHandlers({
  ipc: ipcMain,
  repository: viewRepository,
});

// --- Primary Initialization and Cleanup ---
app.whenReady().then(async () => {
  try {
    log.info("Initializing application...");

    systemHandlers.registerAll();
    log.info("System IPC handlers registered");

    credentialHandlers.registerAll();
    log.info("Credential IPC handlers registered");

    vfsHandlers.registerAll();
    log.info("Virtual File System (VFS) IPC handlers registered");

    await rootRegistry.load();
    await activityStore.load();
    try {
      await viewRepository.watch();
    } catch (error) {
      log.error(
        "Failed to watch the views directory; external view edits will not refresh until restart",
        error instanceof Error ? error : undefined
      );
    }
    for (const root of rootRegistry.list()) {
      try {
        await diskWatcher.watch(root);
      } catch (error) {
        log.error(
          `Failed to start disk watcher for ${root}; continuing without live updates for that root`,
          error instanceof Error ? error : undefined
        );
      }
    }
    registerOpalFileProtocol({ registry: rootRegistry });
    registerOpalThumbProtocol({ thumbnails: thumbnailService });
    diskHandlers.registerAll();
    metadataHandlers.registerAll();
    activityHandlers.registerAll();
    collectionHandlers.registerAll();
    viewHandlers.registerAll();
    log.info("Disk explorer IPC handlers and file protocols registered");

    await registerDatabaseIPCHandlers();
    log.info("Database IPC handlers registered");

    await registerEmbeddingIPCHandlers();
    log.info("Embedding IPC handlers registered");

    await initializeDatabase();
    log.info("Database initialized successfully");

    // Ensure all database tables exist with correct schema
    await ensureAllTablesExist();
    log.info("Database tables verified");

    await windowStateStore.load();
    log.info("Window state loaded");

    createWindow();
    log.info("Application initialization completed");
  } catch (error) {
    log.error(`Error during app setup: ${error}`);
    dialog.showErrorBox(
      "Initialization Error",
      `Failed to initialize the application: ${error.message}`
    );
  }
});

app.on("before-quit", async () => {
  try {
    void diskWatcher.closeAll();
    void viewRepository.close();
    await closeDatabase();
  } catch (error) {
    log.error("Error during app shutdown:", error);
  }
});
