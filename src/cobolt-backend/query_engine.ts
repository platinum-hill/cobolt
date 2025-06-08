import { RequestContext, TraceLogger } from './logger';
import { formatDateTime } from './datetime_parser';
import { simpleChatOllamaStream } from './simple_ollama_stream';
import { queryOllamaWithTools } from './ollama_client';
import { createChatPrompt, createQueryWithToolsPrompt, createQueryWithToolResponsePrompt } from './prompt_templates';
import { searchMemories } from './memory';
import { FunctionTool } from './ollama_tools';
import { Message } from 'ollama';
import { McpClient } from './connectors/mcp_client';
import { CancellationToken, globalCancellationToken } from './utils/cancellation';
import { ConductorGenerator } from './generators/conductor_generator';
import { SequentialGenerator } from './generators/sequential_generator';

class QueryEngine {
  private conductorGenerator: ConductorGenerator;
  private sequentialGenerator: SequentialGenerator;
  
  constructor() {
    this.conductorGenerator = new ConductorGenerator();
    this.sequentialGenerator = new SequentialGenerator();
  }
  
  /**
   * Clear executed tool tracking for a specific request or all requests
   */
  public clearExecutedTools(requestId?: string): void {
    this.sequentialGenerator.clearExecutedTools(requestId);
  }

  /**
   * Check if conductor mode is enabled
   */
  private async isConductorModeEnabled(): Promise<boolean> {
    // Import here to avoid circular dependency
    const { default: appMetadata } = await import('./data_models/app_metadata');
    return appMetadata.getConductorEnabled();
  }

  async processConductorQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    // Get RAG memories
    const memories = await searchMemories(requestContext.question);
    TraceLogger.trace(requestContext, 'conductor_relevant_memories', memories);
    
    // Use chat prompt
    const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
    
