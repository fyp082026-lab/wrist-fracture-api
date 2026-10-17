import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SPACING } from '@/constants/theme';
import { Banner, Button, Card, FindingChip, Header, Loading, Row, Screen, StatusChip, styles as ui } from '@/components/ui';
import { XrayView } from '@/components/XrayView';
import { DEFAULT_CLINICAL_DISCLAIMER, formatAgeMonths } from '@/services/contract';
import { formatFullScanDate } from '@/services/format';
import { getScanRecord, type ScanRecord } from '@/services/records';

const POLL_MS = 5000;

export default function ScanResult() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [record, setRecord] = useState<ScanRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRecord(await getScanRecord(String(id)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  // Reload on focus, and keep polling while the server is still working on it.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  const pending = record?.status === 'uploaded' || record?.status === 'analyzing';
  useFocusEffect(
    useCallback(() => {
      if (!pending) return;
      const t = setInterval(load, POLL_MS);
      return () => clearInterval(t);
    }, [pending, load])
  );

  const back = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  if (!record) {
    return (
      <Screen>
        <Header title="Scan result" onBack={back} />
        {error ? <Banner kind="error" message={error} /> : <Loading label="Loading result…" />}
        {error ? <Button title="Try again" onPress={load} /> : null}
      </Screen>
    );
  }

  const r = record.result;
  const p = record.patient;
  const boneAge = r?.bone_age_months;
  const ageDiff = boneAge != null && p ? Math.round(boneAge - p.age_months) : null;

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <Header title="Scan result" subtitle={formatFullScanDate(Date.parse(record.created_at))} onBack={back} />
      {error ? <Banner kind="warning" message={`Could not refresh: ${error}`} /> : null}

      <XrayView uri={record.imageUrl} detections={r?.detections ?? []} />

      <Card style={{ marginTop: SPACING.base, marginBottom: SPACING.base, gap: SPACING.sm }}>
        <Text style={ui.label}>AI-ASSISTED FINDING</Text>
        {record.status === 'completed' && r ? (
          <>
            <FindingChip fracture={r.fracture_detected} confidence={r.confidence} />
            <Text style={ui.body}>
              {r.fracture_detected
                ? `The model suggests ${r.detections.length} possible fracture region${r.detections.length === 1 ? '' : 's'}, highlighted on the image.`
                : 'The model did not suggest a fracture on this image.'}
            </Text>
          </>
        ) : record.status === 'failed' ? (
          <>
            <StatusChip status="failed" />
            <Text style={ui.body}>The analysis did not complete. Start a new scan with this X-ray to try again.</Text>
          </>
        ) : (
          <>
            <StatusChip status={record.status} />
            <Text style={ui.body}>The server is still working on this scan. This page updates automatically.</Text>
          </>
        )}
      </Card>

      {r ? (
        <Card style={{ marginBottom: SPACING.base }}>
          <Row label="Top confidence" value={r.confidence != null ? `${Math.round(r.confidence * 100)}%` : 'Not available'} />
          <Row label="Estimated bone age" value={boneAge != null ? formatAgeMonths(boneAge) : 'Not available'} />
          {ageDiff != null ? (
            <Row label="Bone age vs. actual age" value={ageDiff === 0 ? 'Same' : `${ageDiff > 0 ? '+' : '−'}${formatAgeMonths(Math.abs(ageDiff))}`} />
          ) : null}
        </Card>
      ) : null}

      <Card style={{ marginBottom: SPACING.lg }}>
        <Row label="Patient code" value={p?.patient_code || 'None'} />
        <Row label="Age" value={p ? formatAgeMonths(p.age_months) : 'Unknown'} />
        <Row label="Sex" value={p ? (p.sex === 'F' ? 'Female' : 'Male') : 'Unknown'} />
      </Card>

      <View style={{ gap: SPACING.sm }}>
        <Button title="New scan" icon="add-circle-outline" onPress={() => router.replace('/scan/new')} />
        <Button title="Back to home" variant="secondary" onPress={() => router.replace('/home')} />
      </View>
      <Text style={[ui.disclaimer, { marginTop: SPACING.lg }]}>{r?.clinical_disclaimer || DEFAULT_CLINICAL_DISCLAIMER}</Text>
    </Screen>
  );
}
