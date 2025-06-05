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
        mounted: mounted.current,
        userDismissed,
        currentUpdateVersion: updateStatus.info?.version
      });
      
      if (!mounted.current) return;
      
      // Clear any existing hide timeout
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      
      // Don't show notification if user dismissed and it's the same update
      if (userDismissed && data.status === 'available' && 
          updateStatus.info?.version === data.info?.version) {
        log.info('[UpdateNotification] Skipping notification - user dismissed this version');
        return;
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
        log.info('[UpdateNotification] check-for-updates-menu result:', result);
        
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
    window.electron.ipcRenderer.on('update-status', testHandler);
    log.info('[UpdateNotification] Adding check-for-updates-menu listener');
    window.electron.ipcRenderer.on('check-for-updates-menu', handleCheckForUpdatesMenu);

    return () => {
      mounted.current = false;
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      log.info('[UpdateNotification] Removing listeners');
      window.electron.ipcRenderer.removeListener('update-status', handleUpdateStatus);
      window.electron.ipcRenderer.removeListener('update-status', testHandler);
      window.electron.ipcRenderer.removeListener('check-for-updates-menu', handleCheckForUpdatesMenu);
    };
  }, []);

  const handleDownload = async () => {
    const result = await window.electron.ipcRenderer.invoke('download-update');
    if (!result.success) {
      setUpdateStatus({ status: 'error', error: result.error });
    }
  };

  const handleInstall = async () => {
    await window.electron.ipcRenderer.invoke('install-update');
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
            <button onClick={handleDownload} className="update-button">
              Download
            </button>
            <button onClick={handleDismiss} className="dismiss-button">
              Later
            </button>
          </div>
        );
      
      case 'not-available':
        return (
          <div className="update-content up-to-date">
            <span>✓ You're up to date! (v{currentVersion})</span>
          </div>
        );
      
      case 'downloading':
        return (
          <div className="update-content downloading">
            <span>Downloading update...</span>
            {updateStatus.progress && (
              <>
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${updateStatus.progress.percent}%` }}
                  />
                </div>
                <span className="progress-text">
                  {updateStatus.progress?.percent.toFixed(0)}%
                </span>
              </>
            )}
          </div>
        );
      
      case 'downloaded':
        return (
          <div className="update-content downloaded">
            <span>Update ready to install!</span>
            <button onClick={handleInstall} className="update-button">
              Restart & Install
            </button>
            <button onClick={handleDismiss} className="dismiss-button">
              Later
            </button>
          </div>
        );
      
      case 'error':
        return (
          <div className="update-content error">
            <span>Update check failed</span>
            {updateStatus.error && (
              <span className="error-detail">{updateStatus.error}</span>
            )}
            <button onClick={handleDismiss} className="dismiss-button">
              Dismiss
            </button>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <div className={`update-notification ${updateStatus.status}`}>
      {renderContent()}
    </div>
  );
}

export default UpdateNotification;