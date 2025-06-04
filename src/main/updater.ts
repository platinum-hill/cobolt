import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain, app } from 'electron';
import log from 'electron-log/main';

export class AppUpdater {
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    log.info('[AppUpdater] Initializing auto-updater');
    
    // Configure auto-updater
    autoUpdater.logger = log;
    autoUpdater.autoDownload = false; // Manual download control
    autoUpdater.autoInstallOnAppQuit = true;

    // Set the feed URL explicitly for GitHub
    if (!autoUpdater.getFeedURL()) {
      log.info('[AppUpdater] No feed URL set, configuring GitHub provider');
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'platinum-hill',
        repo: 'cobolt'
      });
    }

    // Log the feed URL
    log.info('[AppUpdater] Feed URL:', JSON.stringify(autoUpdater.getFeedURL()));
    log.info('[AppUpdater] App version:', app.getVersion());
    log.info('[AppUpdater] Is packaged:', app.isPackaged);

    // Set up event handlers
    this.setupEventHandlers();
    this.setupIpcHandlers();
    
    log.info('[AppUpdater] Auto-updater initialized successfully');
  }

  setMainWindow(window: BrowserWindow) {
    log.info('[AppUpdater] Setting main window');
    this.mainWindow = window;
  }

  private setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      log.info('[AppUpdater] Event: checking-for-update');
      this.sendStatusToWindow('checking');
    });

    autoUpdater.on('update-available', (info) => {
      log.info('[AppUpdater] Event: update-available', JSON.stringify(info));
      this.sendStatusToWindow('available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
      log.info('[AppUpdater] Event: update-not-available', JSON.stringify(info));
      this.sendStatusToWindow('not-available', info);
    });

    autoUpdater.on('error', (err) => {
      log.error('[AppUpdater] Event: error', err.message, err.stack);
      this.sendStatusToWindow('error', null, err.message);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      log.info('[AppUpdater] Event: download-progress', `${progressObj.percent}%`);
      this.sendStatusToWindow('downloading', undefined, undefined, progressObj);
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info('[AppUpdater] Event: update-downloaded', JSON.stringify(info));
      this.sendStatusToWindow('downloaded', info);
    });
  }

  private setupIpcHandlers() {
    ipcMain.handle('check-for-updates', async () => {
      log.info('[AppUpdater] IPC: check-for-updates called');
      
      // In development, return a mock response
      if (!app.isPackaged) {
        log.info('[AppUpdater] Running in development mode, returning mock response');
        this.sendStatusToWindow('not-available', { version: app.getVersion() });
        return { 
          success: true, 
          updateInfo: null,
          message: 'Updates can only be checked in packaged app' 
        };
      }
      
      try {
        log.info('[AppUpdater] Calling autoUpdater.checkForUpdatesAndNotify()');
        const result = await autoUpdater.checkForUpdatesAndNotify();
        log.info('[AppUpdater] Check for updates result:', JSON.stringify(result));
        return { success: true, updateInfo: result?.updateInfo };
      } catch (error) {
        log.error('[AppUpdater] Check for updates error:', error);
        this.sendStatusToWindow('error', null, error instanceof Error ? error.message : 'Unknown error');
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('download-update', async () => {
      log.info('[AppUpdater] IPC: download-update called');
      try {
        await autoUpdater.downloadUpdate();
        log.info('[AppUpdater] Download initiated successfully');
        return { success: true };
      } catch (error) {
        log.error('[AppUpdater] Download update error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('install-update', () => {
      log.info('[AppUpdater] IPC: install-update called');
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    });

    ipcMain.handle('get-update-status', async () => {
      log.info('[AppUpdater] IPC: get-update-status called');
      try {
        const result = await autoUpdater.checkForUpdates();
        log.info('[AppUpdater] Update status result:', JSON.stringify(result));
        return {
          updateAvailable: result?.updateInfo ? true : false,
          updateInfo: result?.updateInfo
        };
      } catch (error) {
        log.error('[AppUpdater] Get update status error:', error);
        return { updateAvailable: false };
      }
    });

    // Remove the test-updater handler
  }

  private sendStatusToWindow(status: string, info?: any, error?: string, progress?: any) {
    log.info('[AppUpdater] Sending status to window:', status, info ? 'with info' : 'no info');
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', {
        status,
        info,
        error,
        progress
      });
      log.info('[AppUpdater] Status sent successfully');
    } else {
      log.warn('[AppUpdater] Cannot send status - window is null or destroyed');
    }
  }

  checkForUpdatesOnStartup() {
    log.info('[AppUpdater] Scheduling startup update check');
    // Check for updates 3 seconds after startup
    setTimeout(() => {
      log.info('[AppUpdater] Performing startup update check');
      autoUpdater.checkForUpdates().catch(err => {
        log.error('[AppUpdater] Auto update check failed:', err);
      });
    }, 3000);
  }

  checkForUpdatesManually() {
    log.info('[AppUpdater] Manual update check triggered');
    autoUpdater.checkForUpdates();
  }
}