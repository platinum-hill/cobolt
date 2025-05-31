import React, { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Clipboard } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log/renderer';

import useMessages from '../../hooks/useMessages';
import useScrollToBottom from '../../hooks/useScrollToBottom';
import './ChatInterface.css';

interface ChatInterfaceProps {
  isLoading: boolean;
  currentChatId: string | null;
}

// Function to process message content and handle think tags and tool calls
const processMessageContent = (content: string) => {
  let toolCalls: any[] = [];
  let contentWithoutToolCalls = content;
  
  // Extract real-time tool updates FIRST (executing status)
  const toolUpdateMatches = content.matchAll(/<tool_calls_update>(.*?)<\/tool_calls_update>/gs);
  for (const match of toolUpdateMatches) {
    try {
      const updateToolCalls = JSON.parse(match[1]);
      // Add new tool calls with executing status
      updateToolCalls.forEach((updateTool: any) => {
        const existingIndex = toolCalls.findIndex(tool => tool.name === updateTool.name && 
          tool.arguments === updateTool.arguments);
        if (existingIndex >= 0) {
          toolCalls[existingIndex] = updateTool;
        } else {
          toolCalls.push(updateTool);
        }
      });
      
      // Remove update tags from content
      contentWithoutToolCalls = contentWithoutToolCalls.replace(
        /<tool_calls_update>.*?<\/tool_calls_update>/s,
        '',
      );
    } catch (error) {
      log.error('Failed to parse tool call updates:', error);
    }
  }
  
  // Extract real-time tool completions SECOND
  const toolCompleteMatches = content.matchAll(/<tool_calls_complete>(.*?)<\/tool_calls_complete>/gs);
  for (const match of toolCompleteMatches) {
    try {
      const completedToolCalls = JSON.parse(match[1]);
      // Update existing tool calls with completion data
      completedToolCalls.forEach((completedTool: any) => {
        const existingIndex = toolCalls.findIndex(tool => tool.name === completedTool.name && 
          tool.arguments === completedTool.arguments);
        if (existingIndex >= 0) {
          toolCalls[existingIndex] = { ...toolCalls[existingIndex], ...completedTool, isExecuting: false };
        } else {
          toolCalls.push({ ...completedTool, isExecuting: false });
        }
      });
      
      // Remove complete tags from content
      contentWithoutToolCalls = contentWithoutToolCalls.replace(
        /<tool_calls_complete>.*?<\/tool_calls_complete>/s,
        '',
      );
    } catch (error) {
      log.error('Failed to parse tool call completions:', error);
    }
  }
  
  // Extract final tool calls LAST (preserve execution status from above)
  const toolCallMatch = content.match(/<tool_calls>(.*?)<\/tool_calls>/s);
  if (toolCallMatch) {
    try {
      const finalToolCalls = JSON.parse(toolCallMatch[1]);
      // Merge final tool calls but preserve isExecuting status
      finalToolCalls.forEach((finalTool: any) => {
        const existingIndex = toolCalls.findIndex(tool => tool.name === finalTool.name && 
          tool.arguments === finalTool.arguments);
        if (existingIndex >= 0) {
          // Preserve isExecuting status from real-time updates
          const existingTool = toolCalls[existingIndex];
          toolCalls[existingIndex] = { 
            ...finalTool, 
            isExecuting: existingTool.isExecuting !== undefined ? existingTool.isExecuting : false 
          };
        } else {
          toolCalls.push({ ...finalTool, isExecuting: false });
        }
      });
      
      contentWithoutToolCalls = contentWithoutToolCalls.replace(
        /<tool_calls>.*?<\/tool_calls>/s,
        '',
      );
    } catch (error) {
      log.error('Failed to parse tool calls:', error);
    }
  }

  // Then extract thinking blocks from the remaining content
  const parts = contentWithoutToolCalls.split(/(<think>.*?<\/think>)/gs);
  const thinkingBlocks: string[] = [];
  const regularContent: string[] = [];

  parts.forEach((part) => {
    if (part.startsWith('<think>') && part.endsWith('</think>')) {
      const thinkingContent = part.slice(7, -8); // Remove the tags
      thinkingBlocks.push(thinkingContent);
    } else {
      regularContent.push(part);
    }
  });

  return {
    thinkingBlocks,
    toolCalls,
    regularContent: regularContent.join(''),
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
    [key: string]: boolean;
  }>({});
  const [manuallyToggledToolCalls, setManuallyToggledToolCalls] = useState<{
    [key: string]: boolean;
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
  const toolCallsRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const autoCollapseScheduled = useRef<{ [key: string]: boolean }>({});

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

  const toggleThinking = (messageId: string) => {
    setCollapsedThinking((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const toggleToolCalls = (messageId: string) => {
    setCollapsedToolCalls((prev) => ({
      ...prev,
      [messageId]: prev[messageId] === false,
    }));
    
    // Mark this dropdown as manually toggled by user (prevents auto-collapse)
    setManuallyToggledToolCalls((prev) => ({
      ...prev,
      [messageId]: true,
    }));
  };
  
  // Auto-open dropdown when tool calls are detected
  useEffect(() => {
    messages.forEach((message) => {
      if (message.sender === 'assistant') {
        const { toolCalls } = processMessageContent(message.content);
        const hasToolCalls = toolCalls.length > 0;
        
        // If this message has tool calls and dropdown isn't explicitly set, open it
        if (hasToolCalls && collapsedToolCalls[message.id] === undefined) {
          setCollapsedToolCalls((prev) => ({
            ...prev,
            [message.id]: false, // false = open
          }));
        }
      }
    });
  }, [messages, collapsedToolCalls, manuallyToggledToolCalls]);
  
  // Auto-scroll dropdown to bottom when tool calls update
  useEffect(() => {
    messages.forEach((message) => {
      if (message.sender === 'assistant') {
        const { toolCalls } = processMessageContent(message.content);
        const hasExecutingTools = toolCalls.some(tool => tool.isExecuting);
        
        // If dropdown is open and tools are executing, scroll to bottom
        if (collapsedToolCalls[message.id] === false && hasExecutingTools) {
          const toolCallsContent = toolCallsRefs.current[message.id];
          if (toolCallsContent) {
            setTimeout(() => {
              toolCallsContent.scrollTop = toolCallsContent.scrollHeight;
            }, 100);
          }
        }
      }
    });
  }, [messages, collapsedToolCalls]);
  
  // Auto-collapse dropdown when all tools are completed (only if not manually toggled)
  useEffect(() => {
    messages.forEach((message) => {
      if (message.sender === 'assistant') {
        const { toolCalls } = processMessageContent(message.content);
        const hasToolCalls = toolCalls.length > 0;
        const allToolsCompleted = hasToolCalls && toolCalls.every(tool => !tool.isExecuting);
        
        // If dropdown is open, all tools completed, hasn't been manually toggled, and we haven't scheduled auto-collapse yet
        if (collapsedToolCalls[message.id] === false && 
            allToolsCompleted && 
            !manuallyToggledToolCalls[message.id] && 
            !autoCollapseScheduled.current[message.id]) {
          
          // Mark as scheduled to prevent duplicate timeouts
          autoCollapseScheduled.current[message.id] = true;
          
          setTimeout(() => {
            setCollapsedToolCalls((prev) => ({
              ...prev,
              [message.id]: true, // true = collapsed
            }));
            // Clean up the scheduled flag
            delete autoCollapseScheduled.current[message.id];
          }, 2000); // 2 second delay to let user see results
        }
      }
    });
  }, [messages, collapsedToolCalls]);

  return (
    <div
      className={`chat-container ${hasMessages ? 'has-messages' : 'no-messages'}`}
    >
      <div className="chat-header">
        <h1>Hello, how can I help you today?</h1>
      </div>

      <div className="messages-container">
        {messages.map((message) => {
          const { thinkingBlocks, toolCalls, regularContent } =
            processMessageContent(message.content);
          const hasThinking = thinkingBlocks.length > 0;
          const hasToolCalls = toolCalls.length > 0;

          return (
            <div
              key={message.id}
              className={`message ${message.sender === 'user' ? 'user-message' : 'assistant-message'}`}
            >
              {message.sender === 'assistant' ? (
                <div className="assistant-message-content">
                  {hasToolCalls && (
                    <div className="tool-calls-section">
                      <button
                        type="button"
                        className={`thinking-header ${collapsedToolCalls[message.id] === false ? '' : 'collapsed'}`}
                        onClick={() => toggleToolCalls(message.id)}
                        aria-expanded={collapsedToolCalls[message.id] === false}
                        aria-label={`${collapsedToolCalls[message.id] === false ? 'Collapse' : 'Expand'} tool calls section`}
                      >
                        <div className="header-content">
                          MCP Tool Calls ({toolCalls.length})
                        </div>
                      </button>
                      <div
                        ref={(el) => (toolCallsRefs.current[message.id] = el)}
                        className={`thinking-content ${collapsedToolCalls[message.id] === false ? '' : 'collapsed'}`}
                      >
                        {toolCalls.map((toolCall, index) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <div key={index} className="tool-call-block">
                            <div className="tool-call-header">
                              <strong>{toolCall.name}</strong>
                              {toolCall.isError && (
                                <span className="error-badge">Error</span>
                              )}
                              {toolCall.isExecuting && (
                                <span className="executing-badge">Executing...</span>
                              )}
                            </div>
                            <div className="tool-call-args">
                              <div className="section-label">Arguments:</div>
                              <pre className="code-block">
                                {toolCall.arguments}
                              </pre>
                            </div>
                            <div className="tool-call-result">
                              <div className="section-label">Result:</div>
                              <div
                                className={`result-content ${toolCall.isError ? 'error' : ''}`}
                              >
                                {toolCall.result}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasThinking && (
                    <div className="thinking-section">
                      <button
                        type="button"
                        className={`thinking-header ${collapsedThinking[message.id] ? 'collapsed' : ''}`}
                        onClick={() => toggleThinking(message.id)}
                        aria-expanded={!collapsedThinking[message.id]}
                        aria-label={`${collapsedThinking[message.id] ? 'Expand' : 'Collapse'} reasoning section`}
                      >
                        <div className="header-content">Reasoning</div>
                      </button>
                      <div
                        className={`thinking-content ${collapsedThinking[message.id] ? 'collapsed' : ''}`}
                      >
                        {thinkingBlocks.map((block, index) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <div key={index} className="thinking-block">
                            {block}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {regularContent}
                  </ReactMarkdown>

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
