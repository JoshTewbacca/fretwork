// Generates the PWA icon set as valid PNGs using nothing but node:zlib and
// hand-rolled PNG chunk encoding (no image libraries, per project constraints).
//
// Produces, in app/public/:
//   icon-192.png          192x192, purpose "any"
//   icon-512.png          512x512, purpose "any"
//   apple-touch-icon.png  180x180 (iOS home screen icon, opaque background)
//
// Mark: solid near-black background (#0e0f12) with six evenly spaced thin
// light vertical bars suggesting guitar strings. Pure geometry, no text.

import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');

const BG = [0x0e, 0x0f, 0x12]; // #0e0f12
const STRING_COLOR = [0xb8, 0xc0, 0xce]; // light cool gray

// ---------------------------------------------------------------------------
// CRC32 (PNG chunk checksums)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Encode an RGBA pixel buffer (Uint8Array, length = width*height*4) as a PNG.
 */
function encodePng(width, height, rgba) {
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // color type: RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  const ihdr = chunk('IHDR', ihdrData);

  // Raw scanlines: each row prefixed with a filter-type byte (0 = None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }
  const compressed = deflateSync(raw, { level: 9 });
  const idat = chunk('IDAT', compressed);

  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
}

// ---------------------------------------------------------------------------
// Icon drawing
// ---------------------------------------------------------------------------

function setPixel(rgba, width, x, y, color, alpha = 255) {
  const height = rgba.length / (width * 4);
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const idx = (y * width + x) * 4;
  rgba[idx] = color[0];
  rgba[idx + 1] = color[1];
  rgba[idx + 2] = color[2];
  rgba[idx + 3] = alpha;
}

/**
 * Draw the Fretwork mark into a size x size RGBA buffer:
 * solid dark background + six evenly spaced thin vertical strings.
 */
function drawIcon(size) {
  const rgba = new Uint8Array(size * size * 4);

  // Background fill (fully opaque).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPixel(rgba, size, x, y, BG, 255);
    }
  }

  const numStrings = 6;
  const marginX = Math.round(size * 0.22);
  const marginY = Math.round(size * 0.16);
  const usableWidth = size - marginX * 2;
  const spacing = usableWidth / (numStrings - 1);
  const lineWidth = Math.max(2, Math.round(size * 0.016));
  const top = marginY;
  const bottom = size - marginY;

  for (let i = 0; i < numStrings; i++) {
    const centerX = Math.round(marginX + i * spacing);
    const halfWidth = Math.floor(lineWidth / 2);
    for (let y = top; y < bottom; y++) {
      for (let dx = -halfWidth; dx < lineWidth - halfWidth; dx++) {
        setPixel(rgba, size, centerX + dx, y, STRING_COLOR, 255);
      }
    }
  }

  return rgba;
}

// ---------------------------------------------------------------------------
// Verification: re-read the file back and check the PNG signature + IHDR.
// ---------------------------------------------------------------------------

function verifyPng(path, expectedWidth, expectedHeight) {
  const buf = readFileSync(path);
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) {
      throw new Error(`${path}: bad PNG signature at byte ${i}`);
    }
  }
  // IHDR is always the first chunk, immediately after the 8-byte signature:
  // 4 bytes length, 4 bytes "IHDR", then 13 bytes of IHDR data.
  const ihdrType = buf.toString('ascii', 12, 16);
  if (ihdrType !== 'IHDR') {
    throw new Error(`${path}: expected IHDR as first chunk, got "${ihdrType}"`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf.readUInt8(24);
  const colorType = buf.readUInt8(25);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${path}: expected ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`${path}: expected 8-bit RGBA, got bitDepth=${bitDepth} colorType=${colorType}`);
  }
  return { width, height };
}

function writeIcon(filename, size) {
  const rgba = drawIcon(size);
  const png = encodePng(size, size, rgba);
  const outPath = join(outDir, filename);
  writeFileSync(outPath, png);
  const info = verifyPng(outPath, size, size);
  console.log(`wrote ${outPath} (${png.length} bytes, verified ${info.width}x${info.height})`);
}

writeIcon('icon-192.png', 192);
writeIcon('icon-512.png', 512);
writeIcon('apple-touch-icon.png', 180);

console.log('done.');
