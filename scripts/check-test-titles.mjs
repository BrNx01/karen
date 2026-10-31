// Verifies that a test-file diff only renames describe/it/test titles and comments.
// Compares removal/addition pairs by "code skeleton": the title strings are replaced
// with a placeholder and comments are dropped, so any real code edit shows up.
import { execFileSync } from 'node:child_process';

const base = process.argv[2] ?? 'HEAD';
const diff = execFileSync('git', ['diff', '-U0', base, '--', 'test'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const TITLE = /((?:describe|it|test)(?:\.\w+)?\s*\(\s*)(['"`])(?:\\.|(?!\2).)*\2/g;
const COMMENT = /^\s*(\/\/|\/\*|\*|\{\/\*)/;

/** Normalises a line to its structure: every title text removed, comments removed. */
const skeleton = (line) => {
  const t = line.trim();
  if (t === '') return '';
  if (COMMENT.test(t)) return '';
  return line.replace(TITLE, '$1<TITLE>').replace(/\s+/g, ' ').trim();
};

let file = '';
let block = { removed: [], added: [] };
let bad = 0;
let titles = 0;

const flush = () => {
  if (block.removed.length === 0 && block.added.length === 0) return;
  // Pair up by structure, in order.
  const addedSkeletons = block.added.map(skeleton);
  for (const line of block.removed) {
    const sk = skeleton(line);
    if (sk === '') continue;
    const at = addedSkeletons.indexOf(sk);
    if (at === -1) {
      bad++;
      console.error(`STRUCTURE CHANGED ${file}: -${line.trim().slice(0, 130)}`);
      continue;
    }
    addedSkeletons.splice(at, 1);
    if (sk.includes('<TITLE>')) titles++;
  }
  for (const leftover of addedSkeletons) {
    if (leftover === '') continue;
    bad++;
    console.error(`NEW CODE ${file}: +${leftover.slice(0, 130)}`);
  }
  block = { removed: [], added: [] };
};

for (const raw of diff.split('\n')) {
  if (raw.startsWith('+++ b/')) { flush(); file = raw.slice(6); continue; }
  if (raw.startsWith('@@')) { flush(); continue; }
  if (raw.startsWith('---') || raw.startsWith('+++')) continue;
  if (raw.startsWith('-')) { block.removed.push(raw.slice(1)); continue; }
  if (raw.startsWith('+')) { block.added.push(raw.slice(1)); continue; }
}
flush();

console.log(`\ntitles renamed: ${titles}`);
if (bad > 0) {
  console.error(`${bad} structural change(s) — the test pass must only rename titles and comments.`);
  process.exit(1);
}
console.log('structure preserved: ok');
