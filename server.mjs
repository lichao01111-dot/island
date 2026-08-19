// 岛屿短链服务 + 静态站点,零依赖(只用 node: 内置模块)。
//
// 这是个可选组件:web/ 目录本身是一个完整的静态游戏,不跑这个服务照样能玩、
// 也照样能用长码分享。服务端只做两件事 ——
//   1. 把长长的岛屿码换成 6 个字符的短 id
//   2. 数一数有多少人来过你的岛
// 它刻意不认识游戏规则:只做结构校验和长度上限,存的是一段不透明的岛屿码。
// 岛屿码的合法性由客户端解码时自己判断,服务端不该复制一份游戏逻辑。
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(ROOT, 'web');
// 允许覆盖存储位置:测试要写到临时目录,部署时可能挂在别的卷上
const DATA_FILE = process.env.ISLAND_DATA || path.join(ROOT, 'data', 'islands.json');

const MAX_BODY = 64 * 1024;        // 400 个建筑的岛屿码约 12KB,给足余量
const DRAIN_LIMIT = 512 * 1024;    // 超限后还继续灌数据的,直接断链,不陪着耗内存
const MAX_NAME = 24;
const MAX_BUILDINGS = 400;
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 去掉 l/o/0/1,避免念错抄错
const ID_LENGTH = 6;
const MAX_MESSAGE = 60;            // 留言是一句话,不是一篇作文
const MAX_MESSAGES = 50;           // 每座岛只留最近这么多条
const MESSAGE_COOLDOWN_MS = 3000;  // 同一座岛的留言最小间隔,挡住手滑和刷屏
// 伴手礼:客人放在岛上、岛主回来领走的一件东西。
// 和岛屿码一样,服务端不认识 kind 到底是什么材料 —— 只当作一个短标识存着,
// 合法性由客户端解释(认不出来的就当没这件东西)。这样加新材料不必动服务端。
const MAX_GIFT_KIND = 16;
const MAX_GIFTS = 30;              // 领取前最多堆这么多件,再多就不收了
const GIFT_COOLDOWN_MS = 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---- 存储:一个 JSON 文件 ----
// 这个量级(一人一岛、几 KB)不值得上数据库。写入走"临时文件 + rename",
// 保证进程在写一半时被杀也不会留下半个坏文件。

/** @type {{ islands: Record<string, any> }} */
let store = { islands: {} };
/** @type {Map<number, string>} 种子 → id,用来做"同一座岛重复发布则更新" */
const bySeed = new Map();
let writing = Promise.resolve();

async function loadStore() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.islands && typeof parsed.islands === 'object') {
      store = { islands: parsed.islands };
    }
  } catch {
    // 首次启动没有数据文件是正常的
  }
  for (const [id, island] of Object.entries(store.islands)) {
    if (typeof island?.seed === 'number') bySeed.set(island.seed, id);
  }
}

function persist() {
  // 串行化写入:并发请求不会互相覆盖
  writing = writing.then(async () => {
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(store), 'utf8');
    await fs.rename(tmp, DATA_FILE);
  }).catch((err) => {
    console.error('[island] 写入存储失败:', err.message);
  });
  return writing;
}

// ---- 岛主令牌 ----
// 岛屿码是公开的,种子也在里面 —— 所以"谁能改这座岛"必须另外证明。
// 首次发布时发一枚随机令牌给岛主,服务端只存它的哈希;
// 之后任何写操作都要出示这枚令牌。这同时也是留言署名的唯一可信来源。

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** 定长比较,避免按字符逐位比较泄露信息 */
function tokenMatches(token, expectedHash) {
  if (typeof token !== 'string' || !token || !expectedHash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * 留言正文清洗。除了长度上限,还要去掉控制字符和零宽/双向排版字符 ——
 * 这些看不见的字符能让一条留言在别人屏幕上显示成完全不同的样子。
 */
function cleanMessage(text, limit) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')          // 控制字符
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '') // 零宽与双向排版
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

/** 伴手礼的材料标识:一个短的纯字母 token,服务端不解释它的含义 */
function cleanKind(kind) {
  if (typeof kind !== 'string') return '';
  const trimmed = kind.trim();
  return /^[A-Za-z]{1,16}$/.test(trimmed) && trimmed.length <= MAX_GIFT_KIND ? trimmed : '';
}

/**
 * 署名:不接受"你说你是谁"。只有出示了某座岛的令牌,才会用那座岛的名字署名,
 * 否则一律记作路过的客人。留言和伴手礼共用这一条规则 ——
 * 冒名顶替在协议层就不可能。
 */
function signature(payload) {
  const fromIsland = payload?.from ? store.islands[payload.from] : null;
  const verified = !!fromIsland && tokenMatches(payload?.fromToken, fromIsland.tokenHash);
  return {
    fromName: verified ? fromIsland.name : '路过的客人',
    fromIsland: verified ? payload.from : null,
  };
}

function newId() {
  for (let attempt = 0; attempt < 40; attempt++) {
    let id = '';
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    }
    if (!store.islands[id]) return id;
  }
  // 6 位 32 进制约有 10 亿种组合,连撞 40 次说明该扩位了,而不是继续硬试
  throw new Error('id space exhausted');
}

