import { RequestContext } from '../logger';
import { getOllamaClient } from '../ollama_client';
import { simpleChatOllamaStream } from "./simple_ollama_stream";
import { MODELS } from '../model_manager';
import { FunctionTool } from '../ollama_tools';
import { Message } from 'ollama';
import { CancellationToken, globalCancellationToken } from '../utils/cancellation';
import { ThinkingState, ToolExecutionUtils } from './tool_execution_utils';
import log from 'electron-log/main';


interface ConductorContext {
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
      { role: 'system', content: toolPrompt + '\n\nCRITICAL: You MUST always use <think></think> tags to show your structured reasoning before taking any action or providing responses. This is mandatory - no action should be taken without first completing your thinking analysis.' },
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
      const MAX_ITERATIONS = 50;
      let shouldContinue = true;
      let iterationCount = 0;
      
      // Create conductor context object
      const conductorContext: ConductorContext = {
        conversationMessages,
        toolCalls,
        requestContext,
        cancellationToken
      };
      
      // Main execution loop
      while (shouldContinue && 
             !cancellationToken.isCancelled && 
             iterationCount < MAX_ITERATIONS) {
        
        iterationCount++;
        log.info(`[Conductor] Iteration ${iterationCount}/${MAX_ITERATIONS}`);
        
        // Check for max iteration limit
        if (iterationCount >= MAX_ITERATIONS) {
          log.warn(`[Conductor] Hit max iteration limit (${MAX_ITERATIONS}), ending conversation`);
          yield `\n\n[Conductor] **Note**: Conversation ended after ${MAX_ITERATIONS} iterations to prevent infinite loops.`;
          break;
        }
        
        // Execute the tool execution handler
        shouldContinue = yield* this.handleToolExecutionLoop(conductorContext);
      }
      
    } catch (error) {
      log.error('[Conductor] CONDUCTOR ERROR:', error);
      log.error('[Conductor] ERROR STACK:', error instanceof Error ? error.stack : 'No stack');
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield `\n[Conductor] Error in conductor mode: ${errorMessage}`;
    }
  }

  /**
   * Tool execution loop - handles tool decisions, calls, and reflections
   * Returns boolean indicating whether to continue the loop
   */
  private async *handleToolExecutionLoop(context: ConductorContext): AsyncGenerator<string, boolean> {
    try {
      // PHASE 1+2 COMBINED: Thinking, planning, and action in single LLM call
      log.info('[Conductor] Starting Phase 1+2: Thinking, Planning, and Action (single call)');
      const combinedContext = await this.ragRetrieve("phase_1_and_2_combined");
      context.conversationMessages.push({ role: 'system', content: combinedContext });
      
      // Single call that includes thinking and potential tool execution
      const result = yield* this.streamAndStopOnToolCall(
        context.conversationMessages, 
        context.toolCalls, 
        context.cancellationToken
      );

      log.info('[Conductor] Phase 1+2 complete. Result:', result);
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
        
        // PHASE 3: Reflection and decision for next action (single LLM call)
        log.info('[Conductor] Starting Phase 3: Reflection and Next Decision');
        const reflectionContext = await this.ragRetrieve("phase_3_reflection_and_decision");
        context.conversationMessages.push({ role: 'system', content: reflectionContext });
        
        // Stream the reflection and decision phase to generate thinking blocks and next action
        const reflectionResult = yield* this.streamAndStopOnToolCall(
          context.conversationMessages,
          context.toolCalls,
          context.cancellationToken
        );
        
        log.info('[Conductor] Phase 3 complete. Reflection result:', reflectionResult);
        
        // If the reflection phase decides to call more tools, continue the loop
        if (reflectionResult.toolCall) {
          return true; // Continue the loop
        } else {
          return false; // End the conversation
        }
      } else {
        return false; // End the conversation
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
      phase_1_and_2_combined: `
        CRITICAL REQUIREMENT: You MUST start your response with structured thinking in <think></think> tags, then take action based on your analysis. NO exceptions.

        <think>
        Step 1 - Understanding the Query:
        - What exactly is the user asking for?
        - What are the key components of their request?
        - Are there any ambiguities that need clarification?

        Step 2 - Knowledge Assessment:
        - Do I have sufficient knowledge to answer this directly?
        - What information gaps exist, if any?
        - What domain knowledge is required?

        Step 3 - Approach Planning:
        - What is the best approach to help the user?
        - Should I provide a direct answer or use tools?
        - What would be the most helpful response format?

        Step 4 - Tool Evaluation (if applicable):
        - Which tools could potentially help with this query?
        - What are the pros and cons of each relevant tool?
        - What parameters would each tool need?

        Step 5 - Action Plan:
        - Based on my analysis, what should I do next?
        - If using tools: which specific tool with which parameters?
        - If answering directly: what key points should I cover?
        </think>

        Now execute your planned action - either:
        1. Call the specific tool you identified in your thinking with the correct parameters, OR
        2. Provide a complete direct answer if you determined that was the best approach

        Remember to use the exact parameters you planned in your thinking. If calling a tool, ensure ALL required parameters are provided correctly.
      `,
      phase_3_reflection_and_decision: `
        You MUST start with thorough analysis in <think></think> tags, then take action based on your analysis.

        <think>
        Step 1 - Tool Result Analysis:
        - What did the tool(s) accomplish? Were they successful?
        - If any tools failed, what were the specific error messages and causes?
        - How do these results relate to the user's original question?

        Step 2 - Completeness Assessment:
        - Does the current information fully answer the user's question?
        - What information is still missing or unclear?
        - Are there any follow-up questions the user might have?

        Step 3 - Error Analysis (if applicable):
        - Did any tools fail due to parameter issues? What were the exact problems?
        - Can I fix the parameters and retry?
        - Are there alternative tools that might work better?

        Step 4 - Next Action Planning:
        - Should I call another tool to gather more information?
        - If so, which tool and with what CORRECTED parameters?
        - Or do I have sufficient information to provide a final answer?
        - What would be most helpful to the user at this point?

        Step 5 - Decision:
        - Based on my analysis, my next action should be: [clear decision]
        </think>
        
        Now execute your decision - either:
        - Call another tool with CORRECT parameters based on your analysis, OR 
        - Provide your final comprehensive answer to the user if you have sufficient information
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
          
          const thinkingEvents = ToolExecutionUtils.processThinkingInContent(partContent, thinkingState);
          
          if (thinkingEvents.length > 0) {
            log.info(`[Conductor] Generated ${thinkingEvents.length} thinking events`);
            for (const thinkingEvent of thinkingEvents) {
              log.info(`[Conductor] Thinking event: ${thinkingEvent}`);
              yield thinkingEvent;
            }
          }
          
          // Always yield the actual content - the frontend will handle thinking block extraction
          log.info(`[Conductor] Streaming content part: ${partContent}`);
          yield partContent;
          
          content += partContent;
        }
        
        if (part.message?.tool_calls && !shouldStop) {
          if (options.stopOnToolCall) {
            shouldStop = true;
            stopReason = 'tool_calls_detected';
            abortController.abort();
          }
          log.info('[Conductor] Stopping due to tool calls detected');
          log.info('[Conductor] Tool calls found:', JSON.stringify(part.message.tool_calls));
          toolCallsFound.push(...part.message.tool_calls);
        } else if (part.message?.tool_calls && options.stopOnThinking) {
          log.info('[Conductor] Ignoring tool calls during thinking-only phase');
        }
      }
      
    } catch (error) {
      if ((error as any).name === 'AbortError') {
        // Generation stopped successfully - no need to log this as it's expected
        log.info(`[Conductor] Stream stopped successfully: ${stopReason}`);
      } else {
        log.error('[Conductor] Unexpected error during streaming:', error);
        throw error;
      }
    }
    
    // Handle content scrubbing for thinking
    if (shouldStop && stopReason === 'thinking_complete' && content.includes('</think>')) {
      const thinkEndIndex = content.indexOf('</think>') + '</think>'.length;
      content = content.substring(0, thinkEndIndex);
      log.info('[Conductor] Trimmed content to thinking completion');
    }
    
    // Add message to conversation
    conversationMessages.push({
      role: 'assistant',
      content: content,
      tool_calls: toolCallsFound.length > 0 ? toolCallsFound : undefined
    });
    
    log.info(`[Conductor] Final result - Content length: ${content.length}, Tool calls: ${toolCallsFound.length}, Stopped: ${shouldStop}, Reason: ${stopReason}`);
    
    return {
      content,
      toolCalls: toolCallsFound,
      stopped: shouldStop,
      stopReason
    };
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
}
