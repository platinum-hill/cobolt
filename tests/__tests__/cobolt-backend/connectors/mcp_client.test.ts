/* eslint-disable global-require, no-console */
// Mock the modules
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  const connectMock = jest.fn();
  const listToolsMock = jest.fn();

  return {
    Client: jest.fn(() => ({
      connect: connectMock,
      listTools: listToolsMock,
    })),
  };
});

jest.mock('@modelcontextprotocol/sdk/client/stdio.js');
jest.mock('../../../../src/cobolt-backend/connectors/mcp_tools', () => ({
  mcpServers: [
    { command: 'test-cmd-1', scriptPath: 'test-script-1' },
    {
      command: 'test-cmd-2',
      scriptPath: 'test-script-2',
      additionalArgs: ['arg1'],
    },
  ],
}));
jest.mock('dotenv');
jest.mock('electron-log/main', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('MCPClient', () => {
  let McpClientInstance: any;

  beforeEach(() => {
    // Set up and clear mocks before each test
    jest.clearAllMocks();

    // reset singletion instance after each test
    jest.resetModules();
    McpClientInstance =
      require('../../../../src/cobolt-backend/connectors/mcp_client').McpClient;
  });

  test('initialize client with empty array', () => {
    // @ts-ignore: Accessing private property for testing
    expect(McpClientInstance.clients).toEqual([]);
  });

  test('connectToSevers attempts to connect to all servers', async () => {
    // Setup the mock implementation
    const connectMock = jest.fn().mockResolvedValue(undefined);
    const ClientMock =
      require('@modelcontextprotocol/sdk/client/index.js').Client;
    ClientMock.mockImplementation(() => ({
      connect: connectMock,
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
    }));

    await McpClientInstance.connectToSevers();

    // Should have created 2 clients (one for each server)
    expect(ClientMock).toHaveBeenCalledTimes(2);

    // Should have connected twice
    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  test('handles partial server connection failures', async () => {
    // First connection fails, second succeeds
    const connectMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('Test connection error'))
      .mockResolvedValueOnce(undefined);

    const ClientMock =
      require('@modelcontextprotocol/sdk/client/index.js').Client;
    ClientMock.mockImplementation(() => ({
      connect: connectMock,
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
    }));

    await McpClientInstance.connectToSevers();

    // Should have tried connecting twice
    expect(connectMock).toHaveBeenCalledTimes(2);

    // Should have logged an error for the first server
    const electronLog = require('electron-log/main').default;
    expect(electronLog.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to connect to MCP server'),
      expect.any(Error),
    );
  });

  test('listAllConnectedTools returns tools from all clients', async () => {
    // Setup mock clients with tool results
    const mockToolsResult = {
      tools: [{ name: 'test-tool', description: 'Test tool' }],
    };

    const listToolsMock = jest.fn().mockResolvedValue(mockToolsResult);

    const ClientMock =
      require('@modelcontextprotocol/sdk/client/index.js').Client;
    ClientMock.mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: listToolsMock,
      getServerVersion: jest
        .fn()
        .mockResolvedValue({ name: 'test-server', version: '1.0.0' }),
    }));

    await McpClientInstance.connectToSevers();

    // Mock implementation to avoid complicated implementation details
    // @ts-ignore: Replacing private method for testing
    McpClientInstance.listTools = jest.fn().mockImplementation(() => {
      return [{ type: 'mcp', toolDefinition: { type: 'function' } }];
    });

    const tools = await McpClientInstance.listAllConnectedTools();

    // Should return tools from all clients
    expect(tools.length).toBe(2); // One tool from each client
  });
});
