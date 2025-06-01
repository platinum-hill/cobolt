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
const processMessageContentOLD = (content: string) => {
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

// NEW: Sequential content parsing for inline tool rendering
const processMessageContent = (content: string) => {
  const contentBlocks: Array<{
    type: 'text' | 'tool_call' | 'thinking';
    content?: string;
    toolCall?: any;
    thinkingContent?: string;
    id?: string;
  }> = [];
  
  // First, we need to identify all tool calls and their positions
  const toolCallsMap = new Map<string, any>();
  
  // Process tool updates (executing status)
  const toolUpdateMatches = content.matchAll(/<tool_calls_update>(.*?)<\/tool_calls_update>/gs);
  for (const match of toolUpdateMatches) {
    try {
      const updateToolCalls = JSON.parse(match[1]);
      updateToolCalls.forEach((updateTool: any) => {
        const key = `${updateTool.name}-${updateTool.arguments}`;
        toolCallsMap.set(key, updateTool);
      });
    } catch (error) {
      console.error('Failed to parse tool call updates:', error);
    }
  }
  
  // Process tool completions
  const toolCompleteMatches = content.matchAll(/<tool_calls_complete>(.*?)<\/tool_calls_complete>/gs);
  for (const match of toolCompleteMatches) {
    try {
      const completedToolCalls = JSON.parse(match[1]);
      completedToolCalls.forEach((completedTool: any) => {
        const key = `${completedTool.name}-${completedTool.arguments}`;
        const existingTool = toolCallsMap.get(key);
        toolCallsMap.set(key, { 
          ...existingTool, 
          ...completedTool, 
          isExecuting: false 
        });
      });
    } catch (error) {
      console.error('Failed to parse tool call completions:', error);
    }
  }
  
  // Process final tool calls
  const toolCallMatch = content.match(/<tool_calls>(.*?)<\/tool_calls>/s);
  if (toolCallMatch) {
    try {
      const finalToolCalls = JSON.parse(toolCallMatch[1]);
      finalToolCalls.forEach((finalTool: any) => {
        const key = `${finalTool.name}-${finalTool.arguments}`;
        const existingTool = toolCallsMap.get(key);
        toolCallsMap.set(key, {
          ...finalTool,
          isExecuting: existingTool?.isExecuting || false
        });
      });
    } catch (error) {
      console.error('Failed to parse final tool calls:', error);
    }
  }
  
  // Remove all tool call tags to get clean content
  let cleanContent = content
    .replace(/<tool_calls_update>.*?<\/tool_calls_update>/gs, '')
    .replace(/<tool_calls_complete>.*?<\/tool_calls_complete>/gs, '')
    .replace(/<tool_calls>.*?<\/tool_calls>/gs, '');
  
  // Now parse sequentially through the clean content
  // Split by thinking tags first to preserve order
  const parts = cleanContent.split(/(<think>.*?<\/think>)/gs);
  
  parts.forEach((part, index) => {
    if (part.startsWith('<think>') && part.endsWith('</think>')) {
      // This is a thinking block
      const thinkingContent = part.slice(7, -8); // Remove tags
      contentBlocks.push({
        type: 'thinking',
        thinkingContent,
        id: `thinking-${index}`
      });
    } else if (part.trim()) {
      // This is regular text content
      contentBlocks.push({
        type: 'text',
        content: part,
        id: `text-${index}`
      });
    }
  });
  
  // Add tool calls inline where they logically fit
  // For now, distribute them evenly through the content
  // TODO: Use actual positioning from backend stream
  const toolCallsArray = Array.from(toolCallsMap.values());
  const textBlocks = contentBlocks.filter(block => block.type === 'text');
  
  if (toolCallsArray.length > 0 && textBlocks.length > 0) {
    // Insert tool calls between text blocks
    const newContentBlocks: typeof contentBlocks = [];
    
    contentBlocks.forEach((block, index) => {
      newContentBlocks.push(block);
      
      // Insert tool calls after text blocks
      if (block.type === 'text' && toolCallsArray.length > 0) {
        const toolCall = toolCallsArray.shift();
        if (toolCall) {
          newContentBlocks.push({
            type: 'tool_call',
            toolCall,
            id: `tool-${toolCall.name}-${index}`
          });
        }
      }
    });
    
    // Add any remaining tool calls at the end
    toolCallsArray.forEach((toolCall, index) => {
      newContentBlocks.push({
        type: 'tool_call',
        toolCall,
        id: `tool-remaining-${index}`
      });
    });
    
    return {
      contentBlocks: newContentBlocks,
      // Legacy compatibility
      toolCalls: Array.from(toolCallsMap.values()),
      thinkingBlocks: newContentBlocks
        .filter(block => block.type === 'thinking')
        .map(block => block.thinkingContent || ''),
      regularContent: newContentBlocks
        .filter(block => block.type === 'text')
        .map(block => block.content || '')
        .join('')
    };
  }
  
  return {
    contentBlocks,
    // Legacy compatibility  
    toolCalls: Array.from(toolCallsMap.values()),
    thinkingBlocks: contentBlocks
      .filter(block => block.type === 'thinking')
      .map(block => block.thinkingContent || ''),
    regularContent: contentBlocks
      .filter(block => block.type === 'text')
      .map(block => block.content || '')
      .join('')
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
  const toolCallsRefs = useRef<{ [messageId: string]: { [toolIndex: number]: HTMLDivElement | null } }>({});
  const autoCollapseScheduled = useRef<{ [messageId: string]: { [toolIndex: number]: boolean } }>({});

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

  const toggleToolCall = (messageId: string, toolIndex: number) => {
    setCollapsedToolCalls((prev) => ({
      ...prev,
      [messageId]: {
        ...prev[messageId],
        [toolIndex]: prev[messageId]?.[toolIndex] !== false ? false : true,
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
        const { toolCalls } = processMessageContent(message.content);
        
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
      }
    });
  }, [messages, collapsedToolCalls, manuallyToggledToolCalls]);
  
  // Auto-scroll dropdown to bottom when tool calls update
  useEffect(() => {
    messages.forEach((message) => {
      if (message.sender === 'assistant') {
        const { toolCalls } = processMessageContent(message.content);
        
        // For each executing tool, scroll its dropdown to bottom if open
        toolCalls.forEach((toolCall, toolIndex) => {
          if (toolCall.isExecuting && collapsedToolCalls[message.id]?.[toolIndex] === false) {
            const toolCallContent = toolCallsRefs.current[message.id]?.[toolIndex];
            if (toolCallContent) {
              setTimeout(() => {
                toolCallContent.scrollTop = toolCallContent.scrollHeight;
              }, 100);
            }
          }
        });
      }
    });
  }, [messages, collapsedToolCalls]);
  
  // Auto-collapse dropdown when tool call is completed (only if not manually toggled)
  useEffect(() => {
    messages.forEach((message) => {
      if (message.sender === 'assistant') {
        const { toolCalls } = processMessageContent(message.content);
        
        // For each tool call, check if it should auto-collapse
        toolCalls.forEach((toolCall, toolIndex) => {
          const isCompleted = !toolCall.isExecuting;
          const isOpen = collapsedToolCalls[message.id]?.[toolIndex] === false;
          const notManuallyToggled = !manuallyToggledToolCalls[message.id]?.[toolIndex];
          const notScheduled = !autoCollapseScheduled.current[message.id]?.[toolIndex];
          
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
          const { contentBlocks, thinkingBlocks, toolCalls, regularContent } =
            processMessageContent(message.content);
          const hasThinking = thinkingBlocks.length > 0;
          const hasToolCalls = toolCalls.length > 0;
          const hasContentBlocks = contentBlocks && contentBlocks.length > 0;

          return (
            <div
              key={message.id}
              className={`message ${message.sender === 'user' ? 'user-message' : 'assistant-message'}`}
            >
              {message.sender === 'assistant' ? (
                <div className="assistant-message-content">
                  {hasContentBlocks ? (
                    // NEW: Sequential rendering of content blocks
                    contentBlocks.map((block, blockIndex) => {
                      if (block.type === 'text') {
                        return (
                          <div key={block.id || blockIndex} className="text-block">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {block.content || ''}
                            </ReactMarkdown>
                          </div>
                        );
                      } 
                      
                      if (block.type === 'tool_call' && block.toolCall) {
                        // Find the tool call index for state management
                        const toolCallIndex = toolCalls.findIndex(
                          tc => tc.name === block.toolCall.name && tc.arguments === block.toolCall.arguments
                        );
                        
                        if (!toolCallsRefs.current[message.id]) {
                          toolCallsRefs.current[message.id] = {};
                        }
                        
                        return (
                          <div key={block.id || blockIndex} className="individual-tool-call" style={{marginBottom: '12px'}}>
                            <button
                              type="button"
                              className={`thinking-header ${collapsedToolCalls[message.id]?.[toolCallIndex] === false ? '' : 'collapsed'}`}
                              onClick={() => toggleToolCall(message.id, toolCallIndex)}
                              aria-expanded={collapsedToolCalls[message.id]?.[toolCallIndex] === false}
                              aria-label={`${collapsedToolCalls[message.id]?.[toolCallIndex] === false ? 'Collapse' : 'Expand'} ${block.toolCall.name} tool call`}
                            >
                              <div className="header-content">
                                {block.toolCall.name}
                                {block.toolCall.isError && (
                                  <span className="error-badge">Error</span>
                                )}
                                {block.toolCall.isExecuting && (
                                  <span className="executing-badge">Executing...</span>
                                )}
                              </div>
                            </button>
                            <div
                              ref={(el) => {
                                if (!toolCallsRefs.current[message.id]) {
                                  toolCallsRefs.current[message.id] = {};
                                }
                                toolCallsRefs.current[message.id][toolCallIndex] = el;
                              }}
                              className={`thinking-content ${collapsedToolCalls[message.id]?.[toolCallIndex] === false ? '' : 'collapsed'}`}
                            >
                              <div className="tool-call-block">
                                <div className="tool-call-args">
                                  <div className="section-label">Arguments:</div>
                                  <pre className="code-block">
                                    {block.toolCall.arguments}
                                  </pre>
                                </div>
                                <div className="tool-call-result">
                                  <div className="section-label">Result:</div>
                                  <div
                                    className={`result-content ${block.toolCall.isError ? 'error' : ''}`}
                                  >
                                    {block.toolCall.result}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      
                      if (block.type === 'thinking') {
                        return (
                          <div key={block.id || blockIndex} className="thinking-section" style={{marginBottom: '12px'}}>
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
                              <div className="thinking-block">
                                {block.thinkingContent}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      
                      return null;
                    })
                  ) : (
                    // FALLBACK: Old grouped rendering for compatibility
                    <>
                      {hasToolCalls && toolCalls.map((toolCall, index) => {
                        if (!toolCallsRefs.current[message.id]) {
                          toolCallsRefs.current[message.id] = {};
                        }
                        
                        return (
                          // eslint-disable-next-line react/no-array-index-key
                          <div key={index} className="individual-tool-call" style={{marginBottom: '12px'}}>
                            <button
                              type="button"
                              className={`thinking-header ${collapsedToolCalls[message.id]?.[index] === false ? '' : 'collapsed'}`}
                              onClick={() => toggleToolCall(message.id, index)}
                              aria-expanded={collapsedToolCalls[message.id]?.[index] === false}
                              aria-label={`${collapsedToolCalls[message.id]?.[index] === false ? 'Collapse' : 'Expand'} ${toolCall.name} tool call`}
                            >
                              <div className="header-content">
                                {toolCall.name}
                                {toolCall.isError && (
                                  <span className="error-badge">Error</span>
                                )}
                                {toolCall.isExecuting && (
                                  <span className="executing-badge">Executing...</span>
                                )}
                              </div>
                            </button>
                            <div
                              ref={(el) => {
                                if (!toolCallsRefs.current[message.id]) {
                                  toolCallsRefs.current[message.id] = {};
                                }
                                toolCallsRefs.current[message.id][index] = el;
                              }}
                              className={`thinking-content ${collapsedToolCalls[message.id]?.[index] === false ? '' : 'collapsed'}`}
                            >
                              <div className="tool-call-block">
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
                            </div>
                          </div>
                        );
                      })}

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
                    </>
                  )}

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
