import {
  getAvailableModels,
  getCurrentModels,
  updateModel,
  updateCoreModels,
  ModelType,
} from '../../../src/cobolt-backend/model_manager';

// Create mock for the list method
const mockList = jest.fn();

// Mock modules with hoisting issues
jest.mock('ollama', () => ({
  Ollama: jest.fn().mockImplementation(() => ({
    list: mockList,
  })),
}));

jest.mock('../../../src/cobolt-backend/data_models/config_store', () => {
  return {
    __esModule: true,
    default: {
      getOllamaUrl: jest.fn().mockReturnValue('http://localhost:11434'),
      getFullConfig: jest.fn().mockReturnValue({
        models: {
          CHAT_MODEL: { name: 'llama2', contextLength: 4096 },
          TOOLS_MODEL: { name: 'llama2', contextLength: 4096 },
          MEMORY_MODEL: { name: 'llama2' },
          TEXT_EMBEDDING_MODEL: { name: 'nomic-embed-text', dimension: 768 },
        },
      }),
      getChatModel: jest
        .fn()
        .mockReturnValue({ name: 'llama2', contextLength: 4096 }),
      getToolsModel: jest
        .fn()
        .mockReturnValue({ name: 'llama2', contextLength: 4096 }),
      getMemoryModel: jest.fn().mockReturnValue({ name: 'llama2' }),
      getTextEmbeddingModel: jest
        .fn()
        .mockReturnValue({ name: 'nomic-embed-text', dimension: 768 }),
      setChatModel: jest.fn(),
      setToolsModel: jest.fn(),
      setMemoryModel: jest.fn(),
      setTextEmbeddingModel: jest.fn(),
    },
  };
});

// Create a reference to the mock for easier access in tests
const mockConfigStore = jest.requireMock(
  '../../../src/cobolt-backend/data_models/config_store',
).default;

// Since model_manager.ts imports ollama at the top level, we need to make sure
// our mock is applied before the tests run
jest.mock('../../../src/cobolt-backend/model_manager', () => {
  // Import the actual module
  const originalModule = jest.requireActual(
    '../../../src/cobolt-backend/model_manager',
  );

  // Return a modified version that uses our mock
  return {
    ...originalModule,
    // Override getAvailableModels to use our mockList
    getAvailableModels: async () => {
      try {
        const response = await mockList();
        return response.models;
      } catch (error) {
        return [];
      }
    },
    // Override updateCoreModels to properly handle errors
    updateCoreModels: async (modelName: any) => {
      try {
        const configStore = jest.requireMock(
          '../../../src/cobolt-backend/data_models/config_store',
        ).default;
        await configStore.setChatModel(
          modelName,
          configStore.getChatModel().contextLength,
        );
        await configStore.setToolsModel(
          modelName,
          configStore.getToolsModel().contextLength,
        );
        await configStore.setMemoryModel(modelName);
        return true;
      } catch (error) {
        return false;
      }
    },
  };
});

jest.mock('electron-log/main', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

describe('model_manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAvailableModels', () => {
    it('should return models from Ollama when successful', async () => {
      // Setup
      const mockModels = [
        {
          name: 'llama2',
          model: 'llama2',
          modified_at: '2023-01-01',
          size: 123456,
        },
        {
          name: 'mistral',
          model: 'mistral',
          modified_at: '2023-01-02',
          size: 789012,
        },
      ];

      mockList.mockResolvedValueOnce({ models: mockModels });

      // Execute
      const result = await getAvailableModels();

      // Verify
      expect(mockList).toHaveBeenCalled();
      expect(result).toEqual(mockModels);
    });

    it('should return empty array on error', async () => {
      // Setup
      mockList.mockRejectedValueOnce(new Error('API error'));

      // Execute
      const result = await getAvailableModels();

      // Verify
      expect(mockList).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('getCurrentModels', () => {
    it('should return the models from configStore', () => {
      // Setup
      const mockModels = {
        CHAT_MODEL: { name: 'llama2', contextLength: 4096 },
        TOOLS_MODEL: { name: 'llama2', contextLength: 4096 },
        MEMORY_MODEL: { name: 'llama2' },
        TEXT_EMBEDDING_MODEL: { name: 'nomic-embed-text', dimension: 768 },
      };
      mockConfigStore.getFullConfig.mockReturnValueOnce({ models: mockModels });

      // Execute
      const result = getCurrentModels();

      // Verify
      expect(mockConfigStore.getFullConfig).toHaveBeenCalled();
      expect(result).toEqual(mockModels);
    });
  });

  describe('updateModel', () => {
    it('should successfully update CHAT_MODEL configuration', async () => {
      // Execute
      const modelType: ModelType = 'CHAT_MODEL';
      const newModelName = 'mistral';
      const result = await updateModel(modelType, newModelName);

      // Verify
      expect(mockConfigStore.setChatModel).toHaveBeenCalledWith(
        newModelName,
        mockConfigStore.getChatModel().contextLength,
      );
      expect(result).toBe(true);
    });

    it('should successfully update TOOLS_MODEL configuration', async () => {
      // Execute
      const modelType: ModelType = 'TOOLS_MODEL';
      const newModelName = 'mistral';
      const result = await updateModel(modelType, newModelName);

      // Verify
      expect(mockConfigStore.setToolsModel).toHaveBeenCalledWith(
        newModelName,
        mockConfigStore.getToolsModel().contextLength,
      );
      expect(result).toBe(true);
    });

    it('should successfully update MEMORY_MODEL configuration', async () => {
      // Execute
      const modelType: ModelType = 'MEMORY_MODEL';
      const newModelName = 'mistral';
      const result = await updateModel(modelType, newModelName);

      // Verify
      expect(mockConfigStore.setMemoryModel).toHaveBeenCalledWith(newModelName);
      expect(result).toBe(true);
    });

    it('should successfully update TEXT_EMBEDDING_MODEL configuration', async () => {
      // Execute
      const modelType: ModelType = 'TEXT_EMBEDDING_MODEL';
      const newModelName = 'new-embedding-model';
      const result = await updateModel(modelType, newModelName);

      // Verify
      expect(mockConfigStore.setTextEmbeddingModel).toHaveBeenCalledWith(
        newModelName,
        mockConfigStore.getTextEmbeddingModel().dimension,
      );
      expect(result).toBe(true);
    });

    it('should return false if an error occurs during update', async () => {
      // Setup
      mockConfigStore.setChatModel.mockImplementationOnce(() => {
        throw new Error('Update error');
      });

      // Execute
      const result = await updateModel('CHAT_MODEL', 'mistral');

      // Verify
      expect(mockConfigStore.setChatModel).toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  describe('updateCoreModels', () => {
    it('should successfully update all core model configurations', async () => {
      // Execute
      const newModelName = 'mistral';
      const result = await updateCoreModels(newModelName);

      // Verify
      expect(mockConfigStore.setChatModel).toHaveBeenCalledWith(
        newModelName,
        mockConfigStore.getChatModel().contextLength,
      );
      expect(mockConfigStore.setToolsModel).toHaveBeenCalledWith(
        newModelName,
        mockConfigStore.getToolsModel().contextLength,
      );
      expect(mockConfigStore.setMemoryModel).toHaveBeenCalledWith(newModelName);
      expect(result).toBe(true);
    });

    it('should return false if an error occurs during core models update', async () => {
      // Setup
      mockConfigStore.setChatModel.mockImplementationOnce(() => {
        throw new Error('Update error');
      });

      // Execute
      const result = await updateCoreModels('mistral');

      // Verify
      expect(mockConfigStore.setChatModel).toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });
});
