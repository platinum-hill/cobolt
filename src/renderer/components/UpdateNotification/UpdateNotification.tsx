import React, { useEffect, useState, useRef } from 'react';
import log from 'electron-log/renderer';
import './UpdateNotification.css';

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

interface UpdateStatus {
  status:
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'idle';
  info?: UpdateInfo;
  error?: string;
  progress?: {
    percent: number;
    transferred: number;
    total: number;
  };
}

function UpdateNotification() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    status: 'idle',
  });
  const [showNotification, setShowNotification] = useState(false);
  const [userDismissed, setUserDismissed] = useState(false);

  // Single ref for component mounted state
  const mounted = useRef(true);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userDismissedRef = useRef(userDismissed);
  const updateStatusRef = useRef(updateStatus);

  // Keep refs in sync
  useEffect(() => {
    userDismissedRef.current = userDismissed;
  }, [userDismissed]);

  useEffect(() => {
    updateStatusRef.current = updateStatus;
  }, [updateStatus]);

  useEffect(() => {
    mounted.current = true;

    // Initialize component state
    const initializeUpdateStatus = async () => {
      try {
        // Get current version once
        const version =
          await window.electron.ipcRenderer.invoke('get-app-version');
        if (mounted.current) {
          log.info(`[UpdateNotification] Current version: ${version}`);
        }

        // Get current update status
        const status =
          await window.electron.ipcRenderer.invoke('get-update-status');
        if (!mounted.current) return;

        // Handle different status scenarios
        if (status) {
          if (status.isChecking) {
            setUpdateStatus({ status: 'checking' });
            setShowNotification(true);
          } else if (status.updateAvailable) {
            setUpdateStatus({ status: 'available', info: status.updateInfo });
            setShowNotification(true);
          } else if (status.lastStatus === 'downloaded') {
            setUpdateStatus({ status: 'downloaded', info: status.updateInfo });
            setShowNotification(true);
          } else if (status.lastStatus === 'downloading') {
            setUpdateStatus({
              status: 'downloading',
              progress: status.lastProgress,
            });
            setShowNotification(true);
          } else if (status.lastStatus === 'error') {
            setUpdateStatus({ status: 'error', error: status.lastError });
            setShowNotification(true);
          }
        }
      } catch (error) {
        log.error('[UpdateNotification] Failed to initialize:', error);
      }
    };

    // Clear any existing hide timeout
    const clearHideTimeout = () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };

    // Handle update status changes from main process
    const handleUpdateStatus = (_event: any, data: any) => {
      if (!mounted.current) return;

      log.info(`[UpdateNotification] Received update status: ${data.status}`, {
        info: data.info,
        error: data.error,
        progress: data.progress,
        currentStatus: updateStatusRef.current.status,
        currentVersion: updateStatusRef.current.info?.version,
      });
      clearHideTimeout();

      // Handle user dismissal for available updates
      if (data.status === 'available' && userDismissedRef.current) {
        const isSameVersion =
          updateStatusRef.current.info?.version === data.info?.version;
        if (isSameVersion) {
          return;
        }
      }

      setUpdateStatus({
        status: data.status,
        info: data.info,
        error: data.error,
        progress: data.progress,
      });

      // Show notification for important statuses
      const importantStatuses = [
        'available',
        'downloading',
        'downloaded',
        'error',
      ];
      if (importantStatuses.includes(data.status)) {
        setShowNotification(true);
        setUserDismissed(false);
      } else if (data.status === 'not-available') {
        setShowNotification(true);
        // Auto-hide "not-available" after 3 seconds
        hideTimeoutRef.current = setTimeout(() => {
          if (mounted.current) {
            setShowNotification(false);
          }
        }, 3000);
      }
    };

    // Handle menu-triggered update checks
    const handleCheckForUpdatesMenu = async () => {
      if (!mounted.current) return;

      log.info('[UpdateNotification] Menu-triggered update check', {
        currentStatus: updateStatusRef.current.status,
        currentVersion: updateStatusRef.current.info?.version,
      });
      setUserDismissed(false);
      clearHideTimeout();

      // Show checking status immediately
      setUpdateStatus({ status: 'checking' });
      setShowNotification(true);

      try {
        const result = await window.electron.ipcRenderer.invoke(
          'check-for-updates-menu',
        );
        if (!mounted.current) return;

        if (result.success) {
          if (result.updateInfo) {
            // Update available
            log.info(
              `[UpdateNotification] Update available: v${result.updateInfo.version}`,
            );
            setUpdateStatus({
              status: 'available',
              info: {
                version: result.updateInfo.version,
                releaseNotes: result.updateInfo.releaseNotes,
                releaseDate: result.updateInfo.releaseDate,
              },
            });
          } else {
            // No update available
            setUpdateStatus({ status: 'not-available' });
            hideTimeoutRef.current = setTimeout(() => {
              if (mounted.current) {
                setShowNotification(false);
              }
            }, 3000);
          }
        } else {
          // Error occurred
          log.error('[UpdateNotification] Update check error:', result.error);
          setUpdateStatus({
            status: 'error',
            error: result.error || 'Failed to check for updates',
          });
        }
      } catch (error) {
        log.error('[UpdateNotification] Update check failed:', error);
        setUpdateStatus({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    // Initialize and set up event listeners
    initializeUpdateStatus();
    window.electron.ipcRenderer.on('update-status', handleUpdateStatus);
    window.electron.ipcRenderer.on(
      'check-for-updates-menu',
      handleCheckForUpdatesMenu,
    );

    // Cleanup function
    return () => {
      mounted.current = false;
      clearHideTimeout();
      window.electron.ipcRenderer.removeListener(
        'update-status',
        handleUpdateStatus,
      );
      window.electron.ipcRenderer.removeListener(
        'check-for-updates-menu',
        handleCheckForUpdatesMenu,
      );
    };
  }, []);

  const handleDownloadAndInstall = async () => {
    try {
      log.info('[UpdateNotification] Starting download');

      setUpdateStatus((prev) => ({
        ...prev,
        status: 'downloading',
        progress: { percent: 0, transferred: 0, total: 0 },
      }));

      const result = await window.electron.ipcRenderer.invoke(
        'download-and-install',
      );

      if (result.success && result.readyToInstall) {
        setUpdateStatus((prev) => ({
          ...prev,
          status: 'downloaded',
        }));
      } else {
        throw new Error(result.error || 'Download failed');
      }
    } catch (error) {
      log.error('[UpdateNotification] Download failed:', error);
      setUpdateStatus({
        status: 'error',
        error: error instanceof Error ? error.message : 'Download failed',
      });
    }
  };

  const handleInstall = async () => {
    log.info('[UpdateNotification] Installing update');
    await window.electron.ipcRenderer.invoke('install-update');
  };

  const handleInstallLater = async () => {
    try {
      await window.electron.ipcRenderer.invoke('enable-auto-install');
      log.info('[UpdateNotification] Auto-install enabled');
    } catch (error) {
      log.error('[UpdateNotification] Failed to enable auto-install:', error);
    }
    setShowNotification(false);
    setUserDismissed(true);
  };

  const handleDismiss = () => {
    setShowNotification(false);
    setUserDismissed(true);
  };

  if (!showNotification) return null;

  const renderContent = () => {
    switch (updateStatus.status) {
      case 'checking':
        return (
          <div className="update-content checking">
            <div className="spinner" />
            <span>Checking for updates...</span>
          </div>
        );

      case 'available':
        return (
          <div className="update-content available">
            <span>Update available: v{updateStatus.info?.version}</span>
            <div className="update-actions">
              <button
                type="button"
                onClick={handleDownloadAndInstall}
                className="update-button primary"
              >
                Download & Install
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="dismiss-button"
              >
                Later
              </button>
            </div>
          </div>
        );

      case 'not-available':
        return (
          <div className="update-content up-to-date">
            <span>You&apos;re up to date!</span>
          </div>
        );

      case 'downloading':
        return (
          <div className="update-content downloading">
            <div className="spinner" />
            <span>Downloading update...</span>
            {updateStatus.progress && updateStatus.progress.percent > 0 && (
              <div className="progress-info">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${updateStatus.progress.percent}%` }}
                  />
                </div>
                <span className="progress-text">
                  {updateStatus.progress.percent.toFixed(0)}%
                </span>
              </div>
            )}
          </div>
        );

      case 'downloaded':
        return (
          <div className="update-content downloaded">
            <span>Update ready to install! v{updateStatus.info?.version}</span>
            <div className="update-actions">
              <button
                type="button"
                onClick={handleInstall}
                className="update-button primary"
              >
                Restart & Install Now
              </button>
              <button
                type="button"
                onClick={handleInstallLater}
                className="update-button secondary"
              >
                Install on Next Restart
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="dismiss-button"
              >
                Later
              </button>
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="update-content error">
            <span>Update failed</span>
            {updateStatus.error && (
              <span className="error-detail">{updateStatus.error}</span>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              className="dismiss-button"
            >
              Dismiss
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className={`update-notification ${updateStatus.status === 'not-available' ? 'not-available' : ''}`}
    >
      {renderContent()}
    </div>
  );
}

export default UpdateNotification;
