import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ThinkingBlockProps {
  block: any;
  blockIndex: number;
  collapsedThinking: any;
  toggleThinking: (blockId: string) => void;
  thinkingBlockRefs: React.MutableRefObject<any>;
  safeStringify: (value: any) => string;
  message: any;
  executionState: any;
  formatDuration: (durationMs: number) => string;
}

function ThinkingBlock({
  block,
  blockIndex,
  collapsedThinking,
  toggleThinking,
  thinkingBlockRefs,
  safeStringify,
  message,
  executionState,
  formatDuration,
}: ThinkingBlockProps) {
  if (!block.id) return null;

  const isOpen = collapsedThinking[block.id] === false;

  // Find execution state for THIS specific thinking block
  const allThinkingExecutions = Object.values(
    executionState[message.id] || {},
  ).filter((e: any) => e.type === 'thinking');

  // Use the stable thinking block index if available
  const blockThinkingIndex = block.thinkingBlockIndex ?? 0;
  const thisBlockExecution = allThinkingExecutions[blockThinkingIndex] || null;

  const isThinking = thisBlockExecution?.status === 'executing';
  const isCompleted = thisBlockExecution?.status === 'complete';

  return (
    <div
      key={block.id || blockIndex}
      className="individual-thinking-block"
      style={{ marginBottom: '12px' }}
    >
      <button
        type="button"
        className={`thinking-header ${isOpen ? '' : 'collapsed'}`}
        onClick={() => toggleThinking(block.id!)}
        aria-expanded={isOpen}
        aria-label={`${isOpen ? 'Collapse' : 'Expand'} thinking block`}
      >
        <div className="header-content">
          <div className="header-text">Reasoning</div>
          <div className="header-badges">
            {isThinking && <span className="executing-badge">Thinking...</span>}
            {isCompleted && thisBlockExecution?.duration_ms && (
              <span className="time-badge">
                {formatDuration(thisBlockExecution.duration_ms)}
              </span>
            )}
          </div>
        </div>
        <div className="header-icon">
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>
      <div
        ref={(el) => {
          if (block.id) {
            thinkingBlockRefs.current[block.id] = el;
          }
        }}
        className={`thinking-content ${isOpen ? 'expanded' : 'collapsed'}`}
        style={{
          maxHeight: isOpen ? '50vh' : '0',
        }}
      >
        <div className="thinking-content-inner">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {safeStringify(block.thinkingContent || '')}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default ThinkingBlock;