// ---- 岛屿码的结构校验 ----
// 只看"是不是一段能解出对象的 base64url JSON",不判断建筑类型是否合法 ——
// 那是客户端的事。这里防的是有人把服务端当免费对象存储用。

function decodeCode(code) {
  if (typeof code !== 'string' || !code || code.length > MAX_BODY) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null;
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (code.length % 4)) % 4);
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    if (!parsed || parsed.v !== 1) return null;
    if (!Array.isArray(parsed.buildings) || parsed.buildings.length > MAX_BUILDINGS) return null;
    if (!Number.isFinite(parsed.seed)) return null;
    return {
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, MAX_NAME) : '无名小岛',
      seed: Math.floor(parsed.seed),
      day: Number.isFinite(parsed.day) ? Math.max(1, Math.floor(parsed.day)) : 1,
    };
  } catch {
    return null;
  }
}

// ---- HTTP ----

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/**
 * 读取请求体,超限返回 null。
 * 超限时不立刻 destroy —— 那样客户端只会收到 ECONNRESET,不知道自己错在哪。
 * 改成继续把数据读完但不缓存(内存安全),好回一个明确的 400;
 * 只有对方灌到离谱的量才断链。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        chunks.length = 0;
        if (size > DRAIN_LIMIT) { req.destroy(); resolve(null); }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('aborted', () => resolve(null));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'islands', id?, 'visits'?]

  // POST /api/islands —— 发布,拿短 id
  if (parts.length === 2 && req.method === 'POST') {
    const raw = await readBody(req);
    if (raw === null) return sendJson(res, 400, { error: 'body too large' });
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: 'bad request' });
    }
    const meta = decodeCode(payload?.code);
    if (!meta) return sendJson(res, 400, { error: 'invalid island code' });

    // 同一座岛(同种子)重复发布 → 更新原记录,链接保持不变、访问数不清零。
    // 但种子是公开的(就写在岛屿码里),所以更新必须凭令牌 ——
    // 否则任何拿到你邀请链接的人都能把你的岛覆盖掉
    const existingId = bySeed.get(meta.seed);
    const previous = existingId ? store.islands[existingId] : null;
    // 加令牌之前发布的岛没有 tokenHash。这些岛认领一次即归属 ——
    // 直接拒绝会把真岛主也锁在门外,而在认领发生前它们的暴露面和以前完全一样,
    // 第一次重新发布就自动关上了
    const unclaimed = !!previous && !previous.tokenHash;
    if (previous && !unclaimed && !tokenMatches(payload?.token, previous.tokenHash)) {
      return sendJson(res, 403, { error: 'not your island' });
    }
    const id = existingId ?? newId();
    // 令牌只在首次发布(或认领遗留岛屿)时生成并返回一次,之后原样沿用
    const token = previous && !unclaimed ? payload.token : newToken();
    store.islands[id] = {
      code: payload.code,
      name: meta.name,
      day: meta.day,
      seed: meta.seed,
      tokenHash: unclaimed ? hashToken(token) : previous?.tokenHash ?? hashToken(token),
      visits: previous?.visits ?? 0,
      messages: previous?.messages ?? [],
      gifts: previous?.gifts ?? [],
      createdAt: previous?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    bySeed.set(meta.seed, id);
    await persist();
    return sendJson(res, 200, {
      id,
      token,
      visits: store.islands[id].visits,
      messages: store.islands[id].messages,
      gifts: store.islands[id].gifts,
    });
  }

  const id = parts[2];
  const island = id ? store.islands[id] : null;

  // GET /api/islands/:id —— 取回一座岛。注意:tokenHash 绝不外发
  if (parts.length === 3 && req.method === 'GET') {
    if (!island) return sendJson(res, 404, { error: 'not found' });
    // 伴手礼只报件数,不报清单:那是留给岛主领取时才展开的东西
    return sendJson(res, 200, {
      code: island.code, name: island.name, day: island.day,
      visits: island.visits, messages: island.messages ?? [],
      giftCount: (island.gifts ?? []).length,
    });
  }

  // POST /api/islands/:id/visits —— 记一次到访(只记数,不记是谁、不记 IP)
  if (parts.length === 4 && parts[3] === 'visits' && req.method === 'POST') {
    if (!island) return sendJson(res, 404, { error: 'not found' });
    island.visits += 1;
    await persist();
    return sendJson(res, 200, { visits: island.visits });
  }

  // POST /api/islands/:id/messages —— 留言。署名规则见 signature()
  if (parts.length === 4 && parts[3] === 'messages' && req.method === 'POST') {
    if (!island) return sendJson(res, 404, { error: 'not found' });
    const raw = await readBody(req);
    if (raw === null) return sendJson(res, 400, { error: 'body too large' });
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: 'bad request' });
    }
    const text = cleanMessage(payload?.text, MAX_MESSAGE);
    if (!text) return sendJson(res, 400, { error: 'empty message' });

    const now = Date.now();
    const last = island.messages?.[island.messages.length - 1];
    if (last && now - last.at < MESSAGE_COOLDOWN_MS) {
      return sendJson(res, 429, { error: 'too fast' });
    }

    island.messages = island.messages ?? [];
    island.messages.push({
      id: crypto.randomUUID(),
      text,
      ...signature(payload),
      at: now,
    });
    // 只留最近的若干条,存储不会无限长
    if (island.messages.length > MAX_MESSAGES) {
      island.messages = island.messages.slice(-MAX_MESSAGES);
    }
    await persist();
    return sendJson(res, 200, { messages: island.messages });
  }

  // POST /api/islands/:id/gifts —— 客人在岛上留下一件伴手礼。
  // 一次一件:数量由"放了几次"表达,不接受客户端自报数量,免得有人一发一万个。
  if (parts.length === 4 && parts[3] === 'gifts' && req.method === 'POST') {
    if (!island) return sendJson(res, 404, { error: 'not found' });
    const raw = await readBody(req);
    if (raw === null) return sendJson(res, 400, { error: 'body too large' });
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: 'bad request' });
    }
    const kind = cleanKind(payload?.kind);
    if (!kind) return sendJson(res, 400, { error: 'bad gift' });

    island.gifts = island.gifts ?? [];
    // 满了就明说,而不是默默丢掉 —— 客人那件东西是从自己背包里扣的
    if (island.gifts.length >= MAX_GIFTS) return sendJson(res, 409, { error: 'gift box full' });
    const now = Date.now();
    const last = island.gifts[island.gifts.length - 1];
    if (last && now - last.at < GIFT_COOLDOWN_MS) return sendJson(res, 429, { error: 'too fast' });

    island.gifts.push({ id: crypto.randomUUID(), kind, ...signature(payload), at: now });
    await persist();
    return sendJson(res, 200, { giftCount: island.gifts.length });
  }

  // DELETE /api/islands/:id/gifts —— 岛主一次领走全部伴手礼。
  // 返回领到的清单再清空:客户端要靠这份清单把东西加进背包,所以必须先给再删。
  if (parts.length === 4 && parts[3] === 'gifts' && req.method === 'DELETE') {
    if (!island) return sendJson(res, 404, { error: 'not found' });
    const raw = await readBody(req);
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch { /* 空体也允许,下面的令牌校验会拦住 */ }
    if (!tokenMatches(payload?.token, island.tokenHash)) {
      return sendJson(res, 403, { error: 'not your island' });
    }
    const claimed = island.gifts ?? [];
    island.gifts = [];
    await persist();
    return sendJson(res, 200, { claimed });
  }

  // DELETE /api/islands/:id/messages/:msgId —— 岛主删自己岛上的留言
  if (parts.length === 5 && parts[3] === 'messages' && req.method === 'DELETE') {
    if (!island) return sendJson(res, 404, { error: 'not found' });
    const raw = await readBody(req);
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch { /* 空体也允许,下面的令牌校验会拦住 */ }
    if (!tokenMatches(payload?.token, island.tokenHash)) {
      return sendJson(res, 403, { error: 'not your island' });
    }
    island.messages = (island.messages ?? []).filter((m) => m.id !== parts[4]);
    await persist();
    return sendJson(res, 200, { messages: island.messages });
  }

  return sendJson(res, 404, { error: 'not found' });
}

