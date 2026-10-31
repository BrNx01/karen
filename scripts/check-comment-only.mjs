// Fails if a diff touches anything but comment lines.
// Used to prove the English-comment pass changed no behaviour.
import { execFileSync } from 'node:child_process';

const base = process.argv[2];
if (!base) {
  console.error('usage: node scripts/check-comment-only.mjs <base-sha>');
  process.exit(2);
}

const diff = execFileSync('git', ['diff', '-U0', base, '--', 'server', 'app/src', 'test', 'shared', 'electron'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const isComment = (line) => {
  const t = line.trim();
  if (t === '') return true;
  return (
    t.startsWith('//') ||
    t.startsWith('/*') ||
    t.startsWith('*') ||
    /^\{\/\*.*\*\/\}$/.test(t)
  );
};

/** Code part of a line: everything before a trailing `//`, trimmed. */
const codePart = (line) => {
  const i = line.indexOf('//');
  return (i === -1 ? line : line.slice(0, i)).trim();
};

let file = '';
let bad = 0;
let block = { removed: [], added: [] };

/** A hunk block is fine when every removal is matched by an addition with identical code. */
const flush = () => {
  if (block.removed.length === 0 && block.added.length === 0) return;
  const pool = block.added.map(codePart);
  for (const line of block.removed) {
    const code = codePart(line);
    const at = pool.indexOf(code);
    if (at === -1) {
      bad++;
      console.error(`${file}: ${line.slice(0, 140)}`);
    } else {
      pool.splice(at, 1);
    }
  }
  // An added line with no removed counterpart is a new code line.
  for (const leftover of pool) {
    if (leftover === '') continue;
    bad++;
    console.error(`${file}: +${leftover.slice(0, 140)}`);
  }
  block = { removed: [], added: [] };
};

for (const raw of diff.split('\n')) {
  if (raw.startsWith('+++ b/')) {
    flush();
    file = raw.slice(6);
    continue;
  }
  if (raw.startsWith('@@')) {
    flush();
    continue;
  }
  if (raw.startsWith('---') || raw.startsWith('+++')) continue;
  if (raw.startsWith('-')) {
    const text = raw.slice(1);
    if (!isComment(text)) block.removed.push(text);
    continue;
  }
  if (raw.startsWith('+')) {
    const text = raw.slice(1);
    if (!isComment(text)) block.added.push(text);
  }
}
flush();

if (bad > 0) {
  console.error(`\n${bad} non-comment line(s) changed. The English-comment pass must not touch code.`);
  process.exit(1);
}
console.log('comment-only: ok');
