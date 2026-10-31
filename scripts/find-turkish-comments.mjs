// Lists comment lines that still contain Turkish letters. Development aid for the
// translation sweep; not part of the build.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const roots = process.argv.slice(2);
const areas = roots.length > 0 ? roots : ['server', 'app/src', 'test', 'shared', 'electron'];
const files = execFileSync('git', ['ls-files', ...areas], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(ts|tsx|cjs|css|mjs)$/.test(f));

const TURKISH = /[\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/;
const COMMENT = /^\s*(\/\/|\/\*|\*|\{\/\*)/;

let total = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!COMMENT.test(line)) return;
    if (!TURKISH.test(line)) return;
    total++;
    console.log(`${file}:${i + 1}: ${line.trim().slice(0, 150)}`);
  });
}
console.log(`\n${total} Turkish comment line(s).`);
