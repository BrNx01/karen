import type { Key } from '../../shared/i18n/index.js';
import type { Settings } from '../../server/settings.js';

/**
 * The settings screen is generated from this table. A control only earns a place
 * here if something actually reads it: no decorative switches.
 */
export type SettingsKey =
  | keyof Settings
  | 'probe'
  | 'autonomy.enabled'
  | 'autonomy.idleMinutes'
  | 'autonomy.dailyRuns'
  | 'autonomy.research';

export type SettingsField = {
  key: SettingsKey;
  kind: 'text' | 'select' | 'toggle' | 'number' | 'readonly' | 'button' | 'hour';
  labelKey: Key;
  hintKey?: Key;
  /** Options are dictionary keys or literal labels (voice ids). */
  options?: { value: string; labelKey?: Key; label?: string }[];
};

export type SettingsSection = { id: string; titleKey: Key; fields: SettingsField[] };

/** Controls the design cut because nothing would read them. */
const CUT = new Set(['coldStorageThreshold', 'evidenceRule', 'updateChannel', 'accentIntensity']);

export function isCutField(key: string): boolean {
  return CUT.has(key);
}

/** `autonomy.idleMinutes` → ['autonomy', 'idleMinutes']; plain keys → [key]. */
export function splitKey(key: SettingsKey): string[] {
  return key.split('.');
}

const COMPUTER_MODES: SettingsField['options'] = [
  { value: 'off', labelKey: 'settings.computer.off' },
  { value: 'ask', labelKey: 'settings.computer.ask' },
  { value: 'allow', labelKey: 'settings.computer.allow' },
];

const SPEEDS: SettingsField['options'] = [
  { value: '0.85', labelKey: 'settings.voiceSpeed.slow' },
  { value: '1', labelKey: 'settings.voiceSpeed.normal' },
  { value: '1.15', labelKey: 'settings.voiceSpeed.fast' },
];

const DENSITY: SettingsField['options'] = [
  { value: 'comfortable', labelKey: 'settings.density.comfortable' },
  { value: 'compact', labelKey: 'settings.density.compact' },
];

export const SECTIONS: SettingsSection[] = [
  {
    id: 'model',
    titleKey: 'settings.section.model',
    fields: [
      { key: 'baseUrl', kind: 'text', labelKey: 'settings.baseUrl', hintKey: 'settings.baseUrlHint' },
      { key: 'probe', kind: 'button', labelKey: 'settings.detect', hintKey: 'settings.detectHint' },
      { key: 'provider', kind: 'readonly', labelKey: 'settings.detectedProvider' },
      { key: 'model', kind: 'select', labelKey: 'settings.model', hintKey: 'settings.modelHint' },
      { key: 'fallbackModel', kind: 'text', labelKey: 'settings.fallbackModel', hintKey: 'settings.fallbackModelHint' },
    ],
  },
  {
    id: 'voice',
    titleKey: 'settings.section.voice',
    fields: [
      { key: 'speakReplies', kind: 'toggle', labelKey: 'settings.speakReplies' },
      { key: 'voiceSpeed', kind: 'select', labelKey: 'settings.voiceSpeed', options: SPEEDS },
      { key: 'wakeWord', kind: 'toggle', labelKey: 'settings.wakeWord', hintKey: 'settings.wakeWordWarn' },
    ],
  },
  {
    id: 'computer',
    titleKey: 'settings.section.computer',
    fields: [
      { key: 'computerControl', kind: 'select', labelKey: 'settings.computer', options: COMPUTER_MODES, hintKey: 'settings.computerHint' },
      { key: 'screenshots', kind: 'toggle', labelKey: 'settings.screenshots', hintKey: 'settings.screenshotsHint' },
    ],
  },
  {
    id: 'memory',
    titleKey: 'settings.section.memory',
    fields: [
      { key: 'consolidationHour', kind: 'hour', labelKey: 'settings.consolidationHour', hintKey: 'settings.consolidationHint' },
    ],
  },
  {
    id: 'autonomy',
    titleKey: 'settings.section.autonomy',
    fields: [
      { key: 'autonomy.enabled', kind: 'toggle', labelKey: 'settings.autonomyEnabled', hintKey: 'settings.autonomyHint' },
      { key: 'autonomy.idleMinutes', kind: 'number', labelKey: 'settings.autonomyIdle' },
      { key: 'autonomy.dailyRuns', kind: 'number', labelKey: 'settings.autonomyDaily' },
      { key: 'autonomy.research', kind: 'toggle', labelKey: 'settings.autonomyResearch', hintKey: 'settings.autonomyResearchWarn' },
    ],
  },
  {
    id: 'interface',
    titleKey: 'settings.section.interface',
    fields: [
      { key: 'locale', kind: 'select', labelKey: 'settings.language', hintKey: 'settings.languageHint' },
      { key: 'density', kind: 'select', labelKey: 'settings.density', options: DENSITY },
      { key: 'reducedMotion', kind: 'toggle', labelKey: 'settings.reducedMotion' },
    ],
  },
  {
    id: 'setup',
    titleKey: 'settings.section.setup',
    fields: [
      { key: 'onboarded', kind: 'toggle', labelKey: 'settings.showOnboarding', hintKey: 'settings.showOnboardingHint' },
    ],
  },
  {
    id: 'advanced',
    titleKey: 'settings.section.advanced',
    fields: [
      { key: 'maxBackground', kind: 'number', labelKey: 'settings.maxBackground', hintKey: 'settings.maxBackgroundHint' },
      { key: 'allowPaidSleep', kind: 'toggle', labelKey: 'settings.allowPaidSleep', hintKey: 'settings.allowPaidSleepWarn' },
    ],
  },
];
