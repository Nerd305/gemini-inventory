/**
 * Voice / typed commands for /count, for the per-tray model: a bin holds trays that are
 * counted one at a time. Adapted from the parser in the retired Expo app
 * (branch archive/expo-iphone-app), which counted "N trays + M loose" per bin.
 *
 *   "22" / "twenty two vials"         → count 22 (the open tray)
 *   "full" / "empty" / "plus 2"       → full · empty · adjust +2
 *   "save" / "ok" / "done"            → save (accept the open tray; finish the bin from the tray grid)
 *   "next"                            → save and open the next uncounted tray (or open it from the grid)
 *   "tray 3" / "tray 3 22 save"       → open tray 3 [, set 22, save]
 *   "loose 12" / "12 loose"           → loose vials on the bin
 *   "all full" / "full bin"           → every tray full, finish the bin
 *   "add tray" / "add 2 trays"        → add tray(s) to the bin
 *   "finish" / "bin done"             → finish the bin
 *   "shelf 3" / "fridge 2 shelf 3"    → same as scanning that shelf label
 *   "bin BPC 157"                     → open the bin whose name or product matches
 *   "back" / "cancel"                 → close the open tray
 *   "help"
 * Commands chain in spoken order: "bin tirz tray 2 twenty three next".
 */

export type VoiceCommand =
  | { kind: 'count'; value: number }
  | { kind: 'adjust'; delta: number }
  | { kind: 'full' }
  | { kind: 'empty' }
  | { kind: 'save' }
  | { kind: 'next' }
  | { kind: 'cancel' }
  | { kind: 'tray'; slot: number }
  | { kind: 'loose'; value: number }
  | { kind: 'allFull' }
  | { kind: 'addTray'; n: number }
  | { kind: 'finish' }
  | { kind: 'shelf'; shelf: number; fridge?: string }
  | { kind: 'fridge'; query: string }
  | { kind: 'bin'; query: string }
  | { kind: 'help' }
  /** "4 trays": trays are counted one by one, so this gets a hint instead of a guess. */
  | { kind: 'trayTotal'; n: number }
  | { kind: 'unknown'; transcript: string };

export const MAX_SPOKEN_COUNT = 999;

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Words speech engines put in place of the ones we listen for. */
const SYNONYMS: Record<string, string> = {
  basket: 'bin', baskets: 'bin', bins: 'bin', ben: 'bin',
  trays: 'tray', trey: 'tray', treys: 'tray', tre: 'tray',
  shelves: 'shelf', shelve: 'shelf',
  vial: 'vials', bottles: 'vials', bottle: 'vials', units: 'vials', pieces: 'vials',
  refrigerator: 'fridge', freezer: 'fridge', cabinet: 'fridge', fridges: 'fridge',
  okay: 'ok',
  singles: 'loose', single: 'loose', extra: 'loose', extras: 'loose',
  fore: 'four', won: 'one',
};

/** "this one", "next one", "that one's full": here "one" is a pronoun, not a count. */
const ONE_AS_WORD_AFTER = new Set(['this', 'that', 'the', 'which', 'each', 'every', 'last', 'next', 'another', 'any', 'no', 'other', 'same', 'first', 'second', 'third']);

