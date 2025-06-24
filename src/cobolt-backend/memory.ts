import { Memory, Message } from "mem0ai/oss";
import appMetadata from "./data_models/app_metadata";
import { MODELS } from "./model_manager";
import { app } from "electron";
import path from "path";
import log from 'electron-log/main';

const appDataPath = app.getPath('userData');

const memoryConfig = {
    version: "v1",
    embedder: {
      provider: "ollama",
      config: {
        apiKey: "mem0_1234567890",
        model: MODELS.TEXT_EMBEDDING_MODEL,
      },
    },
    vectorStore: {
      provider: "memory",
      config: {
        collectionName: "memories",
        dimension: MODELS.TEXT_EMBEDDING_MODEL_DIMENSION,
        // This key does not exist in the memory config interface, but is used by the vector store 
        // constructor in Mem0. It is needed since Mem0 defaults to storing data in the current working directory.
        dbPath: path.join(appDataPath, "memory.db"),
      },
    },
    llm: {
      provider: "ollama",
      config: {
        model: MODELS.MEMORY_MODEL,
      },
    },
    historyStore: {
      provider: "sqlite",
      config: {
        historyDbPath: path.join(appDataPath, "memory-history.db"),
      },
    }
}

// Initialize memory instance as undefined to allow for proper type checking
let memory: Memory | undefined;
let memoryEnabled: boolean; 

function updateMemoryEnabled(enabled: boolean): void {
  memoryEnabled = enabled;
  appMetadata.setMemoryEnabled(enabled);
  if (enabled) {
    initMemory();
  }
}

/**
 * Initializes the memory instance if it hasn't been initialized yet
 */
function initMemory(): void {
  if (!memory) {
    memory = new Memory(memoryConfig);
  }
}

/**
 * Adds messages to the memory store
 * @param messages Array of messages to add to memory
 */
async function addToMemory(messages: Message[]): Promise<void> {
    if (!memoryEnabled) {
      return;
    }
        
    try {
      const result = await memory?.add(messages, {userId: "userid"});
      log.info('[Memory] SUCCESS memory.add() result:', result);
    } catch (error) {
      log.error('[Memory] Memory storage FAILED:', error);
      throw error;
    }
}

/**
 * Searches the memory store for relevant memories
 * @param query The query to search for
 * @returns A string of relevant memories
 */
async function searchMemories(query: string): Promise<string> {
    if (!memoryEnabled) {
      return "";
    }
    const relevantMemories = await memory?.search(query, {userId: "userid"});
    const memoriesStr = relevantMemories?.results.map((entry) => `- ${entry.memory}`)
                            .join("\n") ?? "";
    return memoriesStr;
}

async function clearMemory(): Promise<void> {
    if (!memoryEnabled) {
      return;
    }
    await memory?.deleteAll({userId: "userid"});
}

async function listMemories(): Promise<string> {
    if (!memoryEnabled) {
      return "";
    }
    const memories = await memory?.getAll({userId: "userid", limit: 1000});
    const memoriesStr = memories?.results.map((entry) => `- ${entry.memory}`)
                            .join("\n") ?? "";
    return memoriesStr;
}

// Command-line interface for direct invocation
if (require.main === module) {
  const [, , command] = process.argv;
  
  if (command === 'listMemories') {
    (async () => {
      try {
        const memories = await listMemories();
        log.info(memories);
      } catch (error) {
        log.error('Error listing memories:', error);
      }
    })();
  } else if (command === 'clearMemory') {
    (async () => {
      try {
        await clearMemory();
        log.info('Memory cleared successfully');
      } catch (error) {
        log.error('Error clearing memory:', error);
      }
    })();
  }
}

function isMemoryEnabled(): boolean {
  return memoryEnabled;
}

export { addToMemory, searchMemories, clearMemory, listMemories, updateMemoryEnabled, isMemoryEnabled };