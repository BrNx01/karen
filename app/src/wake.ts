/**
 * "hey karen" wake phrase: uses the browser's SpeechRecognition engine.
 * It listens continuously and triggers when a sentence contains the phrase.
 * In some browsers the engine is cloud-based; settings mark that explicitly and
 * it is off by default.
 */
import type { Key } from '../../shared/i18n/index.js';

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

/**
 * Wake phrase: "hey karen". Speech engines mis-hear it in Turkish as "keren" or
 * "karın", so those spellings are accepted too. The old product name is gone.
 */
const WAKE_PATTERN = /\b(?:hey|hej)\s+(?:karen|keren|karın|karin)\b/i;

/** Pure check, testable in isolation. */
export function isWakePhrase(text: string): boolean {
  return WAKE_PATTERN.test(text);
}

export type WakeWordHandle = { stop: () => void };

/** Permanent errors of the browser engine: retrying is pointless. */
export function isFatalWakeError(code: string): boolean {
  return code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture';
}

/** English defaults keep the module usable without a React context (and in tests). */
export function wakeErrorText(
  code: string,
  t?: (key: Key, vars?: Record<string, string | number>) => string,
): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return t ? t('wake.noPermission') : 'No microphone permission — allow the microphone for “hey karen”';
  }
  if (code === 'audio-capture') return t ? t('wake.noMic') : 'Microphone not found';
  return t ? t('wake.error', { code }) : `Wake word error: ${code}`;
}

export function wakeWordSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return typeof w.SpeechRecognition === 'function' || typeof w.webkitSpeechRecognition === 'function';
}

export function startWakeWord(opts: {
  lang: string;
  onWake: (phrase: string) => void;
  onError?: (message: string) => void;
}): WakeWordHandle {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return { stop: () => undefined };

  const recognition = new Ctor();
  recognition.lang = opts.lang;
  recognition.continuous = true;
  recognition.interimResults = false;
  let stopped = false;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result?.isFinal) continue;
      const text = result[0]?.transcript ?? '';
      if (isWakePhrase(text)) {
        opts.onWake(text.trim());
        break;
      }
    }
  };

  recognition.onerror = (event) => {
    // "no-speech" is normal; do not shut down.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    // No permission / no service: avoid endless restarts and error spam.
    stopped = true;
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
    opts.onError?.(event.error);
  };

  // The browser engine stops itself: restart.
  recognition.onend = () => {
    if (stopped) return;
    try {
      recognition.start();
    } catch {
      /* already running */
    }
  };

  try {
    recognition.start();
  } catch {
    /* could not start */
  }

  return {
    stop: () => {
      stopped = true;
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
