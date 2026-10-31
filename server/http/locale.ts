import { translate, type Key, type Locale } from '../../shared/i18n/index.js';

/**
 * Per-request localisation for the messages the server generates itself.
 *
 * Only *live* text is localised: error bodies and notices created while handling a
 * request. Stored data (notes, inbox rows, transcripts) is returned verbatim — a note
 * written in Turkish must stay Turkish when the UI language changes.
 *
 * Third-party text (provider, whisper, shell errors) is passed through unchanged.
 */

/** Locale requested by the browser via the `x-karen-locale` header. */
export function requestLocale(header: string | string[] | undefined, fallback: Locale): Locale {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === 'tr' || raw === 'en') return raw;
  return fallback;
}

export type ErrorBody = { error: string; message: string };

/** Stable machine code plus a localised sentence. */
export function errorBody(locale: Locale, code: Key): ErrorBody {
  return { error: code.replace(/^server\./, ''), message: translate(locale, code) };
}

/** Localised text for one key, for notices and greetings. */
export function message(locale: Locale, key: Key, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}
