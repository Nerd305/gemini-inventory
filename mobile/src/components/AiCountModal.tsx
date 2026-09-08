import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { countVialsInTrayImage, type TrayCountResult } from '../lib/ai';
import { colors, font, radius } from '../theme';
import { Button } from './ui';

export interface AiCountSample {
  imageBase64: string;
  prediction: number;
  confidence: string;
  notes?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onAccept: (count: number, sample: AiCountSample) => void;
}

type Phase = 'camera' | 'analyzing' | 'result';

/**
 * The visual counter: photograph the loose tray, let Gemini count it, and show
 * every counted vial boxed on the photo so the number can be trusted (or fixed).
 */
export default function AiCountModal({ visible, onClose, onAccept }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [photo, setPhoto] = useState<{ uri: string; width: number; height: number; base64: string } | null>(null);
  const [result, setResult] = useState<TrayCountResult | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPhase('camera');
    setPhoto(null);
    setResult(null);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const capture = async () => {
    if (!camRef.current) return;
    setError(null);
    try {
      const pic = await camRef.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (!pic) return;
      setPhase('analyzing');
      const landscape = pic.width >= pic.height;
      const small = await manipulateAsync(pic.uri, [{ resize: landscape ? { width: 1024 } : { height: 1024 } }], {
        compress: 0.8,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (!small.base64) throw new Error('Could not encode photo');
      setPhoto({ uri: small.uri, width: small.width, height: small.height, base64: small.base64 });
      const res = await countVialsInTrayImage(small.base64);
      setResult(res);
      setCount(res.vialCount);
      setPhase('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI count failed');
      setPhase(photo ? 'result' : 'camera');
    }
  };

  const accept = () => {
    if (!photo || !result) return;
    onAccept(count, { imageBase64: photo.base64, prediction: result.vialCount, confidence: result.confidence, notes: result.notes });
    reset();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      <View style={styles.root}>
        <View style={styles.top}>
          <Pressable onPress={close} hitSlop={10}>
            <Text style={styles.topBtn}>✕</Text>
          </Pressable>
          <Text style={styles.topTitle}>AI count · loose tray</Text>
          <View style={{ width: 24 }} />
        </View>

        {phase === 'camera' && (
          <View style={{ flex: 1 }}>
            {permission?.granted ? (
              <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" />
            ) : (
              <View style={styles.center}>
                <Text style={styles.hint}>Camera access is needed to photograph the tray.</Text>
                <Button title="Allow camera" onPress={() => requestPermission()} style={{ marginTop: 12 }} />
              </View>
            )}
            <View style={styles.guide} pointerEvents="none">
              <Text style={styles.guideText}>Fill the frame with the tray, caps facing the camera</Text>
            </View>
            <View style={styles.shutterRow}>
              <Pressable onPress={capture} style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }]}>
                <View style={styles.shutterInner} />
              </Pressable>
            </View>
            {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
          </View>
        )}

        {phase === 'analyzing' && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.white} size="large" />
            <Text style={[styles.hint, { marginTop: 12 }]}>Counting vials…</Text>
          </View>
        )}

        {phase === 'result' && photo && (
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={[styles.photoWrap, { aspectRatio: photo.width / photo.height }]}>
              <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
              {(result?.detections ?? []).map((d, i) => (
                <View
                  key={i}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: `${Math.max(0, Math.min(100, d.x))}%`,
                    top: `${Math.max(0, Math.min(100, d.y))}%`,
                    width: `${Math.max(1, Math.min(100, d.w))}%`,
                    height: `${Math.max(1, Math.min(100, d.h))}%`,
                    borderWidth: 2,
                    borderColor: '#22c55e',
                    borderRadius: 4,
                  }}
                >
                  <Text style={styles.boxNum}>{i + 1}</Text>
                </View>
              ))}
            </View>
            <View style={styles.resultCard}>
              <Text style={styles.resultLabel}>AI counted</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <Pressable onPress={() => setCount((c) => Math.max(0, c - 1))} style={styles.adj}>
                  <Text style={styles.adjText}>−</Text>
                </Pressable>
                <Text style={styles.big}>{count}</Text>
                <Pressable onPress={() => setCount((c) => c + 1)} style={styles.adj}>
                  <Text style={styles.adjText}>+</Text>
                </Pressable>
              </View>
              <Text style={styles.meta}>
                {result?.confidence ? `confidence ${result.confidence}` : ''}
                {result?.detections?.length ? ` · ${result.detections.length} boxed` : ''}
              </Text>
              {result?.notes ? <Text style={styles.notes}>{result.notes}</Text> : null}
              {error ? <Text style={[styles.notes, { color: '#fca5a5' }]}>{error}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <Button title="Retake" variant="outline" style={{ flex: 1 }} onPress={reset} />
                <Button title={`Use ${count}`} style={{ flex: 1 }} onPress={accept} />
              </View>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 10 },
  topBtn: { color: colors.white, fontSize: 22, width: 24 },
  topTitle: { color: colors.white, fontSize: font.md, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hint: { color: '#e5e7eb', fontSize: font.sm, textAlign: 'center' },
  guide: { position: 'absolute', top: 12, left: 16, right: 16, alignItems: 'center' },
  guideText: { color: colors.white, fontSize: font.xs, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  shutterRow: { position: 'absolute', bottom: 36, left: 0, right: 0, alignItems: 'center' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.white },
  errorBanner: { position: 'absolute', bottom: 130, left: 16, right: 16, color: colors.white, backgroundColor: 'rgba(220,38,38,0.85)', padding: 10, borderRadius: radius.md, textAlign: 'center' },
  photoWrap: { width: '100%', backgroundColor: '#111' },
  boxNum: { position: 'absolute', top: -1, left: -1, fontSize: 9, fontWeight: '800', color: '#052e16', backgroundColor: '#22c55e', paddingHorizontal: 3, borderRadius: 3 },
  resultCard: { margin: 16, padding: 16, borderRadius: radius.lg, backgroundColor: '#1f2937' },
  resultLabel: { color: '#9ca3af', fontSize: font.xs, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center' },
  big: { color: colors.white, fontSize: 56, fontWeight: '800', minWidth: 90, textAlign: 'center' },
  adj: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: '#4b5563', alignItems: 'center', justifyContent: 'center' },
  adjText: { color: colors.white, fontSize: 26, fontWeight: '700' },
  meta: { color: '#9ca3af', fontSize: font.xs, textAlign: 'center' },
  notes: { color: '#d1d5db', fontSize: font.sm, textAlign: 'center', marginTop: 8 },
});
