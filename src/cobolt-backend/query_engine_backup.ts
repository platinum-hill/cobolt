import { RequestContext, TraceLogger } from './logger';
import { formatDateTime } from './datetime_parser';
import { simpleChatOllamaStream, getOllamaClient } from './ollama_client';
import { MODELS } from './model_manager';
import { createChatPrompt, createQueryWithToolResponsePrompt } from './prompt_templates';
import { searchMemories, addToMemory, isMemoryEnabled } from './memory';
import { FunctionTool } from './ollama_tools';
import { Message } from 'ollama';
import { ChatHistory } from './chat_history';
import { McpClient } from './connectors/mcp_client';
import { CancellationToken, globalCancellationToken } from './utils/cancellation';

interface ExecutionEvent {
  type: 'tool_start' | 'tool_complete' | 'thinking_start' | 'thinking_complete';
  id: string;
  name?: string;
  duration_ms?: number;
  isError?: boolean;
}

type StreamingToolInfo = {
  name: string;
  arguments: string;
  toolId: string;
  isComplete: boolean;
};

class QueryEngine {
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
    
    return this.createConductorResponseGenerator(
      requestContext, 
      chatSystemPrompt,
      toolCalls, 
      memories, 
      cancellationToken
    );
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

  private createToolCallSuccessInfo(toolName: string, toolArguments: string, result: string, duration_ms: number, isError: boolean) {
    return {
      name: toolName,
      arguments: toolArguments,
      result,
      isError,
      duration_ms
    };
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
   * Creates a generator for conductor mode with phase-based control
   */
  private async *createConductorResponseGenerator(
    requestContext: RequestContext,
    systemPrompt: string,
    toolCalls: FunctionTool[],
    memories: string,
    cancellationToken: CancellationToken
  ): AsyncGenerator<string> {
    
    // Build initial conversation messages
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
      let conversationActive = true;
      let currentPhase = 1;
      let lastToolResults: any[] = [];
      
      while (conversationActive && !cancellationToken.isCancelled) {
        console.log(`\n🎭 CONDUCTOR MODE - Phase ${currentPhase}`);
        TraceLogger.trace(requestContext, 'conductor-phase', `Starting phase ${currentPhase}`);
        
        // Inject phase-specific context
        this.injectPhaseContext(conversationMessages, currentPhase, lastToolResults);
        
        console.log(`🎭 CONVERSATION LENGTH: ${conversationMessages.length} messages`);
        console.log(`🎭 LAST MESSAGE:`, conversationMessages[conversationMessages.length - 1]);
        
        // Reset cancellation token for new generation
        globalCancellationToken.reset();
        console.log(`🎭 TOKEN RESET: cancelled=${globalCancellationToken.isCancelled}`);
        
        // Start streaming with block detection  
        let phaseContent = '';
        let phaseToolCalls: any[] = [];
        
        console.log(`🎭 STARTING OLLAMA CHAT for phase ${currentPhase}...`);
        const ollama = getOllamaClient();
        
        let response;
        try {
          response = await ollama.chat({
          model: MODELS.CHAT_MODEL,
          messages: conversationMessages,
          tools: toolCalls.map((toolCall) => toolCall.toolDefinition),
          keep_alive: -1,
          options: {
            temperature: 1.0,
            top_k: 64,
            top_p: 0.95,
            num_ctx: MODELS.CHAT_MODEL_CONTEXT_LENGTH,
          },
          stream: true,
        });
        console.log(`🎭 OLLAMA RESPONSE STARTED for phase ${currentPhase}`);
      } catch (ollamaError) {
        console.error(`🎭 OLLAMA ERROR in phase ${currentPhase}:`, ollamaError);
        throw ollamaError;
      }
        
        // Stream content while checking for block completion
        console.log(`🎭 STARTING STREAM LOOP for phase ${currentPhase}`);
        let partCount = 0;
        
        for await (const part of response) {
          partCount++;
          console.log(`🎭 PART ${partCount} in phase ${currentPhase}:`, {
            hasContent: !!part.message?.content,
            contentLength: part.message?.content?.length || 0,
            hasToolCalls: !!part.message?.tool_calls,
            cancelled: cancellationToken.isCancelled
          });
          
          if (cancellationToken.isCancelled) {
            console.log(`🎭 CANCELLATION DETECTED in phase ${currentPhase}`);
            break;
          }
          
          if (part.message?.content) {
            phaseContent += part.message.content;
            console.log(`🎭 YIELDING CONTENT:`, JSON.stringify(part.message.content));
            yield part.message.content;
          }
          
          if (part.message?.tool_calls) {
            phaseToolCalls.push(...part.message.tool_calls);
            console.log(`🎭 TOOL CALLS DETECTED:`, part.message.tool_calls.length);
          }
          
          // Check for block completion
          const blockComplete = this.isBlockComplete(phaseContent, currentPhase);
          if (blockComplete.complete) {
            console.log(`🎭 BLOCK COMPLETE: Phase ${currentPhase}, type: ${blockComplete.type}`);
            // Cancel stream and scrub content
            globalCancellationToken.cancel();
            phaseContent = this.scrubToLastBlock(phaseContent, blockComplete);
            break;
          }
        }
        
        console.log(`🎭 STREAM ENDED for phase ${currentPhase}, parts: ${partCount}, content length: ${phaseContent.length}`);
        
        const result = {
          content: phaseContent,
          toolCalls: phaseToolCalls
        };
        
        console.log(`🎭 PHASE ${currentPhase} RESULT:`, {
          contentLength: result.content.length,
          toolCallsCount: result.toolCalls.length,
          content: result.content.substring(0, 100) + (result.content.length > 100 ? '...' : '')
        });
        
        // Add AI response to conversation
        conversationMessages.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.toolCalls
        });
        
        // Determine next phase based on current phase and result
        const nextAction = this.determineNextPhase(currentPhase, result);
        console.log(`🎭 NEXT ACTION:`, nextAction);
        
        if (nextAction.action === 'END') {
          console.log('🎭 CONDUCTOR: Conversation ended');
          conversationActive = false;
        } else if (nextAction.action === 'EXECUTE_TOOLS') {
          console.log(`🎭 CONDUCTOR: Executing ${result.toolCalls.length} tools`);
          // Execute detected tools
          lastToolResults = await this.executeConductorTools(
            result.toolCalls,
            requestContext,
            conversationMessages
          );
          console.log(`🎭 TOOL RESULTS:`, lastToolResults.length, 'results');
          currentPhase = 3; // Go to reflection phase
        } else {
          console.log(`🎭 CONDUCTOR: Moving to phase ${nextAction.nextPhase}`);
          currentPhase = nextAction.nextPhase!;
        }
      }
      
    } catch (error) {
      console.error('🎭 CONDUCTOR ERROR:', error);
      console.error('🎭 ERROR STACK:', error instanceof Error ? error.stack : 'No stack');
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield `\n🎭 Error in conductor mode: ${errorMessage}`;
    }
  }

  /**
   * Inject phase-specific context into conversation
   */
  private injectPhaseContext(
    messages: Message[], 
    phase: number, 
    lastToolResults?: any[]
  ): void {
    const phasePrompts = {
      1: "Think through this query step by step before responding.",
      2: "Choose to call a tool if you need more information, OR complete your response with a final output to the user.",
      3: `Think about these tool results and what they mean for your response: ${lastToolResults ? JSON.stringify(lastToolResults) : ''}`,
      4: "Based on your reflection, either continue your response to the user, call another tool if needed, or complete your response."
    };
    
    const prompt = phasePrompts[phase as keyof typeof phasePrompts];
    if (prompt) {
      messages.push({ role: 'system', content: prompt });
    }
  }

  /**
   * Determine next phase based on current phase and result
   */
  private determineNextPhase(
    currentPhase: number, 
    result: { toolCalls: any[]; content: string }
  ): { action: 'END' | 'EXECUTE_TOOLS' | 'CONTINUE'; nextPhase?: number } {
    
    switch (currentPhase) {
      case 1: // Thinking → Always go to decision phase
        return { action: 'CONTINUE', nextPhase: 2 };
        
      case 2: // Decision phase
        if (result.toolCalls && result.toolCalls.length > 0) {
          return { action: 'EXECUTE_TOOLS' }; // nextPhase set to 3 in main loop
        } else {
          // Any non-tool response = end conversation
          return { action: 'END' };
        }
        
      case 3: // Reflection → Always go to action phase
        return { action: 'CONTINUE', nextPhase: 4 };
        
      case 4: // Action phase
        if (result.toolCalls && result.toolCalls.length > 0) {
          return { action: 'EXECUTE_TOOLS' }; // Loop back to reflection
        } else {
          // Any non-tool response = end conversation
          return { action: 'END' };
        }
        
      default:
        return { action: 'END' };
    }
  }

  /**
   * Execute tools detected in conductor mode
   */
  private async executeConductorTools(
    toolCalls: any[],
    requestContext: RequestContext,
    conversationMessages: Message[]
  ): Promise<any[]> {
    const toolResults: any[] = [];
    
    for (const toolCall of toolCalls) {
      try {
        // Use existing tool execution logic
        const result = await this.executeToolCall(toolCall, requestContext);
        toolResults.push({
          toolName: toolCall.function.name,
          content: result.content,
          isError: result.isError || false
        });
        
        // Add tool result to conversation
        conversationMessages.push({
          role: 'tool',
          content: `Tool ${toolCall.function.name} result: ${result.content}`
        });
        
      } catch (error) {
        const errorResult = {
          toolName: toolCall.function.name,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          isError: true
        };
        toolResults.push(errorResult);
        
        conversationMessages.push({
          role: 'tool',
          content: `Tool ${toolCall.function.name} error: ${errorResult.content}`
        });
      }
    }
    
    return toolResults;
  }

  /**
   * Check if a block is complete based on phase and content
   */
  private isBlockComplete(
    content: string, 
    phase: number
  ): { complete: boolean; position: number; type: string } {
    
    switch (phase) {
      case 1: // Thinking completion
        if (content.includes('</think>')) {
          const position = content.lastIndexOf('</think>') + 8;
          return { complete: true, position, type: 'thinking' };
        }
        break;
        
      case 2: // Text or tool call decision
        // Check for tool call markers first
        if (content.includes('<tool_call_position') || content.includes('tool_calls')) {
          const position = this.findLastSentenceEnd(content);
          return { complete: true, position, type: 'tool_call' };
        }
        
        // Check for natural text ending
        if (this.isNaturalTextEnd(content)) {
          const position = this.findLastSentenceEnd(content);
          return { complete: true, position, type: 'text' };
        }
        break;
        
      case 3: // Reflection thinking completion
        if (content.includes('</think>')) {
          const position = content.lastIndexOf('</think>') + 8;
          return { complete: true, position, type: 'thinking' };
        }
        break;
        
      case 4: // Action decision
        // Check for tool call markers first
        if (content.includes('<tool_call_position') || content.includes('tool_calls')) {
          const position = this.findLastSentenceEnd(content);
          return { complete: true, position, type: 'tool_call' };
        }
        
        // Check for natural text ending
        if (this.isNaturalTextEnd(content)) {
          const position = this.findLastSentenceEnd(content);
          return { complete: true, position, type: 'text' };
        }
        break;
    }
    
    return { complete: false, position: -1, type: '' };
  }

  /**
   * Check if content ends naturally (complete sentence without incomplete blocks)
   */
  private isNaturalTextEnd(content: string): boolean {
    const trimmed = content.trim();
    
    // Must end with sentence-ending punctuation
    const endsWithCompleteSentence = /[.!?]\s*$/.test(trimmed);
    
    // Must not have incomplete thinking blocks
    const hasIncompleteThinking = /<think>(?!.*<\/think>)/s.test(trimmed);
    
    // Must not have incomplete tool markers
    const hasIncompleteToolMarkers = /<tool_call_position[^>]*>$/g.test(trimmed);
    
    return endsWithCompleteSentence && !hasIncompleteThinking && !hasIncompleteToolMarkers;
  }

  /**
   * Find the position of the last complete sentence
   */
  private findLastSentenceEnd(content: string): number {
    const sentences = content.match(/[.!?]\s*/g);
    if (!sentences) return content.length;
    
    let position = 0;
    for (const sentence of sentences) {
      const nextPos = content.indexOf(sentence, position) + sentence.length;
      position = nextPos;
    }
    
    return Math.min(position, content.length);
  }

  /**
   * Scrub content to last complete block
   */
  private scrubToLastBlock(
    content: string, 
    blockInfo: { position: number; type: string }
  ): string {
    // Clean content up to the last complete block
    let cleanContent = content.substring(0, blockInfo.position);
    
    // Remove any incomplete markers at the end
    cleanContent = cleanContent
      .replace(/<think>(?!.*<\/think>).*$/s, '') // Remove incomplete thinking
      .replace(/<tool_call_position[^>]*>$/g, '') // Remove incomplete tool markers
      .trim();
    
    return cleanContent;
  }

  /**
   * Execute a single tool call (simplified version for conductor mode)
   */
  private async executeToolCall(
    toolCall: any,
    requestContext: RequestContext
  ): Promise<{ content: string; isError: boolean }> {
    
    const toolName = toolCall.function.name;
    
    // Find the tool in available tools
    const toolCalls: FunctionTool[] = McpClient.toolCache;
    const tool = toolCalls.find((tool) => tool.toolDefinition.function.name === toolName);
    
    if (!tool || tool.type !== "mcp") {
      return {
        content: `Error: Tool '${toolName}' not found`,
        isError: true
      };
    }
    
    try {
      // Execute tool using existing MCP function
      const toolResponse = await tool.mcpFunction(requestContext, toolCall);
      
      let resultText = '';
      if (toolResponse.isError) {
        resultText = toolResponse.content?.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('') || 'Tool call failed';
        return { content: resultText, isError: true };
      } else if (!toolResponse.content || toolResponse.content.length === 0) {
        resultText = 'Tool executed successfully (no content returned)';
      } else {
        resultText = toolResponse.content.map(item => 
          item.type === "text" ? item.text as string : JSON.stringify(item)
        ).join('');
      }
      
      return { content: resultText, isError: false };
      
    } catch (error: any) {
      const errorMessage = `Tool execution failed: ${error.message || String(error)}`;
      return { content: errorMessage, isError: true };
    }
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
        TraceLogger.trace(requestContext, 'conversation-round', `Starting conversation round with ${conversationMessages.length} messages`);
        
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
            throw toolsError;
          }
        }
        
        let chatContent = '';
        let detectedToolCalls: any[] = [];
        
        // Thinking state tracking
        const thinkingState = { isInThinkingBlock: false, thinkingContent: '' };
        
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
            const thinkingEvents = this.processThinkingInContent(part.message.content, thinkingState);
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
              
              yield this.emitExecutionEvent({type: 'tool_start', id: displayToolId, name: toolName});
              
              // Find and execute tool immediately
              const tool = toolCalls.find((tool) => tool.toolDefinition.function.name === toolName);
              
              if (!tool || tool.type !== "mcp") {
                const errorMessage = `Tool '${toolName}' not found`;
                
                const duration_ms = Date.now() - toolStartTime;
                const toolCallInfo = this.createToolCallErrorInfo(toolName, toolArguments, errorMessage, duration_ms);
                
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
                const toolCallInfo = this.createToolCallSuccessInfo(toolName, toolArguments, resultText, duration_ms, toolResponse.isError || false);
                
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
                const toolCallInfo = this.createToolCallErrorInfo(toolName, toolArguments, errorMessage, duration_ms);
                
                yield this.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms, isError: true});
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

  private processThinkingInContent(content: string, thinkingState: any): string[] {
    const events: string[] = [];
    // Implementation for thinking block processing
    return events;
  }

  private emitExecutionEvent(event: ExecutionEvent): string {
    return `<execution_event>${JSON.stringify(event)}</execution_event>`;
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

  async query(
    requestContext: RequestContext,
    chatMode: 'CHAT' | 'CONTEXT_AWARE' | 'CONDUCTOR' = 'CHAT',
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'user_chat_history', requestContext.chatHistory.toString());
    TraceLogger.trace(requestContext, 'user_question', requestContext.question);
    TraceLogger.trace(requestContext, 'current_date', formatDateTime(requestContext.currentDatetime));
    
    if (chatMode === 'CONTEXT_AWARE') {
      const toolCalls: FunctionTool[] = McpClient.toolCache;
      return this.processRagRatQuery(requestContext, toolCalls, cancellationToken);
    }
    
    if (chatMode === 'CONDUCTOR') {
      const toolCalls: FunctionTool[] = McpClient.toolCache;
      return this.processConductorQuery(requestContext, toolCalls, cancellationToken);
    }

    return this.processChatQuery(requestContext, cancellationToken);
  }
}

export const queryEngineInstance = new QueryEngine();
export { QueryEngine };