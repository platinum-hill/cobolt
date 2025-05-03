import React, { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log/renderer';
import { Message } from '../types';
// Reference to preload.d.ts is not needed since it's globally available
// The Window interface is now defined in src/renderer/preload.d.ts

/**
 * Custom hook for managing chat messages
 */
const useMessages = (chatId: string) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const hasMessages = messages.length > 0;

  // Load messages when the chat ID changes
  useEffect(() => {
    const loadMessages = async () => {
      if (!chatId) return;

      try {
        setIsLoading(true);
        const chatMessages = await window.api.getMessagesForChat(chatId);

        // Map the database messages to the expected format
        const formattedMessages = chatMessages.map((msg: any) => ({
          id: msg.id.toString(),
          content: msg.content,
          sender: msg.role === 'user' ? 'user' : 'assistant',
          timestamp: new Date(msg.timestamp),
        }));

        setMessages(formattedMessages);
      } catch (error) {
        log.error('Failed to load messages:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // Reset messages when chat ID changes
    setMessages([]);
    loadMessages();
  }, [chatId]);

  useEffect(() => {
    window.api.onMessage((content: string) => {
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];
        if (lastMessage && lastMessage.sender === 'assistant') {
          lastMessage.content = content;
          return newMessages;
        }
        return [
          ...newMessages,
          {
            id: uuidv4(),
            content,
            sender: 'assistant',
            timestamp: new Date(),
          },
        ];
      });
    });
  }, []);

  // Create a new chat
  const createNewChat = useCallback(async () => {
    try {
      setIsLoading(true);
      // Create a new chat in the database
      const newChat = await window.api.createNewChat();
      setMessages([]);
      setInputMessage('');
      return newChat;
    } catch (error) {
      log.error('Failed to create new chat:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load an existing chat
  const loadChat = useCallback(async (newChatId: string) => {
    try {
      setIsLoading(true);
      await window.api.loadChat(newChatId);
      const chatMessages = await window.api.getMessagesForChat(newChatId);
      setMessages(chatMessages);
      setInputMessage('');
    } catch (error) {
      log.error('Failed to load chat:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle sending a message
  const handleSendMessage = useCallback(
    async (e?: React.FormEvent) => {
      if (e) {
        e.preventDefault();
      }

      if (!inputMessage.trim() || isLoading) return;

      try {
        setIsLoading(true);

        // If we don't have a chat yet, create one
        if (!chatId) {
          await createNewChat();
          setMessages([]);
        }

        // Add user message to UI immediately
        const userMessage: Message = {
          id: uuidv4(),
          sender: 'user',
          content: inputMessage,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);
        setInputMessage('');

        // Send message to backend
        await window.api.sendMessage(chatId!, inputMessage);
      } catch (error) {
        log.error('Error sending message:', error);
        // Show error in UI
        setMessages((prev) => [
          ...prev,
          {
            id: uuidv4(),
            sender: 'assistant',
            content: 'Sorry, there was an error processing your request.',
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [inputMessage, isLoading, chatId, createNewChat],
  );

  // Handle resetting the chat
  const handleResetChat = useCallback(async () => {
    try {
      await window.api.clearChat();
      setIsLoading(true);
      await createNewChat();
      // Clear current messages
      setMessages([]);
      // Trigger chat updated event
      window.dispatchEvent(new CustomEvent('chat-updated'));
    } catch (error) {
      log.error('Failed to reset chat:', error);
    } finally {
      setIsLoading(false);
    }
  }, [createNewChat]);

  return {
    messages,
    inputMessage,
    setInputMessage,
    isLoading,
    setIsLoading,
    setMessages,
    hasMessages,
    chatId,
    handleSendMessage,
    handleResetChat,
    createNewChat,
    loadChat,
  };
};

export default useMessages;
