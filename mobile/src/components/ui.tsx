import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, radius } from '../theme';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  small,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const bg =
    variant === 'primary' ? colors.teal : variant === 'danger' ? colors.red : variant === 'outline' ? colors.white : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? colors.white : variant === 'outline' ? colors.ink : colors.teal;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg, borderColor: variant === 'outline' ? '#d1d5db' : bg },
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, small && styles.btnTextSmall, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: colors.teal, borderColor: colors.teal }]}
    >
      <Text style={[styles.chipText, active && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Spinner() {
  return (
    <View style={{ padding: 24, alignItems: 'center' }}>
      <ActivityIndicator color={colors.teal} />
    </View>
  );
}

export const ui = StyleSheet.create({
  panelHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  kicker: { fontSize: font.xs, fontWeight: '700', color: colors.tealDark, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  sub: { fontSize: font.sm, color: colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 6,
  },
  rowTitle: { fontSize: font.md, fontWeight: '600', color: colors.ink },
  rowSub: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    fontSize: font.md,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    backgroundColor: colors.white,
  },
  error: { color: colors.red, fontSize: font.xs, backgroundColor: colors.redSoft, padding: 8, borderRadius: radius.sm },
});

const styles = StyleSheet.create({
  btn: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  btnSmall: { height: 38, paddingHorizontal: 12 },
  btnText: { fontSize: font.md, fontWeight: '700' },
  btnTextSmall: { fontSize: font.sm },
  chip: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  section: { fontSize: font.xs, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
});
