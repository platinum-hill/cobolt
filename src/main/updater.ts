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
        repo: 'cobolt',
      });
    }

    // Log configuration
    log.info(
      `[AppUpdater] Version: ${app.getVersion()}, Packaged: ${app.isPackaged}`,
    );

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

    ipcMain.handle('check-for-updates-menu', async () => {
      if (!app.isPackaged) {
        this.sendStatusToWindow('not-available', { version: app.getVersion() });
        return {
          success: true,
          updateInfo: null,
          message: 'Updates only available in packaged app',
        };
      }

      // If already checking, wait for the result
      if (this.isCheckingUpdate && this.checkPromise) {
        try {
          const result = await this.checkPromise;
          return { success: true, updateInfo: result?.updateInfo };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }

      try {
        this.isCheckingUpdate = true;
        this.sendStatusToWindow('checking');
        this.checkPromise = autoUpdater.checkForUpdates();
        const result = await this.checkPromise;
        return { success: true, updateInfo: result?.updateInfo };
      } catch (error) {
        log.error('[AppUpdater] Menu check failed:', error);
        this.sendStatusToWindow(
          'error',
          null,
          error instanceof Error ? error.message : 'Unknown error',
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      } finally {
        this.isCheckingUpdate = false;
        this.checkPromise = null;
      }
    });

    ipcMain.handle('enable-auto-install', () => {
      log.info('[AppUpdater] Enabling auto-install on next quit');
      autoUpdater.autoInstallOnAppQuit = true;
      return { success: true };
    });

    ipcMain.handle('download-and-install', async () => {
      try {
        log.info('[AppUpdater] Download and install requested');

        // Check current status
        if (this.lastStatus === 'downloaded') {
          log.info('[AppUpdater] Update already downloaded, ready to install');
          return { success: true, readyToInstall: true };
        }

        if (this.lastStatus === 'available' && this.lastInfo) {
          log.info('[AppUpdater] Starting download...');
          this.sendStatusToWindow('downloading', this.lastInfo, undefined, {
            percent: 0,
            transferred: 0,
            total: 0,
          });

          // Download the update
          await autoUpdater.downloadUpdate();

          log.info('[AppUpdater] Download completed, ready to install');
          return { success: true, readyToInstall: true };
        }

        return { success: false, error: 'No update available to download' };
      } catch (error) {
        log.error('[AppUpdater] Download and install failed:', error);
        this.sendStatusToWindow(
          'error',
          null,
          error instanceof Error ? error.message : 'Unknown error',
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  private sendStatusToWindow(
    status: string,
    info?: any,
    error?: string,
    progress?: any,
  ) {
    this.lastStatus = status;
    this.lastInfo = info;
    this.lastError = error;
    this.lastProgress = progress;

    log.info(`[AppUpdater] Sending status to window: ${status}`, {
      hasMainWindow: !!this.mainWindow,
      isDestroyed: this.mainWindow?.isDestroyed(),
      info: info ? { version: info.version } : undefined,
      error,
      progress,
    });

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', {
        status,
        info,
        error,
        progress,
      });
      log.info(`[AppUpdater] Status sent to renderer: ${status}`);
    } else {
      log.warn('[AppUpdater] Cannot send status - main window not available');
    }
  }

  checkForUpdatesOnStartup() {
    if (!app.isPackaged) {
      log.info('[AppUpdater] Skipping startup check - not packaged');
      return;
    }

    // Check for updates after a delay to ensure UI is ready
    setTimeout(async () => {
      log.info('[AppUpdater] Starting automatic update check');

      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        log.warn('[AppUpdater] Main window not ready for startup check');
        return;
      }

      // Send the check-for-updates-menu event to trigger the same flow as manual checks
      // This ensures the UI component is ready and listening
      this.mainWindow.webContents.send('check-for-updates-menu');
      log.info(
        '[AppUpdater] Sent check-for-updates-menu event for startup check',
      );
    }, 3000);
  }
}
