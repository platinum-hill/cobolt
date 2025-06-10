import React, { useEffect, useState, useRef } from 'react';
import log from 'electron-log/renderer';
import './UpdateNotification.css';

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'idle';
  info?: UpdateInfo;
  error?: string;
  progress?: {
    percent: number;
    transferred: number;
    total: number;
  };
}

function UpdateNotification() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' });
  const [showNotification, setShowNotification] = useState(false);
  const [userDismissed, setUserDismissed] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const mounted = useRef(true);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userDismissedRef = useRef(userDismissed);
  const updateStatusRef = useRef(updateStatus);

  useEffect(() => {
    userDismissedRef.current = userDismissed;
  }, [userDismissed]);

  useEffect(() => {
    updateStatusRef.current = updateStatus;
  }, [updateStatus]);

  useEffect(() => {
    mounted.current = true;
    
    // Add logging to confirm listener setup
    log.info('[UpdateNotification] Setting up event listeners');
    
    // Get current version
    window.electron.ipcRenderer.invoke('get-app-version').then((version) => {
      if (mounted.current) {
        setCurrentVersion(version);
      }
    });

    // On mount, get the current update status
    window.electron.ipcRenderer.invoke('get-update-status').then((status) => {
      if (!mounted.current) return;
      if (status && status.currentVersion) {
        setCurrentVersion(status.currentVersion);
      }
      if (status && status.isChecking) {
        setUpdateStatus({ status: 'checking' });
        setShowNotification(true);
      } else if (status && status.updateAvailable) {
        setUpdateStatus({ status: 'available', info: status.updateInfo });
        setShowNotification(true);
      } else if (status && status.lastStatus === 'downloaded') {
        setUpdateStatus({ status: 'downloaded', info: status.updateInfo });
        setShowNotification(true);
      } else if (status && status.lastStatus === 'downloading') {
        setUpdateStatus({ status: 'downloading', progress: status.lastProgress });
        setShowNotification(true);
      } else if (status && status.lastStatus === 'error') {
        setUpdateStatus({ status: 'error', error: status.lastError });
        setShowNotification(true);
      }
    });

    // Listen for update status changes
    const handleUpdateStatus = (_event: any, data: any) => {
      log.info(`[UpdateNotification] Received update status: ${data.status}`, {
        info: data.info ? { version: data.info.version } : undefined,
        error: data.error,
        progress: data.progress,
        mounted: mounted.current,
        currentUpdateVersion: updateStatus.info?.version,
        userDismissed: userDismissedRef.current
      });
      
      if (!mounted.current) return;
      
      // Clear any existing hide timeout
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      
      // For startup checks, always reset user dismissed for available updates
      // This ensures notifications show on app restart even if previously dismissed
      if (data.status === 'available') {
        const currentUpdateVersion = updateStatusRef.current.info?.version;
        const isNewVersion = currentUpdateVersion !== data.info?.version;
        
        // Reset dismissal for new versions OR for startup checks of same version
        if (isNewVersion || !userDismissedRef.current) {
          setUserDismissed(false);
        } else if (userDismissedRef.current && currentUpdateVersion === data.info?.version) {
          log.info('[UpdateNotification] Skipping notification - user dismissed this version');
          return;
        }
      }
      
      // Reset user dismissed flag for new updates
      if (data.status === 'available') {
        const currentUpdateVersion = updateStatusRef.current.info?.version;
        if (currentUpdateVersion !== data.info?.version) {
          setUserDismissed(false);
        }
      }
      
      setUpdateStatus({
        status: data.status,
        info: data.info,
        error: data.error,
        progress: data.progress
      });
      
      // Always show notification for important statuses
      if (data.status === 'available' || data.status === 'downloading' || 
          data.status === 'downloaded' || data.status === 'error') {
        log.info(`[UpdateNotification] Showing notification for status: ${data.status}`);
        setShowNotification(true);
      } else if (data.status !== 'idle') {
        setShowNotification(true);
        
        // Auto-hide "not-available" after 3 seconds
        if (data.status === 'not-available') {
          hideTimeoutRef.current = setTimeout(() => {
            if (mounted.current) {
              setShowNotification(false);
            }
          }, 3000);
        }
      }
    };

    // Listen for menu-triggered update checks
    const handleCheckForUpdatesMenu = async () => {
      if (!mounted.current) return;

      log.info('Received check-for-updates-menu event');
      setUserDismissed(false);

      // Clear any existing hide timeout
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }

      // Show checking status immediately
      setUpdateStatus({ status: 'checking' });
      setShowNotification(true);

      // Actually invoke the check-for-updates-menu handler
      try {
        const result = await window.electron.ipcRenderer.invoke('check-for-updates-menu');
        
        // Handle the result directly since IPC events aren't working
        if (result.success && result.updateInfo) {
          // Update available
          setUpdateStatus({ 
            status: 'available', 
            info: { 
              version: result.updateInfo.version,
              releaseNotes: result.updateInfo.releaseNotes,
              releaseDate: result.updateInfo.releaseDate
            }
          });
          setShowNotification(true);
          log.info(`[UpdateNotification] Showing notification for available update: ${result.updateInfo.version}`);
        } else if (result.success && !result.updateInfo) {
          // No update available
          setUpdateStatus({ status: 'not-available' });
          setShowNotification(true);
          // Auto-hide after 3 seconds
          hideTimeoutRef.current = setTimeout(() => {
            if (mounted.current) {
              setShowNotification(false);
            }
          }, 3000);
        } else {
          // Error
          setUpdateStatus({ status: 'error', error: result.error || 'Unknown error' });
          setShowNotification(true);
        }
      } catch (error) {
        log.error('Failed to check for updates:', error);
        setUpdateStatus({ status: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
        setShowNotification(true);
      }
    };

    // Test listener to verify IPC communication
    const testHandler = (data: any) => {
      log.info('[UpdateNotification] TEST: Received any update-status event:', data);
    };

    // Use the existing IPC pattern
    log.info('[UpdateNotification] Adding update-status listener');
    window.electron.ipcRenderer.on('update-status', handleUpdateStatus);
    log.info('[UpdateNotification] Adding check-for-updates-menu listener');
    window.electron.ipcRenderer.on('check-for-updates-menu', handleCheckForUpdatesMenu);

    return () => {
      mounted.current = false;
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      log.info('[UpdateNotification] Removing listeners');
      window.electron.ipcRenderer.removeListener('update-status', handleUpdateStatus);
      window.electron.ipcRenderer.removeListener('check-for-updates-menu', handleCheckForUpdatesMenu);
    };
  }, []); // Remove userDismissed from dependency array

  const handleDownload = async () => {
    try {
      log.info('[UpdateNotification] Download button clicked');
      
      // Show downloading state immediately
      setUpdateStatus(prev => ({ 
        ...prev, 
        status: 'downloading', 
        progress: { percent: 0, transferred: 0, total: 0 } 
      }));
      
      const result = await window.electron.ipcRenderer.invoke('download-update');
      log.info('[UpdateNotification] Download result:', result);
      
      if (!result.success) {
        log.error('[UpdateNotification] Download failed:', result.error);
        setUpdateStatus({ status: 'error', error: result.error });
      } else if (result.alreadyDownloaded) {
        log.info('[UpdateNotification] Update was already downloaded');
        // The sendStatusToWindow call should handle this via event
      }
    } catch (error) {
      log.error('[UpdateNotification] Download request failed:', error);
      setUpdateStatus({ status: 'error', error: error instanceof Error ? error.message : 'Download failed' });
    }
  };

  const handleDownloadAndInstall = async () => {
    try {
      log.info('[UpdateNotification] Download & Install button clicked');
      
      // Show downloading state
      setUpdateStatus(prev => ({ 
        ...prev, 
        status: 'downloading',
        progress: { percent: 0, transferred: 0, total: 0 }
      }));
      
      const result = await window.electron.ipcRenderer.invoke('download-and-install');
      
      if (!result.success) {
        log.error('[UpdateNotification] Download & Install failed:', result.error);
        setUpdateStatus({ status: 'error', error: result.error });
      } else if (result.readyToInstall) {
        // Downloaded successfully, show install options
        setUpdateStatus({ 
          status: 'downloaded', 
          info: updateStatus.info 
        });
      }
    } catch (error) {
      log.error('[UpdateNotification] Download & Install request failed:', error);
      setUpdateStatus({ status: 'error', error: error instanceof Error ? error.message : 'Download failed' });
    }
  };

  const handleInstall = async () => {
    await window.electron.ipcRenderer.invoke('install-update');
  };

  const handleInstallLater = async () => {
    try {
      // Enable auto-install on next quit
      await window.electron.ipcRenderer.invoke('enable-auto-install');
      log.info('[UpdateNotification] Auto-install enabled for next restart');
    } catch (error) {
      log.error('[UpdateNotification] Failed to enable auto-install:', error);
    }
    
    // Always hide the notification regardless of the invoke result
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
              <button onClick={handleDownloadAndInstall} className="update-button primary">
                Download & Install
              </button>
              <button onClick={handleDismiss} className="dismiss-button">
                Later
              </button>
            </div>
          </div>
        );
      
      case 'not-available':
        return (
          <div className="update-content up-to-date">
            <span>You're up to date!</span>
          </div>
        );
      
      case 'downloading':
        return (
          <div className="update-content downloading">
            <div className="spinner" />
            <span>Downloading update...</span>
          </div>
        );
      
      case 'downloaded':
        return (
          <div className="update-content downloaded">
            <span>Update ready to install! v{updateStatus.info?.version}</span>
            <div className="update-actions">
              <button onClick={handleInstall} className="update-button primary">
                Restart & Install Now
              </button>
              <button onClick={handleInstallLater} className="update-button secondary">
                Install on Next Restart
              </button>
              <button onClick={handleDismiss} className="dismiss-button">
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
            <button onClick={handleDismiss} className="dismiss-button">
              Dismiss
            </button>
          </div>
        );
      
      default:
        return (
          <div className="update-content">
            <span>Unknown update status: {updateStatus.status}</span>
          </div>
        );
    }
  };

  return (
    <div className={`update-notification ${updateStatus.status === 'not-available' ? 'not-available' : ''}`}>
      {renderContent()}
    </div>
  );
}

export default UpdateNotification;