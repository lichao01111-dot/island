import esbuild from 'esbuild';

async function load(entry) {
  const build = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false,
    format: 'esm', platform: 'node', target: 'es2020',
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

function assert(condition, message) { if (!condition) throw new Error(message); }

const {
  EXPEDITIONS, EXPEDITION_ORDER, cargoUsed, lootSize, cargoCanFit, addLootToCargo,
  expeditionHeight, buildExpeditionWorld,
} = await load('src/world/expeditions.ts');
const {
  BUILDING_DEFS, BUILDING_UPGRADES, buildingRadius, createBuilding, repelField,
} = await load('src/world/buildings.ts');

// ---- 三条航线必须真正对应三座有内容、可进入的小岛 ----
assert(EXPEDITION_ORDER.length === 3, '应有三座远征岛');
assert(new Set(EXPEDITION_ORDER).size === 3, '远征岛 id 不应重复');
const poiIds = new Set();
for (const id of EXPEDITION_ORDER) {
  const def = EXPEDITIONS[id];
  assert(def && def.pois.length >= 3, `${id} 至少应有三处可调查地标`);
  assert(expeditionHeight(id, 0, 0) > 0.5, `${id} 岛心应在水面之上`);
  assert(expeditionHeight(id, def.radius * 1.2, 0) < 0, `${id} 岛外应落入海面之下`);
  for (const poi of def.pois) {
    assert(!poiIds.has(poi.id), `地标 id ${poi.id} 不应重复`);
    poiIds.add(poi.id);
    assert(lootSize(poi.loot) > 0, `${poi.id} 调查后必须有实际收获`);
  }
  const world = buildExpeditionWorld(id, [def.pois[0].id]);
  assert(world.pois.length === def.pois.length, `${id} 的 3D 场景应包含全部地标`);
  assert(world.pois[0].collected && !world.pois[0].group.visible,
    '刷新恢复远征时，已收集地标应保持隐藏');
  assert(world.group.children.length > 3, `${id} 不能只有一块空地形`);
}
assert(EXPEDITIONS.cave.requiresDockLevel === 2, '黑岩洞岛必须由加固船坞解锁');

// ---- 有限载货制造“拿什么回去”的取舍 ----
const cargo = {};
addLootToCargo(cargo, { metal: 2 });
assert(cargoUsed(cargo) === 2, '加入货物后应正确计算占用');
assert(cargoCanFit(cargo, { cloth: 2 }, 4), '刚好装满 4 格应允许');
addLootToCargo(cargo, { cloth: 2 });
assert(cargoUsed(cargo) === 4, '两批货物应累加');
assert(!cargoCanFit(cargo, { seed: 1 }, 4), '基础码头超过 4 格应拒绝');
assert(cargoCanFit(cargo, { seed: 3 }, 7), '加固船坞应提供 7 格载货');

// ---- 探索产出要回到建设，不做孤立收集品 ----
for (const kind of ['campfire', 'shelter', 'collector', 'dock']) {
  const upgrade = BUILDING_UPGRADES[kind];
  assert(upgrade && Object.keys(upgrade.cost).length > 0, `${kind} 应有二级升级方案与成本`);
  assert(EXPEDITION_ORDER.some((id) => EXPEDITIONS[id].pois.some((poi) => poi.blueprint === kind)),
    `${kind} 的升级图纸应能在远征地标中找到`);
}
assert(BUILDING_DEFS.dock.unique && BUILDING_DEFS.maptable.unique,
  '码头与制图桌应是唯一的航海基础设施');
assert(!BUILDING_DEFS.dock.unlock, '初始码头不能再依赖远征稀有材料，否则会形成死锁');

const fire1 = createBuilding('campfire', 0, 0, 1);
const fire2 = createBuilding('campfire', 0, 0, 2);
fire1.fuel = 30; fire2.fuel = 30;
assert(fire2.level === 2 && fire2.group.children.length > fire1.group.children.length,
  '升级建筑应有可见的二级造型细节');
assert(buildingRadius(fire2) > buildingRadius(fire1), '石砌火塘的实际安全范围应扩大');
assert(repelField([fire2])[0].repel > repelField([fire1])[0].repel,
  '石砌火塘应在野猪 AI 数据中使用更大的驱赶半径');

console.log('群岛远征与建筑升级测试全部通过 ✔');
