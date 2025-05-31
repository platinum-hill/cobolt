/**
 * Message interface for chat messages
 */
export interface ToolCall {
  name: string;
  arguments: string;
  result: string;
  isError?: boolean;
}

export interface Message {
  id: string;
  content: string;
  sender: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
}

export interface ToolInfo {
  serverName: string;
  name: string;
  description: string;
}
