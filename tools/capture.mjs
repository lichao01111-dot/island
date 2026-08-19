// 无头截图回归工具:一套命令对多个画质配置拍照 + 算平均色,检测"全黑/洗白"这类回归。
//
// 用法:
//   node tools/capture.mjs               # 拍默认几组预设
//   node tools/capture.mjs '?qa-noao=1'  # 额外拍自定义 query(可多个)
//
// 依赖:本机装有 Chrome/Chromium(默认找 macOS 的 Google Chrome,可用 CHROME 环境变量覆盖)。
// 输出:tools/screenshots/<label>.png,并在 stdout 打印平均 RGB 与亮度方差。
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import zlib from 'node:zlib';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB_DIR = path.join(ROOT, 'web');
const OUT_DIR = path.join(ROOT, 'tools', 'screenshots');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const PRESETS = [
  ['default', ''],
  ['noao', '?qa-noao=1'],
  ['noenv', '?qa-noenv=1'],
  ['grade-current', '?qa-grade=current'],
];

// ---- 极简静态服务器(只服务 web/ 内的文件) ----
function serve(port) {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.glb': 'application/octet-stream' };
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(WEB_DIR, rel);
    if (target !== WEB_DIR && !target.startsWith(WEB_DIR + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(target, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': mime[path.extname(target).toLowerCase()] ?? 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// ---- 极简 PNG 解码(8-bit,RGB/RGBA),只用来算平均色 ----
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error('unsupported png');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(height * stride);
  const prev = Buffer.alloc(stride);
  let p = 0;
  const paeth = (a, b, c) => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const left = i >= channels ? out[row + i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + left;
      else if (filter === 2) v = x + up;
      else if (filter === 3) v = x + ((left + up) >> 1);
      else if (filter === 4) v = x + paeth(left, up, upLeft);
      else v = x;
      out[row + i] = v & 0xff;
    }
    prev.set(out.subarray(row, row + stride));
  }
  return { width, height, channels, data: out };
}

function averageColor(file) {
  const { width, height, channels, data } = decodePng(fs.readFileSync(file));
  const step = Math.max(1, Math.floor((width * height) / 20000));
  let n = 0, r = 0, g = 0, b = 0, sum = 0, sum2 = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels;
      const R = data[i], G = data[i + 1], B = data[i + 2];
      const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      r += R; g += G; b += B; sum += lum; sum2 += lum * lum; n++;
    }
  }
  const mean = sum / n;
  return { r: r / n, g: g / n, b: b / n, lumMean: mean, lumVar: sum2 / n - mean * mean };
}

function screenshot(url, out) {
  return new Promise((resolve, reject) => {
    execFile(CHROME, [
      '--headless=new', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
      '--no-sandbox', '--hide-scrollbars', '--window-size=1280,800', '--virtual-time-budget=10000',
      `--screenshot=${out}`, url,
    ], { timeout: 90000 }, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  const extra = process.argv.slice(2).map((q) => [`custom-${q.replace(/[^a-z0-9-]/gi, '_').slice(0, 24)}`, q]);
  const jobs = [...PRESETS, ...extra];
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const server = await serve(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  console.log(`serving ${WEB_DIR} on :${port} (${jobs.length} shots)`);

  const rows = [];
  for (const [label, query] of jobs) {
    // 固定时刻:否则昼夜循环会让 A/B 之间的平均色噪声盖过真实差异
    const fixed = `qa-tod=0.3`;
    const full = query ? `${query}&${fixed}` : `?${fixed}`;
    const file = path.join(OUT_DIR, `${label}.png`);
    await screenshot(base + full, file);
    const avg = averageColor(file);
    rows.push([label, avg]);
    console.log(
      `${label.padEnd(20)} avgRGB=(${avg.r.toFixed(0)},${avg.g.toFixed(0)},${avg.b.toFixed(0)})  ` +
      `lum=${avg.lumMean.toFixed(0)} var=${avg.lumVar.toFixed(0)}`
    );
  }
  server.close();
  console.log(`\n截图已写入 ${OUT_DIR}`);
  return rows;
}

main().catch((err) => { console.error(err.message); process.exit(1); });
