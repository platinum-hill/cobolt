import { ModelResponse, Ollama } from 'ollama';
import log from 'electron-log/main';
import configStore from './data_models/config_store';

const ollama = new Ollama({
  host: configStore.getOllamaUrl(),
});

export type ModelType = 'CHAT_MODEL' | 'TOOLS_MODEL' | 'MEMORY_MODEL' | 'TEXT_EMBEDDING_MODEL';

/**
 * Central object containing model values loaded once and updated when configuration changes
 */
export const MODELS = {
  CHAT_MODEL: configStore.getChatModel().name,
  CHAT_MODEL_CONTEXT_LENGTH: configStore.getChatModel().contextLength,
  TOOLS_MODEL: configStore.getToolsModel().name,
  TOOLS_MODEL_CONTEXT_LENGTH: configStore.getToolsModel().contextLength,
  MEMORY_MODEL: configStore.getMemoryModel().name,
  TEXT_EMBEDDING_MODEL: configStore.getTextEmbeddingModel().name,
  TEXT_EMBEDDING_MODEL_DIMENSION: configStore.getTextEmbeddingModel().dimension,
};

/**
 * Get all available models from Ollama
 */
export async function getAvailableModels(): Promise<ModelResponse[]> {
  try {
    const modelsList = await ollama.list();
    return modelsList.models;
  } catch (error) {
    log.error('Failed to fetch models from Ollama:', error);
    return [];
  }
}

/**
 * Get current model configuration
 */
export function getCurrentModels() {
  return configStore.getFullConfig().models;
}

/**
 * Update a specific model in the configuration
 */
export async function updateModel(modelType: ModelType, newModelName: string): Promise<boolean> {
  try {
    log.info(`Updating ${modelType} to ${newModelName}`);
    
    // Update the model in the store
    switch (modelType) {
      case 'CHAT_MODEL':
        configStore.setChatModel(newModelName, configStore.getChatModel().contextLength);
        break;
      case 'TOOLS_MODEL':
        configStore.setToolsModel(newModelName, configStore.getToolsModel().contextLength);
        break;
      case 'MEMORY_MODEL':
        configStore.setMemoryModel(newModelName);
        break;
      case 'TEXT_EMBEDDING_MODEL':
        configStore.setTextEmbeddingModel(
          newModelName, 
          configStore.getTextEmbeddingModel().dimension
        );
        break;
    }
    
    // Update the in-memory model value
    MODELS[modelType] = newModelName;
    
    log.info(`Updated ${modelType} to ${newModelName}`);
    return true;
  } catch (error) {
    log.error(`Failed to update model configuration for ${modelType}:`, error);
    if (error instanceof Error) {
      log.error(`Error details: ${error.message}`);
    } else {
      log.error('Error details: Unknown error type');
    }
    return false;
  }
}

/**
 * Update multiple models at once
 * @param newModelName - The new model name to apply to all core models
 * @returns - True if all updates succeeded, false if any failed
 */
export async function updateCoreModels(newModelName: string): Promise<boolean> {
  try {
    const coreModelTypes: ModelType[] = ['CHAT_MODEL', 'TOOLS_MODEL', 'MEMORY_MODEL'];
    
    log.info(`Updating all core models to ${newModelName}`);
    
    // Update all core models to the same model name
    for (const modelType of coreModelTypes) {
      await updateModel(modelType, newModelName);
    }
    
    log.info(`Successfully updated all core models to ${newModelName}`);
    return true;
  } catch (error) {
    log.error(`Failed to update core models:`, error);
    if (error instanceof Error) {
      log.error(`Error details: ${error.message}`);
    } else {
      log.error('Error details: Unknown error type');
    }
    return false;
  }
}