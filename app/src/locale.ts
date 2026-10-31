import type { Locale } from '../../shared/i18n/index.js';

/**
 * Picks the OS language tag for `auto`. `navigator.language` is the primary choice;
 * `languages[0]` is the fallback for engines that leave it empty.
 */
export function osLocaleTag(nav: { language?: string; languages?: readonly string[] }): string | undefined {
  if (typeof nav.language === 'string' && nav.language !== '') return nav.language;
  const first = nav.languages?.[0];
  return typeof first === 'string' && first !== '' ? first : undefined;
}

/** BCP-47 tag used for number and date formatting. */
export function localeTag(locale: Locale): string {
  return locale === 'tr' ? 'tr-TR' : 'en-US';
}
