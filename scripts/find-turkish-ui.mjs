// Lists user-visible Turkish literals still hard-coded in components (not comments,
// not data passed through from the server). Development aid for the i18n sweep.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', 'app/src'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(tsx|ts)$/.test(f) && !f.endsWith('i18n.tsx'));

const TURKISH = /[\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/;
const COMMENT = /^\s*(\/\/|\/\*|\*|\{\/\*)/;

let total = 0;
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (COMMENT.test(line)) return;
      if (line.includes('i18n-exempt')) return;
      // Only string-ish lines matter; identifiers never carry Turkish.
      if (!/['"`]/.test(line)) return;
      if (!TURKISH.test(line)) return;
      total++;
      console.log(`${file}:${i + 1}: ${line.trim().slice(0, 150)}`);
    });
}
console.log(`\n${total} Turkish literal line(s) in app/src.`);
