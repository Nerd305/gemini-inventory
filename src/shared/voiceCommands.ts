/**
 * Voice / typed command parsing shared by the web and Expo apps.
 *
 *   "4 trays and 22 vials"        → count { trays: 4, loose: 22 }
 *   "twenty two loose"            → count { loose: 22 }
 *   "six full trays save"         → count { trays: 6 }, save
 *   "empty" / "full basket"       → empty / full
 *   "shelf 3"                     → shelf 3
 *   "fridge 2" / "fridge peptides"→ fridge "2" / fridge "peptides"
 *   "basket bpc 157"              → basket "bpc 157"
 *   "save" / "done" / "next"      → save · "back" / "cancel" → back
 * A sentence can chain commands: "fridge 2 shelf 3".
 */
export type VoiceCommand =
  | { kind: 'count'; trays?: number; loose?: number }
  | { kind: 'empty' }
  | { kind: 'full' }
  | { kind: 'save' }
  | { kind: 'back' }
  | { kind: 'shelf'; shelfNumber: number }
  | { kind: 'fridge'; query: string }
  | { kind: 'basket'; query: string }
  | { kind: 'unknown'; transcript: string };

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, a: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Replace spoken numbers ("twenty two", "one hundred fifty") with digits. */
export function wordsToDigits(input: string): string {
  const tokens = input.toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let acc: number | null = null;
  let lastWasTens = false;
  const flush = () => {
    if (acc !== null) out.push(String(acc));
    acc = null;
    lastWasTens = false;
  };
  for (const t of tokens) {
    if (t in TENS) {
      if (acc !== null && !lastWasTens && acc >= 100) acc += TENS[t];
      else {
        flush();
        acc = TENS[t];
      }
      lastWasTens = true;
    } else if (t in ONES && !(t === 'a' || t === 'to' || t === 'too' || t === 'for' || t === 'oh')) {
      const v = ONES[t];
      if (acc !== null && (lastWasTens || acc >= 100)) {
        acc += v;
        lastWasTens = false;
      } else {
        flush();
        acc = v;
      }
    } else if (t === 'a' && acc === null) {
      // "a tray" → 1 tray, but only when followed by a unit; leave the token, the unit regex accepts "a"
      out.push(t);
    } else if (t === 'hundred') {
      acc = (acc ?? 1) * 100;
      lastWasTens = false;
    } else if (/^\d+$/.test(t)) {
      flush();
      acc = parseInt(t, 10);
      flush();
    } else if (t === 'and' && acc !== null && acc >= 100) {
      // "one hundred and fifty"
      continue;
    } else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out.join(' ');
}

const TRAY_RE = /\b(\d+|a|an)\s+(?:full\s+)?trays?\b/;
const LOOSE_RE = /\b(\d+|a|an)\s+(?:loose\s+|single\s+|extra\s+)?(?:vials?|loose|singles?|units?|pieces?)\b/;
const SHELF_RE = /\bshel(?:f|ves)\s+(\d+)\b/;
const FRIDGE_RE = /\b(?:fridge|refrigerator|freezer|cabinet)\s+(.+?)(?=\s+shel(?:f|ves)\b|\s+basket\b|$)/;
const BASKET_RE = /\b(?:basket|bin|lot)\s+(.+?)(?=\s+shel(?:f|ves)\b|\s+(?:fridge|refrigerator)\b|$)/;

function num(s: string): number {
  if (s === 'a' || s === 'an') return 1;
  return parseInt(s, 10);
}

export function parseVoiceCommands(input: string): VoiceCommand[] {
  const text = wordsToDigits(input).trim();
  if (!text) return [];
  const cmds: VoiceCommand[] = [];

  const fridge = FRIDGE_RE.exec(text);
  if (fridge) cmds.push({ kind: 'fridge', query: fridge[1].trim() });

  const shelf = SHELF_RE.exec(text);
  if (shelf) cmds.push({ kind: 'shelf', shelfNumber: num(shelf[1]) });

  const basket = BASKET_RE.exec(text);
  if (basket && !/^\d+$/.test(basket[1].trim())) cmds.push({ kind: 'basket', query: basket[1].trim() });

  if (/\b(empty|nothing|zero vials?)\b/.test(text) && !TRAY_RE.test(text) && !LOOSE_RE.test(text)) {
    cmds.push({ kind: 'empty' });
  } else if (/\bfull\s+(basket|bin)\b/.test(text) || /^\s*full\s*$/.test(text)) {
    cmds.push({ kind: 'full' });
  } else {
    const trays = TRAY_RE.exec(text);
    const loose = LOOSE_RE.exec(text);
    let count: { trays?: number; loose?: number } | null = null;
    if (trays) count = { trays: num(trays[1]) };
    if (loose) count = { ...(count ?? {}), loose: num(loose[1]) };
    if (trays && !loose) {
      // "4 trays and 22" — trailing bare number is the loose count
      const tail = new RegExp(`${trays[0]}\\s+(?:and|plus|\\+)\\s+(\\d+)\\b`).exec(text);
      if (tail) count = { ...(count ?? {}), loose: parseInt(tail[1], 10) };
    }
    if (count) cmds.push({ kind: 'count', ...count });
  }

  if (/\b(save|done|accept|confirm|next|submit|lock it in|lock in)\b/.test(text)) cmds.push({ kind: 'save' });
  if (/\b(go back|back|cancel|undo)\b/.test(text) && cmds.length === 0) cmds.push({ kind: 'back' });

  if (cmds.length === 0) cmds.push({ kind: 'unknown', transcript: input.trim() });
  return cmds;
}

export interface NamedItem {
  id: string;
  name: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Fuzzy pick of an item by spoken name. Exact "fridge 2" style numbers win,
 * then word overlap; returns null when nothing matches at all.
 */
export function matchByName<T extends NamedItem>(query: string, items: T[]): T | null {
  const q = normalize(wordsToDigits(query));
  if (!q || items.length === 0) return null;
  const qWords = q.split(' ');
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const n = normalize(item.name);
    const nWords = n.split(' ');
    let score = 0;
    if (n === q) score += 100;
    if (n.includes(q)) score += 20;
    for (const w of qWords) {
      if (!w) continue;
      if (nWords.includes(w)) score += /^\d+$/.test(w) ? 10 : 5;
      else if (nWords.some((nw) => nw.startsWith(w) && w.length >= 3)) score += 2;
    }
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}
