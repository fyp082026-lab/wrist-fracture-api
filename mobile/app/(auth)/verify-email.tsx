import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AuthShell } from '@/components/AuthShell';
import { Banner, Button, styles as ui } from '@/components/ui';
import { COLORS } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';

const COOLDOWN_S = 60;

export default function VerifyEmail() {
  const router = useRouter();
  const { resendVerification } = useAuth();
  const { email = '', fromSignIn } = useLocalSearchParams<{ email?: string; fromSignIn?: string }>();
  // Coming from sign-in, nothing was just sent, so resending is allowed at once.
  const [cooldown, setCooldown] = useState(fromSignIn ? 0 : COOLDOWN_S);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(
    fromSignIn ? { kind: 'info', text: 'Your email is not verified yet. Open the link we sent, or send a new one.' } : null
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    if (!email || cooldown > 0) return;
    setBusy(true);
    const res = await resendVerification(email);
    setBusy(false);
    if (res.ok) {
      setBanner({ kind: 'success', text: 'A new verification email is on its way.' });
      setCooldown(COOLDOWN_S);
    } else {
      setBanner({ kind: 'error', text: res.error });
    }
  };

  return (
    <AuthShell title="Check your inbox" subtitle="One step left to activate your account">
      {banner ? <Banner kind={banner.kind} message={banner.text} onDismiss={() => setBanner(null)} /> : null}
      <View style={{ alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <Ionicons name="mail-open-outline" size={40} color={COLORS.primaryBright} />
        <Text style={ui.subtitle}>We sent a verification link to</Text>
        <Text style={ui.h2} numberOfLines={1}>{email || 'your email address'}</Text>
        <Text style={[ui.body, { textAlign: 'center', marginTop: 8 }]}>
          Open the link on this phone to sign in automatically. If you open it on a computer, your email is still
          verified: come back here and sign in.
        </Text>
      </View>
      <Button
        title={cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend verification email'}
        variant="secondary"
        onPress={resend}
        loading={busy}
        disabled={cooldown > 0 || !email}
        style={{ marginBottom: 12 }}
      />
      <Button title="I've verified, sign in" onPress={() => router.replace('/sign-in')} />
    </AuthShell>
  );
}
