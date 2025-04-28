import path from 'path';
import { app, BrowserWindow, dialog } from 'electron';
import { execFile } from 'child_process';
import log from 'electron-log/main';
import appMetadata from '../cobolt-backend/data_models/app_metadata';

async function checkAndRunFirstTimeSetup(
  mainWindow: BrowserWindow | null,
): Promise<void> {
  // Define paths
  const isSetupComplete = appMetadata.getSetupComplete();
  const resourcesPath = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '../assets');

  // Check if setup has already been completed
  if (isSetupComplete) {
    log.info('First-time setup already completed.');
    return;
  }

  // Show a dialog to inform user about dependency installation
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Setting up Cobolt',
    message: 'Cobolt needs to install some dependencies for first-time setup.',
    detail:
      'This process may take a few minutes. You will be notified when it completes.',
    buttons: ['Continue', 'Skip'],
    defaultId: 0,
  });

  // If user chose to skip, just create the marker file and return
  if (response === 1) {
    log.info('Skipping setup...');
    appMetadata.setSetupComplete();
    return;
  }

  try {
    log.info('Running first-time setup...');

    // Notify renderer that setup is starting
    if (mainWindow) {
      mainWindow.webContents.send('setup-start');
    }

    // Run platform-specific setup script
    if (process.platform === 'win32') {
      const scriptPath = path.join(resourcesPath, 'scripts', 'win_deps.bat');
      log.info(`Running Windows setup script: ${scriptPath}`);

      // Send progress updates using a custom monitoring script
      const sendProgressUpdate = (message: string) => {
        if (mainWindow) {
          mainWindow.webContents.send('setup-progress', message);
        }
      };

      sendProgressUpdate('Installing Python and required dependencies...');

      execFile(scriptPath, (error) => {
        if (error) {
          log.error('Error running Windows setup script:', error);
          dialog.showErrorBox(
            'Setup Failed',
            'Failed to run dependency installation. Some features may not work correctly.',
          );
        } else {
          log.info('Windows setup script completed successfully');
          appMetadata.setSetupComplete();

          // Notify renderer that setup is complete
          if (mainWindow) {
            mainWindow.webContents.send('setup-complete');
          }

          dialog.showMessageBox({
            type: 'info',
            title: 'Setup Complete',
            message: 'Cobolt has been set up successfully!',
            buttons: ['OK'],
          });
        }
      });
    } else if (process.platform === 'darwin') {
      const scriptPath = path.join(resourcesPath, 'scripts', 'mac_deps.sh');
      log.info(`Running macOS setup script: ${scriptPath}`);

      // Send progress updates
      const sendProgressUpdate = (message: string) => {
        if (mainWindow) {
          mainWindow.webContents.send('setup-progress', message);
        }
      };

      sendProgressUpdate('Installing Homebrew and required dependencies...');

      execFile(scriptPath, (error) => {
        if (error) {
          log.error('Error running macOS setup script:', error);
          dialog.showErrorBox(
            'Setup Failed',
            'Failed to run dependency installation. Some features may not work correctly.',
          );
        } else {
          log.info('macOS setup script completed successfully');
          appMetadata.setSetupComplete();

          // Notify renderer that setup is complete
          if (mainWindow) {
            mainWindow.webContents.send('setup-complete');
          }

          dialog.showMessageBox({
            type: 'info',
            title: 'Setup Complete',
            message: 'Cobolt has been set up successfully!',
            buttons: ['OK'],
          });
        }
      });
    } else {
      // Linux or other platforms
      log.info('Skipping setup for unsupported platform');
      appMetadata.setSetupComplete();

      // Notify renderer that setup is complete (skipped)
      if (mainWindow) {
        mainWindow.webContents.send('setup-complete');
      }
    }
  } catch (error) {
    log.error('Error during setup:', error);

    // Notify renderer that setup is complete (failed)
    if (mainWindow) {
      mainWindow.webContents.send('setup-complete');
    }

    dialog.showErrorBox(
      'Setup Error',
      'An error occurred during setup. Some features may not work correctly.',
    );
  }
}

export default checkAndRunFirstTimeSetup;
