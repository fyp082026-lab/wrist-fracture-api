import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AuthShell } from '@/components/AuthShell';
import { Banner, Button, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

export default function ForgotPassword() {
  const router = useRouter();
  const { sendPasswordReset } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await sendPasswordReset(email);
    setBusy(false);
    if (res.ok) setSent(true);
    else setError(res.error);
  };

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a secure reset link">
      {sent ? (
        <Banner kind="success" message="If an account exists for that email, a reset link is on its way. Open it on this phone." />
      ) : null}
      {error ? <Banner kind="error" message={error} onDismiss={() => setError(null)} /> : null}
      <TextField
        label="Email"
        icon="mail-outline"
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
        onSubmitEditing={submit}
      />
      <Button title={sent ? 'Send again' : 'Send reset link'} onPress={submit} loading={busy} style={{ marginBottom: 12 }} />
      <Button title="Back to sign in" variant="ghost" onPress={() => router.replace('/sign-in')} />
    </AuthShell>
  );
}
