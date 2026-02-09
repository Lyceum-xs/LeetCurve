#!/usr/bin/env node
/**
 * LeetCurve - 图标生成脚本
 * 使用 Node.js 内置模块生成 PNG 图标，无需额外依赖
 *
 * Usage: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---- CRC32 ---- */
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* ---- PNG Chunk ---- */
function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeB, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, typeB, data, crc]);
}

/* ---- 生成带曲线图案的 PNG ---- */
function createIcon(size) {
  const w = size, h = size;
  // 每行 = 1字节 filter + w*4 字节 RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));

  // 颜色定义
  const BG = [99, 102, 241];   // 主色 indigo-500
  const BG2 = [139, 92, 246];  // 渐变 violet-500
  const WHITE = [255, 255, 255];

  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0; // filter: None

    for (let x = 0; x < w; x++) {
      const px = row + 1 + x * 4;

      // 渐变背景（左上→右下）
      const t = (x + y) / (w + h);
      const r = Math.round(BG[0] * (1 - t) + BG2[0] * t);
      const g = Math.round(BG[1] * (1 - t) + BG2[1] * t);
      const b = Math.round(BG[2] * (1 - t) + BG2[2] * t);
      let alpha = 255;

      // 圆角蒙版
      const radius = size * 0.2;
      const inset = radius;
      let insideRound = true;
      const corners = [
        [inset, inset],
        [w - inset, inset],
        [inset, h - inset],
        [w - inset, h - inset]
      ];
      for (const [cx, cy] of corners) {
        if (
          (x < inset || x >= w - inset) &&
          (y < inset || y >= h - inset)
        ) {
          const dx = x < inset ? x - cx : x - cx;
          const dy = y < inset ? y - cy : y - cy;
          if (Math.sqrt(dx * dx + dy * dy) > radius) {
            insideRound = false;
          }
        }
      }

      if (!insideRound) {
        raw[px] = 0; raw[px + 1] = 0; raw[px + 2] = 0; raw[px + 3] = 0;
        continue;
      }

      // 绘制上升曲线图案（代表学习曲线）
      const margin = size * 0.2;
      const curveX = (x - margin) / (w - 2 * margin); // 0~1
      const curveBaseY = h - margin;
      const curveTopY = margin;

      if (curveX >= 0 && curveX <= 1) {
        // 指数增长曲线: y = 1 - e^(-3x)
        const curveVal = 1 - Math.exp(-3 * curveX);
        const curvePixelY = curveBaseY - curveVal * (curveBaseY - curveTopY);
        const lineThickness = Math.max(1.5, size * 0.06);

        const dist = Math.abs(y - curvePixelY);
        if (dist < lineThickness) {
          const blend = 1 - dist / lineThickness;
          const a = Math.min(1, blend * 1.5);
          raw[px]     = Math.round(r * (1 - a) + WHITE[0] * a);
          raw[px + 1] = Math.round(g * (1 - a) + WHITE[1] * a);
          raw[px + 2] = Math.round(b * (1 - a) + WHITE[2] * a);
          raw[px + 3] = alpha;
          continue;
        }
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = alpha;
    }
  }

  // 组装 PNG
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- 主流程 ---- */
const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const png = createIcon(size);
  const out = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`✅ ${out}  (${size}×${size}, ${png.length} bytes)`);
}

console.log('\n图标生成完成！');
