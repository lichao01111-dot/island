// 野兽的纯逻辑测试。
// 守的是手感规则(见 VOYAGES.md),不是具体数值 —— 血量、速度、伤害都会反复调,
// 写死进测试只会让测试变成噪音。真正不能变的是:
//   预告一定看得见、正面一定打不动、种子一样就一定是同一批。
import esbuild from 'esbuild';

async function load(entry) {
  const build = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false,
    format: 'esm', platform: 'node', target: 'es2020',
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const B = await load('src/world/beasts.ts');
const { BASE_ITEMS, RESIDENT_ITEMS, RARE_ITEMS } = await load('src/game/hud.ts');

function assert(condition, message) { if (!condition) throw new Error(message); }

// 平地,便于把判定和地形解耦
const flat = () => 1.2;
const RADIUS = 12;

// ---- 播种是确定性的:同一趟在任何设备上都是同一批野兽 ----
const LANDING = { x: 0, z: -RADIUS * 0.63 };
const a = B.planBeasts('reef', 3, RADIUS, flat, LANDING);
const b = B.planBeasts('reef', 3, RADIUS, flat, LANDING);
assert(JSON.stringify(a) === JSON.stringify(b), '同一趟应播出完全一样的野兽');
assert(JSON.stringify(B.planBeasts('reef', 4, RADIUS, flat, LANDING)) !== JSON.stringify(a),
  '下一趟应该是另一批 —— 否则远征还是一次性的');
assert(JSON.stringify(B.planBeasts('cave', 3, RADIUS, flat, LANDING)) !== JSON.stringify(a),
  '不同的岛不该播出同一批');

// ---- 落点:不能生在水里,也不能生在登陆点脸上 ----
const bumpy = (x, z) => (Math.hypot(x, z) > RADIUS * 0.85 ? -1 : 1.2);
for (let visit = 1; visit < 40; visit++) {
  for (const beast of B.planBeasts('reef', visit, RADIUS, bumpy, LANDING)) {
    assert(bumpy(beast.x, beast.z) >= 0.35, '野兽不该生在水里');
    assert(Math.hypot(beast.x, beast.z) < RADIUS, '野兽不该生在岛外');
    // 一上岸就挨打不合理:安全半径必须盖过最远的仇恨范围
    assert(Math.hypot(beast.x - LANDING.x, beast.z - LANDING.z) >= B.SAFE_LANDING,
      '野兽不该守在登陆点上');
  }
}

// ---- 攻击一定有预告:没有蓄力过程就直接命中是不允许的 ----
const near = () => ({ kind: 'crab', x: 0, z: 1.0, hp: 3, facing: Math.PI, windup: -1, cooldown: 0 });
{
  const beast = near();
  const hitOnFirstFrame = B.updateBeast(beast, 1 / 60, 0, 0, RADIUS, flat);
  assert(hitOnFirstFrame === false, '第一帧就命中 = 没有预告,玩家没有反应机会');
  assert(beast.windup > 0, '进入攻击距离应先进入蓄力');

  // 蓄力期间不能移动 —— 玩家看到它停下,才知道该走开
  const before = { x: beast.x, z: beast.z };
  let hits = 0;
  for (let i = 0; i < 300 && beast.windup >= 0; i++) {
    if (B.updateBeast(beast, 1 / 60, 0, 0, RADIUS, flat)) hits++;
  }
  assert(beast.x === before.x && beast.z === before.z, '蓄力期间不该移动');
  assert(hits === 1, `蓄力结束应恰好命中一次,实际 ${hits}`);
  assert(beast.cooldown > 0, '命中后应进入冷却,不能连击');
}

// ---- 蓄力期间走开就打不到:预告必须是真的能躲的 ----
{
  const beast = near();
  B.updateBeast(beast, 1 / 60, 0, 0, RADIUS, flat);
  assert(beast.windup > 0, '应已进入蓄力');
  let hit = false;
  // 玩家在蓄力期间跑到 6 米外
  for (let i = 0; i < 300 && beast.windup >= 0; i++) {
    hit = B.updateBeast(beast, 1 / 60, 0, 6, RADIUS, flat) || hit;
  }
  assert(!hit, '蓄力期间走开就该躲掉 —— 否则预告是假的');
}

// ---- 正面是壳:礁蟹的全部设计意图就在这一条上 ----
{
  const facingNorth = { kind: 'crab', x: 0, z: 1.4, hp: 3, facing: Math.PI, windup: -1, cooldown: 0 };
  // 玩家站在南边(0,0),蟹面朝南 —— 这是正面
  const front = B.strikeBeasts([facingNorth], 0, 0, 0);
  assert(front.blocked.length === 1 && front.hit.length === 0, '正面砍应被壳挡下');
  assert(facingNorth.hp === 3, '被挡下就不该掉血');

  // 同一只蟹,玩家绕到它背后打
  const behind = { kind: 'crab', x: 0, z: 1.4, hp: 3, facing: 0, windup: -1, cooldown: 0 };
  const back = B.strikeBeasts([behind], 0, 0, 0);
  assert(back.hit.length === 1 && back.blocked.length === 0, '背后砍应打得进去');
  assert(behind.hp === 2, '打进去应掉血');
}

// ---- 绕后必须真的走得通 ----
// 这条是整只礁蟹能不能玩的分水岭:如果它每帧都能转到面向玩家,壳就永远朝着你,
// 那它不是"需要技巧的敌人",而是一只打不动的怪。第一版就是这么写的。
{
  const beast = { kind: 'crab', x: 0, z: 0, hp: 3, facing: 0, windup: -1, cooldown: 99 };
  const R = 1.5;                 // 玩家贴着它绕圈的半径
  const PLAYER_SPEED = 7.2;      // 和 main.ts 里的 player.speed 一致
  const dt = 1 / 60;
  let angle = 0;                 // 玩家相对野兽的方位
  let landed = false;
  // 给玩家 1.5 秒绕圈的时间 —— 比蓄力窗口还短,说明这条路不依赖蓄力
  for (let i = 0; i < 90 && !landed; i++) {
    angle += (PLAYER_SPEED / R) * dt;
    const px = Math.sin(angle) * R;
    const pz = Math.cos(angle) * R;
    B.updateBeast(beast, dt, px, pz, RADIUS, flat);
    // 玩家始终面朝野兽
    const facing = Math.atan2(-px, -pz);
    if (B.strikeBeasts([beast], px, pz, facing).hit.length > 0) landed = true;
  }
  assert(landed, '玩家绕圈时必须能打到侧后 —— 否则礁蟹是一只打不动的怪');
}

// 转身速度必须明显慢于玩家绕圈的角速度,否则上面那条只是碰巧过了
for (const [kind, def] of Object.entries(B.BEAST_DEFS)) {
  const playerAngular = 7.2 / def.reach;
  assert(def.turn < playerAngular * 0.75,
    `${kind} 转身太快(${def.turn} vs 玩家 ${playerAngular.toFixed(1)} 弧度/秒),绕后会变成不可能`);
}

// 蓄力期间朝向必须完全锁死 —— 这是绕后最宽的那个窗口
{
  const beast = { kind: 'crab', x: 0, z: 0, hp: 3, facing: 0, windup: -1, cooldown: 0 };
  B.updateBeast(beast, 1 / 60, 0, 1.0, RADIUS, flat);
  assert(beast.windup > 0, '应已进入蓄力');
  const locked = beast.facing;
  for (let i = 0; i < 20; i++) B.updateBeast(beast, 1 / 60, 1.0, 0, RADIUS, flat);
  assert(beast.facing === locked, '蓄力期间不该转身');
}

// ---- 扇形判定:背后和太远的都打不到 ----
{
  const spawn = () => ({ kind: 'crab', x: 0, z: 1.4, hp: 3, facing: 0, windup: -1, cooldown: 0 });
  assert(B.strikeBeasts([spawn()], 0, 0, Math.PI).hit.length === 0, '身后的野兽不该被打到');
  const far = { kind: 'crab', x: 0, z: B.HIT_RANGE + 0.5, hp: 3, facing: 0, windup: -1, cooldown: 0 };
  assert(B.strikeBeasts([far], 0, 0, 0).hit.length === 0, '射程外不该被打到');
}

// ---- 死亡:血空了就不再参与任何判定 ----
{
  const beast = { kind: 'crab', x: 0, z: 1.4, hp: 1, facing: 0, windup: -1, cooldown: 0 };
  const result = B.strikeBeasts([beast], 0, 0, 0);
  assert(result.killed.length === 1, '血扣到 0 应上报死亡');
  assert(B.strikeBeasts([beast], 0, 0, 0).hit.length === 0, '死了的野兽不该还能被打');
  assert(B.updateBeast(beast, 1, 0, 0, RADIUS, flat) === false, '死了的野兽不该还能攻击');
  assert(B.nearestBeast([beast], 0, 0, 99) === null, '死了的野兽不该还被当成目标');
}

// ---- 掉落必须是背包里真有的东西 ----
const OBTAINABLE = new Set([...BASE_ITEMS, ...RESIDENT_ITEMS, ...RARE_ITEMS]);
for (const [kind, def] of Object.entries(B.BEAST_DEFS)) {
  for (const item of Object.keys(def.drop)) {
    assert(OBTAINABLE.has(item), `${kind} 掉的 ${item} 不是背包里的东西`);
  }
  assert(def.hp > 0 && def.damage > 0, `${kind} 的血量与伤害应为正`);
  assert(def.windup > 0, `${kind} 必须有预告时长 —— 没有预告的攻击是不公平的`);
  assert(def.aggro > def.reach, `${kind} 的仇恨范围应大于攻击距离`);
}

// 壳的保护角必须小于半圆,否则"绕后"这条路根本不存在
assert(B.SHELL_ARC > 0 && B.SHELL_ARC < Math.PI / 2,
  '壳的保护角要留出绕后的余地,不能护住半圈');

// 登陆点的安全半径必须盖过最远的仇恨范围,否则"安全"只是名义上的
const maxAggro = Math.max(...Object.values(B.BEAST_DEFS).map((d) => d.aggro));
assert(B.SAFE_LANDING >= maxAggro,
  `登陆点安全半径(${B.SAFE_LANDING})必须 >= 最大仇恨范围(${maxAggro}),否则一上岸就被盯上`);

console.log('野兽测试全部通过 ✔');
