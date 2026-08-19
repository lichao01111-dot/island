// 住客系统的纯逻辑测试。
// 这些断言守的是设计意图(见 RESIDENTS.md),不是具体数值 ——
// 产出速度、静默时长这类会反复调,写死进测试只会让测试变成噪音。
import esbuild from 'esbuild';

async function load(entry) {
  const build = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false,
    format: 'esm', platform: 'node', target: 'es2020',
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const R = await load('src/world/residents.ts');

function assert(condition, message) { if (!condition) throw new Error(message); }

// ---- 岛屿等级是"能留住几个人"的门槛 ----
// 这是整个设计的支点:待客清单原本勾满即终点,现在变成持续有意义的上限
assert(R.residentCapacity(1) === 0, '低等级岛养不活别人');
assert(R.residentCapacity(10) > R.residentCapacity(5), '等级越高能留住越多人');
for (let lv = 1; lv <= 10; lv++) {
  const cap = R.residentCapacity(lv);
  assert(cap >= 0 && cap <= 4, `容量应落在 0..4,Lv.${lv} 得到 ${cap}`);
  if (lv > 1) {
    assert(cap >= R.residentCapacity(lv - 1), `容量不该随等级下降(Lv.${lv})`);
  }
}

// ---- 到访条件 ----
assert(!R.shouldArrive(10, 1, []), '等级不够时不该有人来');
assert(R.shouldArrive(10, 5, []), '等级够且没人时应该有人来');

const one = [R.createResident('fisher', 10)];
assert(!R.shouldArrive(11, 5, one), '刚来过人时不该马上又来');
assert(R.shouldArrive(10 + R.ARRIVAL_GAP_DAYS, 5, one), '间隔够了才可以再来');

// 满员之后无论隔多久都不再来
const full = ['fisher', 'weaver'].map((t, i) => R.createResident(t, i));
assert(!R.shouldArrive(999, 5, full), 'Lv.5 只能留 2 个人,满员后不该再来');

// 职业按顺序补,不重复
assert(R.nextTrade([]) === 'fisher', '第一位应该是渔夫');
assert(R.nextTrade([R.createResident('fisher', 1)]) !== 'fisher', '不该来两个同职业的');

// ---- 没安家的人不产出、也不开口 ----
const waiting = R.createResident('fisher', 1);
for (let i = 0; i < 2000; i++) R.updateResident(waiting, 1);
assert(waiting.stock === 0, '还在码头等着的人不该产出');
assert(waiting.request === null, '没安家就提要求 = 还没住下就催债');

// ---- 安家之后:静默期 → 开口 ----
const r = R.createResident('fisher', 1);
R.settle(r, 3, 4);
assert(r.home && r.home.x === 3, '安家应记住位置');
assert(r.quiet > 0, '刚住下应有静默期,不该立刻提要求');

R.updateResident(r, 1);
assert(r.request === null, '静默期内不该开口');
for (let i = 0; i < R.QUIET_AFTER_SETTLE + 5; i++) R.updateResident(r, 1);
assert(r.request !== null, '静默期过后应该提要求');
assert(r.request.count > 0, '要求应该是个正数');

// ---- 产出:会累积、有上限、堆满即停 ----
const p = R.createResident('fisher', 1);
R.settle(p, 0, 0);
for (let i = 0; i < R.PRODUCE_SECONDS * 10; i++) R.updateResident(p, 1);
assert(p.stock === R.MAX_STOCK, `产出应封顶在 ${R.MAX_STOCK},实际 ${p.stock}`);
assert(p.growth === 0, '堆满后不该继续偷偷累计 —— 否则久不上线会一次性爆仓');

const got = R.collect(p);
assert(got === R.MAX_STOCK && p.stock === 0, '收取应清空并返回件数');

// ---- 满足要求:扣材料、加好感、重新静默、产得更快 ----
const q = R.createResident('fisher', 1);
R.settle(q, 0, 0);
for (let i = 0; i < R.QUIET_AFTER_SETTLE + 5; i++) R.updateResident(q, 1);
const want = q.request;
const inv = { wood: 0, fiber: 0, stone: 0, food: 0, cookedFood: 0, cloth: 0, metal: 0, seed: 0 };
assert(!R.canFulfill(q, inv), '材料不够时不该能满足');
inv[want.kind] = want.count;
assert(R.canFulfill(q, inv), '材料够了就该能满足');

const before = R.produceInterval(q);
const paid = R.fulfill(q);
assert(paid.kind === want.kind && paid.count === want.count, '应返回实际要扣的材料');
assert(q.favor === 1, '满足要求应加好感');
assert(q.request === null && q.quiet > 0, '满足后应进入静默期,不该马上再要');
assert(R.produceInterval(q) < before, '好感更深应该产得更快 —— 这是关系目前唯一的体现');

// 重复调用不该重复扣材料
assert(R.fulfill(q) === null, '没有待办要求时 fulfill 应返回 null');

// ---- 每个职业的要求都必须是现有系统拿得到的东西 ----
// 物品清单从 hud.ts 直接取,不在这儿抄一份 —— 抄的那份上次加"鲜鱼"时就过期了
const { BASE_ITEMS, RESIDENT_ITEMS, RARE_ITEMS } = await load('src/game/hud.ts');
const OBTAINABLE = new Set([...BASE_ITEMS, ...RESIDENT_ITEMS, ...RARE_ITEMS]);
for (const [kind, def] of Object.entries(R.TRADES)) {
  assert(OBTAINABLE.has(def.wants.kind), `${kind} 要的 ${def.wants.kind} 不是背包里的东西`);
  assert(OBTAINABLE.has(def.yields), `${kind} 产的 ${def.yields} 不是背包里的东西`);
  assert(def.wants.count > 0, `${kind} 的要求数量应为正`);
}

console.log('住客系统测试全部通过 ✔');
