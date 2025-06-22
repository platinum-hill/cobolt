import { RequestContext } from '../logger';
import { getOllamaClient } from '../ollama_client';
import { simpleChatOllamaStream } from "./simple_ollama_stream";
import { MODELS } from '../model_manager';
import { FunctionTool } from '../ollama_tools';
import { Message } from 'ollama';
import { CancellationToken, globalCancellationToken } from '../utils/cancellation';
import { ThinkingState, ToolExecutionUtils } from './tool_execution_utils';

const PHASE_STATES = {
  INITIAL_PROCESSING: 1,
  TOOL_EXECUTION_LOOP: 2,
  END_CONVERSATION: -1
} as const;

type PhaseState = typeof PHASE_STATES[keyof typeof PHASE_STATES];

interface PhaseContext {
  conversationMessages: Message[];
  toolCalls: FunctionTool[];
  requestContext: RequestContext;
  cancellationToken: CancellationToken;
}

interface StreamOptions {
  model: string;
  contextLength: number;
  stopOnToolCall?: boolean;
  stopOnThinking?: boolean;
  description: string;
}

interface StreamResult {
  content: string;
  toolCalls: any[];
  stopped: boolean;
  stopReason?: string;
}

export class ConductorGenerator {
  
  /**
   * Create a generator for the conductor response
   * This handles the entire conversation flow with tool calls and RAG retrieval
   */
  async *createConductorResponseGenerator(
    requestContext: RequestContext,
    systemPrompt: string,
    toolPrompt: string,
    toolCalls: FunctionTool[],
    memories: string,
    cancellationToken: CancellationToken = globalCancellationToken
  ): AsyncGenerator<string> {
    // Check tool support first
    const modelSupportsTools = await ToolExecutionUtils.modelSupportsTools(MODELS.CHAT_MODEL, requestContext);
    
    // If no tools, bail immediately to simple chat
    if (!modelSupportsTools) {
      const simpleChatStream = simpleChatOllamaStream(requestContext, systemPrompt, memories);
      for await (const content of simpleChatStream) {
        if (cancellationToken.isCancelled) {
          return;
        }
        yield content;
      }
      return;
    }
    
    const messages: Message[] = [
      { role: 'system', content: toolPrompt },
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
      let currentPhase: PhaseState = PHASE_STATES.INITIAL_PROCESSING;
      let totalPhaseCount = 0;
      const MAX_PHASES = 50;
      
      // Create phase context object
      const phaseContext: PhaseContext = {
        conversationMessages,
        toolCalls,
        requestContext,
        cancellationToken
      };
      
      // Define phase handlers - each returns the next phase to execute
      const phaseHandlers = {
        [PHASE_STATES.INITIAL_PROCESSING]: this.handleInitialProcessing.bind(this),
        [PHASE_STATES.TOOL_EXECUTION_LOOP]: this.handleToolExecutionLoop.bind(this)
      };
      
      // Main state machine loop
      while (currentPhase !== PHASE_STATES.END_CONVERSATION && 
             !cancellationToken.isCancelled && 
             totalPhaseCount < MAX_PHASES) {
        
        totalPhaseCount++;
        console.log(`\n[Conductor] CONDUCTOR MODE - Phase ${currentPhase} (Total: ${totalPhaseCount}/${MAX_PHASES})`);
        
        // Check for max phase limit
        if (totalPhaseCount >= MAX_PHASES) {
          console.log(`[Conductor] CONDUCTOR: Hit max phase limit (${MAX_PHASES}), ending conversation`);
          yield `\n\n[Conductor] **Note**: Conversation ended after ${MAX_PHASES} phases to prevent infinite loops.`;
          break;
        }
        
        // Execute current phase and get next phase
        const phaseHandler: (ctx: PhaseContext) => AsyncGenerator<string, PhaseState> =
          phaseHandlers[currentPhase as keyof typeof phaseHandlers];
        if (!phaseHandler) {
          console.error(`[Conductor] Unknown phase: ${currentPhase}`);
          break;
        }
        
        const nextPhase: PhaseState = yield* phaseHandler(phaseContext);
        currentPhase = nextPhase;
      }
      
    } catch (error) {
      console.error('[Conductor] CONDUCTOR ERROR:', error);
      console.error('[Conductor] ERROR STACK:', error instanceof Error ? error.stack : 'No stack');
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield `\n[Conductor] Error in conductor mode: ${errorMessage}`;
    }
  }

