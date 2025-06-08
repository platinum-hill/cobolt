import { RequestContext, TraceLogger } from '../logger';
import { simpleChatOllamaStream } from '../simple_ollama_stream';
import { getOllamaClient } from '../ollama_client';
import { MODELS } from '../model_manager';
import { createQueryWithToolResponsePrompt } from '../prompt_templates';
import { addToMemory, isMemoryEnabled } from '../memory';
import { FunctionTool } from '../ollama_tools';
import { Message } from 'ollama';
import { CancellationToken, globalCancellationToken } from '../utils/cancellation';
import { ExecutionEvent, ThinkingState, ToolExecutionUtils } from './tool_execution_utils';

type StreamingToolInfo = {
  name: string;
  arguments: string;
  toolId: string;
  isComplete: boolean;
};

export class SequentialGenerator {
  private globalExecutedToolIds: Map<string, Set<string>>;
  
  constructor() {
    this.globalExecutedToolIds = new Map();
  }
  
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

  /**
   * Creates a generator for sequential inline tool calling response
   */
  async *createSequentialResponseGenerator(
    requestContext: RequestContext,
    systemPrompt: string,
    toolCalls: FunctionTool[],
    memories: string,
    cancellationToken: CancellationToken = globalCancellationToken
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
        TraceLogger.trace(requestContext, 'conversation-round', `Starting conversation round with ${conversationMessages.length} messages`);
        
        // Get ollama client and constants
        const ollama = getOllamaClient();
        const defaultTemperature = 1.0;
        const defaultTopK = 64;
        const defaultTopP = 0.95;
        
        // Try to start conversation with tools enabled first
        let response;
        
        // Create abort controller for this request
        const abortController = new AbortController();
        cancellationToken.setAbortController(abortController);
        
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
            signal: abortController.signal  // ← Add abort signal
          });
        } catch (error: any) {
          // Check if the error is due to cancellation first
          if (error.name === 'AbortError') {
            console.log('[Sequential] AI generation cancelled by user');
            yield '\n\n*Message generation cancelled by user.*';
            return;
          }
          
          // Check if the error is due to model not supporting tools
          const errorMessage = error.message || String(error);
          if (errorMessage.includes('does not support tools')) {
            TraceLogger.trace(requestContext, 'model-tools-fallback', `Model ${MODELS.CHAT_MODEL} does not support tools, falling back to simple chat`);
            
            // For models without tool calling, use simple chat
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
            throw error;
          }
        }
        
        let chatContent = '';
        let detectedToolCalls: any[] = [];
        
        // Thinking state tracking
        const thinkingState: ThinkingState = { 
          isInThinkingBlock: false, 
          thinkingContent: '',
          currentThinkingId: null,
          thinkingStartTime: null
        };
        
        const activeStreamingTools = new Map<string, StreamingToolInfo>();
        // Use global executed tool tracking to prevent re-execution across query sessions
        const requestId = requestContext.requestId;
        if (!this.globalExecutedToolIds.has(requestId)) {
          this.globalExecutedToolIds.set(requestId, new Set());
        }
        const executedToolIds = this.globalExecutedToolIds.get(requestId)!;
        
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
            const thinkingEvents = ToolExecutionUtils.processThinkingInContent(part.message.content, thinkingState);
            for (const thinkingEvent of thinkingEvents) {
              yield thinkingEvent;
            }
            
            chatContent += part.message.content;
            yield part.message.content;
          }
          
          // Log when content is empty but tool_calls appear
          if (!part.message.content && part.message.tool_calls) {
            console.log('TOOL CALLS APPEARED WITH NO CONTENT! RAG');
          }
          
          // Log when we get official tool calls
          if (part.message.tool_calls) {
            console.log('Official tool calls received - should match our streaming parsing');
          }
          
          // IMMEDIATE tool execution when tool calls appear in stream
          if (part.message.tool_calls && part.message.tool_calls.length > 0) {
            console.log('COMPLETE tool calls received:', JSON.stringify(part.message.tool_calls, null, 2));
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
              const displayToolId = streamingTool ? streamingTool.toolId : `tool-${toolCallKey.replace(/[^a-zA-Z0-9-]/g, '-')}`;
              
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
              
              yield ToolExecutionUtils.emitExecutionEvent({type: 'tool_start', id: displayToolId, name: toolName});
              
              // Find and execute tool immediately
              const tool = toolCalls.find((tool) => tool.toolDefinition.function.name === toolName);
              
              if (!tool || tool.type !== "mcp") {
                const errorMessage = `Tool '${toolName}' not found`;
                
                const duration_ms = Date.now() - toolStartTime;
                const toolCallInfo = ToolExecutionUtils.createToolCallErrorInfo(toolName, toolArguments, errorMessage, duration_ms);
                
                // Add error to conversation
                conversationMessages.push({
                  role: 'tool',
                  content: createQueryWithToolResponsePrompt(toolName, `Error: ${errorMessage}`)
                });
                
                yield ToolExecutionUtils.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms, isError: true});
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
                const toolCallInfo = ToolExecutionUtils.createToolCallSuccessInfo(toolName, toolArguments, resultText, duration_ms, toolResponse.isError || false);
                
                yield ToolExecutionUtils.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms, isError: toolResponse.isError});
                yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
                
              } catch (error: any) {
                const errorMessage = `Tool execution failed: ${error.message || String(error)}`;
                
                // Add error to conversation
                conversationMessages.push({
                  role: 'tool',
                  content: createQueryWithToolResponsePrompt(toolName, `Error: ${errorMessage}`)
                });
                
                const duration_ms = Date.now() - toolStartTime;
                const toolCallInfo = ToolExecutionUtils.createToolCallErrorInfo(toolName, toolArguments, errorMessage, duration_ms);
                
                yield ToolExecutionUtils.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms, isError: true});
                yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
              }
            }
          }
        }
        
        // Add assistant message to conversation
        conversationMessages.push({
          role: 'assistant',
          content: chatContent,
          tool_calls: detectedToolCalls.length > 0 ? detectedToolCalls : undefined
        });
        
        // SAVE TO MEMORY AFTER EVERY RESPONSE (if enabled)
        if (isMemoryEnabled() && chatContent.trim()) {
          console.log('Saving response to memory:', chatContent.substring(0, 50) + '...');
          addToMemory([
            { role: 'user', content: requestContext.question },
            { role: 'assistant', content: chatContent }
          ]).catch((error) => {
            console.error('Memory save failed:', error);
          });
        }

        // Log what the AI said in this round
        TraceLogger.trace(requestContext, 'chat-content', `AI said: ${chatContent}`);
        TraceLogger.trace(requestContext, 'detected-tools', `Detected ${detectedToolCalls.length} tool calls: ${detectedToolCalls.map(tc => tc.function.name).join(', ')}`);
        
        // If no tool calls, conversation is complete
        if (detectedToolCalls.length === 0) {
          conversationComplete = true;
          break;
        }
      }
    } catch (error) {
      console.error('Error in response generator:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield `\nError processing response: ${errorMessage}`;
    }
  }


}
