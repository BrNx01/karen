import { describe, it, expect } from 'vitest';
import { encodeWav, resample, toMono } from '../app/src/audio.js';
import { isWav } from '../server/voice/index.js';

const ascii = (view: DataView, offset: number, length: number): string =>
  Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('');

describe('encodeWav', () => {
  it('produces a valid 16-bit mono WAV header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buffer = encodeWav(samples, 16000);
    const view = new DataView(buffer);

    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(buffer.byteLength).toBe(44 + samples.length * 2);
  });

  it('the server recognises its own output file as WAV', () => {
    const buffer = encodeWav(new Float32Array(100), 16000);
    expect(isWav(new Uint8Array(buffer))).toBe(true);
  });

  it('clips overflowing samples', () => {
    const buffer = encodeWav(new Float32Array([2, -2]), 16000);
    const view = new DataView(buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});

describe('toMono', () => {
  it('averages channels', () => {
    const mono = toMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 0.5]);
  });

  it('passes a single channel through unchanged', () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(Array.from(toMono([input]))).toEqual(Array.from(input));
  });

  it('returns empty for empty input', () => {
    expect(toMono([]).length).toBe(0);
  });
});

describe('resample', () => {
  it('48k to 16k divides the length by three', () => {
    const input = new Float32Array(4800);
    expect(resample(input, 48000, 16000).length).toBe(1600);
  });

  it('does not change equal rates', () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resample(input, 16000, 16000)).toBe(input);
  });
});
