import React from 'react';
import { Send } from 'lucide-react';

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  isLoading: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  handleSendMessage: (e: React.FormEvent) => void;
  handleCancelMessage: () => void;
}

function ChatInput({
  inputMessage,
  setInputMessage,
  isLoading,
  textareaRef,
  handleSendMessage,
  handleCancelMessage,
}: ChatInputProps) {
  const hasText = inputMessage.trim().length > 0;

  return (
    <div className="input-section">
      <div className="input-wrapper">
        <div className="input-container">
          <div className="input-row">
            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="What would you like to know?"
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

            {/* Send button - appears when there's text and not loading */}
            {!isLoading && hasText && (
              <button
                type="button"
                onClick={handleSendMessage}
                className="send-button"
                aria-label="Send message"
              >
                <Send size={16} />
              </button>
            )}

            {/* Send button placeholder - greyed out when no text and not loading */}
            {!isLoading && !hasText && (
              <button
                type="button"
                className="send-button disabled"
                aria-label="Send message"
                disabled
              >
                <Send size={16} />
              </button>
            )}

            {/* Cancel button - appears when loading, in same position as send button */}
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
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatInput;
