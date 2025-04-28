/**
 * ChatHistory class to manage conversation history between user and assistant
 * The history is stored as a list of key-value pairs where each element
 * represents a message from either the user or assistant.
 * This format allows the history to be passed to an LLM as separate message objects.
 */

import {app} from 'electron';
import log from 'electron-log';
import { Message } from 'ollama';
import { Database } from 'sqlite3';

interface ChatHistoryMessage {
  role: string; // 'user', 'assistant', or 'tool'
  content: string;
}

type Chat = {
  id: string;
  title: string;
  created_at: Date;
};

class ChatHistory {
  private messages: ChatHistoryMessage[] = [];

  /**
   * Add a user message to the chat history
   * @param content The content of the user message
   */
  addUserMessage(content: string): void {
    this.messages.push({
      role: 'user',
      content: content
    });
  }

  /**
   * Add an assistant message to the chat history
   * @param content The content of the assistant message
   */
  addAssistantMessage(content: string): void {
    this.messages.push({
      role: 'assistant',
      content: content
    });
  }

  /**
   * Get all messages in the chat history
   * @returns Array of ChatHistoryMessage objects
   */
  getMessages(): ChatHistoryMessage[] {
    return [...this.messages];
  }

  /**
   * Convert chat history to format used by Ollama LLM
   * @returns Array of Message objects in Ollama format
   */
  toOllamaMessages(): Message[] {
    return this.messages.map(message => ({
      role: message.role,
      content: message.content
    }));
  }

  /**
   * Clear the chat history
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Convert the chat history to a simple string format (for backward compatibility)
   * @returns Chat history as a formatted string
   */
  toString(): string {
    return this.messages
      .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
      .join('\n');
  }

  /**
   * Get the number of messages in the chat history
   * @returns Number of messages
   */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Check if the chat history is empty
   * @returns True if there are no messages, false otherwise
   */
  isEmpty(): boolean {
    return this.messages.length === 0;
  }
}

class PersistentChatHistory {
  private db: Database;

  constructor() {
    const dbPath = app.getPath('userData') + '/chat_history.db';
    this.db = new Database(dbPath, (err) => {
      if (!err) {
        this.initializeDatabase();
      }
      if (err) {
        log.error('Error opening database:', err.message);
      }
    });
  }

  /**
   * Initialize the chat history table if it doesn't exist
   */
  private initializeDatabase(): void {
    // Create chats table if it doesn't exist
    const createChatsTableQuery = `
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    log.info('Initializing database with query', this.db);

    this.db.run(createChatsTableQuery, (err) => {
      if (err) {
        console.error('Error creating chats table:', err.message);
      }
    });

    // Create chat_messages table if it doesn't exist
    const createMessagesTableQuery = `
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        role TEXT CHECK(role IN ('user', 'assistant', 'tool')) NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES chats(id)
      )
    `;

    this.db.run(createMessagesTableQuery, (err) => {
      if (err) {
        console.error('Error creating chat_messages table:', err.message);
      }
    });
  }

  /**
   * Clear the chats from the database
   * @returns Promise that resolves when the chats are cleared
   */
  clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM chats', (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get the number of chats
   * @returns Promise that resolves with the number of chats
   */
  async getLength(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT COUNT(*) as count FROM chats', (err, row: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }

  /**
   * Check if the chat history is empty
   * @returns Promise that resolves with true if empty, otherwise false
   */
  async isEmpty(): Promise<boolean> {
    const length = await this.getLength();
    return length === 0;
  }

  /**
   * Add a new chat to the database
   * @param chat Chat object to add
   * @returns Promise that resolves with the added chat
   */
  addChat(chat: Chat): Promise<Chat> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO chats (id, title, created_at) VALUES (?, ?, ?)
      `);

      stmt.run([chat.id, chat.title, chat.created_at], (err) => {
        if (err) {
          stmt.finalize();
          reject(err);
        } else {
          stmt.finalize();
          resolve(chat);
        }
      });
    });
  }

  /**
   * Get recent chats from the database
   * @param limit Maximum number of chats to return
   * @returns Promise that resolves with array of Chat objects
   */
  getRecentChats(limit = 10): Promise<Chat[]> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        SELECT id, title FROM chats ORDER BY created_at DESC LIMIT ?
      `);

      stmt.all([limit], (err, rows) => {
        if (err) {
          stmt.finalize();
          reject(err);
        } else {
          stmt.finalize();
          resolve(rows as Chat[]);
        }
      });
    });
  }

  /**
   * Update a chat's title in the database
   * @param chatId ID of the chat to update
   * @param title New title for the chat
   * @returns Promise that resolves when the update is complete
   */
  updateChatTitle(chatId: string, title: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        UPDATE chats SET title = ? WHERE id = ?
      `);

      stmt.run([title, chatId], (err) => {
        if (err) {
          stmt.finalize();
          reject(err);
        } else {
          stmt.finalize();
          resolve();
        }
      });
    });
  }

  /**
   * Close the database connection
   * @returns Promise that resolves when the connection is closed
   */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get messages for a specific chat
   * @param chatId ID of the chat to get messages for
   * @returns Promise that resolves with array of messages
   */
  getMessagesForChat(chatId: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const selectQuery = `
        SELECT id, role, content, timestamp 
        FROM chat_messages 
        WHERE chat_id = ? 
        ORDER BY timestamp ASC
      `;

      this.db.all(selectQuery, [chatId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Ensure we return an array even if no rows found
          const messages = rows || [];
          resolve(messages);
        }
      });
    });
  }

  /**
   * Add a message to a specific chat
   * @param chatId ID of the chat to add message to
   * @param role Role of the sender (user or assistant)
   * @param content Content of the message
   * @returns Promise that resolves when the message is added
   */
  addMessageToChat(chatId: string, role: 'user' | 'assistant' | 'tool', content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO chat_messages (chat_id, role, content, timestamp) 
        VALUES (?, ?, ?, ?)
      `);

      stmt.run([chatId, role, content, new Date()], (err) => {
        if (err) {
          stmt.finalize();
          reject(err);
        } else {
          stmt.finalize();
          resolve();
        }
      });
    });
  }

  /**
   * Get a single chat by ID
   * @param chatId ID of the chat to retrieve
   * @returns Promise that resolves with the chat or null if not found
   */
  getChat(chatId: string): Promise<Chat | null> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        SELECT id, title, created_at FROM chats WHERE id = ?
      `);

      stmt.get([chatId], (err, row: any) => {
        if (err) {
          stmt.finalize();
          reject(err);
        } else {
          stmt.finalize();
          if (row) {
            const chat: Chat = {
              id: row.id,
              title: row.title,
              created_at: row.created_at
            };
            resolve(chat);
          } else {
            resolve(null);
          }
        }
      });
    });
  }

  /**
   * Delete a chat and all its messages
   * @param chatId ID of the chat to delete
   * @returns Promise that resolves when the chat is deleted
   */
  deleteChat(chatId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Start a transaction to ensure both operations complete or fail together
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        
        // Delete messages first (due to foreign key constraint)
        this.db.run('DELETE FROM chat_messages WHERE chat_id = ?', [chatId], (err) => {
          if (err) {
            this.db.run('ROLLBACK');
            return reject(err);
          }
          
          // Then delete the chat itself
          this.db.run('DELETE FROM chats WHERE id = ?', [chatId], (err2) => {
            if (err2) {
              this.db.run('ROLLBACK');
              return reject(err2);
            }
            
            this.db.run('COMMIT');
            resolve();
          });
        });
      });
    });
  }
}

export { ChatHistory, PersistentChatHistory };
