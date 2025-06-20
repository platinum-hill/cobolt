import { RequestContext, TraceLogger } from './logger';
import { formatDateTime } from './datetime_parser';
import { simpleChatOllamaStream, queryOllamaWithTools } from './ollama_client';

import { createChatPrompt, createQueryWithToolsPrompt, createQueryWithToolResponsePrompt } from './prompt_templates';
import { searchMemories } from './memory';
import { FunctionTool } from './ollama_tools';
import { Message } from 'ollama';
import  { ChatHistory } from './chat_history';
import { McpClient } from './connectors/mcp_client';
import { CancellationToken, globalCancellationToken } from './utils/cancellation';

interface ExecutionEvent {
  type: 'tool_start' | 'tool_complete' | 'thinking_start' | 'thinking_complete';
  id: string;
  name?: string;
  duration_ms?: number;
  isError?: boolean;
}

class QueryEngine {
  // Global set to prevent duplicate tool executions across query sessions
  private globalExecutedToolIds = new Map<string, Set<string>>();
  
  /**
   * Clear executed tool tracking for a specific request or all requests
   */
  public clearExecutedTools(requestId?: string): void {
    if (requestId) {
      this.globalExecutedToolIds.delete(requestId);
    } else {
      this.globalExecutedToolIds.clear();
    }
  }
  
  private createToolCallErrorInfo(toolName: string, toolArguments: string, errorMessage: string, duration_ms: number) {
    return {
      name: toolName,
      arguments: toolArguments,
      result: errorMessage,
      isError: true,
      duration_ms
    };
  }
  
  private createToolCallSuccessInfo(toolName: string, toolArguments: string, resultText: string, duration_ms: number, isError: boolean) {
    return {
      name: toolName,
      arguments: toolArguments,
      result: resultText,
      isError: isError,
      duration_ms
    };
  }

  private emitExecutionEvent(event: ExecutionEvent): string {
    return `<execution_event>${JSON.stringify(event)}</execution_event>`;
  }

  private processThinkingInContent(content: string, thinkingState: {id?: string, startTime?: number}): string[] {
    const events: string[] = [];
    
    if (content.includes('<think>') && !thinkingState.id) {
      thinkingState.id = `thinking-${Date.now()}`;
      thinkingState.startTime = Date.now();
      events.push(this.emitExecutionEvent({type: 'thinking_start', id: thinkingState.id}));
    }
    
    if (content.includes('</think>') && thinkingState.id && thinkingState.startTime) {
      const duration_ms = Date.now() - thinkingState.startTime;
      events.push(this.emitExecutionEvent({type: 'thinking_complete', id: thinkingState.id, duration_ms}));
      thinkingState.id = undefined;
      thinkingState.startTime = undefined;
    }
    
    return events;
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

  /**
   * V1 RAT | RAG query pipeline - Restored original team architecture with streaming improvements
   * Phase 1: Use TOOLS_MODEL to determine which tools to call
   * Phase 2: Execute tools and stream final response with CHAT_MODEL
   */
  async processRagRatQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    // Perform initial query with tool descriptions using dedicated TOOLS_MODEL
    const memories = await searchMemories(requestContext.question)
    if (cancellationToken.isCancelled) {
      return this.emptyCancelledStream(cancellationToken);
    }
    TraceLogger.trace(requestContext, 'processRagRatQuery-question', requestContext.question);
    TraceLogger.trace(requestContext, 'processRagRatQuery-memories_retrieved', memories);
    
    // Phase 1: Use TOOLS_MODEL with specialized prompt for tool selection
    const toolUseSystemPrompt = createQueryWithToolsPrompt(formatDateTime(requestContext.currentDatetime).toString());
    const response = await queryOllamaWithTools(requestContext, toolUseSystemPrompt, toolCalls, memories);
    if (cancellationToken.isCancelled) {
      return this.emptyCancelledStream(cancellationToken);
    }
    
    // if there are no tool calls, 
    // return a simple chat response based on the original prompt
    if (!response.message.tool_calls) {
      TraceLogger.trace(requestContext, 'processRagRatQuery', 'no tool calls requested');
      const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
      return this.wrappedStream(
        simpleChatOllamaStream(requestContext, chatSystemPrompt, memories),
        cancellationToken);
    }
    
    const toolMessages: Message[] = [];
    const capturedToolCalls: Array<{name: string, arguments: string, result: string, isError?: boolean, duration_ms?: number}> = [];

    // Handle tool calls with improved error handling and metadata
    // All tool results are fed back to the AI for context
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
        continue
      }

