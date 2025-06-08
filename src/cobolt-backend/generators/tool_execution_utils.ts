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
