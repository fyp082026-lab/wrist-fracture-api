import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { listScans, type ScanListItem } from '@/app_logic/records';

/**
 * The clinician's scans, reloaded every time the screen gains focus.
 *
 * FLOW: app_logic/records.ts listScans() -> `items` -> the Home screen (recent
 * scans and counters) and the History screen (full list). `refresh` is wired to
 * pull-to-refresh; `error` is shown instead of the list when loading fails.
 */
export function useScans(limit = 100) {
  const [items, setItems] = useState<ScanListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch the list and keep either the items or the error message.
  const load = useCallback(async () => {
    try {
      setItems(await listScans(limit));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [limit]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { items, error, refreshing, refresh };
}
