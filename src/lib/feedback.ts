/**
 * Tiny audio cues for scan feedback. iOS only lets an AudioContext start after a
 * user gesture, so `primeAudio()` is called from tap handlers and the beeps
 * degrade to silence (never throw) when audio is unavailable.
 */
let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

export function primeAudio(): void {
  const c = getContext();
  if (c && c.state === 'suspended') {
    c.resume().catch(() => {});
  }
}

function tone(freq: number, durationMs: number, volume: number, startOffset = 0): void {
  const c = getContext();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(c.destination);
    const start = c.currentTime + startOffset;
    osc.start(start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
    osc.stop(start + durationMs / 1000 + 0.02);
  } catch {
    // ignore
  }
}

export function playScanBeep(): void {
  tone(880, 90, 0.08);
}

export function playSuccessBeep(): void {
  tone(660, 80, 0.08);
  tone(990, 120, 0.08, 0.09);
}

export function playErrorBeep(): void {
  tone(220, 180, 0.1);
}

export function vibrate(pattern: number | number[] = 30): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // ignore
  }
}
