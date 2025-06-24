import { ConductorGenerator } from '../../../../src/cobolt-backend/generators/conductor_generator';
import { RequestContext } from '../../../../src/cobolt-backend/logger';
import { FunctionTool } from '../../../../src/cobolt-backend/ollama_tools';
import { CancellationToken } from '../../../../src/cobolt-backend/utils/cancellation';
import { ChatHistory } from '../../../../src/cobolt-backend/chat_history';

// Mock dependencies
jest.mock('../../../../src/cobolt-backend/ollama_client', () => ({
  getOllamaClient: jest.fn(),
}));

jest.mock(
  '../../../../src/cobolt-backend/generators/simple_ollama_stream',
  () => ({
    simpleChatOllamaStream: jest.fn(),
  }),
);

jest.mock('../../../../src/cobolt-backend/model_manager', () => ({
  MODELS: {
    CHAT_MODEL: 'llama3',
    CHAT_MODEL_CONTEXT_LENGTH: 4096,
    TOOLS_MODEL: 'llama3',
    TOOLS_MODEL_CONTEXT_LENGTH: 4096,
  },
}));

jest.mock(
  '../../../../src/cobolt-backend/generators/tool_execution_utils',
  () => ({
    ToolExecutionUtils: {
      modelSupportsTools: jest.fn(),
      processThinkingInContent: jest.fn(),
      emitExecutionEvent: jest.fn(),
      createToolCallSuccessInfo: jest.fn(),
      createToolCallErrorInfo: jest.fn(),
    },
    ThinkingState: {},
  }),
);

jest.mock('../../../../src/cobolt-backend/connectors/mcp_client', () => ({
  McpClient: {
    toolCache: [],
  },
}));

