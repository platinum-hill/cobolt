/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import log from 'electron-log/main';
import { v4 as uuidv4 } from 'uuid';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import { queryEngineInstance } from '../cobolt-backend/query_engine';
import { RequestContext } from '../cobolt-backend/logger';
import { initDependencies } from '../cobolt-backend/init';
import {
  ChatHistory,
  PersistentChatHistory,
} from '../cobolt-backend/chat_history';
import { globalCancellationToken } from '../cobolt-backend/utils/cancellation';
import appMetadata from '../cobolt-backend/data_models/app_metadata';
import {
  getAvailableModels,
  getCurrentModels,
  updateCoreModels,
} from '../cobolt-backend/model_manager';
import { McpClient } from '../cobolt-backend/connectors/mcp_client';
import { updateMemoryEnabled } from '../cobolt-backend/memory';
import checkAndRunFirstTimeSetup from './setup';
import {
  errorManager,
  ErrorCategory,
} from '../cobolt-backend/utils/error_manager';

let mainWindow: BrowserWindow | null = null;
let loadingWindow: BrowserWindow | null = null;

log.initialize();

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  import('electron-debug')
    .then((electronDebug) => electronDebug.default())
    .catch(() => log.debug('error importing electron-debug'));
}

const RESOURCES_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(__dirname, '../../assets');

// Create a loading window to show during setup
const createLoadingWindow = () => {
  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  loadingWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    frame: false,
    resizable: false,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../dll/preload.js'),
    },
  });

  loadingWindow.loadURL(resolveHtmlPath('loading.html'));
  loadingWindow.once('ready-to-show', () => {
    loadingWindow?.show();
  });
};

// Close the loading window
const closeLoadingWindow = () => {
  if (loadingWindow) {
    loadingWindow.close();
    loadingWindow = null;
  }
};

// Add this function to display error dialogs consistently
const showErrorDialog = async (title: string, error: Error | string) => {
  const errorMessage = error instanceof Error ? error.message : error;
  let detailText = error instanceof Error && error.stack ? error.stack : '';

  log.error(`${title}: ${errorMessage}`);
  if (detailText) log.error(detailText);

  // For MCP connection errors
  if (title.includes('MCP Connection')) {
    const mcpErrorDetails = errorManager.formatErrors(
      ErrorCategory.MCP_CONNECTION,
    );

    if (mcpErrorDetails) {
      // Include a note about editing the config file
      const configHelp =
        '\n\nYou can edit the MCP servers configuration file from Settings to fix this issue.';

      // Use the detailed MCP errors as the detail text
      detailText = mcpErrorDetails + configHelp;
    }
  }

  // For MCP config errors
  if (title.includes('MCP Config')) {
    const configErrorDetails = errorManager.formatErrors(
      ErrorCategory.MCP_CONFIG,
    );

    if (configErrorDetails) {
      detailText = `${
        configErrorDetails
      }\n\nYou may need to fix or recreate the MCP configuration file. MCP Servers will not work till this is fixed.`;
    }
  }

  const dialogOptions = {
    type: 'error' as const,
    title,
    message: errorMessage,
    detail: detailText,
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0,
    backgroundColor: '#1E2329', // Dark theme matching app
    color: '#C5D8BC',
  };

  // If mainWindow exists, show modal on it, otherwise show non-modal dialog
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);

  return result;
};

const runFirstTimeSetup = async () => {
  if (!appMetadata.getSetupComplete()) {
    createLoadingWindow();
    try {
      const setupSuccessful = await checkAndRunFirstTimeSetup(loadingWindow);
      if (!setupSuccessful) {
        await showErrorDialog(
          'Setup Error',
          'First-time setup failed. The application will now exit.',
        );
        closeLoadingWindow();
        app.quit();
      }
    } catch (error) {
      await showErrorDialog('Setup Error', error as Error);
      closeLoadingWindow();
      app.quit();
    }
  } else {
    log.info('First-time setup already completed.');
  }
};

