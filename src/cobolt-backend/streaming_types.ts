// New types to support streaming content with tool calls

export interface StreamingToolResponse {
  // Stream content immediately as it arrives
  contentStream: AsyncGenerator<string>;
  // Promise that resolves with complete tool calls when ready
  toolCallsPromise: Promise<any[]>;
  // Promise that resolves with full content when streaming is complete
  fullContentPromise: Promise<string>;
}

export interface ToolCallStreamEvent {
  type: 'content' | 'tool_call_detected' | 'tool_call_complete';
  content?: string;
  toolCall?: any;
  isComplete?: boolean;
}
