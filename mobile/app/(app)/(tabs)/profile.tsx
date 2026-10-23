import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONTS, SPACING } from '@/constants/theme';
import { Banner, Button, Card, Header, Screen, TextField, styles as ui } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { initialsFromName } from '@/services/format';

/** Keyed on the stored values so the form re-initialises when the profile loads. */
export default function Profile() {
  const { profile } = useAuth();
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  return <ProfileView key={`${profile?.full_name ?? ''}|${profile?.organisation ?? ''}`} banner={banner} setBanner={setBanner} />;
}

function ProfileView({ banner, setBanner }: { banner: { kind: 'success' | 'error'; text: string } | null; setBanner: (b: { kind: 'success' | 'error'; text: string } | null) => void }) {
  const { session, profile, updateProfile, sendPasswordReset, signOut } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [organisation, setOrganisation] = useState(profile?.organisation ?? '');
  const [saving, setSaving] = useState(false);


  const email = session?.user.email ?? '';
  const dirty = fullName !== (profile?.full_name ?? '') || organisation !== (profile?.organisation ?? '');

  const save = async () => {
    setSaving(true);
    const res = await updateProfile({ full_name: fullName, organisation });
    setSaving(false);
    setBanner(res.ok ? { kind: 'success', text: 'Profile saved.' } : { kind: 'error', text: res.error });
  };

  const resetPassword = async () => {
    const res = await sendPasswordReset(email);
    setBanner(res.ok ? { kind: 'success', text: `Password reset link sent to ${email}.` } : { kind: 'error', text: res.error });
  };

  const confirmSignOut = () => {
    if (Platform.OS === 'web') {
      signOut();
      return;
    }
    Alert.alert('Sign out?', 'You will need your password to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <Screen>
      <Header title="Profile" />
      <View style={styles.identity}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initialsFromName(fullName || email)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={ui.h2} numberOfLines={1}>{fullName || 'Add your name'}</Text>
          <Text style={ui.subtitle} numberOfLines={1}>{email}</Text>
        </View>
      </View>

      {banner ? <Banner kind={banner.kind} message={banner.text} onDismiss={() => setBanner(null)} /> : null}

      <Card style={{ marginBottom: SPACING.base }}>
        <Text style={[ui.h2, { marginBottom: SPACING.md }]}>Your details</Text>
        <TextField label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" />
        <TextField label="Organisation (optional)" value={organisation} onChangeText={setOrganisation} />
        <Button title="Save changes" onPress={save} loading={saving} disabled={!dirty} />
      </Card>

      <Card style={{ marginBottom: SPACING.lg }}>
        <Text style={[ui.h2, { marginBottom: SPACING.sm }]}>Password</Text>
        <Button title="Email me a password reset link" variant="secondary" icon="key-outline" onPress={resetPassword} />
      </Card>

      <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={confirmSignOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.lg },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primaryMutedBg, borderWidth: 1, borderColor: COLORS.primaryMutedBorder, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONTS.bold, fontSize: 18, color: COLORS.primaryBright },
});
