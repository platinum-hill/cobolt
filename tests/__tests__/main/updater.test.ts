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

  // Helper to setup handlers
  const setupHandlers = () => {
    ipcHandlers.clear();
    autoUpdaterHandlers.clear();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      ipcHandlers.set(channel, handler);
    });

    (autoUpdater.on as jest.Mock).mockImplementation((event, handler) => {
      autoUpdaterHandlers.set(event, handler);
      return autoUpdater;
    });
  };

  // Helper to setup mock window
  const setupMockWindow = (isDestroyed = false) => {
    mockWebContents = {
      send: jest.fn(),
    };

    mockMainWindow = {
      isDestroyed: jest.fn().mockReturnValue(isDestroyed),
      webContents: mockWebContents,
    };

    appUpdater.setMainWindow(mockMainWindow);
  };

  // Helper to trigger autoUpdater events
  const triggerAutoUpdaterEvent = (event: string, data?: any) => {
    const handler = autoUpdaterHandlers.get(event);
    return handler?.(data);
  };

  // Helper to call IPC handlers
  const callIpcHandler = async (channel: string, ...args: any[]) => {
    const handler = ipcHandlers.get(channel);
    return handler?.(...args);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ipcHandlers = new Map();
    autoUpdaterHandlers = new Map();
    setupHandlers();
    appUpdater = new AppUpdater();
    setupMockWindow();
  });

  describe('Constructor', () => {
    test('should initialize with correct configuration', () => {
      expect(autoUpdater.logger).toBeDefined();
      expect(autoUpdater.autoDownload).toBe(false);
      expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    });

    test('should set feed URL if not already set', () => {
      (autoUpdater.getFeedURL as jest.Mock).mockReturnValue(null);

      // Create new instance to test constructor behavior
      setupHandlers();
      const testInstance = new AppUpdater();
      expect(testInstance).toBeDefined();

      expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
        provider: 'github',
        owner: 'platinum-hill',
        repo: 'cobolt',
      });
    });

    test('should not set feed URL if already configured', () => {
      // Clear previous calls first
      jest.clearAllMocks();
      (autoUpdater.getFeedURL as jest.Mock).mockReturnValue('existing-url');

      setupHandlers();
      const testInstance = new AppUpdater();
      expect(testInstance).toBeDefined();

      // Should not call setFeedURL if already set
      expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
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
      const newWindow = {
        test: 'window',
        isDestroyed: jest.fn().mockReturnValue(false),
        webContents: {
          send: jest.fn(),
        },
      };
      appUpdater.setMainWindow(newWindow as any);

      // Trigger an event to verify window is set
      triggerAutoUpdaterEvent('checking-for-update');

      // The new window should receive the event
      expect(newWindow.webContents.send).toHaveBeenCalledWith('update-status', {
        status: 'checking',
        info: undefined,
        error: undefined,
        progress: undefined,
      });
      // Old window should not receive
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });
  });

  describe('AutoUpdater Event Handlers', () => {
    const testCases = [
      {
        event: 'checking-for-update',
        expectedStatus: 'checking',
        data: undefined,
      },
      {
        event: 'update-available',
        expectedStatus: 'available',
        data: { version: '2.0.0', releaseNotes: 'New features' },
      },
      {
        event: 'update-not-available',
        expectedStatus: 'not-available',
        data: { version: '1.0.0' },
      },
      {
        event: 'update-downloaded',
        expectedStatus: 'downloaded',
        data: { version: '2.0.0' },
      },
    ];

    testCases.forEach(({ event, expectedStatus, data }) => {
      test(`should handle ${event} event`, () => {
        triggerAutoUpdaterEvent(event, data);

        expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
          status: expectedStatus,
          info: data,
          error: undefined,
          progress: undefined,
        });
      });
    });

    test('should handle error event', () => {
      const error = new Error('Update check failed');
      triggerAutoUpdaterEvent('error', error);

      expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
        status: 'error',
        info: null,
        error: 'Update check failed',
        progress: undefined,
      });
    });

    test('should handle download-progress event', () => {
      const progressObj = {
        bytesPerSecond: 1000,
        percent: 50,
        transferred: 5000,
        total: 10000,
      };
      triggerAutoUpdaterEvent('download-progress', progressObj);

      expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
        status: 'downloading',
        info: undefined,
        error: undefined,
        progress: progressObj,
      });
    });

    test('should not send status when window is destroyed', () => {
      setupMockWindow(true); // isDestroyed = true
      triggerAutoUpdaterEvent('checking-for-update');
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    test('should not send status when no window is set', () => {
      appUpdater.setMainWindow(null as any);
      triggerAutoUpdaterEvent('checking-for-update');
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });
  });

  describe('IPC Handlers', () => {
    describe('install-update', () => {
      test('should quit and install update', async () => {
        const result = await callIpcHandler('install-update');

        expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
        expect(result).toEqual({ success: true });
      });
    });

    describe('get-update-status', () => {
      test('should return initial status', async () => {
        const result = await callIpcHandler('get-update-status');

        expect(result).toEqual({
          updateAvailable: false,
          updateInfo: null,
          currentVersion: '1.0.0',
          isChecking: false,
          lastStatus: 'idle',
          lastError: undefined,
          lastProgress: undefined,
        });
      });

      test('should return status after update available', async () => {
        const updateInfo = { version: '2.0.0' };
        triggerAutoUpdaterEvent('update-available', updateInfo);

        const result = await callIpcHandler('get-update-status');

        expect(result).toEqual({
          updateAvailable: true,
          updateInfo,
          currentVersion: '1.0.0',
          isChecking: false,
          lastStatus: 'available',
          lastError: undefined,
          lastProgress: undefined,
        });
      });

      test('should return status after error', async () => {
        triggerAutoUpdaterEvent('error', new Error('Test error'));

        const result = await callIpcHandler('get-update-status');

        expect(result).toEqual({
          updateAvailable: false,
          updateInfo: null,
          currentVersion: '1.0.0',
          isChecking: false,
          lastStatus: 'error',
          lastError: 'Test error',
          lastProgress: undefined,
        });
      });

      test('should handle errors gracefully', async () => {
        (app.getVersion as jest.Mock).mockImplementationOnce(() => {
          throw new Error('Version error');
        });

        const result = await callIpcHandler('get-update-status');

        expect(result).toEqual({
          updateAvailable: false,
          currentVersion: '1.0.0',
        });
      });
    });

    describe('check-for-updates-menu', () => {
      beforeEach(() => {
        // Reset app.isPackaged for each test
        Object.defineProperty(app, 'isPackaged', {
          writable: true,
          configurable: true,
          value: false,
        });
      });

      test('should return not-available for non-packaged app', async () => {
        const result = await callIpcHandler('check-for-updates-menu');

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

      test('should check for updates in packaged app - update available', async () => {
        Object.defineProperty(app, 'isPackaged', { value: true });
        const updateCheckResult = { updateInfo: { version: '2.0.0' } };
        (autoUpdater.checkForUpdates as jest.Mock).mockResolvedValue(
          updateCheckResult,
        );

        // Simulate the update-available event being triggered
        const checkPromise = callIpcHandler('check-for-updates-menu');
        triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });
        const result = await checkPromise;

        expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
        expect(result).toEqual({
          success: true,
          updateInfo: { version: '2.0.0' },
        });
      });

      test('should check for updates in packaged app - no update available', async () => {
        Object.defineProperty(app, 'isPackaged', { value: true });
        const updateCheckResult = { updateInfo: null };
        (autoUpdater.checkForUpdates as jest.Mock).mockResolvedValue(
          updateCheckResult,
        );

        // Simulate the update-not-available event being triggered
        const checkPromise = callIpcHandler('check-for-updates-menu');
        triggerAutoUpdaterEvent('update-not-available', { version: '1.0.0' });
        const result = await checkPromise;

        expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
        expect(result).toEqual({
          success: true,
          updateInfo: null,
        });
      });

      test('should handle check errors', async () => {
        Object.defineProperty(app, 'isPackaged', { value: true });
        const error = new Error('Check failed');
        (autoUpdater.checkForUpdates as jest.Mock).mockRejectedValue(error);

        const result = await callIpcHandler('check-for-updates-menu');

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
        Object.defineProperty(app, 'isPackaged', { value: true });

        let resolveCheck: Function;
        const checkPromise = new Promise((resolve) => {
          resolveCheck = () => resolve({ updateInfo: { version: '2.0.0' } });
        });
        (autoUpdater.checkForUpdates as jest.Mock).mockReturnValue(
          checkPromise,
        );

        // Start first check
        const firstCheck = callIpcHandler('check-for-updates-menu');

        // Start second check while first is pending
        const secondCheck = callIpcHandler('check-for-updates-menu');

        // Simulate update available event
        setTimeout(() => {
          triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });
          resolveCheck!();
        }, 10);

        const [firstResult, secondResult] = await Promise.all([
          firstCheck,
          secondCheck,
        ]);

        // Both should get the same result
        expect(firstResult).toEqual(secondResult);
        expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
      });

      test('should handle non-Error objects in catch blocks', async () => {
        Object.defineProperty(app, 'isPackaged', { value: true });
        (autoUpdater.checkForUpdates as jest.Mock).mockRejectedValue(
          'String error',
        );

        const result = await callIpcHandler('check-for-updates-menu');

        expect(result).toEqual({
          success: false,
          error: 'Unknown error',
        });
      });
    });

    describe('enable-auto-install', () => {
      test('should enable auto install on quit', async () => {
        const result = await callIpcHandler('enable-auto-install');

        expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
        expect(result).toEqual({ success: true });
      });
    });

    describe('download-and-install', () => {
      test('should return ready if already downloaded', async () => {
        triggerAutoUpdaterEvent('update-downloaded', { version: '2.0.0' });

        const result = await callIpcHandler('download-and-install');

        expect(result).toEqual({
          success: true,
          readyToInstall: true,
        });
        expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
      });

      test('should download update if available', async () => {
        triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });
        (autoUpdater.downloadUpdate as jest.Mock).mockResolvedValue(undefined);

        const result = await callIpcHandler('download-and-install');

        expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
        expect(result).toEqual({
          success: true,
          readyToInstall: true,
        });
      });

      test('should return error if no update available', async () => {
        const result = await callIpcHandler('download-and-install');

        expect(result).toEqual({
          success: false,
          error: 'No update available to download',
        });
      });

      test('should handle download errors', async () => {
        triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });
        const error = new Error('Download failed');
        (autoUpdater.downloadUpdate as jest.Mock).mockRejectedValue(error);

        const result = await callIpcHandler('download-and-install');

        expect(result).toEqual({
          success: false,
          error: 'Download failed',
        });
      });

      test('should handle non-Error objects in download failures', async () => {
        triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });
        (autoUpdater.downloadUpdate as jest.Mock).mockRejectedValue(
          'String error',
        );

        const result = await callIpcHandler('download-and-install');

        expect(result).toEqual({
          success: false,
          error: 'Unknown error',
        });
      });

      test('should send initial downloading status', async () => {
        triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });
        (autoUpdater.downloadUpdate as jest.Mock).mockResolvedValue(undefined);

        await callIpcHandler('download-and-install');

        expect(mockWebContents.send).toHaveBeenCalledWith('update-status', {
          status: 'downloading',
          info: { version: '2.0.0' },
          error: undefined,
          progress: {
            percent: 0,
            transferred: 0,
            total: 0,
          },
        });
      });
    });
  });

  describe('checkForUpdatesOnStartup', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should skip check for non-packaged app', () => {
      Object.defineProperty(app, 'isPackaged', { value: false });

      appUpdater.checkForUpdatesOnStartup();
      jest.advanceTimersByTime(3000);

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    test('should check for updates after delay in packaged app', () => {
      Object.defineProperty(app, 'isPackaged', { value: true });

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
      Object.defineProperty(app, 'isPackaged', { value: true });
      setupMockWindow(true); // isDestroyed = true

      appUpdater.checkForUpdatesOnStartup();
      jest.advanceTimersByTime(3000);

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    test('should handle null window', () => {
      Object.defineProperty(app, 'isPackaged', { value: true });
      appUpdater.setMainWindow(null as any);

      appUpdater.checkForUpdatesOnStartup();
      jest.advanceTimersByTime(3000);

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    test('should clear previous state before startup check', () => {
      Object.defineProperty(app, 'isPackaged', { value: true });

      // Set some previous state
      triggerAutoUpdaterEvent('error', new Error('Previous error'));

      appUpdater.checkForUpdatesOnStartup();
      jest.advanceTimersByTime(3000);

      // Should have sent the check command regardless of previous state
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'check-for-updates-menu',
      );
    });
  });

  describe('Status Tracking and State Management', () => {
    test('should track status changes correctly', () => {
      // Initial state
      triggerAutoUpdaterEvent('checking-for-update');
      expect(mockWebContents.send).toHaveBeenLastCalledWith(
        'update-status',
        expect.objectContaining({ status: 'checking' }),
      );

      // Update available
      triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });
      expect(mockWebContents.send).toHaveBeenLastCalledWith(
        'update-status',
        expect.objectContaining({ status: 'available' }),
      );

      // Download progress
      const progress = { percent: 50, transferred: 1000, total: 2000 };
      triggerAutoUpdaterEvent('download-progress', progress);
      expect(mockWebContents.send).toHaveBeenLastCalledWith(
        'update-status',
        expect.objectContaining({ status: 'downloading', progress }),
      );

      // Download complete
      triggerAutoUpdaterEvent('update-downloaded', { version: '2.0.0' });
      expect(mockWebContents.send).toHaveBeenLastCalledWith(
        'update-status',
        expect.objectContaining({ status: 'downloaded' }),
      );
    });

    test('should maintain state between IPC calls', async () => {
      // Set some state
      triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });

      // Check that state is maintained
      const result = await callIpcHandler('get-update-status');
      expect(result.updateAvailable).toBe(true);
      expect(result.updateInfo).toEqual({ version: '2.0.0' });
      expect(result.lastStatus).toBe('available');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle multiple rapid status updates', () => {
      triggerAutoUpdaterEvent('checking-for-update');
      triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });
      triggerAutoUpdaterEvent('download-progress', { percent: 10 });
      triggerAutoUpdaterEvent('download-progress', { percent: 50 });
      triggerAutoUpdaterEvent('update-downloaded', { version: '2.0.0' });

      expect(mockWebContents.send).toHaveBeenCalledTimes(5);
      expect(mockWebContents.send).toHaveBeenLastCalledWith(
        'update-status',
        expect.objectContaining({ status: 'downloaded' }),
      );
    });

    test('should handle events without main window gracefully', () => {
      appUpdater.setMainWindow(null as any);

      expect(() => {
        triggerAutoUpdaterEvent('checking-for-update');
        triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });
        triggerAutoUpdaterEvent('error', new Error('Test error'));
      }).not.toThrow();
    });

    test('should reset checking state on error', async () => {
      Object.defineProperty(app, 'isPackaged', { value: true });
      (autoUpdater.checkForUpdates as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      await callIpcHandler('check-for-updates-menu');

      // Should be able to start another check after error
      const secondResult = await callIpcHandler('check-for-updates-menu');
      expect(secondResult.success).toBe(false);
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    });

    test('should handle concurrent download requests', async () => {
      triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });
      (autoUpdater.downloadUpdate as jest.Mock).mockResolvedValue(undefined);

      // Start multiple downloads simultaneously
      const downloads = [
        callIpcHandler('download-and-install'),
        callIpcHandler('download-and-install'),
        callIpcHandler('download-and-install'),
      ];

      const results = await Promise.all(downloads);

      // At least one should succeed
      const successfulResults = results.filter((result) => result.success);
      expect(successfulResults.length).toBeGreaterThan(0);

      // Check that successful results have readyToInstall
      successfulResults.forEach((result) => {
        expect(result.readyToInstall).toBe(true);
      });

      // downloadUpdate should be called at least once
      expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
    });
  });

  describe('Additional Edge Cases', () => {
    test('should handle window destruction during event', () => {
      // Set up window, then destroy it
      setupMockWindow(false);
      mockMainWindow.isDestroyed.mockReturnValue(true);

      // Should not throw when sending status
      expect(() => {
        triggerAutoUpdaterEvent('checking-for-update');
      }).not.toThrow();

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    test('should handle download when status changes between calls', async () => {
      // Start with available status
      triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });

      // Change status to not-available before download completes
      (autoUpdater.downloadUpdate as jest.Mock).mockImplementation(async () => {
        triggerAutoUpdaterEvent('update-not-available');
        throw new Error('Download cancelled');
      });

      const result = await callIpcHandler('download-and-install');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Download cancelled');
    });

    test('should maintain state consistency after error recovery', async () => {
      // Trigger error state
      triggerAutoUpdaterEvent('error', new Error('Network error'));

      // Verify error state
      let status = await callIpcHandler('get-update-status');
      expect(status.lastStatus).toBe('error');
      expect(status.lastError).toBe('Network error');

      // Recovery with successful check
      triggerAutoUpdaterEvent('update-available', { version: '2.0.0' });

      // Verify recovery
      status = await callIpcHandler('get-update-status');
      expect(status.lastStatus).toBe('available');
      expect(status.lastError).toBeUndefined();
      expect(status.updateAvailable).toBe(true);
    });

    test('should handle multiple status updates in rapid succession', () => {
      const statusUpdates = [
        { event: 'checking-for-update', data: undefined },
        { event: 'update-available', data: { version: '2.0.0' } },
        { event: 'download-progress', data: { percent: 50 } },
        { event: 'update-downloaded', data: { version: '2.0.0' } },
      ];

      // Rapid fire all status updates
      statusUpdates.forEach(({ event, data }) => {
        triggerAutoUpdaterEvent(event, data);
      });

      // Should have sent all updates
      expect(mockWebContents.send).toHaveBeenCalledTimes(statusUpdates.length);

      // Last call should be the downloaded status
      expect(mockWebContents.send).toHaveBeenLastCalledWith(
        'update-status',
        expect.objectContaining({ status: 'downloaded' }),
      );
    });

    test('should handle app.getVersion throwing error in status check', async () => {
      (app.getVersion as jest.Mock)
        .mockImplementationOnce(() => {
          throw new Error('Version unavailable');
        })
        .mockReturnValue('1.0.0'); // Return normal value for the catch block

      const result = await callIpcHandler('get-update-status');

      expect(result).toEqual({
        updateAvailable: false,
        currentVersion: '1.0.0', // Fallback in catch block
      });
    });
  });
});
