import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useCountingSession } from '../../hooks/useCountingSession';
import {
  basketTotal,
  commitBasketCount,
  DEFAULT_VIALS_PER_TRAY,
  formatTraysVials,
  saveLearningRecord,
  SLOT_POSITIONS,
  subscribeBasket,
  type BasketRecord,
} from '../../core';
import { useProducts } from '../../hooks/useProducts';
import { timeAgo } from '../../lib/timeAgo';
import { colors, font, radius } from '../../theme';
import Stepper from '../Stepper';
import { Button, Chip, Spinner, ui } from '../ui';
import AiCountModal, { type AiCountSample } from '../AiCountModal';
import PrintLabelSheet, { type PrintRequest } from '../PrintLabelSheet';

/** A full bin in the pharmacy fridge holds 6 trays of 25 = 150 vials. */
const DEFAULT_TRAYS_PER_BASKET = 6;

export default function QuickCount({ basketId }: { basketId: string }) {
  const { user } = useAuth();
  const { fridge, shelfNumber, shelfId, sessionId, selectBasket, notify, lastCommand, setCameraPaused } = useCountingSession();
  const { byId } = useProducts();

  const [basket, setBasket] = useState<BasketRecord | null | undefined>(undefined);
  const [trays, setTrays] = useState(0);
  const [loose, setLoose] = useState(0);
  const [vpt, setVpt] = useState(DEFAULT_VIALS_PER_TRAY);
  const [name, setName] = useState('');
  const [lot, setLot] = useState('');
  const [position, setPosition] = useState<number | null>(null);
  const [placeHere, setPlaceHere] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [print, setPrint] = useState<PrintRequest | null>(null);
  const aiSampleRef = useRef<AiCountSample | null>(null);
  const initialized = useRef(false);
  const appliedCommand = useRef<number>(lastCommand?.id ?? 0);
  const draftRef = useRef({ trays: 0, loose: 0 });
  draftRef.current = { trays, loose };

  useEffect(() => {
    initialized.current = false;
    return subscribeBasket(
      basketId,
      (b) => {
        setBasket(b);
        if (b && !initialized.current) {
          initialized.current = true;
          setTrays(b.trayCount);
          setLoose(b.looseVials);
          setVpt(b.vialsPerTray);
          setName(b.name);
          setLot(b.lotNumber);
          setPosition(b.shelfPosition);
        }
      },
      (e) => {
        console.error('basket subscription', e);
        setError('Could not load this basket');
      },
    );
  }, [basketId]);

  const productName = basket ? byId[basket.productId]?.name ?? basket.name ?? 'Basket' : 'Basket';
  const targetShelfId = fridge && shelfNumber !== null && shelfNumber > 0 ? shelfId : null;
  const needsShelfMove = !!basket && !!targetShelfId && basket.shelfId !== targetShelfId;
  const needsFridgeMove = !!basket && !!fridge && basket.locationId !== fridge.id;
  const offerMove = needsShelfMove || needsFridgeMove;

  const save = async (override?: { trays?: number; loose?: number }) => {
    if (!user || !basket) return;
    const t = override?.trays ?? draftRef.current.trays;
    const l = override?.loose ?? draftRef.current.loose;
    setSaving(true);
    setError(null);
    try {
      const moving = offerMove && placeHere && fridge;
      const result = await commitBasketCount({
        basketId,
        trayCount: t,
        looseVials: l,
        vialsPerTray: vpt,
        userId: user.uid,
        sessionId,
        locationId: moving ? fridge.id : undefined,
        shelfId: moving && targetShelfId ? targetShelfId : undefined,
        shelfPosition: position ?? undefined,
        name: name.trim() && name.trim() !== basket.name ? name.trim() : undefined,
        lotNumber: lot.trim() !== basket.lotNumber ? lot.trim() : undefined,
        note: aiSampleRef.current ? `AI suggested ${aiSampleRef.current.prediction} loose` : undefined,
      });
      if (aiSampleRef.current) {
        saveLearningRecord({
          imageBase64: aiSampleRef.current.imageBase64,
          aiPrediction: aiSampleRef.current.prediction,
          userFinalCount: l,
          productId: basket.productId,
          trayId: 'loose',
          basketId,
          userId: user.uid,
          notes: aiSampleRef.current.notes,
        });
      }
      notify('basket', `Saved ${productName}: ${formatTraysVials(t, l)} = ${result.newTotal}`);
      await selectBasket(null);
    } catch (err) {
      console.error('Save failed', err);
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Spoken / typed commands: "4 trays 22 vials", "empty", "full basket", "save".
  useEffect(() => {
    if (!lastCommand || lastCommand.id === appliedCommand.current || !basket) return;
    appliedCommand.current = lastCommand.id;
    let t = draftRef.current.trays;
    let l = draftRef.current.loose;
    let doSave = false;
    for (const c of lastCommand.commands) {
      if (c.kind === 'count') {
        if (c.trays !== undefined) t = c.trays;
        if (c.loose !== undefined) l = c.loose;
      } else if (c.kind === 'empty') {
        t = 0;
        l = 0;
      } else if (c.kind === 'full') {
        t = DEFAULT_TRAYS_PER_BASKET;
        l = 0;
      } else if (c.kind === 'save') {
        doSave = true;
      }
    }
    setTrays(t);
    setLoose(l);
    if (doSave) saveRef.current({ trays: t, loose: l });
    else notify('info', `${formatTraysVials(t, l)} — say "save" or tap Save`);
  }, [lastCommand, basket, notify]);

  if (basket === undefined) return <Spinner />;
  if (basket === null) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <Text style={ui.sub}>This basket no longer exists.</Text>
        <Button title="Back" variant="outline" style={{ marginTop: 12 }} onPress={() => selectBasket(null)} />
      </View>
    );
  }

  const total = trays * vpt + loose;
  const prevTotal = basketTotal(basket);
  const delta = total - prevTotal;
  const extraTrays = vpt > 0 ? Math.floor(loose / vpt) : 0;
  const whereLine = [fridge?.name, shelfNumber ? `Shelf ${shelfNumber}` : null, basket.lotNumber ? `Lot ${basket.lotNumber}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Pressable onPress={() => selectBasket(null)} hitSlop={10} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={ui.rowTitle} numberOfLines={1}>{productName}</Text>
          <Text style={ui.rowSub} numberOfLines={1}>
            {whereLine ? `${whereLine} · ` : ''}
            {basket.lastCountedAt ? `counted ${timeAgo(basket.lastCountedAt)}` : 'never counted'}
          </Text>
        </View>
        <Pressable onPress={() => setPrint({ code: basket.qrCode, title: productName, subtitle: whereLine })} hitSlop={10} style={styles.headerBtn}>
          <Text style={{ fontSize: 18 }}>🖨️</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, gap: 12 }} keyboardShouldPersistTaps="handled">
        {offerMove && fridge && (
          <View style={styles.moveRow}>
            <Switch value={placeHere} onValueChange={setPlaceHere} trackColor={{ true: colors.amber }} />
            <Text style={styles.moveText}>
              Place on <Text style={{ fontWeight: '700' }}>{fridge.name}{targetShelfId ? ` · Shelf ${shelfNumber}` : ''}</Text>
            </Text>
          </View>
        )}

        <Stepper label="Full trays" hint={`× ${vpt} vials`} value={trays} onChange={setTrays} max={99} />
        <Stepper label="Loose vials" hint="partial tray" value={loose} onChange={setLoose} bigStep={5} max={999} accent="amber" />

        {extraTrays > 0 && (
          <Pressable
            onPress={() => {
              setTrays(trays + extraTrays);
              setLoose(loose - extraTrays * vpt);
            }}
            style={styles.convert}
          >
            <Text style={styles.convertText}>
              {loose} loose ≥ {vpt}: tap to convert into {extraTrays} more {extraTrays === 1 ? 'tray' : 'trays'} + {loose - extraTrays * vpt} loose
            </Text>
          </Pressable>
        )}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Empty" onPress={() => { setTrays(0); setLoose(0); }} />
          <Chip label={`Full (${DEFAULT_TRAYS_PER_BASKET} trays)`} onPress={() => { setTrays(DEFAULT_TRAYS_PER_BASKET); setLoose(0); }} />
          <Chip
            label="📷 AI count loose"
            onPress={() => {
              setCameraPaused(true);
              setAiOpen(true);
            }}
          />
        </View>

        <Pressable onPress={() => setShowDetails((v) => !v)} style={styles.detailsToggle}>
          <Text style={styles.detailsToggleText}>Details · lot, slot, vials per tray</Text>
          <Text style={styles.detailsToggleText}>{showDetails ? '▴' : '▾'}</Text>
        </Pressable>
        {showDetails && (
          <View style={styles.details}>
            <Text style={styles.fieldLabel}>Basket name</Text>
            <TextInput value={name} onChangeText={setName} style={ui.input} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Lot number</Text>
                <TextInput value={lot} onChangeText={setLot} placeholder="optional" style={ui.input} autoCapitalize="characters" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Vials per tray</Text>
                <TextInput
                  value={String(vpt)}
                  onChangeText={(t) => setVpt(Math.max(1, parseInt(t, 10) || DEFAULT_VIALS_PER_TRAY))}
                  keyboardType="number-pad"
                  style={ui.input}
                />
              </View>
            </View>
            <Text style={[styles.fieldLabel, { marginTop: 8 }]}>Slot on shelf</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {SLOT_POSITIONS.map((s) => (
                <Chip key={s.value} label={s.short} active={position === s.value} onPress={() => setPosition(position === s.value ? null : s.value)} />
              ))}
            </View>
          </View>
        )}

        {error ? <Text style={ui.error}>{error}</Text> : null}
      </ScrollView>

      <View style={ui.footer}>
        <View>
          <Text style={styles.total}>{total}</Text>
          <Text style={styles.totalSub}>
            vials · {formatTraysVials(trays, loose)}
            {basket.lastCountedAt ? (
              <Text style={{ color: delta === 0 ? colors.muted : delta > 0 ? colors.green : colors.red }}>
                {' '}({delta > 0 ? '+' : ''}{delta} vs last)
              </Text>
            ) : null}
          </Text>
        </View>
        <Button title="Save count" style={{ flex: 1 }} onPress={() => save()} loading={saving} />
      </View>

      <AiCountModal
        visible={aiOpen}
        onClose={() => {
          setAiOpen(false);
          setCameraPaused(false);
        }}
        onAccept={(count, sample) => {
          aiSampleRef.current = sample;
          setLoose(count);
          setAiOpen(false);
          setCameraPaused(false);
          notify('info', `AI counted ${count} loose vials (${sample.confidence})`);
        }}
      />
      <PrintLabelSheet request={print} onClose={() => setPrint(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerBtnText: { fontSize: 30, color: colors.text, lineHeight: 32 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.amberTint, borderColor: '#fde68a', borderWidth: 1, borderRadius: radius.md, padding: 10 },
  moveText: { flex: 1, color: '#78350f', fontSize: font.sm },
  convert: { backgroundColor: colors.tealTint, borderColor: '#99f6e4', borderWidth: 1, borderRadius: radius.md, padding: 10 },
  convertText: { color: colors.tealDark, fontSize: font.xs },
  detailsToggle: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailsToggleText: { fontSize: font.xs, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  details: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 10, gap: 4 },
  fieldLabel: { fontSize: font.xs, color: colors.muted, marginBottom: 4 },
  total: { fontSize: 26, fontWeight: '800', color: colors.ink, lineHeight: 28 },
  totalSub: { fontSize: font.xs, color: colors.muted },
});
