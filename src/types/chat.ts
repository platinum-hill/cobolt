/**
 * Global chat mode type definition
 * Used across frontend and backend to ensure consistency
 */
export type ChatMode = 'CONTEXT_AWARE' | 'ONLINE';

/**
 * Chat interface with global chat mode type
 */
export interface Chat {
  id: string;
  title: string;
  chat_mode: ChatMode;
  created_at: Date;
  lastMessage?: string;
}

/**
 * Chat history message interface
 */
export interface ChatHistoryMessage {
  role: string; // 'user', 'assistant', or 'tool'
  content: string;
}
