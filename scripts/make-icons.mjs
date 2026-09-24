// Regenerate the PWA icon set.
//
//   npm run icons
//
// Writes into public/icons/. Dependency-free: the PNG encoder below is hand-rolled on node:zlib
// so adding icons never pulls in a graphics library.
//
// The artwork is defined once in unit coordinates (0..1, y down) and supersampled, so every size
// comes from the same description and edges antialias instead of aliasing at small sizes. Maskable
// variants shrink the artwork into the centre 80% safe zone that adaptive icons require.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SUPERSAMPLE = 4;
const MASK_SAFE = 0.72; // artwork scale for maskable icons (spec safe zone is 0.8)

const DARK = [0x20, 0x25, 0x26];
const PANEL = [0x2c, 0x32, 0x33];
const LCD = [0xc3, 0xcd, 0x9f];
const RED = [0xb7, 0x34, 0x2d];
const DIM = [0x4b, 0x53, 0x51];
const MARK = [0x77, 0x7f, 0x74];
const INK = [0xd6, 0xd8, 0xcd];

// Steps lit in pattern A's kick track — a recognisable groove, not a random sprinkle.
const LIT_STEPS = new Set([0, 4, 8, 10, 12]);

/** Paint order, bottom first. */
function buildShapes() {
  const shapes = [{ kind: 'rr', x: 0, y: 0, w: 1, h: 1, r: 0.2, color: DARK, inset: false }];
  const add = (s) => shapes.push({ inset: true, ...s });

  add({ kind: 'rr', x: 0.06, y: 0.06, w: 0.88, h: 0.88, r: 0.1, color: PANEL });
  add({ kind: 'rr', x: 0.17, y: 0.14, w: 0.66, h: 0.31, r: 0.04, color: LCD });
  add({ kind: 'dot', cx: 0.5, cy: 0.295, r: 0.092, color: RED });
  add({ kind: 'dot', cx: 0.28, cy: 0.295, r: 0.026, color: MARK });
  add({ kind: 'dot', cx: 0.72, cy: 0.295, r: 0.026, color: MARK });

  const TRACK = { x: 0.11, w: 0.78, y: 0.56, h: 0.115 };
  const cell = TRACK.w / 16;
  for (let i = 0; i < 16; i++) {
    const lit = LIT_STEPS.has(i);
    add({
      kind: 'rr',
      x: TRACK.x + cell * i + cell * 0.14,
      y: TRACK.y,
      w: cell * 0.72,
      h: TRACK.h,
      r: cell * 0.18,
      color: lit ? RED : DIM,
    });
  }

  const KNOBS = { y: 0.8, r: 0.052, from: 0.185, to: 0.815 };
  for (let i = 0; i < 7; i++) {
    const cx = KNOBS.from + ((KNOBS.to - KNOBS.from) / 6) * i;
    add({ kind: 'dot', cx, cy: KNOBS.y, r: KNOBS.r, color: INK });
    add({ kind: 'dot', cx, cy: KNOBS.y, r: KNOBS.r * 0.32, color: DARK });
  }
  return shapes;
}

function hits(shape, x, y) {
  if (shape.kind === 'dot') {
    const dx = x - shape.cx;
    const dy = y - shape.cy;
    return dx * dx + dy * dy <= shape.r * shape.r;
  }
  const { x: x0, y: y0, w, h } = shape;
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false;
  const r = shape.r ?? 0;
  if (r <= 0) return true;
  const cx = Math.max(x0 + r, Math.min(x, x0 + w - r));
  const cy = Math.max(y0 + r, Math.min(y, y0 + h - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function render(size, shapes, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / SUPERSAMPLE;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) * step) / size;
          const y = (py + (sy + 0.5) * step) / size;

          let color = null;
          for (let i = shapes.length - 1; i >= 0; i--) {
            const shape = shapes[i];
            // Maskable: shrink inset artwork toward the centre, leaving the backdrop full-bleed.
            let qx = x;
            let qy = y;
            if (maskable && shape.inset) {
              qx = (x - 0.5) / MASK_SAFE + 0.5;
              qy = (y - 0.5) / MASK_SAFE + 0.5;
            }
            if (hits(shape, qx, qy)) {
              color = shape.color;
              break;
            }
          }

          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 255;
          }
        }
      }

      const n = SUPERSAMPLE * SUPERSAMPLE;
      const o = (py * size + px) * 4;
      // Average only where a shape was hit, so the outside of the rounded corners stays clean
      // rather than being darkened by the zero-filled remainder.
      rgba[o] = a ? Math.round(r / (a / 255)) : 0;
      rgba[o + 1] = a ? Math.round(g / (a / 255)) : 0;
      rgba[o + 2] = a ? Math.round(b / (a / 255)) : 0;
      rgba[o + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

// --------------------------------------------------------------------------- PNG encoding

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None) — deflate does the real compression
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

const shapes = buildShapes();
/** [filename, edge length in px, maskable] */
/** @type {[string, number, boolean][]} */
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];

let width = 0;
for (const [, size] of targets) width = Math.max(width, String(size).length);

for (const [name, size, maskable] of targets) {
  const png = encodePng(size, render(size, shapes, maskable));
  const target = join(OUT_DIR, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, png);
  console.log(`${name.padEnd(26)} ${String(size).padStart(width)}px  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log(`\nwrote ${targets.length} icons to ${relative(process.cwd(), OUT_DIR)}`);
