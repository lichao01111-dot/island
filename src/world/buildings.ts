// 建筑分三层：生存建筑解决温饱，码头/制图桌打开远征，
// 远征带回的稀有材料与图纸再用于升级营地和建设灯塔/花圃。
// 造型走低多边形卡通风,和资源保持同一套材质语言
import * as THREE from 'three';
import { islandHeight } from './island';
import type { Inventory, ItemKind } from '../game/hud';
import { applyRimToObject, BUILDING_RIM } from '../game/material';

export type BuildingKind = 'campfire' | 'shelter' | 'collector' | 'dock' | 'maptable' | 'beacon' | 'garden' | 'hut';

export const BUILDING_KINDS: BuildingKind[] =
  ['campfire', 'shelter', 'collector', 'dock', 'maptable', 'beacon', 'garden', 'hut'];

export interface BuildingDef {
  kind: BuildingKind;
  label: string;
  icon: string;
  cost: Partial<Inventory>;
  radius: number;    // 功能作用半径
  footprint: number; // 占位半径(防重叠)
  minHeight: number; // 可建的最低地形高度(码头必须挨着水,灯塔必须在高处)
  maxHeight: number;
  repel: number;     // 野猪的逃离半径,0 = 野猪不在乎。要和 radius 对得上,否则说明文案就是假的
  unlock?: ItemKind; // 拿到这种材料后才出现在建造栏,没拿到之前连按钮都不显示
  unique?: boolean;  // 岛上只需要一个：建成后从建造栏移除
  blurb: string;     // 建造栏之外的一句话说明,用于解锁提示
}

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  campfire: {
    kind: 'campfire', label: '篝火', icon: '火',
    cost: { wood: 4, fiber: 2 }, radius: 7.5, footprint: 2.2,
    minHeight: 0.7, maxHeight: Infinity, repel: 9,
    blurb: '取暖、烹饪、驱赶野猪',
  },
  shelter: {
    kind: 'shelter', label: '庇护所', icon: '棚',
    cost: { wood: 8, fiber: 5, stone: 3 }, radius: 4.5, footprint: 3.4,
    minHeight: 0.7, maxHeight: Infinity, repel: 0,
    blurb: '休息快速回体力',
  },
  collector: {
    kind: 'collector', label: '集雨器', icon: '水',
    cost: { wood: 5, fiber: 4, stone: 2 }, radius: 3.5, footprint: 2.5,
    minHeight: 0.7, maxHeight: Infinity, repel: 0,
    blurb: '下雨时储存淡水',
  },
  dock: {
    kind: 'dock', label: '码头', icon: '港',
    cost: { wood: 12, fiber: 6, stone: 4 }, radius: 4, footprint: 3.2,
    // 必须贴着水线:码头建在山坡上没有道理,也是给玩家的第一个位置约束
    minHeight: 0.15, maxHeight: 1.1, repel: 0,
    unique: true,
    blurb: '建造制图桌后可从这里出发远征',
  },
  maptable: {
    kind: 'maptable', label: '制图桌', icon: '图',
    cost: { wood: 6, fiber: 3, stone: 2 }, radius: 3.2, footprint: 2.2,
    minHeight: 0.7, maxHeight: Infinity, repel: 0, unique: true,
    blurb: '规划群岛航线并记录探索发现',
  },
  beacon: {
    kind: 'beacon', label: '灯塔', icon: '塔',
    cost: { wood: 15, stone: 10, metal: 3, cloth: 2 }, radius: 15, footprint: 3,
    minHeight: 1.5, maxHeight: Infinity, repel: 15,
    unlock: 'cloth', unique: true,
    blurb: '大范围永久照明,野猪不敢靠近',
  },
  // 住客的家。**刻意不是 unique** —— 每来一位住客就要盖一间,
  // 这是把"建筑建完就从建造栏消失"那个死结解开的关键(见 RESIDENTS.md)
  hut: {
    kind: 'hut', label: '小屋', icon: '屋',
    cost: { wood: 8, fiber: 4 }, radius: 3.4, footprint: 3,
    minHeight: 0.7, maxHeight: Infinity, repel: 0,
    blurb: '给漂来的人一个落脚的地方',
  },
  garden: {
    kind: 'garden', label: '花圃', icon: '圃',
    cost: { wood: 4, fiber: 6, seed: 2 }, radius: 3, footprint: 2.4,
    minHeight: 0.7, maxHeight: Infinity, repel: 0,
    unlock: 'seed',
    blurb: '自己长果子,不用再靠采集',
  },
};

