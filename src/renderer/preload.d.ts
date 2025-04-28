import { ToolInfo } from './types/index';

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    api: {
      sendMessage: (chatId: string, message: string) => Promise<void>;
      cancelMessage: () => Promise<{ success: boolean }>;
      onMessage: (callback: (message: string) => void) => void;
      onMessageCancelled: (callback: (message: string) => void) => void;
      clearChat: () => Promise<void>;

      // Chat-related API methods
      getRecentChats: () => Promise<
        { id: string; title: string; timestamp: Date; lastMessage?: string }[]
      >;
      createNewChat: () => Promise<{
        id: string;
        title: string;
        timestamp: Date;
      }>;
      getMessagesForChat: (
        chatId: string,
      ) => Promise<
        { id: string; content: string; sender: string; timestamp: Date }[]
      >;
      updateChatTitle: (chatId: string, title: string) => Promise<void>;
      deleteChat: (chatId: string) => Promise<void>;

      // Setup-related API methods
      onSetupStart: (callback: () => void) => void;
      onSetupComplete: (callback: () => void) => void;
      onSetupProgress: (callback: (message: string) => void) => void;
      removeSetupListeners: () => void;
      listTools: () => Promise<ToolInfo[]>;
      getMemoryEnabled: () => Promise<boolean>;
      setMemoryEnabled: (enabled: boolean) => Promise<boolean>;
      openMcpServersFile: () => Promise<{ success: boolean; message: string }>;
    };
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
      };
    };
  }
}

export {};
