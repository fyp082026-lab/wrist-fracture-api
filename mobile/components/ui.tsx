import React, { forwardRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, LAYOUT, RADIUS, SPACING, TABULAR_NUMBERS } from '@/constants/theme';
import { type ScanStatus, deriveFindingStatus } from '@/services/contract';

type IconName = keyof typeof Ionicons.glyphMap;

// ─── Screen ──────────────────────────────────────────────────────────────────

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  edges = ['top', 'left', 'right'],
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  contentStyle?: ViewStyle;
}) {
  const body = <View style={[styles.content, contentStyle]}>{children}</View>;
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={COLORS.primaryBright} />
              ) : undefined
            }>
            {body}
          </ScrollView>
        ) : (
          body
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Header({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
        </Pressable>
      ) : null}
      <View style={styles.flex}>
        <Text style={styles.h1} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

// ─── Button ──────────────────────────────────────────────────────────────────

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: ViewStyle;
}) {
  const inactive = disabled || loading;
  const color = variant === 'primary' ? '#FFFFFF' : variant === 'danger' ? COLORS.status.fracture.text : COLORS.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'danger' && styles.btnDanger,
        pressed && !inactive && { opacity: 0.85 },
        inactive && { opacity: 0.55 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
          <Text style={[styles.btnText, { color }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

// ─── TextField ───────────────────────────────────────────────────────────────

export const TextField = forwardRef<TextInput, TextInputProps & { label: string; icon?: IconName; error?: string | null; hint?: string; password?: boolean }>(
  function TextField({ label, icon, error, hint, password, style, ...rest }, ref) {
    const [focused, setFocused] = useState(false);
    const [hidden, setHidden] = useState(true);
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.inputWrap, focused && styles.inputFocused, error ? styles.inputError : null]}>
          {icon ? <Ionicons name={icon} size={18} color={COLORS.textMuted} style={{ marginLeft: SPACING.md }} /> : null}
          <TextInput
            ref={ref}
            placeholderTextColor={COLORS.textMuted}
            selectionColor={COLORS.primaryBright}
            secureTextEntry={password ? hidden : undefined}
            autoCapitalize={password ? 'none' : rest.autoCapitalize}
            autoCorrect={password ? false : rest.autoCorrect}
            {...rest}
            onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
            onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
            style={[styles.input, style]}
            accessibilityLabel={label}
          />
          {password ? (
            <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} style={{ paddingHorizontal: SPACING.md }} accessibilityRole="button" accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
              <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={18} color={COLORS.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    );
  }
);

// ─── Banner / Card / misc ───────────────────────────────────────────────────

const BANNER = {
  error: { ...COLORS.status.fracture, icon: 'alert-circle' as IconName },
  warning: { ...COLORS.status.lowConfidence, icon: 'warning' as IconName },
  success: { ...COLORS.status.intact, icon: 'checkmark-circle' as IconName },
  info: { ...COLORS.status.info, icon: 'information-circle' as IconName },
};

export function Banner({ kind, message, onDismiss }: { kind: keyof typeof BANNER; message: string; onDismiss?: () => void }) {
  const b = BANNER[kind];
  return (
    <View style={[styles.banner, { backgroundColor: b.bg, borderColor: b.border }]} accessibilityRole="alert">
      <Ionicons name={b.icon} size={18} color={b.text} />
      <Text style={[styles.bannerText, { color: b.text }]}>{message}</Text>
      {onDismiss ? (
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color={b.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {typeof value === 'string' ? <Text style={[styles.rowValue, TABULAR_NUMBERS]}>{value}</Text> : value}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={COLORS.primaryBright} />
      {label ? <Text style={styles.subtitle}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name={icon} size={28} color={COLORS.primaryBright} /></View>
      <Text style={styles.h2}>{title}</Text>
      <Text style={[styles.subtitle, { textAlign: 'center' }]}>{body}</Text>
      {action}
    </View>
  );
}

// ─── Chips (icon + text, never colour alone) ──────────────────────────────

type Tone = keyof typeof COLORS.status | 'neutral';

export function Chip({ label, icon, tone }: { label: string; icon: IconName; tone: Tone }) {
  const c = tone === 'neutral'
    ? { text: COLORS.textSecondary, bg: COLORS.surfaceHigh, border: COLORS.surfaceBorderHigh }
    : COLORS.status[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Ionicons name={icon} size={13} color={c.text} />
      <Text style={[styles.chipText, { color: c.text }]}>{label}</Text>
    </View>
  );
}

const STATUS: Record<ScanStatus, { label: string; icon: IconName; tone: Tone }> = {
  completed: { label: 'Completed', icon: 'checkmark-circle', tone: 'intact' },
  analyzing: { label: 'Analyzing', icon: 'sync', tone: 'info' },
  uploaded: { label: 'Uploaded', icon: 'cloud-upload-outline', tone: 'neutral' },
  failed: { label: 'Failed', icon: 'close-circle', tone: 'fracture' },
};

export function StatusChip({ status }: { status: ScanStatus }) {
  return <Chip {...(STATUS[status] ?? STATUS.uploaded)} />;
}

/** AI-assisted wording only: never "diagnosis" or "confirmed". */
export function FindingChip({ fracture, confidence }: { fracture: boolean | null; confidence: number | null }) {
  // null: fracture detection was not run for this scan (bone age only).
  if (fracture === null) return <Chip label="Fracture check not run" icon="remove-circle-outline" tone="neutral" />;
  const s = deriveFindingStatus(fracture, confidence);
  if (s === 'no_fracture') return <Chip label="No fracture suggested" icon="shield-checkmark" tone="intact" />;
  if (s === 'low_confidence') return <Chip label="Lower confidence, review carefully" icon="warning" tone="lowConfidence" />;
  return <Chip label="Fracture suggested" icon="alert-circle" tone="fracture" />;
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  content: { flex: 1, width: '100%', maxWidth: LAYOUT.maxContentWidth, paddingHorizontal: SPACING.base, paddingBottom: SPACING.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  backBtn: { width: 40, height: 40, borderRadius: RADIUS.full, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceLow },
  h1: { fontFamily: FONTS.bold, fontSize: 24, color: COLORS.textPrimary, letterSpacing: -0.3 },
  h2: { fontFamily: FONTS.semibold, fontSize: 17, color: COLORS.textPrimary },
  subtitle: { fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textSecondary, marginTop: 2 },
  body: { fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textSecondary, lineHeight: 21 },
  btn: {
    minHeight: LAYOUT.minTouchTarget, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
  },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnSecondary: { backgroundColor: COLORS.surfaceHigh, borderWidth: 1, borderColor: COLORS.surfaceBorderHigh },
  btnDanger: { backgroundColor: COLORS.status.fracture.bg, borderWidth: 1, borderColor: COLORS.status.fracture.border },
  btnText: { fontFamily: FONTS.semibold, fontSize: 15 },
  field: { marginBottom: SPACING.base },
  label: { fontFamily: FONTS.semibold, fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surfaceLowest,
    borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.surfaceBorderHigh, minHeight: 50,
  },
  inputFocused: { borderColor: COLORS.primaryBright },
  inputError: { borderColor: COLORS.status.fracture.primary },
  input: { flex: 1, minHeight: 48, paddingHorizontal: SPACING.md, fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textPrimary },
  errorText: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.status.fracture.text, marginTop: 4 },
  hint: { fontFamily: FONTS.regular, fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.base },
  bannerText: { flex: 1, fontFamily: FONTS.medium, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: COLORS.surfaceLow, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.surfaceBorder, padding: SPACING.base },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm, gap: SPACING.md },
  rowLabel: { fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textSecondary },
  rowValue: { fontFamily: FONTS.semibold, fontSize: 14, color: COLORS.textPrimary, flexShrink: 1, textAlign: 'right' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md, paddingVertical: SPACING.huge },
  empty: { alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xxxl, paddingHorizontal: SPACING.lg },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.primaryMutedBg, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontFamily: FONTS.semibold, fontSize: 12 },
  link: { fontFamily: FONTS.semibold, fontSize: 14, color: COLORS.primaryBright },
  disclaimer: { fontFamily: FONTS.regular, fontSize: 12, color: COLORS.textMuted, lineHeight: 18, textAlign: 'center' },
});
