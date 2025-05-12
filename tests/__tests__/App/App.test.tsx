import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import React from 'react';
import App from '../../../src/renderer/components/App/App';

// Mock the scrollIntoView method since it's not available in JSDOM
beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();

  Object.defineProperty(window, 'api', {
    value: {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      cancelMessage: jest.fn().mockResolvedValue({ success: true }),
      onMessage: jest.fn(),
      clearChat: jest.fn().mockResolvedValue(undefined),
      getMemoryEnabled: jest.fn().mockResolvedValue(false),
      setMemoryEnabled: jest.fn().mockResolvedValue(true),
      onErrorDialog: jest.fn(),
      removeErrorDialogListener: jest.fn(),
    },
    writable: true,
  });

  Object.defineProperty(window, 'electron', {
    value: {
      ipcRenderer: {
        invoke: jest.fn().mockImplementation((channel) => {
          switch (channel) {
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
      },
    },
    writable: true,
  });
});

describe('App', () => {
  it('should render', () => {
    expect(render(<App />)).toBeTruthy();
  });
});