export interface Building {
  kind: BuildingKind;
  group: THREE.Group;
  x: number; z: number;
  level: number;     // 1 基础建筑；2 为远征蓝图升级
  light?: THREE.PointLight;
  flames?: THREE.Mesh[];
  smoke?: THREE.Mesh[];
  fuel: number;      // 篝火燃料(秒),0 则熄灭
  water: number;     // 集雨器储水量
  waterMesh?: THREE.Mesh;
  cooking: number;   // 剩余烹饪秒数,0 表示空闲
  /** 火上烤的是什么。只影响提示文案,不进存档 —— 重开游戏后火自然是空的 */
  cookingKind?: 'fish' | 'food';
  growth: number;    // 花圃生长计时(秒)
  stock: number;     // 花圃待采果实数
  fruitMeshes?: THREE.Mesh[];
}

export interface BuildingUpgradeDef {
  kind: Extract<BuildingKind, 'campfire' | 'shelter' | 'collector' | 'dock'>;
  label: string;
  cost: Partial<Inventory>;
  blurb: string;
}

export const BUILDING_UPGRADES: Partial<Record<BuildingKind, BuildingUpgradeDef>> = {
  campfire: {
    kind: 'campfire', label: '石砌火塘', cost: { stone: 5, metal: 1 },
    blurb: '燃料上限与加柴效率提高，安全范围扩大',
  },
  shelter: {
    kind: 'shelter', label: '木屋', cost: { wood: 8, cloth: 2 },
    blurb: '休息恢复更快，远征前能充分恢复体力',
  },
  collector: {
    kind: 'collector', label: '蓄水池', cost: { stone: 6, metal: 1 },
    blurb: '储水上限翻倍，下雨时收集更快',
  },
  dock: {
    kind: 'dock', label: '加固船坞', cost: { wood: 10, cloth: 2, metal: 3 },
    blurb: '载货量提高，并能抵达黑岩洞岛',
  },
};

export function buildingRadius(b: Pick<Building, 'kind' | 'level'>): number {
  const base = BUILDING_DEFS[b.kind].radius;
  if (b.level < 2) return base;
  if (b.kind === 'campfire') return base + 3;
  if (b.kind === 'shelter') return base + 1.2;
  return base;
}

// 灯塔和点着的篝火都会驱赶野猪 —— 区别只在范围大小
export function repelsBoars(b: { kind: BuildingKind; fuel: number }): boolean {
  if (BUILDING_DEFS[b.kind].repel <= 0) return false;
  return b.kind !== 'campfire' || b.fuel > 0;
}

/** 传给野猪 AI 的威慑点:位置 + 各自的逃离半径 */
export function repelField(buildings: Building[]): Array<{ x: number; z: number; repel: number }> {
  return buildings.filter(repelsBoars)
    .map((b) => ({
      x: b.x, z: b.z,
      repel: BUILDING_DEFS[b.kind].repel + (b.kind === 'campfire' && b.level >= 2 ? 3 : 0),
    }));
}

export const MAX_ISLAND_LEVEL = 10;
const SCORE_PER_LEVEL = 2;

export interface IslandProgress { score: number; level: number; progress: number }

