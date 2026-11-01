/**
 * Browser speech synthesis. Chromium lists Windows' local OneCore voices
 * (e.g. "Microsoft Tolga", tr-TR); the voice never leaves the device and never
 * goes to the cloud. Turkish answers are therefore read here; server SAPI is
 * only the fallback.
 */
export type BrowserVoice = { name: string; lang: string; local: boolean };

export function listBrowserVoices(): BrowserVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices().map((voice) => ({
    name: voice.name,
    lang: voice.lang,
    local: voice.localService,
  }));
}

/** Voices load asynchronously: notify once they are ready. */
export function onVoicesReady(callback: (voices: BrowserVoice[]) => void): () => void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return () => undefined;
  const emit = () => callback(listBrowserVoices());
  emit();
  window.speechSynthesis.addEventListener('voiceschanged', emit);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', emit);
}

function pickVoice(lang: string, preferred?: string | null): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  if (preferred) {
    const exact = voices.find((voice) => voice.name === preferred);
    if (exact) return exact;
  }
  const prefix = lang.slice(0, 2).toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix) && voice.localService) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix))
  );
}

export type SpeakHandle = { cancel: () => void };

/** Speaks the text in the browser; returns false when no voice exists (the caller falls back). */
export function speakInBrowser(
  text: string,
  opts: { lang: string; voiceName?: string | null; rate?: number; onEnd?: () => void },
): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  const voice = pickVoice(opts.lang, opts.voiceName ?? null);
  if (!voice) return false;

  const clean = text
    .replace(/```[\s\S]*?```/g, ' code block ') // i18n-exempt: spoken placeholder, this pure module has no translator
    .replace(/[#*_`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
  if (clean === '') return false;

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = opts.rate ?? 1;
  if (opts.onEnd) utterance.onend = () => opts.onEnd?.();
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  stopNeural();
}

// ---------- the offline neural voice ----------

let neural: HTMLAudioElement | null = null;

/**
 * Plays KAREN's own voice (Piper, downloaded on first run) through the server. Falls
 * back to the browser voice when the engine is not installed, so speech never dies —
 * it only changes quality.
 */
export async function speakWithVoice(
  text: string,
  opts: { lang: 'tr-TR' | 'en-US'; url: string; onEnd?: () => void },
): Promise<'neural' | 'browser'> {
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 900);
  if (clean === '') return 'browser';

  try {
    const response = await fetch(`${opts.url}${opts.url.includes('?') ? '&' : '?'}text=${encodeURIComponent(clean)}&lang=${opts.lang}`);
    if (response.ok && response.headers.get('content-type')?.includes('audio/wav')) {
      const blob = await response.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      neural = audio;
      audio.onended = () => {
        URL.revokeObjectURL(audio.src);
        neural = null;
        opts.onEnd?.();
      };
      await audio.play();
      return 'neural';
    }
  } catch {
    // No engine, no network to localhost, or a blocked autoplay: use the OS voice.
  }

  void speakInBrowser(clean, { lang: opts.lang, onEnd: opts.onEnd });
  return 'browser';
}

export function stopNeural(): void {
  if (neural) {
    neural.pause();
    URL.revokeObjectURL(neural.src);
    neural = null;
  }
}
