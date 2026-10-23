import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';
import { Button, Card, Chip, Header, Row, Screen, styles as ui } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { verifyWithServer } from '@/services/account';
import { checkServer, type ServerState } from '@/services/serverStatus';
import { formatFullScanDate } from '@/services/format';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

type Check = 'checking' | 'ok' | 'fail';

export default function Home() {
  const router = useRouter();
  const { profile, session, role } = useAuth();
  const [server, setServer] = useState<ServerState | 'checking'>('checking');
  const [tokenCheck, setTokenCheck] = useState<Check>('checking');
  const [refreshing, setRefreshing] = useState(false);

  const runChecks = useCallback(async () => {
    setServer('checking');
    setTokenCheck('checking');
    const [health, verified] = await Promise.all([checkServer(), verifyWithServer()]);
    setServer(health.state);
    setTokenCheck(verified === 'verified' ? 'ok' : 'fail');
  }, []);

  useFocusEffect(
    useCallback(() => {
      runChecks();
    }, [runChecks])
  );

  const refresh = async () => {
    setRefreshing(true);
    await runChecks();
    setRefreshing(false);
  };

  const user = session?.user;
  const name = profile?.full_name || user?.user_metadata?.full_name || 'User';
  const date = (iso?: string | null) => (iso ? formatFullScanDate(Date.parse(iso)) : 'Never');

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Header title={`${greeting()},`} subtitle={name} />

      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIcon}>
            <Ionicons name="shield-checkmark" size={26} color={COLORS.primaryBright} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ui.h2}>You are signed in</Text>
            <Text style={ui.subtitle}>Your session is stored securely on this device.</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap' }}>
          <Chip label={role === 'user' ? 'Role: User' : 'Role: checking'} icon="person" tone="info" />
          {user?.email_confirmed_at ? (
            <Chip label="Email verified" icon="checkmark-circle" tone="intact" />
          ) : (
            <Chip label="Email not verified" icon="alert-circle" tone="lowConfidence" />
          )}
        </View>
      </Card>

      <Text style={[ui.h2, styles.section]}>Account</Text>
      <Card style={{ marginBottom: SPACING.lg }}>
        <Row label="Name" value={profile?.full_name || 'Not set'} />
        <Row label="Email" value={user?.email ?? ''} />
        <Row label="Organisation" value={profile?.organisation || 'Not set'} />
        <Row label="Member since" value={date(user?.created_at)} />
        <Row label="Last sign-in" value={date(user?.last_sign_in_at)} />
      </Card>

      <Text style={[ui.h2, styles.section]}>Connection</Text>
      <Card style={{ marginBottom: SPACING.lg }}>
        <StatusLine label="Supabase sign-in" state={session ? 'ok' : 'fail'} okText="Active session" failText="No session" />
        <StatusLine
          label="API server"
          state={server === 'checking' ? 'checking' : server === 'online' ? 'ok' : 'fail'}
          okText="Online"
          failText={server === 'degraded' ? 'Server issue' : 'Offline'}
        />
        <StatusLine
          label="Server verified your sign-in"
          state={tokenCheck}
          okText="Verified"
          failText="Not verified"
        />
      </Card>

      <Button title="Edit profile" variant="secondary" icon="create-outline" onPress={() => router.push('/profile')} />
    </Screen>
  );
}

function StatusLine({ label, state, okText, failText }: { label: string; state: Check; okText: string; failText: string }) {
  const color = state === 'ok' ? COLORS.status.intact.text : state === 'fail' ? COLORS.status.fracture.text : COLORS.textSecondary;
  const icon = state === 'ok' ? 'checkmark-circle' : state === 'fail' ? 'close-circle' : 'ellipsis-horizontal-circle';
  return (
    <Row
      label={label}
      value={
        <View style={styles.status}>
          <Ionicons name={icon} size={16} color={color} />
          <Text style={[styles.statusText, { color }]}>{state === 'checking' ? 'Checking…' : state === 'ok' ? okText : failText}</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  hero: { marginBottom: SPACING.lg, borderColor: COLORS.primaryMutedBorder, gap: SPACING.md },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  heroIcon: {
    width: 48, height: 48, borderRadius: RADIUS.lg, backgroundColor: COLORS.primaryMutedBg,
    alignItems: 'center', justifyContent: 'center',
  },
  section: { marginBottom: SPACING.sm },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontFamily: FONTS.semibold, fontSize: 14 },
});
