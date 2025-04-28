import Store from 'electron-store';

type ConfigSchema = {
  ollama: {
    url: string;
    startTimeout: number;
  };
  models: {
    CHAT_MODEL: {
      name: string;
      contextLength: number;
    };
    TOOLS_MODEL: {
      name: string;
      contextLength: number;
    };
    MEMORY_MODEL: {
      name: string;
    };
    TEXT_EMBEDDING_MODEL: {
      name: string;
      dimension: number;
    };
  };
  tools: {
    maxRetries: number;
  };
};

interface TypedStore<T extends Record<string, any>> extends Store<T> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
}

const store = new Store<ConfigSchema>({
  name: 'config',
  defaults: {
    ollama: {
      url: "http://localhost:11434",
      startTimeout: 5000
    },
    models: {
      CHAT_MODEL: {
        name: "llama3.1:8b",
        contextLength: 8192
      },
      TOOLS_MODEL: {
        name: "llama3.1:8b",
        contextLength: 8192
      },
      MEMORY_MODEL: {
        name: "llama3.1:8b"
      },
      TEXT_EMBEDDING_MODEL: {
        name: "nomic-embed-text:v1.5",
        dimension: 768
      }
    },
    tools: {
      maxRetries: 2
    }
  },
}) as TypedStore<ConfigSchema>;

const configStore = {
  getOllamaUrl: (): string => {
    return store.get('ollama').url;
  },
  
  setOllamaUrl: (url: string) => {
    const ollama = store.get('ollama');
    store.set('ollama', { ...ollama, url });
  },
  
  getOllamaStartTimeout: (): number => {
    return store.get('ollama').startTimeout;
  },
  
  setOllamaStartTimeout: (timeout: number) => {
    const ollama = store.get('ollama');
    store.set('ollama', { ...ollama, startTimeout: timeout });
  },
  
  getChatModel: () => {
    return store.get('models').CHAT_MODEL;
  },
  
  setChatModel: (name: string, contextLength: number) => {
    const models = store.get('models');
    store.set('models', { 
      ...models, 
      CHAT_MODEL: { name, contextLength } 
    });
  },
  
  getToolsModel: () => {
    return store.get('models').TOOLS_MODEL;
  },
  
  setToolsModel: (name: string, contextLength: number) => {
    const models = store.get('models');
    store.set('models', { 
      ...models, 
      TOOLS_MODEL: { name, contextLength } 
    });
  },
  
  getMemoryModel: () => {
    return store.get('models').MEMORY_MODEL;
  },
  
  setMemoryModel: (name: string) => {
    const models = store.get('models');
    store.set('models', { 
      ...models, 
      MEMORY_MODEL: { name } 
    });
  },
  
  getTextEmbeddingModel: () => {
    return store.get('models').TEXT_EMBEDDING_MODEL;
  },
  
  setTextEmbeddingModel: (name: string, dimension: number) => {
    const models = store.get('models');
    store.set('models', { 
      ...models, 
      TEXT_EMBEDDING_MODEL: { name, dimension } 
    });
  },
  
  getToolsMaxRetries: (): number => {
    return store.get('tools').maxRetries;
  },
  
  setToolsMaxRetries: (maxRetries: number) => {
    const tools = store.get('tools');
    store.set('tools', { ...tools, maxRetries });
  },
  
  getFullConfig: (): ConfigSchema => {
    return {
      ollama: store.get('ollama'),
      models: store.get('models'),
      tools: store.get('tools')
    };
  },
  
  resetToDefaults: () => {
    store.clear();
  }
};

export default configStore;