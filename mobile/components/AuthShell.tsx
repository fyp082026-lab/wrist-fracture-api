import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, LAYOUT, SPACING } from '@/constants/theme';
import { Screen, styles as ui } from '@/components/ui';

/** Shared frame for the signed-out screens: brand, title, form card, footer. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} contentStyle={styles.content}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Ionicons name="medical" size={28} color={COLORS.primaryBright} />
        </View>
        <Text style={styles.brandName}>
          PediaFracture <Text style={{ color: COLORS.primaryBright }}>AI</Text>
        </Text>
      </View>
      <Text style={[ui.h1, { textAlign: 'center' }]} accessibilityRole="header">{title}</Text>
      <Text style={[ui.subtitle, { textAlign: 'center', marginBottom: SPACING.xl }]}>{subtitle}</Text>
      <View style={[ui.card, styles.form]}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
      <Text style={[ui.disclaimer, { marginTop: SPACING.xl }]}>
        AI-assisted finding. Decision support only, not a diagnosis.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', maxWidth: LAYOUT.maxFormWidth, paddingTop: SPACING.xxl },
  brand: { alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xl },
  logo: {
    width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primaryMutedBg, borderWidth: 1, borderColor: COLORS.primaryMutedBorder,
  },
  brandName: { fontFamily: FONTS.bold, fontSize: 18, color: COLORS.textPrimary },
  form: { padding: SPACING.lg },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: SPACING.lg, flexWrap: 'wrap' },
});
