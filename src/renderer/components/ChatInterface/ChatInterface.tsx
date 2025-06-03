import React, {
  useRef,
  useEffect,
  useState,
  Component,
  ErrorInfo,
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

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    log.error('Message rendering error:', error, errorInfo);
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
  // Clean execution events from content first
  const { cleanContent } = processExecutionEvents(content);
  const processedContent = cleanContent;

  const contentBlocks: Array<{
    type: 'text' | 'tool_call' | 'thinking';
    content?: string;
    toolCall?: any;
    thinkingContent?: string;
    id?: string;
    isComplete?: boolean;
  }> = [];

  // First, we need to identify all tool calls and their positions
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
  const toolCallsArray = Array.from(toolCallsMap.values());

  parts.forEach((part, index) => {
    if (part.startsWith('<tool_call_position')) {
      // Insert tool call at this exact position
      if (currentToolCallIndex < toolCallsArray.length) {
        const toolCall = toolCallsArray[currentToolCallIndex];
        contentBlocks.push({
          type: 'tool_call',
          toolCall,
          id: `tool-${currentToolCallIndex}`,
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

      // Handle thinking content with stable IDs (streaming and complete use same ID pattern)
      let thinkingBlockIndex = 0;

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
            id: `thinking-${index}-${thinkingBlockIndex}`, // Stable ID - same pattern as streaming
            isComplete: true,
          });
          thinkingBlockIndex += 1;
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
            id: `thinking-${index}-${thinkingBlockIndex}`, // Same stable ID pattern
            isComplete: false,
          });
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
  while (currentToolCallIndex < toolCallsArray.length) {
    const toolCall = toolCallsArray[currentToolCallIndex];
    contentBlocks.push({
      type: 'tool_call',
      toolCall,
      id: `tool-remaining-${currentToolCallIndex}`,
    });
    currentToolCallIndex += 1;
  }

  // Return properly ordered content blocks
  return {
    contentBlocks,
    toolCalls: Array.from(toolCallsMap.values()),
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
        const { toolCalls, contentBlocks } = processMessageContent(
          message.content,
        );

        // For each tool call, if dropdown isn't explicitly set, open it
        toolCalls.forEach((_, toolIndex) => {
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

        // Auto-open thinking dropdowns when thinking blocks are detected
        const thinkingBlocks = contentBlocks.filter(
          (block) => block.type === 'thinking',
        );
        thinkingBlocks.forEach((block) => {
          const blockId = block.id;
          if (blockId && collapsedThinking[blockId] === undefined) {
            setCollapsedThinking((prev) => ({
              ...prev,
              [blockId]: false, // false = open
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
        const { toolCalls, contentBlocks } = processMessageContent(
          message.content,
        );

        // For each executing tool, scroll its dropdown to bottom if open
        toolCalls.forEach((toolCall, toolIndex) => {
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
        const { toolCalls, contentBlocks } = processMessageContent(
          message.content,
        );

        // For each tool call, check if it should auto-collapse
        toolCalls.forEach((toolCall, toolIndex) => {
          const isCompleted = !toolCall.isExecuting;
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
              }, 2000); // 2 second delay to let user see results
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
          const { contentBlocks, toolCalls } = processMessageContent(
            message.content,
          );

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
                        // Find the tool call index for state management
                        const toolCallIndex = toolCalls.findIndex(
                          (tc) =>
                            tc.name === block.toolCall.name &&
                            tc.arguments === block.toolCall.arguments,
                        );

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
                                    // Get ALL tool executions for this message
                                    const allToolExecutions = Object.values(
                                      executionState[message.id] || {},
                                    ).filter((e) => e.type === 'tool');

                                    // Find the execution for THIS specific tool call by index
                                    const thisToolExecution =
                                      allToolExecutions[toolCallIndex] || null;

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
                          const blockId = block.id || `thinking-${blockIndex}`;

                          // Find execution state for THIS specific thinking block
                          const allThinkingExecutions = Object.values(
                            executionState[message.id] || {},
                          ).filter((e) => e.type === 'thinking');
                          // Count how many thinking blocks came before this one
                          const thinkingBlocksBefore = contentBlocks
                            .slice(0, blockIndex)
                            .filter((b) => b.type === 'thinking').length;
                          const thisBlockExecution =
                            allThinkingExecutions[thinkingBlocksBefore] || null;

                          const isThinking =
                            thisBlockExecution?.status === 'executing' ||
                            !block.isComplete;
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
