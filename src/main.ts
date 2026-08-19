// 入口:Three.js 场景、昼夜循环、生存数值、采集交互
import * as THREE from 'three';
import { buildIsland, buildOcean, islandHeight, updateShore, updateCloudShadow, setCloudShadow } from './world/island';
import {
  scatterResources, Harvestable, createSpring, createResource, createGroundDetails, updateGrassWind,
  restyleResources,
} from './world/props';
import { Player } from './game/player';
import { Input } from './game/input';
import {
  Hud, Inventory, ItemKind, Vitals, BuildButton, Pointer,
  buildButtonRects, visibleItems, RARE_ITEMS,
} from './game/hud';
import {
  BUILDING_DEFS, BUILDING_KINDS, Building, BuildingKind,
  BUILDING_UPGRADES, buildingRadius, createBuilding, updateBuilding,
  islandProgress, repelsBoars, repelField, GARDEN_MAX,
  hospitalityChecklist, MAX_ISLAND_LEVEL,
} from './world/buildings';
import {
  Flotsam, FLOTSAM_DEFS, MAX_ACTIVE_FLOTSAM, canSalvage, coastPoint, createFlotsam,
  disposeFlotsam, planFlotsam, updateFlotsam,
} from './world/flotsam';
import {
  loadSave, persistSave, SaveData, IslandSnapshot, newIslandSeed,
  islandSnapshot, encodeIslandCode, decodeIslandCode, readVisitTarget,
} from './game/save';
import { mountShareUi } from './game/share';
import { topRightRail } from './game/ui-rail';
import { fetchIsland, countVisit, type IslandGift } from './game/api';
import { createBoars, updateBoar } from './world/boars';
import { createShipwreck } from './world/landmarks';
import { VisualEffects } from './game/effects';
import { buildSky, updateSky } from './world/sky';
import { createPostFx } from './game/postfx';
import { buildSkyEnvironment } from './game/environment';
import { applyRimToObject, CHARACTER_RIM } from './game/material';
import { loadAssets, instantiate } from './world/assets';
import {
  TRADES, canFulfill, collect, createResident, fulfill, nextTrade, settle,
  residentCapacity, shouldArrive, updateResident, type Resident,
} from './world/residents';
import { createResidentView, updateResidentView, residentWorldSpot, MIN_STAND_OFF, type ResidentView } from './world/resident-view';
import {
  planBeasts, updateBeast, strikeBeasts, nearestBeast, BEAST_DEFS, HIT_RANGE, type Beast,
} from './world/beasts';
import {
  createBeastView, updateBeastView, flashBlocked, flashHurt, beastName, type BeastView,
} from './world/beast-view';
import { ASSET_MANIFEST } from './world/asset-manifest';
import { buildAtmosphere } from './world/atmosphere';
import {
  addLootToCargo, buildExpeditionWorld, cargoCanFit, cargoUsed,
  EXPEDITION_ORDER, EXPEDITIONS, type BlueprintKind, type Cargo,
  type ExpeditionId, type ExpeditionPoi, type ExpeditionWorld,
} from './world/expeditions';
import { mountExpeditionUi, type DestinationView } from './game/expedition-ui';
import { isTouchDevice, refreshSafeArea } from './platform/device';

const DAY_SECONDS = 300; // 一天 5 分钟(原 3 分钟太赶,一天内要喝 2.3 次水、没空探索建造)
const HARVEST_RANGE = 2.8;

const renderer = new THREE.WebGLRenderer({ antialias: true });
// 高 DPR 手机把像素数压在 1.5 倍，视觉差异很小，但水面法线、阴影和草地的填充成本会明显下降。
const maxPixelRatio = window.matchMedia('(max-width: 700px)').matches ? 1.5 : 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
// 风格化写实基础:所有颜色按 sRGB 输出,ACES 压住正午高光并保留火光暖色层次。
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('role', 'application');
renderer.domElement.setAttribute('aria-label', '小岛生存与探索游戏。使用 WASD 移动，E 互动，F 进食，Q 给篝火加柴，R 烹饪，U 升级附近建筑，M 打开航海图。');

const liveStatus = document.createElement('div');
liveStatus.setAttribute('role', 'status');
liveStatus.setAttribute('aria-live', 'polite');
liveStatus.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';
document.body.appendChild(liveStatus);

const scene = new THREE.Scene();
// 天空环境光照:给 PBR 材质补上天空色的间接光与镜面反射。
// ?qa-noenv=1 关掉它,方便和"纯半球光"对照。
if (new URLSearchParams(window.location.search).get('qa-noenv') !== '1') {
  scene.environment = buildSkyEnvironment(renderer);
  scene.environmentIntensity = 0.35;
}
// 雾从更近处起效:远处海面才能自然融进天空,而不是留一条突兀的暗带
// 雾只负责"最远处融进天空";近中景交给海水自身的深度渐变,
// 否则海天糊成一片、失去地平线,画面会显得灰蒙
scene.fog = new THREE.Fog('#cfeaf6', 62, 240);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);

// 天空调色板(模块级常量 + 复用临时对象,避免每帧 new)
const SKY_DAY_H = new THREE.Color('#d8eef7');
const SKY_DAY_M = new THREE.Color('#7fc9ee');
const SKY_DAY_Z = new THREE.Color('#3d8ad4');
const SKY_DUSK_H = new THREE.Color('#ffc48a');
const SKY_DUSK_M = new THREE.Color('#f3936f');
const SKY_NIGHT_H = new THREE.Color('#2b3f63');
const SKY_NIGHT_M = new THREE.Color('#1b2a4a');
const SKY_NIGHT_Z = new THREE.Color('#0f1930');
const SKY_RAIN_H = new THREE.Color('#b7c8c9');
const SKY_RAIN_M = new THREE.Color('#78959d');
const SKY_RAIN_Z = new THREE.Color('#526f7b');
// 黑岩洞岛保留同一套昼夜变化，只在最终色彩上叠一层轻微冷调。
// 不切换 Fog 类型，避免往返岛屿时触发整套材质 shader 重新编译。
const CAVE_SKY_H = new THREE.Color('#9fbcc5');
const CAVE_SKY_M = new THREE.Color('#5f8292');
const CAVE_SKY_Z = new THREE.Color('#304b5d');
const CAVE_FOG = new THREE.Color('#829da6');
const skyHorizon = new THREE.Color();
const skyMid = new THREE.Color();
const skyZenith = new THREE.Color();
const sunDirTmp = new THREE.Vector3();
const moonDirTmp = new THREE.Vector3();
const camTargetTmp = new THREE.Vector3();
// 相机首帧从 (0,0,0) 插值过去会横穿地形和海面(参观时落点在别人的码头,更明显),
// 所以首帧直接就位;之后玩家被瞬移(参观落地、死亡重生)时也按距离阈值硬切。
let cameraSettled = false;
const CAMERA_SNAP_DIST = 8;

// ---- 视角 ----
// 俯视角是这个游戏的默认:核心循环是"经营一座岛 + 给别人看",一眼看完整座岛是前提。
// 近景越肩是可切换的第二视角 —— 参观别人的岛时"我到过那儿"的感觉靠它。
// 近景下机位固定(按切换那一刻的朝向),WASD 按这个机位旋转:W 前进、S 后退、A/D 左右横移,
// 角色始终朝移动方向。镜头不追朝向,方向感才和屏幕一致,也不会互相牵扯地打转。
type CameraMode = 'overhead' | 'shoulder';
let cameraMode: CameraMode = 'overhead';
let camYaw = 0;
const camLookTmp = new THREE.Vector3();
const SHOULDER_DIST = 6.4;
const SHOULDER_HEIGHT = 3.35;
const FOV = { overhead: 50, shoulder: 58 };

function setCameraMode(mode: CameraMode): void {
  if (mode === cameraMode) return;
  cameraMode = mode;
  camYaw = player.facingAngle;
  camera.fov = FOV[mode];
  camera.updateProjectionMatrix();
  cameraSettled = false;   // 直接就位,不要从旧机位横扫过去
  toast(mode === 'shoulder' ? '近景视角 · 按 V 切回俯视' : '俯视视角');
}

// 光照:暖阳 + 天空补光,卡通风靠高环境光压暗部
const sun = new THREE.DirectionalLight('#fff2d0', 1.55);
sun.castShadow = true;
// 阴影范围收紧 + 提分辨率 + bias:否则曲面地形会大面积自遮挡(灰斑)。
// 桌面优先:4096 让接触处更锐利(紧凑 ±22 视锥内每米像素翻倍),移动端回落到 2048。
const SHADOW_RES = window.matchMedia('(max-width: 700px)').matches ? 2048 : 4096;
sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
// 阴影视锥不再覆盖整座岛,而是跟着角色收紧到一个 ±22 的框。
// 岛半径已经 38,一张 2048 的图铺满整岛的话每米只剩 27 像素,阴影会糊成一团;
// 收紧到 ±22 后每米约 47 像素,而画面里本来也只看得到角色周围这一圈。
// 代价:远处的阴影不再投射 —— 俯视角下距离已经被雾和景深吃掉,看不出来。
const SHADOW_SPAN = 22;
sun.shadow.camera.left = -SHADOW_SPAN;
sun.shadow.camera.right = SHADOW_SPAN;
sun.shadow.camera.top = SHADOW_SPAN;
sun.shadow.camera.bottom = -SHADOW_SPAN;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.16;
// 更软的半影:硬阴影是"便宜感"的来源之一;移动端仍用较小半径省填充
sun.shadow.radius = window.matchMedia('(max-width: 700px)').matches ? 2 : 3;
scene.add(sun);
// 天光偏冷、地面反光偏暖:冷暖对比是卡通渲染显"高级"的关键
const ambient = new THREE.HemisphereLight('#c7e8ff', '#8c805f', 1.0);
scene.add(ambient);
// 弱冷色反侧光托住背光轮廓，避免树冠和角色背面直接掉成纯黑。
const fillLight = new THREE.DirectionalLight('#8bc7e6', 0.28);
fillLight.position.set(-35, 32, -28);
scene.add(fillLight);
const moon = new THREE.DirectionalLight('#78a9d2', 0);
moon.position.set(-35, 45, -20); scene.add(moon);

const starPositions = new Float32Array(120 * 3);
for (let i = 0; i < 120; i++) {
  starPositions[i * 3] = (Math.random() - 0.5) * 180;
  // 相机向下俯视，星点放在远处低仰角天空带内，避免落在视锥上方。
  starPositions[i * 3 + 1] = 7 + Math.random() * 20;
  starPositions[i * 3 + 2] = -30 - Math.random() * 100;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#d8e9ff', size: 0.95, transparent: true, opacity: 0.86 }));
stars.visible = false; scene.add(stars);

const sky = buildSky();
scene.add(sky.group);
// 主岛上的一切都挂在同一个根节点；远征时整体隐藏，海面、天空和玩家继续复用。
const homeWorld = new THREE.Group();
scene.add(homeWorld);
homeWorld.add(buildIsland());
homeWorld.add(createGroundDetails());
homeWorld.add(createShipwreck());
const ocean = buildOcean();
scene.add(ocean.mesh);
const atmosphere = buildAtmosphere();
scene.add(atmosphere.group);

// ---- 参观模式 ----
// 邀请链接就是 `?visit=<岛屿码>`。参观时不读自己的存档、也绝不写入 ——
// 唯一的写入口 saveGame() 会直接 return,所以定时存档、pagehide 全都自动失效。
// 地形对所有人都一样,不同的是建筑布局和资源分布(由岛屿种子决定)。
// 参观目标有两种:长码(数据就在链接里,立刻可用)和短 id(要先去服务端取)。
// 短 id 那条路是异步的,所以 guestMode 用来管"是不是在别人的岛上",
// guest 用来管"岛的数据到手了没有" —— 载入期间两者不同步,不能混用
const visitTarget = readVisitTarget(window.location.search);
const guestMode = !!visitTarget;
const savedGame = loadSave(DAY_SECONDS);
let guest: IslandSnapshot | null = visitTarget?.snapshot ?? null;
// 参观时 island 装的是"别人的岛";自己的身份(shareId/token)只在回家时才有意义,
// 但留言署名要用到,所以单独从存档里取一份带着
const myIdentity = {
  shareId: savedGame?.island.shareId ?? '',
  token: savedGame?.island.token ?? '',
  name: savedGame?.island.name ?? '',
};
const blankIsland = { shareId: '', token: '', seenVisits: 0 };
const island = guest
  ? { name: guest.name, seed: guest.seed, ...blankIsland }
  : guestMode
    ? { name: '载入中…', seed: 0, ...blankIsland }
    : savedGame?.island ?? { name: '无名小岛', seed: newIslandSeed(), ...blankIsland };

let resources: Harvestable[] = scatterResources(island.seed);
for (const r of resources) homeWorld.add(r.mesh);
const spring = createSpring();
homeWorld.add(spring.mesh);
const interactionRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.15, 0.055, 5, 32),
  new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.85, depthTest: false })
);
interactionRing.rotation.x = Math.PI / 2;
interactionRing.visible = false;
interactionRing.renderOrder = 5;
scene.add(interactionRing);
const boars = createBoars();
for (const boar of boars) homeWorld.add(boar.group);

