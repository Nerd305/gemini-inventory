import type { ReactNode } from 'react';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import FridgePicker from './FridgePicker';
import ShelfPicker from './ShelfPicker';
import ShelfBaskets from './ShelfBaskets';
import QuickCount from './QuickCount';

/**
 * Routes the lower panel by how deep the user is:
 *   nothing → pick a fridge · fridge → pick a shelf · shelf → baskets on it · basket → quick count
 * Every level can be reached by scanning a label OR by tapping.
 */
export default function BottomPanel() {
  const { fridge, shelfNumber, activeBasketId } = useCountingSession();

  let content: ReactNode;
  if (activeBasketId) {
    content = <QuickCount key={activeBasketId} basketId={activeBasketId} />;
  } else if (fridge && shelfNumber !== null) {
    content = <ShelfBaskets key={`${fridge.id}/${shelfNumber}`} />;
  } else if (fridge) {
    content = <ShelfPicker key={fridge.id} />;
  } else {
    content = <FridgePicker />;
  }

  return (
    <div className="h-full w-full bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] overflow-hidden">
      {content}
    </div>
  );
}
