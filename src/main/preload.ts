import { contextBridge, ipcRenderer } from 'electron';

type Chat = {
  id: string;
  title: string;
  created_at: Date;
};

const electronHandler = {
  sendMessage: (id: string, message: string) =>
    ipcRenderer.invoke('send-message', id, message),
  cancelMessage: () => ipcRenderer.invoke('cancel-message'),
  onMessage: (callback: (message: string) => void) => {
    ipcRenderer.on('message-response', (_, message) => callback(message));
  },
  clearChat: () => ipcRenderer.invoke('clear-chat'),
  onMessageCancelled: (callback: (message: string) => void) => {
    ipcRenderer.on('message-cancelled', (_, message) => callback(message));
  },
  getMessagesForChat: (chatId: string) =>
    ipcRenderer.invoke('get-messages', chatId),

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
  listTools: () => ipcRenderer.invoke('list-tools'),
  openMcpServersFile: () => ipcRenderer.invoke('open-mcp-servers-file'),
};

contextBridge.exposeInMainWorld('api', electronHandler);

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      const validChannels = [
        'get-available-models',
        'get-config',
        'update-core-models',
        'delete-chat',
        // ...other valid channels
      ];

      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }

      throw new Error(`Unauthorized IPC channel: ${channel}`);
    },
  },
});