/**
 * 待客清单:岛屿等级衡量的是"客人能在你岛上做什么",不是你堆了多少建筑。
 * 每一项只算一次 —— 第二座篝火不会让客人多一件能做的事,所以一分不加。
 * 每一条都必须对应参观模式里真实存在的交互,否则这里就成了假文案。
 *
 * 只看 kind 与 level,不看燃料/储水/果实这类实时状态:客人手里只有岛屿码,
 * 算不出这些,而岛主和客人看到的等级必须是同一个数。
 */
export interface HospitalityItem {
  key: string;
  label: string;   // 从客人的角度说这一项给了他们什么
  points: number;
  done: boolean;
}

const HOSPITALITY_BUILDINGS: Array<{ kind: BuildingKind; label: string; points: number }> = [
  { kind: 'dock', label: '客人有地方靠岸,也能在这儿留下伴手礼', points: 2 },
  { kind: 'campfire', label: '客人夜里能烤火取暖', points: 2 },
  { kind: 'shelter', label: '客人能进屋歇脚回体力', points: 2 },
  { kind: 'collector', label: '客人有淡水可以喝', points: 2 },
  { kind: 'garden', label: '客人能摘一颗果子', points: 2 },
  { kind: 'maptable', label: '客人能在制图桌上读到这座岛的名片', points: 2 },
  { kind: 'beacon', label: '夜里也照得见路,什么时候来都行', points: 2 },
];

export function hospitalityChecklist(
  buildings: Array<{ kind: BuildingKind; level?: number }>
): HospitalityItem[] {
  const items: HospitalityItem[] = HOSPITALITY_BUILDINGS.map((entry) => ({
    key: entry.kind,
    label: entry.label,
    points: entry.points,
    done: buildings.some((b) => b.kind === entry.kind),
  }));
  // 升级各 +1:同一种设施更好用,客人是能感觉到的
  for (const kind of Object.keys(BUILDING_UPGRADES) as BuildingKind[]) {
    const def = BUILDING_UPGRADES[kind];
    if (!def) continue;
    items.push({
      key: `${kind}-2`,
      label: `${def.label} · ${def.blurb}`,
      points: 1,
      done: buildings.some((b) => b.kind === kind && (b.level ?? 1) >= 2),
    });
  }
  return items;
}

/**
 * 清单总分刻意配成 (MAX_ISLAND_LEVEL - 1) * SCORE_PER_LEVEL = 18:
 * 勾满清单正好满级,不多不少。改条目或改分值时要一起调,test/flotsam.mjs 会盯着这条。
 *
 * 岛屿等级:待客清单得分。等级反过来决定每天漂来多少、漂来什么 ——
 * "把岛修得适合待客" 和 "岛上物资更丰富" 因此是同一件事。
 */
export function islandProgress(buildings: Array<{ kind: BuildingKind; level?: number }>): IslandProgress {
  const score = hospitalityChecklist(buildings)
    .reduce((sum, item) => sum + (item.done ? item.points : 0), 0);
  const level = Math.min(MAX_ISLAND_LEVEL, 1 + Math.floor(score / SCORE_PER_LEVEL));
  const progress = level >= MAX_ISLAND_LEVEL
    ? 1
    : (score % SCORE_PER_LEVEL) / SCORE_PER_LEVEL;
  return { score, level, progress };
}

