import { RequestContext } from '../logger';
import { getOllamaClient } from '../ollama_client';
import { simpleChatOllamaStream } from "./simple_ollama_stream";
import { MODELS } from '../model_manager';
import { FunctionTool } from '../ollama_tools';
import { Message } from 'ollama';
import { CancellationToken, globalCancellationToken } from '../utils/cancellation';
import { ThinkingState, ToolExecutionUtils } from './tool_execution_utils';
import log from 'electron-log/main';

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
    // Check tool support first - use the tools model for consistency
    const modelSupportsTools = await ToolExecutionUtils.modelSupportsTools(MODELS.TOOLS_MODEL, requestContext);
    
    // If no tools, fall back to simple chat but still with thinking processing
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
      { role: 'system', content: toolPrompt + '\n\nIMPORTANT: Always use <think></think> tags to show your reasoning before taking any action or providing responses.' },
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
        log.info(`[Conductor] Phase ${currentPhase} (${totalPhaseCount}/${MAX_PHASES})`);
        
        // Check for max phase limit
        if (totalPhaseCount >= MAX_PHASES) {
          log.warn(`[Conductor] Hit max phase limit (${MAX_PHASES}), ending conversation`);
          yield `\n\n[Conductor] **Note**: Conversation ended after ${MAX_PHASES} phases to prevent infinite loops.`;
          break;
        }
        
        // Execute current phase and get next phase
        const phaseHandler: (ctx: PhaseContext) => AsyncGenerator<string, PhaseState> =
          phaseHandlers[currentPhase as keyof typeof phaseHandlers];
        if (!phaseHandler) {
          log.error(`[Conductor] Unknown phase: ${currentPhase}`);
          break;
        }
        
        const nextPhase: PhaseState = yield* phaseHandler(phaseContext);
        currentPhase = nextPhase;
      }
      
    } catch (error) {
      log.error('[Conductor] CONDUCTOR ERROR:', error);
      log.error('[Conductor] ERROR STACK:', error instanceof Error ? error.stack : 'No stack');
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
      
      return PHASE_STATES.TOOL_EXECUTION_LOOP;
    } catch (error) {
      log.error('[Conductor] Error in initial processing:', error);
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
        const reflectionContext = await this.ragRetrieve("phase_3_reflection_and_decision");
        context.conversationMessages.push({ role: 'system', content: reflectionContext });
        
        // Stream the reflection and decision phase to generate thinking blocks and next action
        const reflectionResult = yield* this.streamAndStopOnToolCall(
          context.conversationMessages,
          context.toolCalls,
          context.cancellationToken
        );
        
        // If the reflection phase decides to call more tools, continue the loop
        if (reflectionResult.toolCall) {
          return PHASE_STATES.TOOL_EXECUTION_LOOP;
        } else {
          return PHASE_STATES.END_CONVERSATION;
        }
      } else {
        return PHASE_STATES.END_CONVERSATION;
      }
    } catch (error) {
      log.error('[Conductor] Error in tool execution loop:', error);
      throw error;
    }
  }

  /**
   * RAG retrieval for phase-specific content
   */
  private async ragRetrieve(phaseKey: string): Promise<string> {
    const phasePrompts: Record<string, string> = {
      phase_1_combined: `
        You MUST start your response by thinking through the user's query. Wrap ALL your reasoning in <think></think> tags before providing your response.

        MANDATORY FORMAT:
        <think>
        Let me analyze this user query step by step:
        1. What is the user asking for?
        2. What information do I need to provide a complete answer?
        3. Do I have sufficient knowledge to answer directly?
        4. What approach should I take to best help the user?
        </think>

        [Your response to the user here]

        Remember: You MUST include the <think></think> section at the start of your response.
      `,
      phase_2_decision: `
        Based on the user's query and our conversation so far, determine if using tools would help provide a better response.
        
        You MUST start with your reasoning in <think></think> tags:
        <think>
        Let me analyze the available tools and determine which would be most helpful for this specific query:
        1. What specific information or capability does the user need?
        2. Which tools can provide that capability?
        3. What are the pros/cons of each relevant tool?
        4. What parameters should be used and why? Check tool definitions carefully for required parameters!
        5. For GitHub tools, remember that 'owner' and 'repo' are usually separate required parameters (e.g., owner: "platinum-hill", repo: "cobolt")
        6. Are there any risks or limitations to consider?
        7. Do I have enough information to answer completely, or would tools help?
        
        Based on this analysis, I should either call a tool or provide a direct answer.
        </think>
        
        Then either:
        - Call a specific tool with ALL required parameters if it would enhance your response, OR
        - Provide a complete answer if you have sufficient information
        
        IMPORTANT: When using GitHub tools, always provide 'owner' and 'repo' as separate parameters, not combined as "owner/repo".
      `,
      phase_3_reflection_and_decision: `
        Analyze the tool call results and decide on the next action. You MUST start with comprehensive analysis in <think></think> tags:
        
        <think>
        Let me analyze the tool results thoroughly:
        1. What did the tool(s) accomplish? Were they successful?
        2. If any tools failed due to parameter validation errors, what were the specific issues?
        3. How do these results help answer the user's original question?
        4. What information is still missing or unclear?
        5. Did any tools fail? If so, what alternative approaches could work?
        6. For failed GitHub tools, can I fix the parameters (e.g., separate owner/repo correctly)?
        7. Should I use another tool to gather more information, or do I have enough to provide a complete answer?
        8. If using another tool, which one and with what CORRECT parameters?
        
        Based on this analysis, I need to decide my next action.
        </think>
        
        Based on your analysis, either:
        - Call another tool with CORRECT parameters (especially for GitHub tools: owner and repo must be separate), OR 
        - Provide your final response to the user if you have sufficient information
        
        Remember: GitHub repository references like "platinum-hill/cobolt" should be split into owner: "platinum-hill" and repo: "cobolt"
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
    
    log.info(`[Conductor] ${options.description} - Starting with thinking state:`, thinkingState);

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
          break;
        }
        
        if (part.message?.content) {
          const partContent = part.message.content;
          
          // Debug: Check if thinking tags are present
          if (partContent.includes('<think>') || partContent.includes('</think>')) {
            log.info('[Conductor] Thinking content detected in part:', partContent.substring(0, 200) + '...');
          }
          
          const thinkingEvents = ToolExecutionUtils.processThinkingInContent(partContent, thinkingState);
          
          if (thinkingEvents.length > 0) {
            log.info(`[Conductor] Generated ${thinkingEvents.length} thinking events`);
            for (const thinkingEvent of thinkingEvents) {
              yield thinkingEvent;
            }
          }
          
          // Always yield the actual content - the frontend will handle thinking block extraction
          yield partContent;
          
          content += partContent;
          
          // Check stop conditions
          if (options.stopOnThinking && content.includes('</think>') && !shouldStop) {
            shouldStop = true;
            stopReason = 'thinking_complete';
            abortController.abort();
          }
        }
        
        if (part.message?.tool_calls && !shouldStop) {
          if (options.stopOnToolCall) {
            shouldStop = true;
            stopReason = 'tool_calls_detected';
            abortController.abort();
          }
          toolCallsFound.push(...part.message.tool_calls);
        }
      }
      
    } catch (error) {
      if ((error as any).name === 'AbortError') {
        // Generation stopped successfully - no need to log this as it's expected
      } else {
        log.error('[Conductor] Unexpected error during streaming:', error);
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
    
    // Debug: Log final content to see if thinking tags are present
    if (content.includes('<think>') || content.includes('</think>')) {
      log.info('[Conductor] Final content contains thinking tags. Length:', content.length);
    } else {
      log.info('[Conductor] Final content does NOT contain thinking tags. Content preview:', content.substring(0, 200) + '...');
    }
    
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
   * Validate tool parameters and provide suggestions for improvement
   */
  private validateToolParameters(toolCall: any, availableTools: FunctionTool[]): { 
    isValid: boolean; 
    suggestions: string[]; 
    tool?: FunctionTool;
  } {
    const toolName = toolCall.function.name;
    const toolArgs = toolCall.function.arguments;
    const suggestions: string[] = [];
    
    // Find the tool definition
    const tool = availableTools.find(t => t.toolDefinition.function.name === toolName);
    
    if (!tool) {
      return {
        isValid: false,
        suggestions: [
          `Tool '${toolName}' not found`,
          `Available tools: ${availableTools.map(t => t.toolDefinition.function.name).join(', ')}`,
          'Consider checking the tool name spelling or using a different tool'
        ]
      };
    }
    
    const schema = tool.toolDefinition.function.parameters;
    
    // Basic parameter validation
    if (schema?.required) {
      const missingRequired = schema.required.filter(param => !(param in toolArgs));
      if (missingRequired.length > 0) {
        suggestions.push(`Missing required parameters: ${missingRequired.join(', ')}`);
      }
    }
    
    // Check for empty or null required parameters
    if (schema?.properties) {
      Object.entries(toolArgs).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') {
          suggestions.push(`Parameter '${key}' is empty - consider providing a meaningful value`);
        }
        
        // Type-specific validations
        const propSchema = (schema.properties as any)?.[key];
        if (propSchema?.type === 'string' && typeof value === 'string' && value.length > 1000) {
          suggestions.push(`Parameter '${key}' is very long (${value.length} chars) - consider if this is intentional`);
        }
      });
    }
    
    return {
      isValid: suggestions.length === 0,
      suggestions,
      tool
    };
  }

  /**
   * Execute tools detected in conductor mode with enhanced validation and analysis
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
        // Get available tools for validation
        const { McpClient } = await import('../connectors/mcp_client');
        const availableTools: FunctionTool[] = McpClient.toolCache;
        
        // Validate tool parameters
        const validation = this.validateToolParameters(toolCall, availableTools);
        if (!validation.isValid) {
          const errorMessage = `Invalid tool parameters: ${validation.suggestions.join(' | ')}`;
          log.warn('[Conductor] ' + errorMessage);
          
          // Add the validation error to conversation for learning
          const validationErrorResult = {
            toolName: toolCall.function.name,
            content: errorMessage,
            isError: true,
            analysis: `Parameter validation failed. ${validation.suggestions.join(' ')}`
          };
          toolResults.push(validationErrorResult);
          
          conversationMessages.push({
            role: 'tool',
            content: `Tool ${toolCall.function.name} validation error: ${errorMessage}\n\nSuggestions: ${validation.suggestions.join(', ')}`
          });
          
          const toolCallInfo = ToolExecutionUtils.createToolCallErrorInfo(toolName, toolArguments, errorMessage, Date.now() - toolStartTime);
          yield ToolExecutionUtils.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms: Date.now() - toolStartTime, isError: true});
          yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
          continue;
        }
        
        // Use enhanced tool execution logic with analysis
        const result = await this.executeToolCallWithAnalysis(toolCall, requestContext);
        
        toolResults.push({
          toolName: toolCall.function.name,
          content: result.content,
          isError: result.isError || false,
          analysis: result.analysis
        });
        
        // Add tool result with analysis to conversation
        const toolResultMessage = `Tool ${toolCall.function.name} result: ${result.content}`;
        const analysisMessage = result.analysis ? `\n\nTool Analysis: ${result.analysis}` : '';
        conversationMessages.push({
          role: 'tool',
          content: toolResultMessage + analysisMessage
        });
        
        // Show completion
        const duration_ms = Date.now() - toolStartTime;
        const toolCallInfo = ToolExecutionUtils.createToolCallSuccessInfo(toolName, toolArguments, result.content, duration_ms, result.isError);
        
        yield ToolExecutionUtils.emitExecutionEvent({type: 'tool_complete', id: displayToolId, duration_ms, isError: result.isError});
        yield `<tool_calls_complete>${JSON.stringify([toolCallInfo])}</tool_calls_complete>`;
        
      } catch (error) {
        const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
        const errorAnalysis = `Unexpected error during tool execution. Consider: 1) Retrying with different parameters, 2) Using alternative tools, 3) Checking if the requested operation is valid.`;
        const errorResult = {
          toolName: toolCall.function.name,
          content: errorMessage,
          isError: true,
          analysis: errorAnalysis
        };
        toolResults.push(errorResult);
        
        conversationMessages.push({
          role: 'tool',
          content: `Tool ${toolCall.function.name} error: ${errorResult.content}\n\nError Analysis: ${errorAnalysis}`
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
   * Execute a single tool call with enhanced error handling and result analysis
   */
  private async executeToolCallWithAnalysis(
    toolCall: any,
    requestContext: RequestContext
  ): Promise<{ content: string; isError: boolean; analysis?: string }> {
    
    const toolName = toolCall.function.name;
    const toolArgs = toolCall.function.arguments;
    
    // Find the tool in available tools
    const { McpClient } = await import('../connectors/mcp_client');
    const toolCalls: FunctionTool[] = McpClient.toolCache;
    const tool = toolCalls.find((tool) => tool.toolDefinition.function.name === toolName);
    
    if (!tool || tool.type !== "mcp") {
      return {
        content: `Error: Tool '${toolName}' not found`,
        isError: true,
        analysis: `Tool lookup failed - '${toolName}' is not available in the current tool cache. Available tools: ${toolCalls.map(t => t.toolDefinition.function.name).join(', ')}`
      };
    }
    
    try {
      // Log tool execution for debugging  
      log.info(`[Conductor] Executing tool '${toolName}' with args:`, JSON.stringify(toolArgs, null, 2));
      
      // Execute tool using existing MCP function
      const toolResponse = await tool.mcpFunction(requestContext, toolCall);
      
      let resultText = '';
      let analysis = '';
      
      if (toolResponse.isError) {
        resultText = toolResponse.content?.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('') || 'Tool call failed';
        analysis = `Tool execution failed. Error details: ${resultText}. Tool was called with args: ${JSON.stringify(toolArgs)}. Consider: 1) Checking if parameters are valid, 2) Trying alternative tools, 3) Simplifying the request.`;
        return { content: resultText, isError: true, analysis };
      } else if (!toolResponse.content || toolResponse.content.length === 0) {
        resultText = 'Tool executed successfully (no content returned)';
        analysis = 'Tool completed successfully but returned no content. This might be expected for action tools, or could indicate the tool found no relevant results.';
      } else {
        resultText = toolResponse.content.map(item => 
          item.type === "text" ? item.text as string : JSON.stringify(item)
        ).join('');
        
        // Analyze result quality
        const resultLength = resultText.length;
        if (resultLength > 10000) {
          analysis = 'Tool returned a large amount of data. Consider if this fully addresses the user query or if additional filtering/processing is needed.';
        } else if (resultLength < 50) {
          analysis = 'Tool returned a brief result. Verify this adequately addresses the user query or if additional tools might be needed for completeness.';
        } else {
          analysis = 'Tool returned a reasonable amount of data. Assess if this information sufficiently addresses the user query.';
        }
      }
      
      return { content: resultText, isError: false, analysis };
      
    } catch (error: any) {
      const errorMessage = `Tool execution failed: ${error.message || String(error)}`;
      const analysis = `Unexpected error during tool execution: ${error.message}. Tool was called with args: ${JSON.stringify(toolArgs)}. Consider: 1) Retrying with different parameters, 2) Using alternative tools, 3) Checking if the requested operation is valid.`;
      return { content: errorMessage, isError: true, analysis };
    }
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
