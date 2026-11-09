import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useCountingSession } from './CountingSessionContext';
import { useLocations } from '../hooks/useLocations';
import { clampInt, describeShelf, parseShelfId, type BasketDoc } from '../lib/inventory';
import {
  coerceVoiceCommands,
  guardAiCommands,
  isSessionCommand,
  matchByName,
  parseVoiceCommands,
  VOICE_HELP,
  type VoiceCommand,
} from '../lib/voiceCommands';
import { interpretCountVoice } from '../lib/ai';
import { clipForGemini } from '../lib/audioClip';

/**
 * Routes spoken / typed commands in /count.
 *
 * Session-wide commands ("shelf 3", "fridge 2 shelf 3", "bin tirz", "help") are handled here,
 * the same way a scan is. Everything else goes to the panel that is open (tray grid or tray
 * counter), which registers a handler with useVoiceHandler. When a command opens another panel
 * ("bin tirz tray 3 22 save"), the rest of the sentence waits and is handed to that panel as
 * soon as it mounts.
 *
 * Gemini steps in twice: for sentences the local parser can't read ("this one's got about
 * twenty, no, twenty-one"), and for recorded clips when the browser has no speech recognition.
 * Its commands are validated (coerceVoiceCommands) and can't save anything unless a word like
 * "save", "next" or "done" was actually said (guardAiCommands).
 */

export interface VoiceResult {
  message: string;
  ok?: boolean;
  /** The handler opened another panel; these commands go to it once it registers. */
  forward?: VoiceCommand[];
}
export type VoiceHandler = (cmds: VoiceCommand[]) => VoiceResult | Promise<VoiceResult>;

export interface VoiceStatus {
  heard: string;
  messages: string[];
  ok: boolean;
  pending: boolean;
  /** Gemini interpreted (or transcribed) this one. */
  viaAi: boolean;
  at: number;
}

interface VoiceContextValue {
  status: VoiceStatus | null;
  busy: boolean;
  run: (alternatives: string[]) => Promise<void>;
  /** A recorded clip for Gemini to transcribe and interpret. */
  runAudio: (clip: Blob) => Promise<void>;
  register: (handler: React.MutableRefObject<VoiceHandler>) => () => void;
  dismiss: () => void;
}

const VoiceCommandContext = createContext<VoiceContextValue | null>(null);

export function useVoiceCommands() {
  return useContext(VoiceCommandContext);
}

/** Register the open panel's handler. No-op outside /count. */
export function useVoiceHandler(handler: VoiceHandler) {
  const ctx = useContext(VoiceCommandContext);
  const ref = useRef(handler);
  ref.current = handler;
  const register = ctx?.register;
  useEffect(() => (register ? register(ref) : undefined), [register]);
}

const PENDING_TTL_MS = 8000;
const BIN_CACHE_MS = 30_000;

interface BinCandidate {
  id: string;
  name: string;
  shelfId?: string;
  locationId?: string;
}

