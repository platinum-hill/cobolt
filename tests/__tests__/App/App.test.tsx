import '@testing-library/jest-dom';
import { render, act } from '@testing-library/react';
import App from '../../../src/renderer/components/App/App';

// Mock electron-log/renderer to prevent initialization errors
jest.mock('electron-log/renderer', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  silly: jest.fn(),
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    silly: jest.fn(),
  },
}));

// Mock the scrollIntoView method since it's not available in JSDOM
beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();

  Object.defineProperty(window, 'api', {
    value: {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      cancelMessage: jest.fn().mockResolvedValue({ success: true }),
      onMessage: jest.fn(),
      onMessageCancelled: jest.fn(),
      clearChat: jest.fn().mockResolvedValue(undefined),
      getMemoryEnabled: jest.fn().mockResolvedValue(false),
      setMemoryEnabled: jest.fn().mockResolvedValue(true),
      getConductorEnabled: jest.fn().mockResolvedValue(true), // cheaterrr
      setConductorEnabled: jest.fn().mockResolvedValue(true),
      onErrorDialog: jest.fn(),
      removeErrorDialogListener: jest.fn(),
      getRecentChats: jest.fn().mockResolvedValue([]),
      createNewChat: jest.fn().mockResolvedValue({
        id: 'new-chat',
        title: 'New Chat',
        timestamp: new Date(),
      }),
      getMessagesForChat: jest.fn().mockResolvedValue([]),
      updateChatTitle: jest.fn().mockResolvedValue(undefined),
      deleteChat: jest.fn().mockResolvedValue(undefined),
      loadChat: jest.fn().mockResolvedValue({ success: true }),
      onSetupStart: jest.fn(),
      onSetupComplete: jest.fn(),
      onSetupProgress: jest.fn(),
      removeSetupListeners: jest.fn(),
      listTools: jest.fn().mockResolvedValue([]),
      openMcpServersFile: jest
        .fn()
        .mockResolvedValue({ success: true, message: 'File opened' }),
    },
    writable: true,
  });

  Object.defineProperty(window, 'electron', {
    value: {
      ipcRenderer: {
        invoke: jest.fn().mockImplementation((channel) => {
          switch (channel) {
            case 'get-available-models':
              return Promise.resolve({
                success: true,
                models: [{ name: 'model1' }, { name: 'model2' }],
                message: 'Models fetched successfully',
              });
            case 'get-config':
              return Promise.resolve({
                success: true,
                data: {
                  models: {
                    CHAT_MODEL: { name: 'model1' },
                  },
                },
                message: 'Config loaded successfully',
              });
            case 'update-core-models':
              return Promise.resolve({
                success: true,
                message: 'Models updated successfully',
              });
            case 'refresh-mcp-connections':
              return Promise.resolve({
                success: true,
                message: 'MCP connections refreshed',
              });
            case 'get-models':
              return Promise.resolve({
                success: true,
                models: ['model1', 'model2'],
                message: 'Models fetched successfully',
              });
            case 'save-settings':
              return Promise.resolve({
                success: true,
                message: 'Settings saved successfully',
              });
            case 'load-conversation':
              return Promise.resolve({
                success: true,
                conversation: { id: 'conv1', messages: [] },
                message: 'Conversation loaded',
              });
            default:
              return Promise.resolve({
                success: false,
                message: 'Unknown command',
              });
          }
        }),
        on: jest.fn(),
        removeListener: jest.fn(),
      },
    },
    writable: true,
  });
});

describe('App', () => {
  it('should render', async () => {
    let component;
    await act(async () => {
      component = render(<App />);
    });
    expect(component).toBeTruthy();
  });
});
