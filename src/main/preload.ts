import { contextBridge, ipcRenderer } from 'electron';

type Chat = {
  id: string;
  title: string;
  created_at: Date;
};

// Define all valid channels in one place for better maintenance
const validChannels = {
  invoke: [
    'send-message',
    'cancel-message',
    'clear-chat',
    'get-messages',
    'get-memory-enabled',
    'set-memory-enabled',
    'get-recent-chats',
    'create-new-chat',
    'update-chat-title',
    'delete-chat',
    'load-chat',
    'list-tools',
    'open-mcp-servers-file',
    'get-available-models',
    'get-config',
    'update-core-models',
    'report-error',
  ],
  on: [
    'message-response',
    'message-cancelled',
    'setup-start',
    'setup-complete',
    'setup-progress',
    'show-error-dialog',
  ],
};

contextBridge.exposeInMainWorld('api', {
  // Chat functionality
  sendMessage: (id: string, message: string) =>
    ipcRenderer.invoke('send-message', id, message),
  cancelMessage: () => ipcRenderer.invoke('cancel-message'),
  clearChat: () => ipcRenderer.invoke('clear-chat'),
  getMessagesForChat: (chatId: string) =>
    ipcRenderer.invoke('get-messages', chatId),

  // Message events
  onMessage: (callback: (message: string) => void) => {
    ipcRenderer.on('message-response', (_, message) => callback(message));
  },
  onMessageCancelled: (callback: (message: string) => void) => {
    ipcRenderer.on('message-cancelled', (_, message) => callback(message));
  },

  // Memory settings
  getMemoryEnabled: () => ipcRenderer.invoke('get-memory-enabled'),
  setMemoryEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('set-memory-enabled', enabled),

  // Chat history methods
  getRecentChats: (): Promise<Chat[]> => ipcRenderer.invoke('get-recent-chats'),
  createNewChat: (): Promise<Chat> => ipcRenderer.invoke('create-new-chat'),
  updateChatTitle: (chatId: string, title: string): Promise<void> =>
    ipcRenderer.invoke('update-chat-title', chatId, title),
  deleteChat: (chatId: string): Promise<void> =>
    ipcRenderer.invoke('delete-chat', chatId),
  loadChat: (chatId: string): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke('load-chat', chatId),

  // Setup-related API methods
  onSetupStart: (callback: () => void) => {
    ipcRenderer.on('setup-start', () => callback());
  },
  onSetupComplete: (callback: () => void) => {
    ipcRenderer.on('setup-complete', () => callback());
  },
  onSetupProgress: (callback: (message: string) => void) => {
    ipcRenderer.on('setup-progress', (_, message) => callback(message));
  },
  removeSetupListeners: () => {
    ipcRenderer.removeAllListeners('setup-start');
    ipcRenderer.removeAllListeners('setup-complete');
    ipcRenderer.removeAllListeners('setup-progress');
  },

  // Tools
  listTools: () => ipcRenderer.invoke('list-tools'),
  openMcpServersFile: () => ipcRenderer.invoke('open-mcp-servers-file'),
});

// Expose a more flexible, unified API for direct IPC access
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    // Invoke method with channel validation
    invoke: (channel: string, ...args: any[]) => {
      if (validChannels.invoke.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      throw new Error(`Unauthorized IPC channel: ${channel}`);
    },

    // Unified on method for all event types
    on: (channel: string, callback: (...args: any[]) => void) => {
      if (validChannels.on.includes(channel)) {
        ipcRenderer.on(channel, (_event, ...args) => callback(...args));
      } else {
        console.warn(`Unauthorized IPC channel subscription: ${channel}`);
      }
    },

    // Remove listeners with channel validation
    removeAllListeners: (channel: string) => {
      if (validChannels.on.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      } else {
        console.warn(`Unauthorized IPC channel removal: ${channel}`);
      }
    },
  },

  // Error handling convenience methods
  errorHandling: {
    reportError: (error: Error | string) =>
      ipcRenderer.invoke(
        'report-error',
        error instanceof Error ? error.toString() : error,
      ),
  },
});
