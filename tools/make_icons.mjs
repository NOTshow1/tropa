// Рисует иконку приложения в PNG без внешних библиотек: градиент + белая метка с "тропой" из точек.
import fs from 'node:fs'; import zlib from 'node:zlib';
function png(size) {
  const S = size, buf = Buffer.alloc((S * 4 + 1) * S);
  const ss = 4; // суперсэмплинг
  const shade = (x, y) => {
    const u = x / S, v = y / S;
    // фон: диагональный градиент коралл -> янтарь
    const t = (u + v) / 2;
    let c = [255 + (255 - 255) * t, 92 + (181 - 92) * t, 74 + (71 - 74) * t];
    // метка
    const cx = 0.5, cy = 0.40, R = 0.21;
    const dx = u - cx, dy = v - cy, d = Math.hypot(dx, dy);
    const tipY = 0.78;
    let inPin = d < R;
    if (!inPin && v > cy && v < tipY) { const half = R * (1 - (v - cy) / (tipY - cy)) * 1.02; if (Math.abs(dx) < half) inPin = true; }
    if (inPin) c = d < R * 0.42 ? [255, 120, 70] : [255, 255, 255];
    // пунктир тропы снизу
    for (let i = 0; i < 4; i++) {
      const px = 0.2 + i * 0.12, py = 0.86 - Math.sin(i * 0.9) * 0.02;
      if (Math.hypot(u - px, v - py) < 0.028) c = [255, 255, 255];
    }
    return c;
  };
  for (let y = 0; y < S; y++) {
    buf[y * (S * 4 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0;
      for (let a = 0; a < ss; a++) for (let bb = 0; bb < ss; bb++) { const c = shade(x + (a + .5) / ss, y + (bb + .5) / ss); r += c[0]; g += c[1]; b += c[2]; }
      const o = y * (S * 4 + 1) + 1 + x * 4, n = ss * ss;
      buf[o] = r / n; buf[o + 1] = g / n; buf[o + 2] = b / n; buf[o + 3] = 255;
    }
  }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(buf)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [180, 192, 512]) fs.writeFileSync(new URL(`../icons/icon-${s}.png`, import.meta.url), png(s));
console.log('ok');