  /**
   * Phase 1: Initial processing - thinking and initial response
   */
  private async *handleInitialProcessing(context: PhaseContext): AsyncGenerator<string, PhaseState> {
    try {
      // Single system prompt that includes both thinking and response instructions
      const combinedPrompt = await this.ragRetrieve("phase_1_combined");
      context.conversationMessages.push({ role: 'system', content: combinedPrompt });
      
      // Single LLM call that does thinking AND response in one go
      yield* this.streamUntilNaturalEnd(context.conversationMessages, context.toolCalls, context.cancellationToken);
      
      console.log('[Conductor] Initial processing complete, moving to tool execution loop');
      return PHASE_STATES.TOOL_EXECUTION_LOOP;
    } catch (error) {
      console.error('[Conductor] Error in initial processing:', error);
      throw error;
    }
  }

  /**
   * Phase 2: Tool execution loop - handles tool decisions, calls, and reflections
   */
  private async *handleToolExecutionLoop(context: PhaseContext): AsyncGenerator<string, PhaseState> {
    try {
      // Add decision prompt and check for tool calls
      const decisionContext = await this.ragRetrieve("phase_2_decision");
      context.conversationMessages.push({ role: 'system', content: decisionContext });
      
      const result = yield* this.streamAndStopOnToolCall(
        context.conversationMessages, 
        context.toolCalls, 
        context.cancellationToken
      );
      
      if (result.toolCall) {
        console.log(`[Conductor] Executing ${result.toolCalls.length} tool(s)`);
        
        // Execute tools
        const toolExecutionGenerator = this.executeConductorTools(
          result.toolCalls,
          context.requestContext,
          context.conversationMessages
        );
        
        let toolGenResult;
        do {
          toolGenResult = await toolExecutionGenerator.next();
          if (!toolGenResult.done && toolGenResult.value) {
            yield toolGenResult.value;
          }
        } while (!toolGenResult.done);
        
        // Add reflection and decision prompts
        const reflectionContext = await this.ragRetrieve("phase_3_reflection");
        context.conversationMessages.push({ role: 'system', content: reflectionContext });
        
        const nextActionContext = await this.ragRetrieve("phase_4_decision");
        context.conversationMessages.push({ role: 'system', content: nextActionContext });
        
        console.log('[Conductor] Tool execution complete, continuing loop');
        return PHASE_STATES.TOOL_EXECUTION_LOOP;
      } else {
        console.log('[Conductor] No tools requested, ending conversation');
        return PHASE_STATES.END_CONVERSATION;
      }
    } catch (error) {
      console.error('[Conductor] Error in tool execution loop:', error);
      throw error;
    }
  }

  /**
   * RAG retrieval for phase-specific content
   */
  private async ragRetrieve(phaseKey: string): Promise<string> {
    const phasePrompts: Record<string, string> = {
      phase_1_combined: `
        First, give your thoughts on the user's query, then speak to the user with your response.
      `,
      phase_2_decision: `
        If the user's query could be enhanced by using one of your functions, then use a single tool OR end the conversation turn with a brief message.
      `,
      phase_3_reflection: `
        Provide thoughts about the tool call results before proceeding.
      `,
      phase_4_decision: `
        You MUST choose ONE of the following options: Call another tool, OR end the conversation turn.
      `
    };
    
    return phasePrompts[phaseKey]?.trim() || "";
  }

