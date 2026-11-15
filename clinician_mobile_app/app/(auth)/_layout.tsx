/** Layout of the signed-out screens (sign-in, sign-up, verify-email, forgot-password): no header, fade between them. */
import { Stack } from 'expo-router';
import { COLORS } from '@/design_theme/theme';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: COLORS.background } }} />;
}
