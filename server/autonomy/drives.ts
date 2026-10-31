/**
 * DMN drives: the pure layer that chooses which job to take on.
 * No clock, no log, no network; input goes in, a drive comes out.
 */

import { TR_STOP_WORDS } from '../brain/stopwords.js';

export type DriveName = 'integrity' | 'curiosity' | 'style';

export type Drive = { name: DriveName; score: number; prompt: string };

/** Order is also the tie-breaker: integrity > curiosity > style. */
export function selectDrive(input: {
  logOk: boolean;
  unknownTerms: string[];
  styleSignals: string[];
  lastDrive: DriveName | null;
  repeats: number;
}): Drive | null {
  const drives: Drive[] = [
    {
      name: 'integrity',
      score: input.logOk === false ? 1 : 0,
      prompt:
        'The event log chain looks broken. Inspect the latest events and report briefly where the corruption starts and what the likely cause is.',
    },
    {
      name: 'curiosity',
      score: input.unknownTerms.length > 0 ? 0.6 + Math.min(0.3, 0.1 * input.unknownTerms.length) : 0,
      prompt: `Research the following terms from the user's past messages and write a one- or two-sentence summary for each: ${input.unknownTerms
        .slice(0, 5)
        .join(', ')}. Only list the URLs of sources you actually reached.`,
    },
    {
      name: 'style',
      score: input.styleSignals.length > 0 ? 0.5 : 0,
      prompt: `The user keeps giving these style signals: ${input.styleSignals
        .slice(0, 3)
        .join(', ')}. In one paragraph, with concrete examples, write how to follow these preferences better.`,
    },
  ];

  let best: Drive | null = null;
  for (const drive of drives) {
    // The same drive is not picked three times in a row: the turn passes to the others.
    const score = drive.name === input.lastDrive && input.repeats >= 3 ? 0 : drive.score;
    if (score <= 0) continue;
    if (!best || score > best.score) best = { ...drive, score };
  }
  return best;
}

const MAX_TOKEN = 40;
/** Anything that is not a letter/digit is a separator; `+`, `#`, `-` stay inside the term. */
const TOKEN_SPLIT = /[^\p{L}\p{N}+#-]+/u;

/** A link/path/e-mail fragment is not a word: a fragment carrying this character is dropped whole. */
const LINK_CHARS = /[/:@\\]/;

/**
 * Lowercases and folds the Turkish i family into a single letter.
 *
 * "IŞIK", "ışık" and "işik" must reduce to the same term; otherwise the same word
 * never reaches the repeat threshold under two spellings. Folding goes toward `i`
 * because technical names are mostly English: `RISC-V` → `risc-v` (the other
 * direction would produce `rısc-v`). The ı/i distinction is meaningless for this
 * repeat counter; folding only matches the same word.
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\u0307/g, '').replace(/ı/g, 'i');
}

const STOP_WORDS = new Set(TR_STOP_WORDS.map(normalize));

function tokensOf(message: string): string[] {
  const out: string[] = [];
  for (const segment of normalize(message).split(/\s+/)) {
    // Check at the segment level first: we do not tear words out of a link.
    if (LINK_CHARS.test(segment)) continue;
    for (const raw of segment.split(TOKEN_SPLIT)) {
      const token = raw.replace(/^-+|-+$/g, '');
      if (token === '' || token.length > MAX_TOKEN) continue;
      // "c#", "c++" are shorter than three characters but real terms: symbolic ones pass.
      if (token.length < 3 && !/[+#]/.test(token)) continue;
      out.push(token);
    }
  }
  return out;
}

/**
 * Curiosity drive input: terms that appear at least twice across the user's
 * distinct messages, have no counterpart in memory and are not everyday words.
 *
 * The repeat requirement alone is enough filtering: a word said once is chat,
 * a word said twice is a topic. No spelling/orthography heuristics.
 */
export function unknownTermsFrom(input: {
  userMessages: string[];
  knownText: string;
  limit?: number;
}): string[] {
  const rawLimit = input.limit ?? 5;
  const limit = Number.isFinite(rawLimit) ? Math.max(0, Math.floor(rawLimit)) : 5;
  const known = normalize(input.knownText);
  const counts = new Map<string, number>();
  for (const message of input.userMessages) {
    // Occurring twice in one message does not count: repeats are BETWEEN MESSAGES.
    for (const token of new Set(tokensOf(message))) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts]
    .filter(([token, count]) => count >= 2 && !STOP_WORDS.has(token) && !known.includes(token))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([token]) => token);
}
