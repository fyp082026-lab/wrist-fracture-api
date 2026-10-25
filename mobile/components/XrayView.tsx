import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from '@/constants/theme';
import type { Detection } from '@/services/contract';

/** X-ray with the server's normalized boxes drawn on top (aspect ratio preserved). */
export function XrayView({ uri, detections = [] }: { uri: string | null; detections?: Detection[] }) {
  const [ratio, setRatio] = useState(3 / 4);
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return (
      <View style={[styles.frame, styles.placeholder]}>
        <Ionicons name="image-outline" size={32} color={COLORS.textMuted} />
        <Text style={styles.placeholderText}>Image not available</Text>
      </View>
    );
  }

  return (
    <View style={[styles.frame, { aspectRatio: ratio }]} accessibilityLabel={`Wrist X-ray with ${detections.length} highlighted region(s)`}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="fill"
        onLoad={(e) => e.source.width && e.source.height && setRatio(e.source.width / e.source.height)}
        onError={() => setFailed(true)}
      />
      {detections.map((d, i) => {
        const [x1, y1, x2, y2] = d.box_normalized;
        return (
          <View
            key={i}
            style={[styles.box, { left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }]}>
            <Text style={styles.boxLabel}>{Math.round(d.confidence * 100)}%</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: RADIUS.xl, overflow: 'hidden', backgroundColor: '#000' },
  placeholder: { aspectRatio: 4 / 3, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.surfaceLowest },
  placeholderText: { fontFamily: FONTS.medium, color: COLORS.textMuted, fontSize: 13 },
  box: { position: 'absolute', borderWidth: 2, borderColor: COLORS.status.fracture.primary, borderRadius: 4 },
  boxLabel: {
    position: 'absolute', top: -20, left: -2, backgroundColor: COLORS.status.fracture.primary, color: '#fff',
    fontFamily: FONTS.semibold, fontSize: 11, paddingHorizontal: 5, borderRadius: 4, overflow: 'hidden',
  },
});
