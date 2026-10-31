import { execFile } from 'node:child_process';

/**
 * Server-side speech works only through SAPI (built-in languages such as English).
 * Turkish speech is done in the browser: Chromium lists and plays Windows' OneCore
 * voices (e.g. Microsoft Tolga) locally — it does not go to the cloud. Here we do
 * not try to read Turkish text with an English voice.
 */
export type SpeakOutcome = { ok: true } | { ok: false; reason: string };

export async function listSapiVoices(): Promise<{ name: string; culture: string }[]> {
  if (process.platform !== 'win32') return [];
  const script =
    'Add-Type -AssemblyName System.Speech; ' +
    '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ' +
    'ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture.Name }';
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15_000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        resolve(
          stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.includes('|'))
            .map((line) => {
              const [name = '', culture = ''] = line.split('|');
              return { name, culture };
            })
            .filter((voice) => voice.name !== ''),
        );
      },
    );
  });
}

/** Speech through SAPI; the text goes over stdin (no escaping problem). */
export function speakSapi(text: string, opts: { voice?: string; rate?: number } = {}): Promise<SpeakOutcome> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, reason: 'desteklenmiyor' });
      return;
    }
    const safe = text.slice(0, 2000);
    const voiceArg = opts.voice ? `$s.SelectVoice('${opts.voice.replace(/'/g, "''")}'); ` : '';
    const rate = Math.max(-5, Math.min(5, opts.rate ?? 0));
    const script =
      'Add-Type -AssemblyName System.Speech; ' +
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
      voiceArg +
      `$s.Rate = ${rate}; ` +
      '$s.Speak([Console]::In.ReadToEnd())';
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 60_000, windowsHide: true },
      (err) => (err ? resolve({ ok: false, reason: err.message }) : resolve({ ok: true })),
    );
    child.stdin?.end(safe);
  });
}
