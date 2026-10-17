import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/context/AuthContext';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: COLORS.background, card: COLORS.surfaceLow, text: COLORS.textPrimary, border: COLORS.surfaceBorder, primary: COLORS.primaryBright },
};

/** Signed out → (auth). Signed in → (app). Password-reset links go to /reset-password. */
function AuthGate() {
  const { session, initializing, recovering } = useAuth();
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
      if (session) router.replace('/');
      return;
    }
    if (!session && top !== '(auth)') router.replace('/sign-in');
    else if (session && top === '(auth)') router.replace('/');
  }, [session, initializing, recovering, segments, router]);

  return null;
}

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