function campfireMesh(): { group: THREE.Group; light: THREE.PointLight; flames: THREE.Mesh[]; smoke: THREE.Mesh[] } {
  const g = new THREE.Group();
  // 石圈
  const stoneMat = new THREE.MeshLambertMaterial({ color: '#8e8a85', flatShading: true });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), stoneMat);
    s.position.set(Math.cos(a) * 1.05, 0.18, Math.sin(a) * 1.05);
    s.rotation.set(Math.random(), Math.random(), Math.random());
    s.castShadow = true;
    g.add(s);
  }
  // 交叉木柴
  const logMat = new THREE.MeshLambertMaterial({ color: '#7d5433', flatShading: true });
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.5, 5), logMat);
    const a = (i / 4) * Math.PI;
    log.position.set(0, 0.3, 0);
    log.rotation.set(Math.PI / 2.4, a, 0);
    log.castShadow = true;
    g.add(log);
  }
  // 火焰:两层锥体,靠缩放与自发光模拟跳动
  const flames: THREE.Mesh[] = [];
  const flameOuter = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 1.15, 5),
    // 颜色分量刻意超过 1:辉光的阈值就设在 1,只有真正的自发光体才会发光。
    // 留在 0..1 的话火焰和白色帆布一样亮,辉光就只能糊出一层灰雾
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff8a2b').multiplyScalar(1.9), transparent: true, opacity: 0.92,
    })
  );
  flameOuter.position.y = 0.95;
  const flameInner = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.7, 5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe066').multiplyScalar(3.2) })
  );
  flameInner.position.y = 0.8;
  g.add(flameOuter, flameInner);
  flames.push(flameOuter, flameInner);

  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 24),
    new THREE.MeshBasicMaterial({ color: '#ff9a45', transparent: true, opacity: 0.12, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.035; g.add(glow);

  const smoke: THREE.Mesh[] = [];
  const smokeMat = new THREE.MeshLambertMaterial({ color: '#817b72', transparent: true, opacity: 0.28, depthWrite: false });
  for (let i = 0; i < 4; i++) {
    const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + i * 0.04, 0), smokeMat.clone());
    puff.position.y = 1.7 + i * 0.5; puff.userData.phase = i / 4; g.add(puff); smoke.push(puff);
  }

  const light = new THREE.PointLight('#ff9b42', 3.3, 19, 1.7);
  light.position.y = 1.3;
  g.add(light);

  return { group: g, light, flames, smoke };
}

function shelterMesh(): THREE.Group {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshLambertMaterial({ color: '#8a5f3a', flatShading: true });
  const leafMat = new THREE.MeshLambertMaterial({ color: '#4d9a4a', flatShading: true });

  // 四根立柱
  for (const [dx, dz] of [[-1.3, -1.1], [1.3, -1.1], [-1.3, 1.1], [1.3, 1.1]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 2.1, 5), woodMat);
    post.position.set(dx, 1.05, dz);
    post.castShadow = true;
    g.add(post);
  }
  // 椰叶屋顶:两片斜面
  for (const side of [-1, 1]) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 1.7), leafMat);
    roof.position.set(0, 2.5, side * 0.72);
    roof.rotation.x = side * 0.44;
    roof.castShadow = true;
    g.add(roof);
  }
  // 屋脊
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 5), woodMat);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.y = 2.82;
  g.add(ridge);
  // 草铺
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.16, 1.3),
    new THREE.MeshLambertMaterial({ color: '#c8b273', flatShading: true })
  );
  bed.position.y = 0.1;
  g.add(bed);

  // 绳结与悬挂补给让庇护所有“住过”的痕迹。
  const ropeMat = new THREE.MeshLambertMaterial({ color: '#d3b36f', flatShading: true });
  for (const x of [-1.3, 1.3]) {
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 4, 8), ropeMat);
    rope.position.set(x, 1.7, -1.12); rope.rotation.x = Math.PI / 2; g.add(rope);
  }
  const bag = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35, 0),
    new THREE.MeshLambertMaterial({ color: '#b0804e', flatShading: true }));
  bag.scale.set(0.8, 1.1, 0.65); bag.position.set(1.05, 0.5, 0.7); g.add(bag);

  return g;
}

