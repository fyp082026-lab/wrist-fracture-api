/**
 * The app's single Supabase client (sign-in, database tables, X-ray storage).
 *
 * FLOW: config.ts supplies the address and public key; secureStoreAdapter.ts keeps
 * the sign-in session on the phone. `supabase` is then imported by AuthContext
 * (sign-in), analysis.ts (create scan, upload X-ray), records.ts (history) and
 * account.ts (profile).
 */
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { config } from '@/app_logic/config';
import { secureStorageAdapter } from '@/app_logic/secureStoreAdapter';

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