  /**
   * Common streaming logic with configurable stop conditions
   */
  private async *streamWithStopCondition(
    conversationMessages: Message[],
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken,
    options: StreamOptions
  ): AsyncGenerator<string, StreamResult> {
    
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
    
    console.log(`[Conductor] ${options.description}...`);

    try {
      const ollama = getOllamaClient();
      const response = await ollama.chat({
        model: options.model,
        messages: conversationMessages,
        tools: toolCalls.map((toolCall) => toolCall.toolDefinition),
        keep_alive: -1,
        options: {
          num_ctx: options.contextLength,
        },
        stream: true,
        signal: abortController.signal
      } as any);
      
      for await (const part of response) {
        if (cancellationToken.isCancelled) {
          console.log(`[Conductor] User cancellation detected: ${cancellationToken.cancelReason}`);
          break;
        }
        
        if (part.message?.content) {
          const thinkingEvents = ToolExecutionUtils.processThinkingInContent(part.message.content, thinkingState);
          
          if (thinkingEvents.length > 0) {
            for (const thinkingEvent of thinkingEvents) {
              yield thinkingEvent;
            }
          } else {
            yield part.message.content;
          }
          
          content += part.message.content;
          
          // Check stop conditions
          if (options.stopOnThinking && content.includes('</think>') && !shouldStop) {
            shouldStop = true;
            stopReason = 'thinking_complete';
            console.log('[Conductor] DETECTED </think> - stopping generation');
            abortController.abort();
          }
        }
        
        if (part.message?.tool_calls && !shouldStop) {
          if (options.stopOnToolCall) {
            shouldStop = true;
            stopReason = 'tool_calls_detected';
            console.log(`[Conductor] DETECTED TOOL CALL - stopping generation`);
            abortController.abort();
          }
          toolCallsFound.push(...part.message.tool_calls);
        }
      }
      
    } catch (error) {
      if ((error as any).name === 'AbortError') {
        console.log(`[Conductor] Generation stopped successfully: ${stopReason}`);
      } else {
        console.error('[Conductor] Unexpected error during streaming:', error);
        throw error;
      }
    }
    
    // Handle content scrubbing for thinking
    if (shouldStop && stopReason === 'thinking_complete' && content.includes('</think>')) {
      const thinkEndIndex = content.indexOf('</think>') + '</think>'.length;
      content = content.substring(0, thinkEndIndex);
    }
    
    // Add message to conversation
    conversationMessages.push({
      role: 'assistant',
      content: content,
      tool_calls: toolCallsFound.length > 0 ? toolCallsFound : undefined
    });
    
    return {
      content,
      toolCalls: toolCallsFound,
      stopped: shouldStop,
      stopReason
    };
  }
  
  /**
   * Stream until natural end
   */
  private async *streamUntilNaturalEnd(
    conversationMessages: Message[],
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken
  ): AsyncGenerator<string> {
    
    yield* this.streamWithStopCondition(conversationMessages, toolCalls, cancellationToken, {
      model: MODELS.CHAT_MODEL,
      contextLength: MODELS.CHAT_MODEL_CONTEXT_LENGTH,
      description: "Streaming until natural end"
    });
  }
  
  /**
   * Stream and stop when we detect tool call
   */
  private async *streamAndStopOnToolCall(
    conversationMessages: Message[],
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken
  ): AsyncGenerator<string, { toolCall: boolean; toolCalls: any[] }> {
    
    const result = yield* this.streamWithStopCondition(conversationMessages, toolCalls, cancellationToken, {
      model: MODELS.TOOLS_MODEL,
      contextLength: MODELS.TOOLS_MODEL_CONTEXT_LENGTH,
      stopOnToolCall: true,
      description: "Streaming until tool call or natural end"
    });
    
    return {
      toolCall: result.toolCalls.length > 0,
      toolCalls: result.toolCalls
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
