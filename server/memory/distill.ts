import type { StoredEvent } from '../store/events.js';
import type { MemoryStore, Note, NoteKind } from './notes.js';
import { fold } from './notes.js';

export type CandidateNote = {
  kind: NoteKind;
  text: string;
  concepts: string[];
  evidence: number[];
  base: number;
};

export type RejectedNote = { text: string; reason: string };

export type DistillBlock = { sessionId: string; events: StoredEvent[]; userText: string };

/** LLM call; without it the pipeline runs only the deterministic steps. */
export type Distiller = (prompt: string) => Promise<string>;

const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/, label: 'api key' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'aws key' },
  { re: /\bghp_[A-Za-z0-9]{20,}/, label: 'github token' },
  { re: /(password|parola|şifre|sifre|secret|token)\s*[:=]\s*\S{4,}/i, label: 'credential' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
  { re: /\b\d{11}\b/, label: 'national id' },
];

/** 1. Segmenter: splits the conversation into user turns. */
export function segment(events: StoredEvent[]): DistillBlock[] {
  const blocks: DistillBlock[] = [];
  let current: StoredEvent[] = [];
  let userText = '';
  let hasUserTurn = false;

  const flush = () => {
    if (current.length === 0 || !hasUserTurn) return;
    blocks.push({ sessionId: current[0]?.sessionId ?? 'unknown', events: current, userText });
    current = [];
    userText = '';
    hasUserTurn = false;
  };

  for (const event of events) {
    const isUserTurn = event.kind === 'message' && event.payload['role'] === 'user';
    if (isUserTurn && hasUserTurn) flush();
    if (isUserTurn) {
      hasUserTurn = true;
      userText = readBody(event).slice(0, 4000);
    }
    current.push(event);
  }
  flush();
  return blocks;
}

/** 2. Observer: extracts candidate notes (LLM). Without an LLM it produces no candidates at all. */
export function buildDistillPrompt(block: DistillBlock): string {
  const transcript = block.events
    .map((e) => {
      const role = String(e.payload['role'] ?? e.kind);
      const text = readBody(e) || JSON.stringify(e.payload).slice(0, 400);
      return `[#${e.id} ${role}] ${text.slice(0, 1200)}`;
    })
    .join('\n');

  return [
    'Extract notes worth remembering permanently from the session transcript below.',
    'Rules:',
    '- Write only information that appears explicitly in the transcript; do not guess or generalize.',
    '- Every note must cite at least one event id (#123).',
    '- Do not write secrets (keys, passwords, identity numbers).',
    '- The user\'s permanent preferences/facts: kind "semantic". Events that happened: kind "episodic".',
    '- importance is a number 0..1; ordinary work 0.3, strong preference 0.8.',
    '',
    'Return ONLY this JSON array:',
    '[{"kind":"semantic","text":"...","concepts":["..."],"evidence":[123],"importance":0.7}]',
    '',
    'TRANSCRIPT:',
    transcript,
  ].join('\n');
}

/** 3. Parser: reads the JSON array in the model's answer tolerantly. */
export function parseCandidates(raw: string): CandidateNote[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: CandidateNote[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const text = typeof record['text'] === 'string' ? record['text'].trim() : '';
    if (text === '') continue;
    const evidence = Array.isArray(record['evidence'])
      ? record['evidence'].map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : [];
    const concepts = Array.isArray(record['concepts'])
      ? record['concepts'].filter((c): c is string => typeof c === 'string').slice(0, 8)
      : [];
    const importance = Number(record['importance']);
    out.push({
      kind: record['kind'] === 'episodic' ? 'episodic' : 'semantic',
      text,
      concepts,
      evidence,
      base: Number.isFinite(importance) ? Math.min(1, Math.max(0, importance)) : 0.5,
    });
  }
  return out;
}

/** 4. Privacy filter: a candidate carrying a secret is never written. */
export function privacyCheck(text: string): RejectedNote | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) return { text, reason: `privacy: ${pattern.label}` };
  }
  return null;
}