function collectorMesh(): { group: THREE.Group; waterMesh: THREE.Mesh } {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: '#855d3b', flatShading: true });
  const cloth = new THREE.MeshLambertMaterial({ color: '#d9d1aa', side: THREE.DoubleSide, flatShading: true });
  for (const x of [-1.1, 1.1]) for (const z of [-1.1, 1.1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.8, 5), wood);
    post.position.set(x, 0.9, z); post.castShadow = true; g.add(post);
  }
  const tarp = new THREE.Mesh(new THREE.ConeGeometry(1.65, 0.55, 4, 1, true), cloth);
  tarp.position.y = 1.55; tarp.rotation.y = Math.PI / 4; tarp.rotation.z = Math.PI;
  g.add(tarp);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.55, 0.9, 8),
    new THREE.MeshLambertMaterial({ color: '#6f91a3', flatShading: true }));
  barrel.position.y = 0.45; g.add(barrel);
  const gutter = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.35, 6), wood);
  gutter.rotation.z = Math.PI / 2; gutter.rotation.y = 0.25; gutter.position.set(0.55, 1.25, 0.65); g.add(gutter);
  const waterMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.12, 12),
    new THREE.MeshBasicMaterial({ color: '#55c9e8', transparent: true, opacity: 0.85 }));
  waterMesh.position.y = 0.18; waterMesh.visible = false; g.add(waterMesh);
  return { group: g, waterMesh };
}

// 码头:栈桥伸进浅水,尽头有系船柱和货箱 —— 它是"这座岛开始跟外面有来往"的第一个标志
function dockMesh(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: '#8a6039', flatShading: true });
  const woodDark = new THREE.MeshLambertMaterial({ color: '#6a4527', flatShading: true });
  // 桥面沿局部 +z 伸出;createBuilding 会把 +z 转向背离岛心的方向
  for (let i = 0; i < 7; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.46), wood);
    plank.position.set(0, 0.62, 0.6 + i * 0.55);
    plank.castShadow = true;
    g.add(plank);
  }
  for (let i = 0; i < 4; i++) {
    for (const x of [-0.9, 0.9]) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 1.5, 6), woodDark);
      pile.position.set(x, 0.05, 0.85 + i * 0.95);
      pile.castShadow = true;
      g.add(pile);
    }
  }
  for (const x of [-0.95, 0.95]) {
    const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.6, 7), woodDark);
    bollard.position.set(x, 0.95, 4.1);
    g.add(bollard);
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 4, 9),
      new THREE.MeshLambertMaterial({ color: '#c8ab6c', flatShading: true }));
    rope.rotation.x = Math.PI / 2; rope.position.set(x, 1.14, 4.1); g.add(rope);
  }
  // 堆在岸这头的货箱,呼应漂流物的造型
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.6), wood);
  crate.position.set(0.6, 0.95, 1.0); crate.rotation.y = 0.4; crate.castShadow = true; g.add(crate);
  const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.44, 0.48), woodDark);
  crate2.position.set(-0.62, 0.9, 1.35); crate2.rotation.y = -0.25; g.add(crate2);
  return g;
}

