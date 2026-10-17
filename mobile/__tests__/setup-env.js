// services/config.ts validates the environment when it is first imported.
// Tests use fixed placeholder values, never the real .env.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.EXPO_PUBLIC_ANALYSIS_API_URL = 'https://api.example.com/analyze/';
