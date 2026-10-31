// Draws KAREN's mark once and writes both outputs: the 512 px app icon and the SVG.
// Geometry lives here and nowhere else, so the tray, the site and the README cannot drift.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const S = 512;
const TAU = Math.PI * 2;

const BG = [8, 8, 10];
const ACCENT = [225, 29, 46];
const SOFT = [255, 90, 102];
const GLOW = [90, 12, 20];

const R = {
  tile: 118, // rounded-square corner radius
  ringOuter: 208,
  ringMid: 166,
  coil: 138,
  coilSegments: 24,
  coilGap: 0.42, // fraction of each segment that is empty
  coilWidth: 9,
  coreOuter: 54,
  coreInner: 18,
};

/** Distance from the centre, and the angle, for one pixel. */
const at = (x, y) => {
  const dx = x - S / 2;
  const dy = y - S / 2;
  return { d: Math.hypot(dx, dy), a: (Math.atan2(dy, dx) + TAU) % TAU };
};

const inTile = (x, y) => {
  const r = R.tile;
  const cx = Math.min(Math.max(x, r), S - r);
  const cy = Math.min(Math.max(y, r), S - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** Ring mask with 1.25 px feathering so the rings are not jagged at 512 px. */
const ring = (d, radius, width) => {
  const edge = Math.abs(d - radius) - width / 2;
  return Math.max(0, Math.min(1, 1 - edge));
};

const coil = (d, a) => {
  if (Math.abs(d - R.coil) > R.coilWidth / 2) return 0;
  const seg = TAU / R.coilSegments;
  const local = (a % seg) / seg;
  return local > R.coilGap / 2 && local < 1 - R.coilGap / 2 ? 1 : 0;
};

const px = Buffer.alloc(S * S * 4);

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const fx = x + 0.5;
    const fy = y + 0.5;
    if (!inTile(fx, fy)) {
      px[i + 3] = 0;
      continue;
    }

    const { d, a } = at(fx, fy);

    // Base: near-black with a faint red bloom behind the core.
    const bloom = Math.max(0, 1 - d / 300) ** 2.4;
    let r = BG[0] + GLOW[0] * bloom * 0.55;
    let g = BG[1] + GLOW[1] * bloom * 0.55;
    let b = BG[2] + GLOW[2] * bloom * 0.55;

    const mix = (c, t) => {
      r = r * (1 - t) + c[0] * t;
      g = g * (1 - t) + c[1] * t;
      b = b * (1 - t) + c[2] * t;
    };

    // Three concentric rings, brighter as they get closer to the core.
    mix(ACCENT, ring(d, R.ringOuter, 3) * 0.75);
    mix(SOFT, ring(d, R.ringMid, 4) * 0.5);

    // Segmented coil.
    if (coil(d, a)) mix(SOFT, 0.9);

    // Core: a hot disc with a light inner spot, the only gradient in the mark.
    if (d < R.coreOuter) {
      const t = Math.max(0, Math.min(1, 1 - (d - R.coreInner) / (R.coreOuter - R.coreInner)));
      mix(ACCENT, 0.9);
      mix([255, 214, 218], t ** 1.6 * 0.85);
    }

    px[i] = Math.round(Math.min(255, r));
    px[i + 1] = Math.round(Math.min(255, g));
    px[i + 2] = Math.round(Math.min(255, b));
    px[i + 3] = 255;
  }
}

// --- PNG ---
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

let crcTable;
const crc32 = (buf) => {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync('electron/icon.png', png);

// --- SVG: the same geometry, expressed with the same numbers. ---
const c = S / 2;
let coilPath = '';
for (let n = 0; n < R.coilSegments; n++) {
  const start = (n / R.coilSegments) * TAU + (R.coilGap / 2) * (TAU / R.coilSegments);
  const end = ((n + 1) / R.coilSegments) * TAU - (R.coilGap / 2) * (TAU / R.coilSegments);
  const x1 = c + Math.cos(start) * R.coil;
  const y1 = c + Math.sin(start) * R.coil;
  const x2 = c + Math.cos(end) * R.coil;
  const y2 = c + Math.sin(end) * R.coil;
  coilPath += `M${x1.toFixed(1)} ${y1.toFixed(1)}A${R.coil} ${R.coil} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="KAREN">
  <defs>
    <radialGradient id="karen-core" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffe0e3"/>
      <stop offset="0.55" stop-color="#ff5a66"/>
      <stop offset="1" stop-color="#e11d2e"/>
    </radialGradient>
    <radialGradient id="karen-bloom" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#5a0c14" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#08080a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="${R.tile}" fill="#08080a"/>
  <circle cx="${c}" cy="${c}" r="300" fill="url(#karen-bloom)"/>
  <circle cx="${c}" cy="${c}" r="${R.ringOuter}" fill="none" stroke="#e11d2e" stroke-width="3" opacity="0.75"/>
  <circle cx="${c}" cy="${c}" r="${R.ringMid}" fill="none" stroke="#ff5a66" stroke-width="4" opacity="0.5"/>
  <path d="${coilPath}" fill="none" stroke="#ff5a66" stroke-width="${R.coilWidth}" opacity="0.9"/>
  <circle cx="${c}" cy="${c}" r="${R.coreOuter}" fill="url(#karen-core)"/>
</svg>
`;

mkdirSync('site/assets', { recursive: true });
writeFileSync('site/assets/karen-mark.svg', svg);
// The app serves its dist root, so the favicon needs a copy under public/.
mkdirSync('app/public', { recursive: true });
writeFileSync('app/public/karen-mark.svg', svg);

console.log(`electron/icon.png ${(png.length / 1024).toFixed(1)} KB · site/assets/karen-mark.svg ${(svg.length / 1024).toFixed(1)} KB`);