// 灯塔:岛上最高的人造物。不烧燃料,是稀有材料换来的永久安全区
function beaconMesh(): { group: THREE.Group; light: THREE.PointLight; flames: THREE.Mesh[] } {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: '#8f8a82', flatShading: true });
  const white = new THREE.MeshLambertMaterial({ color: '#e8e2d2', flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: '#c8564a', flatShading: true });
  const wood = new THREE.MeshLambertMaterial({ color: '#7d5433', flatShading: true });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.6, 0.5, 9), stone);
  base.position.y = 0.25; base.castShadow = true; g.add(base);
  // 塔身分三段收细,轮廓才有变化;红白条纹是灯塔的识别符号
  const segs: Array<[number, number, number, THREE.Material]> = [
    [1.05, 0.92, 1.5, white], [0.92, 0.8, 1.3, red], [0.8, 0.7, 1.3, white],
  ];
  let y = 0.5;
  for (const [rb, rt, h, mat] of segs) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 9), mat);
    seg.position.y = y + h / 2; seg.castShadow = true; g.add(seg);
    y += h;
  }
  // 观景平台
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.14, 9), wood);
  deck.position.y = y + 0.07; g.add(deck);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 4), wood);
    rail.position.set(Math.cos(a) * 0.92, y + 0.28, Math.sin(a) * 0.92); g.add(rail);
  }
  // 灯室:玻璃罩 + 里面的灯芯,灯芯用 flames 复用篝火那套跳动逻辑
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.95, 8),
    new THREE.MeshLambertMaterial({ color: '#bfe8f2', flatShading: true, transparent: true, opacity: 0.55 }));
  lantern.position.y = y + 0.62; g.add(lantern);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe9a0').multiplyScalar(3.6) }));
  core.position.y = y + 0.6; g.add(core);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.55, 8), red);
  cap.position.y = y + 1.35; cap.castShadow = true; g.add(cap);

  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(6.5, 28),
    new THREE.MeshBasicMaterial({ color: '#ffdf9c', transparent: true, opacity: 0.1, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.05; g.add(glow);

  const light = new THREE.PointLight('#ffdca8', 4.2, 30, 1.5);
  light.position.y = y + 0.6;
  g.add(light);
  return { group: g, light, flames: [core] };
}

// 花圃:围石 + 翻土 + 会结果的小苗。果实数量直接映射 stock,不用额外 UI
function gardenMesh(): { group: THREE.Group; fruitMeshes: THREE.Mesh[] } {
  const g = new THREE.Group();
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.55, 0.22, 10),
    new THREE.MeshLambertMaterial({ color: '#6b4b30', flatShading: true }));
  soil.position.y = 0.11; soil.receiveShadow = true; g.add(soil);
  const edge = new THREE.MeshLambertMaterial({ color: '#8e8a85', flatShading: true });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), edge);
    s.position.set(Math.cos(a) * 1.5, 0.14, Math.sin(a) * 1.5);
    s.rotation.set(Math.random(), Math.random(), Math.random());
    g.add(s);
  }
  const leafMat = new THREE.MeshLambertMaterial({ color: '#4fa552', flatShading: true });
  const fruitMat = new THREE.MeshLambertMaterial({ color: '#e07a4b', flatShading: true });
  const fruitMeshes: THREE.Mesh[] = [];
  const spots: Array<[number, number]> = [[-0.72, -0.5], [0.75, -0.45], [0, 0.8]];
  for (const [sx, sz] of spots) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.6, 5),
      new THREE.MeshLambertMaterial({ color: '#5f7f3a', flatShading: true }));
    stem.position.set(sx, 0.5, sz); g.add(stem);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 4), leafMat);
      leaf.position.set(sx + Math.cos(a) * 0.22, 0.82, sz + Math.sin(a) * 0.22);
      leaf.rotation.z = Math.cos(a) * 0.8; leaf.rotation.x = -Math.sin(a) * 0.8;
      leaf.castShadow = true; g.add(leaf);
    }
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.19, 7, 6), fruitMat);
    fruit.position.set(sx, 0.98, sz); fruit.visible = false;
    g.add(fruit); fruitMeshes.push(fruit);
  }
  return { group: g, fruitMeshes };
}

function mapTableMesh(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#805a39', flatShading: true, roughness: 0.9 });
  const paper = new THREE.MeshStandardMaterial({ color: '#e2d4aa', side: THREE.DoubleSide, roughness: 1 });
  for (const x of [-0.95, 0.95]) for (const z of [-0.55, 0.55]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.25, 5), wood);
    leg.position.set(x, 0.62, z); leg.castShadow = true; g.add(leg);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.16, 1.45), wood);
  top.position.y = 1.25; top.castShadow = true; g.add(top);
  const chart = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.92), paper);
  chart.rotation.x = -Math.PI / 2; chart.rotation.z = 0.12; chart.position.y = 1.345; g.add(chart);
  const compass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12),
    new THREE.MeshStandardMaterial({ color: '#b58a43', metalness: 0.35, roughness: 0.45 })
  );
  compass.position.set(0.73, 1.39, 0.3); g.add(compass);
  return g;
}

