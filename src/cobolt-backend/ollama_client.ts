import { Ollama, Message} from 'ollama';
import { exec, spawn } from 'child_process';
import log from 'electron-log/main';
import * as os from 'os';
import configStore from './data_models/config_store';

import { MODELS } from './model_manager'
import { BrowserWindow } from 'electron';

let progressWindow: BrowserWindow | null = null;
let updateTimer: NodeJS.Timeout | null = null;
let pendingUpdate: { title: string; message: string; detail: string } | null = null;

/**
 * Set the progress window for notifications
 */
function setProgressWindow(window: BrowserWindow | null) {
  progressWindow = window;
}

/**
 * Actually send the update to the renderer
 */
function doSendUpdate(title: string, message: string, detail: string) {
  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.webContents.send('show-error-dialog', {
      title,
      message,
      detail,
      isModelDownload: true
    });
  }
}

/**
 * Send model download status to the error dialog (debounced)
 */
function sendModelDownloadStatus(title: string, message: string, detail: string, immediate = false) {
  if (immediate) {
    // Clear any pending update and send immediately
    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }
    doSendUpdate(title, message, detail);
    return;
  }

  // Store the latest update
  pendingUpdate = { title, message, detail };

  // If there's already a timer, just update the pending data
  if (updateTimer) {
    return;
  }

  // Schedule the update
  updateTimer = setTimeout(() => {
    if (pendingUpdate) {
      doSendUpdate(pendingUpdate.title, pendingUpdate.message, pendingUpdate.detail);
      pendingUpdate = null;
    }
    updateTimer = null;
  }, 1000);
}

const ollama = new Ollama({
  host: configStore.getOllamaUrl(),
});

const OLLAMA_START_TIMEOUT = configStore.getOllamaStartTimeout();

const defaultTemperature = 1.0;
const defaultTopK = 64;
const defaultTopP = 0.95;
let ollamaServerStartedByApp = false;

/**
 * If the required models are not available, download them
 *
 * @param model - The name of the model to check/download.
 * @param modelNames - The list of available models.
 */
async function pullRequiredModel(
  model: string,
  modelNames: string[],
): Promise<void> {
  if (!modelNames.includes(model)) {
    log.log(`${model} not found in Ollama: downloading now`);
    
    let progressDetails = [`Starting download of ${model}...`];
    
    // Send immediate update for start
    sendModelDownloadStatus(
      'Downloading Models', 
      'Please wait while required models are being downloaded...', 
      progressDetails.join('\n'),
      true
    );
    
    try {
      const stream = await ollama.pull({ model, stream: true });
      let lastPercentage = -1;
      
      for await (const part of stream) {
        if (part.status) {
          let progressMsg = `${model}: ${part.status}`;
          
          // Add percentage if available
          if (part.completed && part.total) {
            const percentage = Math.round((part.completed / part.total) * 100);
            progressMsg = `${model}: ${part.status} (${percentage}%)`;
            
            // Only update if percentage changed significantly
            if (Math.abs(percentage - lastPercentage) < 5) {
              continue;
            }
            lastPercentage = percentage;
          }
          
          // Replace the last progress message for the same model
          if (progressDetails.length > 1 && progressDetails[progressDetails.length - 1].startsWith(model)) {
            progressDetails[progressDetails.length - 1] = progressMsg;
          } else {
            progressDetails.push(progressMsg);
          }
          
          // Keep only last 8 progress messages
          if (progressDetails.length > 8) {
            progressDetails = [progressDetails[0], ...progressDetails.slice(-7)];
          }
          
          // Debounced update
          sendModelDownloadStatus(
            'Downloading Models', 
            'Please wait while required models are being downloaded...', 
            progressDetails.join('\n')
          );
        }
      }
      
      progressDetails.push(`✓ ${model} downloaded successfully`);
      
      // Send immediate update for completion
      sendModelDownloadStatus(
        'Downloading Models', 
        'Please wait while required models are being downloaded...', 
        progressDetails.join('\n'),
        true
      );
      
    } catch (error) {
      log.error(`Error downloading ${model}:`, error);
      
      let errorMsg = '';
      let userFriendlyMsg = '';
      
      if (error && typeof error === 'object' && 'message' in error) {
        errorMsg = (error as { message: string }).message;
      } else {
        errorMsg = String(error);
      }
      
      userFriendlyMsg = `Failed to download "${model}": ${errorMsg}`;
      progressDetails.push(`✗ ${userFriendlyMsg}`);
      
      sendModelDownloadStatus(
        'Model Download Error', 
        userFriendlyMsg, 
        progressDetails.join('\n'),
        true
      );
      
      throw new Error(`Failed to download model "${model}": ${userFriendlyMsg}`);
    }
  }
}

