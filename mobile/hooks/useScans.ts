import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { listScans, type ScanListItem } from '@/services/records';

/** The clinician's scans, reloaded every time the screen gains focus. */
export function useScans(limit = 100) {
  const [items, setItems] = useState<ScanListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