function decorateUpgrade(kind: BuildingKind, group: THREE.Group): void {
  const stone = new THREE.MeshStandardMaterial({ color: '#77746e', flatShading: true, roughness: 0.9 });
  const wood = new THREE.MeshStandardMaterial({ color: '#68472e', flatShading: true, roughness: 0.92 });
  if (kind === 'campfire') {
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.34), stone);
      block.position.set(Math.cos(a) * 1.35, 0.18, Math.sin(a) * 1.35); block.rotation.y = -a; group.add(block);
    }
  } else if (kind === 'shelter') {
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.65, 1.65, 0.16), wood);
    back.position.set(0, 0.88, 1.05); group.add(back);
    for (const x of [-1.28, 1.28]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.65, 1.9), wood);
      wall.position.set(x, 0.88, 0); group.add(wall);
    }
  } else if (kind === 'collector') {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.68, 1.15, 9),
      new THREE.MeshStandardMaterial({ color: '#617f8b', flatShading: true, roughness: 0.66 })
    );
    tank.position.set(-1.05, 0.58, 0.2); group.add(tank);
  } else if (kind === 'dock') {
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.2, 6), wood);
    boom.position.set(-1.2, 2, 2.1); boom.rotation.z = -0.65; group.add(boom);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.055, 5, 8), stone);
    hook.position.set(-2.05, 2.85, 2.1); group.add(hook);
  }
}

// 住客的小屋:抬高的木地台 + 编织墙 + 茅草顶。
// 刻意比庇护所矮小 —— 它是"有人住"的标记,不该抢营地建筑的视觉位置
function hutMesh(): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.MeshStandardMaterial({ color: '#7d5433', flatShading: true, roughness: 0.92 });
  const wall = new THREE.MeshStandardMaterial({ color: '#b99a68', flatShading: true, roughness: 0.96 });
  const thatch = new THREE.MeshStandardMaterial({ color: '#c2a45f', flatShading: true, roughness: 1 });

  // 抬高的地台:热带小屋都架空防潮,顺带让它在起伏地形上不至于半边悬空
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.6, 5), post);
    leg.position.set(dx * 0.95, 0.3, dz * 0.95);
    leg.castShadow = true; g.add(leg);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.16, 2.3), post);
  floor.position.y = 0.66; floor.castShadow = true; floor.receiveShadow = true; g.add(floor);

  // 三面墙,正面留门洞
  const wallH = 1.15;
  for (const [w, d, px, pz] of [[2.3, 0.14, 0, -1.08], [0.14, 2.3, -1.08, 0], [0.14, 2.3, 1.08, 0]]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wall);
    panel.position.set(px, 0.74 + wallH / 2, pz);
    panel.castShadow = true; g.add(panel);
  }

  // 茅草四坡顶
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.05, 1.0, 4), thatch);
  roof.position.y = 0.74 + wallH + 0.42;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true; g.add(roof);

  return g;
}

function createBuildingRaw(kind: BuildingKind, x: number, z: number, level = 1): Building {
  const y = islandHeight(x, z);
  const base = { kind, x, z, level, fuel: 0, water: 0, cooking: 0, growth: 0, stock: 0 };
  if (kind === 'campfire') {
    const { group, light, flames, smoke } = campfireMesh();
    if (level >= 2) decorateUpgrade(kind, group);
    group.position.set(x, y, z);
    return { ...base, group, light, flames, smoke, fuel: 120 };
  }
  if (kind === 'beacon') {
    const { group, light, flames } = beaconMesh();
    group.position.set(x, y, z);
    group.rotation.y = Math.random() * Math.PI * 2;
    return { ...base, group, light, flames };
  }
  if (kind === 'garden') {
    const { group, fruitMeshes } = gardenMesh();
    group.position.set(x, y, z);
    group.rotation.y = Math.random() * Math.PI * 2;
    return { ...base, group, fruitMeshes };
  }
  if (kind === 'dock') {
    const group = dockMesh();
    if (level >= 2) decorateUpgrade(kind, group);
    group.position.set(x, y, z);
    // 栈桥必须朝海:局部 +z 转到背离岛心的方向
    group.rotation.y = Math.atan2(x, z);
    return { ...base, group };
  }
  if (kind === 'hut') {
    const group = hutMesh();
    group.position.set(x, islandHeight(x, z), z);
    group.rotation.y = Math.random() * Math.PI * 2;
    return { ...base, group };
  }
  if (kind === 'maptable') {
    const group = mapTableMesh();
    group.position.set(x, y, z);
    group.rotation.y = Math.random() * Math.PI * 2;
    return { ...base, group };
  }
  const collector = kind === 'collector' ? collectorMesh() : null;
  const group = kind === 'shelter' ? shelterMesh() : collector!.group;
  if (level >= 2) decorateUpgrade(kind, group);
  group.position.set(x, y, z);
  group.rotation.y = Math.random() * Math.PI * 2;
  return { ...base, group, waterMesh: collector?.waterMesh };
}

