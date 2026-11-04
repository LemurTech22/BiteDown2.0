import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const WEB_PREFIX = 'bitedown.';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const webStore: KeyValueStore = {
  async get(key) {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(WEB_PREFIX + key);
  },
  async set(key, value) {
    if (typeof window !== 'undefined') window.localStorage.setItem(WEB_PREFIX + key, value);
  },
  async delete(key) {
    if (typeof window !== 'undefined') window.localStorage.removeItem(WEB_PREFIX + key);
  },
};

const nativeStore: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  delete: (key) => SecureStore.deleteItemAsync(key),
};

export const deviceStore: KeyValueStore = Platform.OS === 'web' ? webStore : nativeStore;
