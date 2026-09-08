import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius } from '../theme';

interface StepperProps {
  label: string;
  hint?: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  bigStep?: number;
  accent?: 'teal' | 'amber';
}

/** Thumb-friendly counter: [-big] [-1] [ value ] [+1] [+big]. Value is directly editable. */
export default function Stepper({ label, hint, value, onChange, min = 0, max = 9999, bigStep, accent = 'teal' }: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.floor(Number.isFinite(n) ? n : min)));
  const set = (n: number) => onChange(clamp(n));
  const ring = accent === 'teal' ? colors.teal : colors.amber;

  const Btn = ({ text, onPress, disabled }: { text: string; onPress: () => void; disabled?: boolean }) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed, disabled && styles.btnDisabled]}
      hitSlop={4}
    >
      <Text style={styles.btnText}>{text}</Text>
    </Pressable>
  );

  return (
    <View>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={styles.row}>
        {bigStep ? <Btn text={`−${bigStep}`} onPress={() => set(value - bigStep)} disabled={value <= min} /> : null}
        <Btn text="−" onPress={() => set(value - 1)} disabled={value <= min} />
        <TextInput
          style={[styles.input, { borderColor: ring }]}
          value={String(value)}
          keyboardType="number-pad"
          selectTextOnFocus
          onChangeText={(t) => set(parseInt(t, 10) || 0)}
        />
        <Btn text="+" onPress={() => set(value + 1)} disabled={value >= max} />
        {bigStep ? <Btn text={`+${bigStep}`} onPress={() => set(value + bigStep)} disabled={value >= max} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  label: { fontSize: font.xs, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  hint: { fontSize: font.xs, color: colors.faint },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: {
    height: 50,
    minWidth: 50,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { backgroundColor: '#f3f4f6', transform: [{ scale: 0.96 }] },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 20, fontWeight: '700', color: colors.ink },
  input: {
    flex: 1,
    height: 50,
    borderWidth: 1.5,
    borderRadius: radius.md,
    textAlign: 'center',
    fontSize: 26,
    fontWeight: '800',
    color: colors.ink,
    backgroundColor: colors.white,
  },
});
