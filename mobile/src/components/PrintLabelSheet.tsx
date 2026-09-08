import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { DEFAULT_LABEL_FORMAT, describePrintError, enqueuePrintJob, LABEL_FORMAT_SPECS, type LabelFormat } from '../core';
import { colors, font, radius } from '../theme';
import { Button, ui } from './ui';

export interface PrintRequest {
  code: string;
  title: string;
  subtitle?: string;
}

/**
 * Queue a label for the pharmacy print server. Defaults to the 2 x 1.5 in
 * Epson stock; the label body (QR + text) is rendered by the print server.
 */
export default function PrintLabelSheet({ request, onClose }: { request: PrintRequest | null; onClose: () => void }) {
  const [format, setFormat] = useState<LabelFormat>(DEFAULT_LABEL_FORMAT);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (request) {
      setFormat(DEFAULT_LABEL_FORMAT);
      setDone(false);
      setError(null);
    }
  }, [request]);

  const send = async () => {
    if (!request) return;
    setSending(true);
    setError(null);
    try {
      await enqueuePrintJob({ ...request, format });
      setDone(true);
      setTimeout(onClose, 700);
    } catch (err) {
      setError(describePrintError(err, format));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={!!request} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <Text style={styles.h1}>Print label</Text>
        {request && (
          <View style={styles.preview}>
            <Text style={styles.pTitle}>{request.title}</Text>
            {request.subtitle ? <Text style={styles.pSub}>{request.subtitle}</Text> : null}
            <Text style={styles.pCode}>{request.code}</Text>
          </View>
        )}
        <Text style={ui.kicker}>Label size</Text>
        {LABEL_FORMAT_SPECS.map((s) => (
          <Pressable key={s.key} onPress={() => setFormat(s.key)} style={[styles.opt, format === s.key && styles.optActive]}>
            <Text style={[styles.optText, format === s.key && { color: colors.tealDark, fontWeight: '700' }]}>{s.label}</Text>
          </Pressable>
        ))}
        {error ? <Text style={[ui.error, { marginTop: 10 }]}>{error}</Text> : null}
        <View style={{ flex: 1 }} />
        <Button title={done ? 'Queued ✓' : 'Send to print station'} onPress={send} loading={sending} disabled={done} />
        <Button title="Close" variant="ghost" onPress={onClose} style={{ marginTop: 6 }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: 20, paddingTop: 24, backgroundColor: colors.white },
  h1: { fontSize: font.xl, fontWeight: '800', color: colors.ink, marginBottom: 12 },
  preview: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, backgroundColor: colors.panel, marginBottom: 16 },
  pTitle: { fontSize: font.lg, fontWeight: '700', color: colors.ink },
  pSub: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  pCode: { fontSize: font.xs, color: colors.faint, marginTop: 6, fontFamily: 'Menlo' },
  opt: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, marginBottom: 6 },
  optActive: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  optText: { fontSize: font.sm, color: colors.text },
});