/** 建筑和植被/角色共用同一套"接住天光"的边缘光语言;Basic 材质(火焰/灯芯)会被 applyRim 自动跳过 */
export function createBuilding(kind: BuildingKind, x: number, z: number, level = 1): Building {
  const building = createBuildingRaw(kind, x, z, level);
  applyRimToObject(building.group, BUILDING_RIM);
  return building;
}

export const GARDEN_PERIOD = 40;  // 结一颗果的秒数
export const GARDEN_MAX = 3;      // 树上最多挂几颗,采走才继续长

// 篝火火焰跳动 + 光照闪烁 + 燃料耗尽熄灭;灯塔常亮;花圃结果
export function updateBuilding(b: Building, dt: number, t: number): void {
  if (b.kind === 'garden') {
    if (b.stock < GARDEN_MAX) {
      b.growth += dt;
      if (b.growth >= GARDEN_PERIOD) { b.growth = 0; b.stock++; }
    }
    if (b.fruitMeshes) {
      for (let i = 0; i < b.fruitMeshes.length; i++) {
        const fruit = b.fruitMeshes[i];
        fruit.visible = i < b.stock;
        if (fruit.visible) fruit.scale.setScalar(1 + Math.sin(t * 1.7 + i) * 0.05);
      }
    }
    return;
  }
  if (b.kind === 'beacon') {
    // 灯塔不烧燃料,只做极轻的呼吸感;抖太厉害会像坏掉的灯
    if (b.light) b.light.intensity = 4.2 + Math.sin(t * 1.6) * 0.25;
    if (b.flames) for (const core of b.flames) core.scale.setScalar(1 + Math.sin(t * 2.1) * 0.07);
    return;
  }
  if (b.kind !== 'campfire') return;
  b.fuel = Math.max(0, b.fuel - dt);
  const alive = b.fuel > 0;
  if (b.flames) {
    for (let i = 0; i < b.flames.length; i++) {
      const f = b.flames[i];
      f.visible = alive;
      if (!alive) continue;
      const wob = 1 + Math.sin(t * (9 + i * 4) + i) * 0.14;
      f.scale.set(wob, 1 + Math.sin(t * (7 + i * 3)) * 0.2, wob);
    }
  }
  if (b.light) {
    b.light.intensity = alive ? 2.1 + Math.sin(t * 11) * 0.45 : 0;
  }
  if (b.smoke) {
    for (let i = 0; i < b.smoke.length; i++) {
      const puff = b.smoke[i];
      const phase = (t * 0.22 + puff.userData.phase) % 1;
      puff.visible = alive;
      puff.position.set(Math.sin(t * 0.8 + i) * phase * 0.35, 1.55 + phase * 3.1, Math.cos(t * 0.7 + i) * phase * 0.25);
      puff.scale.setScalar(0.5 + phase * 1.5);
      (puff.material as THREE.MeshLambertMaterial).opacity = (1 - phase) * 0.28;
    }
  }
}