      if (tool.type === "mcp") {
        try {
          const toolResponse = await tool.mcpFunction(requestContext, toolCall);
          const duration_ms = Date.now() - toolStartTime;

          // Capture tool call information for UI display
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
            // ALWAYS add tool message for AI feedback, even on error
            toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, `Error: ${toolCallInfo.result}`) });
            capturedToolCalls.push(toolCallInfo);
            TraceLogger.trace(requestContext, `processRagRatQuery-${toolName}`, `tool call failed`);
          } else if (!toolResponse.content || toolResponse.content.length === 0) {
            toolCallInfo.result = 'Tool executed successfully (no content returned)';
            // ALWAYS add tool message for AI feedback
            toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, toolCallInfo.result) });
            capturedToolCalls.push(toolCallInfo);
            TraceLogger.trace(requestContext, `processRagRatQuery-${toolName}`, `tool call completed with no content`);
          } else {
            // Process ALL content types, not just text
            let resultText = '';
            for (const item of toolResponse.content) {
              if (item.type === "text") {
                resultText += item.text as string;
              } else {
                // Convert non-text content to string for AI feedback
                resultText += JSON.stringify(item);
              }
            }
            
            toolCallInfo.result = resultText || 'Tool executed successfully';
            // ALWAYS add tool message for AI feedback
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
          
          // Add error to conversation
          toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, `Error: ${errorMessage}`) });
          capturedToolCalls.push(toolCallInfo);
          TraceLogger.trace(requestContext, `processRagRatQuery-${toolName}`, `tool call failed with exception`);
        }
      }
    }

    // If no tool messages were generated
    // fall back to simple chat without tool context
    if (toolMessages.length === 0) {
      TraceLogger.trace(requestContext, 'processRagRatQuery', 'no tool messages generated (unexpected)');
      const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
      // Include our tool calls metadata for transparency
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
    
    // Create tool calls metadata for frontend
    const toolCallsMetadata = capturedToolCalls.length > 0 ? 
      `<tool_calls>${JSON.stringify(capturedToolCalls)}</tool_calls>` : '';
    
    // Wrap the stream to include tool calls metadata at the beginning
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
          TraceLogger.trace({ requestId: "cancelled", currentDatetime: new Date(), question: "", chatHistory: new ChatHistory() }, 
            'stream_cancelled', 'User cancelled the request');
          break;
        }
        yield chunk;
      }
    } finally {
      // Ensure we don't leave the token in cancelled state
      cancellationToken.reset();
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
          TraceLogger.trace({ requestId: "cancelled", currentDatetime: new Date(), question: "", chatHistory: new ChatHistory() }, 
            'stream_cancelled', 'User cancelled the request');
          break;
        }
        
        // Prepend tool calls metadata to the first chunk if we have tool calls
        if (isFirstChunk && toolCallsMetadata) {
          yield toolCallsMetadata + chunk;
          isFirstChunk = false;
        } else {
          yield chunk;
        }
      }
    } finally {
      // Ensure we don't leave the token in cancelled state
      cancellationToken.reset();
    }
  }

  private async *emptyCancelledStream(cancellationToken: CancellationToken): AsyncGenerator<string> {
    // We still need to reset the token
    try {
      yield "Operation cancelled";
    } finally {
      cancellationToken.reset();
    }
  }

  async query(
    requestContext: RequestContext,
    chatMode: 'CHAT' | 'CONTEXT_AWARE' = 'CHAT',
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'user_chat_history', requestContext.chatHistory.toString());
    TraceLogger.trace(requestContext, 'user_question', requestContext.question);
    TraceLogger.trace(requestContext, 'current_date', formatDateTime(requestContext.currentDatetime));
    
    if (chatMode === 'CONTEXT_AWARE') {
      const toolCalls: FunctionTool[] = McpClient.toolCache;
      return this.processRagRatQuery(requestContext, toolCalls, cancellationToken);
    }

    return this.processChatQuery(requestContext, cancellationToken);
  }
}

const queryEngineInstance = new QueryEngine();

export { QueryEngine, queryEngineInstance };
