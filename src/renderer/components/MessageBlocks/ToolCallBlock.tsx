import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface ToolCallBlockProps {
  block: any;
  message: any;
  blockIndex: number;
  collapsedToolCalls: any;
  toggleToolCall: (messageId: string, toolIndex: number) => void;
  executionState: any;
  toolCallsRefs: React.MutableRefObject<any>;
  formatDuration: (durationMs: number) => string;
}

function ToolCallBlock({
  block,
  message,
  blockIndex,
  collapsedToolCalls,
  toggleToolCall,
  executionState,
  toolCallsRefs,
  formatDuration,
}: ToolCallBlockProps) {
  if (!block.toolCall) return null;

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
        className={`thinking-header ${
          collapsedToolCalls[message.id]?.[toolCallIndex] === false
            ? ''
            : 'collapsed'
        }`}
        onClick={() => toggleToolCall(message.id, toolCallIndex)}
        aria-expanded={
          collapsedToolCalls[message.id]?.[toolCallIndex] === false
        }
        aria-label={`${
          collapsedToolCalls[message.id]?.[toolCallIndex] === false
            ? 'Collapse'
            : 'Expand'
        } ${block.toolCall.name} tool call`}
      >
        <div className="header-content">
          <div className="header-text">{block.toolCall.name}</div>
          <div className="header-badges">
            {(() => {
              // Get execution state for this specific tool call
              const messageExecutions = executionState[message.id] || {};

              // Get execution state by event ID
              const thisToolExecution = block.toolCall.executionEventId
                ? messageExecutions[block.toolCall.executionEventId]
                : null;

              const isExecuting = thisToolExecution?.status === 'executing';
              const completedTool =
                thisToolExecution?.status === 'complete'
                  ? thisToolExecution
                  : null;

              return (
                <>
                  {completedTool?.isError && (
                    <span className="error-badge">Error</span>
                  )}
                  {isExecuting && (
                    <span className="executing-badge">Executing...</span>
                  )}
                  {completedTool?.duration_ms && (
                    <span className="time-badge">
                      {formatDuration(completedTool.duration_ms)}
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        </div>
        <div className="header-icon">
          {collapsedToolCalls[message.id]?.[toolCallIndex] === false ? (
            <ChevronUp size={16} />
          ) : (
            <ChevronDown size={16} />
          )}
        </div>
      </button>
      <div
        ref={(el) => {
          if (toolCallsRefs.current[message.id]) {
            toolCallsRefs.current[message.id][toolCallIndex] = el;
          }
        }}
        className={`thinking-content ${
          collapsedToolCalls[message.id]?.[toolCallIndex] === false
            ? 'expanded'
            : 'collapsed'
        }`}
        style={{
          maxHeight:
            collapsedToolCalls[message.id]?.[toolCallIndex] === false
              ? '50vh'
              : '0',
        }}
      >
        <div className="thinking-content-inner">
          <div className="code-block">
            <div className="code-header">
              <span>Arguments</span>
            </div>
            <pre className="code-content">
              <code>
                {typeof block.toolCall.arguments === 'string'
                  ? block.toolCall.arguments
                  : JSON.stringify(block.toolCall.arguments, null, 2)}
              </code>
            </pre>
          </div>
          <div className="code-block">
            <div className="code-header">
              <span>Result</span>
            </div>
            <pre className="code-content">
              <code>
                {typeof block.toolCall.result === 'string'
                  ? block.toolCall.result
                  : JSON.stringify(block.toolCall.result, null, 2)}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ToolCallBlock;