/**
 * Check if the required models are available and download them if they are not
 */
async function updateModels() {
  try {
    const modelsList = await ollama.list();
    const existingModelNames: string[] = modelsList.models.map((m) => m.model);

    const config = configStore.getFullConfig();
    const modelsToCheck = Object.values(config.models);
    
    const missingModels = modelsToCheck.filter(model => 
      !existingModelNames.includes(model.name)
    );

    if (missingModels.length === 0) {
      return;
    }

    // Send immediate update for start
    const allProgress = [`Found ${missingModels.length} missing model(s): ${missingModels.map(m => m.name).join(', ')}`];
    sendModelDownloadStatus(
      'Downloading Models', 
      'Please wait while required models are being downloaded...', 
      allProgress.join('\n'),
      true
    );

    // Track successful and failed downloads
    const results = [];
    
    // Download models sequentially
    for (const model of modelsToCheck) {
      try {
        await pullRequiredModel(model.name, existingModelNames);
        results.push({ model: model.name, success: true });
      } catch (error) {
        results.push({ model: model.name, success: false, error });
        log.error(`Failed to download model ${model.name}:`, error);
      }
    }

    // Check results and provide appropriate feedback
    const failed = results.filter(r => !r.success);

    if (failed.length === 0) {
      // All models downloaded successfully
      allProgress.push('All models downloaded successfully!');
      sendModelDownloadStatus(
        'Models Ready', 
        'All required models have been downloaded and are ready to use.', 
        allProgress.join('\n'),
        true
      );
      
      // Update Models List in Settings Panel by triggering a refresh
      if (progressWindow && !progressWindow.isDestroyed()) {
        log.debug('Sending refresh-models-list event to renderer');
        progressWindow.webContents.send('refresh-models-list');
      } else {
        log.error('progressWindow is not available to send refresh-models-list event');
      }

    } else {
      // Any models failed to download - treat as critical error
      const errorSummary = [
        'Failed to download required models:',
        ...failed.map(f => `• ${f.model}`),
        '',
        'The application will not work properly without these models.',
        'Please check your configuration and fix the model names, then restart the application.'
      ].join('\n');
      
      sendModelDownloadStatus(
        'Model Download Failed', 
        'Failed to download required models. The application will not work properly and should be fixed.', 
        errorSummary,
        true
      );
      
      const failedModelsWithErrors = failed.map(f => {
        const errorMsg = f.error instanceof Error ? f.error.message : String(f.error);
        return `${f.model}: ${errorMsg}`;
      }).join('; ');
      
      throw new Error(`Failed to download required models: ${failedModelsWithErrors}`);
    }
  } catch (error) {
    log.error('Error in updateModels:', error);
    
    // Handle errors in the model checking process itself
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.webContents.send('show-error-dialog', {
        title: 'Model Download Failed',
        message: 'Failed to download required models. The application will not work properly.',
        detail: `Error: ${errorMsg}\n\nPlease check your Ollama installation and configuration.`,
        isModelDownload: false
      });
    }
  }
}

