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

// Singleton instance tracking
let activeInstance = 0;

function UpdateNotification() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' });
  const [showNotification, setShowNotification] = useState(false);
  const [userDismissed, setUserDismissed] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const instanceId = useRef(++activeInstance);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    
    // Only the latest instance should be active
    if (instanceId.current !== activeInstance) {
      log.warn(`[UpdateNotification] Instance ${instanceId.current} is not active, skipping initialization`);
      return;
    }

    // Get current version
    window.electron.ipcRenderer.invoke('get-app-version').then((version) => {
      if (mounted.current) {
        setCurrentVersion(version);
      }
    });

    // Don't check initial status on mount to avoid race conditions
    log.info(`[UpdateNotification] Component mounted (instance ${instanceId.current})`);

    // Listen for update status changes
    const handleUpdateStatus = (_event: any, data: any) => {
      if (!mounted.current || instanceId.current !== activeInstance) return;
      
      log.info('[UpdateNotification] Update status event received:', data.status);
      
      if (data.status === 'available' && data.info) {
        // Check if this is actually a new version
        if (data.info.version !== currentVersion) {
          setUpdateStatus({ status: data.status, info: data.info });
          setShowNotification(true);
          setUserDismissed(false);
        } else {
          // Same version, no update needed
          setUpdateStatus({ status: 'not-available' });
          setShowNotification(true);
          setTimeout(() => {
            setShowNotification(false);
          }, 3000);
        }
      } else {
        setUpdateStatus({
          status: data.status,
          info: data.info,
          error: data.error,
          progress: data.progress
        });
        
        // Show notification for certain statuses
        if (['checking', 'downloading', 'downloaded', 'error', 'not-available'].includes(data.status)) {
          setShowNotification(true);
          
          // Auto-hide "not-available" after a delay
          if (data.status === 'not-available') {
            setTimeout(() => {
              if (mounted.current && updateStatus.status === 'not-available') {
                setShowNotification(false);
              }
            }, 3000);
          }
        }
      }
    };

    // Listen for menu-triggered update checks
    const handleCheckForUpdatesMenu = () => {
      if (!mounted.current || instanceId.current !== activeInstance) return;
      
      log.info('[UpdateNotification] Check for updates triggered from menu');
      setUserDismissed(false);
      setShowNotification(true);
      setUpdateStatus({ status: 'checking' });
      
      window.electron.ipcRenderer.invoke('check-for-updates').then((result) => {
        if (!mounted.current) return;
        
        log.info('[UpdateNotification] Check for updates result:', result);
        if (!result.success && result.error) {
          setUpdateStatus({ status: 'error', error: result.error });
        }
      });
    };

    // Use the existing IPC pattern
    window.electron.ipcRenderer.on('update-status', handleUpdateStatus);
    window.electron.ipcRenderer.on('check-for-updates-menu', handleCheckForUpdatesMenu);

    return () => {
      mounted.current = false;
      window.electron.ipcRenderer.removeListener('update-status', handleUpdateStatus);
      window.electron.ipcRenderer.removeListener('check-for-updates-menu', handleCheckForUpdatesMenu);
      
      // Clear active instance if this was the active one
      if (instanceId.current === activeInstance) {
        activeInstance = 0;
      }
    };
  }, [currentVersion]);

  const handleDownload = async () => {
    log.info('[UpdateNotification] Download clicked');
    const result = await window.electron.ipcRenderer.invoke('download-update');
    if (!result.success) {
      setUpdateStatus({ status: 'error', error: result.error });
    }
  };

  const handleInstall = async () => {
    log.info('[UpdateNotification] Install clicked');
    await window.electron.ipcRenderer.invoke('install-update');
  };

  const handleDismiss = () => {
    setShowNotification(false);
    setUserDismissed(true);
  };

  if (!showNotification || instanceId.current !== activeInstance) return null;

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