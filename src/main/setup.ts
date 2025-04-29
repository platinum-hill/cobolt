import path from 'path';
import { app, BrowserWindow, dialog } from 'electron';
import { execFile } from 'child_process';
import log from 'electron-log/main';
import appMetadata from '../cobolt-backend/data_models/app_metadata';

// Get platform specific information required for initial setup
function getPlatformInfo() {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../assets');

  const scriptName = isWindows ? 'win_deps.bat' : 'mac_deps.sh';

  return {
    supported: isWindows || isMac,
    name: isWindows ? 'Windows' : 'macOS',
    scriptPath: path.join(resourcesPath, 'scripts', scriptName),
  };
}

// UI updates
function notifyRenderer(
  mainWindow: BrowserWindow | null,
  event: string,
  message: string,
) {
  if (mainWindow) {
    mainWindow.webContents.send(`${event}`, message);
  }
}

function runSetupScript(
  mainWindow: BrowserWindow | null,
  platform: ReturnType<typeof getPlatformInfo>,
): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(platform.scriptPath, [], { shell: true }, (error) => {
      if (error) {
        log.error(`Error running ${platform.name} setup script:`, error);
        resolve(false);
      } else {
        log.info(`${platform.name} setup script completed successfully`);
        appMetadata.setSetupComplete();
        notifyRenderer(mainWindow, 'complete', 'Setup complete');

        dialog.showMessageBox({
          type: 'info',
          title: 'Setup Complete',
          message: 'Cobolt has been set up successfully!',
          buttons: ['OK'],
        });
        resolve(true);
      }
    });
  });
}

// TODO: Use electron renderer to show progrss updates during setup
async function checkAndRunFirstTimeSetup(
  mainWindow: BrowserWindow | null,
): Promise<boolean> {
  if (appMetadata.getSetupComplete()) {
    log.info('First-time setup already completed.');
    return true;
  }

  const platform = getPlatformInfo();
  if (!platform.supported) {
    log.info('Skipping setup for unsupported platform');
    appMetadata.setSetupComplete();
    notifyRenderer(
      mainWindow,
      'complete',
      'Setup skipped for unsupported platform',
    );
    return true;
  }

  await dialog.showMessageBox({
    type: 'info',
    title: 'Setting up Cobolt',
    message: 'Cobolt needs to install some dependencies for first-time setup.',
    detail:
      'This process may take a few minutes. You will be notified when it completes.',
    buttons: ['Continue'],
    defaultId: 0,
  });

  try {
    log.info('Running first-time setup...');
    notifyRenderer(mainWindow, 'setup-start', 'Starting setup...');
    notifyRenderer(
      mainWindow,
      'setup-progress',
      'installing required dependencies...',
    );
    log.info(`Running ${platform.name} setup script: ${platform.scriptPath}`);

    return await runSetupScript(mainWindow, platform);
  } catch (error) {
    log.error('Error during setup:', error);
    notifyRenderer(mainWindow, 'setup-complete', 'Setup failed');

    await dialog.showMessageBox({
      type: 'error',
      title: 'Setup Error',
      message:
        'An error occurred during setup. Please check the logs for more details.',
      buttons: ['OK'],
      defaultId: 0,
    });
    return false;
  }
}

export default checkAndRunFirstTimeSetup;
