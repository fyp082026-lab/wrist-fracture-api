import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHUNK_SIZE = 1800; // Safe threshold well below 2048-byte limit

/**
 * Robust SecureStore adapter for Supabase Auth in React Native.
 * Uses iOS Keychain & Android Keystore on native devices with automatic chunking
 * for larger tokens, falling back to AsyncStorage on Web.
 */
export const secureStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      try {
        return await AsyncStorage.getItem(key);
      } catch {
        return null;
      }
    }

    try {
      // 1. Check if item was stored as chunks
      const chunkCountStr = await SecureStore.getItemAsync(`${key}_chunks`);
      if (chunkCountStr) {
        const count = parseInt(chunkCountStr, 10);
        let assembled = '';
        for (let i = 0; i < count; i++) {
          const chunk = await SecureStore.getItemAsync(`${key}_chunk_${i}`);
          if (chunk) {
            assembled += chunk;
          }
        }
        return assembled || null;
      }

      // 2. Otherwise read single key
      return await SecureStore.getItemAsync(key);
    } catch {
      // Graceful fallback to AsyncStorage if SecureStore fails
      try {
        return await AsyncStorage.getItem(key);
      } catch {
        return null;
      }
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      try {
        await AsyncStorage.setItem(key, value);
      } catch {
        // web storage error ignored
      }
      return;
    }

    try {
      // First clean up any old chunks
      const oldChunksStr = await SecureStore.getItemAsync(`${key}_chunks`);
      if (oldChunksStr) {
        const oldCount = parseInt(oldChunksStr, 10);
        for (let i = 0; i < oldCount; i++) {
          await SecureStore.deleteItemAsync(`${key}_chunk_${i}`).catch(() => undefined);
        }
        await SecureStore.deleteItemAsync(`${key}_chunks`).catch(() => undefined);
      }

      // If value is small enough, store directly
      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        return;
      }

      // Value exceeds chunk threshold: split into chunks
      await SecureStore.deleteItemAsync(key).catch(() => undefined);
      const totalChunks = Math.ceil(value.length / CHUNK_SIZE);
      await SecureStore.setItemAsync(`${key}_chunks`, totalChunks.toString());

      for (let i = 0; i < totalChunks; i++) {
        const chunk = value.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        await SecureStore.setItemAsync(`${key}_chunk_${i}`, chunk);
      }
    } catch {
      // Fallback to AsyncStorage if SecureStore unavailable
      try {
        await AsyncStorage.setItem(key, value);
      } catch {
        // storage failed
      }
    }
  },

  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // ignore
      }
      return;
    }

    try {
      const chunkCountStr = await SecureStore.getItemAsync(`${key}_chunks`);
      if (chunkCountStr) {
        const count = parseInt(chunkCountStr, 10);
        for (let i = 0; i < count; i++) {
          await SecureStore.deleteItemAsync(`${key}_chunk_${i}`).catch(() => undefined);
        }
        await SecureStore.deleteItemAsync(`${key}_chunks`).catch(() => undefined);
      }
      await SecureStore.deleteItemAsync(key).catch(() => undefined);
    } catch {
      // ignore
    }

    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
