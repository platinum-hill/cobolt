import React from 'react';
import { Clipboard } from 'lucide-react';
import ToolCallBlock from './ToolCallBlock';
import ThinkingBlock from './ThinkingBlock';
import TextBlock from './TextBlock';

interface MessageBlockProps {
  message: any;
  messageIndex: number;
  isLoading: boolean;
  contentBlocks: any[];
  collapsedToolCalls: any;
  toggleToolCall: (messageId: string, toolIndex: number) => void;
  executionState: any;
  toolCallsRefs: React.MutableRefObject<any>;
  collapsedThinking: any;
  toggleThinking: (blockId: string) => void;
  thinkingBlockRefs: React.MutableRefObject<any>;
  formatDuration: (durationMs: number) => string;
  safeStringify: (value: any) => string;
  totalMessages: number;
}

function MessageBlock({
  message,
  messageIndex,
  isLoading,
  contentBlocks,
  collapsedToolCalls,
  toggleToolCall,
  executionState,
  toolCallsRefs,
  collapsedThinking,
  toggleThinking,
  thinkingBlockRefs,
  formatDuration,
  safeStringify,
  totalMessages,
}: MessageBlockProps) {
  const isLastMessage = messageIndex === totalMessages - 1;

  return (
    <div
      key={message.id}
      className={message.sender === 'user' ? 'user-message-wrapper' : ''}
    >
      <div
        className={`message ${
          message.sender === 'user' ? 'user-message' : 'assistant-message'
        }${
          isLoading && isLastMessage && message.sender === 'assistant'
            ? ' loading'
            : ''
        }`}
      >
        {message.sender === 'assistant' ? (
          <div className="assistant-message-content">
            {/* Sequential rendering of content blocks */}
            {contentBlocks.map((block, blockIndex) => {
              if (block.type === 'text') {
                return (
                  <TextBlock
                    key={block.id || blockIndex}
                    block={block}
                    blockIndex={blockIndex}
                    safeStringify={safeStringify}
                  />
                );
              }

              if (block.type === 'tool_call' && block.toolCall) {
                return (
                  <ToolCallBlock
                    key={block.id || blockIndex}
                    block={block}
                    message={message}
                    blockIndex={blockIndex}
                    collapsedToolCalls={collapsedToolCalls}
                    toggleToolCall={toggleToolCall}
                    executionState={executionState}
                    toolCallsRefs={toolCallsRefs}
                    formatDuration={formatDuration}
                  />
                );
              }

              if (block.type === 'thinking' && block.id) {
                return (
                  <ThinkingBlock
                    key={block.id || blockIndex}
                    block={block}
                    blockIndex={blockIndex}
                    collapsedThinking={collapsedThinking}
                    toggleThinking={toggleThinking}
                    thinkingBlockRefs={thinkingBlockRefs}
                    safeStringify={safeStringify}
                    message={message}
                    executionState={executionState}
                    formatDuration={formatDuration}
                  />
                );
              }

              return null;
            })}

            <div className="message-actions">
              <button
                type="button"
                className="copy-button"
                onClick={() => navigator.clipboard.writeText(message.content)}
                title="Copy"
                aria-label="Copy"
              >
                <Clipboard size={16} />
              </button>
            </div>
          </div>
        ) : (
          message.content
        )}
      </div>
    </div>
  );
}

export default MessageBlock;