async function serveStatic(req, res, url) {
  // 只允许 web/ 内的文件:normalize 之后必须仍在 WEB_DIR 下
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const target = path.resolve(WEB_DIR, rel);
  if (target !== WEB_DIR && !target.startsWith(WEB_DIR + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    // 带 ?visit= 的链接也走单页入口
    try {
      const html = await fs.readFile(path.join(WEB_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(html);
    } catch {
      res.writeHead(404).end('not found');
    }
  }
}

export async function startServer({ port = 0, host = '127.0.0.1' } = {}) {
  await loadStore();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const done = url.pathname.startsWith('/api/')
      ? handleApi(req, res, url)
      : serveStatic(req, res, url);
    done.catch((err) => {
      console.error('[island]', err.message);
      if (!res.headersSent) sendJson(res, 500, { error: 'server error' });
    });
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  return { server, port: server.address().port };
}

// 直接运行(而不是被测试 import)时才真正起服务
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT || process.argv.find((a) => a.startsWith('--port='))?.slice(7) || 8003);
  const host = process.env.HOST || '0.0.0.0';
  if (process.argv.includes('--dev')) {
    // 开发模式:顺带盯着源码重新打包,一个进程搞定
    const esbuild = await import('esbuild');
    const ctx = await esbuild.context({
      entryPoints: ['src/main.ts'], bundle: true, format: 'iife',
      target: 'es2020', outfile: 'web/main.js', sourcemap: 'inline',
    });
    await ctx.watch();
    console.log('[island] 已开启源码监听');
  }
  const { port: actual } = await startServer({ port, host });
  console.log(`[island] http://localhost:${actual}`);
}