// 轻量雨幕，跟随玩家移动，避免为整座岛创建大量粒子。
const rainGeo = new THREE.BufferGeometry();
const rainPositions = new Float32Array(180 * 6);
for (let i = 0; i < 180; i++) {
  const x = (Math.random() - 0.5) * 32;
  const y = Math.random() * 20;
  const z = (Math.random() - 0.5) * 32;
  rainPositions[i * 6] = x; rainPositions[i * 6 + 1] = y; rainPositions[i * 6 + 2] = z;
  rainPositions[i * 6 + 3] = x - 0.13; rainPositions[i * 6 + 4] = y - 0.75; rainPositions[i * 6 + 5] = z + 0.08;
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#c9e8f2', transparent: true, opacity: 0.48 }));
rain.visible = false;
scene.add(rain);

const player = new Player();
scene.add(player.group);

const input = new Input(renderer.domElement);
const hud = new Hud();
const effects = new VisualEffects(scene);
// 后期处理接管最终出图。renderer.toneMapping 保持 ACES —— 合成器渲染进 render target,
// 材质会跳过色调映射,由末尾的 OutputPass 统一做,中间的辉光因此拿到的是线性 HDR
// ?qa-noao=1 关掉环境光遮蔽、?qa-grade=current 切回旧调子、?qa-nooutline=1 关角色描边,方便 A/B 回归。
const qa = new URLSearchParams(window.location.search);
const postfx = createPostFx(renderer, scene, camera, {
  ao: qa.get('qa-noao') !== '1',
  grade: qa.get('qa-grade') === 'current' ? 'current' : 'ac',
  outline: qa.get('qa-nooutline') !== '1',
  outlineTargets: [player.group],
});

const vitals: Vitals = { health: 100, hunger: 100, thirst: 100, energy: 100 };
const inv: Inventory = {
  wood: 0, fiber: 0, stone: 0, food: 0, cookedFood: 0, fish: 0, cloth: 0, metal: 0, seed: 0,
};
// 见过的稀有材料 → 建造栏里出现对应的岛屿建筑
const discovered = new Set<ItemKind>();
// 永久探索进度与当前远征分开：前者写日志，后者允许刷新后继续这一趟。
const expeditionVisits: Partial<Record<ExpeditionId, number>> = { ...(savedGame?.exploration.visits ?? {}) };
const discoveredPoi = new Set<string>(savedGame?.exploration.discoveredPoi ?? []);
const blueprints = new Set<BlueprintKind>(savedGame?.exploration.blueprints ?? []);
let activeExpeditionId: ExpeditionId | null = null;
// update 在远征美术层逐步接入期间保持可选，旧存档/热更新到旧模块时也不会中断主循环。
let activeExpeditionWorld: (ExpeditionWorld & { update?(nowSeconds: number): void }) | null = null;
let expeditionCargo: Cargo = {};
let expeditionCollected = new Set<string>();
// 远征岛上的野兽。**不进存档** —— 由 (岛id, 第几次来) 播种,退出重进还是同一批,
// 这同时挡住了"打完退出重进刷掉落"(见 VOYAGES.md)
let beasts: Beast[] = [];
const beastViews = new Map<Beast, BeastView>();
let activeHeight: (x: number, z: number) => number = islandHeight;
// 本机视觉回归入口：?qa-expedition=mangrove|reef|cave。
// 只在 localhost 生效且完全禁用写盘，方便逐岛检查美术而不污染玩家存档。
const qaExpeditionParam = new URLSearchParams(window.location.search).get('qa-expedition');
const visualQaExpedition = !guestMode
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  && EXPEDITION_ORDER.includes(qaExpeditionParam as ExpeditionId)
  ? qaExpeditionParam as ExpeditionId
  : null;
const VISUAL_QA_TIME_OF_DAY = 0.3; // 晴朗上午：光线稳定，同时保留足够清楚的投影方向。
// ?qa-tod=0..1 固定时刻(仅 localhost):截图回归需要确定的光照,否则昼夜循环会污染 A/B。
const qaTodParam = new URLSearchParams(window.location.search).get('qa-tod');
const qaTimeOfDay = !guestMode
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  && qaTodParam !== null && Number.isFinite(Number(qaTodParam))
  ? Math.min(1, Math.max(0, Number(qaTodParam)))
  : null;
// 任一 QA 入口都把时刻与天气固定住(见下方 clock 更新处)
const qaFixedTimeOfDay = visualQaExpedition ? VISUAL_QA_TIME_OF_DAY : qaTimeOfDay;
let clockT = DAY_SECONDS * 0.28; // 从清晨开始
let day = 1;
let toastText: string | null = null;
let toastLeft = 0;
let hurtLeft = 0;
let invulnerableLeft = 0;
let footprintLeft = 0;
let footprintSide = -1;
let springRippleLeft = 0;
let rainRippleLeft = 0;
let faintGrace = 0; // 昏倒醒来后的免伤秒数

function toast(message: string): void {
  toastText = message; toastLeft = 2.2;
  liveStatus.textContent = '';
  window.setTimeout(() => { liveStatus.textContent = message; }, 0);
}

// ---- 建造 ----
// 生存建筑常驻;岛屿建筑要先打捞到对应的稀有材料才出现在栏里,
// 按钮"多出一格"本身就是解锁反馈,不需要额外的教程弹窗
const buildings: Building[] = [];
// 住客:漂来的人。视图和数据分开存,数据进存档、视图只在场景里
const residents: Resident[] = [];
const residentViews = new Map<string, ResidentView>();
const flotsam: Flotsam[] = [];
let flotsamDay = 0; // 已经为第几天投放过漂流物

function buildOrder(): BuildingKind[] {
  return BUILDING_KINDS.filter((kind) => {
    const unlock = BUILDING_DEFS[kind].unlock;
    if (unlock && !discovered.has(unlock)) return false;
    if (BUILDING_DEFS[kind].unique && buildings.some((b) => b.kind === kind)) return false;
    // 先把码头造出来，制图桌才有实际意义；这也让初始建造栏继续保持 6 格以内。
    if (kind === 'maptable' && !buildings.some((b) => b.kind === 'dock')) return false;
    // 小屋只在有人漂来等安家时才出现 —— 没人来之前盖了也是空屋
    if (kind === 'hut' && !residents.some((r) => !r.home)) return false;
    return true;
  });
}

function currentSave(): SaveData {
  return {
    version: 4,
    savedAt: Date.now(),
    island: { ...island },
    player: { x: player.position.x, z: player.position.z },
    vitals: { ...vitals },
    inventory: { ...inv },
    clockT,
    day,
    discovered: [...discovered],
    buildings: buildings.map((b) => ({
      kind: b.kind, x: b.x, z: b.z, level: b.level,
      fuel: b.fuel, water: b.water, cooking: b.cooking, growth: b.growth, stock: b.stock,
    })),
    resources: resources.map((r) => ({ kind: r.kind, x: r.x, z: r.z, hp: r.hp, respawnAt: r.respawnAt, swayPhase: r.swayPhase })),
    boars: boars.map((b) => ({ x: b.group.position.x, z: b.group.position.z, attackCooldown: b.attackCooldown })),
    flotsam: flotsam.map((f) => ({ kind: f.kind, x: f.x, z: f.z, drift: f.drift })),
    flotsamDay,
    residents,
    exploration: {
      visits: { ...expeditionVisits },
      discoveredPoi: [...discoveredPoi],
      blueprints: [...blueprints],
      active: activeExpeditionId
        ? { id: activeExpeditionId, cargo: { ...expeditionCargo }, collected: [...expeditionCollected] }
        : null,
    },
  };
}

function saveGame(): void {
  // 参观别人的岛时绝不写盘 —— 这一句拦住了定时存档、pagehide、以及所有交互里的存档
  if (guestMode || visualQaExpedition) return;
  persistSave(currentSave());
}

function restoreGame(): void {
  const saved = savedGame;
  if (!saved) return;
  player.position.set(saved.player.x, islandHeight(saved.player.x, saved.player.z), saved.player.z);
  Object.assign(vitals, saved.vitals);
  Object.assign(inv, saved.inventory);
  clockT = saved.clockT;
  day = saved.day;
  // 岛放大之后,老存档里的资源点全部挤在原来那个半径 26 的圆里,
  // 外圈会是一整片空地。数量差太多就直接用新散布的那一套 ——
  // 丢掉的只是"某棵树被砍了几下",反正它们本来就会重生
  const staleResourceLayout = saved.resources.length < resources.length * 0.75;
  if (saved.resources.length > 0 && !staleResourceLayout) {
    for (const r of resources) homeWorld.remove(r.mesh);
    resources = saved.resources.map((item) => {
      const r = createResource(item.kind, item.x, item.z);
      r.hp = item.hp; r.respawnAt = item.respawnAt; r.swayPhase = item.swayPhase;
      r.mesh.visible = item.respawnAt <= 0;
      homeWorld.add(r.mesh); return r;
    });
  }
  for (const item of saved.buildings) {
    const building = createBuilding(item.kind, item.x, item.z, item.level);
    building.fuel = item.fuel;
    building.water = item.water;
    building.cooking = item.cooking;
    building.growth = item.growth;
    building.stock = item.stock;
    buildings.push(building);
    homeWorld.add(building.group);
  }
  saved.boars.slice(0, boars.length).forEach((item, i) => {
    boars[i].group.position.set(item.x, islandHeight(item.x, item.z), item.z);
    boars[i].attackCooldown = item.attackCooldown;
  });
  for (const kind of saved.discovered) discovered.add(kind);
  flotsamDay = saved.flotsamDay;
  for (const r of saved.residents) addResident(r);
  for (const item of saved.flotsam) addFlotsam(item);
}

function addFlotsam(plan: { kind: Flotsam['kind']; x: number; z: number; drift: number }): void {
  const f = createFlotsam(plan);
  flotsam.push(f);
  homeWorld.add(f.group);
}

// 每天日出投放一次。数量看岛屿等级和有没有码头,种类看等级 —— 建设岛屿的回报直接落在这里
/**
 * 移走一件漂流物。必须走这里,不要各处自己 remove ——
 * 少了 disposeFlotsam,几何体会一直留在显存里(每天新增 4 件,是会累积的泄漏)
 */
function removeFlotsam(f: Flotsam): void {
  homeWorld.remove(f.group);
  disposeFlotsam(f);
  const i = flotsam.indexOf(f);
  if (i >= 0) flotsam.splice(i, 1);
}

function deliverFlotsam(): void {
  const { level } = islandProgress(buildings);
  const hasDock = buildings.some((b) => b.kind === 'dock');
  const incoming = planFlotsam(day, level, hasDock);
  // 先让潮水把积压的旧货带走,再放今天的。
  // 不这么做的话每天净增几件、永不消失:海滩会堆满,存档也会无限膨胀
  const overflow = flotsam.length + incoming.length - MAX_ACTIVE_FLOTSAM;
  for (let i = 0; i < overflow && flotsam.length > 0; i++) removeFlotsam(flotsam[0]);
  for (const plan of incoming) addFlotsam(plan);
  flotsamDay = day;
}

// 客人从哪儿上岸:有码头就从码头,没有就从海边走上来。
// 默认的岛心出生点不行 —— 岛主很可能正好把灯塔盖在那儿,人一进来就卡在建筑里

// ---- 住客 ----
// 见 RESIDENTS.md。要点:住客的家用坐标引用而不是建筑下标 ——
// buildings 是数组,以后支持拆除的话下标会错位,住客会指向别人的房子。

function dockSpot(): { x: number; z: number } | null {
  const dock = buildings.find((b) => b.kind === 'dock');
  return dock ? { x: dock.x, z: dock.z } : null;
}

/** 站在这个坐标上的建筑外面需要退开多远。没有建筑就用默认值 */
function standOffAt(spot: { x: number; z: number } | null): number {
  if (!spot) return MIN_STAND_OFF;
  const b = buildings.find((x) => Math.hypot(x.x - spot.x, x.z - spot.z) < 0.5);
  return b ? BUILDING_DEFS[b.kind].footprint * 0.9 + 0.6 : MIN_STAND_OFF;
}

function addResident(r: Resident): void {
  residents.push(r);
  const view = createResidentView();
  residentViews.set(r.id, view);
  homeWorld.add(view.group);
}

/**
 * 资产是异步加载的,而存档里的住客在那之前就已经建好视图了 ——
 * 不重建的话,老存档里的人会一直顶着替身那个方块脑袋。
 */
function refreshResidentViews(): void {
  for (const r of residents) {
    const old = residentViews.get(r.id);
    if (!old || !old.placeholder) continue;
    homeWorld.remove(old.group);
    const view = createResidentView();
    residentViews.set(r.id, view);
    homeWorld.add(view.group);
  }
}

/** 每天检查一次有没有人漂来。必须先有码头 —— 这给了码头一个持续存在的理由 */
function maybeWelcomeResident(): void {
  if (guestMode || !dockSpot()) return;
  if (!shouldArrive(day, islandProgress(buildings).level, residents)) return;
  const r = createResident(nextTrade(residents), day);
  addResident(r);
  const def = TRADES[r.trade];
  toast(`有人漂到了码头 · ${def.name}(${def.title})`);
  window.setTimeout(() => toast(def.greeting), 2400);
}

/**
 * 盖好小屋之后,把还没家的住客安置进去。
 * 先到先得:第一个还没安家的人住进刚盖好的小屋。
 * (第一刀只有一位住客;等支持多位住客时,再按距离就近匹配。)
 */
function houseResidentAt(x: number, z: number): void {
  const homeless = residents.find((r) => !r.home);
  if (!homeless) return;
  settle(homeless, x, z);
  const def = TRADES[homeless.trade];
  toast(`${def.name}住进了小屋`);
  window.setTimeout(() => toast(def.settled), 2200);
}

function nearestResident(range = 3.4): Resident | null {
  let best: Resident | null = null;
  let bestD = range;
  for (const r of residents) {
    const spot = r.home ?? dockSpot();
    if (!spot) continue;
    const view = residentViews.get(r.id);
    // 住客会在门口踱步,所以判定要用他脚下的位置,不是那个不动的锚点
    const here = view ? residentWorldSpot(view) : spot;
    const px = here.x;
    const pz = here.z;
    const d = Math.hypot(px - player.position.x, pz - player.position.z);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/** 住客当前站的世界坐标 —— 交互环要圈在他身上,而不是圈在他身后的设施上 */
function residentSpot(r: Resident): { x: number; z: number } {
  const view = residentViews.get(r.id);
  if (view) return residentWorldSpot(view);
  const spot = r.home ?? dockSpot() ?? { x: 0, z: 0 };
  return { x: spot.x, z: spot.z };
}

/** 和住客互动:先收产出,再看能不能满足他的要求;条件不满足时也给一句反馈 */
function talkToResident(r: Resident): boolean {
  const def = TRADES[r.trade];
  if (!r.home) {
    toast(`${def.name}: ${def.greeting}`);
    return true;
  }
  if (r.stock > 0) {
    const n = collect(r);
    inv[def.yields] += n;
    saveGame();
    toast(`收下了 ${n} 份${ITEM_LABEL[def.yields]}`);
    return true;
  }
  if (r.request) {
    if (canFulfill(r, inv)) {
      const paid = fulfill(r);
      if (paid) {
        inv[paid.kind] -= paid.count;
        saveGame();
        toast(def.thanks);
      }
    } else {
      toast(`他想要 ${r.request.count} 份${ITEM_LABEL[r.request.kind]} · 还差 ${r.request.count - inv[r.request.kind]} 份`);
    }
    return true;
  }
  toast(`${def.name}正忙着,过会儿再来`);
  return true;
}

function guestLanding(): { x: number; z: number } {
  const clear = (x: number, z: number): boolean =>
    islandHeight(x, z) > 0.8
    && !buildings.some((b) => Math.hypot(b.x - x, b.z - z) < BUILDING_DEFS[b.kind].footprint + 1.4);

  const candidates: Array<{ x: number; z: number }> = [];
  const dock = buildings.find((b) => b.kind === 'dock');
  if (dock) {
    // 沿码头到岛心的方向往里挪几步,人就站在栈桥根部
    const len = Math.hypot(dock.x, dock.z) || 1;
    for (const inward of [3.6, 5, 6.5]) {
      candidates.push({ x: dock.x - (dock.x / len) * inward, z: dock.z - (dock.z / len) * inward });
    }
  }
  // 兜底:绕一圈找一处空着的岸边
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const spot = coastPoint(a);
    const len = Math.hypot(spot.x, spot.z) || 1;
    candidates.push({ x: spot.x - (spot.x / len) * 3, z: spot.z - (spot.z / len) * 3 });
  }
  return candidates.find((c) => clear(c.x, c.z)) ?? { x: 0, z: 0 };
}

// 参观:按快照把岛主的建筑摆出来。只摆建筑,不还原岛主的背包与生存数值 ——
// 这些本来就不在岛屿码里。
// 走短 id 时这个函数在网络回来之后才执行,所以要能对一个已经跑起来的世界动手:
// 资源要按岛主的种子重新长一遍,人要重新落到岸上
function enterGuestIsland(snapshot: IslandSnapshot): void {
  guest = snapshot;
  island.name = snapshot.name;
  island.seed = snapshot.seed;
  day = snapshot.day;
  clockT = DAY_SECONDS * 0.32;  // 固定落在明亮的上午,别让客人一进门就是黑夜

  for (const r of resources) homeWorld.remove(r.mesh);
  // 树/石避开岛主已有的建筑,别从屋顶上长出来
  const avoidBuildings = snapshot.buildings.map((b) => ({
    x: b.x, z: b.z, radius: BUILDING_DEFS[b.kind].footprint,
  }));
  resources = scatterResources(snapshot.seed, avoidBuildings);
  for (const r of resources) homeWorld.add(r.mesh);

  for (const item of snapshot.buildings) {
    const building = createBuilding(item.kind, item.x, item.z, item.level ?? 1);
    // 岛屿码里没有燃料/储水/果实这些实时状态,而待客清单承诺过"客人能烤火、
    // 有水喝、能摘果子"。所以客人看到的设施一律是备好的 —— 否则那份清单就是空话。
    if (building.kind === 'garden') building.stock = GARDEN_MAX;
    if (building.kind === 'campfire') building.fuel = building.level >= 2 ? 420 : 240;
    if (building.kind === 'collector') building.water = building.level >= 2 ? 16 : 8;
    buildings.push(building);
    homeWorld.add(building.group);
  }
  // 岛上的人也要在场。没有他们,别人的岛看起来就只是一片空房子 ——
  // 而"这里住着谁"恰恰是这套玩法想让人看到的东西。
  // 造的是只用来站着的壳:好感/库存/要求都不在岛屿码里,也不该在客人这边推进。
  (snapshot.residents ?? []).forEach((person, i) => {
    const r = createResident(person.trade, snapshot.day);
    // id 按下标重编:createResident 的 id 是"职业-天数",而客人这边所有人都是同一天
    // 建出来的。岛屿码是别人给的,里面出现两个同职业就会撞 id、把视图挤掉一个。
    r.id = `guest-${i}`;
    r.home = { x: person.x, z: person.z };
    addResident(r);
  });
  for (const boar of boars) boar.group.visible = false;
  const landing = guestLanding();
  player.position.set(landing.x, islandHeight(landing.x, landing.z), landing.z);
  shareUi.setVisitingName(snapshot.name);
  toast(`来到「${snapshot.name}」· 第 ${snapshot.day} 天 · 岛屿 Lv.${islandProgress(buildings).level}`);
}

// 短 id:去服务端换回岛屿码。失败就明说打不开,不要把人晾在一座空岛上
async function loadGuestIsland(shortId: string): Promise<void> {
  const fetched = await fetchIsland(shortId);
  const snapshot = fetched ? decodeIslandCode(fetched.code) : null;
  if (!snapshot) {
    shareUi.setVisitingName('打不开这座岛');
    toast('打不开这座岛 · 链接可能过期了');
    return;
  }
  enterGuestIsland(snapshot);
  // 岛主自己点开自己的链接不算客人
  if (savedGame?.island.shareId !== shortId) void countVisit(shortId);
}

// 回家时看看有没有人来过、有没有人留言 —— 这是"把岛发出去"唯一能收到的回音
async function checkVisitors(): Promise<void> {
  if (!island.shareId) return;
  const info = await fetchIsland(island.shareId);
  if (!info) return;
  const gifts = info.giftCount ?? 0;
  const fresh = info.visits - island.seenVisits;
  // 有礼没领就照样提醒:客人来过很久了、礼一直堆在岛上,不该因为"人数没变"就不吭声
  if (fresh <= 0 && gifts <= 0) return;
  island.seenVisits = info.visits;
  saveGame();
  const notes = info.messages?.length ?? 0;
  const parts: string[] = [];
  if (fresh > 0) parts.push(`有 ${fresh} 位客人来过`);
  if (notes > 0) parts.push(`留言板上有 ${notes} 条留言`);
  if (gifts > 0) parts.push(`${gifts} 件伴手礼等着领(在「我的岛屿」里领取)`);
  toast(`你不在的时候 · ${parts.join(' · ')}`);
}

const shareUi = mountShareUi({
  // 参观时把自己的身份带上:留言要靠它署名
  visiting: guestMode ? { name: island.name, shortId: visitTarget?.shortId ?? null } : null,
  getIslandName: () => (guestMode ? myIdentity.name : island.name),
  setIslandName: (name) => { island.name = name; saveGame(); },
  getIslandCode: () => encodeIslandCode(islandSnapshot(currentSave())),
  getShareId: () => (guestMode ? myIdentity.shareId : island.shareId),
  setShareId: (id) => { island.shareId = id; saveGame(); },
  getToken: () => (guestMode ? myIdentity.token : island.token),
  setToken: (token) => { island.token = token; saveGame(); },
  // 脚下这座岛的待客清单:参观时算的是主人的岛,在家时算的是自己的
  getHospitality: () => ({
    day,
    level: islandProgress(buildings).level,
    maxLevel: MAX_ISLAND_LEVEL,
    items: hospitalityChecklist(buildings),
    residents: residents.length,
    capacity: residentCapacity(islandProgress(buildings).level),
  }),
  getGiftable: () => giftableItems(),
  onGiftSent: (kind) => spendGift(kind as ItemKind),
  onGiftsClaimed: (gifts) => receiveGifts(gifts),
});

// ---- 伴手礼 ----
// 参观时 inv 是空的(客人不把自己的背包带到别人岛上),送礼要看的是自己存档里的家当。
// 所以每次都现读一遍存档:自己岛那个标签页可能同时开着,读旧的会把它的进度写回去。
function giftableItems(): Array<{ kind: string; label: string; count: number }> {
  const mine = guestMode ? loadSave(DAY_SECONDS)?.inventory : inv;
  if (!mine) return [];
  return (Object.keys(ITEM_LABEL) as ItemKind[])
    .map((kind) => ({ kind, label: ITEM_LABEL[kind], count: mine[kind] }))
    .filter((item) => item.count > 0);
}

/** 送出成功后才扣:顺序反了,网络一抖东西就凭空少一件 */
function spendGift(kind: ItemKind): void {
  if (!guestMode) return;
  const mine = loadSave(DAY_SECONDS);
  if (!mine || mine.inventory[kind] <= 0) return;
  mine.inventory[kind]--;
  persistSave(mine);
}

function receiveGifts(gifts: IslandGift[]): void {
  const parts: string[] = [];
  for (const gift of gifts) {
    // 服务端不认识材料种类,认不出来的就当没这件东西 —— 别让一条脏数据把背包写坏
    if (!(gift.kind in ITEM_LABEL)) continue;
    const kind = gift.kind as ItemKind;
    inv[kind]++;
    parts.push(`${ITEM_LABEL[kind]}+1`);
  }
  if (parts.length === 0) return;
  saveGame();
  toast(`收下了 ${parts.length} 件伴手礼 · ${parts.join(' ')}`);
}

const expeditionUi = mountExpeditionUi({
  getDestinations: () => destinationViews(),
  getBlueprints: () => [...blueprints],
  getObjective: () => expeditionObjective(),
  depart: (id) => departExpedition(id),
});

if (guestMode) {
  if (visitTarget?.snapshot) enterGuestIsland(visitTarget.snapshot);
  else if (visitTarget?.shortId) void loadGuestIsland(visitTarget.shortId);
} else {
  restoreGame();
  // 第一天（或旧存档升级到 v3 后首次进入）也要有东西漂来，保证早期补给线可见。
  if (flotsamDay !== day) deliverFlotsam();
  if (visualQaExpedition) {
    enterExpedition(visualQaExpedition, {}, [], false);
  } else if (savedGame?.exploration.active) {
    const active = savedGame.exploration.active;
    enterExpedition(active.id, active.cargo, active.collected, false);
  }
  void checkVisitors();
}

// ---- 角色选择 ----
// KayKit Adventurers 的两个角色(CC0),76 段动画名一致,运行时可随意切换。
// 入口:?player=barbarian|rogue(默认 rogue),或控制台 __game.setPlayer('barbarian')。
type CharacterKind = 'barbarian' | 'rogue';
const CHARACTER_CLIPS = {
  idle: 'Idle', walk: 'Walking_A', chop: '1H_Melee_Attack_Chop', hurt: 'Hit_A',
} as const;
let currentCharacter: CharacterKind | null = null;

function setPlayerCharacter(name: CharacterKind): void {
  if (name === currentCharacter) return;
  const avatar = instantiate(name);
  if (!avatar) { toast(`角色「${name}」还没加载`); return; }
  // 外部模型的材质未必带边缘光;统一补上,让角色和植被共用同一套"接住天光"的语言
  applyRimToObject(avatar.object, CHARACTER_RIM);
  player.useModel(avatar.object, avatar.animations, CHARACTER_CLIPS);
  currentCharacter = name;
  toast(name === 'barbarian' ? '角色:野蛮人' : '角色:盗贼');
}

/** C 键 / 右上角按钮:在两个 KayKit 角色间来回切 */
function toggleCharacter(): void {
  if (!currentCharacter) return;
  setPlayerCharacter(currentCharacter === 'barbarian' ? 'rogue' : 'barbarian');
}

// 右上角加一个"换角色"小按钮,样式对齐"我的岛屿"那粒胶囊
function mountCharacterButton(): void {
  const style = document.createElement('style');
  style.textContent = `
    #island-char-btn { order: 1; display: flex; align-items: center; gap: 6px;
      background: linear-gradient(180deg, rgba(42,65,57,.94), rgba(24,42,38,.94));
      border: 1px solid rgba(226,199,133,.52); color: #fff2cc; border-radius: 999px;
      padding: 7px 13px; cursor: pointer; box-shadow: 0 5px 18px rgba(4,18,20,.26), inset 0 1px rgba(255,255,255,.12);
      font: 13px/1.5 "Trebuchet MS", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      letter-spacing: .01em; -webkit-tap-highlight-color: transparent; }
    #island-char-btn:active { transform: translateY(1px); background: rgba(24,42,38,.98); }
  `;
  document.head.appendChild(style);
  const btn = document.createElement('button');
  btn.id = 'island-char-btn';
  btn.type = 'button';
  btn.textContent = '换角色';
  btn.title = '切换 KayKit 角色（快捷键 C）';
  btn.addEventListener('click', () => {
    toggleCharacter();
    // 点完立刻失焦:否则按钮保持聚焦,玩家接下来按空格(采集)会触发浏览器的
    // "聚焦按钮被空格激活"默认行为,把角色又切一次
    btn.blur();
  });
  topRightRail().append(btn);
}

// ---- 日落彩蛋 ----
// 按 L:跳到日落时分,把时光放慢到 1/5 —— 慢慢看完整个金色时刻 → 暮色 → 入夜。再按 L 恢复。
let sunsetEgg = false;
const SUNSET_TOD = 0.42;    // 日落刚开始(golden hour)
const SUNSET_SPEED = 0.2;   // 时光放慢到 1/5

function toggleSunsetEgg(): void {
  sunsetEgg = !sunsetEgg;
  if (sunsetEgg) {
    clockT = DAY_SECONDS * SUNSET_TOD;
    toast('🌅 日落彩蛋 · 时光慢下来了（再按 L 恢复）');
  } else {
    toast('时光恢复');
  }
}

// 外部资产是渐进增强:世界已经用程序化几何体搭好了,资产到位后再把可见部分换掉。
// 所以加载失败、文件还没做出来、甚至一个资产都没有,都不影响游戏启动。
void loadAssets(ASSET_MANIFEST).then((report) => {
  if (report.loaded.length === 0) return;
  const swapped = restyleResources(resources);
  const playerParam = new URLSearchParams(window.location.search).get('player');
  setPlayerCharacter(playerParam === 'barbarian' ? 'barbarian' : 'rogue');
  refreshResidentViews();
  console.info(`[island] 已载入资产 ${report.loaded.join('、')};替换了 ${swapped} 个道具`);
});

// 右上角"换角色"按钮常驻(资产没加载完时点它只会有提示,不会崩)
mountCharacterButton();

function canAfford(kind: BuildingKind): boolean {
  const cost = BUILDING_DEFS[kind].cost;
  return (Object.keys(cost) as Array<keyof Inventory>)
    .every((k) => inv[k] >= (cost[k] ?? 0));
}

// 建筑落点:角色正前方一点,避免和角色重叠
// (从前是固定 z-2.2 朝北,且校验用的是玩家脚下坐标 —— 两处坐标不一致,
//  会导致站在草地上却把建筑盖进水里、或与已有建筑重叠)
const BUILD_DISTANCE = 2.6;
function buildSpot(): { x: number; z: number } {
  const a = player.facingAngle;
  return {
    x: player.position.x + Math.sin(a) * BUILD_DISTANCE,
    z: player.position.z + Math.cos(a) * BUILD_DISTANCE,
  };
}

// 位置是否可建:高度落在该建筑允许的区间、不与已有建筑重叠。必须校验"落点"而非玩家脚下
// 高度区间是每种建筑自己的事:码头要贴水线,灯塔要在高处,其余不能建在水里
function placementBlocked(kind: BuildingKind): boolean {
  const { x, z } = buildSpot();
  const def = BUILDING_DEFS[kind];
  const h = islandHeight(x, z);
  if (h < def.minHeight || h > def.maxHeight) return true;
  return buildings.some(
    (b) => Math.hypot(b.x - x, b.z - z) < def.footprint + BUILDING_DEFS[b.kind].footprint * 0.6
  );
}

// 建不了时告诉玩家为什么 —— "这里不能建造"对码头/灯塔这种有位置要求的建筑没有信息量
function placementReason(kind: BuildingKind): string {
  const { x, z } = buildSpot();
  const def = BUILDING_DEFS[kind];
  const h = islandHeight(x, z);
  if (h < def.minHeight) return kind === 'beacon' ? '灯塔要建在高处' : '这里太靠近水了';
  if (h > def.maxHeight) return '码头要建在水边';
  return '这里挨着别的建筑';
}

function build(kind: BuildingKind): boolean {
  if (!canAfford(kind)) { toast('材料不足'); return false; }
  if (placementBlocked(kind)) { toast(placementReason(kind)); return false; }
  const cost = BUILDING_DEFS[kind].cost;
  for (const k of Object.keys(cost) as Array<keyof Inventory>) {
    inv[k] -= cost[k] ?? 0;
  }
  // 与 placementBlocked 使用同一个落点,保证"校验通过 = 真的能建在那"
  const spot = buildSpot();
  const before = islandProgress(buildings).level;
  const b = createBuilding(kind, spot.x, spot.z);
  buildings.push(b);
  homeWorld.add(b.group);
  // 把压在建筑落点上的树/灌木/石头摘掉,别从屋顶上长出来
  const footprint = BUILDING_DEFS[kind].footprint;
  for (let i = resources.length - 1; i >= 0; i--) {
    const r = resources[i];
    if (Math.hypot(r.x - spot.x, r.z - spot.z) < footprint + 1.2) {
      homeWorld.remove(r.mesh);
      resources.splice(i, 1);
    }
  }
  effects.build(b.group);
  saveGame();
  if (kind === 'hut') houseResidentAt(spot.x, spot.z);
  const after = islandProgress(buildings).level;
  toast(after > before
    ? `${BUILDING_DEFS[kind].label}建成 · 岛屿升到 Lv.${after}`
    : `${BUILDING_DEFS[kind].label}建造完成`);
  return true;
}

function nearestUpgradeableBuilding(range = 4): Building | null {
  if (activeExpeditionId) return null;
  let best: Building | null = null;
  let bestD = range;
  for (const b of buildings) {
    if (!BUILDING_UPGRADES[b.kind]) continue;
    const d = Math.hypot(b.x - player.position.x, b.z - player.position.z);
    if (d < bestD) { best = b; bestD = d; }
  }
  return best;
}

function canAffordCost(cost: Partial<Inventory>): boolean {
  return (Object.keys(cost) as ItemKind[]).every((k) => inv[k] >= (cost[k] ?? 0));
}

function upgradeBuilding(b: Building): boolean {
  const def = BUILDING_UPGRADES[b.kind];
  if (!def) return false;
  if (b.level >= 2) { toast(`${def.label}已经完成`); return false; }
  if (!blueprints.has(def.kind)) { toast(`还没有「${def.label}」图纸 · 去群岛调查地标`); return false; }
  if (!canAffordCost(def.cost)) { toast(`升级「${def.label}」材料不足`); return false; }
  for (const kind of Object.keys(def.cost) as ItemKind[]) inv[kind] -= def.cost[kind] ?? 0;

  const next = createBuilding(b.kind, b.x, b.z, 2);
  next.fuel = b.fuel;
  next.water = b.water;
  next.cooking = b.cooking;
  next.growth = b.growth;
  next.stock = b.stock;
  const index = buildings.indexOf(b);
  homeWorld.remove(b.group);
  buildings[index] = next;
  homeWorld.add(next.group);
  effects.build(next.group);
  saveGame();
  expeditionUi.refresh();
  toast(`${def.label}升级完成 · ${def.blurb}`);
  return true;
}

// 打捞提供早期基础补给；真正稀有的建设材料已经转移到主动远征。
function salvage(f: Flotsam): void {
  const def = FLOTSAM_DEFS[f.kind];
  const parts: string[] = [];
  for (const k of Object.keys(def.loot) as ItemKind[]) {
    const n = def.loot[k] ?? 0;
    if (n <= 0) continue;
    inv[k] += n;
    parts.push(`${ITEM_LABEL[k]}+${n}`);
    // 第一次拿到某种稀有材料 = 解锁对应的岛屿建筑
    if ((RARE_ITEMS as ItemKind[]).includes(k) && !discovered.has(k)) {
      discovered.add(k);
      const unlocked = BUILDING_KINDS.find((kind) => BUILDING_DEFS[kind].unlock === k);
      if (unlocked) {
        const d = BUILDING_DEFS[unlocked];
        window.setTimeout(() => toast(`解锁「${d.label}」· ${d.blurb}`), 1400);
      }
    }
  }
  effects.harvest('wood', f.group.position, player.position);
  removeFlotsam(f);
  saveGame();
  toast(`打捞到${def.label} · ${parts.join(' ')}`);
}

// 采花圃:果实等同于生椰子,让"不出门也有饭吃"成为岛屿建设的实际收益
function pickGarden(b: Building): boolean {
  if (b.stock <= 0) { toast('果子还没熟'); return false; }
  b.stock--;
  inv.food++;
  saveGame();
  toast('摘下一颗果子');
  return true;
}

// 吃东西:补饥饿 + 少量解渴(椰子水),这是生存循环的回补端。
// 优先级 熟食 > 椰子 > 生鱼 —— 生鱼顶饿但不解渴(还咸),所以它真正的用途是拿去烤。
function eat(): boolean {
  if (inv.cookedFood <= 0 && inv.food <= 0 && inv.fish <= 0) { toast('没有可吃的食物'); return false; }
  if (vitals.hunger > 92 && vitals.thirst > 92) { toast('现在还不饿'); return false; }
  if (inv.cookedFood > 0) {
    inv.cookedFood--;
    vitals.hunger = Math.min(100, vitals.hunger + 52);
    vitals.thirst = Math.min(100, vitals.thirst + 18);
    vitals.energy = Math.min(100, vitals.energy + 12);
  } else if (inv.food > 0) {
    inv.food--;
    vitals.hunger = Math.min(100, vitals.hunger + 32);
    vitals.thirst = Math.min(100, vitals.thirst + 14);
  } else {
    inv.fish--;
    vitals.hunger = Math.min(100, vitals.hunger + 28);
    vitals.thirst = Math.max(0, vitals.thirst - 4);
    saveGame();
    toast('生鱼下肚 · 顶饿,但更渴了');
    return true;
  }
  saveGame();
  toast('吃饱了一些');
  return true;
}

// 采集掉落
const YIELD: Record<string, () => Partial<Inventory>> = {
  wood: () => ({ wood: 1, food: Math.random() < 0.35 ? 1 : 0 }),
  fiber: () => ({ fiber: 2 }),
  stone: () => ({ stone: 1 }),
};
const LABEL: Record<string, string> = { wood: '椰子树', fiber: '灌木', stone: '石堆' };
const COST_ICON: Record<ItemKind, string> = {
  wood: '木', fiber: '叶', stone: '石', food: '椰', cookedFood: '熟',
  fish: '鱼', cloth: '布', metal: '铁', seed: '种',
};
const ITEM_LABEL: Record<ItemKind, string> = {
  wood: '木材', fiber: '纤维', stone: '石料', food: '椰子', cookedFood: '熟食',
  fish: '鲜鱼', cloth: '帆布', metal: '铁件', seed: '种子',
};

const SALVAGE_RANGE = 3.2;

function nearestFlotsam(range = SALVAGE_RANGE): Flotsam | null {
  let best: Flotsam | null = null;
  let bestD = range;
  for (const f of flotsam) {
    if (!canSalvage(f)) continue;
    const d = Math.hypot(f.x - player.position.x, f.z - player.position.z);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

function nearestBuilding(kind: BuildingKind, range = 3.6): Building | null {
  if (activeExpeditionId) return null;
  let best: Building | null = null, bestD = range;
  for (const b of buildings) {
    if (b.kind !== kind) continue;
    const d = Math.hypot(b.x - player.position.x, b.z - player.position.z);
    if (d < bestD) { best = b; bestD = d; }
  }
  return best;
}

function dockLevel(): number {
  return buildings.find((b) => b.kind === 'dock')?.level ?? 0;
}

function hasNavigation(): boolean {
  return buildings.some((b) => b.kind === 'dock') && buildings.some((b) => b.kind === 'maptable');
}

function expeditionCapacity(): number {
  return dockLevel() >= 2 ? 7 : 4;
}

function destinationViews(): DestinationView[] {
  const level = dockLevel();
  const navigation = hasNavigation();
  return EXPEDITION_ORDER.map((id) => {
    const def = EXPEDITIONS[id];
    const unlocked = navigation && level >= def.requiresDockLevel;
    return {
      id,
      unlocked,
      reason: !navigation ? '需要码头与制图桌' : `需要 ${BUILDING_UPGRADES.dock?.label ?? '加固船坞'}`,
      visits: expeditionVisits[id] ?? 0,
      discovered: def.pois.filter((p) => discoveredPoi.has(p.id)).length,
      total: def.pois.length,
    };
  });
}

function expeditionObjective(): string {
  if (!buildings.some((b) => b.kind === 'dock')) return '先在海边建造码头，建立稳定的出发点。';
  if (!buildings.some((b) => b.kind === 'maptable')) return '码头已经就绪：建造制图桌，标出第一条航线。';
  const untouched = EXPEDITION_ORDER.find((id) => (expeditionVisits[id] ?? 0) === 0 && destinationViews().find((v) => v.id === id)?.unlocked);
  if (untouched) return `下一目标：首次登陆「${EXPEDITIONS[untouched].name}」，带回特殊材料与建筑图纸。`;
  const missingBlueprint = (['campfire', 'shelter', 'collector', 'dock'] as BlueprintKind[]).find((b) => !blueprints.has(b));
  if (missingBlueprint) return '继续调查尚未发现的地标，集齐四份建筑升级图纸。';
  return '航线已经稳定：按当前建设计划选择远征地点，补充稀有材料。';
}

function disposeExpeditionWorld(): void {
  if (!activeExpeditionWorld) return;
  scene.remove(activeExpeditionWorld.group);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  activeExpeditionWorld.group.traverse((o) => {
    // 新增雾点、浪线或实例化装饰后也能完整释放；Set 避免共享材质被重复 dispose。
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points)) return;
    geometries.add(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) materials.add(mat);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  activeExpeditionWorld = null;
}

function enterExpedition(id: ExpeditionId, cargo: Cargo = {}, collected: string[] = [], countVisit = true): void {
  disposeExpeditionWorld();
  activeExpeditionId = id;
  expeditionCargo = { ...cargo };
  expeditionCollected = new Set(collected);
  activeExpeditionWorld = buildExpeditionWorld(id, collected);
  scene.add(activeExpeditionWorld.group);
  homeWorld.visible = false;
  activeHeight = activeExpeditionWorld.heightAt;
  const def = EXPEDITIONS[id];
  player.setTerrain(activeHeight, 0, 0, def.radius - 1.35);
  player.position.set(
    activeExpeditionWorld.landing.x,
    activeHeight(activeExpeditionWorld.landing.x, activeExpeditionWorld.landing.z),
    activeExpeditionWorld.landing.z
  );
  cameraSettled = false;
  interactionRing.visible = false;
  // 先记这一趟,再拿它当种子:中途退出重进时 countVisit 是 false,
  // 但 expeditionVisits[id] 已经是同一个数 —— 岛上还是同一批野兽
  if (countVisit) expeditionVisits[id] = (expeditionVisits[id] ?? 0) + 1;
  spawnBeasts(id, def.radius);
  expeditionUi.close();
  expeditionUi.setAvailable(false);
  saveGame();
  toast(`抵达「${def.name}」· 载货 ${cargoUsed(expeditionCargo)}/${expeditionCapacity()}`);
}

// ---- 野兽:只在远征岛上。主岛是家,灯塔护住的地方不该反悔(VOYAGES.md) ----

function clearBeasts(): void {
  // 视图挂在远征世界的 group 下,disposeExpeditionWorld 会连几何体一起释放,
  // 这里只需要把引用丢掉
  beasts = [];
  beastViews.clear();
}

function spawnBeasts(id: ExpeditionId, radius: number): void {
  clearBeasts();
  if (!activeExpeditionWorld) return;
  beasts = planBeasts(id, expeditionVisits[id] ?? 0, radius, activeHeight, activeExpeditionWorld.landing);
  for (const beast of beasts) {
    const view = createBeastView(beast);
    beastViews.set(beast, view);
    activeExpeditionWorld.group.add(view.group);
  }
}

/** 玩家挥一击。返回 true 表示这一下打在野兽身上(消费掉这次按键) */
function swingAtBeasts(): boolean {
  if (!activeExpeditionId || beasts.length === 0) return false;
  const result = strikeBeasts(beasts, player.position.x, player.position.z, player.facingAngle);
  if (result.hit.length === 0 && result.blocked.length === 0) return false;
  player.startSwing();
  for (const b of result.blocked) {
    const view = beastViews.get(b);
    if (view) flashBlocked(view);
  }
  for (const b of result.hit) {
    const view = beastViews.get(b);
    if (view) flashHurt(view);
  }
  for (const b of result.killed) {
    const def = BEAST_DEFS[b.kind];
    // 掉落直接进载货 —— 装不下就留在地上(其实是丢掉),和调查点同一条规则
    const parts: string[] = [];
    for (const kind of Object.keys(def.drop) as ItemKind[]) {
      const n = def.drop[kind] ?? 0;
      if (n <= 0) continue;
      if (!cargoCanFit(expeditionCargo, { [kind]: n }, expeditionCapacity())) continue;
      addLootToCargo(expeditionCargo, { [kind]: n });
      parts.push(`${ITEM_LABEL[kind]}+${n}`);
    }
    effects.ripple(b.x, b.z, activeHeight(b.x, b.z) + 0.05);
    toast(parts.length > 0 ? `打倒了${def.name} · ${parts.join(' ')}` : `打倒了${def.name} · 载货已满`);
  }
  if (result.hit.length === 0 && result.blocked.length > 0) {
    toast('正面是壳 · 绕到侧后再打');
  }
  saveGame();
  return true;
}

function departExpedition(id: ExpeditionId): void {
  if (guestMode || activeExpeditionId) return;
  const view = destinationViews().find((v) => v.id === id);
  if (!view?.unlocked) { toast(view?.reason ?? '这条航线还未解锁'); return; }
  if (inv.cookedFood <= 0 && inv.food <= 0) { toast('远征需要准备 1 份食物'); return; }
  if (vitals.energy < 25 || vitals.thirst < 25) { toast('体力或饮水不足，先在营地准备'); return; }
  if (inv.cookedFood > 0) inv.cookedFood--; else inv.food--;
  enterExpedition(id);
}

function nearestExpeditionPoi(range = 2.8): ExpeditionPoi | null {
  if (!activeExpeditionWorld) return null;
  let best: ExpeditionPoi | null = null;
  let bestD = range;
  for (const poi of activeExpeditionWorld.pois) {
    if (poi.collected) continue;
    const d = Math.hypot(poi.def.x - player.position.x, poi.def.z - player.position.z);
    if (d < bestD) { best = poi; bestD = d; }
  }
  return best;
}

function nearExpeditionBoat(range = 3): boolean {
  if (!activeExpeditionWorld) return false;
  const p = activeExpeditionWorld.boat.position;
  return Math.hypot(p.x - player.position.x, p.z - player.position.z) < range;
}

function collectExpeditionPoi(poi: ExpeditionPoi): boolean {
  const cap = expeditionCapacity();
  if (!cargoCanFit(expeditionCargo, poi.def.loot, cap)) {
    toast(`载货已满 ${cargoUsed(expeditionCargo)}/${cap} · 回木筏返航`);
    return false;
  }
  addLootToCargo(expeditionCargo, poi.def.loot);
  poi.collected = true;
  poi.group.visible = false;
  expeditionCollected.add(poi.def.id);
  const firstDiscovery = !discoveredPoi.has(poi.def.id);
  discoveredPoi.add(poi.def.id);
  if (poi.def.blueprint) blueprints.add(poi.def.blueprint);
  vitals.energy = Math.max(0, vitals.energy - poi.def.energyCost);
  const parts = (Object.keys(poi.def.loot) as ItemKind[])
    .map((k) => `${ITEM_LABEL[k]}+${poi.def.loot[k]}`)
    .join(' ');
  const effectKind = poi.def.visual === 'seed' || poi.def.visual === 'fungus' ? 'fiber'
    : poi.def.visual === 'ore' || poi.def.visual === 'hearth' || poi.def.visual === 'cistern' ? 'stone'
      : 'wood';
  effects.harvest(effectKind, poi.group.position, player.position);
  saveGame();
  expeditionUi.refresh();
  toast(firstDiscovery
    ? `发现「${poi.def.label}」· ${parts}${poi.def.blueprint ? ' · 获得升级图纸' : ''}`
    : `再次搜集「${poi.def.label}」· ${parts}`);
  return true;
}

function returnFromExpedition(): void {
  if (!activeExpeditionId) return;
  const summary: string[] = [];
  for (const kind of Object.keys(expeditionCargo) as ItemKind[]) {
    const n = expeditionCargo[kind] ?? 0;
    if (n <= 0) continue;
    inv[kind] += n;
    summary.push(`${ITEM_LABEL[kind]}+${n}`);
    if ((RARE_ITEMS as ItemKind[]).includes(kind)) discovered.add(kind);
  }
  activeExpeditionId = null;
  expeditionCargo = {};
  expeditionCollected.clear();
  clearBeasts();
  disposeExpeditionWorld();
  homeWorld.visible = true;
  activeHeight = islandHeight;
  player.setTerrain(islandHeight);
  const dock = buildings.find((b) => b.kind === 'dock');
  if (dock) {
    const len = Math.hypot(dock.x, dock.z) || 1;
    const x = dock.x - dock.x / len * 3.2;
    const z = dock.z - dock.z / len * 3.2;
    player.position.set(x, islandHeight(x, z), z);
  } else {
    player.position.set(0, islandHeight(0, 0), 0);
  }
  cameraSettled = false;
  expeditionUi.setAvailable(true);
  expeditionUi.refresh();
  saveGame();
  toast(summary.length > 0 ? `远征归来 · ${summary.join(' ')}` : '空手返航 · 下次记得调查地标');
}

// 远征中昏迷会失去**一半**尚未卸下的货物，但永久发现与已经取得的图纸仍然保留。
// 同时切回主岛坐标系，避免醒来后仍被困在隐藏的远征场景。
//
// 从"全掉"改成"掉一半"是有意的:野兽加进来之后,昏倒会变成常见结局,
// 而一趟辛苦攒的货全没了会让人干脆不出海。损失要疼,但不能疼到劝退(VOYAGES.md 第三节)。
function abortExpedition(): { lost: string[] } {
  if (!activeExpeditionId) return { lost: [] };
  const lost: string[] = [];
  for (const kind of Object.keys(expeditionCargo) as ItemKind[]) {
    const had = expeditionCargo[kind] ?? 0;
    if (had <= 0) continue;
    // 向上取整:1 份也要掉,否则"只带一件"就成了无风险策略
    const drop = Math.ceil(had / 2);
    expeditionCargo[kind] = had - drop;
    lost.push(`${ITEM_LABEL[kind]}-${drop}`);
  }
  // 剩下的一半照常卸进仓库
  for (const kind of Object.keys(expeditionCargo) as ItemKind[]) {
    const n = expeditionCargo[kind] ?? 0;
    if (n <= 0) continue;
    inv[kind] += n;
    if ((RARE_ITEMS as ItemKind[]).includes(kind)) discovered.add(kind);
  }
  activeExpeditionId = null;
  expeditionCargo = {};
  expeditionCollected.clear();
  clearBeasts();
  disposeExpeditionWorld();
  homeWorld.visible = true;
  activeHeight = islandHeight;
  player.setTerrain(islandHeight);
  expeditionUi.setAvailable(true);
  expeditionUi.refresh();
  cameraSettled = false;
  return { lost };
}

function addFuel(): boolean {
  const fire = nearestBuilding('campfire');
  if (!fire) { toast('需要靠近篝火'); return false; }
  const maxFuel = fire.level >= 2 ? 420 : 240;
  const fuelGain = fire.level >= 2 ? 90 : 60;
  if (inv.wood < 1) { toast('没有木材'); return false; }
  if (fire.fuel >= maxFuel) { toast('篝火燃料已满'); return false; }
  inv.wood--; fire.fuel = Math.min(maxFuel, fire.fuel + fuelGain); saveGame(); toast(`加入木材 · +${fuelGain}秒`); return true;
}

// 有鱼先烤鱼:鱼是住客给的,放着不烤就只能生吃,那渔夫这门手艺就没有下文了
function cookInput(): 'fish' | 'food' | null {
  if (inv.fish > 0) return 'fish';
  if (inv.food > 0) return 'food';
  return null;
}

function cook(): boolean {
  const fire = nearestBuilding('campfire');
  if (!fire) { toast('需要靠近篝火'); return false; }
  if (fire.cooking > 0) { toast('火上还有东西'); return false; }
  if (fire.fuel <= 8) { toast('篝火燃料不足'); return false; }
  const input = cookInput();
  if (!input) { toast('没有可烤的东西'); return false; }
  inv[input]--; fire.fuel -= 8; fire.cooking = 5; fire.cookingKind = input;
  saveGame();
  toast(`开始${input === 'fish' ? '烤鱼' : '烤椰子'} · 5秒`);
  return true;
}

function drink(): boolean {
  if (vitals.thirst > 95) { toast('现在不渴'); return false; }
  const atSpring = Math.hypot(spring.x - player.position.x, spring.z - player.position.z) < 3.2;
  const collector = nearestBuilding('collector');
  if (!atSpring && (!collector || collector.water < 1)) { toast('这里没有可饮用的水'); return false; }
  if (collector && !atSpring) collector.water--;
  // 淡水相对易得,一次补足够多,避免玩家被"每分钟跑一趟水源"绑住
  vitals.thirst = Math.min(100, vitals.thirst + 60);
  saveGame(); toast('喝到了淡水'); return true;
}

function weather(dayNumber: number): { start: number; end: number } | null {
  const n = Math.abs(Math.sin(dayNumber * 91.731) * 10000) % 1;
  if (n < 0.22) return null;
  const start = 0.3 + n * 0.25;
  return { start, end: Math.min(0.72, start + 0.08 + (n * 7 % 1) * 0.07) };
}

function nearest(): Harvestable | null {
  let best: Harvestable | null = null;
  let bestD = HARVEST_RANGE;
  for (const r of resources) {
    if (r.respawnAt > 0) continue;
    const d = Math.hypot(r.x - player.position.x, r.z - player.position.z);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

function harvest(target: Harvestable): void {
  player.startSwing();
  effects.harvest(target.kind, target.mesh.position, player.position);
  target.hp--;
  const gain = YIELD[target.kind]();
  for (const k of Object.keys(gain) as Array<keyof Inventory>) {
    inv[k] += gain[k] ?? 0;
  }
  vitals.energy = Math.max(0, vitals.energy - 2.5);
  if (target.hp <= 0) {
    target.respawnAt = 25 + Math.random() * 20; // 秒后重生
    target.mesh.visible = false;
  }
  saveGame();
}

let lastT = performance.now();
// 把一帧的逻辑抽出来:便于测试时手动步进(浏览器隐藏时 rAF 会被节流)
function step(dt: number, now: number): void {
  // 分享面板打开时把世界冻住:填名字、贴链接的时候不该被野猪追、更不该被饿死。
  // 顺手把攒着的 E 丢掉 —— 面板是用 E 打开的,不清掉就会在关闭的瞬间又开一次
  if (shareUi.open || expeditionUi.open) { dt = 0; input.clearAction(); }

  toastLeft = Math.max(0, toastLeft - dt);
  if (toastLeft <= 0) toastText = null;
  hurtLeft = Math.max(0, hurtLeft - dt);
  invulnerableLeft = Math.max(0, invulnerableLeft - dt);

  // 移动:俯视角下摇杆直接映射世界方向;近景则把输入按固定机位旋转,
  // 让 W 永远是"往前走"、A/D 是左右横移。角色随移动方向转向,镜头不追、才不会打转。
  const dir = input.read();
  let moveX = dir.x;
  let moveZ = dir.z;
  if (cameraMode === 'shoulder') {
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);  // 镜头朝前(角色朝向)
    const rx = -Math.cos(camYaw), rz = Math.sin(camYaw); // 角色右侧
    const fwd = -dir.z;    // W → +1
    const strafe = dir.x;  // D → +1
    moveX = fx * fwd + rx * strafe;
    moveZ = fz * fwd + rz * strafe;
  }
  player.update(dt, moveX, moveZ);
  effects.update(dt);
  const moving = Math.hypot(moveX, moveZ) > 0.05;
  footprintLeft -= dt;
  if (moving && footprintLeft <= 0 && activeHeight(player.position.x, player.position.z) > 0.45) {
    footprintLeft = 0.34; footprintSide *= -1;
    effects.footprint(player.position, Math.atan2(moveX, moveZ), footprintSide);
  }
  springRippleLeft -= dt;
  if (!activeExpeditionId && springRippleLeft <= 0) {
    springRippleLeft = 1.15;
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.75;
    effects.ripple(spring.x + Math.cos(a) * r, spring.z + Math.sin(a) * r, islandHeight(spring.x, spring.z) + 0.19);
  }

  // 昼夜。本机美术回归入口固定在晴朗上午，截图不会受存档时间与随机天气影响。
  if (qaFixedTimeOfDay !== null) {
    clockT = DAY_SECONDS * qaFixedTimeOfDay;
  } else {
    clockT += dt * (sunsetEgg ? SUNSET_SPEED : 1);
    if (clockT >= DAY_SECONDS) {
      clockT -= DAY_SECONDS;
      // 参观时天数是岛主的,不该跟着客人待多久而变
      if (!guestMode) {
        day++;
        // 新的一天:先结算漂流物,玩家一睁眼海面上就有东西在漂过来
        deliverFlotsam();
        toast(`第 ${day} 天 · 海上漂来了新东西`);
        maybeWelcomeResident();
        saveGame();
      }
    }
  }
  const tod = clockT / DAY_SECONDS;
  const forecast = weather(day);
  const isRaining = qaFixedTimeOfDay === null && !!forecast && tod > forecast.start && tod < forecast.end;
  const sunAngle = tod * Math.PI * 2 - Math.PI / 2;
  // 太阳方向只由时刻决定;光源本体挂在角色的固定偏移上。
  // 这样阴影视锥永远罩着角色周围同一块相对区域,岛再大也不会有人走出阴影范围。
  // (方向和位置必须分开算:位置跟着角色跑,归一化之后的"方向"就会随走位漂移,
  //  天上的太阳会跟着人晃。)
  sunDirTmp.set(Math.cos(sunAngle) * 60, Math.max(6, Math.sin(sunAngle) * 55 + 8), 25).normalize();
  sun.position.copy(player.position).addScaledVector(sunDirTmp, 80);
  const daylight = Math.max(0, Math.sin(tod * Math.PI * 2 - 0.4));
  // 暖主光 + 冷填充：保留清楚的投影，但不让背光面和长树影吞掉地表细节。
  const rainSun = isRaining ? 0.34 : 1;
  const caveLightScale = activeExpeditionId === 'cave' ? 0.8 : 1;
  sun.intensity = (0.5 + daylight * 1.3) * rainSun * caveLightScale;
  ambient.intensity = (0.62 + daylight * 0.38) * (isRaining ? 0.86 : 1) * caveLightScale;
  fillLight.intensity = (0.13 + daylight * 0.2) * (isRaining ? 0.55 : 1) * caveLightScale;
  fillLight.position.set(-sun.position.x, Math.max(22, sun.position.y * 0.55), -sun.position.z);
  moon.intensity = (1 - daylight) * 0.75;
  stars.visible = daylight < 0.12;
  renderer.toneMappingExposure = isRaining ? 0.96 : 1.08;

  // 天空三段渐变按昼夜插值;黄昏地平线偏暖橙,正午偏白蓝
  const dusk = Math.max(0, 1 - Math.abs(daylight - 0.28) / 0.28); // 日出/日落权重
  const k = Math.min(1, daylight * 1.4);
  skyHorizon.copy(SKY_NIGHT_H).lerp(SKY_DAY_H, k).lerp(SKY_DUSK_H, dusk * 0.75);
  skyMid.copy(SKY_NIGHT_M).lerp(SKY_DAY_M, k).lerp(SKY_DUSK_M, dusk * 0.55);
  skyZenith.copy(SKY_NIGHT_Z).lerp(SKY_DAY_Z, k);
  if (isRaining) {
    skyHorizon.lerp(SKY_RAIN_H, 0.82);
    skyMid.lerp(SKY_RAIN_M, 0.86);
    skyZenith.lerp(SKY_RAIN_Z, 0.84);
  }
  if (activeExpeditionId === 'cave') {
    skyHorizon.lerp(CAVE_SKY_H, 0.2);
    skyMid.lerp(CAVE_SKY_M, 0.22);
    skyZenith.lerp(CAVE_SKY_Z, 0.18);
  }
  sky.setPalette(skyHorizon, skyMid, skyZenith);
  // 海面掠射角反射的是天空,所以天色一变海色也得跟着变
  ocean.setSkyTint(skyMid);
  // 雾色跟地平线一致,远处物体才会自然融进天空
  const fog = scene.fog as THREE.Fog;
  fog.color.copy(skyHorizon);
  if (activeExpeditionId === 'cave') {
    fog.color.lerp(CAVE_FOG, 0.28);
    fog.near = isRaining ? 24 : 32;
    fog.far = isRaining ? 96 : 128;
  } else {
    fog.near = isRaining ? 44 : 62;
    fog.far = isRaining ? 158 : 240;
  }
  // sunDirTmp 上面已经算好(不含角色位移),这里直接用
  moonDirTmp.copy(moon.position).normalize();
  updateSky(sky, dt, camera.position, sunDirTmp, moonDirTmp, daylight, isRaining ? 0.84 : 0);

  // 生存数值随时间下降
  // 消耗速率:目标是"一天(300 秒)喝约 2 次、吃约 1.5 次",留出探索与建造的空档
  // 饥饿 100/0.30 ≈ 333 秒(略长于一天),口渴 100/0.38 ≈ 263 秒
  // 参观时也照常消耗,只是慢一半、而且绝不掉血。
  // 客人在别人岛上会渴、会累 —— 这正是"这座岛招不招待得了客人"能被亲身感觉到的原因:
  // 有集雨器就有水喝,有庇护所就能歇脚,什么都没有就只能干走。
  // 但客人不会在别人家里昏倒:那是主人的失礼,不该记在玩家头上。
  const vitalScale = guestMode ? 0.5 : 1;
  vitals.hunger = Math.max(0, vitals.hunger - dt * 0.30 * vitalScale);
  vitals.thirst = Math.max(0, vitals.thirst - dt * 0.38 * vitalScale);
  if (dir.x === 0 && dir.z === 0) {
    vitals.energy = Math.min(100, vitals.energy + dt * 2.2);
  } else {
    vitals.energy = Math.max(0, vitals.energy - dt * 0.7 * vitalScale);
  }
  // 饥渴归零的后果:持续掉体力;体力低则走不动(温和惩罚,不做死亡)
  const starving = vitals.hunger <= 0 || vitals.thirst <= 0;
  if (starving) vitals.energy = Math.max(0, vitals.energy - dt * 6 * vitalScale);
  faintGrace = Math.max(0, faintGrace - dt);
  if (!guestMode && starving && vitals.energy <= 0 && faintGrace <= 0) {
    vitals.health = Math.max(0, vitals.health - dt * 5);
  }

  // 建筑更新与效果
  let nearFire = false;
  let inShelter = false;
  for (const b of buildings) {
    updateBuilding(b, dt, now / 1000);
    const d = Math.hypot(b.x - player.position.x, b.z - player.position.z);
    if (!activeExpeditionId && d < buildingRadius(b)) {
      // 灯塔和点着的篝火一样能取暖:它是拿稀有材料换来的永久版篝火
      if (repelsBoars(b)) nearFire = true;
      if (b.kind === 'shelter') inShelter = true;
    }
  }

  // 漂流物漂近岸边;刚靠岸时提示一次,玩家不必一直盯着海面
  for (const f of flotsam) {
    if (updateFlotsam(f, dt, now / 1000)) {
      effects.ripple(f.x, f.z, Math.max(0.14, islandHeight(f.x, f.z)) + 0.05);
      toast(`${FLOTSAM_DEFS[f.kind].label}靠岸了`);
    }
  }

  // 夜晚寒冷:掉体力 —— 这就是篝火存在的意义
  const isNight = daylight < 0.12;
  if (isNight && !nearFire && !inShelter) {
    // 夜寒:一天变长后夜晚绝对时长也变长,单位伤害相应下调。
    // 客人也一样冷 —— 岛上有没有篝火/灯塔,他们是靠这个感觉到的
    vitals.energy = Math.max(0, vitals.energy - dt * 2.4 * vitalScale);
  }
  // 庇护所内静止休息:体力快速回复(客人也能歇脚)
  const resting = inShelter && dir.x === 0 && dir.z === 0;
  if (resting) {
    const shelter = nearestBuilding('shelter', 5.8);
    vitals.energy = Math.min(100, vitals.energy + dt * (shelter?.level === 2 ? 14 : 9));
  }

  // 午后阵雨为集雨器补水。每个集雨器最多储存 8 份。
  if (isRaining) {
    for (const b of buildings) if (b.kind === 'collector') {
      const maxWater = b.level >= 2 ? 16 : 8;
      const rate = b.level >= 2 ? 0.22 : 0.12;
      b.water = Math.min(maxWater, b.water + dt * rate);
    }
  }
  rainRippleLeft -= dt;
  if (isRaining && rainRippleLeft <= 0) {
    rainRippleLeft = 0.09;
    const x = player.position.x + (Math.random() - 0.5) * 18;
    const z = player.position.z + (Math.random() - 0.5) * 18;
    effects.ripple(x, z, activeHeight(x, z) + 0.07);
  }
  for (const b of buildings) {
    if (b.waterMesh) {
      const maxWater = b.level >= 2 ? 16 : 8;
      b.waterMesh.visible = b.water > 0.05;
      b.waterMesh.position.y = 0.18 + (b.water / maxWater) * 0.58;
      b.waterMesh.scale.y = 0.6 + b.water / maxWater;
    }
    if (b.kind === 'campfire' && b.cooking > 0) {
      b.cooking = Math.max(0, b.cooking - dt);
      if (b.cooking === 0) {
        inv.cookedFood++;
        toast(b.cookingKind === 'fish' ? '烤鱼完成了' : '烤椰子完成了');
        b.cookingKind = undefined;
        saveGame();
      }
    }
  }
  rain.visible = isRaining;
  if (isRaining) {
    rain.position.set(player.position.x, player.position.y, player.position.z);
    const pos = rainGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < 180; i++) {
      const a = i * 2, b = a + 1;
      let y = pos.getY(a) - dt * 20;
      if (y < 0) y += 20;
      pos.setY(a, y); pos.setY(b, y - 0.75);
    }
    pos.needsUpdate = true;
  }

  // 夜行野猪追逐玩家，但会主动逃离燃烧的篝火与灯塔(各自的半径不同)。
  // 参观时没有野猪:客人不该在别人家里挨揍
  const liveFires = repelField(buildings);
  for (const boar of guestMode || activeExpeditionId ? [] : boars) {
    if (updateBoar(boar, dt, player.position, isNight, liveFires) && invulnerableLeft <= 0) {
      vitals.health = Math.max(0, vitals.health - 22);
      player.startHurt();
      invulnerableLeft = 1.2; hurtLeft = 0.65;
      const dx = player.position.x - boar.group.position.x;
      const dz = player.position.z - boar.group.position.z;
      const len = Math.hypot(dx, dz) || 1;
      player.position.x += dx / len * 1.8; player.position.z += dz / len * 1.8;
      toast('被野猪撞伤了！');
    }
  }

  // 昏倒:醒来时必须留出够跑到水源/食物的余量,否则会立刻再次昏倒
  // (原先只恢复到 20,20 点口渴按 1.3/s 只够 15 秒 —— 挂机时会无限昏倒、天数虚增)
  if (vitals.health <= 0 && !guestMode) {
    const faintedOnExpedition = !!activeExpeditionId;
    const lost = faintedOnExpedition ? abortExpedition().lost : [];
    player.position.set(0, islandHeight(0, 0), 0);
    vitals.health = 60;
    vitals.energy = Math.max(55, vitals.energy);
    vitals.hunger = Math.max(55, vitals.hunger);
    vitals.thirst = Math.max(55, vitals.thirst);
    faintGrace = 3;                    // 醒来后短暂免伤,避免边界情况下连环昏倒
    clockT = DAY_SECONDS * 0.28; day++;
    toast(faintedOnExpedition
      ? `远征途中昏倒 · 丢了一半货物${lost.length > 0 ? ` (${lost.join(' ')})` : ''} · 第二天在营地醒来`
      : '你昏倒了 · 第二天在营地醒来');
    saveGame();
  }

  player.speed = 7.2 * (vitals.energy < 25 ? 0.45 : 1);

  // 建造请求(建造栏随解锁变长)。参观时建造栏为空 —— 别人的岛不给你改
  const buildOrderNow = guestMode || activeExpeditionId ? [] : buildOrder();
  input.buildCount = buildOrderNow.length;
  input.itemKinds = visibleItems(inv);
  const req = input.consumeBuild();
  if (req >= 0 && req < buildOrderNow.length) build(buildOrderNow[req]);

  // 资源重生
  for (const r of resources) {
    if (r.respawnAt > 0) {
      r.respawnAt -= dt;
      if (r.respawnAt <= 0) {
        r.respawnAt = 0;
        r.hp = r.kind === 'fiber' ? 2 : 3;
        r.mesh.visible = true;
      }
    } else if (r.kind !== 'stone') {
      // 风吹摇曳:椰子树幅度大(高、柔),灌木小;石头当然不该动
      // 原先统一 0.025 弧度(1.4°)几乎看不出,而且连石头一起晃
      r.swayPhase += dt * (r.kind === 'wood' ? 1.15 : 1.6);
      const amp = r.kind === 'wood' ? 0.075 : 0.045;
      // 主摆 + 一个更快的小分量,摆动不呆板
      const s = Math.sin(r.swayPhase) + Math.sin(r.swayPhase * 2.3) * 0.28;
      r.visual.rotation.z = s * amp;
      r.visual.rotation.x = Math.sin(r.swayPhase * 0.8 + 1.1) * amp * 0.55;
    }
  }

  // 采集交互:输入缓冲,条件不满足时不吃掉按键
  // 参观时只关掉"会改动这座岛"的那一半:采集、打捞、加柴、建造、升级都不行,
  // 但主人备下的设施照用 —— 待客清单承诺的就是这些
  const target = guestMode || activeExpeditionId ? null : nearest();
  const salvageTarget = guestMode || activeExpeditionId ? null : nearestFlotsam();
  const residentTarget = guestMode || activeExpeditionId ? null : nearestResident();
  const expeditionPoiTarget = activeExpeditionId ? nearestExpeditionPoi() : null;
  // 稍微放宽一点判定距离:环圈要在够得着之前就亮起来,否则玩家不知道自己进没进射程
  const beastTarget = activeExpeditionId ? nearestBeast(beasts, player.position.x, player.position.z, HIT_RANGE + 0.8) : null;
  const atExpeditionBoat = !!activeExpeditionId && nearExpeditionBoat();
  const upgradeTarget = guestMode ? null : nearestUpgradeableBuilding();
  input.upgradeEnabled = !!upgradeTarget;
  if (guestMode && input.actionQueued && !player.swinging) {
    const nearWater = Math.hypot(spring.x - player.position.x, spring.z - player.position.z) < 3.2
      || !!nearestBuilding('collector');
    const garden = nearestBuilding('garden');
    const dock = nearestBuilding('dock', 4.6);
    const mapTable = nearestBuilding('maptable', 3.8);
    if (mapTable) { input.clearAction(); shareUi.openIslandCard(); }
    else if (dock) { input.clearAction(); shareUi.openGift(); }
    else if (nearWater && drink()) input.clearAction();
    else if (garden && pickGarden(garden)) input.clearAction();
  } else if (!guestMode && input.actionQueued && !player.swinging) {
    if (activeExpeditionId) {
      // 攻击排在最前:野兽就在扇形里的时候,按 E 的意图一定是打它,
      // 而不是去够旁边的调查点
      if (swingAtBeasts()) input.clearAction();
      else if (expeditionPoiTarget) { input.clearAction(); collectExpeditionPoi(expeditionPoiTarget); }
      else if (atExpeditionBoat) { input.clearAction(); returnFromExpedition(); }
    } else {
      const nearWater = Math.hypot(spring.x - player.position.x, spring.z - player.position.z) < 3.2
        || !!nearestBuilding('collector');
      const fire = nearestBuilding('campfire');
      const garden = nearestBuilding('garden');
      const dock = nearestBuilding('dock', 4.6);
      const mapTable = nearestBuilding('maptable', 3.8);
      // 打捞排在最前:玩家特意跑到海边,不该被旁边的树抢走这一下
      if (salvageTarget) { input.clearAction(); salvage(salvageTarget); }
      // 住客排在设施之前:人站在那儿,玩家按 E 的意图几乎一定是找他
      else if (residentTarget && talkToResident(residentTarget)) input.clearAction();
      else if ((dock || mapTable) && hasNavigation()) { input.clearAction(); expeditionUi.openMap(); }
      else if (nearWater && drink()) input.clearAction();
      else if (fire && ((fire.fuel < 60 && addFuel()) || cook())) input.clearAction();
      else if (garden && pickGarden(garden)) input.clearAction();
      else if (target) { input.clearAction(); harvest(target); }
    }
  }
  // 进食:客人也能吃(能吃的只有刚从主人花圃里摘的那颗果子)。
  // 加柴/烹饪/升级仍然禁用,但按键一律消费掉,否则回家后会立刻触发
  const ate = input.consumeEat();
  const fueled = input.consumeFuel();
  const cooked = input.consumeCook();
  const upgradeRequested = input.consumeUpgrade();
  if (ate) eat();
  if (!guestMode && !activeExpeditionId) {
    if (fueled) addFuel();
    if (cooked) cook();
    if (upgradeRequested) {
      if (upgradeTarget) upgradeBuilding(upgradeTarget);
      else toast('靠近可升级的建筑后再按 U');
    }
  }

  // 海面轻微起伏 + 草地风吹 + 云影漂移
  // 住客。**逻辑**(产出计时与要求循环)只在自己岛上推进 —— 那是岛主的进度;
  // **画面**两边都要跑,否则客人看到的是一排定在原地的人。
  if (!activeExpeditionId) {
    const dock = dockSpot();
    for (const r of residents) {
      if (!guestMode) updateResident(r, dt);
      const view = residentViews.get(r.id);
      // 站位要绕开自家小屋/码头的实体,否则人就站在屋顶底下看不见了
      if (view) updateResidentView(view, r, dock, now / 1000, dt, standOffAt(r.home ?? dock));
    }
  }

  ocean.update(now / 1000);
  updateShore(now / 1000);
  updateCloudShadow(now / 1000);
  updateGrassWind(now / 1000);
  activeExpeditionWorld?.update?.(now / 1000);

  // 野兽:只在远征岛上推进
  if (activeExpeditionId && activeExpeditionWorld) {
    const radius = EXPEDITIONS[activeExpeditionId].radius;
    for (const beast of beasts) {
      const landed = updateBeast(beast, dt, player.position.x, player.position.z, radius, activeHeight);
      if (landed && invulnerableLeft <= 0) {
        vitals.health = Math.max(0, vitals.health - BEAST_DEFS[beast.kind].damage);
        player.startHurt();
        invulnerableLeft = 1.2; hurtLeft = 0.65;
        const dx = player.position.x - beast.x;
        const dz = player.position.z - beast.z;
        const len = Math.hypot(dx, dz) || 1;
        player.position.x += (dx / len) * 1.6;
        player.position.z += (dz / len) * 1.6;
        toast(`被${beastName(beast)}夹了一下！`);
      }
      const view = beastViews.get(beast);
      if (view) updateBeastView(view, beast, dt, activeHeight(beast.x, beast.z));
    }
  }
  atmosphere.update(now / 1000, daylight, isRaining);

  // 相机跟随
  const cameraOffsetX = cameraMode === 'overhead' && window.innerWidth < 600 ? 3.2 : 0;
  if (cameraMode === 'overhead') {
    // 固定俯视 3/4 角:能一眼看完整座岛,这是经营与"给别人看"这条线的前提
    if (activeExpeditionId) {
      // 远征岛只有主岛的一半大，镜头锁定岛心才能同时看清登陆木筏与深处地标。
      camTargetTmp.set(window.innerWidth < 600 ? 1.5 : 0, window.innerWidth < 600 ? 18 : 15.5, window.innerWidth < 600 ? 21 : 18);
      camLookTmp.set(window.innerWidth < 600 ? 1.5 : 0, 1.1, 0);
    } else {
      camTargetTmp.set(
        player.position.x + cameraOffsetX,
        player.position.y + (window.innerWidth < 600 ? 25 : 22),
        player.position.z + (window.innerWidth < 600 ? 29 : 27)
      );
      camLookTmp.set(player.position.x + cameraOffsetX, player.position.y + 1.4, player.position.z);
    }
  } else {
    // 近景:固定机位(切进来那一刻的朝向),相机只跟着角色平移、不再追着朝向转。
    // 这样 WASD 才能稳定映射成屏幕上的前后左右,角色朝哪走就朝哪转,
    // 而不是"镜头追着角色、方向又跟着镜头"互相牵扯地打转。
    const bx = Math.sin(camYaw);
    const bz = Math.cos(camYaw);
    const sideX = bz;
    const sideZ = -bx;
    camTargetTmp.set(
      player.position.x - bx * SHOULDER_DIST + sideX * 1.45,
      player.position.y + SHOULDER_HEIGHT,
      player.position.z - bz * SHOULDER_DIST + sideZ * 1.45
    );
    // 别钻进山坡里:相机脚下的地形比它还高时,把它顶上去
    const ground = activeHeight(camTargetTmp.x, camTargetTmp.z) + 1.1;
    if (camTargetTmp.y < ground) camTargetTmp.y = ground;
    // 看向角色前方一点,视野重心才在"要去的地方"而不是后脑勺
    camLookTmp.set(
      player.position.x + bx * 3.6 + sideX * 1.05,
      player.position.y + 1.5,
      player.position.z + bz * 3.6 + sideZ * 1.05
    );
  }
  if (!cameraSettled || camera.position.distanceTo(camTargetTmp) > CAMERA_SNAP_DIST) {
    camera.position.copy(camTargetTmp);
    cameraSettled = true;
  } else {
    camera.position.lerp(camTargetTmp, 1 - Math.exp(-dt * (cameraMode === 'overhead' ? 4 : 6)));
  }
  camera.lookAt(camLookTmp);
  sun.target = player.group;

  // 近景只隐藏"前景"里真正会盖满屏幕的树:树冠在视线上方、真正挡视线的是树干,
  // 所以只对离镜头较近(t 取相机侧半程)、且树干正压在连线上的树做可见性切换。
  // 原来的 1.65 + 全程 t 会把只擦到边、离得又远的整棵树也"隐形"掉,
  // 看起来就像树叶变透明。共享材质没法安全做单株半透明,可见性切换最稳,切回俯视立即恢复。
  for (const r of resources) {
    r.visual.visible = r.respawnAt <= 0;
    if (cameraMode !== 'shoulder' || activeExpeditionId || r.kind !== 'wood' || r.respawnAt > 0) continue;
    const dx = player.position.x - camera.position.x;
    const dz = player.position.z - camera.position.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = ((r.x - camera.position.x) * dx + (r.z - camera.position.z) * dz) / len2;
    if (t <= 0.08 || t >= 0.5) continue;
    const px = camera.position.x + dx * t;
    const pz = camera.position.z + dz * t;
    if (Math.hypot(r.x - px, r.z - pz) < 0.75) r.visual.visible = false;
  }

  // 夜里辉光更强:同样的火光在暗背景上本来就更晃眼
  postfx.setTimeOfDay(daylight, dusk);
  postfx.render();

  // 建造按钮状态
  const rects = buildButtonRects(buildOrderNow.length);
  const buildButtons: BuildButton[] = buildOrderNow.map((kind, i) => {
    const def = BUILDING_DEFS[kind];
    const costText = (Object.keys(def.cost) as ItemKind[])
      .map((k) => `${COST_ICON[k]}${def.cost[k]}`)
      .join(' ');
    return {
      label: def.label,
      icon: def.icon,
      costText,
      affordable: canAfford(kind),
      blocked: placementBlocked(kind),
      rect: rects[i],
    };
  });

  // 航海图从开局就能查看，未建基础设施时只展示锁定航线与建设要求；
  // 真正出发仍由 destinationViews() 严格要求码头 + 制图桌。
  expeditionUi.setAvailable(!guestMode && !activeExpeditionId);
  // 这些设施客人也用得上,所以不再按 guestMode 一刀切掉;
  // 唯独篝火的"加柴/烹饪"按钮是改动别人的岛,客人那边要关掉
  const nearFireForHint = activeExpeditionId ? null : nearestBuilding('campfire');
  input.fireActionsEnabled = !guestMode && !!nearFireForHint;
  const nearCollectorForHint = activeExpeditionId ? null : nearestBuilding('collector');
  const nearGardenForHint = activeExpeditionId ? null : nearestBuilding('garden');
  const nearDockForHint = activeExpeditionId ? null : nearestBuilding('dock', 4.6);
  const nearMapTableForHint = activeExpeditionId ? null : nearestBuilding('maptable', 3.8);
  const atSpringForHint = !activeExpeditionId
    && Math.hypot(spring.x - player.position.x, spring.z - player.position.z) < 3.2;
  // 触屏设备(手机/平板)用"点右侧"提示,桌面才用 Q/R/空格。
  // 不能只按宽度:平板和横屏手机都超过 600px,按宽度会把它们误判成有键盘的桌面。
  const touchUI = isTouchDevice();
  // 交互环跟着 E 的实际优先级走,不然环圈在树上、按 E 却打捞了箱子
  const expeditionRingObject = expeditionPoiTarget?.group ?? (atExpeditionBoat ? activeExpeditionWorld?.boat : null);
  const ringTarget: { x: number; z: number } | null = activeExpeditionId
    ? beastTarget
      ? { x: beastTarget.x, z: beastTarget.z }
      : expeditionRingObject ? { x: expeditionRingObject.position.x, z: expeditionRingObject.position.z } : null
    : guestMode
      // 客人这边的顺序必须和上面的按键分支一致,否则环圈套着篝火、按 E 却去喝了水
      ? nearMapTableForHint ?? nearDockForHint
        ?? (atSpringForHint ? { x: spring.x, z: spring.z } : null)
        ?? (nearCollectorForHint && nearCollectorForHint.water >= 1 ? nearCollectorForHint : null)
        ?? (nearGardenForHint && nearGardenForHint.stock > 0 ? nearGardenForHint : null)
    : salvageTarget
      ? { x: salvageTarget.x, z: salvageTarget.z }
      : residentTarget
        ? residentSpot(residentTarget)
        : atSpringForHint
          ? { x: spring.x, z: spring.z }
          : nearDockForHint ?? nearMapTableForHint ?? nearFireForHint ?? nearCollectorForHint ?? nearGardenForHint ?? target;
  interactionRing.visible = !!ringTarget;
  if (ringTarget) {
    interactionRing.position.set(ringTarget.x, activeHeight(ringTarget.x, ringTarget.z) + 0.1, ringTarget.z);
    const pulse = 1 + Math.sin(now / 220) * 0.08;
    interactionRing.scale.setScalar(pulse);
  }

  // 岛屿进度 + 漂流物指引
  const progress = islandProgress(buildings);
  const pointer = guestMode ? null : flotsamPointer();

  // 做客提示:只说客人真的能做的那几件事,别的一律不提
  // 客人不能和别人家的住客交易,但至少该知道站在面前的是谁
  const guestResident = guestMode && !activeExpeditionId ? nearestResident() : null;
  const guestHint = !guestMode
    ? null
    : guestResident
      ? `${TRADES[guestResident.trade].name} · 这座岛的${TRADES[guestResident.trade].title}`
    : nearMapTableForHint
      ? '制图桌 · 按 E 看这座岛的名片'
      : nearDockForHint
        ? '码头 · 按 E 留下伴手礼'
        : atSpringForHint
          ? '主人的清泉 · 按 E 喝水'
          : nearCollectorForHint && nearCollectorForHint.water >= 1
            ? '主人的集雨器 · 按 E 喝水'
            : nearGardenForHint && nearGardenForHint.stock > 0
              ? `主人的花圃 · 熟了 ${nearGardenForHint.stock}/${GARDEN_MAX} · 按 E 摘一颗`
              : resting
                ? '在主人的庇护所里歇脚 · 体力回复'
                : isNight && !nearFire && !inShelter
                  ? '夜里好冷 · 这座岛上没有能取暖的地方'
                  : null;

  const residentHint = residentTarget ? (() => {
    const def = TRADES[residentTarget.trade];
    if (!residentTarget.home) return `${def.name}(${def.title})在等一间小屋`;
    if (residentTarget.stock > 0) {
      return `${def.name} · 有 ${residentTarget.stock} 份${ITEM_LABEL[def.yields]}可以拿 · 按 E`;
    }
    if (residentTarget.request) {
      const req = residentTarget.request;
      const have = inv[req.kind];
      return `${def.name}想要 ${req.count} 份${ITEM_LABEL[req.kind]}(有 ${have}) · 按 E 给他`;
    }
    return `${def.name}正忙着,过会儿再来`;
  })() : null;

  const hint = guestMode
    ? guestHint
    : beastTarget
      ? `${BEAST_DEFS[beastTarget.kind].name} · 正面是壳 · 绕到侧后按 E`
    : expeditionPoiTarget
      ? `${expeditionPoiTarget.def.label} · 按 E 调查 · 载货 ${cargoUsed(expeditionCargo)}/${expeditionCapacity()}`
    : atExpeditionBoat
      ? `返航木筏 · 按 E 回营地 · 载货 ${cargoUsed(expeditionCargo)}/${expeditionCapacity()}`
    : activeExpeditionId
      ? cargoUsed(expeditionCargo) >= expeditionCapacity()
        ? '载货已满 · 返回登陆点的木筏'
        : '寻找岛上的特殊地标，调查后再回木筏返航'
    : salvageTarget
    ? `${FLOTSAM_DEFS[salvageTarget.kind].label} · 按 E / 点右侧打捞`
    : residentHint
    ? residentHint
    : atSpringForHint
    ? '清泉 · 按 E / 点右侧饮水'
    : nearCollectorForHint
        ? `集雨器 · 水量 ${nearCollectorForHint.water.toFixed(1)}/${nearCollectorForHint.level >= 2 ? 16 : 8} · 按 E / 点右侧饮水`
      : nearDockForHint || nearMapTableForHint
        ? `${nearMapTableForHint ? '制图桌' : '码头'} · 按 E 打开航海图`
      : nearFireForHint
        ? touchUI
        ? `篝火 ${Math.ceil(nearFireForHint.fuel)}秒${nearFireForHint.cooking > 0 ? ` · 烹饪${Math.ceil(nearFireForHint.cooking)}秒` : ''} · 点右侧操作`
          : `篝火 ${Math.ceil(nearFireForHint.fuel)}秒${nearFireForHint.cooking > 0 ? ` · 烹饪 ${Math.ceil(nearFireForHint.cooking)}秒` : ''} · Q/R 操作`
        : nearGardenForHint
          ? nearGardenForHint.stock > 0
            ? `花圃 · 熟了 ${nearGardenForHint.stock}/${GARDEN_MAX} · 按 E 采摘`
            : '花圃 · 果子还在长'
        : target
    ? touchUI
      ? `采集 ${LABEL[target.kind]} · 剩 ${target.hp}`
      : `按空格 / 点右侧采集 ${LABEL[target.kind]}（剩 ${target.hp}）`
    : resting
      ? '休息中 · 体力回复'
      : isNight && !nearFire && !inShelter
        ? '夜里好冷 · 野猪出没，篝火能驱赶它们'
        : isRaining
          ? '下雨了 · 集雨器正在储水'
        : (vitals.hunger < 35 || vitals.thirst < 35) && (inv.food > 0 || inv.cookedFood > 0)
          ? '肚子饿了 · 按 F / 点食物进食'
          : pointer
            ? '海上漂来了东西 · 顺着箭头去海边'
            : null;

  const upgradeDef = upgradeTarget ? BUILDING_UPGRADES[upgradeTarget.kind] : null;
  const upgradeCostText = upgradeDef
    ? (Object.keys(upgradeDef.cost) as ItemKind[]).map((k) => `${COST_ICON[k]}${upgradeDef.cost[k]}`).join(' ')
    : '';
  const upgradeAction = upgradeTarget && upgradeDef ? {
    label: upgradeDef.label,
    costText: upgradeCostText,
    enabled: upgradeTarget.level < 2 && blueprints.has(upgradeDef.kind) && canAffordCost(upgradeDef.cost),
    reason: upgradeTarget.level >= 2
      ? '已完成升级'
      : !blueprints.has(upgradeDef.kind)
        ? '缺少远征图纸'
        : !canAffordCost(upgradeDef.cost)
          ? '材料不足'
          : undefined,
  } : null;
  hud.render({
    vitals, inv, day, timeOfDay: tod, hint, input, buildButtons,
    visiting: !!guestMode,
    showFireActions: !!nearFireForHint,
    toast: toastText,
    hurtAlpha: hurtLeft / 0.65,
    level: progress.level,
    levelProgress: progress.progress,
    pointer,
    upgradeAction,
    objective: guestMode ? null : activeExpeditionId
      ? '调查岛上的特殊地标；载货有限，选好要带回营地的材料后从木筏返航。'
      : expeditionObjective(),
    expedition: activeExpeditionId ? {
      name: EXPEDITIONS[activeExpeditionId].name,
      cargoUsed: cargoUsed(expeditionCargo),
      cargoCapacity: expeditionCapacity(),
    } : null,
  });
}

// 指向最近的漂流物:投影到屏幕,出屏时 HUD 会画成边缘箭头
// (岛直径 46 米,没有指引玩家根本不知道往哪边走)
const pointerTmp = new THREE.Vector3();
function flotsamPointer(): Pointer | null {
  if (activeExpeditionId) return null;
  let best: Flotsam | null = null;
  let bestD = Infinity;
  for (const f of flotsam) {
    const d = Math.hypot(f.group.position.x - player.position.x, f.group.position.z - player.position.z);
    if (d < bestD) { bestD = d; best = f; }
  }
  // 已经走到跟前就不用再指了,交互提示会接手
  if (!best || bestD < SALVAGE_RANGE) return null;
  pointerTmp.copy(best.group.position);
  pointerTmp.y += 0.6;
  pointerTmp.project(camera);
  const behind = pointerTmp.z > 1;
  const x = (pointerTmp.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-pointerTmp.y * 0.5 + 0.5) * window.innerHeight;
  const offscreen = behind || x < 46 || x > window.innerWidth - 46 || y < 96 || y > window.innerHeight - 120;
  return {
    // 投影在相机背后时 x/y 会翻转,取反才指对方向
    x: behind ? window.innerWidth - x : x,
    y: behind ? window.innerHeight - y : y,
    offscreen,
    distance: bestD,
  };
}

function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  step(dt, now);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  refreshSafeArea(); // 横竖屏切换时刘海安全区会变,重新读一次
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

// V 键切换视角。先做成开关是因为"哪个视角对"要用眼睛判断,不是靠讨论
window.addEventListener('keydown', (e) => {
  // 正在输入文字(起名/留言)时别抢按键
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const key = e.key.toLowerCase();
  if (key === 'v') {
    setCameraMode(cameraMode === 'overhead' ? 'shoulder' : 'overhead');
  } else if (key === 'c') {
    toggleCharacter();
  } else if (key === 'l') {
    toggleSunsetEgg();
  }
});

// 定时存档覆盖移动、昼夜与数值变化；切后台或离开页面时再立即落盘。
window.setInterval(saveGame, 5000);
window.addEventListener('pagehide', saveGame);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGame();
});

(globalThis as any).__game = {
  player, vitals, inv, resources, scene, renderer, camera, sun, ambient, ocean, atmosphere,
  get day() { return day; },
  setTime(t: number) { clockT = t * DAY_SECONDS; },
  input, buildings, boars, spring, rain, effects, saveGame,
  flotsam, island, discovered, residents,
  expeditionVisits, discoveredPoi, blueprints,
  get activeExpeditionId() { return activeExpeditionId; },
  get expeditionCargo() { return { ...expeditionCargo }; },
  departExpedition,
  returnFromExpedition,
  setCameraMode,
  get cameraMode() { return cameraMode; },
  get islandProgress() { return islandProgress(buildings); },
  postfx,
  setGrade: (name: 'ac' | 'current') => postfx.setGrade(name),
  setAoEnabled: (on: boolean) => postfx.setAoEnabled(on),
  setOutlineEnabled: (on: boolean) => postfx.setOutlineEnabled(on),
  setCloudShadow,
  setPlayer: setPlayerCharacter,
  get currentCharacter() { return currentCharacter; },
  toggleSunsetEgg,
  get sunsetEgg() { return sunsetEgg; },
  buildOrder,
  build: (k: BuildingKind) => build(k),
  // 岛屿码:分享/参观功能的接口已经就绪,等接上访客模式就能用
  exportIslandCode: () => encodeIslandCode(islandSnapshot(currentSave())),
  beasts: () => beasts,
  step: (dt: number) => step(dt, performance.now()), // 测试用手动步进
};
requestAnimationFrame(frame);
