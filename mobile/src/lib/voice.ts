import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  AudioQuality,
  IOSOutputFormat,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { readAsStringAsync } from 'expo-file-system/legacy';

/**
 * Push-to-talk recorder. iOS prefers 16 kHz mono WAV (a format Gemini accepts
 * natively) and falls back to the AAC/m4a preset if the device refuses it.
 * Nothing here throws on permission problems — `error` is set instead so the
 * typed fallback keeps working.
 */
const WAV_OVERRIDES = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

export interface VoiceClip {
  base64: string;
  mimeType: string;
}

export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startingRef = useRef<Promise<boolean> | null>(null);
  const activeRef = useRef(false);
  const mimeRef = useRef<string>('audio/mp4');
  const startedAt = useRef<number>(0);

  const start = useCallback(async () => {
    setError(null);
    const attempt = (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          setError('Microphone access is off for Expo Go. Enable it in Settings to use push-to-talk.');
          return false;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (Platform.OS === 'ios') {
          try {
            await recorder.prepareToRecordAsync(WAV_OVERRIDES);
            mimeRef.current = 'audio/wav';
          } catch (err) {
            console.warn('WAV recording unavailable, using m4a', err);
            await recorder.prepareToRecordAsync();
            mimeRef.current = 'audio/mp4';
          }
        } else {
          await recorder.prepareToRecordAsync();
          mimeRef.current = 'audio/mp4';
        }
        recorder.record();
        activeRef.current = true;
        startedAt.current = Date.now();
        setRecording(true);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start recording');
        setRecording(false);
        return false;
      }
    })();
    startingRef.current = attempt;
    return attempt;
  }, [recorder]);

  const stop = useCallback(async (): Promise<VoiceClip | null> => {
    // The finger can lift before the recorder finished starting; wait for it so the mic never stays open.
    if (startingRef.current) {
      await startingRef.current.catch(() => false);
      startingRef.current = null;
    }
    if (!activeRef.current) return null;
    activeRef.current = false;
    setRecording(false);
    try {
      await recorder.stop();
      // A tap shorter than this is almost certainly accidental.
      if (Date.now() - startedAt.current < 350) return null;
      const uri = recorder.uri;
      if (!uri) return null;
      const base64 = await readAsStringAsync(uri, { encoding: 'base64' });
      return { base64, mimeType: mimeRef.current };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the recording');
      return null;
    } finally {
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    }
  }, [recorder]);

  return { recording, error, start, stop };
}
