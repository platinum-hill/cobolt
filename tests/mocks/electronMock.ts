Object.defineProperty(window, 'api', {
  value: {
    onMessageCancelled: jest.fn(),
    cancelMessage: jest.fn().mockResolvedValue({ success: true }),
  },
  writable: true,
});
