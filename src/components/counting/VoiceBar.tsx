import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, Mic, MicOff, Send, Sparkles, Square, X } from 'lucide-react';
import { useVoiceCommands } from '../../contexts/VoiceCommandContext';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { audioRecordingSupported, startRecording, type Recording } from '../../lib/audioClip';

/**
 * Hands-free input for /count, drawn over the bottom of the camera view.
 * Tap the mic and say "tray 3 twenty two save", "next", "all full", "shelf 2", "bin tirz"…
 *
 * Two ways of listening:
 *  - phone: the browser's own speech recognition (instant, free). Sentences the local parser
 *    can't read go to Gemini as text.
 *  - gemini: record a clip (tap to start, tap to send) and Gemini transcribes and interprets it.
 *    Used where the browser can't transcribe (e.g. some home-screen apps), or by choice.
 * The chat button opens a text field for the same commands; the keyboard's mic key can dictate.
 */

type ListenMode = 'phone' | 'gemini';
const MODE_KEY = 'vialtrack:voiceMode';
/** Speech errors where recording for Gemini will still work. */
const SWITCH_TO_GEMINI = new Set(['service-not-allowed', 'network', 'language-not-supported']);

function savedMode(): ListenMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'phone' || v === 'gemini' ? v : null;
  } catch {
    return null;
  }
}

function saveMode(mode: ListenMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // private mode etc.: the choice just doesn't stick
  }
}

