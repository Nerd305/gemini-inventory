/**
 * Short voice clips for Gemini: record with MediaRecorder, then convert whatever the browser
 * produced (webm/opus on Chrome, mp4/aac on Safari) into 16 kHz mono 16-bit WAV, a format the
 * Gemini API accepts everywhere. Five seconds is about 160 KB.
 */

export const MAX_CLIP_MS = 12_000;

export function audioRecordingSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export interface Recording {
  /** Stop and return the recorded audio. */
  stop: () => Promise<Blob>;
  /** Stop and throw the audio away. */
  cancel: () => void;
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export async function startRecording(onAutoStop?: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      release();
      resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
    };
  });
  recorder.start();
  const timer = window.setTimeout(() => {
    if (recorder.state === 'recording') {
      recorder.stop();
      onAutoStop?.();
    }
  }, MAX_CLIP_MS);
  return {
    stop: () => {
      window.clearTimeout(timer);
      if (recorder.state === 'recording') recorder.stop();
      return stopped;
    },
    cancel: () => {
      window.clearTimeout(timer);
      recorder.ondataavailable = null;
      if (recorder.state === 'recording') recorder.stop();
      else release();
    },
  };
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Convert a recorded clip to base64 WAV (16 kHz mono). Falls back to the original bytes if decoding fails. */
export async function clipForGemini(blob: Blob, sampleRate = 16_000): Promise<{ base64: string; mimeType: string }> {
  const raw = await blob.arrayBuffer();
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error('no AudioContext');
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    void ctx.close();
    const length = Math.max(1, Math.ceil(decoded.duration * sampleRate));
    const offline = new OfflineAudioContext(1, length, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return { base64: toBase64(encodeWav(rendered.getChannelData(0), sampleRate)), mimeType: 'audio/wav' };
  } catch {
    return { base64: toBase64(raw), mimeType: (blob.type || 'audio/webm').split(';')[0] };
  }
}
