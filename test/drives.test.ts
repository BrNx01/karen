import { describe, it, expect } from 'vitest';
import { selectDrive, unknownTermsFrom } from '../server/autonomy/drives.js';

const base = { logOk: true, unknownTerms: [], styleSignals: [], lastDrive: null, repeats: 0 };

describe('selectDrive', () => {
  it('the integrity drive takes priority when the log is corrupt', () => {
    const d = selectDrive({ ...base, logOk: false, unknownTerms: ['a', 'b', 'c'], styleSignals: ['x'] });
    expect(d?.name).toBe('integrity');
  });

  it('bilinmeyen terim varsa merak', () => {
    expect(selectDrive({ ...base, unknownTerms: ['riscv'] })?.name).toBe('curiosity');
  });

  it('compliance when a repeated style signal exists', () => {
    expect(selectDrive({ ...base, styleSignals: ['kısa cevap'] })?.name).toBe('style');
  });

  it('no drive without a signal', () => {
    expect(selectDrive(base)).toBeNull();
  });

  it('the same drive is not picked 3 times in a row', () => {
    const d = selectDrive({ ...base, unknownTerms: ['x'], lastDrive: 'curiosity', repeats: 3 });
    expect(d?.name).not.toBe('curiosity');
  });

  it('every drive has prompt text', () => {
    const d = selectDrive({ ...base, unknownTerms: ['x'] });
    expect(d!.prompt.length).toBeGreaterThan(20);
  });
});

describe('unknownTermsFrom', () => {
  // one message equals no repetition: no plain sentence produces a drive.
  const prose = ['Bugün hava güzel.', 'işler iyi gidiyor', 'Bilmiyorum.', 'Ne yapmak istiyorum?', 'teşekkür ederim', 'bilgisayar bozuldu'];
  it.each(prose)('tek seferlik cümle dürtü üretmez: %s', (message) => {
    expect(unknownTermsFrom({ userMessages: [message], knownText: '' })).toEqual([]);
  });

  it('link and email fragments are not terms', () => {
    expect(unknownTermsFrom({ userMessages: ['bak https://example.com/a', 'yine https://example.com/a'], knownText: '' })).toEqual([]);
    expect(unknownTermsFrom({ userMessages: ['mail: a@b.com', 'a@b.com yine'], knownText: '' })).toEqual([]);
  });

  it('dotless I and dotted i fold to the same term', () => {
    const terms = unknownTermsFrom({ userMessages: ['IŞIK açık', 'ışık kapalı'], knownText: '' });
    // both spellings fold to one entry; the capitalised form does not leak as a separate term.
    // a repeated unknown name produces a drive: same rule as the "hava" test below.
    expect(terms).toEqual(['işik']);
  });

  // known and accepted behaviour: a repeated unknown name produces a drive.
  it('a plain name in two messages produces the curiosity drive', () => {
    expect(unknownTermsFrom({ userMessages: ['hava çok sıcak', 'hava soğuk'], knownText: '' })).toContain('hava');
  });

  it('finds a term that appears in two messages', () => {
    const terms = unknownTermsFrom({
      userMessages: ['riscv üzerinde çalışıyorum', 'riscv derleyicisi hızlı'],
      knownText: 'kullanıcı türkçe sever',
    });
    expect(terms).toContain('riscv');
  });

  it('skips a repeated term already in memory', () => {
    const terms = unknownTermsFrom({
      userMessages: ['riscv üzerinde çalışıyorum', 'riscv derleyicisi hızlı'],
      knownText: 'riscv üzerine not',
    });
    expect(terms).toEqual([]);
  });

  it('tekrar eden durma kelimesini atlar', () => {
    const terms = unknownTermsFrom({ userMessages: ['bugün yağmur var', 'bugün güneş var'], knownText: '' });
    expect(terms).toEqual([]);
  });

  it('keeps terms containing symbols', () => {
    expect(unknownTermsFrom({ userMessages: ['c++ öğreniyorum', 'c++ hızlı'], knownText: '' })).toEqual(['c++']);
    expect(unknownTermsFrom({ userMessages: ['c# yazıyorum', 'c# derledim'], knownText: '' })).toEqual(['c#']);
    expect(unknownTermsFrom({ userMessages: ['gpt-4 denedim', 'gpt-4 pahalı'], knownText: '' })).toEqual(['gpt-4']);
  });

  it('sorts by frequency and applies the limit', () => {
    const terms = unknownTermsFrom({
      userMessages: ['riscv vllm tensorrt', 'riscv vllm tensorrt', 'riscv vllm', 'riscv'],
      knownText: '',
      limit: 2,
    });
    expect(terms).toEqual(['riscv', 'vllm']);
  });

  it('Turkish case folds to the same term', () => {
    const terms = unknownTermsFrom({ userMessages: ['RISC-V kullandım', 'risc-v iyi'], knownText: '' });
    expect(terms).toEqual(['risc-v']);
  });

  it('returns empty for empty input', () => {
    expect(unknownTermsFrom({ userMessages: [], knownText: '' })).toEqual([]);
  });
});
