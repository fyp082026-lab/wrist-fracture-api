import { useState } from 'react';
import { useRouter } from 'expo-router';
import { AuthShell } from '@/components/AuthShell';
import { Banner, Button, Loading, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

/** Opened from the password-reset email; AuthContext turns the link into a session. */
export default function ResetPassword() {
  const router = useRouter();
  const { session, updatePassword, linkMessage, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return (
      <AuthShell title="Reset your password" subtitle="Verifying your reset link">
        {linkMessage ? (
          <>
            <Banner kind="error" message={linkMessage} />
            <Button title="Request a new link" onPress={() => router.replace('/forgot-password')} />
          </>
        ) : (
          <Loading label="Checking link…" />
        )}
      </AuthShell>
    );
  }

  const submit = async () => {
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await updatePassword(password);
    setBusy(false);
    if (res.ok) router.replace('/home');
    else setError(res.error);
  };

  return (
    <AuthShell title="Choose a new password" subtitle={session.user.email ?? ''}>
      {error ? <Banner kind="error" message={error} onDismiss={() => setError(null)} /> : null}
      <TextField label="New password" icon="lock-closed-outline" password autoComplete="new-password" textContentType="newPassword" value={password} onChangeText={setPassword} hint="At least 8 characters." />
      <TextField label="Confirm new password" icon="lock-closed-outline" password autoComplete="new-password" value={confirm} onChangeText={setConfirm} onSubmitEditing={submit} />
      <Button title="Save password" onPress={submit} loading={busy} style={{ marginBottom: 12 }} />
      <Button title="Cancel" variant="ghost" onPress={() => signOut()} />
    </AuthShell>
  );
}
