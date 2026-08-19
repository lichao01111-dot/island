// 短链服务的接口测试:真的起一个服务、真的发 HTTP 请求、真的落盘。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// 让服务把数据写到临时目录,别污染仓库里的 data/
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'island-test-'));
process.env.ISLAND_DATA = path.join(tmpRoot, 'islands.json');

const { startServer } = await import('../server.mjs');
const { port } = await startServer({ port: 0 });
const base = `http://127.0.0.1:${port}`;

function assert(condition, message) { if (!condition) throw new Error(message); }

function makeCode(overrides = {}) {
  const snapshot = {
    v: 1, name: '望海屿', seed: 4242, day: 7,
    buildings: [{ kind: 'beacon', x: 1, z: 2 }],
    ...overrides,
  };
  return Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ---- 发布 ----
const published = await api('POST', '/api/islands', { code: makeCode() });
assert(published.status === 200, '合法岛屿码应发布成功');
assert(/^[a-z0-9]{6}$/.test(published.body.id), `短 id 应是 6 位小写字母数字,拿到 ${published.body.id}`);
assert(published.body.visits === 0, '新岛的到访数应是 0');
const id = published.body.id;

// ---- 取回 ----
const fetched = await api('GET', `/api/islands/${id}`);
assert(fetched.status === 200 && fetched.body.name === '望海屿', '应能按短 id 取回岛屿');
assert(fetched.body.day === 7, '天数应一并返回');
assert(fetched.body.code === makeCode(), '存进去的岛屿码应原样取回');
assert(fetched.body.visits === 0, '光是取回不该算一次到访');

// ---- 计数 ----
assert((await api('POST', `/api/islands/${id}/visits`)).body.visits === 1, '第一次到访应计为 1');
assert((await api('POST', `/api/islands/${id}/visits`)).body.visits === 2, '到访数应累加');
assert((await api('GET', `/api/islands/${id}`)).body.visits === 2, '取回时应带上到访数');

// ---- 岛主凭证:种子是公开的,所以"能不能改这座岛"必须另外证明 ----
const token = published.body.token;
assert(typeof token === 'string' && token.length >= 16, '首次发布应发一枚岛主凭证');
assert(!JSON.stringify(fetched.body).includes(token), '取回岛屿时绝不能把凭证发出去');
assert(!('tokenHash' in fetched.body), '凭证哈希也不该外发');

// 这正是上一版的漏洞:拿着公开链接里的种子就能覆盖别人的岛
const hijack = await api('POST', '/api/islands', { code: makeCode({ name: '我把你的岛占了' }) });
assert(hijack.status === 403, `没凭证就改别人的岛应被拒绝,拿到 ${hijack.status}`);
const stillMine = await api('GET', `/api/islands/${id}`);
assert(stillMine.body.name === '望海屿', '被拒绝的改写不该动到原岛');
assert((await api('POST', '/api/islands', { code: makeCode(), token: 'wrong-token' })).status === 403,
  '错误的凭证同样应被拒绝');

// ---- 带上凭证重复发布:更新原记录,不生成新链接、不清零到访数 ----
const republished = await api('POST', '/api/islands', {
  code: makeCode({ name: '望海屿二期', buildings: [{ kind: 'dock', x: 3, z: 4 }] }),
  token,
});
assert(republished.status === 200, '带上凭证应能更新自己的岛');
assert(republished.body.id === id, '同一个种子重复发布应复用原来的短 id');
assert(republished.body.visits === 2, '重新发布不该清零到访数');
assert(republished.body.token === token, '重复发布不该换掉凭证');
const updated = await api('GET', `/api/islands/${id}`);
assert(updated.body.name === '望海屿二期', '重新发布应更新岛屿内容');

// 不同种子应拿到不同的 id
const other = await api('POST', '/api/islands', { code: makeCode({ seed: 999 }) });
assert(other.body.id !== id, '不同的岛应有不同的短 id');

// ---- 拒绝垃圾 ----
assert((await api('POST', '/api/islands', { code: '不是base64' })).status === 400,
  '非 base64 的码应被拒绝');
assert((await api('POST', '/api/islands', { code: 'aGVsbG8' })).status === 400,
  '解出来不是岛屿快照的码应被拒绝');
assert((await api('POST', '/api/islands', { code: makeCode({ v: 99 }) })).status === 400,
  '版本不对的快照应被拒绝');
assert((await api('POST', '/api/islands', { code: makeCode({ buildings: 'nope' }) })).status === 400,
  'buildings 不是数组的快照应被拒绝');
assert((await api('POST', '/api/islands', {
  code: makeCode({ buildings: Array.from({ length: 500 }, () => ({ kind: 'campfire', x: 0, z: 0 })) }),
})).status === 400, '建筑数量超上限的快照应被拒绝');
assert((await api('POST', '/api/islands', {})).status === 400, '缺 code 字段应被拒绝');
assert((await api('GET', '/api/islands/zzzzzz')).status === 404, '不存在的 id 应返回 404');
assert((await api('POST', '/api/islands/zzzzzz/visits')).status === 404,
  '给不存在的岛计数应返回 404');

// 超大请求体应被掐断而不是撑爆内存
const huge = await fetch(`${base}/api/islands`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: 'a'.repeat(200_000) }),
}).then((r) => r.status).catch(() => 'aborted');
assert(huge === 400 || huge === 'aborted', `超大请求体应被拒绝,拿到 ${huge}`);

