import { RequestContext, TraceLogger } from './logger';
import { formatDateTime } from './datetime_parser';
import { queryOllamaWithTools, queryOllamaWithToolsStream, simpleChatOllamaStream } from './ollama_client';
import { createChatPrompt, createQueryWithToolsPrompt, createQueryWithToolResponsePrompt } from './prompt_templates';
import { searchMemories } from './memory';
import { FunctionTool } from './ollama_tools';
import { Message } from 'ollama';
import  { ChatHistory } from './chat_history';
import { McpClient } from './connectors/mcp_client';
import { CancellationToken, globalCancellationToken } from './utils/cancellation';

class QueryEngine {
  /**
   * V1 RAT | RAG query pipeline
   * @param requestContext 
   * @returns 
   */
  async processRagRatQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    // Perform initial query with tool descriptions
    const memories = await searchMemories(requestContext.question)
    if (cancellationToken.isCancelled) {
      return this.emptyCancelledStream(cancellationToken);
    }
    TraceLogger.trace(requestContext, 'processRagRatQuery-question', requestContext.question);
    TraceLogger.trace(requestContext, 'processRagRatQuery-memories_retrieved', memories);
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
    const capturedToolCalls: Array<{name: string, arguments: string, result: string, isError?: boolean}> = [];

    // Handle tool calls
    // All tool results are fed back to the AI for context
    for (const toolCall of response.message.tool_calls) {
      if (cancellationToken.isCancelled) {
        TraceLogger.trace(requestContext, 'tool_execution_cancelled', 
          'Tool execution cancelled by user request');
        break;
      }
      
      const toolName = toolCall.function.name;
      const tool = toolCalls.find((tool) => tool.toolDefinition.function.name === toolName);
      if (!tool) {
        continue
      }

      if (tool.type === "mcp") {
        const toolResponse = await tool.mcpFunction(requestContext, toolCall);

        // Capture tool call information for UI display
        const toolCallInfo = {
          name: toolName,
          arguments: JSON.stringify(toolCall.function.arguments, null, 2),
          result: '',
          isError: false
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

    // create tool prompts for the final query
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
   * Streaming version of processRagRatQuery - streams content and tool execution in real-time
   */
  async processRagRatQueryStream(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    // Perform initial query with tool descriptions
    const memories = await searchMemories(requestContext.question)
    if (cancellationToken.isCancelled) {
      return this.emptyCancelledStream(cancellationToken);
    }
    
    TraceLogger.trace(requestContext, 'processRagRatQueryStream-question', requestContext.question);
    TraceLogger.trace(requestContext, 'processRagRatQueryStream-memories_retrieved', memories);
    const toolUseSystemPrompt = createQueryWithToolsPrompt(formatDateTime(requestContext.currentDatetime).toString());
    
    // Get the streaming response
    const streamingResponse = queryOllamaWithToolsStream(requestContext, toolUseSystemPrompt, toolCalls, memories);
    
    if (cancellationToken.isCancelled) {
      return this.emptyCancelledStream(cancellationToken);
    }
    
    return this.createToolStreamingGenerator(requestContext, streamingResponse, toolCalls, memories, cancellationToken);
  }
  
  /**
   * Create a generator that processes the streaming response and executes tools in real-time
   */
  private async *createToolStreamingGenerator(
    requestContext: RequestContext,
    streamingResponse: AsyncGenerator<string>,
    toolCalls: FunctionTool[],
    memories: string,
    cancellationToken: CancellationToken
  ): AsyncGenerator<string> {
    
    let detectedToolCalls: any[] = [];
    let hasContent = false;
    
    try {
      for await (const chunk of streamingResponse) {
        if (cancellationToken.isCancelled) {
          return;
        }
        
        // Check for tool call detection
        if (chunk.includes('<tool_calls_detected>')) {
          const match = chunk.match(/<tool_calls_detected>(.*?)<\/tool_calls_detected>/s);
          if (match) {
            try {
              const newToolCalls = JSON.parse(match[1]);
              detectedToolCalls.push(...newToolCalls);
              
              // Show "Executing..." status immediately using UPDATE format
              const executingToolCalls = newToolCalls.map(toolCall => ({
                name: toolCall.function.name,
                arguments: JSON.stringify(toolCall.function.arguments, null, 2),
                result: 'Executing...',
                isExecuting: true
              }));
              
              // Use UPDATE format instead of replacing
              yield `<tool_calls_update>${JSON.stringify(executingToolCalls)}</tool_calls_update>`;
              
            } catch (error) {
              console.error('Failed to parse detected tool calls:', error);
            }
            // Don't yield the tool detection tags to the user
            continue;
          }
        }
        
        // Check for tool call completion signal
        if (chunk.includes('<tool_calls_complete>')) {
          // Don't yield completion tags to user
          continue;
        }
        
        // Yield regular content
        if (chunk.trim()) {
          hasContent = true;
          yield chunk;
        }
      }
      
      // After streaming content, execute tools if any were detected
      if (detectedToolCalls.length > 0) {
        const toolMessages: Message[] = [];
        const capturedToolCalls: Array<{name: string, arguments: string, result: string, isError?: boolean}> = [];
        
        // Execute tools (like original approach)
        for (const toolCall of detectedToolCalls) {
          if (cancellationToken.isCancelled) {
            break;
          }
          
          const toolName = toolCall.function.name;
          const toolArguments = JSON.stringify(toolCall.function.arguments, null, 2);
          
          TraceLogger.trace(requestContext, `tool-execution-start`, `Starting execution of tool: ${toolName}`);
          
          const tool = toolCalls.find((tool) => tool.toolDefinition.function.name === toolName);
          
          // Handle non-existent tools
          if (!tool || tool.type !== "mcp") {
            const errorMessage = `Tool '${toolName}' not found in available tools`;
            TraceLogger.trace(requestContext, `tool-execution-error`, errorMessage);
            
            const toolCallInfo = {
              name: toolName,
              arguments: toolArguments,
              result: errorMessage,
              isError: true
            };
            
            capturedToolCalls.push(toolCallInfo);
            
            // Add error message for AI context
            toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, `Error: ${errorMessage}`) });
            
            // Send completion event immediately for non-existent tool
            yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
            
            continue;
          }
          
          try {
            const toolResponse = await tool.mcpFunction(requestContext, toolCall);
            TraceLogger.trace(requestContext, `tool-execution-success`, `Tool ${toolName} completed successfully`);
            
            const toolCallInfo = {
              name: toolName,
              arguments: toolArguments,
              result: '',
              isError: false
            };
            
            if (toolResponse.isError) {
              toolCallInfo.isError = true;
              toolCallInfo.result = toolResponse.content?.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('') || 'Tool call failed';
              toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, `Error: ${toolCallInfo.result}`) });
              TraceLogger.trace(requestContext, `tool-execution-error`, `Tool ${toolName} failed: ${toolCallInfo.result}`);
            } else if (!toolResponse.content || toolResponse.content.length === 0) {
              toolCallInfo.result = 'Tool executed successfully (no content returned)';
              toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, toolCallInfo.result) });
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
            }
            
            capturedToolCalls.push(toolCallInfo);
            
            // Send completion event for successful tool
            yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
            
          } catch (error: any) {
            const errorMessage = `Tool execution failed: ${error.message || String(error)}`;
            TraceLogger.trace(requestContext, `tool-execution-error`, `Tool ${toolName} threw error: ${errorMessage}`);
            
            const toolCallInfo = {
              name: toolName,
              arguments: toolArguments,
              result: errorMessage,
              isError: true
            };
            
            capturedToolCalls.push(toolCallInfo);
            
            // Send completion event for failed tool
            yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
          }
        }
        
        // Generate final response with tool context (like original)
        if (toolMessages.length > 0) {
          const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
          const toolCallsMetadata = `<tool_calls>${JSON.stringify(capturedToolCalls)}</tool_calls>`;
          
          const finalResponseStream = simpleChatOllamaStream(requestContext, chatSystemPrompt, memories, toolMessages);
          
          // Use original wrappedStreamWithToolCalls approach - sends final tool block
          const wrappedStream = this.wrappedStreamWithToolCalls(finalResponseStream, cancellationToken, toolCallsMetadata);
          
          for await (const content of wrappedStream) {
            if (cancellationToken.isCancelled) {
              return;
            }
            yield content;
          }
          return;
        }
      }
      
      // Fallback if no content and no tools
      if (!hasContent && detectedToolCalls.length === 0) {
        TraceLogger.trace(requestContext, 'processRagRatQueryStream', 'no content or tools, falling back to simple chat');
        const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
        const fallbackStream = simpleChatOllamaStream(requestContext, chatSystemPrompt, memories);
        
        for await (const content of fallbackStream) {
          if (cancellationToken.isCancelled) {
            return;
          }
          yield content;
        }
      }
      
    } catch (error) {
      console.error('Error in tool streaming generator:', error);
      yield `\nError processing response: ${error.message}`;
    }
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
    chatMode: 'CHAT' | 'CONTEXT_AWARE' | 'CONTEXT_AWARE_STREAM' = 'CHAT',
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'user_chat_history', requestContext.chatHistory.toString());
    TraceLogger.trace(requestContext, 'user_question', requestContext.question);
    TraceLogger.trace(requestContext, 'current_date', formatDateTime(requestContext.currentDatetime));

    if (chatMode === 'CONTEXT_AWARE') {
      const toolCalls: FunctionTool[] = McpClient.toolCache;
      return this.processRagRatQueryStream(requestContext, toolCalls, cancellationToken);
    }
    
    if (chatMode === 'CONTEXT_AWARE_STREAM') {
      const toolCalls: FunctionTool[] = McpClient.toolCache;
      return this.processRagRatQueryStream(requestContext, toolCalls, cancellationToken);
    }

    return this.processChatQuery(requestContext, cancellationToken);
  }
}

const queryEngineInstance = new QueryEngine();

// TODO: replace this with actual tests
if (require.main === module) {
  (async () => {
    const chatMode = 'CONTEXT_AWARE';
    const requestContext: RequestContext = {
      currentDatetime: new Date(),
      chatHistory: new ChatHistory(),
      question: 'Why is the sky blue?',
      requestId: "test-request-id",
    };
    const stream = await queryEngineInstance.query(requestContext, chatMode);
    if (!stream) {
      process.exit(1);
    }
    // eslint-disable-next-line no-restricted-syntax
    let output = "";
    let isFirstToken = true;
    for await (const chunk of stream) {
      if (isFirstToken) {
        output += chunk;
        isFirstToken = false;
        TraceLogger.trace(requestContext, 'response_to_user_ttft', output);
      } else {
        output += chunk;
      }
    }
    TraceLogger.trace(requestContext, 'response_to_user_complete', output);
  })();
}

export { QueryEngine, queryEngineInstance };

