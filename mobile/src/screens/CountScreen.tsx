import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { CountingSessionProvider, useCountingSession, type ScanEvent } from '../hooks/useCountingSession';
import BottomPanel from '../components/BottomPanel';
import VoiceBar from '../components/VoiceBar';
import { Button } from '../components/ui';
import { colors, font, radius } from '../theme';

function ScannerView() {
  const { handleScan } = useCountingSession();
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission, requestPermission]);

  if (!permission?.granted) {
    return (
      <View style={styles.camFallback}>
        <Text style={styles.camFallbackText}>Camera access is needed to scan labels.</Text>
        <Button title="Allow camera" small onPress={() => requestPermission()} style={{ marginTop: 8 }} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'datamatrix'] }}
        onBarcodeScanned={(result) => {
          if (result?.data) handleScan(result.data);
        }}
      />
      <View style={styles.finderWrap} pointerEvents="none">
        <View style={styles.finder} />
      </View>
    </View>
  );
}

function ScanBanner() {
  const { lastEvent } = useCountingSession();
  const [visible, setVisible] = useState<ScanEvent | null>(null);
  useEffect(() => {
    if (!lastEvent) return;
    setVisible(lastEvent);
    const t = setTimeout(() => setVisible(null), 2600);
    return () => clearTimeout(t);
  }, [lastEvent]);
  if (!visible) return null;
  const bg = visible.kind === 'error' ? colors.red : visible.kind === 'info' ? '#374151' : colors.teal;
  return (
    <View pointerEvents="none" style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={styles.bannerText} numberOfLines={2}>{visible.message}</Text>
    </View>
  );
}

function TopBar({ cameraOn, onToggleCamera, onEnd }: { cameraOn: boolean; onToggleCamera: () => void; onEnd: () => void }) {
  const insets = useSafeAreaInsets();
  const { fridge, shelfNumber, activeBasketId, goBack, selectFridge, selectShelf, sessionProgress } = useCountingSession();
  const { signOutUser } = useAuth();
  const sign = sessionProgress.netDelta > 0 ? '+' : '';
  return (
    <View style={[styles.top, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <Pressable onPress={fridge ? goBack : signOutUser} hitSlop={10} style={styles.topBtn}>
          <Text style={styles.topBtnText}>{fridge ? '‹' : '⏻'}</Text>
        </Pressable>
        <View style={styles.crumbs}>
          {!fridge ? (
            <Text style={styles.crumbMuted} numberOfLines={1}>Scan, say, or pick a fridge</Text>
          ) : (
            <>
              <Pressable onPress={() => selectFridge(fridge)} style={{ flexShrink: 1 }}>
                <Text style={styles.crumb} numberOfLines={1}>{fridge.name}</Text>
              </Pressable>
              {shelfNumber !== null && (
                <>
                  <Text style={styles.crumbSep}>›</Text>
                  <Pressable onPress={() => selectShelf(shelfNumber)}>
                    <Text style={styles.crumb}>{shelfNumber === 0 ? 'Unshelved' : `Shelf ${shelfNumber}`}</Text>
                  </Pressable>
                </>
              )}
              {activeBasketId && (
                <>
                  <Text style={styles.crumbSep}>›</Text>
                  <Text style={styles.crumbMuted}>Basket</Text>
                </>
              )}
            </>
          )}
        </View>
        <Pressable onPress={onToggleCamera} hitSlop={10} style={styles.topBtn}>
          <Text style={[styles.topBtnText, { fontSize: 18 }]}>{cameraOn ? '📷' : '🚫'}</Text>
        </Pressable>
        <Pressable onPress={onEnd} hitSlop={10} style={[styles.topBtn, { width: 'auto', paddingHorizontal: 8 }]}>
          <Text style={styles.endText}>End</Text>
        </Pressable>
      </View>
      <Text style={styles.stats}>
        {sessionProgress.basketsCount} {sessionProgress.basketsCount === 1 ? 'basket' : 'baskets'} · {sessionProgress.vialsCounted} vials counted ·{' '}
        <Text style={{ color: sessionProgress.netDelta === 0 ? '#9ca3af' : sessionProgress.netDelta > 0 ? '#86efac' : '#fca5a5' }}>
          Δ {sign}{sessionProgress.netDelta}
        </Text>
      </Text>
    </View>
  );
}

function SessionReviewModal({ visible, onClose, onCompleted }: { visible: boolean; onClose: () => void; onCompleted: () => void }) {
  const { sessionId, sessionProgress, completeSession } = useCountingSession();
  const [completing, setCompleting] = useState(false);
  const [remoteBaskets, setRemoteBaskets] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || !sessionId) return;
    getDoc(doc(db, 'countingSessions', sessionId))
      .then((s) => setRemoteBaskets(Array.isArray(s.data()?.countedBaskets) ? s.data()!.countedBaskets.length : null))
      .catch(() => {});
  }, [visible, sessionId]);

  const complete = async () => {
    setCompleting(true);
    try {
      await completeSession();
      onCompleted();
    } finally {
      setCompleting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.review}>
        <Text style={styles.reviewTitle}>Session summary</Text>
        <View style={styles.statGrid}>
          <View style={styles.stat}><Text style={styles.statLabel}>Baskets</Text><Text style={styles.statValue}>{remoteBaskets ?? sessionProgress.basketsCount}</Text></View>
          <View style={styles.stat}><Text style={styles.statLabel}>Vials counted</Text><Text style={[styles.statValue, { color: colors.teal }]}>{sessionProgress.vialsCounted}</Text></View>
          <View style={styles.stat}><Text style={styles.statLabel}>Net change</Text><Text style={[styles.statValue, { color: sessionProgress.netDelta > 0 ? colors.green : sessionProgress.netDelta < 0 ? colors.red : colors.ink }]}>{sessionProgress.netDelta > 0 ? '+' : ''}{sessionProgress.netDelta}</Text></View>
        </View>
        <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 8 }}>
          Every basket you saved is already in Firestore; completing just closes this session on the dashboard. The CSV export lives on the web app's End screen.
        </Text>
        <View style={{ flex: 1 }} />
        <Button title="Complete session" onPress={complete} loading={completing} />
        <Button title="Keep counting" variant="ghost" onPress={onClose} style={{ marginTop: 6 }} />
      </View>
    </Modal>
  );
}

