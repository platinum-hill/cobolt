import React from 'react';
import { Trash2 } from 'lucide-react';

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  isLoading: boolean;
  hasMessages: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  handleSendMessage: (e: React.FormEvent) => void;
  handleCancelMessage: () => void;
  handleResetChat: () => void;
}

function ChatInput({
  inputMessage,
  setInputMessage,
  isLoading,
  hasMessages,
  textareaRef,
  handleSendMessage,
  handleCancelMessage,
  handleResetChat,
}: ChatInputProps) {
  return (
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
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatInput;