/**
 * Check if the Ollama server is running and pull the required models
 * If the server is not running, start it and wait 5s for it to be ready
 * If the required models are not available, download them
 */
async function initOllama(): Promise<boolean> {
  log.info("Initializing Ollama");
  const platform = os.platform();
  
  try {
    await ollama.ps();
    log.log('Ollama server is already running');
  } catch {
    log.log('Server not running: Starting the ollama server on platform:', platform);
    ollamaServerStartedByApp = true;
    const system: string = platform.toLowerCase();
    
    if (system === 'win32' || system === 'linux') {
      // run in the background but capture a few initial log lines
      const env = {
        ...process.env,
        OLLAMA_FLASH_ATTENTION: '1',
        OLLAMA_KV_CACHE_TYPE: 'q4_0',
      };

      const child = spawn('ollama', ['serve'], {
        env,
        detached: true,          // keep running after parent continues
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      // log only the first N lines to avoid flooding the log file
      const MAX_LINES = 5;
      let outCnt = 0;
      let errCnt = 0;

      child.stdout.on('data', (data) => {
        if (outCnt++ < MAX_LINES) {
          log.info(`win32 ollama stdout: ${data.toString().trim()}`);
        }
      });

      child.stderr.on('data', (data) => {
        if (errCnt++ < MAX_LINES) {
          log.warn(`win32 ollama stderr: ${data.toString().trim()}`);
        }
      });

      child.on('error', (err) => log.error('win32 ollama spawn error:', err));

      // let the child continue independently
      child.unref();

    } else if (system === 'darwin') {
      exec('OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q4_0 brew services start ollama &',
        logExecOutput('macOS')
      );
    } else {
      log.log(`Unsupported operating system: ${system}`);
      
      return false;
    }
    
    await new Promise(function sleep(resolve) {
      setTimeout(resolve, OLLAMA_START_TIMEOUT);
    });
    
    try {
      await ollama.ps();
      log.log('Ollama server started successfully');
    } catch (startupError) {
      log.error('Failed to start Ollama server. Please start Ollama manually and restart the application. Error:', startupError);
      
      // Throw the error to be handled by the calling code
      throw new Error(
        `Ollama startup failed. Failed to start Ollama server automatically.
        
        Please start Ollama manually and restart the application.
        The application attempted to start Ollama but it is not responding. Please:
        1. Check if Ollama is installed correctly
        2. Start Ollama manually (run "ollama serve" in terminal)
        3. Restart this application
        
        If the problem persists, check the Ollama installation and try running "ollama --version" in your terminal.
        Error: ${startupError instanceof Error ? startupError.message : String(startupError)}`
      );
    }
  }

  try {
    await updateModels();
    return true;
  } catch (error) {
    log.error('Failed to initialize models:', error);
    // Don't fail completely - let the app start even if models failed
    // The user will see the error dialog and can try to fix the configuration
    return false;
  }
}

async function stopOllama() {
  if (!ollamaServerStartedByApp) {
    log.log('Ollama server was not started by the app, skipping stop');
    return;
  }
  
  const system: string = os.platform().toLowerCase();
  if (system === 'win32') {
    exec('taskkill /IM ollama.exe /F', logExecOutput(system));
  } else if (system === 'darwin') {
    exec('brew services stop ollama', logExecOutput(system));
  } else if (system === 'linux') {
    exec('systemctl stop ollama.service', logExecOutput(system));
  }
}



const getOllamaClient = (): Ollama => {
  return ollama
}

function logExecOutput(platform: string) {
  return (error: any, stdout: string, stderr: string) => {
    if (error) {
      log.error(`${platform} exec error:`, error);
    }
    if (stdout) {
      log.info(`${platform} exec stdout:`, stdout);
    }
    if (stderr) {
      log.warn(`${platform} exec stderr:`, stderr);
    }
  };
}

export { initOllama, getOllamaClient, stopOllama, setProgressWindow };
