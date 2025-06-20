import { ToolInfo } from './types/index';

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    api: {
      sendMessage: (chatId: string, message: string) => Promise<void>;
      cancelMessage: () => Promise<{ success: boolean }>;
      onMessage: (callback: (message: string) => void) => () => void;
      onMessageCancelled: (callback: (message: string) => void) => () => void;
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
      loadChat: (
        chatId: string,
      ) => Promise<{ success: boolean; message?: string }>;

      // Setup-related API methods
      onSetupStart: (callback: () => void) => void;
      onSetupComplete: (callback: () => void) => void;
      onSetupProgress: (callback: (message: string) => void) => void;
      removeSetupListeners: () => void;
      listTools: () => Promise<ToolInfo[]>;
      getMemoryEnabled: () => Promise<boolean>;
      setMemoryEnabled: (enabled: boolean) => Promise<boolean>;
      openMcpServersFile: () => Promise<{ success: boolean; message: string }>;

      // Error dialog related methods
      onErrorDialog: (
        callback: (data: {
          title: string;
          message: string;
          detail?: string;
          mcpErrorDetails?: string;
          configErrorDetails?: string;
        }) => void,
      ) => void;
      removeErrorDialogListener: () => void;
    };
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        on: (channel: string, callback: (...args: any[]) => void) => void;
        removeListener: (
          channel: string,
          callback: (...args: any[]) => void,
        ) => void;
        invoke(channel: 'download-update'): Promise<any>;
        invoke(channel: 'download-and-install'): Promise<{
          success: boolean;
          error?: string;
          readyToInstall?: boolean;
        }>;
        invoke(channel: 'install-update'): Promise<any>;
        invoke(channel: 'enable-auto-install'): Promise<any>;
        invoke(channel: 'get-update-status'): Promise<any>;
        invoke(channel: 'check-for-updates-menu'): Promise<any>;
        invoke(channel: 'get-app-version'): Promise<string>;
      };
    };
  }
}

export {};