// ---- 留言板 ----
const guestIsland = await api('POST', '/api/islands', { code: makeCode({ seed: 7001, name: '客人的岛' }) });
const guestId = guestIsland.body.id;
const guestToken = guestIsland.body.token;

// 匿名留言:没出示任何凭证,一律记作路过的客人
const anon = await api('POST', `/api/islands/${id}/messages`, { text: '你的灯塔真好看' });
assert(anon.status === 200, '匿名留言应被接受');
assert(anon.body.messages.at(-1).fromName === '路过的客人', '没有凭证的留言应记作路过的客人');
assert(anon.body.messages.at(-1).fromIsland === null, '匿名留言不该带上来源岛');

await new Promise((r) => setTimeout(r, 3100)); // 让过冷却

// 署名留言:凭证对得上,名字取服务端存的那个
const signed = await api('POST', `/api/islands/${id}/messages`, {
  text: '来还礼了', from: guestId, fromToken: guestToken,
});
assert(signed.body.messages.at(-1).fromName === '客人的岛', '验证通过的留言应署名来源岛的名字');
assert(signed.body.messages.at(-1).fromIsland === guestId, '验证通过的留言应带上来源岛 id');

await new Promise((r) => setTimeout(r, 3100));

// 冒名顶替:声称是别人的岛但拿不出凭证 → 降级成匿名,而不是接受这个署名
const impersonate = await api('POST', `/api/islands/${id}/messages`, {
  text: '我是客人的岛(才怪)', from: guestId, fromToken: 'not-the-right-token',
});
assert(impersonate.body.messages.at(-1).fromName === '路过的客人',
  '拿不出凭证却声称是别人 → 必须降级成匿名');
assert(impersonate.body.messages.at(-1).fromIsland === null, '冒名的来源岛不该被记录');

// 频率限制
const spam = await api('POST', `/api/islands/${id}/messages`, { text: '连发' });
assert(spam.status === 429, `连续留言应被限流,拿到 ${spam.status}`);

await new Promise((r) => setTimeout(r, 3100));

// 正文清洗:超长截断、空白拒绝、隐藏字符剔除
const long = await api('POST', `/api/islands/${id}/messages`, { text: '好'.repeat(300) });
assert(long.body.messages.at(-1).text.length <= 60, '过长的留言应被截断');
await new Promise((r) => setTimeout(r, 3100));
assert((await api('POST', `/api/islands/${id}/messages`, { text: '   ' })).status === 400,
  '空白留言应被拒绝');
assert((await api('POST', `/api/islands/${id}/messages`, {})).status === 400, '缺正文应被拒绝');
const sneaky = await api('POST', `/api/islands/${id}/messages`, { text: 'a\u200bb\u202ec\nd' });
assert(sneaky.body.messages.at(-1).text === 'abc d',
  `零宽与双向字符应被剔除、换行折成空格,拿到 ${JSON.stringify(sneaky.body.messages.at(-1).text)}`);

// 删除:只有岛主能删
const target = sneaky.body.messages.at(-1).id;
assert((await api('DELETE', `/api/islands/${id}/messages/${target}`, { token: guestToken })).status === 403,
  '别人不能删你岛上的留言');
const deleted = await api('DELETE', `/api/islands/${id}/messages/${target}`, { token });
assert(deleted.status === 200 && !deleted.body.messages.some((m) => m.id === target),
  '岛主应能删掉自己岛上的留言');
assert((await api('POST', `/api/islands/${guestId}/messages`, { text: '给客人的岛留言' })).status === 200,
  '每座岛的留言板互相独立');

// ---- 伴手礼:客人放下一件,岛主回来一次领走 ----
const gift1 = await api('POST', `/api/islands/${id}/gifts`, { kind: 'wood' });
assert(gift1.status === 200 && gift1.body.giftCount === 1, '匿名伴手礼应被接受');
const peek = await api('GET', `/api/islands/${id}`);
assert(peek.body.giftCount === 1, '取回岛屿时应带上伴手礼件数');
assert(!('gifts' in peek.body), '伴手礼清单不该对访客外发 —— 那是留给岛主领取时才展开的');
const giftSpam = await api('POST', `/api/islands/${id}/gifts`, { kind: 'stone' });
assert(giftSpam.status === 429, `连续放伴手礼应被限流,拿到 ${giftSpam.status}`);
assert((await api('POST', `/api/islands/${id}/gifts`, { kind: 'wood 1' })).status === 400,
  '材料标识只收纯字母,别的一律拒绝');
