// Seeds a throwaway profile so screenshots never show a real memory or a real path.
// Run against the built server: node scripts/demo-profile.mjs <dir>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EventLog } from '../dist/server/store/events.js';
import { MemoryStore } from '../dist/server/memory/notes.js';
import { InboxStore } from '../dist/server/autonomy/inbox.js';
import { WorldModel } from '../dist/server/memory/world.js';

const dir = resolve(process.argv[2] ?? '.demo-profile');
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'atlas-api'), { recursive: true });

// A believable provider with no key and no network, so the dashboard renders offline.
writeFileSync(
  join(dir, 'settings.json'),
  `${JSON.stringify(
    {
      provider: 'ollama',
      model: 'qwen3-32b',
      baseUrl: '',
      speakReplies: true,
      voiceLang: 'en-US',
      voiceName: null,
      wakeWord: false,
      maxBackground: 3,
      allowPaidSleep: false,
      locale: 'en',
      providers: {},
      autonomy: { enabled: false, idleMinutes: 30, dailyRuns: 24, research: true },
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const log = new EventLog(join(dir, 'events.db'));
const memory = new MemoryStore(log);

/** One user turn, its tool calls and the reply; returns the user event id. */
function turn(user, reply, tools = []) {
  const userId = log.append('message', 'user', 'brain', { role: 'user' }, user).id;
  for (const tool of tools) {
    const callId = log.append('tool_call', 'brain', 'brain', { name: tool.name, args: tool.args }, tool.name).id;
    log.append(
      'tool_result',
      'brain',
      'brain',
      { callId, ok: true, tool: tool.name, output: tool.output ?? 'ok' },
      tool.output ?? 'ok',
    );
  }
  log.append('message', 'brain', 'brain', { role: 'assistant' }, reply);
  return userId;
}

const t1 = turn(
  'the workshop budget is 4,200 and the last payment was 1,200 on Oct 24',
  'Noted: 4,200 total, 1,200 paid on Oct 24 — 3,000 left.',
  [{ name: 'world_compute', args: { op: 'sum', attribute: 'budget' }, output: 'sum(budget) = 4200' }],
);
const t2 = turn(
  'deploys freeze on Fridays, we learned that the hard way',
  'Friday deploy freeze recorded. I will flag any Friday deploy before it runs.',
  [{ name: 'memory_search', args: { query: 'deploy freeze' }, output: '2 notes' }],
);
const t3 = turn(
  'the atlas-api build breaks when the cache layer is warm',
  'Reproduced in the log: cache warm-up runs before the migration lock is released. Restarting the cache cleared it twice.',
  [
    { name: 'run_command', args: { command: 'git log --oneline -5' }, output: 'a41f2c9 fix cache warm-up order' },
    { name: 'read_file', args: { path: 'src/cache/warm.ts' }, output: 'export async function warm() { … }' },
  ],
);
const t4 = turn('remember that Selin owns the payments service now', 'Selin owns payments as of today.', []);

memory.add({ kind: 'semantic', text: 'Workshop budget is 4,200; 1,200 paid on Oct 24', evidence: [t1], base: 0.92 });
memory.add({ kind: 'semantic', text: 'Deploys are frozen on Fridays', evidence: [t2], base: 0.88 });
memory.add({ kind: 'episodic', text: 'atlas-api build breaks when the cache layer is warm', evidence: [t3], base: 0.81 });
memory.add({ kind: 'episodic', text: 'Cache warm-up ran before the migration lock was released', evidence: [t3], base: 0.74 });
memory.add({ kind: 'semantic', text: 'Selin owns the payments service', evidence: [t4], base: 0.9 });
const trauma = memory.add({
  kind: 'episodic',
  text: 'A Friday deploy took the API down for 40 minutes',
  evidence: [t2],
  base: 0.95,
});
memory.markTrauma(trauma.id, 'repeated error');

const world = new WorldModel(log);
world.extractFromText('workshop budget 4200 USD', 'workshop', t1);

const inbox = new InboxStore(log);
inbox.add({ kind: 'research', text: 'Read the vLLM batching notes; two settings map onto the atlas-api cache warm-up bug.' });
inbox.add({ kind: 'suggestion', text: 'Three notes mention the Friday deploy freeze — should it become a permanent rule?' });

log.close();
console.log(`demo profile: ${dir}`);
