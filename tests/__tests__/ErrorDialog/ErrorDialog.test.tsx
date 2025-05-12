import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ErrorDialog from '../../../src/renderer/components/ErrorDialog/ErrorDialog';

// Mock the window.api methods
beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: {
      onErrorDialog: jest.fn((callback) => {
        setTimeout(() => {
          callback({
            title: 'Test Error',
            message: 'This is a test error message.',
            detail: 'Detailed error information.',
          });
        }, 100);
      }),
      removeErrorDialogListener: jest.fn(),
    },
    writable: true,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('ErrorDialog', () => {
  it('should display the error dialog with correct details', async () => {
    render(<ErrorDialog />);

    // Wait for the dialog to appear
    const title = await screen.findByText('Test Error');
    const message = await screen.findByText('This is a test error message.');
    const detail = await screen.findByText('Detailed error information.');

    expect(title).toBeInTheDocument();
    expect(message).toBeInTheDocument();
    expect(detail).toBeInTheDocument();
  });

  it('should call removeErrorDialogListener on unmount', () => {
    const { unmount } = render(<ErrorDialog />);
    unmount();

    expect(window.api.removeErrorDialogListener).toHaveBeenCalled();
  });
});
