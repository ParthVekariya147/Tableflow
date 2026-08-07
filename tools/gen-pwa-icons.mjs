/**
 * Generates the PWA icon set for restaurant-admin as real PNGs, with no image
 * dependencies — Node's zlib is enough to write a valid RGBA PNG by hand.
 *
 * Mark: a bold "T" (TableFlow) knocked out of the platform amber tile.
 *
 * Re-run after a platform rebrand (change BRAND below):
 *   node tools/gen-pwa-icons.mjs apps/restaurant-admin/public
 *
 * These are the *platform* icons — a home-screen icon is baked in at install
 * time, so it can't be per-tenant the way TenantThemeProvider theming is.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const BRAND = [0x8c, 0x50, 0x00]; // #8c5000 platform primary
const INK = [0xff, 0xff, 0xff];

// ── CRC32 ────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 10,11,12 = compression/filter/interlace = 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Drawing ──────────────────────────────────────────────────────────────
/** Coverage of a rounded rect at a pixel centre, lightly supersampled. */
function roundedRectCoverage(px, py, x, y, w, h, r) {
  const SS = 3;
  let hits = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const cx = px + (sx + 0.5) / SS;
      const cy = py + (sy + 0.5) / SS;
      if (cx < x || cx > x + w || cy < y || cy > y + h) continue;
      // Corner circles
      const dxL = x + r - cx, dxR = cx - (x + w - r);
      const dyT = y + r - cy, dyB = cy - (y + h - r);
      const ox = Math.max(dxL, dxR, 0);
      const oy = Math.max(dyT, dyB, 0);
      if (ox * ox + oy * oy <= r * r) hits++;
    }
  }
  return hits / (SS * SS);
}

function blend(dst, i, color, a) {
  if (a <= 0) return;
  for (let c = 0; c < 3; c++) {
    dst[i + c] = Math.round(dst[i + c] * (1 - a) + color[c] * a);
  }
  dst[i + 3] = Math.max(dst[i + 3], Math.round(255 * a));
}

/**
 * @param size    icon edge in px
 * @param inset   fraction of the tile kept clear around the mark (maskable
 *                icons need the mark inside the ~80% safe zone)
 * @param bleed   true = background fills the whole square (maskable), false =
 *                background is a rounded tile on transparency
 */
function drawIcon(size, { inset, bleed }) {
  const buf = Buffer.alloc(size * size * 4, 0);

  // Background tile
  const bg = bleed
    ? { x: 0, y: 0, w: size, h: size, r: 0 }
    : { x: 0, y: 0, w: size, h: size, r: size * 0.22 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = roundedRectCoverage(x, y, bg.x, bg.y, bg.w, bg.h, bg.r);
      blend(buf, (y * size + x) * 4, BRAND, a);
    }
  }

  // "T" mark, centred inside the safe box
  const box = size * (1 - inset * 2);
  const ox = size * inset;
  const oy = size * inset;
  const barW = box * 0.86;
  const barH = box * 0.20;
  const stemW = box * 0.21;
  const stemH = box * 0.80;
  const barX = ox + (box - barW) / 2;
  const barY = oy + (box - stemH) / 2;
  const stemX = ox + (box - stemW) / 2;
  const radius = Math.min(barH, stemW) * 0.28;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = Math.max(
        roundedRectCoverage(x, y, barX, barY, barW, barH, radius),
        roundedRectCoverage(x, y, stemX, barY, stemW, stemH, radius),
      );
      blend(buf, (y * size + x) * 4, INK, a);
    }
  }
  return encodePng(size, size, buf);
}

const files = [
  ["icon-192.png", drawIcon(192, { inset: 0.16, bleed: false })],
  ["icon-512.png", drawIcon(512, { inset: 0.16, bleed: false })],
  // Maskable: full-bleed background, mark pulled well inside the safe zone.
  ["icon-maskable-512.png", drawIcon(512, { inset: 0.26, bleed: true })],
  // iOS home screen: no transparency, no rounding (iOS masks it itself).
  ["apple-touch-icon.png", drawIcon(180, { inset: 0.18, bleed: true })],
];

for (const [name, data] of files) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