    return this.conductorGenerator.createConductorResponseGenerator(
      requestContext, 
      chatSystemPrompt,
      toolCalls, 
      memories, 
      cancellationToken
    );
  }

  async processChatQuery(
    requestContext: RequestContext,
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    const relevantMemories = await searchMemories(requestContext.question);
    TraceLogger.trace(requestContext, 'chat_relevant_memories', relevantMemories);
    const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
    TraceLogger.trace(requestContext, 'processChatQuery', chatSystemPrompt);

    return this.wrappedStream(
      simpleChatOllamaStream(requestContext, chatSystemPrompt, relevantMemories),
      cancellationToken
    );
  }

  async processRagRatQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    // Check if conductor mode is enabled
    const conductorEnabled = await this.isConductorModeEnabled();
    
    if (conductorEnabled) {
      // Use conductor flow instead of regular RAG
      return this.processConductorQuery(requestContext, toolCalls, cancellationToken);
    }
    
    // Use original team's two-phase architecture (restored)
    return this.processOriginalRagRatQuery(requestContext, toolCalls, cancellationToken);
  }

  /**
   * V1 RAT | RAG query pipeline - Restored original team architecture 
   * Phase 1: Use TOOLS_MODEL to determine which tools to call
   * Phase 2: Execute tools and stream final response with CHAT_MODEL
   */
  async processOriginalRagRatQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    // Perform initial query with tool descriptions using dedicated TOOLS_MODEL
    const memories = await searchMemories(requestContext.question);
    if (cancellationToken.isCancelled) {
      return this.emptyCancelledStream();
    }
    TraceLogger.trace(requestContext, 'processRagRatQuery-question', requestContext.question);
    TraceLogger.trace(requestContext, 'processRagRatQuery-memories_retrieved', memories);
    
    // Phase 1: Use TOOLS_MODEL with specialized prompt for tool selection
    const toolUseSystemPrompt = createQueryWithToolsPrompt(formatDateTime(requestContext.currentDatetime).toString());
    const response = await queryOllamaWithTools(requestContext, toolUseSystemPrompt, toolCalls, memories);
    if (cancellationToken.isCancelled) {
      return this.emptyCancelledStream();
    }
    
    // If there are no tool calls, return a simple chat response
    if (!response.message.tool_calls) {
      TraceLogger.trace(requestContext, 'processRagRatQuery', 'no tool calls requested');
      const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
      return this.wrappedStream(
        simpleChatOllamaStream(requestContext, chatSystemPrompt, memories),
        cancellationToken
      );
    }
    
    const toolMessages: Message[] = [];
    const capturedToolCalls: Array<{name: string, arguments: string, result: string, isError?: boolean, duration_ms?: number}> = [];

    // Handle tool calls with improved error handling and metadata
    for (const toolCall of response.message.tool_calls) {
      if (cancellationToken.isCancelled) {
        TraceLogger.trace(requestContext, 'tool_execution_cancelled', 
          'Tool execution cancelled by user request');
        break;
      }
      
      const toolName = toolCall.function.name;
      const toolArguments = JSON.stringify(toolCall.function.arguments, null, 2);
      const toolStartTime = Date.now();
      const tool = toolCalls.find((tool) => tool.toolDefinition.function.name === toolName);
      
      if (!tool) {
        continue;
      }

      if (tool.type === "mcp") {
        try {
          const toolResponse = await tool.mcpFunction(requestContext, toolCall);
          const duration_ms = Date.now() - toolStartTime;

          const toolCallInfo = {
            name: toolName,
            arguments: toolArguments,
            result: '',
            isError: false,
            duration_ms
          };

          if (toolResponse.isError) {
            toolCallInfo.isError = true;
            toolCallInfo.result = toolResponse.content?.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('') || 'Tool call failed';
            toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, `Error: ${toolCallInfo.result}`) });
            capturedToolCalls.push(toolCallInfo);
            TraceLogger.trace(requestContext, `processRagRatQuery-${toolName}`, `tool call failed`);
          } else if (!toolResponse.content || toolResponse.content.length === 0) {
            toolCallInfo.result = 'Tool executed successfully (no content returned)';
            toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, toolCallInfo.result) });
            capturedToolCalls.push(toolCallInfo);
            TraceLogger.trace(requestContext, `processRagRatQuery-${toolName}`, `tool call completed with no content`);
          } else {
            let resultText = '';
            for (const item of toolResponse.content) {
              if (item.type === "text") {
                resultText += item.text as string;
              } else {
                resultText += JSON.stringify(item);
              }
            }
            
            toolCallInfo.result = resultText || 'Tool executed successfully';
            toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, toolCallInfo.result) });
            capturedToolCalls.push(toolCallInfo);
            TraceLogger.trace(requestContext, `processRagRatQuery-${toolName}`, `tool call completed successfully`);
          }
        } catch (error: any) {
          const duration_ms = Date.now() - toolStartTime;
          const errorMessage = `Tool execution failed: ${error.message || String(error)}`;
          
          const toolCallInfo = {
            name: toolName,
            arguments: toolArguments,
            result: errorMessage,
            isError: true,
            duration_ms
          };
          
          toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, `Error: ${errorMessage}`) });
          capturedToolCalls.push(toolCallInfo);
          TraceLogger.trace(requestContext, `processRagRatQuery-${toolName}`, `tool call failed with exception`);
        }
      }
    }

    // If no tool messages were generated, fall back to simple chat
    if (toolMessages.length === 0) {
      TraceLogger.trace(requestContext, 'processRagRatQuery', 'no tool messages generated (unexpected)');
      const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
      const toolCallsMetadata = capturedToolCalls.length > 0 ? 
        `<tool_calls>${JSON.stringify(capturedToolCalls)}</tool_calls>` : '';
      return this.wrappedStreamWithToolCalls(
        simpleChatOllamaStream(requestContext, chatSystemPrompt, memories),
        cancellationToken,
        toolCallsMetadata
      );
    }

    // Phase 2: Create final response using CHAT_MODEL with tool results
    const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
    
    const toolCallsMetadata = capturedToolCalls.length > 0 ? 
      `<tool_calls>${JSON.stringify(capturedToolCalls)}</tool_calls>` : '';
    
    return this.wrappedStreamWithToolCalls(
      simpleChatOllamaStream(requestContext, chatSystemPrompt, memories, toolMessages),
      cancellationToken,
      toolCallsMetadata
    );
  }

  /**
   * Wrap a stream generator with cancellation check
   */
  private async *wrappedStream(
    stream: AsyncGenerator<string>,
    cancellationToken: CancellationToken
  ): AsyncGenerator<string> {
    try {
      for await (const chunk of stream) {
        if (cancellationToken.isCancelled) {
          return;
        }
        yield chunk;
      }
    } catch (error) {
      console.error('Error in wrapped stream:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield `\nError in stream: ${errorMessage}`;
    }
  }
  /**
   * Wrap a stream generator with cancellation check and tool calls metadata
   */
  private async *wrappedStreamWithToolCalls(
    stream: AsyncGenerator<string>,
    cancellationToken: CancellationToken,
    toolCallsMetadata: string
  ): AsyncGenerator<string> {
    try {
      let isFirstChunk = true;
      for await (const chunk of stream) {
        if (cancellationToken.isCancelled) {
          return;
        }
        
        if (isFirstChunk && toolCallsMetadata) {
          yield toolCallsMetadata + chunk;
          isFirstChunk = false;
        } else {
          yield chunk;
        }
      }
    } catch (error) {
      console.error('Error in wrapped stream with tool calls:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield `\nError in stream: ${errorMessage}`;
    }
  }

  private async *emptyCancelledStream(): AsyncGenerator<string> {
    try {
      yield "Operation cancelled";
    } finally {
      // Reset is handled by the wrapping functions
    }
  }

  async query(
    requestContext: RequestContext,
    chatMode: 'CHAT' | 'CONTEXT_AWARE' | 'CONDUCTOR' = 'CHAT',
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'user_chat_history', requestContext.chatHistory.toString());
    TraceLogger.trace(requestContext, 'user_question', requestContext.question);
    TraceLogger.trace(requestContext, 'current_date', formatDateTime(requestContext.currentDatetime));
    
    if (chatMode === 'CONTEXT_AWARE' || chatMode === 'CONDUCTOR') {
      const toolCalls: FunctionTool[] = McpClient.toolCache;
      return this.processRagRatQuery(requestContext, toolCalls, cancellationToken);
    }

    return this.processChatQuery(requestContext, cancellationToken);
  }
}

export const queryEngineInstance = new QueryEngine();
export { QueryEngine };