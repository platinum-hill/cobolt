import React, { ChangeEvent, useState, useEffect, useCallback } from 'react';
import Toggle from 'react-toggle';
import log from 'electron-log/renderer';
import { ModelResponse } from 'ollama';
import { Plus, Trash2 } from 'lucide-react';
import ToolList from '../ToolInfo/ToolList';
import 'react-toggle/style.css';
import './SettingsPanel.css';

interface Chat {
  id: string;
  title: string;
  lastMessage?: string;
  timestamp: Date;
}

interface SettingsPanelProps {
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  onNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  currentChatId: string | null;
}

function SettingsPanel({
  isLoading,
  setIsLoading,
  onNewChat,
  onSelectChat,
  currentChatId,
}: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelResponse[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isToolInfoOpen, setIsToolInfoOpen] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [isOverlayMode, setIsOverlayMode] = useState(window.innerWidth <= 700);

  // Get initial memory setting
  useEffect(() => {
    const fetchMemoryEnabled = async () => {
      const enabled = await window.api.getMemoryEnabled();
      setMemoryEnabled(enabled);
    };
    fetchMemoryEnabled();
  }, []);

  // Handle memory toggle change
  const handleMemoryToggle = (event: ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked;
    setMemoryEnabled(enabled);
    window.api.setMemoryEnabled(enabled);
  };

  // Function to fetch both available models and current models
  const fetchModelsData = useCallback(async () => {
    setIsLoading(true);

    // Get available models from Ollama
    const modelsResult = await window.electron.ipcRenderer.invoke(
      'get-available-models',
    );

    if (!modelsResult.success) {
      log.error(modelsResult.message || 'Failed to fetch models');
      return;
    }

    setAvailableModels(modelsResult.models);

    // Get current model configuration
    const configResult = await window.electron.ipcRenderer.invoke('get-config');
    if (!configResult.success) {
      log.error('Failed to load current model configuration');
      return;
    }

    // Set selected model to the current CHAT_MODEL
    if (configResult.data.models && configResult.data.models.CHAT_MODEL) {
      setSelectedModel(configResult.data.models.CHAT_MODEL.name);
    }

    setIsLoading(false);
  }, [setIsLoading]);

  useEffect(() => {
    fetchModelsData();
  }, [fetchModelsData]);

  // Handle model selection change
  const handleModelChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const newModelName = e.target.value;
    setSelectedModel(newModelName);
    setIsLoading(true);
    const result = await window.electron.ipcRenderer.invoke(
      'update-core-models',
      newModelName,
    );
    if (!result.success) {
      log.error(result.message || 'Failed to update models');
    }
    setIsLoading(false);
  };

  // Handle window resize and auto-close panel on small screens
  useEffect(() => {
    const handleResize = () => {
      const newWidth = window.innerWidth;
      setWindowWidth(newWidth);

      // Check if we should be in overlay mode (small screens)
      setIsOverlayMode(newWidth <= 700);

      // Auto-close panel on very small screens
      if (newWidth < 500 && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isOpen) {
        const panel = document.querySelector('.settings-panel');
        const button = document.querySelector('.toggle-button');

        if (
          panel &&
          button &&
          !panel.contains(e.target as Node) &&
          !button.contains(e.target as Node)
        ) {
          setIsOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Update app container class when panel opens/closes
  useEffect(() => {
    const appContainer = document.querySelector('.app-container');
    if (appContainer) {
      if (isOpen) {
        appContainer.classList.add('panel-open');
      } else {
        appContainer.classList.remove('panel-open');
      }
    }

    // When panel is open in overlay mode, prevent background scrolling
    if (isOverlayMode) {
      document.body.style.overflow = isOpen ? 'hidden' : '';
    }
  }, [isOpen, isOverlayMode]);

  // Disable panel button on very small screens
  const isPanelDisabled = windowWidth < 400;

  // Load chats from database
  useEffect(() => {
    const loadChats = async () => {
      try {
        setIsLoading(true);
        const chatsData = await window.api.getRecentChats();
        setChats(chatsData);
      } catch (error) {
        log.error('Failed to load chats:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadChats();

    return () => {
      // This doesn't actually remove the listener in the current implementation,
      // but in a more complete implementation, we would have a way to remove it
    };
  }, [setIsLoading]);

  const handleNewChat = async () => {
    try {
      // Check if current chat has messages
      if (currentChatId) {
        const messages = await window.api.getMessagesForChat(currentChatId);
        if (messages.length === 0) {
          // If current chat has no messages, just select it instead of creating a new one
          onSelectChat(currentChatId);
          return;
        }
      }

      setIsLoading(true);
      await onNewChat();
      // Reload chats after creating a new one
      const chatsData = await window.api.getRecentChats();
      setChats(chatsData);

      // On mobile, close the panel after selecting a new chat
      if (window.innerWidth < 768) {
        setIsOpen(false);
      }
    } catch (error) {
      log.error('Failed to create new chat:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectChat = (chatId: string) => {
    if (!chatId) return;
    onSelectChat(chatId);

    // On mobile, close the panel after selecting a chat
    if (window.innerWidth < 768) {
      setIsOpen(false);
    }
  };

  const handleDeleteChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation(); // Prevent triggering the parent button click
    try {
      setIsLoading(true);
      await window.api.deleteChat(chatId);

      // If we're deleting the current chat, create a new one
      if (chatId === currentChatId) {
        await onNewChat();
      }

      // Refresh the chat list
      const chatsData = await window.api.getRecentChats();
      setChats(chatsData);
    } catch (error) {
      log.error('Failed to delete chat:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Truncate long message for preview
  const truncateMessage = (message: string) => {
    return message.length > 60 ? `${message.substring(0, 60)}...` : message;
  };

  return (
    <>
      <div
        className={`settings-panel ${isOpen ? 'open' : 'closed'} ${isOverlayMode ? 'overlay-mode' : ''}`}
      >
        <div className="panel-header">
          <h2>Cobolt</h2>
          <button
            type="button"
            className="close-panel-button"
            onClick={() => setIsOpen(false)}
            aria-label="Close panel"
          >
            ×
          </button>
        </div>

        <button
          type="button"
          onClick={handleNewChat}
          className="new-chat-button"
          disabled={isLoading}
        >
          <Plus size={18} />
          <span className="button-text">New Chat</span>
        </button>

        <div className="conversations-section">
          <h3>Conversations</h3>
          {isLoading && <div className="loading-indicator">Loading...</div>}

          {!isLoading && chats.length === 0 && (
            <div className="conversation-placeholder">
              No past conversations yet
            </div>
          )}

          {!isLoading && chats.length > 0 && (
            <ul className="conversations-list">
              {chats.map((chat) => (
                <li key={chat.id}>
                  <div className="conversation-item-container">
                    <button
                      type="button"
                      className={`conversation-item ${currentChatId === chat.id ? 'active' : ''}`}
                      onClick={() => handleSelectChat(chat.id)}
                    >
                      <div className="conversation-content">
                        <div className="conversation-title">{chat.title}</div>
                        {chat.lastMessage && (
                          <div className="conversation-preview">
                            {truncateMessage(chat.lastMessage)}
                          </div>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="delete-chat-button"
                      onClick={(e) => handleDeleteChat(e, chat.id)}
                      aria-label="Delete chat"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="model-selection-section">
          <h3>Model Selection</h3>
          <div className="model-dropdown-container">
            <select
              value={selectedModel}
              onChange={handleModelChange}
              disabled={isLoading}
              className="model-dropdown"
            >
              {availableModels.length > 0 ? (
                availableModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))
              ) : (
                <option value="">No models available</option>
              )}
            </select>
            <button
              type="button"
              className="refresh-button"
              onClick={fetchModelsData}
              disabled={isLoading}
              aria-label="Refresh models"
            >
              {isLoading ? '⟳' : '↻'}
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>Settings</h3>
          <div className="toggle-setting">
            <div className="toggle-row">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label id="memory-toggle-label" htmlFor="memory-toggle">
                Enable Memory
                <span className="info-icon" title="Experimental feature">
                  i
                </span>
              </label>
              <Toggle
                id="memory-toggle"
                checked={memoryEnabled}
                onChange={handleMemoryToggle}
                className="memory-toggle"
                aria-labelledby="memory-toggle-label"
              />
            </div>
          </div>
          <button
            type="button"
            className="settings-button"
            onClick={() => setIsToolInfoOpen(true)}
          >
            Integrations
          </button>
        </div>

        <div className="about-section">
          <p>Version 0.0.3</p>
          <p>© 2025 Cobolt</p>
        </div>
      </div>
      <ToolList isOpen={isToolInfoOpen} setisOpen={setIsToolInfoOpen} />
      {!isOpen && (
        <button
          type="button"
          className="toggle-button"
          onClick={() => setIsOpen(true)}
          aria-label="Open settings panel"
          disabled={isPanelDisabled}
        >
          <div className="hamburger">
            <span />
            <span />
            <span />
          </div>
        </button>
      )}

      {/* Add overlay background for small screens */}
      {isOverlayMode && isOpen && (
        <button
          type="button"
          className="settings-overlay"
          onClick={() => setIsOpen(false)}
          aria-label="Close settings panel"
        />
      )}
    </>
  );
}

export default SettingsPanel;
