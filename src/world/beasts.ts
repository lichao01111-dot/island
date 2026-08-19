// 远征岛上的野兽。纯逻辑,不 import THREE —— 和 residents.ts 同样的理由:
// 测试跑得快,而且"绕后才能破防"这种手感规则能在 Node 里直接断言。
// 造型与动画在 beast-view.ts。设计背景见 VOYAGES.md。
//
// 两条不能动的前提:
//   1. 野兽只在远征岛上。主岛是家,灯塔护住的地方不该反悔(VOYAGES.md 第二节)
//   2. 野兽不进存档。它们由 (岛id, 第几次来) 播种,退出重进还是同一批 ——
//      这同时挡住了"打完退出重进刷掉落"
import { rng } from './rng';
import type { Inventory } from '../game/hud';

export type BeastKind = 'crab';

export interface BeastDef {
  kind: BeastKind;
  name: string;
  hp: number;
  speed: number;
  /** 撞到玩家扣多少血。和野猪的 22 同量级,但预告更长 */
  damage: number;
  /** 蓄力预告时长。看得见才躲得开 —— 这是"公平"的最低要求 */
  windup: number;
  /** 进入这个距离就开始蓄力 */
  reach: number;
  /** 玩家进到这个距离才会被盯上。岛不大,盯太远等于全岛追杀 */
  aggro: number;
  /**
   * 转身速度(弧度/秒)。**这个值决定了"绕后"这条路存不存在。**
   * 如果它每帧都能瞬间面向玩家,壳就永远朝着你,礁蟹就是一只打不动的怪。
   * 必须明显慢于玩家绕圈的角速度(玩家 7.2 米/秒,在 1.7 米处约 4.2 弧度/秒)。
   */
  turn: number;
  drop: Partial<Inventory>;
}

export const BEAST_DEFS: Record<BeastKind, BeastDef> = {
  crab: {
    kind: 'crab', name: '礁蟹',
    hp: 3, speed: 1.5, damage: 18, windup: 0.7, reach: 1.7, aggro: 8, turn: 2.0,
    drop: { food: 1, stone: 1 },
  },
};

export interface Beast {
  kind: BeastKind;
  x: number; z: number;
  hp: number;
  /** 朝向(弧度)。正面有壳,判定要用它 */
  facing: number;
  /** 蓄力剩余秒数,-1 表示没在蓄力 */
  windup: number;
  cooldown: number;
}

/** 登陆点周围这个半径内不生野兽。要大于最远的 aggro,否则上岸即被围 */
export const SAFE_LANDING = 9;

/** 玩家挥击的扇形:前方 ±HALF_ARC、HIT_RANGE 米内 */
export const HIT_RANGE = 2.2;
export const HALF_ARC = Math.PI * 50 / 180;

/**
 * 正面这个角度内是壳,打不动。
 * 礁蟹的设计意图全在这一个常数上:它慢,所以你**跑得过它**;
 * 它正面硬,所以你**必须绕到侧后**。没有这条,它就只是一坨血量。
 */
export const SHELL_ARC = Math.PI * 60 / 180;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 排定这一趟岛上有哪些野兽。
 * heightAt 由调用方传进来(远征岛的高度场在 expeditions.ts,那个文件 import 了 THREE),
 * 这样这里就不必知道地形是怎么算出来的。
 */
export function planBeasts(
  islandId: string, visit: number, radius: number,
  heightAt: (x: number, z: number) => number,
  landing: { x: number; z: number },
  count = 3
): Beast[] {
  const rand = rng(hash(`${islandId}:${visit}`));
  const out: Beast[] = [];
  // 尝试次数给足:高度筛选会刷掉落在水里的点,但不能因此无限循环
  for (let tries = 0; tries < count * 40 && out.length < count; tries++) {
    // 角度按份均分再抖动,免得三只挤在同一片沙滩上
    const a = ((out.length + rand()) / count) * Math.PI * 2 + rand() * 0.6;
    const r = (0.35 + rand() * 0.5) * radius;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = heightAt(x, z);
    // 别生在水里,也别生在登陆点脸上 —— 一上岸就挨打不合理。
    // 登陆点由调用方传进来:各岛的木筏位置不一样,在这儿猜一个公式必然猜错
    if (h < 0.35) continue;
    if (Math.hypot(x - landing.x, z - landing.z) < SAFE_LANDING) continue;
    out.push({ kind: 'crab', x, z, hp: BEAST_DEFS.crab.hp, facing: a + Math.PI, windup: -1, cooldown: 0 });
  }
  return out;
}

