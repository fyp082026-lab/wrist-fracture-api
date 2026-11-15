import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';
import { Banner, Button, Card, Header, Screen, TextField, styles as ui } from '@/components/ui';
import { checkPickedAsset } from '@/services/imageIntake';
import {
  AnalysisServiceError,
  MAX_PATIENT_AGE_MONTHS,
  newScanId,
  runAnalysisPipeline,
  validatePatient,
} from '@/services/analysis';
import {
  ANALYSIS_MODES,
  ANALYSIS_MODE_INFO,
  DEFAULT_ANALYSIS_MODE,
  runsBoneAge,
  type AnalysisMode,
  type PatientSex,
} from '@/services/contract';

type Stage = 'idle' | 'uploading' | 'analyzing';

const STAGE_TEXT: Record<Exclude<Stage, 'idle'>, string> = {
  uploading: 'Uploading X-ray securely…',
  analyzing: 'AI is analysing the X-ray. This can take up to a minute…',
};

const MODE_ICON: Record<AnalysisMode, keyof typeof Ionicons.glyphMap> = {
  fracture: 'scan-outline',
  bone_age: 'body-outline',
  both: 'layers-outline',
};

export default function NewScan() {
  const router = useRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [years, setYears] = useState('');
  const [months, setMonths] = useState('');
  const [sex, setSex] = useState<PatientSex | null>(null);
  const [mode, setMode] = useState<AnalysisMode>(DEFAULT_ANALYSIS_MODE);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // One id per attempt, reused by "Try again" so a retry never duplicates the scan.
  const scanId = useRef<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const busy = stage !== 'idle';
  const ageMonths = (parseInt(years || '0', 10) || 0) * 12 + (parseInt(months || '0', 10) || 0);

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    setPermissionDenied(false);
    try {
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setPermissionDenied(true);
        return;
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const problem = checkPickedAsset(asset);
      if (problem) {
        setError(problem);
        return;
      }
      setImageUri(asset.uri);
      scanId.current = null; // new image → new scan
      setAttempted(false);
    } catch (e) {
      setError(`Could not open the ${source === 'camera' ? 'camera' : 'photo library'}: ${(e as Error).message}`);
    }
  };

  const analyze = async () => {
    if (!imageUri) {
      setError('Choose or take a wrist X-ray first.');
      return;
    }
    if ((parseInt(months || '0', 10) || 0) > 11) {
      setError('Months must be between 0 and 11.');
      return;
    }
    const problem = validatePatient(ageMonths, sex);
    if (problem) {
      setError(ageMonths < 1 || ageMonths > MAX_PATIENT_AGE_MONTHS ? 'Enter the patient age (up to 20 years).' : 'Select the patient sex.');
      return;
    }
    setError(null);
    scanId.current ??= newScanId();
    setAttempted(true);
    abort.current = new AbortController();
    setStage('uploading');
    try {
      const result = await runAnalysisPipeline({
        scanId: scanId.current,
        imageUri,
        patient: { ageMonths, sex: sex!, code: code.trim() || undefined },
        mode,
        onProgress: (s) => setStage(s),
        signal: abort.current.signal,
      });
      router.replace({ pathname: '/scan/[id]', params: { id: result.scan_id } });
    } catch (e) {
      setStage('idle');
      if (e instanceof AnalysisServiceError) {
        if (e.type === 'cancelled') return;
        if (e.type === 'invalid_image' || e.type === 'image_missing') {
          scanId.current = null;
          setAttempted(false);
        }
        setError(e.friendlyMessage);
      } else {
        setError('Analysis failed, try again.');
      }
    }
  };

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <Header title="New scan" subtitle="Wrist X-ray · AI-assisted analysis" onBack={busy ? undefined : () => router.back()} />

      {error ? <Banner kind="error" message={error} onDismiss={() => setError(null)} /> : null}
      {permissionDenied ? (
        <Banner kind="warning" message="Permission was denied. Allow camera and photo access in Settings to continue." onDismiss={() => setPermissionDenied(false)} />
      ) : null}
      {permissionDenied ? <Button title="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} style={{ marginBottom: SPACING.base }} /> : null}

      <Card style={{ marginBottom: SPACING.base }}>
        <Text style={[ui.h2, { marginBottom: SPACING.md }]}>1 · X-ray image</Text>
        {imageUri ? (
          <View>
            <Image source={{ uri: imageUri }} style={styles.preview} contentFit="contain" accessibilityLabel="Selected X-ray" />
            {!busy ? (
              <View style={styles.pickRow}>
                <Button title="Retake" variant="secondary" icon="camera-outline" onPress={() => pick('camera')} style={{ flex: 1 }} />
                <Button title="Choose other" variant="secondary" icon="images-outline" onPress={() => pick('library')} style={{ flex: 1 }} />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.pickRow}>
            <PickTile icon="camera-outline" label="Take photo" onPress={() => pick('camera')} />
            <PickTile icon="images-outline" label="Choose from gallery" onPress={() => pick('library')} />
          </View>
        )}
        <Text style={[ui.hint, { marginTop: SPACING.sm }]}>Use only anonymised images. JPEG or PNG, up to 20 MB.</Text>
      </Card>

      <Card style={{ marginBottom: SPACING.lg }}>
        <Text style={[ui.h2, { marginBottom: SPACING.md }]}>2 · Patient</Text>
        <TextField label="Patient code (optional, no names)" placeholder="e.g. P-0042" value={code} onChangeText={setCode} autoCapitalize="characters" editable={!busy} />
        <View style={styles.pickRow}>
          <View style={{ flex: 1 }}>
            <TextField label="Age: years" placeholder="0" keyboardType="number-pad" maxLength={2} value={years} onChangeText={(t) => setYears(t.replace(/\D/g, ''))} editable={!busy} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label="Months" placeholder="0" keyboardType="number-pad" maxLength={2} value={months} onChangeText={(t) => setMonths(t.replace(/\D/g, ''))} editable={!busy} />
          </View>
        </View>
        <Text style={ui.label}>Biological sex</Text>
        <View style={styles.pickRow}>
          {(['M', 'F'] as PatientSex[]).map((s) => (
            <Pressable
              key={s}
              disabled={busy}
              onPress={() => setSex(s)}
              style={[styles.segment, sex === s && styles.segmentOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: sex === s }}>
              <Ionicons name={sex === s ? 'radio-button-on' : 'radio-button-off'} size={18} color={sex === s ? COLORS.primaryBright : COLORS.textMuted} />
              <Text style={[styles.segmentText, sex === s && { color: COLORS.textPrimary }]}>{s === 'M' ? 'Male' : 'Female'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[ui.hint, { marginTop: SPACING.sm }]}>
          {runsBoneAge(mode) ? 'Age and sex are used by the bone age model.' : 'Age and sex are saved with the scan.'}
        </Text>
      </Card>

      <Card style={{ marginBottom: SPACING.lg }}>
        <Text style={[ui.h2, { marginBottom: SPACING.md }]}>3 · AI analysis</Text>
        <View style={{ gap: SPACING.sm }} accessibilityRole="radiogroup">
          {ANALYSIS_MODES.map((m) => (
            <Pressable
              key={m}
              disabled={busy}
              onPress={() => {
                setMode(m);
                // A different choice is a different scan, not a retry of the last one.
                if (m !== mode) {
                  scanId.current = null;
                  setAttempted(false);
                }
              }}
              style={[styles.mode, mode === m && styles.segmentOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === m, disabled: busy }}
              accessibilityLabel={`${ANALYSIS_MODE_INFO[m].title}, ${ANALYSIS_MODE_INFO[m].model}`}>
              <Ionicons name={MODE_ICON[m]} size={22} color={mode === m ? COLORS.primaryBright : COLORS.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeTitle, mode === m && { color: COLORS.textPrimary }]}>{ANALYSIS_MODE_INFO[m].title}</Text>
                <Text style={styles.modeText}>{ANALYSIS_MODE_INFO[m].model} · {ANALYSIS_MODE_INFO[m].description}</Text>
              </View>
              <Ionicons name={mode === m ? 'radio-button-on' : 'radio-button-off'} size={18} color={mode === m ? COLORS.primaryBright : COLORS.textMuted} />
            </Pressable>
          ))}
          <View style={[styles.mode, styles.modeSoon]} accessibilityLabel="Fusion AI, coming soon" accessible>
            <Ionicons name="git-merge-outline" size={22} color={COLORS.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.modeTitle}>Fusion AI · coming soon</Text>
              <Text style={styles.modeText}>Bone-age-aware fracture type (growth plate or shaft).</Text>
            </View>
          </View>
        </View>
      </Card>

      {busy ? (
        <Card style={styles.progress}>
          <Text style={[ui.h2, { textAlign: 'center' }]}>{stage === 'uploading' ? 'Uploading' : 'Analysing'}</Text>
          <Text style={[ui.body, { textAlign: 'center' }]}>{STAGE_TEXT[stage as Exclude<Stage, 'idle'>]}</Text>
          <View style={styles.steps}>
            <Step done={stage === 'analyzing'} active={stage === 'uploading'} label="Upload" />
            <View style={styles.stepLine} />
            <Step done={false} active={stage === 'analyzing'} label="AI analysis" />
          </View>
          <Button title="Cancel" variant="ghost" onPress={() => abort.current?.abort()} />
        </Card>
      ) : (
        <Button title={attempted ? 'Try again' : 'Analyse X-ray'} icon="sparkles-outline" onPress={analyze} />
      )}
      <Text style={[ui.disclaimer, { marginTop: SPACING.lg }]}>AI-assisted finding. Decision support only, not a diagnosis.</Text>
    </Screen>
  );
}

function PickTile({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { backgroundColor: COLORS.surface }]} accessibilityRole="button">
      <Ionicons name={icon} size={28} color={COLORS.primaryBright} />
      <Text style={styles.tileText}>{label}</Text>
    </Pressable>
  );
}

