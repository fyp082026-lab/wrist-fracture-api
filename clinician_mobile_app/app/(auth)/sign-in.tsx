/**
 * Sign-in screen.
 *
 * FLOW: email + password -> useAuth().signIn() (AuthContext -> Supabase) ->
 *   ok          -> a session exists; AuthGate (app/_layout.tsx) opens /home
 *   unverified  -> /verify-email
 *   error       -> message shown in the banner on this screen
 */
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { AuthShell } from '@/ui_components/AuthShell';
import { Banner, Button, TextField, styles as ui } from '@/ui_components/ui';
import { useAuth } from '@/auth_session/AuthContext';

export default function SignIn() {
  const router = useRouter();
  const { signIn, linkMessage, clearLinkMessage } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  // Send the form to AuthContext and act on its answer.
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    clearLinkMessage();
    const res = await signIn(email, password);
    setBusy(false);
    if (res.ok) return; // AuthGate opens the app
    if ('unverified' in res) {
      router.push({ pathname: '/verify-email', params: { email: email.trim().toLowerCase(), fromSignIn: '1' } });
      return;
    }
    setError(res.error);
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Sign in to your PediaFracture account"
      footer={
        <>
          <Text style={ui.subtitle}>New user?</Text>
          <Link href="/sign-up" asChild>
            <Pressable hitSlop={8} accessibilityRole="link"><Text style={ui.link}>Create an account</Text></Pressable>
          </Link>
        </>
      }>
      {linkMessage ? <Banner kind="info" message={linkMessage} onDismiss={clearLinkMessage} /> : null}
      {error ? <Banner kind="error" message={error} onDismiss={() => setError(null)} /> : null}
      <TextField
        label="Email"
        icon="mail-outline"
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        value={email}
        onChangeText={setEmail}
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        label="Password"
        icon="lock-closed-outline"
        placeholder="Your password"
        password
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />
      <View style={{ alignItems: 'flex-end', marginBottom: 16, marginTop: -4 }}>
        <Link href={{ pathname: '/forgot-password', params: { email } }} asChild>
          <Pressable hitSlop={8} accessibilityRole="link"><Text style={ui.link}>Forgot password?</Text></Pressable>
        </Link>
      </View>
      <Button title="Sign in" onPress={submit} loading={busy} />
    </AuthShell>
  );
}
