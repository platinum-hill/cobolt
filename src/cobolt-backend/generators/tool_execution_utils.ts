import { getOllamaClient } from '../ollama_client';
import { RequestContext, TraceLogger } from '../logger';

export interface ExecutionEvent {
  type: 'tool_start' | 'tool_complete' | 'thinking_start' | 'thinking_complete';
  id: string;
  name?: string;
  duration_ms?: number;
  isError?: boolean;
}

export type ThinkingState = {
  isInThinkingBlock: boolean;
  thinkingContent: string;
  currentThinkingId: string | null;
  thinkingStartTime: number | null;
};

export class ToolExecutionUtils {
  /**
   * Check if a model supports tool calling - fast capabilities-only check
   */
  static async modelSupportsTools(modelName: string, requestContext?: RequestContext): Promise<boolean> {
    const startTime = Date.now();
    
    if (requestContext) {
      TraceLogger.trace(requestContext, 'model-supports-tools-check-start', modelName);
    }

    try {
      // Get model info and check capabilities field
      const ollama = getOllamaClient();
      const modelInfo = await (ollama as any).show({ name: modelName });
      
      if (requestContext) {
        TraceLogger.trace(requestContext, 'model-info-retrieved', 'success');
        TraceLogger.trace(requestContext, 'model-capabilities', JSON.stringify((modelInfo as any).capabilities || []));
        TraceLogger.trace(requestContext, 'model-families', JSON.stringify(modelInfo.details?.families || []));
        TraceLogger.trace(requestContext, 'tool-support-check-duration-ms', Date.now() - startTime);
      }

      // Check if capabilities includes tools support
      const supportsTools = (modelInfo as any).capabilities?.includes('tools') || 
                           (modelInfo as any).capabilities?.includes('function_calling');
      
      if (requestContext) {
        TraceLogger.trace(requestContext, 'model-supports-tools-result', supportsTools.toString());
      }
      
      return supportsTools;
      
    } catch (error) {
      if (requestContext) {
        TraceLogger.trace(requestContext, 'model-supports-tools-error', error instanceof Error ? error.message : String(error));
        TraceLogger.trace(requestContext, 'model-supports-tools-result', 'false');
        TraceLogger.trace(requestContext, 'tool-support-check-duration-ms', Date.now() - startTime);
      }
      console.warn(`Could not check tool support for ${modelName}:`, error);
      return false; // assume no tools if we can't check
    }
  }

  
  
  static createToolCallErrorInfo(toolName: string, toolArguments: string, errorMessage: string, duration_ms: number) {
    return {
      name: toolName,
      arguments: toolArguments,
      result: errorMessage,
      isError: true,
      duration_ms
    };
  }

  static createToolCallSuccessInfo(toolName: string, toolArguments: string, result: string, duration_ms: number, isError: boolean) {
    return {
      name: toolName,
      arguments: toolArguments,
      result,
      isError,
      duration_ms
    };
  }

  static emitExecutionEvent(event: ExecutionEvent): string {
    return `<execution_event>${JSON.stringify(event)}</execution_event>`;
  }

  static processThinkingInContent(content: string, thinkingState: ThinkingState): string[] {
    const events: string[] = [];
    
    // Check for thinking block start
    if (content.includes('<think>') && !thinkingState.isInThinkingBlock) {
      thinkingState.isInThinkingBlock = true;
      thinkingState.thinkingStartTime = Date.now();
      const thinkingId = `thinking-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      thinkingState.currentThinkingId = thinkingId;
      events.push(ToolExecutionUtils.emitExecutionEvent({
        type: 'thinking_start',
        id: thinkingId
      }));
    }
    
    // Check for thinking block end
    if (content.includes('</think>') && thinkingState.isInThinkingBlock) {
      thinkingState.isInThinkingBlock = false;
      if (thinkingState.currentThinkingId && thinkingState.thinkingStartTime) {
        const duration_ms = Date.now() - thinkingState.thinkingStartTime;
        events.push(ToolExecutionUtils.emitExecutionEvent({
          type: 'thinking_complete',
          id: thinkingState.currentThinkingId,
          duration_ms: duration_ms
        }));
        thinkingState.currentThinkingId = null;
        thinkingState.thinkingStartTime = null;
      }
    }
    
    return events;
  }
}
