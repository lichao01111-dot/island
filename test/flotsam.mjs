import esbuild from 'esbuild';

async function load(entry) {
  const build = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false,
    format: 'esm', platform: 'node', target: 'es2020',
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const { planFlotsam, coastPoint, FLOTSAM_DEFS, MAX_ACTIVE_FLOTSAM, createFlotsam, updateFlotsam, canSalvage } =
  await load('src/world/flotsam.ts');
const { islandProgress, BUILDING_DEFS, BUILDING_KINDS, MAX_ISLAND_LEVEL, repelsBoars } =
  await load('src/world/buildings.ts');
const { islandHeight, ISLAND_RADIUS } = await load('src/world/island.ts');

function assert(condition, message) { if (!condition) throw new Error(message); }

// ---- 投放是确定性的:同一天在任何设备上漂来同样的东西 ----
const a = planFlotsam(7, 3, false);
const b = planFlotsam(7, 3, false);
assert(JSON.stringify(a) === JSON.stringify(b), '同一天的漂流物应完全一致');
assert(JSON.stringify(planFlotsam(8, 3, false)) !== JSON.stringify(a), '不同天应漂来不同的东西');

// ---- 数量随岛屿等级与码头增长,但有上限 ----
assert(planFlotsam(3, 1, false).length === 1, '一级岛每天只漂来一件');
assert(planFlotsam(3, 1, true).length === 2, '码头应额外多漂来一件');
assert(planFlotsam(3, 4, false).length === 3, '等级提高应增加漂流物数量');
assert(planFlotsam(3, 10, true).length === 4, '数量应封顶在 4 件');

// ---- 品质门槛:低等级岛不该漂来高级材料 ----
for (let day = 1; day < 60; day++) {
  for (const plan of planFlotsam(day, 1, true)) {
    assert(FLOTSAM_DEFS[plan.kind].minLevel <= 1, `一级岛不该漂来 ${plan.kind}`);
  }
}
const kindsAtHighLevel = new Set();
for (let day = 1; day < 60; day++) {
  for (const plan of planFlotsam(day, 5, true)) kindsAtHighLevel.add(plan.kind);
}
assert(kindsAtHighLevel.has('sail') && kindsAtHighLevel.has('barrel'),
  '高等级岛应能漂来帆布卷与旧木桶');
for (const def of Object.values(FLOTSAM_DEFS)) {
  assert((def.loot.cloth ?? 0) === 0 && (def.loot.metal ?? 0) === 0 && (def.loot.seed ?? 0) === 0,
    '漂流物只应提供早期补给，稀有材料必须来自主动远征');
}

// ---- 落点必须在水线附近:不能卡进草地,也不能停在深海 ----
for (let day = 1; day < 40; day++) {
  for (const plan of planFlotsam(day, 5, true)) {
    const h = islandHeight(plan.x, plan.z);
    const r = Math.hypot(plan.x, plan.z);
    assert(h >= 0.25 && h < 1.6, `第 ${day} 天的漂流物落在了不合理的高度 ${h.toFixed(2)}`);
    assert(r < ISLAND_RADIUS + 2, '漂流物不该停在岛外的深海里');
  }
}
const coast = coastPoint(0.7);
assert(islandHeight(coast.x, coast.z) >= 0.3, '海岸点应在水线之上');

// ---- 漂流过程:出现在远海,靠岸后才能打捞 ----
const f = createFlotsam({ kind: 'crate', x: coast.x, z: coast.z, drift: 0 });
assert(!canSalvage(f), '刚出现的漂流物还在海上,不能打捞');
const startDistance = Math.hypot(f.group.position.x - coast.x, f.group.position.z - coast.z);
assert(startDistance > 5, '漂流物应从远海开始漂');
let landed = false;
for (let i = 0; i < 60 * 20; i++) landed = updateFlotsam(f, 1 / 60, i / 60) || landed;
assert(landed, '漂流物最终应靠岸并上报一次靠岸事件');
assert(canSalvage(f), '靠岸后应可以打捞');
assert(Math.hypot(f.group.position.x - coast.x, f.group.position.z - coast.z) < 0.3,
  '靠岸后应停在预定落点');
assert(updateFlotsam(f, 1 / 60, 99) === false, '靠岸事件只应上报一次');

// ---- 岛屿等级 ----
// 这里只断言"不随调平衡而变"的性质。等级公式已经从"建筑加权"改成"待客清单得分"过一次,
// 把具体阈值写死进测试的结果就是每次调数值都要来改测试 —— 那样的测试只会被当成噪音关掉。
assert(islandProgress([]).level === 1, '空岛是 1 级');
assert(islandProgress([]).score === 0, '空岛得分为 0');

const survival = [{ kind: 'campfire' }, { kind: 'shelter' }, { kind: 'collector' }];
const withDock = [...survival, { kind: 'dock' }];
assert(islandProgress(withDock).score >= islandProgress(survival).score,
  '多建一座建筑不该让岛屿得分变低');
assert(islandProgress(withDock).level >= islandProgress(survival).level,
  '等级应随建设单调不减');

// 满级要求"待客清单全部勾上",而不是把同一种建筑堆很多座 ——
// 清单是固定条目,重复建同一种不会继续加分
const many = BUILDING_KINDS.map((kind) => ({ kind, level: 2 }));
assert(islandProgress(many).level === MAX_ISLAND_LEVEL,
  `勾满待客清单应满级,实际 ${islandProgress(many).level}/${MAX_ISLAND_LEVEL}`);
assert(islandProgress(many).progress === 1, '满级时进度条应是满的');

// 这一条是整套评分存在的理由:堆重复建筑不该顶替真正的待客设施。
// 一旦它挂了,说明等级又变回"数房子"了
const spammed = [...Array(8)].flatMap(() => [{ kind: 'campfire' }, { kind: 'garden' }]);
assert(islandProgress(spammed).score === islandProgress([{ kind: 'campfire' }, { kind: 'garden' }]).score,
  `重复建同一种建筑不该继续加分,实际 ${islandProgress(spammed).score}`);

for (const set of [[], survival, withDock, many]) {
  const p = islandProgress(set);
  assert(p.level >= 1 && p.level <= MAX_ISLAND_LEVEL, `等级应落在 1..${MAX_ISLAND_LEVEL}`);
  assert(p.progress >= 0 && p.progress <= 1, '进度应落在 0..1');
}

// ---- 灯塔与篝火对野猪等价 ----
assert(repelsBoars({ kind: 'beacon', fuel: 0 }), '灯塔应始终驱赶野猪');
assert(repelsBoars({ kind: 'campfire', fuel: 5 }), '点着的篝火应驱赶野猪');
assert(!repelsBoars({ kind: 'campfire', fuel: 0 }), '熄灭的篝火不应驱赶野猪');
assert(!repelsBoars({ kind: 'dock', fuel: 0 }), '码头不该驱赶野猪');
assert(BUILDING_DEFS.beacon.repel === BUILDING_DEFS.beacon.radius,
  '灯塔的驱赶半径要和作用半径一致,否则"野猪不敢靠近"就是假的');

// ---- 位置约束:码头贴水线、灯塔在高处 ----
assert(BUILDING_DEFS.dock.maxHeight < BUILDING_DEFS.beacon.minHeight,
  '码头与灯塔的可建高度不该重叠,否则位置约束形同虚设');
assert(coastPoint(1.2) && islandHeight(coastPoint(1.2).x, coastPoint(1.2).z) <= BUILDING_DEFS.dock.maxHeight,
  '海岸线应落在码头可建的高度区间内');

// ---- 数量上限:只加不减会让海滩堆满、存档无限膨胀 ----
// 这条守的是"每天投放"这件事必须有个天花板。上限值可以调,但不能没有。
assert(typeof MAX_ACTIVE_FLOTSAM === 'number' && MAX_ACTIVE_FLOTSAM > 0,
  '必须有一个在岸漂流物的数量上限');
const maxPerDay = planFlotsam(3, 10, true).length;
assert(MAX_ACTIVE_FLOTSAM >= maxPerDay,
  `上限(${MAX_ACTIVE_FLOTSAM})不能小于单日投放量(${maxPerDay}),否则当天的东西会被自己冲走`);

console.log('漂流物与岛屿等级测试全部通过 ✔');
