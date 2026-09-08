import React from 'react';
import { View } from 'react-native';
import { useCountingSession } from '../hooks/useCountingSession';
import FridgePicker from './panels/FridgePicker';
import ShelfPicker from './panels/ShelfPicker';
import ShelfBaskets from './panels/ShelfBaskets';
import QuickCount from './panels/QuickCount';
import { colors } from '../theme';

/** fridge → shelf → baskets → quick count; every level reachable by scan, tap, or voice. */
export default function BottomPanel() {
  const { fridge, shelfNumber, activeBasketId } = useCountingSession();
  let content: React.ReactNode;
  if (activeBasketId) content = <QuickCount key={activeBasketId} basketId={activeBasketId} />;
  else if (fridge && shelfNumber !== null) content = <ShelfBaskets key={`${fridge.id}/${shelfNumber}`} />;
  else if (fridge) content = <ShelfPicker key={fridge.id} />;
  else content = <FridgePicker />;
  return <View style={{ flex: 1, backgroundColor: colors.white }}>{content}</View>;
}
