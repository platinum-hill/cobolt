/* eslint-disable global-require, no-console */
// Mock the modules
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  const connectMock = jest.fn();
  const listToolsMock = jest.fn();
  const getServerVersionMock = jest
    .fn()
    .mockReturnValue({ name: 'test-server', version: '1.0.0' });

  return {
    Client: jest.fn(() => ({
      connect: connectMock,
      listTools: listToolsMock,
      getServerVersion: getServerVersionMock,
    })),
  };
});

jest.mock('@modelcontextprotocol/sdk/client/stdio.js');
jest.mock('../../../../src/cobolt-backend/connectors/mcp_tools', () => ({
  mcpServers: [
    {
      command: 'test-cmd-1',
      scriptPath: 'test-script-1',
      name: 'server1',
      args: [],
    },
    {
      command: 'test-cmd-2',
      scriptPath: 'test-script-2',
      name: 'server2',
      args: ['arg1'],
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
      getServerVersion: jest
        .fn()
        .mockReturnValue({ name: 'test-server', version: '1.0.0' }),
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
      getServerVersion: jest
        .fn()
        .mockReturnValue({ name: 'test-server', version: '1.0.0' }),
    }));

    // Should NOT throw when at least one server connects successfully
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

  test('throws when all servers fail to connect', async () => {
    // Both connections fail
    const connectMock = jest.fn().mockImplementation(() => {
      return Promise.reject(new Error('Test connection error'));
    });

    const ClientMock =
      require('@modelcontextprotocol/sdk/client/index.js').Client;
    ClientMock.mockImplementation(() => ({
      connect: connectMock,
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      getServerVersion: jest
        .fn()
        .mockReturnValue({ name: 'test-server', version: '1.0.0' }),
    }));

    // First attempt - should try to connect to both servers but fail
    const result = await McpClientInstance.connectToSevers();

    // Verify connectMock was called twice (for both servers)
    expect(connectMock).toHaveBeenCalledTimes(2);

    // Verify we got the expected result object with errors
    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(2);
    expect(result.errors[0]).toHaveProperty('serverName');
    expect(result.errors[0]).toHaveProperty('error');
    expect(result.errors[1]).toHaveProperty('serverName');
    expect(result.errors[1]).toHaveProperty('error');
    expect(result.errorMessage).toContain('Failed to connect');

    // Create a separate test scenario for error handling
    const errorResult = await McpClientInstance.connectToSevers();

    // Verify the error result
    expect(errorResult.success).toBe(false);
    expect(errorResult.errorMessage).toContain('Failed to connect');
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
        .mockReturnValue({ name: 'test-server', version: '1.0.0' }),
    }));

    await McpClientInstance.connectToSevers();

    // Mock implementation to avoid complicated implementation details
    // @ts-ignore: Replacing private method for testing
    McpClientInstance.listTools = jest.fn().mockImplementation(() => {
      return [
        {
          type: 'mcp',
          toolDefinition: { type: 'function' },
          server: 'test-server',
        },
      ];
    });

    const tools = await McpClientInstance.listAllConnectedTools();

    // Should return tools from all clients
    expect(tools.length).toBe(2); // One tool from each client
  });
});