/** 5. Evidence auditor: the cited event text must truly support the note. Deterministic gate. */
export function evidenceCheck(candidate: CandidateNote, block: DistillBlock): RejectedNote | null {
  if (candidate.evidence.length === 0) return { text: candidate.text, reason: 'no evidence' };
  const blockIds = new Set(block.events.map((e) => e.id));
  const missing = candidate.evidence.filter((id) => !blockIds.has(id));
  if (missing.length > 0) return { text: candidate.text, reason: `unknown event: ${missing.join(',')}` };

  // Only the text of the CITED events counts as source; not the whole block.
  const cited = block.events.filter((e) => candidate.evidence.includes(e.id));
  const rawSource = cited.map((e) => `${readBody(e)} ${JSON.stringify(e.payload)}`).join(' ');
  const source = fold(rawSource);

  const words = fold(candidate.text)
    .split(' ')
    .filter((w) => w.length > 3);
  if (words.length === 0) return { text: candidate.text, reason: 'meaningless text' };
  const supported = words.filter((w) => source.includes(w));
  // Threshold 0.5: wording may differ, but a changed topic/fabrication is caught.
  if (supported.length / words.length < 0.5) {
    return { text: candidate.text, reason: 'citation does not support the text' };
  }

  // URLs cannot be fabricated: every address in the note must appear verbatim in the cited event text.
  for (const url of candidate.text.match(/https?:\/\/\S+/g) ?? []) {
    const trimmed = url.replace(/[).,;:!?]+$/, '');
    if (!urlCited(url, rawSource) && !(trimmed !== url && urlCited(trimmed, rawSource))) {
      return { text: candidate.text, reason: 'source url missing' };
    }
  }

  // Numbers cannot be fabricated: every number in the note must be in the source.
  for (const digit of candidate.text.match(/\d+/g) ?? []) {
    if (!rawSource.includes(digit)) return { text: candidate.text, reason: `number not in source: ${digit}` };
  }

  // Negation cannot be flipped: if the note is negated, the source must be too.
  if (NEGATION.test(candidate.text) && !NEGATION.test(rawSource)) {
    return { text: candidate.text, reason: 'negation not present in source' };
  }

  if (candidate.text.length > 600) return { text: candidate.text, reason: 'note too long' };
  return null;
}

const NEGATION = /\b(değil|degil|yok|asla|hiç|hic)\b|(maz|mez|madı|medi|mıyor|miyor|mamış|memiş)\b/i;

/**
 * Does the URL occur in the source? A match cannot be followed by a URL character; otherwise
 * "…/a" would be counted as a prefix of "…/abc" in the source and a fabricated address would pass.
 */
