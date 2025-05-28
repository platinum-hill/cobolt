import path from 'path';
import { app, BrowserWindow, dialog } from 'electron';
import { execFile } from 'child_process';
import log from 'electron-log/main';
import appMetadata from '../cobolt-backend/data_models/app_metadata';

// Get platform specific information required for initial setup
function getPlatformInfo() {
  log.info(`Platform: ${process.platform}`);
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../assets');

  let execCommand = '';
  let name = '';
  let scriptPath = '';

  if (isWindows) {
    const scriptName = 'win_deps.ps1';
    scriptPath = path.join(resourcesPath, 'scripts', scriptName);
    name = 'Windows';
    execCommand = `powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}"`;
  } else if (isMac) {
    const scriptName = 'mac_deps.sh';
    scriptPath = path.join(resourcesPath, 'scripts', scriptName);
    name = 'macOS';
    execCommand = `"${scriptPath}"`;
  } else if (isLinux) {
    // Skip Linux setup since it requires admin privileges.
    // The user must install dependencies manually.
    name = 'Linux';
  }

  const supported = isWindows || isMac || isLinux;

  return {
    supported,
    name,
    scriptPath,
    execCommand,
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
  return new Promise((resolve, reject) => {
    const child = execFile(
      platform.execCommand,
      [],
      { shell: true },
      (error) => {
        if (error) {
          log.error(`Error running ${platform.name} setup script:`, error);
          reject(error);
        } else {
          log.info(`${platform.name} setup script completed successfully`);
          appMetadata.setSetupComplete();
          notifyRenderer(mainWindow, 'setup-complete', 'Setup complete');
          resolve(true);
        }
      },
    );

    // Capture and log stdout
    child.stdout?.on('data', (data) => {
      log.info(`[Setup] ${data.toString().trim()}`);
      notifyRenderer(mainWindow, 'setup-progress', data.toString().trim());
    });

    // Capture and log stderr
    child.stderr?.on('data', (data) => {
      log.error(`[Setup] ${data.toString().trim()}`);
      appMetadata.resetSetupComplete();
    });
  });
}

// TODO: Use electron renderer to show progrss updates during setup
async function checkAndRunFirstTimeSetup(
  mainWindow: BrowserWindow | null,
): Promise<boolean> {
  const platform = getPlatformInfo();
  log.debug(`Platform ${platform.name}. Supported: ${platform.supported}`);
  if (!platform.supported) {
    log.info('Skipping setup for unsupported platform');
    appMetadata.setSetupComplete();
    notifyRenderer(
      mainWindow,
      'setup-complete',
      'Setup skipped for unsupported platform',
    );
    return true;
  }

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
      message: `An error occurred during setup: ${error}`,
      buttons: ['OK'],
      defaultId: 0,
    });
    return false;
  }
}

export default checkAndRunFirstTimeSetup;
