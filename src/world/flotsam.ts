// 海上漂流物:每天日出从远海漂来,靠岸后可打捞。
// 漂流物提供早期基础补给；稀有材料已转移到玩家主动选择的群岛远征。
import * as THREE from 'three';
import { ISLAND_RADIUS, islandHeight } from './island';
import { rng } from './rng';
import type { Inventory } from '../game/hud';

export type FlotsamKind = 'crate' | 'bottle' | 'barrel' | 'sail';

export interface FlotsamDef {
  kind: FlotsamKind;
  label: string;
  loot: Partial<Inventory>;
  minLevel: number;  // 岛屿等级达到才会漂来:等级的回报要看得见
  weight: number;
}

export const FLOTSAM_DEFS: Record<FlotsamKind, FlotsamDef> = {
  crate: {
    kind: 'crate', label: '补给木箱',
    loot: { wood: 2, stone: 1 }, minLevel: 1, weight: 3,
  },
  bottle: {
    kind: 'bottle', label: '漂流瓶',
    loot: { food: 2 }, minLevel: 1, weight: 2,
  },
  barrel: {
    kind: 'barrel', label: '旧木桶',
    loot: { wood: 2, fiber: 4 }, minLevel: 2, weight: 2,
  },
  sail: {
    kind: 'sail', label: '帆布卷',
    loot: { fiber: 5 }, minLevel: 3, weight: 2,
  },
};

export interface Flotsam {
  kind: FlotsamKind;
  group: THREE.Group;
  x: number; z: number;   // 靠岸后的落点
  fromX: number; fromZ: number; // 出现在远海的位置
  drift: number;          // 0 = 还在远海,1 = 已靠岸
  bobPhase: number;
}

export interface FlotsamPlan { kind: FlotsamKind; x: number; z: number; drift: number }

// 沿给定角度向内扫,找到水线附近的位置:漂流物要停在浪花边上,不能卡进草地或漂在深水
export function coastPoint(angle: number): { x: number; z: number } {
  let r = ISLAND_RADIUS + 2;
  for (; r > 6; r -= 0.2) {
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (islandHeight(x, z) >= 0.3) break;
  }
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
}

/**
 * 排定某一天漂来的东西。数量随岛屿等级增长,码头再加一件;
 * 品质靠 minLevel 门槛体现,而不是偷偷调数量 —— 玩家能直接看出等级带来了什么。
 */
export function planFlotsam(day: number, level: number, hasDock: boolean): FlotsamPlan[] {
  const rand = rng(day * 2654435761);
  const count = Math.min(4, 1 + Math.floor(level / 2) + (hasDock ? 1 : 0));
  const pool = Object.values(FLOTSAM_DEFS).filter((d) => d.minLevel <= level);
  const totalWeight = pool.reduce((sum, d) => sum + d.weight, 0);
  const out: FlotsamPlan[] = [];
  for (let i = 0; i < count; i++) {
    let roll = rand() * totalWeight;
    let def = pool[0];
    for (const candidate of pool) {
      roll -= candidate.weight;
      if (roll <= 0) { def = candidate; break; }
    }
    // 角度按份均分再抖动:同一天的几件不会叠在同一段海岸上
    const angle = ((i + rand() * 0.8) / count) * Math.PI * 2 + rand() * 0.5;
    const spot = coastPoint(angle);
    out.push({ kind: def.kind, x: spot.x, z: spot.z, drift: 0 });
  }
  return out;
}

// ---- 造型:低多边形 + flatShading,和岛上其它物件同一套语言 ----

const WOOD = new THREE.MeshStandardMaterial({ color: '#9a6b3f', flatShading: true, roughness: 0.88 });
const WOOD_DARK = new THREE.MeshStandardMaterial({ color: '#6f4a29', flatShading: true, roughness: 0.94 });
const IRON = new THREE.MeshStandardMaterial({ color: '#7d8b93', flatShading: true, roughness: 0.38, metalness: 0.62 });
const CLOTH = new THREE.MeshStandardMaterial({ color: '#ddd6b6', flatShading: true, roughness: 1 });
const ROPE = new THREE.MeshStandardMaterial({ color: '#c8ab6c', flatShading: true, roughness: 1 });
const GLASS = new THREE.MeshPhysicalMaterial({
  color: '#8fd6cf', flatShading: true, transparent: true, opacity: 0.62,
  roughness: 0.12, transmission: 0.18, thickness: 0.12, clearcoat: 0.55,
});

function crateMesh(): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.95), WOOD);
  box.position.y = 0.36; box.castShadow = true; g.add(box);
  // 加固木条,免得看起来只是个方块
  for (const y of [0.14, 0.58]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.11, 1.0), WOOD_DARK);
    band.position.y = y; g.add(band);
  }
  for (const [x, z] of [[-0.48, -0.48], [0.48, 0.48]]) {
    const corner = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.74, 0.14), IRON);
    corner.position.set(x, 0.36, z); g.add(corner);
  }
  return g;
}

function barrelMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.95, 10), WOOD);
  body.position.y = 0.48; body.castShadow = true; g.add(body);
  for (const y of [0.22, 0.74]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.045, 4, 12), IRON);
    hoop.rotation.x = Math.PI / 2; hoop.position.y = y; g.add(hoop);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.07, 10), WOOD_DARK);
  lid.position.y = 0.97; g.add(lid);
  return g;
}

function bottleMesh(): THREE.Group {
  const g = new THREE.Group();
  // 躺着漂:立着的瓶子看起来像被人插在沙里
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.62, 8), GLASS);
  body.rotation.z = Math.PI / 2; body.position.y = 0.2; g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 0.26, 8), GLASS);
  neck.rotation.z = Math.PI / 2; neck.position.set(0.42, 0.2, 0); g.add(neck);
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 6), WOOD);
  cork.rotation.z = Math.PI / 2; cork.position.set(0.6, 0.2, 0); g.add(cork);
  // 瓶里的纸卷:漂流瓶得有信才叫漂流瓶
  const note = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6),
    new THREE.MeshStandardMaterial({ color: '#f2e6c4', flatShading: true, roughness: 1 }));
  note.rotation.z = Math.PI / 2; note.position.y = 0.2; g.add(note);
  return g;
}

function sailMesh(): THREE.Group {
  const g = new THREE.Group();
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 1.35, 7), CLOTH);
  roll.rotation.z = Math.PI / 2; roll.position.y = 0.28; roll.castShadow = true; g.add(roll);
  for (const x of [-0.36, 0.36]) {
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.045, 4, 10), ROPE);
    tie.rotation.y = Math.PI / 2; tie.position.set(x, 0.28, 0); g.add(tie);
  }
  // 露出来的一角,让它读得出是"布"而不是根木头
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.42), CLOTH);
  flap.position.set(0.1, 0.5, 0.2); flap.rotation.set(0.2, 0.4, -0.15); g.add(flap);
  return g;
}

const MESHES: Record<FlotsamKind, () => THREE.Group> = {
  crate: crateMesh, barrel: barrelMesh, bottle: bottleMesh, sail: sailMesh,
};

const DRIFT_DISTANCE = 9;   // 出生点离靠岸点的距离
const DRIFT_SPEED = 0.09;   // 每秒推进的 drift 比例 → 约 11 秒靠岸

/** 一次最多在岸上留这么多件。约等于两天的量 —— 再多海滩就成了垃圾场 */
export const MAX_ACTIVE_FLOTSAM = 8;

/**
 * 释放一件漂流物占用的 GPU 资源。
 * 只能释放几何体:材质(WOOD/IRON/CLOTH…)是模块级共享的,
 * 释放掉会把还在海上的其它漂流物一起弄坏。泡沫圈的材质是每件独有的,可以释放。
 */
export function disposeFlotsam(f: Flotsam): void {
  f.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    // 泡沫圈用 RingGeometry + 独有的 MeshBasicMaterial,其余都共享材质
    if (mesh.geometry instanceof THREE.RingGeometry) {
      (mesh.material as THREE.Material).dispose();
    }
  });
}

export function createFlotsam(plan: FlotsamPlan): Flotsam {
  const group = MESHES[plan.kind]();
  const angle = Math.atan2(plan.z, plan.x);
  // 泡沫圈:没有它,漂流物看起来像悬在海面上方
  const foam = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.72, 16),
    new THREE.MeshBasicMaterial({
      color: '#e4f7f0', transparent: true, opacity: 0.45,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  foam.rotation.x = -Math.PI / 2; foam.position.y = 0.02; group.add(foam);
  group.rotation.y = angle + Math.PI / 2;

  const f: Flotsam = {
    kind: plan.kind,
    group,
    x: plan.x, z: plan.z,
    fromX: plan.x + Math.cos(angle) * DRIFT_DISTANCE,
    fromZ: plan.z + Math.sin(angle) * DRIFT_DISTANCE,
    drift: plan.drift,
    bobPhase: Math.random() * Math.PI * 2,
  };
  placeFlotsam(f, 0);
  return f;
}

function placeFlotsam(f: Flotsam, t: number): void {
  const k = f.drift;
  const x = f.fromX + (f.x - f.fromX) * k;
  const z = f.fromZ + (f.z - f.fromZ) * k;
  // 深海里浮在水面,靠岸后坐到地形上;摇晃幅度随靠岸减小
  const ground = Math.max(0.12, islandHeight(x, z));
  const bob = Math.sin(t * 1.6 + f.bobPhase) * 0.09 * (1 - k * 0.75);
  f.group.position.set(x, ground + bob, z);
  f.group.rotation.z = Math.sin(t * 1.25 + f.bobPhase) * 0.09 * (1 - k * 0.8);
}

/** 推进漂流与浮动。返回 true 表示这一帧刚刚靠岸(可用来提示玩家) */
export function updateFlotsam(f: Flotsam, dt: number, t: number): boolean {
  const wasAdrift = f.drift < 1;
  if (wasAdrift) f.drift = Math.min(1, f.drift + dt * DRIFT_SPEED);
  placeFlotsam(f, t);
  return wasAdrift && f.drift >= 1;
}

/** 已靠岸才可打捞:还在海上时够不着 */
export function canSalvage(f: Flotsam): boolean {
  return f.drift >= 1;
}