function CountScreenBody({ onSessionCompleted }: { onSessionCompleted: () => void }) {
  const { cameraPaused } = useCountingSession();
  const [cameraOn, setCameraOn] = useState(true);
  const [review, setReview] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bar }}>
      <TopBar cameraOn={cameraOn} onToggleCamera={() => setCameraOn((v) => !v)} onEnd={() => setReview(true)} />
      <View style={{ flex: 1 }}>
        <ScanBanner />
        {cameraOn && !cameraPaused ? (
          <View style={styles.camera}>
            <ScannerView />
          </View>
        ) : null}
        <VoiceBar />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.white }}>
          <View style={{ flex: 1, paddingBottom: insets.bottom }}>
            <BottomPanel />
          </View>
        </KeyboardAvoidingView>
      </View>
      <SessionReviewModal
        visible={review}
        onClose={() => setReview(false)}
        onCompleted={() => {
          setReview(false);
          onSessionCompleted();
        }}
      />
    </View>
  );
}

export default function CountScreen() {
  // Completing a session remounts the provider so the next count gets a fresh session doc.
  const [sessionKey, setSessionKey] = useState(0);
  return (
    <CountingSessionProvider key={sessionKey}>
      <CountScreenBody onSessionCompleted={() => setSessionKey((k) => k + 1)} />
    </CountingSessionProvider>
  );
}

const styles = StyleSheet.create({
  top: { backgroundColor: colors.bar },
  topRow: { flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: 6, gap: 2 },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topBtnText: { color: colors.white, fontSize: 28, lineHeight: 30 },
  endText: { color: '#f87171', fontWeight: '700', fontSize: font.sm },
  crumbs: { flex: 1, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  crumb: { color: colors.white, fontWeight: '700', fontSize: font.sm },
  crumbSep: { color: 'rgba(255,255,255,0.4)', marginHorizontal: 4, fontSize: font.md },
  crumbMuted: { color: 'rgba(255,255,255,0.7)', fontSize: font.sm },
  stats: { color: 'rgba(255,255,255,0.7)', fontSize: font.xs, paddingHorizontal: 12, paddingBottom: 6 },
  camera: { height: 220, backgroundColor: '#000' },
  camFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  camFallbackText: { color: '#e5e7eb', fontSize: font.sm, textAlign: 'center' },
  finderWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  finder: { width: 170, height: 170, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)' },
  banner: { position: 'absolute', top: 8, left: 12, right: 12, zIndex: 20, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9 },
  bannerText: { color: colors.white, fontWeight: '600', fontSize: font.sm },
  review: { flex: 1, padding: 20, paddingTop: 24, backgroundColor: colors.white },
  reviewTitle: { fontSize: font.xl, fontWeight: '800', color: colors.ink, marginBottom: 12 },
  statGrid: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 10, alignItems: 'center' },
  statLabel: { fontSize: font.xs, color: colors.muted },
  statValue: { fontSize: 24, fontWeight: '800', color: colors.ink, marginTop: 2 },
});
