import { Stack } from 'expo-router';
import { COLORS } from '@/constants/theme';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: COLORS.background } }} />;
}
