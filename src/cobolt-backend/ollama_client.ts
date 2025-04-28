import { Ollama, Message, ChatResponse } from 'ollama';
import { exec } from 'child_process';
import log from 'electron-log/main';
import { FunctionTool } from './ollama_tools';
import * as os from 'os';
import configStore from './data_models/config_store';
import { addToMemory } from './memory';
import { RequestContext, TraceLogger } from './logger';
import { formatDateTime } from './datetime_parser';
import { createQueryWithToolsPrompt } from './prompt_templates';
import  { ChatHistory } from './chat_history';
import { MODELS } from './model_manager'

const ollama = new Ollama({
  host: configStore.getOllamaUrl(),
});

const OLLAMA_START_TIMEOUT = configStore.getOllamaStartTimeout();

const defaultTemperature = 1.0;
const defaultTopK = 64;
const defaultTopP = 0.95;

/**
 * If the required models are not available, download them
 *
 * @param model - The name of the model to check/download.
 * @param modelNames - The list of available models.
 */
async function pullRequiredModel(
  model: string,
  modelNames: string[],
): Promise<void> {
  if (!modelNames.includes(model)) {
    log.log(`${model} not found in Ollama: downloading now`);
    await ollama.pull({ model });
  }
}

/**
 * Check if the Ollama server is running and pull the required models
 * If the server is not running, start it and wait 5s for it to be ready
 * If the required models are not available, download them
 */
async function initOllama(): Promise<boolean> {
  const platform = os.platform();
  try {
    await ollama.ps();
  } catch {
    log.log('Error connecting to Ollama: Starting the ollama server');
    log.debug('Platform:', platform);
    const system: string = platform.toLowerCase();
    if (system === 'win32') {
      exec(
        'set OLLAMA_FLASH_ATTENTION=1 && set OLLAMA_KV_CACHE_TYPE=q4_0 && ollama serve &',
      );
    } else if (system === 'darwin' || system === 'linux') {
      exec('OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q4_0 ollama serve &');
    } else {
      log.log(`Unsupported operating system: ${system}`);
      return false;
    }
    await new Promise(function sleep(resolve) {
      setTimeout(resolve, OLLAMA_START_TIMEOUT);
    });
  }

  await updateModels();
  return true;
}

/**
 * Check if the required models are available and download them if they are not
 */
async function updateModels() {
  const modelsList = await ollama.list();
  const existingModelNames: string[] = modelsList.models.map((m) => m.model);

  const config = configStore.getFullConfig();
  const modelPromises = Object.values(config.models).map((model) =>
    pullRequiredModel(model.name, existingModelNames),
  );

  await Promise.all(modelPromises);
}

/**
 * Given a prompt gets the user a query to ollama with the specified tools
 * @param messages - a slice of messages objects
 * @returns An generator object that yields the response from the LLM
 */
async function* simpleChatOllamaStream(requestContext: RequestContext,
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

/**
 * Send a simple query to ollama with the specified tools.
 * @param messages - a slice of messages objects
 * @param toolCalls - the list of FunctionTools to pass with the query
 * @returns - The response from the LLM
 */
async function queryOllamaWithTools(requestContext: RequestContext,
  systemPrompt: string,
  toolCalls: FunctionTool[],
  memories: string = ''): Promise<ChatResponse> {
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
  messages.push({ role: 'user', content: requestContext.question });
  return ollama.chat({
    model: MODELS.TOOLS_MODEL,
    keep_alive: -1,
    messages: messages,
    tools: toolCalls.map((toolCall) => toolCall.toolDefinition),
    options: {
      temperature: defaultTemperature,
      top_k: defaultTopK,
      top_p: defaultTopP,
      num_ctx: MODELS.TOOLS_MODEL_CONTEXT_LENGTH,
    },
  });
}

const getOllamaClient = (): Ollama => {
  return ollama
}

if (require.main === module) {
  (async () => {
    await initOllama();
    const toolCalls: FunctionTool[] = [];
    const requestContext = {
      requestId: '123',
      currentDatetime: new Date(),
      question: 'Give me all of my calender events since last week from friends',
      chatHistory: new ChatHistory(),
    };
    const toolUserMessage = createQueryWithToolsPrompt(formatDateTime(new Date()).toString())
    const response = await queryOllamaWithTools(requestContext, toolUserMessage, toolCalls);
    console.log(response)
    if (!response.message.tool_calls) {
      console.log('No tool calls');
      return;
    }
    for (const toolCall of response.message.tool_calls) {
      console.log('Tool call:', toolCall);
    }
  })();
}

export { initOllama, getOllamaClient, queryOllamaWithTools, simpleChatOllamaStream };
