import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain, app } from 'electron';
import log from 'electron-log/main';

export class AppUpdater {
  private mainWindow: BrowserWindow | null = null;
  private isCheckingUpdate = false;
  private checkPromise: Promise<any> | null = null;
  private lastStatus: string = 'idle';
  private lastInfo: any = null;
  private lastError: string | undefined = undefined;
  private lastProgress: any = undefined;

  constructor() {
    log.info('[AppUpdater] Initializing');
    
    // Configure auto-updater
    autoUpdater.logger = log;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // Set the feed URL for GitHub
    if (!autoUpdater.getFeedURL()) {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'platinum-hill',
        repo: 'cobolt'
      });
    }

    // Log configuration
    log.info(`[AppUpdater] Version: ${app.getVersion()}, Packaged: ${app.isPackaged}`);

    // Set up handlers
    this.setupEventHandlers();
    this.setupIpcHandlers();
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  private setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      this.sendStatusToWindow('checking');
    });

    autoUpdater.on('update-available', (info) => {
      log.info(`[AppUpdater] Update available: v${info.version}`);
      this.isCheckingUpdate = false;
      this.checkPromise = null;
      this.sendStatusToWindow('available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
      this.isCheckingUpdate = false;
      this.checkPromise = null;
      this.sendStatusToWindow('not-available', info);
    });

    autoUpdater.on('error', (err) => {
      log.error('[AppUpdater] Error:', err.message);
      this.isCheckingUpdate = false;
      this.checkPromise = null;
      this.sendStatusToWindow('error', null, err.message);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      this.sendStatusToWindow('downloading', undefined, undefined, progressObj);
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info(`[AppUpdater] Update downloaded: v${info.version}`);
      this.sendStatusToWindow('downloaded', info);
    });
  }

  private setupIpcHandlers() {
    ipcMain.handle('check-for-updates', async () => {
      if (!app.isPackaged) {
        this.sendStatusToWindow('not-available', { version: app.getVersion() });
        return { 
          success: true, 
          updateInfo: null,
          message: 'Updates only available in packaged app' 
        };
      }

      // If already checking, return the existing promise
      if (this.isCheckingUpdate && this.checkPromise) {
        try {
          const result = await this.checkPromise;
          return { success: true, updateInfo: result?.updateInfo };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      }
      
      try {
        this.isCheckingUpdate = true;
        this.checkPromise = autoUpdater.checkForUpdatesAndNotify();
        const result = await this.checkPromise;
        return { success: true, updateInfo: result?.updateInfo };
      } catch (error) {
        log.error('[AppUpdater] Check failed:', error);
        this.sendStatusToWindow('error', null, error instanceof Error ? error.message : 'Unknown error');
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      } finally {
        this.isCheckingUpdate = false;
        this.checkPromise = null;
      }
    });

    ipcMain.handle('download-update', async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error) {
        log.error('[AppUpdater] Download failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('install-update', () => {
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    });

    ipcMain.handle('get-update-status', async () => {
      try {
        const currentVersion = app.getVersion();
        return {
          updateAvailable: this.lastStatus === 'available',
          updateInfo: this.lastInfo,
          currentVersion,
          isChecking: this.isCheckingUpdate,
          lastStatus: this.lastStatus,
          lastError: this.lastError,
          lastProgress: this.lastProgress,
        };
      } catch (error) {
        log.error('[AppUpdater] Status check failed:', error);
        return { updateAvailable: false, currentVersion: app.getVersion() };
      }
    });

    ipcMain.handle('check-for-updates-menu', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-status', {
          status: this.isCheckingUpdate ? 'checking' : this.lastStatus || 'idle',
          info: this.lastInfo,
          error: this.lastError,
          progress: this.lastProgress,
        });
      }
      return { success: true };
    });
  }

  private sendStatusToWindow(status: string, info?: any, error?: string, progress?: any) {
    this.lastStatus = status;
    this.lastInfo = info;
    this.lastError = error;
    this.lastProgress = progress;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', {
        status,
        info,
        error,
        progress
      });
    }
  }

  checkForUpdatesOnStartup() {
    if (!app.isPackaged) {
      return;
    }

    // Check for updates 3 seconds after startup to avoid conflicts
    setTimeout(() => {
      this.sendStatusToWindow('checking');
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
        log.error('[AppUpdater] Startup check failed:', err.message);
      });
    }, 3000);
  }

  checkForUpdatesManually() {
    autoUpdater.checkForUpdatesAndNotify();
  }
}