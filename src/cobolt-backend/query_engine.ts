import { RequestContext, TraceLogger } from './logger';
import { formatDateTime } from './datetime_parser';
import { simpleChatOllamaStream, getOllamaClient } from './ollama_client';
import { MODELS } from './model_manager';
import { createChatPrompt, createQueryWithToolResponsePrompt } from './prompt_templates';
import { searchMemories, addToMemory } from './memory';
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
   * Sequential response with inline tool calling
   * This allows tools to be called dynamically during the response
   */
  async processRagRatQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    // Get RAG memories like before
    const memories = await searchMemories(requestContext.question);
    TraceLogger.trace(requestContext, 'chat_relevant_memories', memories);
    
    // Use chat prompt (not tool planning prompt)
    const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
    
    return this.createSequentialResponseGenerator(
      requestContext, 
      chatSystemPrompt,
      toolCalls, 
      memories, 
      cancellationToken
    );
  }

  /**
   * Creates a generator for sequential inline tool calling response
   */
  private async *createSequentialResponseGenerator(
    requestContext: RequestContext,
    systemPrompt: string,
    toolCalls: FunctionTool[],
    memories: string,
    cancellationToken: CancellationToken
  ): AsyncGenerator<string> {
    
    // Build conversation messages
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
    ];
    
    if (memories) {
      messages.push({ role: 'tool', content: 'User Memories: ' + memories });
    }
    
    if (requestContext.chatHistory.length > 0) {
      requestContext.chatHistory.toOllamaMessages().forEach((message) => {
        messages.push(message);
      });
    }
    
    messages.push({ role: 'user', content: requestContext.question });
    
    try {
      const conversationMessages = [...messages];
      let conversationComplete = false;
      
      while (!conversationComplete && !cancellationToken.isCancelled) {
        TraceLogger.trace(requestContext, 'single-conversation-round', `Starting conversation round with ${conversationMessages.length} messages`);
        
        // Get ollama client and constants
        const ollama = getOllamaClient();
        const defaultTemperature = 1.0;
        const defaultTopK = 64;
        const defaultTopP = 0.95;
        
        // Try to start conversation with tools enabled first
        let response;
        try {
          response = await ollama.chat({
            model: MODELS.CHAT_MODEL, // Use chat model, not tools model
            messages: conversationMessages,
            tools: toolCalls.map((toolCall) => toolCall.toolDefinition),
            keep_alive: -1,
            options: {
              temperature: defaultTemperature,
              top_k: defaultTopK,
              top_p: defaultTopP,
              num_ctx: MODELS.CHAT_MODEL_CONTEXT_LENGTH,
            },
            stream: true,
          });
        } catch (toolsError: any) {
          // Check if the error is due to model not supporting tools
          const errorMessage = toolsError.message || String(toolsError);
          if (errorMessage.includes('does not support tools')) {
            TraceLogger.trace(requestContext, 'model-tools-fallback', `Model ${MODELS.CHAT_MODEL} does not support tools, falling back to simple chat`);
            
            // Fall back to simple chat without tools
            const simpleChatStream = simpleChatOllamaStream(requestContext, systemPrompt, memories);
            
            // Stream the response directly from simple chat
            for await (const content of simpleChatStream) {
              if (cancellationToken.isCancelled) {
                return;
              }
              yield content;
            }
            
            // Exit early since we've handled the response
            return;
          } else {
            // Re-throw if it's a different error
            throw toolsError;
          }
        }
        
        let assistantContent = '';
        const detectedToolCalls: any[] = [];
        const thinkingState: {id?: string, startTime?: number} = {};
        
        // Track streaming tool call state
        const activeStreamingTools = new Map<string, {
          name: string;
          arguments: string;
          toolId: string;
          isComplete: boolean;
        }>();
        const executedToolIds = new Set<string>();
        
        // Stream response and build tool calls incrementally
        for await (const part of response) {
          if (cancellationToken.isCancelled) {
            return;
          }
          
          // Log EVERY content chunk to see if tool calls appear in content
          if (part.message.content) {
            // Log every single character to see what we're missing
            console.log('🔍 CONTENT:', JSON.stringify(part.message.content));
            
            // Process thinking events first
            const thinkingEvents = this.processThinkingInContent(part.message.content, thinkingState);
            for (const thinkingEvent of thinkingEvents) {
              yield thinkingEvent;
            }
            
            assistantContent += part.message.content;
            yield part.message.content;
          }
          
          // Log when content is empty but tool_calls appear
          if (!part.message.content && part.message.tool_calls) {
            console.log('🚨 TOOL CALLS APPEARED WITH NO CONTENT!');
          }
          
          // Log when we get official tool calls
          if (part.message.tool_calls) {
            console.log('Official tool calls received - should match our streaming parsing');
          }
          
          // IMMEDIATE tool execution when tool calls appear in stream
          if (part.message.tool_calls && part.message.tool_calls.length > 0) {
            console.log('✅ COMPLETE tool calls received:', JSON.stringify(part.message.tool_calls, null, 2));
            TraceLogger.trace(requestContext, 'streaming-tool-calls', `Tool calls received in stream: ${part.message.tool_calls.map(tc => tc.function.name).join(', ')}`);
            
            // Process each tool call immediately
            for (const toolCall of part.message.tool_calls) {
              const toolName = toolCall.function.name;
              const toolArguments = JSON.stringify(toolCall.function.arguments, null, 2);
              const toolStartTime = Date.now();
              
              // Skip if already executed
              const toolCallKey = `${toolName}-${JSON.stringify(toolCall.function.arguments)}`;
              if (executedToolIds.has(toolCallKey)) {
                continue;
              }
              executedToolIds.add(toolCallKey);
              
              // Find corresponding streaming tool to update its UI
              const streamingKey = `streaming-${toolName}`;
              const streamingTool = activeStreamingTools.get(streamingKey);
              const displayToolId = streamingTool ? streamingTool.toolId : `tool-${toolName}-${Date.now()}`;
              
              // Add to final tool calls for conversation
              detectedToolCalls.push(toolCall);
              
              // If we didn't see this tool during streaming, show it now
              if (!streamingTool) {
                yield `<tool_call_position id="${displayToolId}">`;
              }
              
              // Update tool to show execution status
              yield `<tool_calls_update>${JSON.stringify([{
                name: toolName,
                arguments: toolArguments,
                result: 'Executing...',
                isExecuting: true
              }])}</tool_calls_update>`;
              
              yield this.emitExecutionEvent({type: 'tool_start', id: displayToolId, name: toolName});
              
              // Find and execute tool immediately
              const tool = toolCalls.find((tool) => tool.toolDefinition.function.name === toolName);
              
              if (!tool || tool.type !== "mcp") {
                const errorMessage = `Tool '${toolName}' not found`;
                
                const duration_ms = Date.now() - toolStartTime;
                const toolCallInfo = {
                  name: toolName,
                  arguments: toolArguments,
                  result: errorMessage,
                  isError: true,
                  duration_ms
                };
                
                // Add error to conversation
                conversationMessages.push({
                  role: 'tool',
                  content: createQueryWithToolResponsePrompt(toolName, `Error: ${errorMessage}`)
                });
                
                yield this.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms, isError: true});
                yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
                continue;
              }
              
              try {
                // Execute tool immediately
                const toolResponse = await tool.mcpFunction(requestContext, toolCall);
                
                let resultText = '';
                if (toolResponse.isError) {
                  resultText = toolResponse.content?.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('') || 'Tool call failed';
                } else if (!toolResponse.content || toolResponse.content.length === 0) {
                  resultText = 'Tool executed successfully (no content returned)';
                } else {
                  resultText = toolResponse.content.map(item => 
                    item.type === "text" ? item.text as string : JSON.stringify(item)
                  ).join('');
                }
                
                // Add tool result to conversation for AI context
                conversationMessages.push({
                  role: 'tool',
                  content: createQueryWithToolResponsePrompt(toolName, resultText)
                });
                
                // Send completion immediately
                const duration_ms = Date.now() - toolStartTime;
                const toolCallInfo = {
                  name: toolName,
                  arguments: toolArguments,
                  result: resultText,
                  isError: toolResponse.isError,
                  duration_ms
                };
                
                yield this.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms, isError: toolResponse.isError});
                yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
                
              } catch (error: any) {
                const errorMessage = `Tool execution failed: ${error.message || String(error)}`;
                
                // Add error to conversation
                conversationMessages.push({
                  role: 'tool',
                  content: createQueryWithToolResponsePrompt(toolName, `Error: ${errorMessage}`)
                });
                
                const duration_ms = Date.now() - toolStartTime;
                const toolCallInfo = {
                  name: toolName,
                  arguments: toolArguments,
                  result: errorMessage,
                  isError: true,
                  duration_ms
                };
                
                yield this.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms, isError: true});
                yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
              }
            }
          }
        }
        
        // Add assistant message to conversation
        conversationMessages.push({
          role: 'assistant',
          content: assistantContent,
          tool_calls: detectedToolCalls.length > 0 ? detectedToolCalls : undefined
        });
        
        // SAVE TO MEMORY AFTER EVERY RESPONSE
        if (assistantContent.trim()) {
          console.log('💾 Saving response to memory:', assistantContent.substring(0, 50) + '...');
          addToMemory([
            { role: 'user', content: requestContext.question },
            { role: 'assistant', content: assistantContent }
          ]).catch((error) => {
            console.error('❌ Memory save failed:', error);
          });
        }

        // Log what the AI said in this round
        TraceLogger.trace(requestContext, 'single-conversation-assistant-content', `AI said: ${assistantContent}`);
        TraceLogger.trace(requestContext, 'single-conversation-detected-tools', `Detected ${detectedToolCalls.length} tool calls: ${detectedToolCalls.map(tc => tc.function.name).join(', ')}`);
        
        // If no tool calls, conversation is complete
        if (detectedToolCalls.length === 0) {
          conversationComplete = true;
          break;
        }
        
        // Execute tools and add results to conversation
        for (const toolCall of detectedToolCalls) {
          if (cancellationToken.isCancelled) {
            break;
          }
          
          const toolName = toolCall.function.name;
          const toolArguments = JSON.stringify(toolCall.function.arguments, null, 2);
          const toolId = `tool-${toolName}-${Date.now()}`;
          const toolStartTime = Date.now();
          
          yield this.emitExecutionEvent({type: 'tool_start', id: toolId, name: toolName});
          
          TraceLogger.trace(requestContext, 'single-conversation-tool-start', `Executing ${toolName}`);
          TraceLogger.trace(requestContext, 'single-conversation-tool-args', `Tool arguments: ${toolArguments}`);
          TraceLogger.trace(requestContext, 'single-conversation-mcp-request', `MCP Request: ${JSON.stringify(toolCall, null, 2)}`);
          
          const tool = toolCalls.find((tool) => tool.toolDefinition.function.name === toolName);
          
          if (!tool || tool.type !== "mcp") {
            const errorMessage = `Tool '${toolName}' not found`;
            
            // Add error to conversation
            conversationMessages.push({
              role: 'tool',
              content: createQueryWithToolResponsePrompt(toolName, `Error: ${errorMessage}`)
            });
            
            // Send completion event
            const duration_ms = Date.now() - toolStartTime;
            const toolCallInfo = {
              name: toolName,
              arguments: toolArguments,
              result: errorMessage,
              isError: true,
              duration_ms
            };
            
            yield this.emitExecutionEvent({type: 'tool_complete', id: toolId, duration_ms, isError: true});
            yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
            continue;
          }
          
          try {
            const toolResponse = await tool.mcpFunction(requestContext, toolCall);
            TraceLogger.trace(requestContext, 'single-conversation-tool-success', `Tool ${toolName} completed`);
            TraceLogger.trace(requestContext, 'single-conversation-mcp-response', `MCP Response: ${JSON.stringify(toolResponse, null, 2)}`);
            
            let resultText = '';
            if (toolResponse.isError) {
              resultText = toolResponse.content?.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('') || 'Tool call failed';
            } else if (!toolResponse.content || toolResponse.content.length === 0) {
              resultText = 'Tool executed successfully (no content returned)';
            } else {
              resultText = toolResponse.content.map(item => 
                item.type === "text" ? item.text as string : JSON.stringify(item)
              ).join('');
            }
            
            // Add tool result to conversation for AI context
            conversationMessages.push({
              role: 'tool',
              content: createQueryWithToolResponsePrompt(toolName, resultText)
            });
            
            // Send completion event
            const duration_ms = Date.now() - toolStartTime;
            const toolCallInfo = {
              name: toolName,
              arguments: toolArguments,
              result: resultText,
              isError: toolResponse.isError,
              duration_ms
            };
            
            yield this.emitExecutionEvent({type: 'tool_complete', id: toolId, duration_ms, isError: toolResponse.isError});
            yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
            
          } catch (error: any) {
            const errorMessage = `Tool execution failed: ${error.message || String(error)}`;
            TraceLogger.trace(requestContext, 'single-conversation-tool-error', errorMessage);
            
            // Add error to conversation
            conversationMessages.push({
              role: 'tool',
              content: createQueryWithToolResponsePrompt(toolName, `Error: ${errorMessage}`)
            });
            
            // Send completion event
            const duration_ms = Date.now() - toolStartTime;
            const toolCallInfo = {
              name: toolName,
              arguments: toolArguments,
              result: errorMessage,
              isError: true,
              duration_ms
            };
            
            yield this.emitExecutionEvent({type: 'tool_complete', id: toolId, duration_ms, isError: true});
            yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
          }
        }
        
        // Continue conversation with tool results
        // The loop will start another round with the updated conversation
      }
      } catch (error) {
      console.error('Error in response generator:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield `\nError processing response: ${errorMessage}`;
    }
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