assert((await api('POST', `/api/islands/${id}/gifts`, {})).status === 400, '缺材料标识应被拒绝');

// 署名走的是和留言完全一样的那套规则
const signedGift = await api('POST', `/api/islands/${guestId}/gifts`, {
  kind: 'metal', from: id, fromToken: token,
});
assert(signedGift.status === 200, '带凭证的伴手礼应被接受');

assert((await api('DELETE', `/api/islands/${id}/gifts`, { token: guestToken })).status === 403,
  '别人不能领走你岛上的伴手礼');
const claimed = await api('DELETE', `/api/islands/${id}/gifts`, { token });
assert(claimed.status === 200 && claimed.body.claimed.length === 1, '岛主应能一次领走全部伴手礼');
assert(claimed.body.claimed[0].kind === 'wood', '领到的应是客人放下的那一件');
assert(claimed.body.claimed[0].fromName === '路过的客人', '没有凭证的伴手礼应记作路过的客人');
assert((await api('GET', `/api/islands/${id}`)).body.giftCount === 0, '领完之后岛上不该还有伴手礼');
const guestClaim = await api('DELETE', `/api/islands/${guestId}/gifts`, { token: guestToken });
assert(guestClaim.body.claimed[0].fromName === '望海屿二期', '验证过的伴手礼应署上来源岛的名字');
assert(guestClaim.body.claimed[0].fromIsland === id, '验证过的伴手礼应带上来源岛 id');

// ---- 遗留数据迁移:加令牌之前发布的岛,第一次重新发布时认领 ----
// 先正常发布一座,再把它的 tokenHash 抹掉,伪造出"加令牌之前"的数据
const legacySeed = 8123;
const legacyIsland = await api('POST', '/api/islands', { code: makeCode({ seed: legacySeed, name: '老岛' }) });
const rawStore = JSON.parse(await fs.readFile(process.env.ISLAND_DATA, 'utf8'));
delete rawStore.islands[legacyIsland.body.id].tokenHash;
await fs.writeFile(process.env.ISLAND_DATA, JSON.stringify(rawStore), 'utf8');

// 另起一个服务读这份遗留数据
const legacy = await startServer({ port: 0 });
const legacyApi = async (body) => {
  const res = await fetch(`http://127.0.0.1:${legacy.port}/api/islands`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const claim = await legacyApi({ code: makeCode({ seed: legacySeed, name: '老岛(已认领)' }) });
assert(claim.body?.token, '没有 tokenHash 的遗留岛屿应能被认领并拿到新凭证');
const grab = await legacyApi({ code: makeCode({ seed: legacySeed, name: '别人来抢' }) });
assert(grab.status === 403, '认领之后就该关门:再无凭证的改写应被拒绝');
assert((await legacyApi({ code: makeCode({ seed: legacySeed, name: '岛主自己改' }), token: claim.body.token })).status === 200,
  '认领者拿着新凭证应能继续更新');
legacy.server.close();

// ---- 名字要截断:它会显示给别人看 ----
const longName = await api('POST', '/api/islands', {
  code: makeCode({ seed: 555, name: 'x'.repeat(200) }),
});
const longNameIsland = await api('GET', `/api/islands/${longName.body.id}`);
assert(longNameIsland.body.name.length <= 24, '过长的岛名应被截断');

// ---- 落盘 ----
const saved = JSON.parse(await fs.readFile(process.env.ISLAND_DATA, 'utf8'));
assert(saved.islands[id]?.visits === 2, '数据应真的写进了文件');
assert(!JSON.stringify(saved).includes('127.0.0.1'), '不该记录访问者的 IP');

// ---- 静态站点仍然由同一个服务提供 ----
const page = await fetch(`${base}/`);
assert(page.status === 200 && (await page.text()).includes('main.js'), '根路径应返回 index.html');
// 路径穿越:不管拒绝还是回落到首页都可以,唯一不能接受的是把 web/ 之外的内容吐出来
for (const attempt of ['/../package.json', '/%2e%2e/package.json', '/..%2fserver.mjs', '/%2e%2e%2fserver.mjs']) {
  const res = await fetch(base + attempt);
  const text = await res.text();
  assert(!text.includes('"devDependencies"') && !text.includes('ID_ALPHABET'),
    `路径穿越 ${attempt} 泄露了 web/ 之外的文件`);
}

await fs.rm(tmpRoot, { recursive: true, force: true });
console.log('短链服务测试全部通过 ✔');
process.exit(0);
