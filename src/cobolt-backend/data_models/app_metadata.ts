import Store from 'electron-store';

type AppMetadataSchema = {
  setupComplete: boolean;
  memoryEnabled: boolean;
};

interface TypedStore<T extends Record<string, any>> extends Store<T> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
}

const store = new Store<AppMetadataSchema>({
  name: 'app-metadata',
  projectName: 'sage',
  defaults: {
    setupComplete: false,
    memoryEnabled: false,
  },
}) as TypedStore<AppMetadataSchema>;

// Export a single object with all methods
const appMetadata = {
  getSetupComplete: (): boolean => {
    return store.get('setupComplete');
  },

  setSetupComplete: () => {
    store.set('setupComplete', true);
  },

  resetSetupComplete: () => {
    store.set('setupComplete', false);
  },

  getMemoryEnabled: (): boolean => {
    return store.get('memoryEnabled');
  },

  setMemoryEnabled: (enabled: boolean) => {
    store.set('memoryEnabled', enabled);
  },
};

export default appMetadata;