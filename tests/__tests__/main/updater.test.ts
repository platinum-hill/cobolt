import { ipcMain, app } from 'electron';
import { autoUpdater } from 'electron-updater';
import AppUpdater from '../../../src/main/updater';

// Mock electron modules
jest.mock('electron', () => ({
  BrowserWindow: jest.fn(),
  ipcMain: {
    handle: jest.fn(),
  },
  app: {
    getVersion: jest.fn().mockReturnValue('1.0.0'),
    isPackaged: false,
  },
}));

// Mock electron-updater
jest.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: true,
    autoInstallOnAppQuit: false,
    getFeedURL: jest.fn(),
    setFeedURL: jest.fn(),
    on: jest.fn(),
    checkForUpdates: jest.fn(),
    downloadUpdate: jest.fn(),
    quitAndInstall: jest.fn(),
  },
}));

// Mock electron-log
jest.mock('electron-log/main', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('AppUpdater', () => {
  let appUpdater: AppUpdater;
  let mockMainWindow: any;
  let mockWebContents: any;
  let ipcHandlers: Map<string, Function>;
  let autoUpdaterHandlers: Map<string, Function>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Reset handler maps
    ipcHandlers = new Map();
    autoUpdaterHandlers = new Map();

    // Mock webContents
    mockWebContents = {
      send: jest.fn(),
    };

    // Mock main window
    mockMainWindow = {
      isDestroyed: jest.fn().mockReturnValue(false),
      webContents: mockWebContents,
    };

    // Mock ipcMain.handle to store handlers
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      ipcHandlers.set(channel, handler);
    });

    // Mock autoUpdater.on to store handlers
    (autoUpdater.on as jest.Mock).mockImplementation((event, handler) => {
      autoUpdaterHandlers.set(event, handler);
      return autoUpdater;
    });

    // Create instance
    appUpdater = new AppUpdater();
  });

  describe('Constructor', () => {
    test('should initialize with correct configuration', () => {
      expect(autoUpdater.logger).toBeDefined();
      expect(autoUpdater.autoDownload).toBe(false);
      expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    });

    test('should set feed URL if not already set', () => {
      (autoUpdater.getFeedURL as jest.Mock).mockReturnValue(null);

      // Create instance to test constructor behavior
      const testInstance = new AppUpdater();
      expect(testInstance).toBeDefined();

      expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
        provider: 'github',
        owner: 'platinum-hill',
        repo: 'cobolt',
      });
    });

    test('should register all event handlers', () => {
      const expectedEvents = [
        'checking-for-update',
        'update-available',
        'update-not-available',
        'error',
        'download-progress',
        'update-downloaded',
      ];

      expectedEvents.forEach((event) => {
        expect(autoUpdaterHandlers.has(event)).toBe(true);
      });
    });

    test('should register all IPC handlers', () => {
      const expectedHandlers = [
        'install-update',
        'get-update-status',
        'check-for-updates-menu',
        'enable-auto-install',
        'download-and-install',
      ];

      expectedHandlers.forEach((handler) => {
        expect(ipcHandlers.has(handler)).toBe(true);
      });
    });
  });

  describe('setMainWindow', () => {
    test('should set the main window reference', () => {
      appUpdater.setMainWindow(mockMainWindow);

      // Trigger an event that would use the main window
      const handler = autoUpdaterHandlers.get('checking-for-update');
      handler?.();

      expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
        status: 'checking',
        info: undefined,
        error: undefined,
        progress: undefined,
      });
    });
  });

  describe('AutoUpdater Event Handlers', () => {
    beforeEach(() => {
      appUpdater.setMainWindow(mockMainWindow);
    });

    test('checking-for-update event', () => {
      const handler = autoUpdaterHandlers.get('checking-for-update');
      handler?.();

      expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
        status: 'checking',
        info: undefined,
        error: undefined,
        progress: undefined,
      });
    });

    test('update-available event', () => {
      const updateInfo = { version: '2.0.0', releaseNotes: 'New features' };
      const handler = autoUpdaterHandlers.get('update-available');
      handler?.(updateInfo);

      expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
        status: 'available',
        info: updateInfo,
        error: undefined,
        progress: undefined,
      });
    });

    test('update-not-available event', () => {
      const updateInfo = { version: '1.0.0' };
      const handler = autoUpdaterHandlers.get('update-not-available');
      handler?.(updateInfo);

      expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
        status: 'not-available',
        info: updateInfo,
        error: undefined,
        progress: undefined,
      });
    });

    test('error event', () => {
      const error = new Error('Update check failed');
      const handler = autoUpdaterHandlers.get('error');
      handler?.(error);

      expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
        status: 'error',
        info: null,
        error: 'Update check failed',
        progress: undefined,
      });
    });

    test('download-progress event', () => {
      const progressObj = {
        bytesPerSecond: 1000,
        percent: 50,
        transferred: 5000,
        total: 10000,
      };
      const handler = autoUpdaterHandlers.get('download-progress');
      handler?.(progressObj);

      expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
        status: 'downloading',
        info: undefined,
        error: undefined,
        progress: progressObj,
      });
    });

    test('update-downloaded event', () => {
      const updateInfo = { version: '2.0.0' };
      const handler = autoUpdaterHandlers.get('update-downloaded');
      handler?.(updateInfo);

      expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
        status: 'downloaded',
        info: updateInfo,
        error: undefined,
        progress: undefined,
      });
    });
  });

  describe('IPC Handlers', () => {
    beforeEach(() => {
      appUpdater.setMainWindow(mockMainWindow);
    });

    describe('install-update', () => {
      test('should quit and install update', async () => {
        const handler = ipcHandlers.get('install-update');
        const result = await handler?.();

        expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
        expect(result).toEqual({ success: true });
      });
    });

    describe('get-update-status', () => {
      test('should return current update status', async () => {
        // Trigger some events to set internal state
        autoUpdaterHandlers.get('update-available')?.({ version: '2.0.0' });

        const handler = ipcHandlers.get('get-update-status');
        const result = await handler?.();

        expect(result).toEqual({
          updateAvailable: true,
          updateInfo: { version: '2.0.0' },
          currentVersion: '1.0.0',
          isChecking: false,
          lastStatus: 'available',
          lastError: undefined,
          lastProgress: undefined,
        });
      });

      test('should handle errors gracefully', async () => {
        const handler = ipcHandlers.get('get-update-status');

        // Mock app.getVersion to throw
        (app.getVersion as jest.Mock).mockImplementationOnce(() => {
          throw new Error('Version error');
        });

        const result = await handler?.();

        expect(result).toEqual({
          updateAvailable: false,
          currentVersion: '1.0.0',
        });
      });
    });

    describe('check-for-updates-menu', () => {
      test('should return not-available for non-packaged app', async () => {
        // Use Object.defineProperty to make isPackaged writable
        Object.defineProperty(app, 'isPackaged', {
          writable: true,
          value: false,
        });

        const handler = ipcHandlers.get('check-for-updates-menu');
        const result = await handler?.();

        expect(result).toEqual({
          success: true,
          updateInfo: null,
          message: 'Updates only available in packaged app',
        });
        expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
          status: 'not-available',
          info: { version: '1.0.0' },
          error: undefined,
          progress: undefined,
        });
      });

      test('should check for updates in packaged app', async () => {
        Object.defineProperty(app, 'isPackaged', {
          writable: true,
          value: true,
        });
        const updateCheckResult = { updateInfo: { version: '2.0.0' } };
        (autoUpdater.checkForUpdates as jest.Mock).mockResolvedValue(
          updateCheckResult,
        );

        const handler = ipcHandlers.get('check-for-updates-menu');
        const result = await handler?.();

        expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
        expect(result).toEqual({
          success: true,
          updateInfo: { version: '2.0.0' },
        });
      });

      test('should handle check errors', async () => {
        Object.defineProperty(app, 'isPackaged', {
          writable: true,
          value: true,
        });
        const error = new Error('Check failed');
        (autoUpdater.checkForUpdates as jest.Mock).mockRejectedValue(error);

        const handler = ipcHandlers.get('check-for-updates-menu');
        const result = await handler?.();

        expect(result).toEqual({
          success: false,
          error: 'Check failed',
        });
        expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
          status: 'error',
          info: null,
          error: 'Check failed',
          progress: undefined,
        });
      });

      test('should wait for existing check to complete', async () => {
        Object.defineProperty(app, 'isPackaged', {
          writable: true,
          value: true,
        });

        // Set up delayed resolution
        let resolveCheck: Function;
        const checkPromise = new Promise((resolve) => {
          resolveCheck = () => resolve({ updateInfo: { version: '2.0.0' } });
        });
        (autoUpdater.checkForUpdates as jest.Mock).mockReturnValue(
          checkPromise,
        );

        const handler = ipcHandlers.get('check-for-updates-menu');

        // Start first check
        const firstCheck = handler?.();

        // Start second check while first is pending
        const secondCheck = handler?.();

        // Resolve the check
        resolveCheck!();

        const [firstResult, secondResult] = await Promise.all([
          firstCheck,
          secondCheck,
        ]);

        // Both should get the same result
        expect(firstResult).toEqual(secondResult);
        expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
      });
    });

    describe('enable-auto-install', () => {
      test('should enable auto install on quit', async () => {
        const handler = ipcHandlers.get('enable-auto-install');
        const result = await handler?.();

        expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
        expect(result).toEqual({ success: true });
      });
    });

    describe('download-and-install', () => {
      test('should return ready if already downloaded', async () => {
        // Set status to downloaded
        autoUpdaterHandlers.get('update-downloaded')?.({ version: '2.0.0' });

        const handler = ipcHandlers.get('download-and-install');
        const result = await handler?.();

        expect(result).toEqual({
          success: true,
          readyToInstall: true,
        });
        expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
      });

      test('should download update if available', async () => {
        // Set status to available
        autoUpdaterHandlers.get('update-available')?.({ version: '2.0.0' });
        (autoUpdater.downloadUpdate as jest.Mock).mockResolvedValue(undefined);

        const handler = ipcHandlers.get('download-and-install');
        const result = await handler?.();

        expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
        expect(result).toEqual({
          success: true,
          readyToInstall: true,
        });
      });

      test('should return error if no update available', async () => {
        const handler = ipcHandlers.get('download-and-install');
        const result = await handler?.();

        expect(result).toEqual({
          success: false,
          error: 'No update available to download',
        });
      });

      test('should handle download errors', async () => {
        autoUpdaterHandlers.get('update-available')?.({ version: '2.0.0' });
        const error = new Error('Download failed');
        (autoUpdater.downloadUpdate as jest.Mock).mockRejectedValue(error);

        const handler = ipcHandlers.get('download-and-install');
        const result = await handler?.();

        expect(result).toEqual({
          success: false,
          error: 'Download failed',
        });
      });
    });
  });

  describe('checkForUpdatesOnStartup', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      appUpdater.setMainWindow(mockMainWindow);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should skip check for non-packaged app', () => {
      Object.defineProperty(app, 'isPackaged', {
        writable: true,
        value: false,
      });

      appUpdater.checkForUpdatesOnStartup();
      jest.advanceTimersByTime(3000);

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    test('should check for updates after delay in packaged app', () => {
      Object.defineProperty(app, 'isPackaged', {
        writable: true,
        value: true,
      });

      appUpdater.checkForUpdatesOnStartup();

      // Should not send immediately
      expect(mockWebContents.send).not.toHaveBeenCalled();

      // Advance timer
      jest.advanceTimersByTime(3000);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'check-for-updates-menu',
      );
    });

    test('should handle destroyed window', () => {
      Object.defineProperty(app, 'isPackaged', {
        writable: true,
        value: true,
      });
      mockMainWindow.isDestroyed.mockReturnValue(true);

      appUpdater.checkForUpdatesOnStartup();
      jest.advanceTimersByTime(3000);

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    test('should handle null window', () => {
      Object.defineProperty(app, 'isPackaged', {
        writable: true,
        value: true,
      });
      appUpdater.setMainWindow(null as any);

      appUpdater.checkForUpdatesOnStartup();
      jest.advanceTimersByTime(3000);

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle sending status without main window', () => {
      // Don't set main window
      const handler = autoUpdaterHandlers.get('checking-for-update');

      expect(() => handler?.()).not.toThrow();
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    test('should handle destroyed window when sending status', () => {
      appUpdater.setMainWindow(mockMainWindow);
      mockMainWindow.isDestroyed.mockReturnValue(true);

      const handler = autoUpdaterHandlers.get('checking-for-update');
      handler?.();

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });
  });
});