// Initialize main window
const createWindow = async () => {
  // Run first-time setup while loading window is shown
  await runFirstTimeSetup();

  await initDependencies();

  // Store config error status but don't show dialog yet
  const hasMcpConfigErrors =
    errorManager.getErrors(ErrorCategory.MCP_CONFIG).length > 0;

  // Handle MCP server connections (still try to connect even with config errors)
  const mcpStatus = await McpClient.connectToSevers();

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    minWidth: 500,
    minHeight: 500,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../dll/preload.js'),
    },
  });
  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', async () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    // Close loading window once main window is ready
    closeLoadingWindow();

    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }

    // Wait a bit for the UI to fully load before showing errors
    setTimeout(async () => {
      // First show config errors if any exist
      if (hasMcpConfigErrors) {
        await showErrorDialog(
          'MCP Config Error',
          'There was an error with the MCP servers configuration file.',
        );
      }

      // Then show MCP connection errors if any exist
      if (mcpStatus.errors.length > 0) {
        // If all servers failed, show a critical error
        if (!mcpStatus.success) {
          await showErrorDialog(
            'MCP Connection Error',
            'Failed to connect to any MCP server. Some functionality will be unavailable.',
          );
        } else {
          // If some servers succeeded but others failed, show a warning
          const failedServers = mcpStatus.errors
            .map((err) => err.serverName)
            .join(', ');
          await showErrorDialog(
            'MCP Connection Warning',
            `Connected to some MCP servers, but failed to connect to: ${failedServers}. Some tools may be unavailable.`,
          );
        }

        // Also notify the renderer that it can show a detailed error report
        mainWindow?.webContents.send('mcp-connection-status', {
          success: mcpStatus.success,
          hasErrors: mcpStatus.errors.length > 0,
        });
      }
    }, 1000); // Delay showing dialog to ensure UI is fully loaded
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });
};

const chatHistory = new ChatHistory();
const persistentChatHistory = new PersistentChatHistory();

async function processChunk(
  stream: AsyncGenerator<string>,
  chatId: string,
): Promise<string> {
  let fullResponse = '';
  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of stream) {
      fullResponse += chunk;
      mainWindow?.webContents.send('message-response', fullResponse);
    }

    // Save the complete response to the database
    if (chatId) {
      await persistentChatHistory.addMessageToChat(
        chatId,
        'assistant',
        fullResponse,
      );
    }

    return fullResponse;
  } catch (error) {
    log.error('Stream error:', error);
    return fullResponse;
  }
}

// Add new chat handler
ipcMain.handle('create-new-chat', async () => {
  // Clear the in-memory chat history to ensure no messages from previous chats are carried over
  chatHistory.clear();

  const newChat = {
    id: uuidv4(),
    title: 'New Chat',
    created_at: new Date(),
  };
  await persistentChatHistory.addChat(newChat);
  return newChat;
});

// Get recent chats handler
ipcMain.handle('get-recent-chats', async () => {
  try {
    const chats = await persistentChatHistory.getRecentChats();

    // For each chat, get the last message
    const enhancedChats = await Promise.all(
      chats.map(async (chat: any) => {
        try {
          const messages = await persistentChatHistory.getMessagesForChat(
            chat.id,
          );
          const lastMessage =
            messages.length > 0 ? messages[messages.length - 1].content : '';

          // Format the timestamp if it exists
          const timestamp = chat.created_at ? chat.created_at : new Date();

          return {
            ...chat,
            lastMessage,
            timestamp,
          };
        } catch (error) {
          log.error(`Error getting messages for chat ${chat.id}:`, error);
          return {
            ...chat,
            lastMessage: '',
            timestamp: new Date(),
          };
        }
      }),
    );

    return enhancedChats;
  } catch (error) {
    log.error('Error getting recent chats:', error);
    return [];
  }
});

// Get messages for a specific chat
ipcMain.handle('get-messages', async (_, chatId) => {
  try {
    return await persistentChatHistory.getMessagesForChat(chatId);
  } catch (error) {
    log.error('Error fetching messages:', error);
    return [];
  }
});

// Update chat title
ipcMain.handle('update-chat-title', async (_, chatId, title) => {
  try {
    await persistentChatHistory.updateChatTitle(chatId, title);
  } catch (error) {
    log.error('Error updating chat title:', error);
  }
});

// Set up IPC handlers
ipcMain.handle('send-message', async (_, chatId: string, message: string) => {
  try {
    globalCancellationToken.reset();

    // Add the user message to chat history
    chatHistory.addUserMessage(message);

    // Store message in the database linked to specific chat
    await persistentChatHistory.addMessageToChat(chatId, 'user', message);

    // Update chat title if this is the first message and title is still the default
    const chat = await persistentChatHistory.getChat(chatId);
    if (chat && chat.title === 'New Chat') {
      // Use the first ~30 chars of the message as the title
      const newTitle =
        message.length > 30 ? `${message.substring(0, 30)}...` : message;
      await persistentChatHistory.updateChatTitle(chatId, newTitle);
    }

    const requestContext: RequestContext = {
      currentDatetime: new Date(),
      chatHistory,
      question: message,
      requestId: uuidv4(),
    };

    const stream = await queryEngineInstance.query(
      requestContext,
      'CONTEXT_AWARE',
      globalCancellationToken,
    );

    // Process response and save it to the database
    await processChunk(stream, chatId);

    // Trigger event to update the chat list with new message
    mainWindow?.webContents.send('chat-updated');

    return true;
  } catch (error) {
    log.error('Error processing message:', error);

    // Send error to renderer for chat display
    mainWindow?.webContents.send(
      'message-response',
      'Sorry, I encountered an error processing your message.',
    );

    // Only show dialog for critical errors, not for every message error
    if (
      error instanceof Error &&
      (error.message.includes('connection') || error.message.includes('fatal'))
    ) {
      await showErrorDialog('Message Processing Error', error);
    }

    return false;
  }
});

