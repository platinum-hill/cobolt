import React, { useState, useEffect } from 'react';
import log from 'electron-log/renderer';
import './UpdateNotification.css';

interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: any;
  error?: string;
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
}

const UpdateNotification: React.FC = () => {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    log.info('[UpdateNotification] Component mounted');
    
    const handleUpdateStatus = (_event: any, data: UpdateStatus) => {
      log.info('[UpdateNotification] Update status received:', data);
      setUpdateStatus(data);
      setIsChecking(false);
    };

    // Check initial update status
    log.info('[UpdateNotification] Checking initial update status...');
    
    window.electron.ipcRenderer.invoke('get-update-status').then((status) => {
      log.info('[UpdateNotification] Initial status:', status);
      if (status.updateAvailable || status.updateDownloaded) {
        setUpdateStatus({
          status: status.updateDownloaded ? 'downloaded' : 'available',
          info: status.updateInfo
        });
      }
    }).catch((error) => {
      log.error('[UpdateNotification] Error getting initial status:', error);
    });

    // Add the existing update status listener
    window.electron.ipcRenderer.on('update-status', handleUpdateStatus);

    // Listen for menu-triggered update check
    const handleMenuUpdateCheck = async () => {
      log.info('[UpdateNotification] Check for updates triggered from menu');
      setIsChecking(true);
      setUpdateStatus({ status: 'checking' });
      try {
        const result = await window.electron.ipcRenderer.invoke('check-for-updates');
        log.info('[UpdateNotification] Check for updates result:', result);
        if (!result.success) {
          log.error('[UpdateNotification] Update check failed:', result.error);
          setUpdateStatus({ 
            status: 'error', 
            error: result.error || 'Failed to check for updates' 
          });
          setIsChecking(false);
        }
      } catch (error) {
        log.error('[UpdateNotification] Error checking for updates:', error);
        setUpdateStatus({ 
          status: 'error', 
          error: error instanceof Error ? error.message : 'Failed to check for updates' 
        });
        setIsChecking(false);
      }
    };
    
    window.electron.ipcRenderer.on('check-for-updates-menu', handleMenuUpdateCheck);

    return () => {
      log.info('[UpdateNotification] Component unmounting');
      window.electron.ipcRenderer.removeListener('update-status', handleUpdateStatus);
      window.electron.ipcRenderer.removeListener('check-for-updates-menu', handleMenuUpdateCheck);
    };
  }, []);

  const handleDownloadUpdate = async () => {
    log.info('[UpdateNotification] Download update clicked');
    try {
      await window.electron.ipcRenderer.invoke('download-update');
      log.info('[UpdateNotification] Download initiated');
    } catch (error) {
      log.error('[UpdateNotification] Download error:', error);
    }
  };

  const handleInstallUpdate = async () => {
    log.info('[UpdateNotification] Install update clicked');
    try {
      await window.electron.ipcRenderer.invoke('install-update');
      log.info('[UpdateNotification] Install initiated');
    } catch (error) {
      log.error('[UpdateNotification] Install error:', error);
    }
  };

  if (!updateStatus && !isChecking) return null;

  return (
    <div className="update-notification">
      {(updateStatus?.status === 'checking' || isChecking) && (
        <div className="update-banner">
          <div className="update-content">
            <span className="update-icon">🔍</span>
            <p>Checking for updates...</p>
          </div>
        </div>
      )}

      {updateStatus?.status === 'available' && (
        <div className="update-banner">
          <div className="update-content">
            <span className="update-icon">🔄</span>
            <p>Update available: v{updateStatus.info?.version}</p>
          </div>
          <button 
            onClick={handleDownloadUpdate}
            className="update-button"
          >
            Download Update
          </button>
        </div>
      )}

      {updateStatus?.status === 'downloading' && (
        <div className="update-banner">
          <div className="update-content">
            <span className="update-icon">⬇️</span>
            <p>Downloading update: {Math.round(updateStatus.progress?.percent || 0)}%</p>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${updateStatus.progress?.percent || 0}%` }}
            />
          </div>
        </div>
      )}

      {updateStatus?.status === 'downloaded' && (
        <div className="update-banner">
          <div className="update-content">
            <span className="update-icon">✅</span>
            <p>Update ready to install!</p>
          </div>
          <button 
            onClick={handleInstallUpdate}
            className="update-button"
          >
            Restart and Install
          </button>
        </div>
      )}

      {updateStatus?.status === 'error' && (
        <div className="update-banner error">
          <div className="update-content">
            <span className="update-icon">⚠️</span>
            <p>Update error: {updateStatus.error}</p>
          </div>
        </div>
      )}

      {updateStatus?.status === 'not-available' && (
        <div className="update-banner">
          <div className="update-content">
            <span className="update-icon">✓</span>
            <p>You're up to date!</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpdateNotification;