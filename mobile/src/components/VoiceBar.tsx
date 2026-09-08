import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCountingSession } from '../hooks/useCountingSession';
import { useVoiceRecorder } from '../lib/voice';
import { transcribeCommand } from '../lib/ai';
import { colors, font, radius } from '../theme';

/**
 * Hands-free input. Hold the mic, say "four trays and twenty-two vials",
 * "shelf 3", "fridge 2 peptides", "basket BPC", "save". The clip goes to
 * Gemini for transcription and the shared parser applies it. The text field
 * accepts the same sentences typed or dictated with the keyboard mic.
 */
export default function VoiceBar() {
  const { applyVoiceText } = useCountingSession();
  const { recording, error, start, stop } = useVoiceRecorder();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const onPressOut = async () => {
    const clip = await stop();
    if (!clip) return;
    setBusy(true);
    setStatus('Transcribing…');
    try {
      const transcript = await transcribeCommand(clip.base64, clip.mimeType);
      if (!transcript) {
        setStatus('Nothing heard. Hold the button while you speak.');
        return;
      }
      setStatus(`“${transcript}”`);
      await applyVoiceText(transcript);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Voice failed');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    setStatus(`“${v}”`);
    await applyVoiceText(v);
  };

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Pressable
          onPressIn={() => {
            setStatus(null);
            start();
          }}
          onPressOut={onPressOut}
          disabled={busy}
          style={({ pressed }) => [styles.mic, (pressed || recording) && styles.micActive, busy && { opacity: 0.6 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.micText}>{recording ? '● Listening…' : '🎤 Hold to talk'}</Text>
          )}
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          returnKeyType="go"
          placeholder="or type: 4 trays 22 vials · shelf 3"
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      {status || error ? (
        <Text style={[styles.status, error && { color: '#fca5a5' }]} numberOfLines={1}>
          {error ?? status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: '#1f2937', paddingHorizontal: 10, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mic: {
    height: 42,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.tealDark,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 130,
  },
  micActive: { backgroundColor: colors.red },
  micText: { color: colors.white, fontWeight: '700', fontSize: font.sm },
  input: {
    flex: 1,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: colors.white,
    paddingHorizontal: 12,
    fontSize: font.sm,
  },
  status: { color: '#d1d5db', fontSize: font.xs, marginTop: 6 },
});
