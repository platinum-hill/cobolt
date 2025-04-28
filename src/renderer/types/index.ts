/**
 * Message interface for chat messages
 */
export interface Message {
  id: string;
  content: string;
  sender: string;
  timestamp: Date;
}

export interface ToolInfo {
  serverName: string;
  name: string;
  description: string;
}
