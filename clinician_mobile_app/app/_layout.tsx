/**
 * Root layout — the first file Expo Router loads. The folder must be named `app`
 * (Expo Router turns every file in it into a screen).
 *
 * FLOW: load fonts -> <AuthProvider> (auth_session/AuthContext.tsx) supplies the
 * sign-in state -> <AuthGate /> reads it and sends the user to the right group:
 *   (auth)/  sign-in, sign-up, verify-email, forgot-password   (signed out)
 *   (app)/   home, history, profile, scan/new, scan/[id]       (signed in as user)
 */
import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from '@/design_theme/theme';
import { AuthProvider, useAuth } from '@/auth_session/AuthContext';

export { ErrorBoundary } from 'expo-router';

// Keep the splash screen up until AuthGate knows whether the user is signed in.
SplashScreen.preventAutoHideAsync();

// Navigation colours, taken from design_theme/theme.ts.
const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: COLORS.background, card: COLORS.surfaceLow, text: COLORS.textPrimary, border: COLORS.surfaceBorder, primary: COLORS.primaryBright },
};

/**
 * Signed out → (auth). Signed in as role 'user' → (app). Admin accounts are
 * signed out by AuthContext. Password-reset links go to /reset-password.
 * Input: session / role from useAuth(). Result: a redirect; it draws nothing itself.
 */
function AuthGate() {
  const { session, role, initializing, recovering } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;
    SplashScreen.hideAsync();
    const top = segments[0];
    if (recovering) {
      if (top !== 'reset-password') router.replace('/reset-password');
      return;
    }
    if (top === 'reset-password' || top === 'auth') {
      // Landing routes for email links: leave once the link is handled.
      if (session && role) router.replace('/');
      return;
    }
    // Signed in but the role is still being checked: stay where we are.
    if (session && !role) return;
    if (!session && top !== '(auth)') router.replace('/sign-in');
    else if (session && top === '(auth)') router.replace('/');
  }, [session, role, initializing, recovering, segments, router]);

  return null;
}

/** Wraps every screen in the auth provider and theme, and declares the top-level routes. */
export default function RootLayout() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  if (!loaded) return null;

  return (
    <AuthProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <AuthGate />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="auth/callback" />
        </Stack>
      </ThemeProvider>
    </AuthProvider>
  );
}