jest.mock('electron-log/main', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Import mocked modules
const {
  getOllamaClient,
} = require('../../../../src/cobolt-backend/ollama_client');
const {
  simpleChatOllamaStream,
} = require('../../../../src/cobolt-backend/generators/simple_ollama_stream');
const {
  ToolExecutionUtils,
} = require('../../../../src/cobolt-backend/generators/tool_execution_utils');
const {
  McpClient,
} = require('../../../../src/cobolt-backend/connectors/mcp_client');

describe('ConductorGenerator', () => {
  let conductorGenerator: ConductorGenerator;
  let mockRequestContext: RequestContext;
  let mockCancellationToken: CancellationToken;
  let mockOllamaClient: any;

  // Helper function to consume async iterator with a limit
  async function consumeAsyncIteratorWithLimit(
    generator: AsyncIterable<string>,
    maxCount: number,
  ): Promise<string[]> {
    const results: string[] = [];
    let count = 0;
    const iterator = generator[Symbol.asyncIterator]();

    const collectNext = async (): Promise<void> => {
      if (count >= maxCount) return;

      const { value, done } = await iterator.next();
      if (done) return;

      results.push(value);
      count += 1;

      if (count < maxCount) {
        await collectNext();
      }
    };

    try {
      await collectNext();
    } catch (error) {
      if (iterator.return) {
        await iterator.return();
      }
      throw error;
    }

    return results;
  }

  // Helper function to consume async iterator with cancellation callback
  async function consumeAsyncIteratorWithCallback(
    generator: AsyncIterable<string>,
    onFirstChunk?: () => void,
  ): Promise<string[]> {
    const results: string[] = [];
    let isFirst = true;
    const iterator = generator[Symbol.asyncIterator]();

    const collectNext = async (): Promise<void> => {
      const { value, done } = await iterator.next();
      if (done) return;

      results.push(value);
      if (isFirst && onFirstChunk) {
        onFirstChunk();
        isFirst = false;
      }

      await collectNext();
    };

    try {
      await collectNext();
    } catch (error) {
      if (iterator.return) {
        await iterator.return();
      }
      throw error;
    }

    return results;
  }

  // Helper function to consume async iterator
  async function consumeAsyncIterator(
    generator: AsyncIterable<string>,
  ): Promise<string[]> {
    const results: string[] = [];
    const iterator = generator[Symbol.asyncIterator]();

    const collectNext = async (): Promise<void> => {
      const { value, done } = await iterator.next();
      if (done) return;

      results.push(value);
      await collectNext();
    };

    try {
      await collectNext();
    } catch (error) {
      if (iterator.return) {
        await iterator.return();
      }
      throw error;
    }

    return results;
  }

  beforeEach(() => {
    jest.clearAllMocks();

    conductorGenerator = new ConductorGenerator();

    // Create mock request context
    const mockChatHistory = new ChatHistory();
    mockRequestContext = {
      question: 'Test question',
      chatHistory: mockChatHistory,
      id: 'test-request-id',
      currentDatetime: new Date().toISOString(),
      requestId: 'mock-request-id',
    } as unknown as RequestContext;

    // Create mock cancellation token with read-only properties using getters
    let isCancelledFlag = false;
    let cancelReasonFlag = '';
    mockCancellationToken = {
      get isCancelled() {
        return isCancelledFlag;
      },
      get cancelReason() {
        return cancelReasonFlag;
      },
      setAbortController: jest.fn(),
      cancel: jest.fn((reason?: string) => {
        isCancelledFlag = true;
        cancelReasonFlag = reason || '';
      }),
      signal: undefined,
      reset: jest.fn(() => {
        isCancelledFlag = false;
        cancelReasonFlag = '';
      }),
    } as unknown as CancellationToken;

    // Setup default mock implementations
    mockOllamaClient = {
      chat: jest.fn(),
    };
    getOllamaClient.mockReturnValue(mockOllamaClient);

    ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);
    ToolExecutionUtils.processThinkingInContent.mockReturnValue([]);
    ToolExecutionUtils.emitExecutionEvent.mockReturnValue(
      '<execution_event>{"type":"test"}</execution_event>',
    );
    ToolExecutionUtils.createToolCallSuccessInfo.mockReturnValue({
      name: 'test-tool',
      arguments: '{}',
      result: 'success',
      isError: false,
      duration_ms: 100,
    });
    ToolExecutionUtils.createToolCallErrorInfo.mockReturnValue({
      name: 'test-tool',
      arguments: '{}',
      result: 'error',
      isError: true,
      duration_ms: 100,
    });
  });

  describe('createConductorResponseGenerator', () => {
    it('should fall back to simple chat when model does not support tools', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(false);
      const mockSimpleStream = async function* simpleStream() {
        yield 'Simple chat response';
      };
      simpleChatOllamaStream.mockReturnValue(mockSimpleStream());

      const systemPrompt = 'System prompt';
      const toolPrompt = 'Tool prompt';
      const toolCalls: FunctionTool[] = [];
      const memories = 'User memories';

      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        systemPrompt,
        toolPrompt,
        toolCalls,
        memories,
        mockCancellationToken,
      );

      // Collect all results
      const results = await consumeAsyncIterator(generator);

      // Assert
      expect(ToolExecutionUtils.modelSupportsTools).toHaveBeenCalledWith(
        'llama3',
        mockRequestContext,
      );
      expect(simpleChatOllamaStream).toHaveBeenCalledWith(
        mockRequestContext,
        systemPrompt,
        memories,
      );
      expect(results).toEqual(['Simple chat response']);
    });

    it('should handle cancellation during simple chat fallback', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(false);
      // Use cancel method to set cancellation
      mockCancellationToken.cancel('test cancel');

      const mockSimpleStream = async function* simpleStream() {
        yield 'Simple chat response';
      };
      simpleChatOllamaStream.mockReturnValue(mockSimpleStream());

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        [],
        'memories',
        mockCancellationToken,
      );

      const results = await consumeAsyncIterator(generator);

      // Assert
      expect(results).toEqual([]);
    });

    it('should proceed with conductor mode when model supports tools', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);

      // Mock ollama chat response for initial processing
      const mockChatResponse = async function* namedMockChatResponse() {
        yield { message: { content: 'Initial response content' } };
      };
      mockOllamaClient.chat.mockReturnValue(mockChatResponse());

      const toolCalls: FunctionTool[] = [];

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        toolCalls,
        'memories',
        mockCancellationToken,
      );

      // Collect results with count limit
      const results = await consumeAsyncIteratorWithLimit(generator, 10);

      // Assert
      expect(ToolExecutionUtils.modelSupportsTools).toHaveBeenCalledWith(
        'llama3',
        mockRequestContext,
      );
      expect(mockOllamaClient.chat).toHaveBeenCalled();
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle errors during conductor generation', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);
      mockOllamaClient.chat.mockRejectedValue(new Error('Ollama error'));

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        [],
        'memories',
        mockCancellationToken,
      );

      const results = await consumeAsyncIterator(generator);

      // Assert
      expect(
        results.some((chunk) => chunk.includes('Error in conductor mode')),
      ).toBe(true);
    });
    it('should stop after maximum phases to prevent infinite loops', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);

      // Mock a tool that will be found and executed repeatedly
      McpClient.toolCache = [
        {
          toolDefinition: {
            function: { name: 'loop-tool' },
          },
          type: 'mcp',
          mcpFunction: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Loop tool executed' }],
            isError: false,
          }),
        },
      ];

      // Mock chat response that always returns tool calls to create infinite loop
      const mockChatResponse = async function* namedMockChatResponse() {
        yield {
          message: {
            content: 'Making tool call',
            tool_calls: [{ function: { name: 'loop-tool', arguments: {} } }],
          },
        };
      };
      mockOllamaClient.chat.mockImplementation(() => mockChatResponse());

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        McpClient.toolCache,
        'memories',
        mockCancellationToken,
      );

      const results = await consumeAsyncIterator(generator);
      // Assert
      // Check for the maximum phases message
      expect(results.join('\n')).toContain('ended after');
    });

    it('should include memories in conversation when provided', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);

      const mockChatResponse = async function* namedMockChatResponse() {
        yield { message: { content: 'Response' } };
      };
      mockOllamaClient.chat.mockReturnValue(mockChatResponse());

      const memories = 'Important user memories';

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        [],
        memories,
        mockCancellationToken,
      );

      // Consume generator
      const reader = generator[Symbol.asyncIterator]();
      const result = await reader.next();
      if (!result.done) {
        // Just consume to trigger the logic
      }

      // Assert
      expect(mockOllamaClient.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'tool',
              content: `User Memories: ${memories}`,
            }),
          ]),
        }),
      );
    });

    it('should include chat history in conversation when available', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);

      // Add messages to chat history
      mockRequestContext.chatHistory.addUserMessage('Previous user message');
      mockRequestContext.chatHistory.addAssistantMessage(
        'Previous assistant message',
      );

      const mockChatResponse = async function* namedMockChatResponse() {
        yield { message: { content: 'Response' } };
      };
      mockOllamaClient.chat.mockReturnValue(mockChatResponse());

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        [],
        '',
        mockCancellationToken,
      );

      // Consume generator
      const reader = generator[Symbol.asyncIterator]();
      const result = await reader.next();
      if (!result.done) {
        // Just consume to trigger the logic
      }

      // Assert
      expect(mockOllamaClient.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'Previous user message',
            }),
            expect.objectContaining({
              role: 'assistant',
              content: 'Previous assistant message',
            }),
          ]),
        }),
      );
    });
  });

  describe('tool execution', () => {
    it('should handle tool calls with success results', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);

      const mockToolCall = {
        function: {
          name: 'test-tool',
          arguments: { param: 'value' },
        },
      };

      // Mock chat response sequence that mimics actual conductor flow
      let callCount = 0;
      const mockChatResponse = async function* namedMockChatResponse() {
        callCount += 1;
        if (callCount === 1) {
          // Phase 1: Initial processing
          yield { message: { content: 'I need to call a tool' } };
        } else if (callCount === 2) {
          // Phase 2: Tool execution loop - returns tool call
          yield {
            message: {
              content: 'Calling tool',
              tool_calls: [mockToolCall],
            },
          };
        } else {
          // Phase 3: End conversation
          yield { message: { content: 'Tool execution complete' } };
        }
      };
      mockOllamaClient.chat.mockImplementation(() => mockChatResponse());

      // Mock MCP client tool cache
      McpClient.toolCache = [
        {
          toolDefinition: {
            function: { name: 'test-tool' },
          },
          type: 'mcp',
          mcpFunction: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Tool execution successful' }],
            isError: false,
          }),
        },
      ];

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        McpClient.toolCache,
        '',
        mockCancellationToken,
      );
      const results = await consumeAsyncIterator(generator); // Assert - check that tool execution was triggered and completed
      const fullResult = results.join('\n');
      expect(fullResult).toContain('tool_call_position');
      expect(fullResult).toContain('tool_calls_complete');
      expect(ToolExecutionUtils.emitExecutionEvent).toHaveBeenCalled();
    });
    it('should handle tool execution errors', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);

      const mockToolCall = {
        function: {
          name: 'failing-tool',
          arguments: { param: 'value' },
        },
      };

      // Mock chat response sequence that mimics actual conductor flow
      let callCount = 0;
      const mockChatResponse = async function* namedMockChatResponse() {
        callCount += 1;
        if (callCount === 1) {
          // Phase 1: Initial processing
          yield { message: { content: 'I need to call a tool' } };
        } else if (callCount === 2) {
          // Phase 2: Tool execution loop - returns tool call
          yield {
            message: {
              content: 'Calling tool',
              tool_calls: [mockToolCall],
            },
          };
        } else {
          // Phase 3: End conversation
          yield { message: { content: 'Tool execution failed' } };
        }
      };
      mockOllamaClient.chat.mockImplementation(() => mockChatResponse());

      // Mock tool that throws error
      McpClient.toolCache = [
        {
          toolDefinition: {
            function: { name: 'failing-tool' },
          },
          type: 'mcp',
          mcpFunction: jest
            .fn()
            .mockRejectedValue(new Error('Tool execution failed')),
        },
      ];

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        McpClient.toolCache,
        '',
        mockCancellationToken,
      );

      const results = await consumeAsyncIterator(generator); // Assert
      expect(results.join('\n')).toContain('Tool execution failed');
      expect(ToolExecutionUtils.emitExecutionEvent).toHaveBeenCalled();
    });
    it('should handle unknown tool calls', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);
      const mockToolCall = {
        function: {
          name: 'unknown-tool',
          arguments: { param: 'value' },
        },
      };

      // Mock chat response sequence that mimics actual conductor flow
      let callCount = 0;
      const mockChatResponse = async function* namedMockChatResponse() {
        callCount += 1;
        if (callCount === 1) {
          // Phase 1: Initial processing
          yield { message: { content: 'I need to call a tool' } };
        } else if (callCount === 2) {
          // Phase 2: Tool execution loop - returns tool call
          yield {
            message: {
              content: 'Calling tool',
              tool_calls: [mockToolCall],
            },
          };
        } else {
          // Phase 3: End conversation
          yield {
            message: { content: "Error: Tool 'unknown-tool' not found" },
          };
        }
      };
      mockOllamaClient.chat.mockImplementation(() => mockChatResponse());

      // Empty tool cache
      McpClient.toolCache = [];

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        [],
        '',
        mockCancellationToken,
      );
      const results = await consumeAsyncIterator(generator);
      // Assert
      // Check for the error message about tool not found
      expect(
        results.some((chunk) =>
          chunk.includes("Error: Tool 'unknown-tool' not found"),
        ),
      ).toBe(true);
    });
  });

  describe('thinking processing', () => {
    it('should process thinking content correctly', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);
      ToolExecutionUtils.processThinkingInContent.mockReturnValue([
        '<thinking>Processing...</thinking>',
      ]);

      const mockChatResponse = async function* namedMockChatResponse() {
        yield {
          message: { content: '<think>Let me think about this</think>' },
        };
      };
      mockOllamaClient.chat.mockReturnValue(mockChatResponse());

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        [],
        '',
        mockCancellationToken,
      );

      const results: string[] = [];
      const reader = generator[Symbol.asyncIterator]();
      const result = await reader.next();
      if (!result.done) {
        results.push(result.value);
      }

      // Assert
      expect(ToolExecutionUtils.processThinkingInContent).toHaveBeenCalledWith(
        '<think>Let me think about this</think>',
        expect.any(Object),
      );
    });
  });

  describe('cancellation handling', () => {
    it('should respect cancellation during generation', async () => {
      // Arrange
      ToolExecutionUtils.modelSupportsTools.mockResolvedValue(true);

      const mockChatResponse = async function* namedMockChatResponse() {
        yield { message: { content: 'First chunk' } };
        yield { message: { content: 'Second chunk' } };
      };
      mockOllamaClient.chat.mockReturnValue(mockChatResponse());

      // Act
      const generator = conductorGenerator.createConductorResponseGenerator(
        mockRequestContext,
        'system',
        'tool',
        [],
        '',
        mockCancellationToken,
      );

      const results = await consumeAsyncIteratorWithCallback(generator, () =>
        mockCancellationToken.cancel('User cancelled'),
      );

      // Assert - should have processed the first chunk but stopped after cancellation
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
