import React, { useRef, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log/renderer';
import useMessages from '../../hooks/useMessages';
import useScrollToBottom from '../../hooks/useScrollToBottom';
import { MessageBlock, ChatInput } from '../MessageBlocks';
import './ChatInterface.css';

interface ChatInterfaceProps {
  isLoading: boolean;
  currentChatId: string | null;
}

// Helper function to safely convert content to string
const safeStringify = (value: any): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
};
const formatDuration = (durationMs: number): string => {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
};
interface ExecutionEvent {
  type: 'tool_start' | 'tool_complete' | 'thinking_start' | 'thinking_complete';
  id: string;
  name?: string;
  duration_ms?: number;
  isError?: boolean;
}

interface ExecutionState {
  [id: string]: {
    type: 'tool' | 'thinking';
    name?: string;
    status: 'executing' | 'complete';
    duration_ms?: number;
    isError?: boolean;
  };
}

const processExecutionEvents = (
  content: string,
): { cleanContent: string; events: ExecutionEvent[] } => {
  const events: ExecutionEvent[] = [];
  let cleanContent = content;

  const eventMatches = content.matchAll(
    /<execution_event>(.*?)<\/execution_event>/gs,
  );
  Array.from(eventMatches).forEach((match) => {
    try {
      const event = JSON.parse(match[1]) as ExecutionEvent;
      events.push(event);
      cleanContent = cleanContent.replace(match[0], '');
    } catch (error) {
      log.error('Failed to parse execution event:', error);
    }
  });

  return { cleanContent, events };
};

// Helper function to process tool-related content blocks
const processToolContentBlocks = (processedContent: string) => {
  const toolCallsMap = new Map<string, any>();

  // Process tool updates (executing status)
  const toolUpdateMatches = processedContent.matchAll(
    /<tool_calls_update>(.*?)<\/tool_calls_update>/gs,
  );
  Array.from(toolUpdateMatches).forEach((match) => {
    try {
      const updateToolCalls = JSON.parse(match[1]);
      updateToolCalls.forEach((updateTool: any, index: number) => {
        const key = `${updateTool.name}-${JSON.stringify(updateTool.arguments)}-${index}`;

        // Skip event block linking for update - updates should modify existing tool calls in map

        toolCallsMap.set(key, updateTool);
      });
    } catch (error) {
      log.error('Failed to parse tool call updates:', error);
    }
  });

  // Process tool completions
  const toolCompleteMatches = processedContent.matchAll(
    /<tool_calls_complete>(.*?)<\/tool_calls_complete>/gs,
  );
  Array.from(toolCompleteMatches).forEach((match) => {
    try {
      const completedToolCalls = JSON.parse(match[1]);
      completedToolCalls.forEach((completedTool: any, index: number) => {
        const key = `${completedTool.name}-${JSON.stringify(completedTool.arguments)}-${index}`;
        const existingTool = toolCallsMap.get(key);

        // Skip event block linking for completion - completions should modify existing tool calls in map

        toolCallsMap.set(key, {
          ...existingTool,
          ...completedTool,
          isExecuting: false,
        });
      });
    } catch (error) {
      log.error('Failed to parse tool call completions:', error);
    }
  });

  // Process final tool calls
  const toolCallMatch = processedContent.match(
    /<tool_calls>(.*?)<\/tool_calls>/s,
  );
  if (toolCallMatch) {
    try {
      const finalToolCalls = JSON.parse(toolCallMatch[1]);
      finalToolCalls.forEach((finalTool: any, index: number) => {
        const key = `${finalTool.name}-${JSON.stringify(finalTool.arguments)}-${index}`;
        const existingTool = toolCallsMap.get(key);
        toolCallsMap.set(key, {
          ...finalTool,
          isExecuting: existingTool?.isExecuting || false,
        });
      });
    } catch (error) {
      log.error('Failed to parse final tool calls:', error);
    }
  }

  return toolCallsMap;
};

