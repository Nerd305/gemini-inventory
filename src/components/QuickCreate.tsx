import { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { handleFirestoreError, OperationType } from '../firebase';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { createLocation, createProduct } from '../lib/inventory';

/**
 * Small inline forms behind the "+ New fridge…" / "+ New product…" options, so a missing
 * fridge or product can be added without leaving the form (or the count) you are in.
 */

const boxClass = 'rounded-md border border-teal-200 bg-teal-50/60 p-3 space-y-2';
const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export const NEW_OPTION_VALUE = '__new__';

function Header({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-bold uppercase tracking-wide text-teal-800">{title}</p>
      <button type="button" onClick={onCancel} className="text-gray-500 hover:text-gray-800" aria-label="Cancel">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function QuickCreateFridge({
  onCreated,
  onCancel,
  fixedId,
  defaultShelfCount = 5,
  title = 'New fridge',
}: {
  onCreated: (id: string, name: string) => void;
  onCancel: () => void;
  /** Reuse this document ID (fridge part of a scanned shelf label). */
  fixedId?: string;
  defaultShelfCount?: number;
  title?: string;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'fridge' | 'cabinet'>('fridge');
  const [shelfCount, setShelfCount] = useState(defaultShelfCount);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not a <form>: these sit inside other forms (the Add Bin dialog), and nested forms submit the outer one.
  const save = async () => {
    if (!name.trim()) {
      setError('Give it a name, e.g. "Fridge 1" or "Peptide fridge".');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = await createLocation({ name, type, shelfCount, id: fixedId });
      onCreated(id, name.trim());
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'locations');
      setError(err instanceof Error ? err.message : 'Could not add the fridge.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={boxClass}>
      <Header title={title} onCancel={onCancel} />
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="Name, e.g. Fridge 1"
        aria-label="Fridge name"
      />
      <div className="grid grid-cols-2 gap-2">
        <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as 'fridge' | 'cabinet')} aria-label="Type">
          <option value="fridge">Refrigerator</option>
          <option value="cabinet">Cabinet</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={30}
            value={shelfCount}
            onChange={(e) => setShelfCount(Math.max(0, Math.min(30, parseInt(e.target.value, 10) || 0)))}
            className="w-16"
            aria-label="Number of shelves"
          />
          shelves
        </label>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
          Add fridge
        </Button>
      </div>
      <p className="text-[11px] text-gray-500">Print its shelf labels later from Locations.</p>
    </div>
  );
}

export function QuickCreateProduct({
  onCreated,
  onCancel,
  categories = [],
}: {
  onCreated: (id: string, name: string) => void;
  onCancel: () => void;
  /** Existing categories, offered as suggestions. */
  categories?: string[];
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = 'quick-product-categories';

  const save = async () => {
    if (!name.trim()) {
      setError('Give the product a name, e.g. "Tirzepatide 40 mg/mL 5 mL".');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = await createProduct({ name, category });
      onCreated(id, name.trim());
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'products');
      setError(err instanceof Error ? err.message : 'Could not add the product.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={boxClass}>
      <Header title="New product" onCancel={onCancel} />
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="Product name and strength"
        aria-label="Product name"
      />
      <Input
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="Category (optional)"
        aria-label="Category"
        list={listId}
      />
      <datalist id={listId}>
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
          Add product
        </Button>
      </div>
      <p className="text-[11px] text-gray-500">Reorder point and description can be filled in later under Items.</p>
    </div>
  );
}
