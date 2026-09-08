import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCountingSession } from '../../hooks/useCountingSession';
import {
  DEFAULT_LABEL_FORMAT,
  describePrintError,
  enqueuePrintJob,
  fridgeCode,
  parseShelfId,
  shelfCode,
  subscribeBasketsForLocation,
  type BasketRecord,
} from '../../core';
import { colors, font, radius } from '../../theme';
import { Button, Spinner, ui } from '../ui';
import PrintLabelSheet, { type PrintRequest } from '../PrintLabelSheet';

export default function ShelfPicker() {
  const { fridge, selectShelf, countedBasketIds, notify } = useCountingSession();
  const [baskets, setBaskets] = useState<BasketRecord[] | null>(null);
  const [print, setPrint] = useState<PrintRequest | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!fridge) return;
    setBaskets(null);
    return subscribeBasketsForLocation(fridge.id, setBaskets, (e) => console.error('baskets', e));
  }, [fridge]);

  const perShelf = useMemo(() => {
    const counted = new Set(countedBasketIds);
    const map: Record<number, { total: number; counted: number }> = {};
    const unassigned = { total: 0, counted: 0 };
    if (!fridge) return { map, unassigned };
    for (const b of baskets ?? []) {
      const ref = parseShelfId(b.shelfId);
      const bucket =
        ref && ref.locationId === fridge.id && ref.shelfNumber <= fridge.shelfCount
          ? (map[ref.shelfNumber] ??= { total: 0, counted: 0 })
          : unassigned;
      bucket.total += 1;
      if (counted.has(b.id)) bucket.counted += 1;
    }
    return { map, unassigned };
  }, [baskets, countedBasketIds, fridge]);

  if (!fridge) return null;
  const shelves = Array.from({ length: fridge.shelfCount }, (_, i) => i + 1);

  const printShelfLabels = () => {
    Alert.alert('Print shelf labels', `Queue ${fridge.shelfCount} shelf labels for ${fridge.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Queue',
        onPress: async () => {
          setPrinting(true);
          try {
            for (const n of shelves) {
              await enqueuePrintJob({ code: shelfCode(fridge.id, n), title: `Shelf ${n}`, subtitle: fridge.name, format: DEFAULT_LABEL_FORMAT });
            }
            notify('info', `Queued ${fridge.shelfCount} shelf labels`);
          } catch (err) {
            notify('error', describePrintError(err, DEFAULT_LABEL_FORMAT));
          } finally {
            setPrinting(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={ui.panelHeader}>
        <Text style={ui.kicker}>{fridge.name}</Text>
        <Text style={ui.sub}>Scan a shelf label, say "shelf 3", or tap the shelf you're on.</Text>
      </View>
      {baskets === null ? (
        <Spinner />
      ) : (
        <ScrollView contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled">
          {shelves.map((n) => {
            const s = perShelf.map[n];
            const done = s && s.total > 0 && s.counted >= s.total;
            return (
              <Pressable key={n} onPress={() => selectShelf(n)} style={({ pressed }) => [styles.cell, done && styles.cellDone, pressed && styles.pressed]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.cellTitle}>Shelf {n}</Text>
                  {done ? <Text style={{ color: colors.teal, fontWeight: '700' }}>✓</Text> : null}
                </View>
                <Text style={styles.cellSub}>{s ? `${s.counted}/${s.total} counted` : 'no baskets yet'}</Text>
              </Pressable>
            );
          })}
          {perShelf.unassigned.total > 0 && (
            <Pressable onPress={() => selectShelf(0)} style={({ pressed }) => [styles.cell, styles.cellWide, styles.cellAmber, pressed && styles.pressed]}>
              <Text style={[styles.cellTitle, { color: '#78350f' }]}>Not on a shelf yet</Text>
              <Text style={[styles.cellSub, { color: '#92400e' }]}>
                {perShelf.unassigned.total} baskets in this fridge without a shelf · open one to place it
              </Text>
            </Pressable>
          )}
        </ScrollView>
      )}
      <View style={ui.footer}>
        <Button
          title="Fridge label"
          variant="outline"
          small
          style={{ flex: 1 }}
          onPress={() => setPrint({ code: fridge.qrCode || fridgeCode(fridge.id), title: fridge.name, subtitle: 'Fridge' })}
        />
        <Button title={`${fridge.shelfCount} shelf labels`} variant="outline" small style={{ flex: 1 }} onPress={printShelfLabels} loading={printing} />
      </View>
      <PrintLabelSheet request={print} onClose={() => setPrint(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  cell: {
    width: '48%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  cellWide: { width: '100%' },
  cellDone: { borderColor: '#5eead4', backgroundColor: colors.tealTint },
  cellAmber: { borderColor: '#fcd34d', backgroundColor: colors.amberTint, borderStyle: 'dashed' },
  pressed: { transform: [{ scale: 0.98 }] },
  cellTitle: { fontSize: font.lg, fontWeight: '700', color: colors.ink },
  cellSub: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
});