function Step({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Ionicons
        name={done ? 'checkmark-circle' : active ? 'ellipse' : 'ellipse-outline'}
        size={22}
        color={done || active ? COLORS.primaryBright : COLORS.textMuted}
      />
      <Text style={[styles.segmentText, (done || active) && { color: COLORS.textPrimary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pickRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  tile: {
    flex: 1, minHeight: 120, borderRadius: RADIUS.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.primaryMutedBorder,
    backgroundColor: COLORS.surfaceLowest, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, padding: SPACING.md,
  },
  tileText: { fontFamily: FONTS.semibold, fontSize: 13, color: COLORS.textPrimary, textAlign: 'center' },
  preview: { width: '100%', height: 260, borderRadius: RADIUS.lg, backgroundColor: '#000' },
  segment: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48,
    borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.surfaceBorderHigh, backgroundColor: COLORS.surfaceLowest,
  },
  segmentOn: { borderColor: COLORS.primaryBright, backgroundColor: COLORS.primaryMutedBg },
  segmentText: { fontFamily: FONTS.medium, fontSize: 14, color: COLORS.textSecondary },
  mode: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minHeight: 56, padding: SPACING.md,
    borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.surfaceBorderHigh, backgroundColor: COLORS.surfaceLowest,
  },
  modeSoon: { borderStyle: 'dashed', opacity: 0.6 },
  modeTitle: { fontFamily: FONTS.semibold, fontSize: 14, color: COLORS.textSecondary },
  modeText: { fontFamily: FONTS.regular, fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  progress: { gap: SPACING.md, borderColor: COLORS.primaryMutedBorder },
  steps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md, marginVertical: SPACING.sm },
  stepLine: { width: 60, height: 2, backgroundColor: COLORS.surfaceBorderHigh, marginBottom: 18 },
});
