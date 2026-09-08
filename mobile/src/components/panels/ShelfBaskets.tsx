import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCountingSession } from '../../hooks/useCountingSession';
import {
  basketTotal,
  formatTraysVials,
  parseShelfId,
  shelfCode,
  SLOT_POSITIONS,
  subscribeBasketsForLocation,
  type BasketRecord,
} from '../../core';
import { useProducts } from '../../hooks/useProducts';
import { timeAgo } from '../../lib/timeAgo';
import { colors, font } from '../../theme';
import { Button, Spinner, ui } from '../ui';
import PrintLabelSheet, { type PrintRequest } from '../PrintLabelSheet';
import NewBasket from './NewBasket';

function BasketRow({ basket, name, counted, onOpen }: { basket: BasketRecord; name: string; counted: boolean; onOpen: () => void }) {
  const slot = SLOT_POSITIONS.find((s) => s.value === basket.shelfPosition);
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [ui.row, counted && styles.counted, pressed && { opacity: 0.85 }]}>
      <View style={{ flex: 1 }}>
        <Text style={ui.rowTitle} numberOfLines={1}>{name}</Text>
        <Text style={ui.rowSub} numberOfLines={1}>
          {basket.lotNumber ? `Lot ${basket.lotNumber} · ` : ''}
          {slot ? `${slot.label} · ` : ''}
          {basket.lastCountedAt ? `counted ${timeAgo(basket.lastCountedAt)}` : 'never counted'}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.total}>{basketTotal(basket)}</Text>
        <Text style={styles.tv}>{formatTraysVials(basket.trayCount, basket.looseVials)}</Text>
      </View>
      <Text style={{ color: counted ? colors.teal : colors.faint, fontSize: 20, marginLeft: 4 }}>{counted ? '✓' : '›'}</Text>
    </Pressable>
  );
}

export default function ShelfBaskets() {
  const { fridge, shelfNumber, selectBasket, countedBasketIds, notify } = useCountingSession();
  const { byId } = useProducts();
  const [baskets, setBaskets] = useState<BasketRecord[] | null>(null);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [creating, setCreating] = useState(false);
  const [print, setPrint] = useState<PrintRequest | null>(null);

  useEffect(() => {
    if (!fridge) return;
    setBaskets(null);
    return subscribeBasketsForLocation(fridge.id, setBaskets, (e) => console.error('baskets', e));
  }, [fridge]);

  const nameOf = (b: BasketRecord) => byId[b.productId]?.name ?? b.name ?? 'Basket';

  const { onShelf, unassigned } = useMemo(() => {
    const onShelf: BasketRecord[] = [];
    const unassigned: BasketRecord[] = [];
    if (!fridge) return { onShelf, unassigned };
    for (const b of baskets ?? []) {
      const ref = parseShelfId(b.shelfId);
      const valid = ref && ref.locationId === fridge.id && ref.shelfNumber <= fridge.shelfCount;
      if (!valid) unassigned.push(b);
      else if (ref!.shelfNumber === shelfNumber) onShelf.push(b);
    }
    const label = (b: BasketRecord) => byId[b.productId]?.name ?? b.name ?? '';
    const sortFn = (a: BasketRecord, b: BasketRecord) => (a.shelfPosition ?? 99) - (b.shelfPosition ?? 99) || label(a).localeCompare(label(b));
    onShelf.sort(sortFn);
    unassigned.sort(sortFn);
    return { onShelf, unassigned };
  }, [baskets, fridge, shelfNumber, byId]);

  if (!fridge || shelfNumber === null) return null;
  const isUnassignedBucket = shelfNumber === 0;
  const list = isUnassignedBucket ? unassigned : onShelf;
  const counted = new Set(countedBasketIds);
  const subtitle = isUnassignedBucket ? `${fridge.name} · not on a shelf` : `${fridge.name} · Shelf ${shelfNumber}`;

  if (creating) {
    return (
      <NewBasket
        onClose={() => setCreating(false)}
        onCreated={(basket, doPrint) => {
          setCreating(false);
          notify('basket', `Added ${basket.name} · ${formatTraysVials(basket.trayCount, basket.looseVials)}`);
          if (doPrint) {
            setPrint({
              code: basket.qrCode,
              title: nameOf(basket),
              subtitle: [subtitle, basket.lotNumber ? `Lot ${basket.lotNumber}` : ''].filter(Boolean).join(' · '),
            });
          }
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[ui.panelHeader, { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={{ flex: 1 }}>
          <Text style={ui.kicker} numberOfLines={1}>{subtitle}</Text>
          <Text style={ui.sub}>Scan a basket label, say "basket BPC", or tap one to count it.</Text>
        </View>
        {!isUnassignedBucket && (
          <Pressable
            onPress={() => setPrint({ code: shelfCode(fridge.id, shelfNumber), title: `Shelf ${shelfNumber}`, subtitle: fridge.name })}
            hitSlop={8}
          >
            <Text style={{ fontSize: 20 }}>🖨️</Text>
          </Pressable>
        )}
      </View>

      {baskets === null ? (
        <Spinner />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
          {list.length === 0 ? (
            <Text style={styles.empty}>
              {isUnassignedBucket
                ? 'Every basket in this fridge is on a shelf.'
                : 'No baskets on this shelf yet. Scan a basket label to place one here, or add a new basket.'}
            </Text>
          ) : (
            list.map((b) => (
              <BasketRow key={b.id} basket={b} name={nameOf(b)} counted={counted.has(b.id)} onOpen={() => selectBasket(b, { adoptLocation: false })} />
            ))
          )}
          {!isUnassignedBucket && unassigned.length > 0 && (
            <View style={{ marginTop: 4 }}>
              <Pressable onPress={() => setShowUnassigned((v) => !v)} style={styles.unassignedBar}>
                <Text style={styles.unassignedText}>Not on a shelf yet ({unassigned.length})</Text>
                <Text style={styles.unassignedText}>{showUnassigned ? '▴' : '▾'}</Text>
              </Pressable>
              {showUnassigned &&
                unassigned.map((b) => (
                  <BasketRow key={b.id} basket={b} name={nameOf(b)} counted={counted.has(b.id)} onOpen={() => selectBasket(b, { adoptLocation: false })} />
                ))}
            </View>
          )}
        </ScrollView>
      )}

      <View style={ui.footer}>
        <Button title={`+ New basket ${isUnassignedBucket ? 'in this fridge' : 'on this shelf'}`} style={{ flex: 1 }} onPress={() => setCreating(true)} />
      </View>
      <PrintLabelSheet request={print} onClose={() => setPrint(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  counted: { borderColor: '#5eead4', backgroundColor: colors.tealTint },
  total: { fontSize: font.lg, fontWeight: '800', color: colors.ink },
  tv: { fontSize: font.xs, color: colors.muted },
  empty: { padding: 20, textAlign: 'center', color: colors.muted, fontSize: font.sm },
  unassignedBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.amberTint,
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
  },
  unassignedText: { fontSize: font.xs, fontWeight: '700', color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5 },
});
