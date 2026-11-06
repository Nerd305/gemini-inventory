#!/usr/bin/env node
/**
 * Generates the app icons in public/ from one vial drawing (no dependencies, Node 22).
 *
 *   node scripts/make-icons.mjs
 *
 * Writes public/icons/icon-192.png, icon-512.png (rounded, transparent corners), icon-512-maskable.png
 * (full-bleed, drawing kept inside the central 80 % safe zone), public/apple-touch-icon.png (180px, opaque:
 * iOS fills transparency with black) and public/favicon.svg. The PNGs are committed; rerun this only to
 * change the drawing.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BG = '#2563eb'; // the app's brand blue (header title)
const GLASS = '#ffffff';
const LIQUID = '#bfdbfe';

// [x, y, width, height, corner radius] in a 1024-unit square. Every shape stays within 410 units of the
// centre, the maskable "safe circle".
const VIAL = [
  { box: [392, 180, 240, 80, 24], fill: GLASS }, // cap
  { box: [432, 250, 160, 100, 0], fill: GLASS }, // neck
  { box: [352, 330, 320, 530, 70], fill: GLASS }, // body
  { box: [392, 560, 240, 260, 40], fill: LIQUID }, // liquid
];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function inside([x, y, w, h, r], px, py) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  return d <= 0;
}

/** size × size RGBA buffer, 4×4 supersampled; edges get straight (non-premultiplied) alpha. */
function render(size, { rounded }) {
  const shapes = [{ box: [0, 0, 1024, 1024, rounded ? 200 : 0], fill: BG }, ...VIAL];
  const colors = shapes.map((s) => hex(s.fill));
  const out = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, covered = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const px = ((x + (sx + 0.5) / N) / size) * 1024;
          const py = ((y + (sy + 0.5) / N) / size) * 1024;
          let hit = -1;
          for (let i = shapes.length - 1; i >= 0; i--) if (inside(shapes[i].box, px, py)) { hit = i; break; }
          if (hit >= 0) { r += colors[hit][0]; g += colors[hit][1]; b += colors[hit][2]; covered++; }
        }
      }
      const o = (y * size + x) * 4;
      if (covered) {
        out[o] = Math.round(r / covered);
        out[o + 1] = Math.round(g / covered);
        out[o + 2] = Math.round(b / covered);
        out[o + 3] = Math.round((covered / (N * N)) * 255);
      }
    }
  }
  return out;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { rows[y * (size * 4 + 1)] = 0; rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const write = (rel, data) => {
  const file = path.join(root, 'public', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`wrote public/${rel} (${data.length} bytes)`);
};

write('icons/icon-192.png', png(192, render(192, { rounded: true })));
write('icons/icon-512.png', png(512, render(512, { rounded: true })));
write('icons/icon-512-maskable.png', png(512, render(512, { rounded: false })));
write('apple-touch-icon.png', png(180, render(180, { rounded: false })));

const rect = ([x, y, w, h, r], fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${r ? ` rx="${r}"` : ''} fill="${fill}"/>`;
write('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${rect([0, 0, 1024, 1024, 200], BG)}${VIAL.map((s) => rect(s.box, s.fill)).join('')}</svg>\n`);
