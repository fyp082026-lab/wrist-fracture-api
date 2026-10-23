import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { AuthShell } from '@/components/AuthShell';
import { Banner, Button, TextField, styles as ui } from '@/components/ui';
import { COLORS } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { evaluatePasswordStrength } from '@/services/authErrors';

export default function SignUp() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = evaluatePasswordStrength(password);
  const meterColor = strength.score >= 4 ? COLORS.status.intact.primary : strength.score === 3 ? COLORS.primaryBright : strength.score === 2 ? COLORS.status.lowConfidence.primary : COLORS.status.fracture.primary;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await signUp({ email, password, fullName, organisation });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.needsVerification) {
      router.replace({ pathname: '/verify-email', params: { email: email.trim().toLowerCase() } });
    }
    // Otherwise a session exists and AuthGate opens the app.
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Create a user account for the PediaFracture app"
      footer={
        <>
          <Text style={ui.subtitle}>Already registered?</Text>
          <Link href="/sign-in" asChild>
            <Pressable hitSlop={8} accessibilityRole="link"><Text style={ui.link}>Sign in</Text></Pressable>
          </Link>
        </>
      }>
      {error ? <Banner kind="error" message={error} onDismiss={() => setError(null)} /> : null}
      <TextField label="Full name" icon="person-outline" placeholder="Dr. Jane Smith" autoComplete="name" textContentType="name" value={fullName} onChangeText={setFullName} />
      <TextField label="Organisation (optional)" icon="business-outline" placeholder="e.g. City Hospital" value={organisation} onChangeText={setOrganisation} />
      <TextField label="Email" icon="mail-outline" placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" value={email} onChangeText={setEmail} />
      <TextField
        label="Password"
        icon="lock-closed-outline"
        placeholder="At least 8 characters"
        password
        autoComplete="new-password"
        textContentType="newPassword"
        value={password}
        onChangeText={setPassword}
        hint={password ? `Strength: ${strength.label}` : 'Use 8+ characters with upper and lower case and a number.'}
      />
      {password ? (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: COLORS.surfaceHigh, marginTop: -8, marginBottom: 16, overflow: 'hidden' }}>
          <View style={{ width: `${(strength.score / 4) * 100}%`, height: '100%', backgroundColor: meterColor }} />
        </View>
      ) : null}
      <Button title="Create account" onPress={submit} loading={busy} />
    </AuthShell>
  );
}
