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
import { app, BrowserWindow, shell, ipcMain } from 'electron';
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

let mainWindow: BrowserWindow | null = null;
let persistentChatHistory: PersistentChatHistory;
log.initialize();

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  log.info(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')();
}

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

const createWindow = async () => {
  await initDependencies();
  await McpClient.connectToSevers();
  const chatHistory = new ChatHistory();
  persistentChatHistory = new PersistentChatHistory();

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

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

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
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

  // Add new chat handler
  ipcMain.handle('create-new-chat', async () => {
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
      mainWindow?.webContents.send(
        'message-response',
        'Sorry, I encountered an error processing your message.',
      );
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
};

ipcMain.handle('list-tools', () => {
  return McpClient.toolCache.map((tool) => ({
    serverName: tool.server,
    name: tool.toolDefinition.function.name,
    description: tool.toolDefinition.function.description,
  }));
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
    const setupSuccessful = await checkAndRunFirstTimeSetup(mainWindow);
    if (!setupSuccessful) {
      log.error('First-time setup failed. Exiting application.');
      app.quit();
    }
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
