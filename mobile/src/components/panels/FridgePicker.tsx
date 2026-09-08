import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCountingSession } from '../../hooks/useCountingSession';
import { subscribeAllBaskets, subscribeLocations, type BasketRecord, type FridgeLocation } from '../../core';
import { colors, font } from '../../theme';
import { Spinner, ui } from '../ui';

export default function FridgePicker() {
  const { selectFridge, countedBasketIds } = useCountingSession();
  const [locations, setLocations] = useState<FridgeLocation[] | null>(null);
  const [baskets, setBaskets] = useState<BasketRecord[]>([]);

  useEffect(() => subscribeLocations(setLocations, (e) => console.error('locations', e)), []);
  useEffect(() => subscribeAllBaskets(setBaskets, (e) => console.error('baskets', e)), []);

  const stats = useMemo(() => {
    const counted = new Set(countedBasketIds);
    const out: Record<string, { total: number; counted: number }> = {};
    for (const b of baskets) {
      const s = (out[b.locationId] ??= { total: 0, counted: 0 });
      s.total += 1;
      if (counted.has(b.id)) s.counted += 1;
    }
    return out;
  }, [baskets, countedBasketIds]);

  return (
    <View style={{ flex: 1 }}>
      <View style={ui.panelHeader}>
        <Text style={ui.kicker}>Where are you counting?</Text>
        <Text style={ui.sub}>Scan the fridge label, say "fridge 2", or tap a fridge.</Text>
      </View>
      {locations === null ? (
        <Spinner />
      ) : locations.length === 0 ? (
        <Text style={styles.empty}>No fridges yet. Add them on the Locations page of the web app.</Text>
      ) : (
        <FlatList
          data={locations}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const s = stats[item.id];
            return (
              <Pressable onPress={() => selectFridge(item)} style={({ pressed }) => [ui.row, pressed && styles.pressed]}>
                <View style={styles.icon}>
                  <Text style={{ fontSize: 20 }}>{item.type === 'cabinet' ? '🗄️' : '🧊'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ui.rowTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={ui.rowSub}>
                    {item.shelfCount} shelves{s ? ` · ${s.total} baskets` : ' · no baskets yet'}
                    {s && s.counted > 0 ? ` · ${s.counted} counted` : ''}
                  </Text>
                </View>
                <Text style={styles.chev}>›</Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { padding: 24, textAlign: 'center', color: colors.muted, fontSize: font.sm },
  pressed: { backgroundColor: colors.tealTint, borderColor: colors.teal },
  icon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  chev: { fontSize: 24, color: colors.faint, marginRight: 4 },
});
