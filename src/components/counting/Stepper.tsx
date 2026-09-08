import { Minus, Plus } from 'lucide-react';

interface StepperProps {
  label: string;
  hint?: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Extra coarse step shown as outer buttons (e.g. 5). */
  bigStep?: number;
  accent?: 'teal' | 'amber';
}

/**
 * Thumb-friendly counter: [-big] [-1] [ value ] [+1] [+big].
 * The value is also directly editable (numeric keypad on iPhone).
 */
export default function Stepper({ label, hint, value, onChange, min = 0, max = 9999, bigStep, accent = 'teal' }: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.floor(Number.isFinite(n) ? n : min)));
  const set = (n: number) => onChange(clamp(n));
  const ring = accent === 'teal' ? 'focus:ring-teal-500' : 'focus:ring-amber-500';
  const btn =
    'h-12 min-w-12 px-2 rounded-lg border border-gray-300 bg-white text-gray-900 text-base font-semibold active:bg-gray-100 active:scale-95 transition-transform select-none touch-manipulation disabled:opacity-40';

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-600">{label}</span>
        {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        {bigStep && (
          <button type="button" className={btn} onClick={() => set(value - bigStep)} disabled={value <= min} aria-label={`minus ${bigStep}`}>
            −{bigStep}
          </button>
        )}
        <button type="button" className={btn} onClick={() => set(value - 1)} disabled={value <= min} aria-label="minus 1">
          <Minus className="h-5 w-5" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => set(parseInt(e.target.value, 10) || 0)}
          className={`h-12 flex-1 min-w-0 rounded-lg border border-gray-300 text-center text-2xl font-bold tabular-nums focus:outline-none focus:ring-2 ${ring}`}
        />
        <button type="button" className={btn} onClick={() => set(value + 1)} disabled={value >= max} aria-label="plus 1">
          <Plus className="h-5 w-5" />
        </button>
        {bigStep && (
          <button type="button" className={btn} onClick={() => set(value + bigStep)} disabled={value >= max} aria-label={`plus ${bigStep}`}>
            +{bigStep}
          </button>
        )}
      </div>
    </div>
  );
}
