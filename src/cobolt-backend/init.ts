import { initOllama } from './ollama_client';
import log from 'electron-log/main';
import fixPath from 'fix-path';
import appMetadata from './data_models/app_metadata';
import { updateMemoryEnabled } from './memory';
export async function initDependencies() {
  fixPath();
  // TODO: This is a hack to force memory to be disabled when the app starts
  // Mem0 does not work on Mac OS 
  appMetadata.setMemoryEnabled(false)
  const memoryEnabled: boolean = appMetadata.getMemoryEnabled();
  updateMemoryEnabled(memoryEnabled);
  const success = await initOllama();
  if (!success) {
    log.error('Failed to initialize Ollama');
    process.exit(1);
  }
}
