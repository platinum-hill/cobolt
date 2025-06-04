// Execution State Store - COMPLETELY SEPARATE from conversation content
// This ensures execution metadata NEVER pollutes AI context

interface ExecutionEvent {
  id: string;
  messageId: string;
  type: 'tool_start' | 'tool_complete' | 'thinking_start' | 'thinking_complete';
  timestamp: number;
  toolName?: string;
  status: 'executing' | 'complete' | 'error';
  duration_ms?: number;
  isError?: boolean;
  arguments?: string;
  result?: string;
}

interface MessageExecutionState {
  [messageId: string]: {
    toolCalls: ExecutionEvent[];
    thinkingBlocks: ExecutionEvent[];
  };
}

class ExecutionStore {
  private state: MessageExecutionState = {};
  private listeners: Set<() => void> = new Set();

  // Add execution event without touching message content
  addExecutionEvent(event: ExecutionEvent) {
    if (!this.state[event.messageId]) {
      this.state[event.messageId] = { toolCalls: [], thinkingBlocks: [] };
    }

    if (event.type.includes('tool')) {
      this.state[event.messageId].toolCalls.push(event);
    } else if (event.type.includes('thinking')) {
      this.state[event.messageId].thinkingBlocks.push(event);
    }

    this.notifyListeners();
  }

  // Update execution event
  updateExecutionEvent(eventId: string, updates: Partial<ExecutionEvent>) {
    for (const messageState of Object.values(this.state)) {
      // Update in tool calls
      const toolIndex = messageState.toolCalls.findIndex(e => e.id === eventId);
      if (toolIndex !== -1) {
        messageState.toolCalls[toolIndex] = { ...messageState.toolCalls[toolIndex], ...updates };
        this.notifyListeners();
        return;
      }

      // Update in thinking blocks
      const thinkingIndex = messageState.thinkingBlocks.findIndex(e => e.id === eventId);
      if (thinkingIndex !== -1) {
        messageState.thinkingBlocks[thinkingIndex] = { ...messageState.thinkingBlocks[thinkingIndex], ...updates };
        this.notifyListeners();
        return;
      }
    }
  }

  // Get execution state for a message (NEVER in conversation content)
  getMessageExecutionState(messageId: string) {
    return this.state[messageId] || { toolCalls: [], thinkingBlocks: [] };
  }

  // Subscribe to execution state changes
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener());
  }

  // Clear execution state for a message
  clearMessageState(messageId: string) {
    delete this.state[messageId];
    this.notifyListeners();
  }

  // Get all state (for debugging)
  getAllState() {
    return { ...this.state };
  }
}

// Singleton instance
export const executionStore = new ExecutionStore();
export type { ExecutionEvent, MessageExecutionState };
