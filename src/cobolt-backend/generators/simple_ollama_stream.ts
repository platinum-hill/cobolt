import { Message } from 'ollama';
import log from 'electron-log/main';
import { addToMemory } from '../memory';
import { RequestContext, TraceLogger } from '../logger';
import { MODELS } from '../model_manager';
import { getOllamaClient } from '../ollama_client';

const defaultTemperature = 1.0;
const defaultTopK = 64;
const defaultTopP = 0.95;

/**
 * Given a prompt gets the user a query to ollama with the specified tools
 * @returns An generator object that yields the response from the LLM
 */
export async function* simpleChatOllamaStream(
  requestContext: RequestContext,
  systemPrompt: string,
  memories: string = '',
  moreMessages: Message[] = []
): AsyncGenerator<string> {
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
  ]
  
  if (memories) {
    messages.push({ role: 'tool', content: 'User Memories: ' + memories });
  }
  
  if (requestContext.chatHistory.length > 0) {
    requestContext.chatHistory.toOllamaMessages().forEach((message) => {
      messages.push(message);
    });
  }
  messages.push(...moreMessages);
  messages.push({ role: 'user', content: requestContext.question });
  TraceLogger.trace(requestContext, 'final_prompt', messages.map((message) => message.content).join('\n'));
  
  const ollama = getOllamaClient();
  const response = await ollama.chat({
    model: MODELS.CHAT_MODEL,
    messages: messages,
    keep_alive: -1,
    options: {
      temperature: defaultTemperature,
      top_k: defaultTopK,
      top_p: defaultTopP,
      num_ctx: MODELS.CHAT_MODEL_CONTEXT_LENGTH,
    },
    stream: true,
  });
  
  let fullResponse = '';
  for await (const part of response) {
    fullResponse += part.message.content;
    yield part.message.content;
  }
  
  requestContext.chatHistory.addUserMessage(requestContext.question);
  requestContext.chatHistory.addAssistantMessage(fullResponse);

  // This operation runs in the background
  log.info('Sending data to add to memory: ', requestContext.question, fullResponse);
  // TODO: Can we send the tool calls results to memory?
  addToMemory([
    { role: 'user', content: requestContext.question },
    { role: 'assistant', content: fullResponse }
  ]).catch((error) => {
    log.error('Error adding to memory:', error);
  });
}
