import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { config } from '@/services/config';
import { secureStorageAdapter } from '@/services/secureStoreAdapter';

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    // iOS Keychain / Android Keystore (chunked); AsyncStorage on web. Also holds
    // the PKCE code verifier between signInWithOAuth and exchangeCodeForSession.
    storage: secureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // Deep links are handled in AuthContext; there is no window URL on native.
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// React Native has no visibility events, so supabase-js cannot tell when the
// app is backgrounded. Refresh only while it is in the foreground, as the
// Supabase React Native guide recommends; a refresh timer that fires in the
// background is throttled by the OS and can leave an expired token behind.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
