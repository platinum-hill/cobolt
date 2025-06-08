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
  // First extract tool calls
  const toolCallMatch = content.match(/<tool_calls>(.*?)<\/tool_calls>/s);
  let toolCalls: any[] = [];
  let contentWithoutToolCalls = content;

  if (toolCallMatch) {
    try {
      toolCalls = JSON.parse(toolCallMatch[1]);
      contentWithoutToolCalls = content.replace(
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
  };

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
