import { useState, useEffect } from 'react';
import log from 'electron-log/renderer';
import ChatInterface from '../ChatInterface/ChatInterface';
import SettingsPanel from '../SettingsPanel/SettingsPanel';
import ErrorDialog from '../ErrorDialog/ErrorDialog';
import UpdateNotification from '../UpdateNotification/UpdateNotification';
import './App.css';

export default function App() {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);

  // On mount, try to load the last active chat
  useEffect(() => {
    const loadLastChat = async () => {
      try {
        const chats = await window.api.getRecentChats();
        // If there are existing chats, load the most recent one
        if (chats && chats.length > 0) {
          setCurrentChatId(chats[0].id);
        }
      } catch (error) {
        log.error('Failed to load last chat:', error);
      }
    };

    loadLastChat();
  }, []);

  const handleNewChat = async () => {
    try {
      // The backend will automatically clear the chat history
      const newChat = await window.api.createNewChat();
      setCurrentChatId(newChat.id);
      return newChat;
    } catch (error) {
      log.error('Failed to create new chat:', error);
      throw error;
    }
  };

  const handleSelectChat = async (chatId: string) => {
    if (!chatId) return;

    try {
      // Load the chat history in the backend
      await window.api.loadChat(chatId);
      setCurrentChatId(chatId);
    } catch (error) {
      log.error('Failed to load chat:', error);
    }
  };

  return (
    <div className="app-container">
      <ChatInterface currentChatId={currentChatId} isLoading={isLoading} />
      <SettingsPanel
        isLoading={isLoading}
        setIsLoading={setIsLoading}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        currentChatId={currentChatId}
      />
      <ErrorDialog />
      <UpdateNotification />
    </div>
  );
}