export default function VoiceBar() {
  const voice = useVoiceCommands();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const speech = useSpeechRecognition((alternatives) => {
    void voice?.run(alternatives);
  });
  const canRecord = audioRecordingSupported();
  const [mode, setMode] = useState<ListenMode | null>(() => {
    const saved = savedMode();
    if (saved === 'gemini' && canRecord) return 'gemini';
    if (saved === 'phone' && speech.supported) return 'phone';
    return speech.supported ? 'phone' : canRecord ? 'gemini' : null;
  });
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const recordingRef = useRef<Recording | null>(null);
  const [switchedNote, setSwitchedNote] = useState<string | null>(null);

  const status = voice?.status ?? null;

  // The phone's recogniser is blocked here (home-screen app, no speech service): listen through Gemini instead.
  useEffect(() => {
    if (mode === 'phone' && speech.errorCode && SWITCH_TO_GEMINI.has(speech.errorCode) && canRecord) {
      setMode('gemini');
      saveMode('gemini');
      speech.clearError();
      setSwitchedNote('Phone speech recognition is not available here, so Gemini will listen instead. Tap the mic, speak, tap again to send.');
    }
  }, [speech.errorCode, mode, canRecord, speech]);

  // A fresh reply replaces older notices (mode switch, recorder problems).
  const statusAt = status?.at;
  useEffect(() => {
    if (statusAt === undefined) return;
    setSwitchedNote(null);
    setRecordError(null);
  }, [statusAt]);

  // Successful replies fade after a while; problems stay until the next command or ×.
  useEffect(() => {
    if (!status || !status.ok || status.pending || voice?.busy) return;
    const t = window.setTimeout(() => voice?.dismiss(), 9000);
    return () => window.clearTimeout(t);
  }, [status, voice]);

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  useEffect(() => () => recordingRef.current?.cancel(), []);

  if (!voice) return null;

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    void voice.run([v]);
  };

  const sendRecording = async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    if (!rec) return;
    const clip = await rec.stop();
    if (clip.size < 1000) {
      setRecordError('That clip was empty. Tap the mic, speak, then tap again to send.');
      return;
    }
    await voice.runAudio(clip);
  };

  const toggleMic = async () => {
    setSwitchedNote(null);
    setRecordError(null);
    if (mode === 'gemini') {
      if (recording) {
        await sendRecording();
        return;
      }
      voice.dismiss();
      try {
        recordingRef.current = await startRecording(() => void sendRecording());
        setRecording(true);
      } catch (err) {
        setRecordError(
          err instanceof Error && /denied|permission|not allowed/i.test(err.message)
            ? 'Microphone access is blocked for this site. Allow it in the browser settings, or type the command.'
            : 'Could not start the microphone. Type the command instead.',
        );
      }
      return;
    }
    if (speech.listening) speech.stop();
    else {
      voice.dismiss();
      speech.start();
    }
  };

  const chooseMode = (next: ListenMode) => {
    recordingRef.current?.cancel();
    recordingRef.current = null;
    setRecording(false);
    speech.abort();
    speech.clearError();
    setMode(next);
    saveMode(next);
  };

  const listening = mode === 'gemini' ? recording : speech.listening;
  const problem = recordError ?? (mode === 'phone' ? speech.error : null);
  const showCard = listening || problem || switchedNote || status;

  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex items-end gap-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        {showCard && (
          <div className="pointer-events-auto rounded-lg bg-black/75 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm" aria-live="polite">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                {listening ? (
                  <p className="text-white/90">
                    {mode === 'gemini'
                      ? 'Recording… tap the mic again to send to Gemini.'
                      : speech.interim
                      ? `“${speech.interim}”`
                      : 'Listening…'}
                  </p>
                ) : problem ? (
                  <p className="text-amber-200">{problem}</p>
                ) : switchedNote ? (
                  <p className="text-teal-200">{switchedNote}</p>
                ) : status ? (
                  <>
                    <p className="flex items-center gap-1 truncate text-white/60">
                      {status.viaAi && (
                        <span className="inline-flex shrink-0 items-center rounded bg-purple-500/30 px-1 text-[10px] font-semibold text-purple-100">
                          <Sparkles className="mr-0.5 h-2.5 w-2.5" /> Gemini
                        </span>
                      )}
                      <span className="truncate">“{status.heard}”</span>
                    </p>
                    {voice.busy && status.messages.length === 0 ? (
                      <p className="flex items-center text-white/80">
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Working…
                      </p>
                    ) : (
                      status.messages.map((m, i) => (
                        <p key={i} className={status.ok ? 'text-teal-200' : 'text-amber-200'}>
                          {m}
                        </p>
                      ))
                    )}
                    {status.pending && <p className="text-white/60">Opening…</p>}
                  </>
                ) : null}
              </div>
              {!listening && (
                <button
                  type="button"
                  onClick={() => {
                    speech.clearError();
                    setRecordError(null);
                    setSwitchedNote(null);
                    voice.dismiss();
                  }}
                  className="text-white/60 hover:text-white"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
        {typing && (
          <div className="pointer-events-auto space-y-1 rounded-lg bg-white/95 p-1.5 shadow-lg">
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder='e.g. "tray 3 22 save" or "all full"'
                className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="go"
                aria-label="Type a count command"
              />
              <button
                type="submit"
                className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-600 text-white disabled:opacity-50"
                disabled={!text.trim() || voice.busy}
                aria-label="Run command"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
            {(speech.supported || canRecord) && (
              <div className="flex items-center gap-1 px-0.5 text-[11px] text-gray-600">
                <span className="mr-1">Mic listens with:</span>
                {speech.supported && (
                  <button
                    type="button"
                    onClick={() => chooseMode('phone')}
                    className={`rounded px-1.5 py-0.5 ${mode === 'phone' ? 'bg-teal-600 text-white' : 'bg-gray-100'}`}
                  >
                    Phone
                  </button>
                )}
                {canRecord && (
                  <button
                    type="button"
                    onClick={() => chooseMode('gemini')}
                    className={`rounded px-1.5 py-0.5 ${mode === 'gemini' ? 'bg-purple-600 text-white' : 'bg-gray-100'}`}
                  >
                    Gemini
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => setTyping((v) => !v)}
          className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg ${typing ? 'bg-white text-teal-700' : 'bg-black/60 text-white'}`}
          aria-label={typing ? 'Hide the command field' : 'Type a command'}
          title="Type a command (the keyboard mic can dictate)"
        >
          <MessageSquare className="h-4 w-4" />
        </button>
        {mode ? (
          <button
            type="button"
            onClick={() => void toggleMic()}
            disabled={voice.busy}
            className={`relative flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-colors disabled:opacity-60 ${
              listening ? 'animate-pulse bg-red-500' : mode === 'gemini' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-teal-600 hover:bg-teal-700'
            }`}
            aria-label={listening ? (mode === 'gemini' ? 'Send to Gemini' : 'Stop listening') : 'Speak a command'}
            title='Tap and say e.g. "tray 3 twenty two save"'
          >
            {voice.busy ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : listening && mode === 'gemini' ? (
              <Square className="h-5 w-5 fill-current" />
            ) : (
              <Mic className="h-6 w-6" />
            )}
            {mode === 'gemini' && !listening && (
              <span className="absolute -right-0.5 -top-0.5 rounded-full bg-white px-1 text-[9px] font-bold text-purple-700 shadow">AI</span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setTyping(true)}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-600 text-white shadow-lg"
            aria-label="Voice input is not available in this browser; type a command instead"
            title="Voice input is not available in this browser. Type a command; the keyboard mic can dictate."
          >
            <MicOff className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  );
}
