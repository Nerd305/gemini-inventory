import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Thin wrapper over the browser's Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 * Safari on iPhone and Chrome on Android support it; the recognition itself runs on Apple's or
 * Google's speech service. Where it is missing or blocked, the voice bar falls back to a text
 * field, which also takes the phone keyboard's own dictation (the mic key).
 */

interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return recognitionCtor() !== null;
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Microphone or speech recognition is blocked for this site. Allow it in the browser settings, or type the command below.',
  'service-not-allowed': 'Speech recognition is not available here (some home-screen apps block it). Type the command below; the keyboard mic works too.',
  'no-speech': "Didn't hear anything. Tap the mic and speak.",
  'audio-capture': 'No microphone found.',
  network: 'The speech service could not be reached. Type the command below instead.',
  'language-not-supported': 'Speech recognition does not support this language setting.',
};

export function useSpeechRecognition(onFinal: (alternatives: string[]) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Raw SpeechRecognition error code, so the caller can switch to Gemini listening. */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const deliveredRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const abort = useCallback(() => {
    recRef.current?.abort();
    recRef.current = null;
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError('Voice input is not supported in this browser. Type the command below instead.');
      return;
    }
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    deliveredRef.current = false;
    rec.onresult = (e) => {
      let interimText = '';
      for (let r = e.resultIndex; r < e.results.length; r++) {
        const result = e.results[r];
        if (result.isFinal) {
          const alternatives: string[] = [];
          for (let a = 0; a < result.length; a++) {
            const text = result[a]?.transcript?.trim();
            if (text) alternatives.push(text);
          }
          if (alternatives.length > 0 && !deliveredRef.current) {
            deliveredRef.current = true;
            setInterim('');
            onFinalRef.current(alternatives);
          }
        } else {
          interimText += result[0]?.transcript ?? '';
        }
      }
      if (interimText) setInterim(interimText.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      setErrorCode(e.error);
      setError(ERROR_TEXT[e.error] ?? `Voice input stopped (${e.error}).`);
    };
    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    setError(null);
    setErrorCode(null);
    setInterim('');
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      recRef.current = null;
      setError(err instanceof Error ? err.message : 'Could not start voice input.');
    }
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return {
    supported: speechRecognitionSupported(),
    listening,
    interim,
    error,
    errorCode,
    start,
    stop,
    abort,
    clearError: () => {
      setError(null);
      setErrorCode(null);
    },
  };
}