export function VoiceCommandProvider({ children }: { children: React.ReactNode }) {
  const { handleScan, activeShelfId, activeBasketId } = useCountingSession();
  const { locations, byId } = useLocations();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const handlersRef = useRef<React.MutableRefObject<VoiceHandler>[]>([]);
  /** Rest of a sentence waiting for the next panel; `from` is the handler that was on top when it was queued. */
  const pendingRef = useRef<{ cmds: VoiceCommand[]; at: number; from: React.MutableRefObject<VoiceHandler> | undefined } | null>(null);
  const deliverRef = useRef<() => void>(() => {});
  const fridgeRef = useRef<string | null>(null);
  const binsCacheRef = useRef<{ at: number; bins: BinCandidate[] } | null>(null);

  // Latest values for the async pipeline.
  const liveRef = useRef({ handleScan, activeShelfId, activeBasketId, locations, byId });
  liveRef.current = { handleScan, activeShelfId, activeBasketId, locations, byId };

  const loadBins = useCallback(async (): Promise<BinCandidate[]> => {
    const cached = binsCacheRef.current;
    if (cached && Date.now() - cached.at < BIN_CACHE_MS) return cached.bins;
    const [binSnap, productSnap] = await Promise.all([getDocs(collection(db, 'baskets')), getDocs(collection(db, 'products'))]);
    const productNames: Record<string, string> = {};
    productSnap.forEach((d) => {
      productNames[d.id] = String((d.data() as { name?: string }).name ?? '');
    });
    const bins: BinCandidate[] = [];
    binSnap.forEach((d) => {
      const b = d.data() as Partial<BasketDoc>;
      const product = b.productId ? productNames[b.productId] ?? '' : '';
      const name = [b.name, product && product !== b.name ? product : null].filter(Boolean).join(' ');
      bins.push({ id: d.id, name: name || d.id, shelfId: b.shelfId, locationId: b.locationId });
    });
    binsCacheRef.current = { at: Date.now(), bins };
    return bins;
  }, []);

  /** Session-wide commands. `navigated` = a different panel will open, so hand the rest over. */
  const handleSession = useCallback(
    async (c: VoiceCommand): Promise<VoiceResult & { navigated?: boolean }> => {
      const live = liveRef.current;
      switch (c.kind) {
        case 'help':
          return { message: VOICE_HELP };
        case 'fridge': {
          const { match, ties } = matchByName(c.query, live.locations);
          if (!match) {
            return {
              ok: false,
              message: ties.length
                ? `Which fridge: ${ties.map((t) => t.name).join(' or ')}?`
                : `No fridge called "${c.query}". Fridges: ${live.locations.map((l) => l.name).join(', ') || 'none yet'}.`,
            };
          }
          fridgeRef.current = match.id;
          return { message: `${match.name}. Now say the shelf, e.g. "shelf 2".` };
        }
        case 'shelf': {
          let locationId: string | null = null;
          if (c.fridge) {
            const { match, ties } = matchByName(c.fridge, live.locations);
            if (!match) {
              return {
                ok: false,
                message: ties.length ? `Which fridge: ${ties.map((t) => t.name).join(' or ')}?` : `No fridge called "${c.fridge}".`,
              };
            }
            locationId = match.id;
            fridgeRef.current = match.id;
          } else {
            locationId =
              fridgeRef.current ??
              parseShelfId(live.activeShelfId)?.locationId ??
              (live.locations.length === 1 ? live.locations[0].id : null);
          }
          if (!locationId) {
            return { ok: false, message: 'Which fridge? Say "fridge <name> shelf 2", or scan a shelf label first.' };
          }
          const shelves = clampInt(live.byId[locationId]?.shelfCount);
          if (shelves > 0 && c.shelf > shelves) {
            return { ok: false, message: `${live.byId[locationId]?.name ?? 'That fridge'} has ${shelves} shelves.` };
          }
          const shelfId = `${locationId}-${c.shelf}`;
          live.handleScan(`SHELF:${shelfId}`);
          return { message: `${describeShelf(shelfId, (id) => live.byId[id]?.name)}.` };
        }
        case 'bin': {
          let bins: BinCandidate[];
          try {
            bins = await loadBins();
          } catch {
            return { ok: false, message: 'Could not load the bin list. Scan the bin label instead.' };
          }
          const shelfLocation = parseShelfId(live.activeShelfId)?.locationId;
          const { match, ties } = matchByName(c.query, bins, (b) =>
            (live.activeShelfId && b.shelfId === live.activeShelfId ? 6 : 0) + (shelfLocation && b.locationId === shelfLocation ? 2 : 0),
          );
          if (!match) {
            return {
              ok: false,
              message: ties.length
                ? `Which bin: ${ties.slice(0, 3).map((t) => t.name).join(' / ')}? Say more of the name.`
                : `No bin matches "${c.query}".`,
            };
          }
          if (match.id === live.activeBasketId) return { message: `${match.name} is already open.` };
          live.handleScan(`BSKT:${match.id}`);
          return { message: `Opening ${match.name}.`, navigated: true };
        }
        default:
          return { ok: false, message: '' };
      }
    },
    [loadBins],
  );

  const process = useCallback(
    async (cmds: VoiceCommand[]): Promise<{ messages: string[]; ok: boolean; pending: boolean }> => {
      const messages: string[] = [];
      let ok = true;
      let pending = false;
      let i = 0;
      while (i < cmds.length) {
        const c = cmds[i];
        if (c.kind === 'unknown') {
          messages.push(`Didn't catch a command in "${c.transcript}". Say "help" for examples.`);
          ok = false;
          i++;
          continue;
        }
        if (isSessionCommand(c)) {
          const r = await handleSession(c);
          if (r.message) messages.push(r.message);
          ok = ok && r.ok !== false;
          i++;
          if (r.navigated) {
            if (i < cmds.length) {
              pendingRef.current = { cmds: cmds.slice(i), at: Date.now(), from: handlersRef.current[handlersRef.current.length - 1] };
              pending = true;
              deliverRef.current();
            }
            break;
          }
          if (r.ok === false) break;
          continue;
        }
        let j = i;
        while (j < cmds.length && !isSessionCommand(cmds[j]) && cmds[j].kind !== 'unknown') j++;
        const local = cmds.slice(i, j);
        const top = handlersRef.current[handlersRef.current.length - 1];
        if (!top) {
          messages.push('Open a bin first: scan its label or say "bin <name>".');
          ok = false;
          i = j;
          continue;
        }
        const r = await top.current(local);
        if (r.message) messages.push(r.message);
        ok = ok && r.ok !== false;
        if (r.forward) {
          const rest = [...r.forward, ...cmds.slice(j)];
          if (rest.length > 0) {
            pendingRef.current = { cmds: rest, at: Date.now(), from: top };
            pending = true;
            // A typed command runs inside a click/submit, where React may already have mounted the
            // next panel by now; deliver straight away in that case instead of waiting for it to register.
            deliverRef.current();
          }
          break;
        }
        if (r.ok === false) break;
        i = j;
      }
      return { messages, ok, pending };
    },
    [handleSession],
  );

  /** Hand queued commands to the panel on top, once it is a different panel from the one that queued them. */
  const deliver = useCallback(() => {
    const pend = pendingRef.current;
    if (!pend) return;
    const top = handlersRef.current[handlersRef.current.length - 1];
    if (!top || top === pend.from) return;
    pendingRef.current = null;
    if (Date.now() - pend.at > PENDING_TTL_MS) return;
    window.setTimeout(async () => {
      const r = await process(pend.cmds);
      setStatus((prev) =>
        prev ? { ...prev, messages: [...prev.messages, ...r.messages], ok: prev.ok && r.ok, pending: r.pending, at: Date.now() } : null,
      );
    }, 0);
  }, [process]);
  deliverRef.current = deliver;

  const register = useCallback(
    (handler: React.MutableRefObject<VoiceHandler>) => {
      handlersRef.current.push(handler);
      deliverRef.current();
      return () => {
        handlersRef.current = handlersRef.current.filter((h) => h !== handler);
      };
    },
    [],
  );

  const execute = useCallback(
    async (heard: string, cmds: VoiceCommand[], viaAi: boolean) => {
      setStatus({ heard, messages: [], ok: true, pending: false, viaAi, at: Date.now() });
      const r = await process(cmds);
      setStatus({ heard, messages: r.messages, ok: r.ok, pending: r.pending, viaAi, at: Date.now() });
    },
    [process],
  );

  const fail = (heard: string, message: string, viaAi: boolean) =>
    setStatus({ heard, messages: [message], ok: false, pending: false, viaAi, at: Date.now() });

  const run = useCallback(
    async (alternatives: string[]) => {
      const options = alternatives.map((a) => a.trim()).filter(Boolean);
      if (options.length === 0) return;
      // Recognisers return a few guesses; take the first one that parses into real commands.
      let heard = options[0];
      let cmds = parseVoiceCommands(heard);
      for (const alt of options) {
        const parsed = parseVoiceCommands(alt);
        if (!parsed.some((c) => c.kind === 'unknown')) {
          heard = alt;
          cmds = parsed;
          break;
        }
      }
      pendingRef.current = null;
      setBusy(true);
      try {
        if (cmds.some((c) => c.kind === 'unknown')) {
          setStatus({ heard, messages: ['Asking Gemini…'], ok: true, pending: false, viaAi: true, at: Date.now() });
          let aiCmds: VoiceCommand[] = [];
          try {
            const ai = await interpretCountVoice({ text: heard });
            aiCmds = guardAiCommands(coerceVoiceCommands(ai.commands), heard);
          } catch (err) {
            fail(heard, `Didn't catch a command, and Gemini couldn't help (${err instanceof Error ? err.message : 'error'}). Say "help" for examples.`, true);
            return;
          }
          if (aiCmds.length === 0) {
            fail(heard, `Didn't catch a command in "${heard}". Say "help" for examples.`, true);
            return;
          }
          await execute(heard, aiCmds, true);
          return;
        }
        await execute(heard, cmds, false);
      } catch (err) {
        fail(heard, err instanceof Error ? err.message : 'Voice command failed.', false);
      } finally {
        setBusy(false);
      }
    },
    [execute],
  );

  const runAudio = useCallback(
    async (clip: Blob) => {
      pendingRef.current = null;
      setBusy(true);
      setStatus({ heard: '…', messages: ['Gemini is listening…'], ok: true, pending: false, viaAi: true, at: Date.now() });
      try {
        const audio = await clipForGemini(clip);
        const ai = await interpretCountVoice({ audioBase64: audio.base64, mimeType: audio.mimeType });
        const heard = ai.transcript || '(nothing heard)';
        // Same rules as typing whenever the words are plain; Gemini's own reading otherwise.
        let cmds = parseVoiceCommands(heard);
        if (cmds.some((c) => c.kind === 'unknown')) cmds = guardAiCommands(coerceVoiceCommands(ai.commands), heard);
        if (cmds.length === 0) {
          fail(heard, ai.transcript ? `Didn't catch a command in "${heard}". Say "help" for examples.` : "Didn't hear anything. Hold the phone closer and try again.", true);
          return;
        }
        await execute(heard, cmds, true);
      } catch (err) {
        fail('(voice clip)', `Gemini couldn't process the clip: ${err instanceof Error ? err.message : 'error'}. Type the command instead.`, true);
      } finally {
        setBusy(false);
      }
    },
    [execute],
  );

  // A new shelf invalidates the cached bin list sooner than the TTL would, and a scanned shelf
  // wins over a fridge picked earlier by voice.
  useEffect(() => {
    binsCacheRef.current = null;
    fridgeRef.current = null;
  }, [activeShelfId]);

  const value = useMemo<VoiceContextValue>(
    () => ({ status, busy, run, runAudio, register, dismiss: () => setStatus(null) }),
    [status, busy, run, runAudio, register],
  );

  return <VoiceCommandContext.Provider value={value}>{children}</VoiceCommandContext.Provider>;
}
