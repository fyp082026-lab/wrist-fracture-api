import { Stack } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';

export default function AppLayout() {
  const { session } = useAuth();
  // Nothing signed-in renders without a session; AuthGate redirects to sign-in.
  if (!session) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="scan/new" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="scan/[id]" />
    </Stack>
  );
}
