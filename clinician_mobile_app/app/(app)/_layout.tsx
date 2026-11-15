/**
 * Layout of the signed-in part of the app: the three tabs plus the two scan
 * screens (scan/new = scan form, scan/[id] = result of one scan).
 */
import { Stack } from 'expo-router';
import { COLORS } from '@/design_theme/theme';
import { useAuth } from '@/auth_session/AuthContext';

export default function AppLayout() {
  const { session, role } = useAuth();
  // Only role 'user' sees the app; AuthGate redirects everyone else.
  if (!session || role !== 'user') return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="scan/new" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="scan/[id]" />
    </Stack>
  );
}
