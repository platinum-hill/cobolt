import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface TextBlockProps {
  block: any;
  blockIndex: number;
  safeStringify: (value: any) => string;
}

const TextBlock: React.FC<TextBlockProps> = ({
  block,
  blockIndex,
  safeStringify,
}) => {
  try {
    // Ensure content is a string before rendering
    const safeContent = safeStringify(block.content || '');
    return (
      <div key={block.id || blockIndex} className="text-block">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{safeContent}</ReactMarkdown>
      </div>
    );
  } catch {
    return (
      <div key={block.id || blockIndex} className="text-block error">
        <p
          style={{
            color: '#ff6b6b',
            fontStyle: 'italic',
          }}
        >
          [Error rendering content - content may be corrupted]
        </p>
      </div>
    );
  }
};

export default TextBlock;
