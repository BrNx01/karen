// Lists test titles that are still Turkish. Turkish is often written without
// diacritics ("kaydeder ve geri okur"), so diacritics alone are not enough:
// this also looks for Turkish function words that do not occur in English.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', 'test'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.ts'));

const DIACRITIC = /[\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/;
const STOPWORDS = new Set([
  've', 'bir', 'bu', 'şu', 'için', 'icin', 'ile', 'ama', 'çok', 'cok', 'daha', 'gibi',
  'sonra', 'önce', 'değil', 'degil', 'yok', 'kadar', 'göre', 'gore', 'olarak', 'veya',
  'ancak', 'hem', 'eğer', 'eger', 'zaten', 'sadece', 'artık', 'artik', 'yine', 'geri',
  'kendi', 'ekler', 'okur', 'listeler', 'arar', 'sil', 'siler', 'tetiklenebilir',
]);
// Phrases that are Turkish even though the words alone are ambiguous in English.
const PHRASES = [/her zaman/, /var m[ıi]/, /yoksa/];

const TITLE = /^\s*(describe|it|test)(\.\w+)?\(\s*(['"`])(.*?)\3/;

let total = 0;
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const m = TITLE.exec(line);
      if (!m) return;
      const title = m[4];
      const words = title.toLowerCase().split(/[^a-zçğıöşü]+/).filter(Boolean);
      const hits = words.filter((w) => STOPWORDS.has(w));
      const phrase = PHRASES.find((re) => re.test(title.toLowerCase()));
      if (!DIACRITIC.test(title) && hits.length === 0 && !phrase) return;
      total++;
      console.log(`${file}:${i + 1}: ${title.slice(0, 120)}${hits.length ? `   [${hits.join(',')}]` : ''}`);
    });
}
console.log(`\n${total} Turkish test title(s).`);