/** 朝目标方向转,但每秒最多转 rate 弧度 */
function turnToward(from: number, to: number, rate: number, dt: number): number {
  const diff = wrap(to - from);
  const step = Math.min(Math.abs(diff), rate * dt);
  return from + Math.sign(diff) * step;
}

/** 把角度折到 (-π, π],用来比较两个方向差多少 */
function wrap(angle: number): number {
  let a = (angle + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * 推进一只野兽。返回 true 表示这一帧命中了玩家。
 * 蓄力中不移动 —— 玩家看到它停下鼓起来,就知道该走开了。
 */
export function updateBeast(
  b: Beast, dt: number, px: number, pz: number,
  radius: number, heightAt: (x: number, z: number) => number
): boolean {
  if (b.hp <= 0) return false;
  b.cooldown = Math.max(0, b.cooldown - dt);

  const dx = px - b.x;
  const dz = pz - b.z;
  const d = Math.hypot(dx, dz);
  const def = BEAST_DEFS[b.kind];

  if (b.windup >= 0) {
    b.windup -= dt;
    // 蓄力时**完全锁定**朝向:这 0.7 秒是玩家绕到侧后的窗口
    if (b.windup <= 0) {
      b.windup = -1;
      b.cooldown = 1.8;
      return d < def.reach + 0.5;
    }
    return false;
  }

  if (d > def.aggro) return false;

  // 转身有速度上限。玩家在攻击距离上绕圈的角速度远高于这个值 ——
  // 所以"绕到它侧后"是一条随时都能走的路,不只是蓄力那 0.7 秒
  const want = Math.atan2(dx, dz);
  b.facing = turnToward(b.facing, want, def.turn, dt);

  if (d < def.reach && b.cooldown <= 0) {
    b.windup = def.windup;
    return false;
  }

  if (d > 0.001) {
    const step = Math.min(d - def.reach * 0.6, def.speed * dt);
    if (step > 0) {
      // 朝自己面对的方向走,不是朝玩家瞬移 —— 否则转身限制等于白加
      const nx = b.x + Math.sin(b.facing) * step;
      const nz = b.z + Math.cos(b.facing) * step;
      // 别走进水里,也别走出岛
      if (Math.hypot(nx, nz) < radius && heightAt(nx, nz) > 0.2) { b.x = nx; b.z = nz; }
    }
  }
  return false;
}

export interface StrikeResult {
  /** 这一击打中并扣了血的 */
  hit: Beast[];
  /** 打在壳上、一点血没掉的 —— 要给玩家一个"这样不行"的反馈 */
  blocked: Beast[];
  /** 这一击打死的 */
  killed: Beast[];
}

/**
 * 玩家挥一击。
 * facing 是玩家朝向;命中要同时满足"在扇形内"和"没打在壳上"。
 */
export function strikeBeasts(
  beasts: Beast[], px: number, pz: number, facing: number, damage = 1
): StrikeResult {
  const result: StrikeResult = { hit: [], blocked: [], killed: [] };
  for (const b of beasts) {
    if (b.hp <= 0) continue;
    const dx = b.x - px;
    const dz = b.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > HIT_RANGE) continue;
    if (Math.abs(wrap(Math.atan2(dx, dz) - facing)) > HALF_ARC) continue;
    // 从野兽的角度看,这一击是从哪边来的?正面 SHELL_ARC 内是壳
    const incoming = Math.atan2(-dx, -dz);
    if (Math.abs(wrap(incoming - b.facing)) < SHELL_ARC) { result.blocked.push(b); continue; }
    b.hp -= damage;
    result.hit.push(b);
    if (b.hp <= 0) result.killed.push(b);
  }
  return result;
}

/** 还活着的野兽里离玩家最近的那只 —— 用来画提示环 */
export function nearestBeast(beasts: Beast[], px: number, pz: number, range: number): Beast | null {
  let best: Beast | null = null;
  let bestD = range;
  for (const b of beasts) {
    if (b.hp <= 0) continue;
    const d = Math.hypot(b.x - px, b.z - pz);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}
