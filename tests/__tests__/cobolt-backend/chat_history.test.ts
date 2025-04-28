import { ChatHistory } from '../../../src/cobolt-backend/chat_history';

describe('ChatHistory', () => {
  let chatHistory: ChatHistory;

  beforeEach(() => {
    chatHistory = new ChatHistory();
  });

  test('should start with an empty history', () => {
    expect(chatHistory.getMessages()).toEqual([]);
    expect(chatHistory.length).toBe(0);
    expect(chatHistory.isEmpty()).toBe(true);
  });

  test('should add user messages correctly', () => {
    chatHistory.addUserMessage('Hello');

    expect(chatHistory.getMessages()).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
    expect(chatHistory.length).toBe(1);
    expect(chatHistory.isEmpty()).toBe(false);
  });

  test('should add assistant messages correctly', () => {
    chatHistory.addAssistantMessage('Hello, how can I help you?');

    expect(chatHistory.getMessages()).toEqual([
      { role: 'assistant', content: 'Hello, how can I help you?' },
    ]);
    expect(chatHistory.length).toBe(1);
    expect(chatHistory.isEmpty()).toBe(false);
  });

  test('should maintain message order', () => {
    chatHistory.addUserMessage('Hello');
    chatHistory.addAssistantMessage('Hi there!');
    chatHistory.addUserMessage('How are you?');

    expect(chatHistory.getMessages()).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    ]);
    expect(chatHistory.length).toBe(3);
  });

  test('should convert to Ollama message format correctly', () => {
    chatHistory.addUserMessage('Hello');
    chatHistory.addAssistantMessage('Hi there!');

    expect(chatHistory.toOllamaMessages()).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  test('should clear history correctly', () => {
    chatHistory.addUserMessage('Hello');
    chatHistory.addAssistantMessage('Hi there!');

    expect(chatHistory.length).toBe(2);

    chatHistory.clear();

    expect(chatHistory.getMessages()).toEqual([]);
    expect(chatHistory.length).toBe(0);
    expect(chatHistory.isEmpty()).toBe(true);
  });

  test('should convert to string format correctly', () => {
    chatHistory.addUserMessage('Hello');
    chatHistory.addAssistantMessage('Hi there!');

    expect(chatHistory.toString()).toBe('User: Hello\nAssistant: Hi there!');
  });

  test('getMessages should return a copy of messages array', () => {
    chatHistory.addUserMessage('Hello');

    const messages = chatHistory.getMessages();
    messages.push({ role: 'assistant', content: 'Modified externally' });

    expect(chatHistory.length).toBe(1);
    expect(chatHistory.getMessages()).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });
});
