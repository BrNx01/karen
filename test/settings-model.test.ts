import { describe, it, expect } from 'vitest';
import { SECTIONS, isCutField, splitKey } from '../app/src/settings-model.js';
import { en } from '../shared/i18n/en.js';
import { tr } from '../shared/i18n/tr.js';
import { DEFAULT_SETTINGS } from '../server/settings.js';

describe('settings sections', () => {
  it('has the eight sections, in order', () => {
    expect(SECTIONS.map((section) => section.id)).toEqual([
      'model',
      'voice',
      'computer',
      'memory',
      'autonomy',
      'interface',
      'setup',
      'advanced',
    ]);
  });

  it('never offers a control that does nothing', () => {
    const keys = SECTIONS.flatMap((section) => section.fields.map((field) => String(field.key)));
    for (const cut of ['coldStorageThreshold', 'evidenceRule', 'updateChannel', 'accentIntensity']) {
      expect(keys).not.toContain(cut);
      expect(isCutField(cut)).toBe(true);
    }
  });

  it('every field points at a real setting or at the probe', () => {
    const settings = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        if (field.key === 'probe') continue;
        const [head, tail] = splitKey(field.key);
        expect(Object.keys(settings), `${section.id}/${String(field.key)}`).toContain(head);
        if (tail !== undefined) {
          const nested = settings[head as string] as Record<string, unknown>;
          expect(Object.keys(nested), `${section.id}/${field.key}`).toContain(tail);
        }
      }
    }
  });

  it('every label and hint exists in both dictionaries', () => {
    for (const section of SECTIONS) {
      expect(en[section.titleKey], section.titleKey).toBeTruthy();
      expect(tr[section.titleKey], section.titleKey).toBeTruthy();
      for (const field of section.fields) {
        expect(en[field.labelKey], field.labelKey).toBeTruthy();
        expect(tr[field.labelKey], field.labelKey).toBeTruthy();
        if (field.hintKey) {
          expect(en[field.hintKey], field.hintKey).toBeTruthy();
          expect(tr[field.hintKey], field.hintKey).toBeTruthy();
        }
        for (const option of field.options ?? []) {
          if (!option.labelKey) continue;
          expect(en[option.labelKey], option.labelKey).toBeTruthy();
          expect(tr[option.labelKey], option.labelKey).toBeTruthy();
        }
      }
    }
  });

  it('the model section asks for one address and a detected model', () => {
    const model = SECTIONS.find((section) => section.id === 'model');
    const kinds = model?.fields.map((field) => `${String(field.key)}:${field.kind}`) ?? [];
    expect(kinds).toContain('baseUrl:text');
    expect(kinds).toContain('probe:button');
    expect(kinds).toContain('model:select');
  });

  it('no section is empty', () => {
    for (const section of SECTIONS) expect(section.fields.length, section.id).toBeGreaterThan(0);
  });
});