export function urlCited(url: string, rawSource: string): boolean {
  for (let at = rawSource.indexOf(url); at >= 0; at = rawSource.indexOf(url, at + 1)) {
    const next = rawSource[at + url.length];
    if (next === undefined || !/[A-Za-z0-9_%/?#&=+.-]/.test(next)) return true;
  }
  return false;
}

/** 6. Duplicate extractor: if the same text already exists, no new note is written. */
export function duplicateCheck(candidate: CandidateNote, existing: string[]): RejectedNote | null {
  const normalized = fold(candidate.text);
  if (existing.some((text) => fold(text) === normalized)) {
    return { text: candidate.text, reason: 'duplicate' };
  }
  return null;
}

const MAX_CANDIDATES_PER_BLOCK = 8;
const MAX_ADDITIONS_PER_RUN = 200;

/** Reason a candidate is rejected when the distillation model call fails (callers look for this). */
export const DISTILL_MODEL_FAILED = 'model call failed';

export type DistillOutcome = {
  added: Note[];
  rejected: RejectedNote[];
  llmCalls: number;
  skipped?: string;
};

export type DistillOptions = {
  distiller?: Distiller;
  maxLlmCalls?: number;
  project?: string | null;
};

/**
 * The distillation stage of the sleep pipeline. The roles run in order; the deterministic gates
 * let no LLM-produced note through unchecked.
 */
export async function distill(
  memory: MemoryStore,
  events: StoredEvent[],
  opts: DistillOptions = {},
): Promise<DistillOutcome> {
  const added: Note[] = [];
  const rejected: RejectedNote[] = [];
  let llmCalls = 0;
  const maxLlmCalls = opts.maxLlmCalls ?? 8;
  const blocks = segment(events);
  // A forgotten note can be learned again; a note in cold storage is not rewritten.
  const existing = memory.list({ includeDormant: true }).map((n) => n.text);

  for (const block of blocks) {
    // Deterministic first: secret and support checks run before candidates too.
    if (opts.distiller && llmCalls < maxLlmCalls) {
      llmCalls++;
      let raw = '';
      try {
        raw = await opts.distiller(buildDistillPrompt(block));
      } catch {
        rejected.push({ text: '(blok)', reason: DISTILL_MODEL_FAILED });
        continue;
      }
      for (const candidate of parseCandidates(raw).slice(0, MAX_CANDIDATES_PER_BLOCK)) {
        if (added.length >= MAX_ADDITIONS_PER_RUN) {
          rejected.push({ text: candidate.text, reason: 'note limit per run' });
          continue;
        }
        const privacy = privacyCheck(candidate.text);
        if (privacy) {
          rejected.push(privacy);
          continue;
        }
        const evidence = evidenceCheck(candidate, block);
        if (evidence) {
          rejected.push(evidence);
          continue;
        }
        const duplicate = duplicateCheck(candidate, existing);
        if (duplicate) {
          rejected.push(duplicate);
          continue;
        }
        const note = memory.add({
          kind: candidate.kind,
          text: candidate.text,
          concepts: candidate.concepts,
          evidence: candidate.evidence,
          base: candidate.base,
          project: opts.project ?? null,
        });
        existing.push(note.text);
        added.push(note);
      }
    }
  }

  // Episodic summary: even without a model, what the session was is remembered (no hallucination risk).
  const episodic = episodicSummary(events, opts.project ?? null);
  if (episodic && added.length < MAX_ADDITIONS_PER_RUN) {
    const duplicate = duplicateCheck(episodic, existing);
    if (!duplicate) added.push(memory.add(episodic));
  }

  return {
    added,
    rejected,
    llmCalls,
    ...(opts.distiller ? {} : { skipped: 'no model: episodic summary and decay only' }),
  };
}

/**
 * Link builder: links notes that share concepts.
 * Runs ONCE per sleep; it does not rewrite an existing link.
 */
export function linkNotes(memory: MemoryStore, project: string | null = null): number {
  const notes = memory.list({ includeDormant: true }).filter((n) => project === null || n.project === null || n.project === project);
  const existing = new Set(
    notes.flatMap((n) => memory.linksOf(n.id).map((l) => `${n.id}|${l.id}`)),
  );
  let created = 0;
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i];
      const b = notes[j];
      if (!a || !b) continue;
      const shared = a.concepts.filter((c) => b.concepts.includes(c));
      if (shared.length === 0) continue;
      if (existing.has(`${a.id}|${b.id}`)) continue;
      // A concept seed alone does not become "strong": it stays below the threshold (0.8).
      memory.link(a.id, b.id, Math.min(0.6, 0.3 + shared.length * 0.1));
      created++;
    }
  }
  return created;
}

/** Deterministic summary of the session: how many messages, which tools, the outcome. */
export function episodicSummary(events: StoredEvent[], project: string | null): CandidateNote | null {
  const messages = events.filter((e) => e.kind === 'message');
  if (messages.length === 0) return null;
  const firstUser = messages.find((e) => e.payload['role'] === 'user');
  const firstText = firstUser ? readBody(firstUser).slice(0, 160) : '';
  if (firstText.trim() === '') return null;
  const tools = events.filter((e) => e.kind === 'tool_call').map((e) => String(e.payload['tool'] ?? ''));
  const uniqueTools = [...new Set(tools)].filter((t) => t !== '');
  const errors = events.filter((e) => e.kind === 'error').length;

  const parts = [`In session: ${firstText}`];
  if (uniqueTools.length > 0) parts.push(`tools used: ${uniqueTools.slice(0, 6).join(', ')}`);
  if (errors > 0) parts.push(`${errors} errors`);
  return {
    kind: 'episodic',
    text: parts.join(' — ').slice(0, 500),
    concepts: uniqueTools.slice(0, 5),
    evidence: messages.map((e) => e.id),
    base: 0.45,
  };
}

function readBody(event: StoredEvent): string {
  return event.body ?? String(event.payload['text'] ?? '');
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
