import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHUNK_SIZE = 1800; // Safe threshold well below 2048-byte limit

/**
 * Robust SecureStore adapter for Supabase Auth in React Native.
 * Uses iOS Keychain & Android Keystore on native devices with automatic chunking
 * for larger tokens, falling back to AsyncStorage on Web.
 *
 * FLOW: supabase.ts hands this object to the Supabase client, which calls
 * getItem / setItem / removeItem to read, save and delete the sign-in session.
 * This is what keeps a clinician signed in after closing the app.
 */
export const secureStorageAdapter = {
  // Read a saved value (joins the chunks back together). Result goes to: the Supabase client.
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

  // Save a value, split into chunks when it is longer than one secure-store entry allows.
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

  // Delete a value and all its chunks (used on sign-out).
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