// Helper function to process thinking content in a text part
// Uses messageId + index to create stable thinking block IDs
const processThinkingContentBlocks = (
  partContent: string,
  messageId: string,
  messageThinkingIndex: { current: number },
  contentBlocks: any[],
) => {
  let partProcessedContent = partContent;

  // First, handle complete thinking blocks
  const completeThinkingMatches = partProcessedContent.matchAll(
    /<think>(.*?)<\/think>/gs,
  );
  Array.from(completeThinkingMatches).forEach((match) => {
    const thinkingContent = match[1];
    if (thinkingContent.trim()) {
      contentBlocks.push({
        type: 'thinking',
        thinkingContent,
        id: `thinking-${messageId}-${messageThinkingIndex.current}`, // Stable ID using message ID + index
        isComplete: true,
        thinkingBlockIndex: messageThinkingIndex.current, // Thinking block index within this message
      });
      messageThinkingIndex.current += 1;
    }
    // Remove from content to avoid double processing
    partProcessedContent = partProcessedContent.replace(match[0], '');
  });

  // Then, handle incomplete thinking blocks (streaming)
  const incompleteThinkingMatch = partProcessedContent.match(
    /<think>(.*?)(?!<\/think>)$/s,
  );
  if (incompleteThinkingMatch) {
    const thinkingContent = incompleteThinkingMatch[1];
    if (thinkingContent.trim()) {
      contentBlocks.push({
        type: 'thinking',
        thinkingContent,
        id: `thinking-${messageId}-${messageThinkingIndex.current}`, // Stable ID using message ID + index
        isComplete: false,
        thinkingBlockIndex: messageThinkingIndex.current, // Thinking block index within this message
      });
      messageThinkingIndex.current += 1;
    }
    // Remove from content
    partProcessedContent = partProcessedContent.replace(
      incompleteThinkingMatch[0],
      '',
    );
  }

  return partProcessedContent;
};

// Helper function to process text content blocks
const processTextContentBlocks = (
  partContent: string,
  index: number,
  contentBlocks: any[],
  messageId: string,
) => {
  if (partContent.trim()) {
    contentBlocks.push({
      type: 'text',
      content: safeStringify(partContent),
      id: `text-${messageId}-${index}`,
    });
  }
};

// Helper function to add tool call content blocks
const addToolCallContentBlock = (
  toolCallToUse: any,
  currentToolCallIndex: number,
  contentBlocks: any[],
  messageId: string,
) => {
  contentBlocks.push({
    type: 'tool_call',
    toolCall: {
      ...toolCallToUse,
      blockIndex: currentToolCallIndex, // Store the intended index
    },
    id: `tool-${messageId}-${currentToolCallIndex}`,
  });
};

// Removed addRemainingToolCalls function - was creating duplicate tool calls

// Removed complex deduplication logic - tool calls should only be created once

