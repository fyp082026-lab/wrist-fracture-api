import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING, TABULAR_NUMBERS } from '@/constants/theme';
import { Banner, Button, Card, EmptyState, Header, Loading, Screen, styles as ui } from '@/components/ui';
import { ScanRow } from '@/components/ScanRow';
import { useAuth } from '@/context/AuthContext';
import { useScans } from '@/hooks/useScans';
import { summarize } from '@/services/records';
import { checkServer, type ServerState } from '@/services/serverStatus';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const { items, error, refreshing, refresh } = useScans(50);
  const [server, setServer] = useState<ServerState | 'checking'>('checking');

  useEffect(() => {
    checkServer().then((h) => setServer(h.state));
  }, [refreshing]);
  const bad = server === 'offline' || server === 'degraded';

  const name = profile?.full_name || session?.user.user_metadata?.full_name || 'Clinician';
  const stats = items ? summarize(items) : null;

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Header
        title={`${greeting()},`}
        subtitle={name}
        right={
          <View style={[styles.server, bad && { borderColor: COLORS.status.fracture.border }]} accessibilityLabel={`Analysis server ${server}`}>
            <Ionicons
              name={server === 'online' ? 'cloud-done-outline' : bad ? 'cloud-offline-outline' : 'cloud-outline'}
              size={14}
              color={bad ? COLORS.status.fracture.text : COLORS.primaryBright}
            />
            <Text style={[styles.serverText, bad && { color: COLORS.status.fracture.text }]}>
              {server === 'online' ? 'Server online' : server === 'offline' ? 'Server offline' : server === 'degraded' ? 'Server issue' : 'Checking'}
            </Text>
          </View>
        }
      />

      <Card style={styles.hero}>
        <Text style={ui.h2}>New X-ray analysis</Text>
        <Text style={[ui.body, { marginBottom: SPACING.base }]}>
          Upload a pediatric wrist X-ray for AI-assisted fracture detection and bone age estimation.
        </Text>
        <Button title="Start new scan" icon="add-circle-outline" onPress={() => router.push('/scan/new')} />
      </Card>

      {error ? <Banner kind="error" message={error} /> : null}

      {stats ? (
        <View style={styles.stats}>
          <Stat label="Scans" value={stats.total} icon="layers-outline" />
          <Stat label="Fractures suggested" value={stats.fractures} icon="alert-circle-outline" />
          <Stat label="In progress" value={stats.pending} icon="sync-outline" />
        </View>
      ) : null}

      <View style={styles.sectionHead}>
        <Text style={ui.h2}>Recent scans</Text>
        {items && items.length > 0 ? (
          <Text style={ui.link} onPress={() => router.push('/history')} accessibilityRole="link">See all</Text>
        ) : null}
      </View>

      {!items && !error ? <Loading /> : null}
      {items && items.length === 0 ? (
        <EmptyState icon="scan-outline" title="No scans yet" body="Your analysed X-rays will appear here." />
      ) : null}
      {items?.slice(0, 5).map((s) => <ScanRow key={s.id} item={s} />)}
    </Screen>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={18} color={COLORS.primaryBright} />
      <Text style={[styles.statValue, TABULAR_NUMBERS]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  server: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primaryMutedBorder, backgroundColor: COLORS.surfaceLow,
  },
  serverText: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.primaryBright },
  hero: { marginBottom: SPACING.base, borderColor: COLORS.primaryMutedBorder },
  stats: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  stat: { flex: 1, backgroundColor: COLORS.surfaceLow, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.surfaceBorder, padding: SPACING.md, gap: 4 },
  statValue: { fontFamily: FONTS.bold, fontSize: 22, color: COLORS.textPrimary },
  statLabel: { fontFamily: FONTS.medium, fontSize: 11, color: COLORS.textSecondary },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
});
