import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';
import { Banner, EmptyState, Header, Loading, Screen, TextField } from '@/components/ui';
import { ScanRow } from '@/components/ScanRow';
import { useScans } from '@/hooks/useScans';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'fracture', label: 'Fracture suggested' },
  { key: 'clear', label: 'No fracture' },
  { key: 'pending', label: 'In progress' },
  { key: 'failed', label: 'Failed' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

export default function History() {
  const { items, error, refreshing, refresh } = useScans(200);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((s) => {
      if (q && !(s.patient?.patient_code ?? '').toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'fracture': return s.result?.fracture_detected === true;
        case 'clear': return s.result?.fracture_detected === false;
        case 'pending': return s.status === 'uploaded' || s.status === 'analyzing';
        case 'failed': return s.status === 'failed';
        default: return true;
      }
    });
  }, [items, filter, query]);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Header title="History" subtitle={items ? `${items.length} scan${items.length === 1 ? '' : 's'}` : undefined} />
      <TextField label="Search" icon="search-outline" placeholder="Patient code" value={query} onChangeText={setQuery} autoCapitalize="characters" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.filter, filter === f.key && styles.filterOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f.key }}>
            <Text style={[styles.filterText, filter === f.key && { color: COLORS.primaryBright }]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {error ? <Banner kind="error" message={error} /> : null}
      {!items && !error ? <Loading /> : null}
      {items && shown.length === 0 ? (
        <EmptyState icon="file-tray-outline" title="Nothing here" body={items.length ? 'No scans match this filter.' : 'Start a new scan from Home.'} />
      ) : null}
      {shown.map((s) => <ScanRow key={s.id} item={s} />)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: SPACING.sm, paddingBottom: SPACING.base },
  filter: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.surfaceBorderHigh, backgroundColor: COLORS.surfaceLow, minHeight: 36, justifyContent: 'center' },
  filterOn: { borderColor: COLORS.primaryBright, backgroundColor: COLORS.primaryMutedBg },
  filterText: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.textSecondary },
});
