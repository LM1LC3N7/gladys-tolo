// Generates cover.png (800x534) for gladys-tolo: plain Node, no dependency.
// A steam room: tiled wall, a steam generator with its control box, rising
// steam, a water drop, a thermometer and a local network sign, on a cool
// teal gradient (no brand logo). Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    set(x, y, [40 + 30 * t, 110 + 40 * t, 130 + 40 * t]);
  }
}
const white = [255, 255, 255];
const dark = [22, 40, 70];
const water = [90, 180, 230];
const steel = [120, 130, 140];
const heat = [235, 85, 50];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
// Rounded rectangle, anti-aliased corners.
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};

// Soft halo.
disc(400, 260, 250, white, 0.08);

// Tiled wall.
for (let i = 0; i < 11; i += 1) {
  box(0, 20 + i * 48, W, 22 + i * 48, 0, white, 0.12);
}
for (let i = 0; i < 17; i += 1) {
  box(20 + i * 48, 0, 22 + i * 48, H, 0, white, 0.12);
}

// Bench on the right.
box(560, 340, 760, 362, 6, white, 0.85);
box(575, 362, 590, 450, 4, white, 0.85);
box(730, 362, 745, 450, 4, white, 0.85);

// The steam generator: a steel body, a control box with a display and keys.
box(250, 280, 470, 460, 22, steel);
box(275, 305, 445, 365, 12, dark);
box(290, 318, 380, 352, 6, water);
disc(410, 335, 12, heat);
for (const x of [290, 340, 390]) {
  box(x, 390, x + 40, 430, 8, dark, 0.5);
}

// Steam rising from the outlet.
for (const [x, y, r] of [
  [330, 240, 34],
  [380, 220, 40],
  [340, 175, 30],
  [395, 160, 34],
  [360, 115, 26],
  [410, 100, 22],
]) {
  disc(x, y, r, white, 0.75);
}

// Water drop on the bench.
disc(660, 300, 24, water);
for (let k = 0; k <= 40; k += 1) {
  disc(660, 300 - k * 1.2, 24 * (1 - k / 40), water);
}

// Thermometer on the left.
box(120, 150, 150, 380, 15, white);
box(128, 230, 142, 372, 7, heat);
disc(135, 385, 26, white);
disc(135, 385, 17, heat);

// Local network sign: three linked nodes (no cloud).
line(600, 140, 690, 110, 6, white);
line(600, 140, 690, 170, 6, white);
disc(600, 140, 18, white);
disc(690, 110, 14, white);
disc(690, 170, 14, white);
// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
