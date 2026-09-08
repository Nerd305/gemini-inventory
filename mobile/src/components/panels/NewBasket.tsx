import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useCountingSession } from '../../hooks/useCountingSession';
import { createBasket, createQuickProduct, DEFAULT_VIALS_PER_TRAY, SLOT_POSITIONS, type BasketRecord } from '../../core';
import { useProducts } from '../../hooks/useProducts';
import { colors, font, radius } from '../../theme';
import Stepper from '../Stepper';
import { Button, Chip, ui } from '../ui';

interface Props {
  onClose: () => void;
  onCreated: (basket: BasketRecord, print: boolean) => void;
}

export default function NewBasket({ onClose, onCreated }: Props) {
  const { user } = useAuth();
  const { fridge, shelfNumber, shelfId, sessionId } = useCountingSession();
  const { products } = useProducts();

  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState<string | null>(null);
  const [lot, setLot] = useState('');
  const [position, setPosition] = useState<number | null>(null);
  const [trays, setTrays] = useState(0);
  const [loose, setLoose] = useState(0);
  const [vpt, setVpt] = useState(DEFAULT_VIALS_PER_TRAY);
  const [saving, setSaving] = useState<null | 'save' | 'print'>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products).slice(0, 8);
  }, [products, search]);
  const exact = useMemo(() => products.some((p) => p.name.trim().toLowerCase() === search.trim().toLowerCase()), [products, search]);

  const quickCreate = async () => {
    setCreatingProduct(true);
    setError(null);
    try {
      setProductId(await createQuickProduct(search));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create product');
    } finally {
      setCreatingProduct(false);
    }
  };

  const save = async (print: boolean) => {
    if (!user || !fridge || !selected) return;
    setSaving(print ? 'print' : 'save');
    setError(null);
    try {
      const basket = await createBasket({
        productId: selected.id,
        productName: selected.name,
        locationId: fridge.id,
        shelfId: shelfNumber !== null && shelfNumber > 0 ? shelfId : null,
        shelfPosition: position,
        lotNumber: lot,
        trayCount: trays,
        looseVials: loose,
        vialsPerTray: vpt,
        userId: user.uid,
        sessionId,
      });
      onCreated(basket, print);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create basket');
      setSaving(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={[ui.panelHeader, { flexDirection: 'row', alignItems: 'center' }]}>
        <View style={{ flex: 1 }}>
          <Text style={ui.kicker}>New basket</Text>
          <Text style={ui.sub} numberOfLines={1}>{fridge ? `${fridge.name}${shelfNumber ? ` · Shelf ${shelfNumber}` : ''}` : ''}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={{ fontSize: 22, color: colors.muted }}>✕</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, gap: 12 }} keyboardShouldPersistTaps="handled">
        {selected ? (
          <View style={styles.selected}>
            <Text style={{ flex: 1, fontWeight: '700', color: colors.ink }} numberOfLines={1}>✓ {selected.name}</Text>
            <Pressable onPress={() => setProductId(null)}>
              <Text style={{ color: colors.tealDark, textDecorationLine: 'underline', fontSize: font.xs }}>change</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <TextInput
              autoFocus
              value={search}
              onChangeText={setSearch}
              placeholder="Search product (e.g. BPC-157)"
              style={ui.input}
              autoCorrect={false}
            />
            <View style={styles.list}>
              {matches.map((p) => (
                <Pressable key={p.id} onPress={() => setProductId(p.id)} style={styles.listItem}>
                  <Text style={{ color: colors.ink, fontWeight: '600' }}>{p.name}</Text>
                  {p.category ? <Text style={{ color: colors.faint, fontSize: font.xs }}> {p.category}</Text> : null}
                </Pressable>
              ))}
              {search.trim() && !exact ? (
                <Pressable onPress={quickCreate} disabled={creatingProduct} style={[styles.listItem, { backgroundColor: colors.tealTint }]}>
                  <Text style={{ color: colors.tealDark, fontWeight: '600' }}>{creatingProduct ? 'Creating…' : `+ Create product “${search.trim()}”`}</Text>
                </Pressable>
              ) : null}
              {!search.trim() && matches.length === 0 ? <Text style={[styles.listItem, { color: colors.muted }]}>No products yet — type a name to create one.</Text> : null}
            </View>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 8 }}>
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

        <Stepper label="Full trays" hint={`× ${vpt} vials`} value={trays} onChange={setTrays} max={99} />
        <Stepper label="Loose vials" hint="partial tray" value={loose} onChange={setLoose} bigStep={5} max={999} accent="amber" />

        <View>
          <Text style={styles.fieldLabel}>Slot on shelf (optional)</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {SLOT_POSITIONS.map((s) => (
              <Chip key={s.value} label={s.short} active={position === s.value} onPress={() => setPosition(position === s.value ? null : s.value)} />
            ))}
          </View>
        </View>

        {error ? <Text style={ui.error}>{error}</Text> : null}
      </ScrollView>

      <View style={ui.footer}>
        <View>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>{trays * vpt + loose}</Text>
          <Text style={{ fontSize: font.xs, color: colors.muted }}>vials</Text>
        </View>
        <Button title="Save" variant="outline" style={{ flex: 1 }} onPress={() => save(false)} disabled={!selected || saving !== null} loading={saving === 'save'} />
        <Button title="Save & print" style={{ flex: 1 }} onPress={() => save(true)} disabled={!selected || saving !== null} loading={saving === 'print'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  selected: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#5eead4', backgroundColor: colors.tealTint, borderRadius: radius.md, padding: 10 },
  list: { marginTop: 6, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden' },
  listItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', flexDirection: 'row', alignItems: 'baseline' },
  fieldLabel: { fontSize: font.xs, color: colors.muted, marginBottom: 4 },
});
