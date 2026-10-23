import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, SPACING } from '@/constants/theme';
import { Button, Card, Chip, Header, Row, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { initialsFromName } from '@/services/format';

function joined(iso?: string | null) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Home() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const user = session?.user;
  const name = profile?.full_name || user?.user_metadata?.full_name || '';

  return (
    <Screen>
      <Header title="Welcome" subtitle={name || user?.email} />

      <Card style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsFromName(name || user?.email || '')}</Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>{name || 'Add your name'}</Text>
        <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
        <Chip label="User" icon="person" tone="info" />
      </Card>

      <Card style={{ marginBottom: SPACING.lg }}>
        <Row label="Name" value={name || 'Not set'} />
        <Row label="Email" value={user?.email ?? ''} />
        <Row label="Organisation" value={profile?.organisation || 'Not set'} />
        <Row label="Role" value="User" />
        <Row label="Joined" value={joined(user?.created_at)} />
      </Card>

      <Button title="Edit details" variant="secondary" icon="create-outline" onPress={() => router.push('/profile')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.lg, paddingVertical: SPACING.xl },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.primaryMutedBg,
    borderWidth: 1, borderColor: COLORS.primaryMutedBorder, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: FONTS.bold, fontSize: 24, color: COLORS.primaryBright },
  name: { fontFamily: FONTS.bold, fontSize: 20, color: COLORS.textPrimary, marginTop: SPACING.xs },
  email: { fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textSecondary, marginBottom: SPACING.xs },
});