// Sequential content parsing for inline tool rendering
// messageId is used to create stable thinking block IDs that don't change on re-renders
const processMessageContent = (content: string, messageId: string) => {
  // Create immediate tool call dropdowns from execution events
  const { cleanContent, events } = processExecutionEvents(content);
  const processedContent = cleanContent;

  const contentBlocks: Array<{
    type: 'text' | 'tool_call' | 'thinking';
    content?: string;
    toolCall?: any;
    thinkingContent?: string;
    id?: string;
    isComplete?: boolean;
    thinkingBlockIndex?: number;
  }> = [];

  // Store immediate tool call data from execution events (don't add to contentBlocks yet)
  const executionEventBlocks = new Map<string, any>();

  events.forEach((event) => {
    if (event.type === 'tool_start') {
      const immediateToolCall = {
        name: event.name || 'Unknown Tool',
        arguments: 'Loading...', // Placeholder
        result: 'Executing...',
        isExecuting: true,
        duration_ms: undefined,
        isError: false,
        executionEventId: event.id, // Store the event ID for badge mapping
      };

      executionEventBlocks.set(event.id, immediateToolCall);
    }
  });

  // Process all tool-related content blocks
  const toolCallsMap = processToolContentBlocks(processedContent);

  // Parse content using position markers for true inline tool calls
  // Split by position markers to get exact tool call locations
  const parts = processedContent.split(/(<tool_call_position id="[^"]*">)/g);

  let currentToolCallIndex = 0;
  const messageThinkingIndex = { current: 0 }; // Counter for thinking blocks within this specific message
  const toolCallsArray = Array.from(toolCallsMap.values());

  parts.forEach((part, index) => {
    if (part.startsWith('<tool_call_position')) {
      // Insert tool call at this exact position

      // Try to find execution event block for this position
      let toolCallToUse = null;

      // Match tool calls to execution events by position instead of name
      const executionEventsList = Array.from(executionEventBlocks.values());

      if (currentToolCallIndex < toolCallsArray.length) {
        const contentToolCall = toolCallsArray[currentToolCallIndex];
        // Match by position: first tool call gets first execution event, etc.
        const eventBlock =
          currentToolCallIndex < executionEventsList.length
            ? executionEventsList[currentToolCallIndex]
            : null;

        if (eventBlock) {
          // Create a COPY of execution event block to avoid shared references
          toolCallToUse = {
            ...eventBlock, // Spread to create new object
            arguments: contentToolCall.arguments || eventBlock.arguments,
            result: contentToolCall.result || eventBlock.result,
            isExecuting:
              contentToolCall.isExecuting !== undefined
                ? contentToolCall.isExecuting
                : eventBlock.isExecuting,
            duration_ms: contentToolCall.duration_ms || eventBlock.duration_ms,
            isError:
              contentToolCall.isError !== undefined
                ? contentToolCall.isError
                : eventBlock.isError,
            executionEventId: eventBlock.executionEventId, // Preserve event ID for badge mapping
          };
        } else {
          toolCallToUse = contentToolCall;
        }
      } else if (currentToolCallIndex < executionEventsList.length) {
        // No content tool call yet, use next available execution event block
        // Create COPY to avoid shared reference issues
        toolCallToUse = { ...executionEventsList[currentToolCallIndex] };
      }

      if (toolCallToUse) {
        addToolCallContentBlock(
          toolCallToUse,
          currentToolCallIndex,
          contentBlocks,
          messageId,
        );
        currentToolCallIndex += 1;
      }
    } else {
      // Clean content by removing tool call tags
      const cleanPart = part
        .replace(/<tool_calls_update>.*?<\/tool_calls_update>/gs, '')
        .replace(/<tool_calls_complete>.*?<\/tool_calls_complete>/gs, '')
        .replace(/<tool_calls>.*?<\/tool_calls>/gs, '');

      // Process thinking content first
      const partProcessedContent = processThinkingContentBlocks(
        cleanPart,
        messageId,
        messageThinkingIndex,
        contentBlocks,
      );

      // Then handle any remaining text content
      processTextContentBlocks(
        partProcessedContent,
        index,
        contentBlocks,
        messageId,
      );
    }
  });

  // Removed addRemainingToolCalls - no more extra tool calls

  // Return properly ordered content blocks
  return {
    contentBlocks,
    toolCalls: [], // Remove the complex merging - contentBlocks is what actually gets rendered
    thinkingBlocks: contentBlocks
      .filter((block) => block.type === 'thinking')
      .map((block) => safeStringify(block.thinkingContent || '')),
    regularContent: contentBlocks
      .filter((block) => block.type === 'text')
      .map((block) => safeStringify(block.content || ''))
      .join(''),
  };
};

function ChatInterface({
  currentChatId,
  isLoading: externalLoading,
}: ChatInterfaceProps) {
  const [collapsedThinking, setCollapsedThinking] = useState<{
    [key: string]: boolean;
  }>({});
  const [collapsedToolCalls, setCollapsedToolCalls] = useState<{
    [messageId: string]: { [toolIndex: number]: boolean };
  }>({});
  const [manuallyToggledToolCalls, setManuallyToggledToolCalls] = useState<{
    [messageId: string]: { [toolIndex: number]: boolean };
  }>({});
  const [executionState, setExecutionState] = useState<{
    [messageId: string]: ExecutionState;
  }>({});

  const {
    messages,
    inputMessage,
    setInputMessage,
    isLoading: messageLoading,
    setIsLoading,
    setMessages,
    hasMessages,
    handleSendMessage,
  } = useMessages(currentChatId || '');

  // Combine both loading states
  const isLoading = messageLoading || externalLoading;

  const { ref: messagesEndRef } = useScrollToBottom(messages);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toolCallsRefs = useRef<{
    [messageId: string]: { [toolIndex: number]: HTMLDivElement | null };
  }>({});
  const thinkingBlockRefs = useRef<{
    [blockId: string]: HTMLDivElement | null;
  }>({});
  // Removed autoCollapseScheduled refs - simplified dropdown behavior

  // Separate function to adjust textarea height for reuse
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';

    // Set new height based on scrollHeight, but maintain same cap regardless of screen size
    const maxHeight = window.innerHeight * 0.3; // Consistent max height (30% of viewport)
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  };

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      // Adjust textarea height when window resizes to maintain consistent experience
      adjustTextareaHeight();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-resize textarea based on content
  useEffect(() => {
    adjustTextareaHeight();
  }, [inputMessage]);

  const handleCancelMessage = async () => {
    try {
      const result = await window.api.cancelMessage();
      if (result.success) {
        setIsLoading(false);
        setMessages((prev) => [
          ...prev,
          {
            id: uuidv4(),
            content: 'Message generation cancelled.',
            sender: 'assistant',
            timestamp: new Date(),
          },
        ]);
      }
    } catch (error) {
      log.error('Error cancelling message:', error);
    }
  };

  const toggleThinking = (thinkingBlockId: string) => {
    setCollapsedThinking((prev) => ({
      ...prev,
      [thinkingBlockId]: !prev[thinkingBlockId],
    }));
  };

  const toggleToolCall = (messageId: string, toolIndex: number) => {
    setCollapsedToolCalls((prev) => ({
      ...prev,
      [messageId]: {
        ...prev[messageId],
        [toolIndex]: prev[messageId]?.[toolIndex] === false,
      },
    }));

    // Mark this dropdown as manually toggled by user (prevents auto-collapse)
    setManuallyToggledToolCalls((prev) => ({
      ...prev,
      [messageId]: {
        ...prev[messageId],
        [toolIndex]: true,
      },
    }));
  };

  // Auto-open dropdown when tool calls are detected
  useEffect(() => {
    messages.forEach((message) => {
      if (message.sender === 'assistant') {
        const { contentBlocks } = processMessageContent(
          message.content,
          message.id,
        );

        // For each tool call block, if dropdown isn't explicitly set, open it
        const toolCallBlocks = contentBlocks.filter(
          (block) => block.type === 'tool_call',
        );
        toolCallBlocks.forEach((block) => {
          const toolIndex = block.toolCall?.blockIndex ?? 0;
          if (collapsedToolCalls[message.id]?.[toolIndex] === undefined) {
            setCollapsedToolCalls((prev) => ({
              ...prev,
              [message.id]: {
                ...prev[message.id],
                [toolIndex]: true, // true = closed (default closed)
              },
            }));
          }
        });

        const thinkingBlocks = contentBlocks.filter(
          (block) => block.type === 'thinking',
        );
        // Auto-CLOSE thinking dropdowns when thinking blocks are detected (closed by default)
        thinkingBlocks.forEach((block) => {
          const blockId = block.id;
          if (blockId && collapsedThinking[blockId] === undefined) {
            setCollapsedThinking((prev) => ({
              ...prev,
              [blockId]: true, // true = collapsed (closed by default)
            }));
          }
        });
      }
    });
  }, [
    messages,
    collapsedToolCalls,
    manuallyToggledToolCalls,
    collapsedThinking,
  ]);

  // Auto-scroll dropdown to bottom when tool calls and thinking blocks update
  useEffect(() => {
    messages.forEach((message) => {
      if (message.sender === 'assistant') {
        const { contentBlocks } = processMessageContent(
          message.content,
          message.id,
        );

        // For each executing tool, scroll its dropdown to bottom if open
        const toolCallBlocks = contentBlocks.filter(
          (block) => block.type === 'tool_call',
        );
        toolCallBlocks.forEach((block) => {
          const toolIndex = block.toolCall?.blockIndex ?? 0;
          const { toolCall } = block;

          if (
            toolCall.isExecuting &&
            collapsedToolCalls[message.id]?.[toolIndex] === false
          ) {
            const toolCallContent =
              toolCallsRefs.current[message.id]?.[toolIndex];
            if (toolCallContent) {
              setTimeout(() => {
                toolCallContent.scrollTop = toolCallContent.scrollHeight;
              }, 100);
            }
          }
        });

        // For each thinking block that's still executing, scroll its dropdown to bottom if open
        contentBlocks
          .filter((block) => block.type === 'thinking')
          .forEach((block) => {
            if (block.id && !block.isComplete && !collapsedThinking[block.id]) {
              const thinkingContent = thinkingBlockRefs.current[block.id];
              if (thinkingContent) {
                setTimeout(() => {
                  thinkingContent.scrollTop = thinkingContent.scrollHeight;
                }, 100);
              }
            }
          });
      }
    });
  }, [messages, collapsedToolCalls, collapsedThinking]);

  // Process execution events
  useEffect(() => {
    messages.forEach((message) => {
      if (message.sender === 'assistant') {
        const { events } = processExecutionEvents(message.content);

        if (events.length > 0) {
          setExecutionState((prev) => {
            const messageState = prev[message.id]
              ? { ...prev[message.id] }
              : {};

            events.forEach((event) => {
              if (event.type === 'tool_start') {
                messageState[event.id] = {
                  type: 'tool',
                  name: event.name,
                  status: 'executing',
                };
              } else if (event.type === 'tool_complete') {
                if (messageState[event.id]) {
                  messageState[event.id] = {
                    ...messageState[event.id],
                    status: 'complete',
                    duration_ms: event.duration_ms,
                    isError: event.isError,
                  };
                }
              } else if (event.type === 'thinking_start') {
                messageState[event.id] = {
                  type: 'thinking',
                  status: 'executing',
                };
              } else if (event.type === 'thinking_complete') {
                if (messageState[event.id]) {
                  messageState[event.id] = {
                    ...messageState[event.id],
                    status: 'complete',
                    duration_ms: event.duration_ms,
                  };
                }
              }
            });

            return {
              ...prev,
              [message.id]: messageState,
            };
          });
        }
      }
    });
  }, [messages]);

  return (
    <div
      className={`chat-container ${hasMessages ? 'has-messages' : 'no-messages'}`}
    >
      <div className="chat-header">
        <h1>Hello, how can I help you today?</h1>
      </div>

      <div className="messages-container">
        {messages.map((message, messageIndex) => {
          const { contentBlocks } = processMessageContent(
            message.content,
            message.id,
          );

          return (
            <MessageBlock
              key={message.id}
              message={message}
              messageIndex={messageIndex}
              isLoading={isLoading}
              contentBlocks={contentBlocks}
              collapsedToolCalls={collapsedToolCalls}
              toggleToolCall={toggleToolCall}
              executionState={executionState}
              toolCallsRefs={toolCallsRefs}
              collapsedThinking={collapsedThinking}
              toggleThinking={toggleThinking}
              thinkingBlockRefs={thinkingBlockRefs}
              formatDuration={formatDuration}
              safeStringify={safeStringify}
              totalMessages={messages.length}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        inputMessage={inputMessage}
        setInputMessage={setInputMessage}
        isLoading={isLoading}
        textareaRef={textareaRef}
        handleSendMessage={handleSendMessage}
        handleCancelMessage={handleCancelMessage}
      />
    </div>
  );
}

export default ChatInterface;
