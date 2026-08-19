import esbuild from 'esbuild';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
};

const build = await esbuild.build({
  entryPoints: ['src/game/save.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
});
const source = build.outputFiles[0].text;
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const {
  loadSave, persistSave, SAVE_KEY, islandSnapshot, encodeIslandCode, decodeIslandCode, readVisitTarget,
} = mod;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const original = {
  version: 4,
  savedAt: 123,
  island: { name: '望海屿', seed: 4242, shareId: 'ab3k9x', token: 'Zm9vYmFyLXRva2VuLXZhbHVl', seenVisits: 5 },
  player: { x: 4, z: -7 },
  vitals: { health: 88, hunger: 51, thirst: 62, energy: 73 },
  inventory: { wood: 8, fiber: 5, stone: 3, food: 2, cookedFood: 1, fish: 3, cloth: 2, metal: 4, seed: 1 },
  clockT: 99,
  day: 4,
  discovered: ['cloth', 'metal', 'seed'],
  buildings: [
    { kind: 'campfire', x: 1, z: 2, level: 2, fuel: 86, water: 0, cooking: 0, growth: 0, stock: 0 },
    { kind: 'beacon', x: -5, z: 3, level: 1, fuel: 0, water: 0, cooking: 0, growth: 0, stock: 0 },
    { kind: 'garden', x: 6, z: 6, level: 1, fuel: 0, water: 0, cooking: 0, growth: 12, stock: 2 },
  ],
  resources: [{ kind: 'wood', x: 3, z: 4, hp: 2, respawnAt: 0, swayPhase: 1 }],
  boars: [{ x: 8, z: 9, attackCooldown: 1 }],
  flotsam: [{ kind: 'crate', x: 20, z: 3, drift: 0.4 }],
  flotsamDay: 4,
  residents: [{
    id: 'fisher-6', trade: 'fisher', arrivedDay: 6,
    home: { x: 3.5, z: -2 }, stock: 2, growth: 40, quiet: 0,
    request: { kind: 'fiber', count: 3, done: false }, favor: 1,
  }],
  exploration: {
    visits: { mangrove: 2, reef: 1 },
    discoveredPoi: ['mangrove-seeds', 'reef-engine'],
    blueprints: ['shelter', 'dock'],
    active: null,
  },
};
persistSave(original);
let loaded = loadSave(300);
assert(JSON.stringify(loaded) === JSON.stringify(original), '完整存档应无损往返');

store.set(SAVE_KEY, '{bad json');
assert(loadSave(300) === null, '损坏 JSON 应安全降级为无存档');

store.set(SAVE_KEY, JSON.stringify({
  ...original,
  vitals: { hunger: 900, thirst: -4, energy: 'bad' },
  inventory: { wood: -2, fiber: 2.9, metal: 'x' },
  buildings: [
    { kind: 'dragon', x: 0, z: 0, fuel: 1 },
    { kind: 'shelter', x: 3, z: 4, fuel: -9 },
  ],
  flotsam: [{ kind: 'ufo', x: 1, z: 1, drift: 0.5 }, { kind: 'sail', x: 2, z: 2, drift: 9 }],
}));
loaded = loadSave(300);
assert(loaded.vitals.hunger === 100 && loaded.vitals.thirst === 0 && loaded.vitals.energy === 100,
  '生存数值应被限制到合法范围');
assert(loaded.inventory.wood === 0 && loaded.inventory.fiber === 2 && loaded.inventory.metal === 0,
  '背包数量应为非负整数');
assert(loaded.buildings.length === 1 && loaded.buildings[0].kind === 'shelter',
  '非法建筑应被过滤');
assert(loaded.flotsam.length === 1 && loaded.flotsam[0].kind === 'sail' && loaded.flotsam[0].drift === 1,
  '非法漂流物应被过滤,漂流进度应被夹到 0..1');

// ---- v1/v2/v3 → v4 迁移:老玩家不该因为版本升级丢岛 ----
store.set(SAVE_KEY, JSON.stringify({
  version: 1,
  savedAt: 5,
  player: { x: 1, z: 1 },
  vitals: { health: 90, hunger: 80, thirst: 70, energy: 60 },
  inventory: { wood: 3, fiber: 3, stone: 3, food: 1, cookedFood: 0 },
  clockT: 50,
  day: 9,
  buildings: [{ kind: 'campfire', x: 0, z: 0, fuel: 30, water: 0, cooking: 0 }],
  resources: [{ kind: 'stone', x: 2, z: 2, hp: 3, respawnAt: 0, swayPhase: 0 }],
  boars: [{ x: 1, z: 2, attackCooldown: 0 }],
}));
loaded = loadSave(300);
assert(loaded !== null && loaded.version === 4, 'v1 存档应能读入并升到 v4');
assert(loaded.day === 9 && loaded.buildings.length === 1, 'v1 的天数与建筑应保留');
assert(loaded.inventory.cloth === 0 && loaded.inventory.metal === 0 && loaded.inventory.seed === 0,
  'v1 缺失的稀有材料应补 0');
// 鲜鱼是随住客一起加进来的:更老的存档里没有这一格,读出来必须是 0 而不是 undefined
assert(loaded.inventory.fish === 0, 'v1 缺失的鲜鱼应补 0');
assert(loaded.buildings[0].growth === 0 && loaded.buildings[0].stock === 0,
  'v1 缺失的花圃字段应补 0');
assert(loaded.discovered.length === 0 && loaded.flotsam.length === 0 && loaded.flotsamDay === 0,
  'v1 存档应从没有解锁、没有漂流物开始');
assert(loaded.island.name === '无名小岛' && loaded.island.seed > 0,
  'v1 存档应补上岛屿身份');
assert(loaded.island.shareId === '' && loaded.island.token === '' && loaded.island.seenVisits === 0,
  'v1 存档应从"还没发布过短链"开始');
assert(Array.isArray(loaded.residents) && loaded.residents.length === 0,
  'v1 存档应从"还没有住客"开始,而不是崩掉');
assert(loaded.buildings[0].level === 1, '旧建筑应迁移为一级建筑');
assert(loaded.exploration.active === null && loaded.exploration.blueprints.length === 0,
  '旧存档应从空探索日志开始');

store.set(SAVE_KEY, JSON.stringify({
  ...original,
  version: 2,
  buildings: original.buildings.map(({ level, ...building }) => building),
  exploration: undefined,
}));
loaded = loadSave(300);
assert(loaded.version === 4 && loaded.buildings.every((b) => b.level === 1),
  'v2 存档应升级到 v4，并把原建筑视为一级');

// v3 当前远征也要恢复，但损坏的载货不能绕过 4/7 格上限。
store.set(SAVE_KEY, JSON.stringify({
  ...original,
  buildings: [...original.buildings, {
    kind: 'dock', x: 12, z: 2, level: 1, fuel: 0, water: 0, cooking: 0, growth: 0, stock: 0,
  }],
  exploration: {
    visits: { mangrove: 3, cave: -2 },
    discoveredPoi: ['mangrove-seeds', 7, 'reef-engine'],
    blueprints: ['dock', 'dragon'],
    active: { id: 'reef', cargo: { metal: 99, cloth: 99 }, collected: ['reef-engine'] },
  },
}));
loaded = loadSave(300);
const restoredCargo = Object.values(loaded.exploration.active.cargo).reduce((sum, n) => sum + n, 0);
assert(loaded.exploration.active.id === 'reef' && restoredCargo === 4,
  '一级码头的未完成远征最多恢复 4 格载货');
assert(loaded.exploration.blueprints.length === 1 && loaded.exploration.blueprints[0] === 'dock',
  '非法升级图纸应被过滤');

// 解锁状态丢失时,持有的稀有材料应能反推回来
store.set(SAVE_KEY, JSON.stringify({
  ...original,
  discovered: [],
  inventory: { ...original.inventory, cloth: 0, metal: 3, seed: 0 },
}));
loaded = loadSave(300);
assert(loaded.discovered.includes('metal') && !loaded.discovered.includes('cloth'),
  '持有的稀有材料应反推出解锁状态');

// ---- 岛屿码:为互相参观预留 ----
const snapshot = islandSnapshot(original);
assert(snapshot.name === '望海屿' && snapshot.buildings.length === 3, '快照应带上岛屿身份与建筑');
assert(!('inventory' in snapshot) && !('vitals' in snapshot),
  '快照不应包含背包与生存数值:参观的是岛,不是别人的背包');
// 岛屿码是公开的:凭证漏进去等于把岛的所有权发给所有人
assert(!JSON.stringify(snapshot).includes('Zm9vYmFy') && !('token' in snapshot),
  '岛屿码绝不能带上岛主凭证');
assert(!Buffer.from(encodeIslandCode(snapshot).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  .toString('utf8').includes('Zm9vYmFy'), '编码后的岛屿码里也不能出现凭证');
const roundTrip = decodeIslandCode(encodeIslandCode(snapshot));
assert(JSON.stringify(roundTrip) === JSON.stringify(snapshot), '岛屿码应可无损往返');
assert(!/[+/=]/.test(encodeIslandCode(snapshot)), '岛屿码应是 URL 安全的');
assert(decodeIslandCode('这不是岛屿码') === null, '非法岛屿码应安全返回 null');

// ---- 岛屿码里的住客:客人要看得到岛上住着谁 ----
assert(snapshot.residents.length === 1 && snapshot.residents[0].trade === 'fisher',
  '安了家的住客应写进岛屿码');
assert(snapshot.residents[0].x === 3.5 && snapshot.residents[0].z === -2,
  '住客的家的位置应保留');
// 好感/库存/要求是岛主自己的进度,不该跟着链接发出去
for (const key of ['favor', 'stock', 'request', 'growth', 'id']) {
  assert(!(key in snapshot.residents[0]), `岛屿码不该带上住客的 ${key}`);
}
// 还在码头等的人不算 —— 岛主自己都没安顿好,不必让客人看见
const homeless = islandSnapshot({
  ...original,
  residents: [{ ...original.residents[0], home: null }],
});
assert(homeless.residents.length === 0, '没安家的住客不该出现在岛屿码里');
// 老岛屿码(没有 residents 字段)必须照常能开,不能被当成坏码
const legacy = { ...snapshot };
delete legacy.residents;
const legacyRead = decodeIslandCode(encodeIslandCode(legacy));
assert(legacyRead !== null && legacyRead.residents.length === 0,
  '不带住客的老岛屿码应照常打开,住客读成空');
// 脏数据不能让整座岛打不开
const dirty = decodeIslandCode(encodeIslandCode({
  ...snapshot,
  residents: [
    { trade: '龙骑士', x: 1, z: 1 },
    { trade: 'weaver', x: NaN, z: 1 },
    { trade: 'weaver', x: 2, z: 3 },
  ],
}));
assert(dirty !== null && dirty.residents.length === 1 && dirty.residents[0].trade === 'weaver',
  '未知职业与非法坐标的住客应被过滤,岛本身照常打开');

// ---- 参观入口:用户可能粘贴进来的各种形态都要认 ----
const code = encodeIslandCode(snapshot);
const named = (input) => readVisitTarget(input)?.snapshot?.name;
assert(named(code) === '望海屿', '裸岛屿码应能解析');
assert(named(`?visit=${code}`) === '望海屿', '查询串应能解析');
assert(named(`https://example.com/game/?visit=${code}`) === '望海屿', '整条邀请链接应能解析');
assert(named(`https://example.com/?a=1&visit=${code}&b=2`) === '望海屿',
  '链接里带其它参数时也应能取出岛屿码');
assert(named(`  ${code}  `) === '望海屿', '前后空白应被忽略');
assert(readVisitTarget('') === null, '空输入应返回 null');
assert(readVisitTarget('https://example.com/game/') === null,
  '没带 visit 参数的链接应返回 null,而不是拿整条 URL 当码去试');
assert(readVisitTarget('随便打的字') === null, '乱输入应返回 null');
assert(readVisitTarget('?visit=notbase64!!') === null, '损坏的岛屿码应返回 null');

// 短 id 和长码要能分辨开:短 id 解不出快照,但也不该被当成垃圾丢掉
const short = readVisitTarget('?visit=ab3k9x');
assert(short?.shortId === 'ab3k9x' && short.snapshot === null, '短 id 应被识别为待查询目标');
assert(readVisitTarget('https://example.com/?visit=ab3k9x')?.shortId === 'ab3k9x',
  '短链接也应能取出 id');
assert(readVisitTarget('ab3k9x')?.shortId === 'ab3k9x', '裸短 id 应被识别');
assert(readVisitTarget(`?visit=${code}`)?.shortId === null,
  '长码不该被误判成短 id');
assert(readVisitTarget('?visit=WAY-too-long-to-be-a-short-id') === null,
  '既不是合法长码、又不像短 id 的东西应返回 null');

// ---- 住客:脏数据必须被过滤,而不是把整个存档拖垮 ----
store.set(SAVE_KEY, JSON.stringify({
  ...original,
  residents: [
    { id: 'ok', trade: 'fisher', arrivedDay: 3, home: { x: 1, z: 2 }, stock: 1, favor: 0 },
    { id: 'bad-trade', trade: '龙骑士', arrivedDay: 3 },
    { id: 'ok', trade: 'weaver', arrivedDay: 4 },
    { id: 'bad-home', trade: 'sailor', arrivedDay: 5, home: { x: 'x', z: null } },
    { id: 'bad-req', trade: 'carpenter', arrivedDay: 6, request: { kind: '黄金', count: 3 } },
    null,
  ],
}));
loaded = loadSave(300);
const ids = loaded.residents.map((r) => r.id);
assert(!loaded.residents.some((r) => r.trade === '龙骑士'), '未知职业应被过滤');
assert(ids.filter((id) => id === 'ok').length === 1,
  '重复 id 应被去掉 —— 否则"满足要求"会作用到错误的人身上');
assert(loaded.residents.find((r) => r.id === 'bad-home').home === null, '非法坐标应退回未安家');
assert(loaded.residents.find((r) => r.id === 'bad-req').request === null, '非法要求应被丢弃');

console.log('存档测试全部通过 ✔');
