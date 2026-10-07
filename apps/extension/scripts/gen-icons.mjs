// Generates Perch's icons — the extension's (16/32/48/128 px) and the web
// reader's (128/192/512 px, for the PWA manifest) — as PNGs with no external
// dependencies — just Node's built-in zlib. The mark is a rounded indigo square
// with a white RSS motif (corner dot + two broadcast arcs).
//
// Run: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icon');
const SIZES = [16, 32, 48, 128];
const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/public');
const WEB_SIZES = [128, 192, 512];

const BG = [24, 24, 27]; // zinc-900 — monochrome, no brand colour
const FG = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const px = Buffer.alloc(size * 4 * size); // transparent
  const s = size;
  const radius = s * 0.22;
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= s || y >= s) return;
    const i = (y * s + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, radius), s - radius);
    const cy = Math.min(Math.max(y, radius), s - radius);
    return (
      Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius + 0.5 ||
      (x >= radius && x < s - radius) ||
      (y >= radius && y < s - radius)
    );
  };

  // Background rounded square.
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (inRounded(x, y)) set(x, y, BG);
    }
  }

  // RSS motif anchored near the lower-left, scaled to the icon.
  const ox = s * 0.3;
  const oy = s * 0.7;
  const dotR = Math.max(1, s * 0.09);
  const stroke = Math.max(1, s * 0.1);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x + 0.5 - ox;
      const dy = y + 0.5 - oy;
      const dist = Math.hypot(dx, dy);
      // Only the upper-right quadrant of each ring (broadcast arcs).
      const arc = dx >= -stroke * 0.3 && dy <= stroke * 0.3;
      if (dist <= dotR) set(x, y, FG);
      else if (arc && Math.abs(dist - s * 0.28) <= stroke / 2) set(x, y, FG);
      else if (arc && Math.abs(dist - s * 0.46) <= stroke / 2) set(x, y, FG);
    }
  }

  return encodePng(s, px);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `${size}.png`);
  writeFileSync(file, draw(size));
  console.log('wrote', file);
}
mkdirSync(WEB_DIR, { recursive: true });
for (const size of WEB_SIZES) {
  const file = resolve(WEB_DIR, `icon-${size}.png`);
  writeFileSync(file, draw(size));
  console.log('wrote', file);
}