/** Replace spoken numbers ("twenty two", "one hundred fifty") with digits. */
export function wordsToDigits(input: string): string {
  const tokens = input.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let prevWord = '';
  let acc: number | null = null;
  let lastWasTens = false;
  const flush = () => {
    if (acc !== null) out.push(String(acc));
    acc = null;
    lastWasTens = false;
  };
  for (const t of tokens) {
    const after = prevWord;
    prevWord = t;
    if ((t === 'one' || t === 'ones') && ONE_AS_WORD_AFTER.has(after)) {
      flush();
      out.push(t);
      continue;
    }
    if (t in TENS) {
      if (acc !== null && acc >= 100 && acc % 100 === 0) acc += TENS[t];
      else {
        flush();
        acc = TENS[t];
      }
      lastWasTens = true;
    } else if (t in ONES) {
      const v = ONES[t];
      if (acc !== null && ((lastWasTens && v < 10) || (acc >= 100 && acc % 100 === 0))) {
        acc += v;
        lastWasTens = false;
      } else {
        flush();
        acc = v;
      }
    } else if (t === 'hundred' && acc !== null && acc < 10) {
      acc *= 100;
      lastWasTens = false;
    } else if (/^\d+$/.test(t)) {
      flush();
      out.push(String(parseInt(t, 10)));
    } else if (t === 'and' && acc !== null && acc >= 100) {
      continue; // "one hundred and fifty"
    } else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out.join(' ');
}

/** Lowercase, strip punctuation, split "22nd"/"#3", map synonyms, spell numbers as digits. */
export function normalizeTranscript(input: string): string[] {
  const cleaned = input
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/[-–—/#]/g, ' ')
    .replace(/[^a-z0-9.' ]+/g, ' ')
    .replace(/'/g, '')
    .replace(/(\D)\.|\.(\D|$)/g, '$1 $2');
  const words = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SYNONYMS[w] ?? w);
  return wordsToDigits(words.join(' ')).split(' ').filter(Boolean);
}

const SAVE_WORDS = new Set(['save', 'saved', 'accept', 'accepted', 'confirm', 'confirmed', 'ok', 'submit', 'enter', 'yes', 'yep', 'correct', 'good', 'done', 'record', 'log']);
const FINISH_WORDS = new Set(['finish', 'finished', 'complete', 'completed']);
const CANCEL_WORDS = new Set(['back', 'cancel', 'close', 'nevermind']);
const EMPTY_WORDS = new Set(['empty', 'none', 'nothing']);
const PLUS_WORDS = new Set(['plus', 'add', 'up']);
const MINUS_WORDS = new Set(['minus', 'less', 'remove', 'subtract', 'down']);
/** Words that end a spoken name ("bin bpc 157 tray 2" → query "bpc 157"). */
const STOP_WORDS = new Set([...SAVE_WORDS, ...FINISH_WORDS, ...CANCEL_WORDS, 'tray', 'shelf', 'next', 'loose', 'full', 'all', 'fridge', 'bin']);

const isNum = (t: string | undefined): t is string => t !== undefined && /^\d+$/.test(t);
const num = (t: string) => Math.min(parseInt(t, 10), MAX_SPOKEN_COUNT);

export function parseVoiceCommands(input: string): VoiceCommand[] {
  const t = normalizeTranscript(input);
  const cmds: VoiceCommand[] = [];
  let i = 0;
  const peek = (k = 0) => t[i + k];

  /** Collect name words until a command word or the end. */
  const takeName = (): string => {
    const words: string[] = [];
    while (i < t.length && !STOP_WORDS.has(t[i])) words.push(t[i++]);
    return words.join(' ');
  };

  while (i < t.length) {
    const w = t[i];

    // "all full", "all trays full", "all full trays", "all of them full"
    if (w === 'all') {
      const window = t.slice(i + 1, i + 5);
      const fullAt = window.indexOf('full');
      if (fullAt >= 0) {
        cmds.push({ kind: 'allFull' });
        i += fullAt + 2;
        if (peek() === 'tray') i++;
        continue;
      }
      i++;
      continue;
    }

    if (w === 'full') {
      if (peek(1) === 'bin') {
        cmds.push({ kind: 'allFull' });
        i += 2;
      } else {
        cmds.push({ kind: 'full' });
        i++;
        if (peek() === 'tray') i++;
      }
      continue;
    }

    // "add tray", "add a tray", "add another tray", "add 2 trays", "new tray"
    if ((w === 'add' || w === 'new' || w === 'another') && (peek(1) === 'tray' || peek(2) === 'tray')) {
      const between = peek(1) === 'tray' ? undefined : peek(1);
      if (peek(1) === 'tray' || between === 'a' || between === 'another' || between === 'one' || isNum(between)) {
        cmds.push({ kind: 'addTray', n: isNum(between) ? Math.max(1, Math.min(num(between), 40)) : 1 });
        i += peek(1) === 'tray' ? 2 : 3;
        continue;
      }
    }

    // "plus 2", "minus 3", "take away 2"
    if (PLUS_WORDS.has(w) && isNum(peek(1))) {
      cmds.push({ kind: 'adjust', delta: num(peek(1)!) });
      i += 2;
      continue;
    }
    if ((MINUS_WORDS.has(w) && isNum(peek(1))) || (w === 'take' && peek(1) === 'away' && isNum(peek(2)))) {
      const n = w === 'take' ? peek(2)! : peek(1)!;
      cmds.push({ kind: 'adjust', delta: -num(n) });
      i += w === 'take' ? 3 : 2;
      continue;
    }

    if (w === 'next') {
      cmds.push({ kind: 'next' });
      i++;
      if (peek() === 'tray' && !isNum(peek(1))) i++;
      if (peek() === 'one') i++;
      continue;
    }

    if (w === 'tray') {
      if (peek(1) === 'number' && isNum(peek(2))) i++;
      if (isNum(peek(1))) {
        cmds.push({ kind: 'tray', slot: num(peek(1)!) });
        i += 2;
        continue;
      }
      i++; // "the tray is full" → filler
      continue;
    }

    if (w === 'loose') {
      let j = i + 1;
      if (t[j] === 'vials') j++;
      if (isNum(t[j])) {
        cmds.push({ kind: 'loose', value: num(t[j]) });
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }

    if (isNum(w)) {
      const n = num(w);
      let j = i + 1;
      if (t[j] === 'vials') j++;
      if (t[j] === 'loose') {
        cmds.push({ kind: 'loose', value: n });
        i = j + 1;
        if (peek() === 'vials') i++;
        continue;
      }
      if (t[i + 1] === 'tray' && j === i + 1) {
        cmds.push({ kind: 'trayTotal', n });
        i += 2;
        continue;
      }
      cmds.push({ kind: 'count', value: n });
      i = j;
      continue;
    }

    if (EMPTY_WORDS.has(w)) {
      cmds.push({ kind: 'empty' });
      i++;
      continue;
    }

    if (w === 'shelf' || (w === 'self' && isNum(peek(1)))) {
      if (isNum(peek(1))) {
        cmds.push({ kind: 'shelf', shelf: num(peek(1)!) });
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (w === 'fridge') {
      i++;
      const query = takeName();
      if ((peek() === 'shelf' || peek() === 'self') && isNum(peek(1))) {
        cmds.push({ kind: 'shelf', shelf: num(peek(1)!), fridge: query || undefined });
        i += 2;
      } else if (query) {
        cmds.push({ kind: 'fridge', query });
      }
      continue;
    }

    if (w === 'bin') {
      i++;
      if (peek() === 'full') {
        cmds.push({ kind: 'allFull' });
        i++;
        continue;
      }
      if (peek() !== undefined && (FINISH_WORDS.has(peek()!) || peek() === 'done')) {
        cmds.push({ kind: 'finish' });
        i++;
        continue;
      }
      const query = takeName();
      if (query) cmds.push({ kind: 'bin', query });
      continue;
    }

    if (FINISH_WORDS.has(w)) {
      cmds.push({ kind: 'finish' });
      i++;
      if (peek() === 'bin') i++;
      continue;
    }
    if (SAVE_WORDS.has(w)) {
      cmds.push({ kind: 'save' });
      i++;
      continue;
    }
    if (CANCEL_WORDS.has(w) || (w === 'go' && peek(1) === 'back') || (w === 'never' && peek(1) === 'mind')) {
      cmds.push({ kind: 'cancel' });
      i += w === 'go' || w === 'never' ? 2 : 1;
      continue;
    }
    if (w === 'help' || w === 'commands' || (w === 'what' && t.slice(i + 1, i + 3).join(' ') === 'can i')) {
      cmds.push({ kind: 'help' });
      break;
    }

    i++; // filler word
  }

  // Collapse repeats a recogniser can produce ("save save").
  const deduped = cmds.filter((c, k) => k === 0 || JSON.stringify(c) !== JSON.stringify(cmds[k - 1]) || c.kind === 'adjust');
  return deduped.length > 0 ? deduped : [{ kind: 'unknown', transcript: input.trim() }];
}

/** Commands that act on the whole session rather than on the open bin or tray. */
export function isSessionCommand(c: VoiceCommand): boolean {
  return c.kind === 'shelf' || c.kind === 'fridge' || c.kind === 'bin' || c.kind === 'help';
}

export interface NamedItem {
  id: string;
  name: string;
}

function tokens(s: string): string[] {
  return normalizeTranscript(s);
}

/**
 * Score items against a spoken name. Returns the best match, or the tied candidates when
 * two or more score the same (so the caller can ask which one).
 */
export function matchByName<T extends NamedItem>(
  query: string,
  items: T[],
  bonus?: (item: T) => number,
): { match: T | null; ties: T[] } {
  const q = tokens(query);
  if (q.length === 0 || items.length === 0) return { match: null, ties: [] };
  const qJoined = q.join(' ');
  const scored = items
    .map((item) => {
      const n = tokens(item.name);
      const nJoined = n.join(' ');
      let score = 0;
      if (nJoined === qJoined) score += 100;
      else if (nJoined.includes(qJoined)) score += 25;
      for (const w of q) {
        if (n.includes(w)) score += /^\d+$/.test(w) ? 12 : 8;
        else if (w.length >= 3 && n.some((nw) => nw.startsWith(w) || w.startsWith(nw) && nw.length >= 3)) score += 3;
      }
      if (score > 0 && bonus) score += bonus(item);
      return { item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { match: null, ties: [] };
  const top = scored.filter((s) => s.score === scored[0].score).map((s) => s.item);
  return top.length === 1 ? { match: top[0], ties: [] } : { match: null, ties: top };
}

const intIn = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
};
const shortText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : null);

/**
 * Validate commands that came from Gemini: unknown kinds and out-of-range numbers are dropped,
 * so a model reply can never do anything the spoken parser couldn't.
 */
export function coerceVoiceCommands(raw: unknown): VoiceCommand[] {
  if (!Array.isArray(raw)) return [];
  const out: VoiceCommand[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    switch (c.kind) {
      case 'count': {
        const value = intIn(c.value, 0, MAX_SPOKEN_COUNT);
        if (value !== null) out.push({ kind: 'count', value });
        break;
      }
      case 'adjust': {
        const delta = intIn(c.delta, -MAX_SPOKEN_COUNT, MAX_SPOKEN_COUNT);
        if (delta) out.push({ kind: 'adjust', delta });
        break;
      }
      case 'loose': {
        const value = intIn(c.value, 0, MAX_SPOKEN_COUNT);
        if (value !== null) out.push({ kind: 'loose', value });
        break;
      }
      case 'tray': {
        const slot = intIn(c.slot, 1, 40);
        if (slot !== null) out.push({ kind: 'tray', slot });
        break;
      }
      case 'addTray':
        out.push({ kind: 'addTray', n: intIn(c.n, 1, 40) ?? 1 });
        break;
      case 'shelf': {
        const shelf = intIn(c.shelf, 1, 99);
        const fridge = shortText(c.fridge);
        if (shelf !== null) out.push(fridge ? { kind: 'shelf', shelf, fridge } : { kind: 'shelf', shelf });
        break;
      }
      case 'bin': {
        const query = shortText(c.query);
        if (query) out.push({ kind: 'bin', query });
        break;
      }
      case 'full':
      case 'empty':
      case 'save':
      case 'next':
      case 'cancel':
      case 'allFull':
      case 'finish':
      case 'help':
        out.push({ kind: c.kind });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Commands that save or change the bin's tray list. */
const COMMIT_KINDS = new Set<VoiceCommand['kind']>(['save', 'next', 'finish', 'allFull', 'addTray']);
const COMMIT_WORDS =
  /\b(save|saved|accept|accepted|confirm|confirmed|ok|okay|done|next|finish|finished|complete|completed|all|full|add|added|another|new|submit|enter|yes|yep|good|correct|record|log|lock|move on|go on)\b/i;

/**
 * Belt and braces for Gemini output: drop saving commands unless the words actually contain
 * something like "save", "next" or "done", so a misheard sentence only fills in a number.
 */
export function guardAiCommands(cmds: VoiceCommand[], transcript: string): VoiceCommand[] {
  if (COMMIT_WORDS.test(transcript)) return cmds;
  return cmds.filter((c) => !COMMIT_KINDS.has(c.kind));
}

export const VOICE_HELP =
  'Say a number for the open tray, "full", "empty", "plus 2", then "save" or "next". ' +
  'From the tray grid: "tray 3", "tray 3 22 save", "loose 12", "all full", "add tray", "finish". ' +
  'Anywhere: "shelf 2", "fridge 1 shelf 2", "bin tirzepatide".';
