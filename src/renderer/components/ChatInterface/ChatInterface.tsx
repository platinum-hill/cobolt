import React, {
  useRef,
  useEffect,
  useState,
  Component,
  ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Clipboard } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log/renderer';
import useMessages from '../../hooks/useMessages';
import useScrollToBottom from '../../hooks/useScrollToBottom';
import './ChatInterface.css';

// Error Boundary Component to catch React crashes
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class MessageErrorBoundary extends Component<
  { children: ReactNode; messageId: string },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; messageId: string }) {
    super(props);
    this.state = { hasError: false };
  }

  render() {
    const { hasError } = this.state;
    if (hasError) {
      return (
        <div
          className="message-error"
          style={{
            background: '#2a1a1a',
            border: '1px solid #ff6b6b',
            borderRadius: '8px',
            padding: '12px',
            margin: '8px 0',
          }}
        >
          <h4 style={{ color: '#ff6b6b', margin: '0 0 8px 0' }}>
            Message Rendering Error
          </h4>
          <p
            style={{ color: '#cccccc', fontSize: '14px', margin: '0 0 12px 0' }}
          >
            This message contains corrupted content and cannot be displayed.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            style={{
              background: '#ff6b6b',
              color: 'white',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    const { children } = this.props;
    return children;
  }
}

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

// Sequential content parsing for inline tool rendering
const processMessageContent = (content: string) => {
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
  const eventIdsByToolName = new Map<string, string>();

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

      executionEventBlocks.set(event.name || 'unknown', immediateToolCall);
      eventIdsByToolName.set(event.name || 'unknown', event.id);
    }
  });

  // Track tool calls from content tags for merging
  const toolCallsMap = new Map<string, any>();

  // Process tool updates (executing status)
  const toolUpdateMatches = processedContent.matchAll(
    /<tool_calls_update>(.*?)<\/tool_calls_update>/gs,
  );
  Array.from(toolUpdateMatches).forEach((match) => {
    try {
      const updateToolCalls = JSON.parse(match[1]);
      updateToolCalls.forEach((updateTool: any) => {
        const key = `${updateTool.name}-${updateTool.arguments}`;

        // Check if we already have a block from execution events
        const existingEventBlock = executionEventBlocks.get(updateTool.name);
        if (existingEventBlock) {
          // Create UPDATED copy instead of modifying original (prevents shared reference issues)
          const updatedEventBlock = {
            ...existingEventBlock,
            arguments: JSON.stringify(updateTool.arguments, null, 2),
            result: updateTool.result || 'Executing...',
            isExecuting: updateTool.isExecuting !== false,
          };
          executionEventBlocks.set(updateTool.name, updatedEventBlock);
        }

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
      completedToolCalls.forEach((completedTool: any) => {
        const key = `${completedTool.name}-${completedTool.arguments}`;
        const existingTool = toolCallsMap.get(key);

        // Also update the execution event block if it exists
        const existingEventBlock = executionEventBlocks.get(completedTool.name);
        if (existingEventBlock) {
          // Create UPDATED copy instead of modifying original (prevents shared reference issues)
          const completedEventBlock = {
            ...existingEventBlock,
            arguments: JSON.stringify(completedTool.arguments, null, 2),
            result: completedTool.result || 'Completed',
            isExecuting: false,
            duration_ms: completedTool.duration_ms,
            isError: completedTool.isError || false,
          };
          executionEventBlocks.set(completedTool.name, completedEventBlock);
        }

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
      finalToolCalls.forEach((finalTool: any) => {
        const key = `${finalTool.name}-${finalTool.arguments}`;
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

  // Parse content using position markers for true inline tool calls
  // Split by position markers to get exact tool call locations
  const parts = processedContent.split(/(<tool_call_position id="[^"]*">)/g);

  let currentToolCallIndex = 0;
  let globalThinkingIndex = 0; // Global counter for unique thinking block IDs
  const toolCallsArray = Array.from(toolCallsMap.values());

  parts.forEach((part, index) => {
    if (part.startsWith('<tool_call_position')) {
      // Insert tool call at this exact position

      // Try to find execution event block for this position
      let toolCallToUse = null;
      let toolFromEvents = false;

      if (currentToolCallIndex < toolCallsArray.length) {
        const contentToolCall = toolCallsArray[currentToolCallIndex];
        const eventBlock = executionEventBlocks.get(contentToolCall.name);

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
          toolFromEvents = true;
        } else {
          toolCallToUse = contentToolCall;
        }
      } else {
        // No content tool call yet, check if we have any unused execution event blocks
        const unusedEventBlocks = Array.from(
          executionEventBlocks.values(),
        ).filter(
          (block) => !toolCallsArray.some((tc) => tc.name === block.name),
        );

        if (unusedEventBlocks.length > 0) {
          // Create COPY to avoid shared reference issues
          toolCallToUse = { ...unusedEventBlocks[0] };
          toolFromEvents = true;
        }
      }

      if (toolCallToUse) {
        contentBlocks.push({
          type: 'tool_call',
          toolCall: {
            ...toolCallToUse,
            blockIndex: currentToolCallIndex, // Store the intended index
          },
          id: toolFromEvents
            ? `tool-event-${currentToolCallIndex}`
            : `tool-${currentToolCallIndex}`,
        });
        currentToolCallIndex += 1;
      }
    } else {
      // Clean content by removing tool call tags
      const cleanPart = part
        .replace(/<tool_calls_update>.*?<\/tool_calls_update>/gs, '')
        .replace(/<tool_calls_complete>.*?<\/tool_calls_complete>/gs, '')
        .replace(/<tool_calls>.*?<\/tool_calls>/gs, '');

      // Handle thinking content - both complete and incomplete blocks
      let partProcessedContent = cleanPart;

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
            id: `thinking-global-${globalThinkingIndex}`, // Unique ID using global counter
            isComplete: true,
            thinkingBlockIndex: globalThinkingIndex, // Global thinking block index
          });
          globalThinkingIndex += 1;
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
            id: `thinking-global-${globalThinkingIndex}`, // Unique ID using global counter
            isComplete: false,
            thinkingBlockIndex: globalThinkingIndex, // Global thinking block index
          });
          globalThinkingIndex += 1;
        }
        // Remove from content
        partProcessedContent = partProcessedContent.replace(
          incompleteThinkingMatch[0],
          '',
        );
      }

      // Handle any remaining text content
      if (partProcessedContent.trim()) {
        contentBlocks.push({
          type: 'text',
          content: safeStringify(partProcessedContent),
          id: `text-${index}`,
        });
      }
    }
  });

  // Add any remaining tool calls at the end (fallback for tools without position markers)
  // First add remaining content-parsed tool calls
  while (currentToolCallIndex < toolCallsArray.length) {
    const toolCall = toolCallsArray[currentToolCallIndex];

    // Check if we already have this tool call from execution events
    const existingEventBlock = executionEventBlocks.get(toolCall.name);
    if (existingEventBlock) {
      // Create COPY of execution event data merged with content data (avoid shared references)
      const mergedToolCall = {
        ...existingEventBlock, // Spread creates new object
        arguments: toolCall.arguments || existingEventBlock.arguments,
        result: toolCall.result || existingEventBlock.result,
        isExecuting:
          toolCall.isExecuting !== undefined
            ? toolCall.isExecuting
            : existingEventBlock.isExecuting,
        duration_ms: toolCall.duration_ms || existingEventBlock.duration_ms,
        isError:
          toolCall.isError !== undefined
            ? toolCall.isError
            : existingEventBlock.isError,
        executionEventId: existingEventBlock.executionEventId, // Preserve event ID
      };

      contentBlocks.push({
        type: 'tool_call',
        toolCall: {
          ...mergedToolCall,
          blockIndex: currentToolCallIndex,
        },
        id: `tool-merged-${currentToolCallIndex}`,
      });
    } else {
      // No existing event block, create new one (fallback)
      contentBlocks.push({
        type: 'tool_call',
        toolCall: {
          ...toolCall,
          blockIndex: currentToolCallIndex,
        },
        id: `tool-remaining-${currentToolCallIndex}`,
      });
    }
    currentToolCallIndex += 1;
  }

  // Then add any execution event blocks that weren't matched with content
  const usedEventBlockNames = new Set(
    contentBlocks
      .filter((block) => block.type === 'tool_call')
      .map((block) => block.toolCall?.name)
      .filter(Boolean),
  );

  Array.from(executionEventBlocks.entries()).forEach(
    ([name, eventBlock], orphanIndex) => {
      if (!usedEventBlockNames.has(name)) {
        contentBlocks.push({
          type: 'tool_call',
          toolCall: {
            ...eventBlock, // Create copy to avoid shared references
            blockIndex: currentToolCallIndex + orphanIndex,
          },
          id: `tool-event-orphan-${name}`,
        });
      }
    },
  );

  // Return properly ordered content blocks
  // Merge tool calls from both content parsing and execution events
  const allToolCalls = [
    ...Array.from(toolCallsMap.values()),
    ...Array.from(executionEventBlocks.values()),
  ];

  // Remove duplicates by tool name
  const uniqueToolCalls = allToolCalls.reduce((acc, toolCall) => {
    const existing = acc.find((tc: any) => tc.name === toolCall.name);
    if (!existing) {
      // Create COPY to avoid shared references
      acc.push({ ...toolCall });
    } else if (toolCall.arguments && toolCall.arguments !== 'Loading...') {
      // Create MERGED copy instead of modifying existing (prevents shared reference issues)
      const preservedIsExecuting = existing.isExecuting;
      const mergedToolCall = { ...existing, ...toolCall };
      // If the new tool call doesn't have isExecuting set, preserve the old value
      if (
        toolCall.isExecuting === undefined &&
        preservedIsExecuting !== undefined
      ) {
        mergedToolCall.isExecuting = preservedIsExecuting;
      }
      // Replace the existing with the merged copy
      const existingIndex = acc.findIndex(
        (tc: any) => tc.name === toolCall.name,
      );
      acc[existingIndex] = mergedToolCall;
    }
    return acc;
  }, [] as any[]);

  return {
    contentBlocks,
    toolCalls: uniqueToolCalls,
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
  const [manuallyToggledThinking, setManuallyToggledThinking] = useState<{
    [blockId: string]: boolean;
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
    handleResetChat,
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
  const autoCollapseScheduled = useRef<{
    [messageId: string]: { [toolIndex: number]: boolean };
  }>({});
  const autoCollapseScheduledThinking = useRef<{
    [blockId: string]: boolean;
  }>({});

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

    // Mark this thinking block as manually toggled by user (prevents auto-collapse)
    setManuallyToggledThinking((prev) => ({
      ...prev,
      [thinkingBlockId]: true,
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
        const { contentBlocks } = processMessageContent(message.content);

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
                [toolIndex]: false, // false = open
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
        const { contentBlocks } = processMessageContent(message.content);

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

  // Auto-collapse dropdown when tool call is completed (only if not manually toggled)
  useEffect(() => {
    messages.forEach((message) => {
      if (message.sender === 'assistant') {
        const { contentBlocks } = processMessageContent(message.content);

        // For each tool call block, check if it should auto-collapse
        const toolCallBlocks = contentBlocks.filter(
          (block) => block.type === 'tool_call',
        );
        toolCallBlocks.forEach((block) => {
          const toolIndex = block.toolCall?.blockIndex ?? 0;
          const { toolCall } = block;

          // Check execution state for more accurate status
          const messageExecutions = executionState[message.id] || {};

          // Get execution state by event ID
          const thisToolExecution = toolCall.executionEventId
            ? messageExecutions[toolCall.executionEventId]
            : null;

          // Use execution state for completion status
          const isCompleted = thisToolExecution?.status === 'complete';

          const isOpen = collapsedToolCalls[message.id]?.[toolIndex] === false;
          const notManuallyToggled =
            !manuallyToggledToolCalls[message.id]?.[toolIndex];
          const notScheduled =
            !autoCollapseScheduled.current[message.id]?.[toolIndex];

          // If dropdown is open, tool completed, hasn't been manually toggled, and we haven't scheduled auto-collapse yet
          if (isOpen && isCompleted && notManuallyToggled && notScheduled) {
            // Mark as scheduled to prevent duplicate timeouts
            if (!autoCollapseScheduled.current[message.id]) {
              autoCollapseScheduled.current[message.id] = {};
            }
            autoCollapseScheduled.current[message.id][toolIndex] = true;

            setTimeout(() => {
              setCollapsedToolCalls((prev) => ({
                ...prev,
                [message.id]: {
                  ...prev[message.id],
                  [toolIndex]: true, // true = collapsed
                },
              }));
              // Clean up the scheduled flag
              if (autoCollapseScheduled.current[message.id]) {
                delete autoCollapseScheduled.current[message.id][toolIndex];
              }
            }, 2000); // 2 second delay to let user see results
          }
        });

        // For each thinking block, check if it should auto-collapse
        const thinkingBlocks = contentBlocks.filter(
          (block) => block.type === 'thinking',
        );

        // Auto close any completed thinking dropdowns
        // This is for when you open previous chats which had thinking dropdowns
        // This closes open and complete thinking dropdowns
        thinkingBlocks.forEach((block) => {
          if (block.id) {
            const isCompleted = block.isComplete;
            const isOpen = collapsedThinking[block.id] === false;
            const notManuallyToggled = !manuallyToggledThinking[block.id];
            const notScheduled =
              !autoCollapseScheduledThinking.current[block.id];

            // If dropdown is open, thinking completed, hasn't been manually toggled, and we haven't scheduled auto-collapse yet
            if (isOpen && isCompleted && notManuallyToggled && notScheduled) {
              // Mark as scheduled to prevent duplicate timeouts
              autoCollapseScheduledThinking.current[block.id] = true;

              setTimeout(() => {
                setCollapsedThinking((prev) => ({
                  ...prev,
                  [block.id!]: true, // true = collapsed
                }));
                // Clean up the scheduled flag
                delete autoCollapseScheduledThinking.current[block.id!];
              }, 2000); // 2 second delay
            }
          }
        });
      }
    });
  }, [
    messages,
    manuallyToggledToolCalls,
    collapsedToolCalls,
    manuallyToggledThinking,
    collapsedThinking,
    executionState, // Added to detect when tools complete
  ]);

  return (
    <div
      className={`chat-container ${hasMessages ? 'has-messages' : 'no-messages'}`}
    >
      <div className="chat-header">
        <h1>Hello, how can I help you today?</h1>
      </div>

      <div className="messages-container">
        {messages.map((message) => {
          const { contentBlocks } = processMessageContent(message.content);

          return (
            <MessageErrorBoundary key={message.id} messageId={message.id}>
              <div
                className={`message ${message.sender === 'user' ? 'user-message' : 'assistant-message'}`}
              >
                {message.sender === 'assistant' ? (
                  <div className="assistant-message-content">
                    {/* Sequential rendering of content blocks */}
                    {contentBlocks.map((block, blockIndex) => {
                      if (block.type === 'text') {
                        try {
                          // Ensure content is a string before rendering
                          const safeContent = safeStringify(
                            block.content || '',
                          );
                          return (
                            <div
                              key={block.id || blockIndex}
                              className="text-block"
                            >
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {safeContent}
                              </ReactMarkdown>
                            </div>
                          );
                        } catch (error) {
                          log.error('Error rendering text block:', error);
                          return (
                            <div
                              key={block.id || blockIndex}
                              className="text-block error"
                            >
                              <p
                                style={{
                                  color: '#ff6b6b',
                                  fontStyle: 'italic',
                                }}
                              >
                                [Error rendering content - content may be
                                corrupted]
                              </p>
                            </div>
                          );
                        }
                      }

                      if (block.type === 'tool_call' && block.toolCall) {
                        // Use the stored block index for state management
                        const toolCallIndex = block.toolCall.blockIndex ?? 0;

                        if (!toolCallsRefs.current[message.id]) {
                          toolCallsRefs.current[message.id] = {};
                        }

                        return (
                          <div
                            key={block.id || blockIndex}
                            className="individual-tool-call"
                            style={{ marginBottom: '12px' }}
                          >
                            <button
                              type="button"
                              className={`thinking-header ${collapsedToolCalls[message.id]?.[toolCallIndex] === false ? '' : 'collapsed'}`}
                              onClick={() =>
                                toggleToolCall(message.id, toolCallIndex)
                              }
                              aria-expanded={
                                collapsedToolCalls[message.id]?.[
                                  toolCallIndex
                                ] === false
                              }
                              aria-label={`${collapsedToolCalls[message.id]?.[toolCallIndex] === false ? 'Collapse' : 'Expand'} ${block.toolCall.name} tool call`}
                            >
                              <div className="header-content">
                                <div className="header-text">
                                  {block.toolCall.name}
                                </div>
                                <div className="header-badges">
                                  {(() => {
                                    // Get execution state for this specific tool call
                                    const messageExecutions =
                                      executionState[message.id] || {};

                                    // Get execution state by event ID
                                    const thisToolExecution = block.toolCall
                                      .executionEventId
                                      ? messageExecutions[
                                          block.toolCall.executionEventId
                                        ]
                                      : null;

                                    const isExecuting =
                                      thisToolExecution?.status === 'executing';
                                    const completedTool =
                                      thisToolExecution?.status === 'complete'
                                        ? thisToolExecution
                                        : null;

                                    return (
                                      <>
                                        {completedTool?.isError && (
                                          <span className="error-badge">
                                            Error
                                          </span>
                                        )}
                                        {isExecuting && (
                                          <span className="executing-badge">
                                            Executing...
                                          </span>
                                        )}
                                        {completedTool?.duration_ms && (
                                          <span className="time-badge">
                                            {formatDuration(
                                              completedTool.duration_ms,
                                            )}
                                          </span>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </button>
                            <div
                              ref={(el) => {
                                if (!toolCallsRefs.current[message.id]) {
                                  toolCallsRefs.current[message.id] = {};
                                }
                                toolCallsRefs.current[message.id][
                                  toolCallIndex
                                ] = el;
                              }}
                              className={`thinking-content ${collapsedToolCalls[message.id]?.[toolCallIndex] === false ? '' : 'collapsed'}`}
                            >
                              <div className="tool-call-block">
                                <div className="tool-call-args">
                                  <div className="section-label">
                                    Arguments:
                                  </div>
                                  <pre className="code-block">
                                    {safeStringify(block.toolCall.arguments)}
                                  </pre>
                                </div>
                                <div className="tool-call-result">
                                  <div className="section-label">Result:</div>
                                  <div
                                    className={`result-content ${block.toolCall.isError ? 'error' : ''}`}
                                  >
                                    {safeStringify(block.toolCall.result)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (block.type === 'thinking') {
                        try {
                          // Ensure thinking content is a string before rendering
                          const safeThinkingContent = safeStringify(
                            block.thinkingContent || '',
                          );
                          // Use block ID and thinking index
                          const blockThinkingIndex =
                            block.thinkingBlockIndex ?? 0;
                          const blockId =
                            block.id || `thinking-${blockThinkingIndex}`;

                          // Find execution state for THIS specific thinking block
                          const allThinkingExecutions = Object.values(
                            executionState[message.id] || {},
                          ).filter((e) => e.type === 'thinking');

                          // Use the stable thinking block index if available
                          const thisBlockExecution =
                            allThinkingExecutions[blockThinkingIndex] || null;

                          const isThinking =
                            thisBlockExecution?.status === 'executing';
                          const isCompleted =
                            thisBlockExecution?.status === 'complete';

                          return (
                            <div
                              key={blockId}
                              className="thinking-section"
                              style={{ marginBottom: '12px' }}
                            >
                              <button
                                type="button"
                                className={`thinking-header ${collapsedThinking[blockId] ? 'collapsed' : ''}`}
                                onClick={() => toggleThinking(blockId)}
                                aria-expanded={!collapsedThinking[blockId]}
                                aria-label={`${collapsedThinking[blockId] ? 'Expand' : 'Collapse'} reasoning section`}
                              >
                                <div className="header-content">
                                  <div className="header-text">Reasoning</div>
                                  <div className="header-badges">
                                    {isThinking && (
                                      <span className="executing-badge">
                                        Thinking...
                                      </span>
                                    )}
                                    {isCompleted &&
                                      thisBlockExecution?.duration_ms && (
                                        <span className="time-badge">
                                          {formatDuration(
                                            thisBlockExecution.duration_ms,
                                          )}
                                        </span>
                                      )}
                                  </div>
                                </div>
                              </button>
                              <div
                                ref={(el) => {
                                  thinkingBlockRefs.current[blockId] = el;
                                }}
                                className={`thinking-content ${collapsedThinking[blockId] ? 'collapsed' : ''}`}
                              >
                                <div className="thinking-block">
                                  {safeThinkingContent}
                                </div>
                              </div>
                            </div>
                          );
                        } catch (error) {
                          log.error('Error rendering thinking block:', error);
                          return (
                            <div
                              key={block.id || blockIndex}
                              className="thinking-section error"
                            >
                              <p
                                style={{
                                  color: '#ff6b6b',
                                  fontStyle: 'italic',
                                }}
                              >
                                [Error rendering thinking content]
                              </p>
                            </div>
                          );
                        }
                      }

                      return null;
                    })}

                    <div className="message-actions">
                      <button
                        type="button"
                        className="copy-button"
                        onClick={() =>
                          navigator.clipboard.writeText(message.content)
                        }
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
            </MessageErrorBoundary>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-section">
        <div className="input-wrapper">
          <div className="input-container">
            <div className="input-row">
              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="What's next?"
                className="message-input"
                disabled={isLoading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    handleSendMessage(e);
                  }
                }}
                style={{
                  resize: 'none',
                  maxHeight: '30vh',
                  minHeight: '18px',
                  lineHeight: '18px',
                  padding: '6px 10px',
                }}
              />
              {isLoading && (
                <button
                  type="button"
                  onClick={handleCancelMessage}
                  className="cancel-button"
                  aria-label="Cancel generation"
                >
                  ✕
                </button>
              )}
              {hasMessages && !isLoading && (
                <button
                  type="button"
                  onClick={handleResetChat}
                  className="reset-button"
                  aria-label="Clear chat"
                  disabled={isLoading}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatInterface;
