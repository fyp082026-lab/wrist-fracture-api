import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, SPACING, TABULAR_NUMBERS } from '@/constants/theme';
import { FindingChip, StatusChip } from '@/components/ui';
import { formatAgeMonths } from '@/services/contract';
import { formatFullScanDate } from '@/services/format';
import type { ScanListItem } from '@/services/records';

export function ScanRow({ item }: { item: ScanListItem }) {
  const router = useRouter();
  const p = item.patient;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/scan/[id]', params: { id: item.id } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: COLORS.surface }]}
      accessibilityRole="button"
      accessibilityLabel={`Scan ${p?.patient_code ?? ''} from ${formatFullScanDate(Date.parse(item.created_at))}`}>
      <View style={styles.icon}>
        <Ionicons name="scan-outline" size={20} color={COLORS.primaryBright} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>{p?.patient_code || 'Patient'}</Text>
          <Text style={[styles.meta, TABULAR_NUMBERS]}>{formatFullScanDate(Date.parse(item.created_at))}</Text>
        </View>
        <Text style={[styles.meta, TABULAR_NUMBERS]}>
          {p ? `${formatAgeMonths(p.age_months)} · ${p.sex === 'F' ? 'Female' : 'Male'}` : 'Patient details unavailable'}
        </Text>
        {item.status === 'completed' && item.result ? (
          <FindingChip fracture={item.result.fracture_detected} confidence={item.result.confidence} />
        ) : (
          <StatusChip status={item.status} />
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md,
    backgroundColor: COLORS.surfaceLow, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.surfaceBorder, marginBottom: SPACING.sm,
  },
  icon: { width: 42, height: 42, borderRadius: RADIUS.lg, backgroundColor: COLORS.primaryMutedBg, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontFamily: FONTS.semibold, fontSize: 15, color: COLORS.textPrimary },
  meta: { fontFamily: FONTS.regular, fontSize: 12, color: COLORS.textSecondary },
});
