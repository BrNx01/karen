import { en, type Dictionary, type Key } from './en.js';
import { tr } from './tr.js';

export type { Dictionary, Key };
export type Locale = 'tr' | 'en';
export type LocaleSetting = 'auto' | Locale;

export const dictionaries: Record<Locale, Dictionary> = { en, tr };

/**
 * Resolves the `auto` setting from an OS/BCP-47 tag.
 * Turkish wins only when the primary subtag is `tr`; everything else falls back to
 * English, which is the safer default for a public release.
 */
export function resolveLocale(setting: LocaleSetting, osTag: string | undefined): Locale {
  if (setting === 'tr' || setting === 'en') return setting;
  if (typeof osTag === 'string' && /^\s*tr\b/i.test(osTag)) return 'tr';
  return 'en';
}

/** Looks a key up and substitutes `{name}` placeholders. Unknown vars stay visible. */
export function translate(locale: Locale, key: Key, vars?: Record<string, string | number>): string {
  const template = dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** True when the setting is one of the accepted values. */
export function isLocaleSetting(value: unknown): value is LocaleSetting {
  return value === 'auto' || value === 'tr' || value === 'en';
}