ipcMain.handle('cancel-message', () => {
  globalCancellationToken.cancel();
  return { success: true };
});

ipcMain.handle('clear-chat', () => {
  chatHistory.clear();
});

// Memory settings IPC handlers
ipcMain.handle('get-memory-enabled', () => {
  return appMetadata.getMemoryEnabled();
});

ipcMain.handle('set-memory-enabled', (_, enabled: boolean) => {
  updateMemoryEnabled(enabled);
  return true;
});

ipcMain.handle('get-available-models', async () => {
  try {
    const models = await getAvailableModels();
    return {
      success: true,
      models,
    };
  } catch (error) {
    log.error('Error getting available models:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

ipcMain.handle('get-config', () => {
  try {
    const models = getCurrentModels();
    return {
      success: true,
      data: { models },
    };
  } catch (error) {
    log.error('Error getting config:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

// Handler to open MCP servers configuration file
ipcMain.handle('open-mcp-servers-file', () => {
  try {
    const appDataPath = app.getPath('userData');
    const configPath = path.join(appDataPath, 'mcp-servers.json');

    // Open file with system default app
    shell.openPath(configPath);

    return {
      success: true,
      message: 'File opened successfully',
    };
  } catch (error) {
    log.error('Error opening MCP servers file:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

ipcMain.handle('update-core-models', async (_event, newModelName) => {
  try {
    const success = await updateCoreModels(newModelName);
    return {
      success,
      message: success
        ? 'Models updated successfully'
        : 'Failed to update models',
    };
  } catch (error) {
    log.error('Error updating core models:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

// Add this with your other IPC handlers
ipcMain.handle('delete-chat', async (_, chatId: string) => {
  try {
    await persistentChatHistory.deleteChat(chatId);
    return { success: true };
  } catch (error) {
    log.error('Error deleting chat:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

// Add handler to clear and reload chat history when switching between chats
ipcMain.handle('load-chat', async (_, chatId: string) => {
  try {
    // Clear the in-memory chat history
    chatHistory.clear();

    // Load messages from the database for this chat
    const messages = await persistentChatHistory.getMessagesForChat(chatId);

    // Rebuild the in-memory chat history based on the loaded messages
    messages.forEach((msg: any) => {
      if (msg.role === 'user') {
        chatHistory.addUserMessage(msg.content);
      } else if (msg.role === 'assistant') {
        chatHistory.addAssistantMessage(msg.content);
      }
    });

    return { success: true };
  } catch (error) {
    log.error('Error loading chat history:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

ipcMain.handle('list-tools', () => {
  return McpClient.toolCache.map((tool) => ({
    serverName: tool.server,
    name: tool.toolDefinition.function.name,
    description: tool.toolDefinition.function.description,
  }));
});

// Replace the existing handler
ipcMain.handle('get-mcp-connection-errors', () => {
  return errorManager.getErrors(ErrorCategory.MCP_CONNECTION);
});

// Add a new handler for any error category
ipcMain.handle('get-errors', (_, category) => {
  return errorManager.getErrors(category);
});

// Global error handlers
process.on('uncaughtException', (error) => {
  showErrorDialog('Unexpected Error', error);
});

process.on('unhandledRejection', (reason) => {
  showErrorDialog('Unhandled Promise Rejection', reason as Error);
});

// Handle renderer process crashes
app.on('render-process-gone', (_, webContents, details) => {
  showErrorDialog(
    'Renderer Process Crashed',
    `Process: ${webContents.getTitle()}\nReason: ${details.reason}`,
  );
});

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(async () => {
    await createWindow();
    app.on('activate', async () => {
      if (mainWindow === null) await createWindow();
    });
  })
  .catch(async (error) => {
    log.error('Application failed to start:', error);
    try {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Application Startup Error',
        message: error instanceof Error ? error.message : String(error),
        detail: error instanceof Error && error.stack ? error.stack : '',
        buttons: ['OK'],
        defaultId: 0,
      });
    } catch (dialogError) {
      log.error('Failed to show startup error dialog:', dialogError);
    } finally {
      app.quit();
    }
  });

ipcMain.handle('report-error', async (_, errorMessage: string) => {
  await showErrorDialog('Application Error', errorMessage);
  return { handled: true };
});
