import { RequestContext } from '../logger';
import { getOllamaClient } from '../ollama_client';
import { MODELS } from '../model_manager';
import { FunctionTool } from '../ollama_tools';
import { Message } from 'ollama';
import { CancellationToken, globalCancellationToken } from '../utils/cancellation';
import { ThinkingState, ToolExecutionUtils } from './tool_execution_utils';

export class ConductorGenerator {
  
  /**
   * Creates conductor mode following exact pseudocode with active monitoring and stopping
   */
  async *createConductorResponseGenerator(
    requestContext: RequestContext,
    systemPrompt: string,
    toolCalls: FunctionTool[],
    memories: string,
    cancellationToken: CancellationToken = globalCancellationToken
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
      let totalPhaseCount = 0;
      const MAX_PHASES = 50;
      
      while (conversationActive && !cancellationToken.isCancelled && totalPhaseCount < MAX_PHASES) {
        totalPhaseCount++;
        console.log(`\n[Conductor] CONDUCTOR MODE - Phase ${currentPhase} (Total: ${totalPhaseCount}/${MAX_PHASES})`);
        
        // Check for max phase limit
        if (totalPhaseCount >= MAX_PHASES) {
          console.log(`[Conductor] CONDUCTOR: Hit max phase limit (${MAX_PHASES}), ending conversation`);
          yield `\n\n[Conductor] **Note**: Conversation ended after ${MAX_PHASES} phases to prevent infinite loops.`;
          break;
        }
        
        // EXACT PSEUDOCODE IMPLEMENTATION
        switch (currentPhase) {
          case 1: { // Initial processing
            // inject_context(rag_retrieve("phase_1_thinking"))
            const thinkingContext = await this.ragRetrieve("phase_1_thinking");
            conversationMessages.push({ role: 'system', content: thinkingContext });
            
            // continue_generating()
            // await_block_completion() -> stop_generating() -> scrub_context() -> inject_context(rag_retrieve("phase_1_response")
            yield* this.streamAndStopOnThinking(conversationMessages, toolCalls, cancellationToken);
            
            const responseContext = await this.ragRetrieve("phase_1_response");
            conversationMessages.push({ role: 'system', content: responseContext });
            
            // continue_generating() + phase = 2
            yield* this.streamUntilNaturalEnd(conversationMessages, toolCalls, cancellationToken);
            currentPhase = 2;
            break;
          }
          
          case 2: { // Tool or End Decision
            // await_block_completion() -> inject_context(rag_retrieve("phase_2_decision")
            yield* this.streamUntilNaturalEnd(conversationMessages, toolCalls, cancellationToken);
            
            const decisionContext = await this.ragRetrieve("phase_2_decision");
            conversationMessages.push({ role: 'system', content: decisionContext });
            
            // continue_generating() + phase = 3
            currentPhase = 3;
            break;
          }
          
          case 3: { // Post-tool execution
            // await_any_block_completion() -> stop_generating() -> scrub_context()
            // detect_tool_call_or_end_of_turn()
            const result = yield* this.streamAndStopOnToolCall(conversationMessages, toolCalls, cancellationToken);
            
            if (result.toolCall) {
              // Execute tools first
              const toolExecutionGenerator = this.executeConductorTools(
                result.toolCalls,
                requestContext,
                conversationMessages
              );
              
              let toolGenResult;
              do {
                toolGenResult = await toolExecutionGenerator.next();
                if (!toolGenResult.done && toolGenResult.value) {
                  yield toolGenResult.value;
                }
              } while (!toolGenResult.done);
              
              // inject_context(rag_retrieve("phase_3_reflection")
              const reflectionContext = await this.ragRetrieve("phase_3_reflection");
              conversationMessages.push({ role: 'system', content: reflectionContext });
              
              // continue_generating() + phase = 4
              currentPhase = 4;
            } else {
              // Done - end of conversation
              conversationActive = false;
            }
            break;
          }
          
          case 4: { // Next Action Decision
            // await_block_completion() -> stop_generating() -> scrub_context() -> inject_context(rag_retrieve("phase_4_decision")
            yield* this.streamAndStopOnThinking(conversationMessages, toolCalls, cancellationToken);
            
            const decisionContext = await this.ragRetrieve("phase_4_decision");
            conversationMessages.push({ role: 'system', content: decisionContext });
            
            // continue_generating() + phase = 3
            yield* this.streamUntilNaturalEnd(conversationMessages, toolCalls, cancellationToken);
            currentPhase = 3;
            break;
          }
          
          default:
            conversationActive = false;
            break;
        }
      }
      
    } catch (error) {
      console.error('[Conductor] CONDUCTOR ERROR:', error);
      console.error('[Conductor] ERROR STACK:', error instanceof Error ? error.stack : 'No stack');
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield `\n[Conductor] Error in conductor mode: ${errorMessage}`;
    }
  }

  /**
   * RAG retrieval for phase-specific content - UPDATED per new pseudocode
   */
  private async ragRetrieve(phaseKey: string): Promise<string> {
    const phasePrompts = {
      "phase_1_thinking":   "\nYou MUST think through this query before responding. DO NOT use XML tags unless specifically requested to use them. Provide your thoughts inbetween <think> and </think> tags.\n",
      "phase_1_response":   "\nProvide an initial response to the user's query.\n", 
      "phase_2_decision":   "\nYou must now choose: call a single tool OR end the conversation turn with a brief message.\n",
      "phase_3_reflection": "\nYou must think about the tool call results before proceeding. Provide your thoughts inbetween <think> and </think> tags.\n",
      "phase_4_decision":   "\nYou MUST choose ONE of the following options: Call another tool, OR end the conversation turn with a brief message.\n"
    };
    
    return phasePrompts[phaseKey as keyof typeof phasePrompts] || "";
  }

  /**
   * Stream and stop when we detect </think> - used for phases 1 and 4
   */
  private async *streamAndStopOnThinking(
    conversationMessages: Message[],
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken
  ): AsyncGenerator<string> {
    
    // Create abort controller for this specific request
    const abortController = new AbortController();
    cancellationToken.setAbortController(abortController);
    
    let content = '';
    const toolCallsFound: any[] = [];
    let shouldStop = false;
    let stopReason = '';
    
    const thinkingState: ThinkingState = { 
      isInThinkingBlock: false, 
      thinkingContent: '',
      currentThinkingId: null,
      thinkingStartTime: null
    };
    
    console.log(`[Conductor] Streaming until </think> detected...`);

    try {
      const ollama = getOllamaClient();
      const response = await ollama.chat({
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
        signal: abortController.signal  // Add abort signal
      } as any);
      
      // Phase 1: Stream and detect stop conditions
      for await (const part of response) {
        // Check for user cancellation first
        if (cancellationToken.isCancelled) {
          console.log(`[Conductor] User cancellation detected: ${cancellationToken.cancelReason}`);
          break;
        }
        
        if (part.message?.content) {
          // Process thinking events
          const thinkingEvents = ToolExecutionUtils.processThinkingInContent(part.message.content, thinkingState);
          for (const thinkingEvent of thinkingEvents) {
            yield thinkingEvent;
          }
          
          content += part.message.content;
          yield part.message.content;
          
          // DETECT stop condition but DON'T scrub yet
          if (content.includes('</think>') && !shouldStop) {
            shouldStop = true;
            stopReason = 'think_block_complete';
            console.log('[Conductor] DETECTED </think> - cancelling AI generation');
            abortController.abort();
            // Continue reading to drain any buffered content
          }
        }
        
        if (part.message?.tool_calls) {
          toolCallsFound.push(...part.message.tool_calls);
        }
      }
      
    } catch (error) {
      if ((error as any).name === 'AbortError') {
        console.log(`[Conductor] AI generation cancelled successfully: ${stopReason}`);
      } else {
        console.error('[Conductor] Unexpected error during streaming:', error);
        throw error;
      }
    }
    
    // Phase 2: AI is confirmed stopped, now scrub if needed
    if (shouldStop && stopReason === 'think_block_complete' && content.includes('</think>')) {
      console.log('[Conductor] AI confirmed stopped - performing content scrub');
      const thinkEndIndex = content.indexOf('</think>') + '</think>'.length;
      content = content.substring(0, thinkEndIndex);
      console.log(`[Conductor] SCRUBBED TO: "${content}"`);
    }
    
    // Phase 3: Add final message to conversation
    conversationMessages.push({
      role: 'assistant',
      content: content,
      tool_calls: toolCallsFound.length > 0 ? toolCallsFound : undefined
    });
  }
  
  /**
   * Stream until natural end - used for phase 2
   */
  private async *streamUntilNaturalEnd(
    conversationMessages: Message[],
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken
  ): AsyncGenerator<string> {
    
    // Create abort controller for this specific request
    const abortController = new AbortController();
    cancellationToken.setAbortController(abortController);
    
    let content = '';
    const toolCallsFound: any[] = [];
    
    const thinkingState: ThinkingState = { 
      isInThinkingBlock: false, 
      thinkingContent: '',
      currentThinkingId: null,
      thinkingStartTime: null
    };
    
    console.log(`[Conductor] Streaming until natural end...`);

    try {
      const ollama = getOllamaClient();
      const response = await ollama.chat({
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
        signal: abortController.signal  // Add abort signal
      } as any);
      
      for await (const part of response) {
        // Check for user cancellation
        if (cancellationToken.isCancelled) {
          console.log(`[Conductor] User cancellation detected: ${cancellationToken.cancelReason}`);
          break;
        }
        
        if (part.message?.content) {
          const thinkingEvents = ToolExecutionUtils.processThinkingInContent(part.message.content, thinkingState);
          for (const thinkingEvent of thinkingEvents) {
            yield thinkingEvent;
          }
          
          content += part.message.content;
          yield part.message.content;
        }
        
        if (part.message?.tool_calls) {
          toolCallsFound.push(...part.message.tool_calls);
        }
      }
      
    } catch (error) {
      if ((error as any).name === 'AbortError') {
        console.log('[Conductor] AI generation cancelled successfully (natural end)');
      } else {
        console.error('[Conductor] Unexpected error during streaming:', error);
        throw error;
      }
    }
    
    // Add complete message to conversation
    conversationMessages.push({
      role: 'assistant',
      content: content,
      tool_calls: toolCallsFound.length > 0 ? toolCallsFound : undefined
    });
  }
  
  /**
   * Stream and stop when we detect tool call - used for phase 3
   */
  private async *streamAndStopOnToolCall(
    conversationMessages: Message[],
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken
  ): AsyncGenerator<string, { toolCall: boolean; toolCalls: any[] }> {
    
    // Create abort controller for this specific request
    const abortController = new AbortController();
    cancellationToken.setAbortController(abortController);
    
    let content = '';
    const toolCallsFound: any[] = [];
    let shouldStop = false;
    let stopReason = '';
    
    const thinkingState: ThinkingState = { 
      isInThinkingBlock: false, 
      thinkingContent: '',
      currentThinkingId: null,
      thinkingStartTime: null
    };
    
    console.log(`[Conductor] Streaming until tool call or natural end...`);

    try {
      const ollama = getOllamaClient();
      const response = await ollama.chat({
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
        signal: abortController.signal  // Add abort signal
      } as any);
      
      for await (const part of response) {
        // Check for user cancellation first
        if (cancellationToken.isCancelled) {
          console.log(`[Conductor] User cancellation detected: ${cancellationToken.cancelReason}`);
          break;
        }
        
        if (part.message?.content) {
          const thinkingEvents = ToolExecutionUtils.processThinkingInContent(part.message.content, thinkingState);
          for (const thinkingEvent of thinkingEvents) {
            yield thinkingEvent;
          }
          
          content += part.message.content;
          yield part.message.content;
        }
        
        if (part.message?.tool_calls && !shouldStop) {
          shouldStop = true;
          stopReason = 'tool_calls_detected';
          console.log(`[Conductor] DETECTED TOOL CALL - cancelling AI generation`);
          abortController.abort();
          toolCallsFound.push(...part.message.tool_calls);
          // Continue reading to drain remaining content
        }
      }
      
    } catch (error) {
      if ((error as any).name === 'AbortError') {
        console.log(`[Conductor] AI generation cancelled successfully: ${stopReason}`);
      } else {
        console.error('[Conductor] Unexpected error during streaming:', error);
        throw error;
      }
    }
    
    // No content scrubbing needed for tool calls - just save what we got
    conversationMessages.push({
      role: 'assistant',
      content: content,
      tool_calls: toolCallsFound.length > 0 ? toolCallsFound : undefined
    });
    
    return {
      toolCall: toolCallsFound.length > 0,
      toolCalls: toolCallsFound
    };
  }

  /**
   * Execute tools detected in conductor mode with visual UI markers
   */
  private async *executeConductorTools(
    toolCalls: any[],
    requestContext: RequestContext,
    conversationMessages: Message[]
  ): AsyncGenerator<string, any[]> {
    const toolResults: any[] = [];
    
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const toolArguments = JSON.stringify(toolCall.function.arguments, null, 2);
      const toolStartTime = Date.now();
      
      // Create unique tool ID
      const toolCallKey = `${toolName}-${JSON.stringify(toolCall.function.arguments)}`;
      const displayToolId = `tool-${toolCallKey.replace(/[^a-zA-Z0-9-]/g, '-')}`;
      
      // Show tool call position marker
      yield `<tool_call_position id="${displayToolId}">`;
      
      // Show tool execution starting
      yield `<tool_calls_update>${JSON.stringify([{
        name: toolName,
        arguments: toolArguments,
        result: 'Executing...',
        isExecuting: true
      }])}</tool_calls_update>`;
      
      yield ToolExecutionUtils.emitExecutionEvent({type: 'tool_start', id: displayToolId, name: toolName});
      
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
        
        // Show completion
        const duration_ms = Date.now() - toolStartTime;
        const toolCallInfo = ToolExecutionUtils.createToolCallSuccessInfo(toolName, toolArguments, result.content, duration_ms, result.isError);
        
        yield ToolExecutionUtils.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms, isError: result.isError});
        yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
        
      } catch (error) {
        const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
        const errorResult = {
          toolName: toolCall.function.name,
          content: errorMessage,
          isError: true
        };
        toolResults.push(errorResult);
        
        conversationMessages.push({
          role: 'tool',
          content: `Tool ${toolCall.function.name} error: ${errorResult.content}`
        });
        
        // Show error completion
        const duration_ms = Date.now() - toolStartTime;
        const toolCallInfo = ToolExecutionUtils.createToolCallErrorInfo(toolName, toolArguments, errorMessage, duration_ms);
        
        yield ToolExecutionUtils.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms, isError: true});
        yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
      }
    }
    
    return toolResults;
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
    const { McpClient } = await import('../connectors/mcp_client');
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


}
