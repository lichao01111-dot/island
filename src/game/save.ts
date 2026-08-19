// 本地优先存档。结构带版本号，后续增加玩法时可按版本迁移。
// v4:加入住客；v1/v2/v3 会在读取时无损迁移（老档视为还没有住客）。
import type { Inventory, ItemKind, Vitals } from './hud';
import { RARE_ITEMS } from './hud';
import { BUILDING_KINDS, type BuildingKind } from '../world/buildings';
import type { FlotsamKind } from '../world/flotsam';
import type { BlueprintKind, Cargo, ExpeditionId } from '../world/expeditions';
import type { Resident, TradeKind } from '../world/residents';
import { storageGet, storageSet } from '../platform/storage';

export interface SavedBuilding {
  kind: BuildingKind;
  x: number;
  z: number;
  level: number;
  fuel: number;
  water: number;
  cooking: number;
  growth: number;
  stock: number;
}

export interface ExplorationSave {
  visits: Partial<Record<ExpeditionId, number>>;
  discoveredPoi: string[];
  blueprints: BlueprintKind[];
  active: {
    id: ExpeditionId;
    cargo: Cargo;
    collected: string[];
  } | null;
}

export interface SavedResource {
  kind: 'wood' | 'fiber' | 'stone';
  x: number; z: number; hp: number; respawnAt: number; swayPhase: number;
}

export interface SavedBoar { x: number; z: number; attackCooldown: number }

export interface SavedFlotsam {
  kind: FlotsamKind;
  x: number; z: number;
  drift: number;
}

export interface SaveData {
  version: 4;
  savedAt: number;
  // shareId 是短链服务给这座岛分配的 id。存下来才能回头查"有多少人来过"。
  // 没发布过短链时为空字符串 —— 游戏在没有服务端的情况下要照常能玩。
  // token 是首次发布时服务端发的岛主凭证:改自己的岛、删留言、留言署名都靠它。
  //   它是个密钥,只存在本机;清掉存档等于交出这座岛的所有权。
  // seenVisits 记住上次告诉过玩家的到访数,只有涨了才值得再提一次
  island: { name: string; seed: number; shareId: string; token: string; seenVisits: number };
  player: { x: number; z: number };
  vitals: Vitals;
  inventory: Inventory;
  clockT: number;
  day: number;
  discovered: ItemKind[];   // 见过的稀有材料:决定建造栏里出现哪些岛屿建筑
  buildings: SavedBuilding[];
  resources: SavedResource[];
  boars: SavedBoar[];
  flotsam: SavedFlotsam[];
  flotsamDay: number;       // 已经为第几天投放过漂流物,防止重复投放
  exploration: ExplorationSave;
  /** 住客。v3 及更早的存档读进来时是空数组 —— 那时还没有这套玩法 */
  residents: Resident[];
}

export const SAVE_KEY = 'island_save_v1'; // 键名保持不变,靠 version 字段迁移

const FLOTSAM_KINDS: FlotsamKind[] = ['crate', 'bottle', 'barrel', 'sail'];
const EXPEDITION_IDS: ExpeditionId[] = ['mangrove', 'reef', 'cave'];
const BLUEPRINT_KINDS: BlueprintKind[] = ['campfire', 'shelter', 'collector', 'dock'];

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, fallback)));
}

function inventory(value: unknown): Inventory {
  const v = value && typeof value === 'object' ? value as Partial<Inventory> : {};
  const count = (n: unknown): number => Math.floor(bounded(n, 0, 0, 9999));
  return {
    wood: count(v.wood),
    fiber: count(v.fiber),
    stone: count(v.stone),
    food: count(v.food),
    cookedFood: count(v.cookedFood),
    // v4 及更早没有 fish —— 读出来是 0,老存档照常能开
    fish: count(v.fish),
    cloth: count(v.cloth),
    metal: count(v.metal),
    seed: count(v.seed),
  };
}

export function newIslandSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

const TRADE_KINDS: TradeKind[] = ['fisher', 'weaver', 'carpenter', 'sailor'];
const OBTAINABLE_ITEMS: ItemKind[] =
  ['wood', 'fiber', 'stone', 'food', 'cookedFood', 'fish', 'cloth', 'metal', 'seed'];

/**
 * 住客。v3 及更早的存档没有这个字段,读出来就是空数组 —— 那时还没有这套玩法。
 * 家用坐标而不是建筑下标引用:buildings 是数组,以后支持拆除的话下标会全部错位,
 * 住客就会指向别人的房子(见 RESIDENTS.md 里的技术决定)。
 */
function residents(value: unknown): Resident[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw): Resident[] => {
    if (!raw || typeof raw !== 'object') return [];
    const r = raw as Partial<Resident>;
    if (!TRADE_KINDS.includes(r.trade as TradeKind)) return [];
    const id = typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : `${r.trade}-${seen.size}`;
    if (seen.has(id)) return [];   // 重复 id 会让"满足要求"作用到错误的人身上
    seen.add(id);
    const home = r.home && typeof r.home === 'object'
      && Number.isFinite(r.home.x) && Number.isFinite(r.home.z)
      ? { x: r.home.x, z: r.home.z }
      : null;
    const req = r.request && typeof r.request === 'object'
      && OBTAINABLE_ITEMS.includes(r.request.kind as ItemKind)
      ? {
          kind: r.request.kind as ItemKind,
          count: Math.floor(bounded(r.request.count, 1, 1, 99)),
          done: r.request.done === true,
        }
      : null;
    return [{
      id,
      trade: r.trade as TradeKind,
      arrivedDay: Math.floor(bounded(r.arrivedDay, 1, 1, 999999)),
      home,
      stock: Math.floor(bounded(r.stock, 0, 0, 99)),
      growth: bounded(r.growth, 0, 0, 86400),
      quiet: bounded(r.quiet, 0, 0, 86400),
      request: req,
      favor: Math.floor(bounded(r.favor, 0, 0, 9999)),
    }];
  });
}

export function loadSave(daySeconds: number): SaveData | null {
  const raw = storageGet(SAVE_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Omit<Partial<SaveData>, 'version'> & { version?: number };
    // v1 存档照读,缺的字段走默认值 —— 老玩家不该因为版本升级丢岛
    // 老版本一律读进来:少的字段走默认值。玩家不该因为我们加了新玩法而丢掉整座岛
    if (![1, 2, 3, 4].includes(p.version as number)) return null;
    const pos = p.player && typeof p.player === 'object' ? p.player : { x: 0, z: 0 };
    const v = p.vitals && typeof p.vitals === 'object' ? p.vitals : {} as Partial<Vitals>;
    const buildings = Array.isArray(p.buildings) ? p.buildings.flatMap((b) => {
      if (!b || !BUILDING_KINDS.includes(b.kind)) return [];
      const x = finite(b.x, NaN);
      const z = finite(b.z, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return [];
      const level = Math.floor(bounded(b.level, 1, 1, 2));
      return [{
        kind: b.kind, x, z,
        level,
        fuel: bounded(b.fuel, 0, 0, 86400),
        water: bounded(b.water, 0, 0, level >= 2 ? 16 : 8),
        cooking: bounded(b.cooking, 0, 0, 30),
        growth: bounded(b.growth, 0, 0, 600),
        stock: Math.floor(bounded(b.stock, 0, 0, 9)),
      }];
    }) : [];
    const resources = Array.isArray(p.resources) ? p.resources.flatMap((r) => {
      if (!r || (r.kind !== 'wood' && r.kind !== 'fiber' && r.kind !== 'stone')) return [];
      const x = finite(r.x, NaN), z = finite(r.z, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return [];
      return [{ kind: r.kind, x, z, hp: Math.floor(bounded(r.hp, 1, 0, 3)),
        respawnAt: bounded(r.respawnAt, 0, 0, 120), swayPhase: finite(r.swayPhase, 0) }];
    }) : [];
    const boars = Array.isArray(p.boars) ? p.boars.flatMap((b) => {
      if (!b) return [];
      const x = finite(b.x, NaN), z = finite(b.z, NaN);
      return Number.isFinite(x) && Number.isFinite(z)
        ? [{ x, z, attackCooldown: bounded(b.attackCooldown, 0, 0, 5) }] : [];
    }) : [];
    const flotsam = Array.isArray(p.flotsam) ? p.flotsam.flatMap((f) => {
      if (!f || !FLOTSAM_KINDS.includes(f.kind)) return [];
      const x = finite(f.x, NaN), z = finite(f.z, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return [];
      return [{ kind: f.kind, x, z, drift: bounded(f.drift, 0, 0, 1) }];
    }) : [];
    const inv = inventory(p.inventory);
    // 解锁状态可以从背包反推,但反推不出"用光了的材料"——所以单独存,
    // 同时兜底把当前持有的稀有材料并进去,避免旧档解锁状态丢失
    const discovered = new Set<ItemKind>(
      Array.isArray(p.discovered)
        ? p.discovered.filter((k): k is ItemKind => (RARE_ITEMS as string[]).includes(k as string))
        : []
    );
    for (const k of RARE_ITEMS) if (inv[k] > 0) discovered.add(k);
    const island: Partial<SaveData['island']> = p.island && typeof p.island === 'object'
      ? p.island
      : {};
    const rawExploration = p.exploration && typeof p.exploration === 'object'
      ? p.exploration as Partial<ExplorationSave>
      : {};
    const visits: ExplorationSave['visits'] = {};
    for (const id of EXPEDITION_IDS) {
      const n = rawExploration.visits?.[id];
      if (typeof n === 'number' && Number.isFinite(n)) visits[id] = Math.floor(bounded(n, 0, 0, 9999));
    }
    const discoveredPoi = Array.isArray(rawExploration.discoveredPoi)
      ? [...new Set(rawExploration.discoveredPoi.filter((id): id is string => typeof id === 'string').map((id) => id.slice(0, 60)))]
      : [];
    const blueprints = Array.isArray(rawExploration.blueprints)
      ? [...new Set(rawExploration.blueprints.filter((k): k is BlueprintKind => BLUEPRINT_KINDS.includes(k as BlueprintKind)))]
      : [];
    const activeRaw = rawExploration.active && typeof rawExploration.active === 'object'
      ? rawExploration.active
      : null;
    const activeId = activeRaw && EXPEDITION_IDS.includes(activeRaw.id as ExpeditionId)
      ? activeRaw.id as ExpeditionId
      : null;
    const activeCargo: Cargo | null = activeRaw ? {} : null;
    if (activeCargo) {
      const rawCargo = inventory(activeRaw?.cargo);
      let remaining = buildings.some((b) => b.kind === 'dock' && b.level >= 2) ? 7 : 4;
      for (const kind of Object.keys(rawCargo) as ItemKind[]) {
        const count = Math.min(rawCargo[kind], remaining);
        if (count > 0) activeCargo[kind] = count;
        remaining -= count;
        if (remaining <= 0) break;
      }
    }
    const activeCollected = activeRaw && Array.isArray(activeRaw.collected)
      ? activeRaw.collected.filter((id): id is string => typeof id === 'string').map((id) => id.slice(0, 60))
      : [];
    return {
      version: 4,
      savedAt: finite(p.savedAt, Date.now()),
      island: {
        name: typeof island.name === 'string' && island.name.trim() ? island.name.slice(0, 24) : '无名小岛',
        seed: Math.floor(bounded(island.seed, 0, 0, 0x7fffffff)) || newIslandSeed(),
        shareId: typeof island.shareId === 'string' && SHORT_ID_RE.test(island.shareId)
          ? island.shareId : '',
        token: typeof island.token === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(island.token)
          ? island.token : '',
        seenVisits: Math.floor(bounded(island.seenVisits, 0, 0, 1e9)),
      },
      player: { x: finite(pos.x, 0), z: finite(pos.z, 0) },
      vitals: {
        health: bounded(v.health, 100, 0, 100),
        hunger: bounded(v.hunger, 100, 0, 100),
        thirst: bounded(v.thirst, 100, 0, 100),
        energy: bounded(v.energy, 100, 0, 100),
      },
      inventory: inv,
      clockT: bounded(p.clockT, daySeconds * 0.28, 0, daySeconds),
      day: Math.floor(bounded(p.day, 1, 1, 999999)),
      discovered: [...discovered],
      buildings,
      resources,
      boars,
      flotsam,
      flotsamDay: Math.floor(bounded(p.flotsamDay, 0, 0, 999999)),
      residents: residents(p.residents),
      exploration: {
        visits,
        discoveredPoi,
        blueprints,
        active: activeId && activeCargo
          ? { id: activeId, cargo: activeCargo, collected: activeCollected }
          : null,
      },
    };
  } catch {
    return null;
  }
}

export function persistSave(data: SaveData): void {
  storageSet(SAVE_KEY, JSON.stringify(data));
}

// ---- 岛屿快照:为"分享岛屿 / 互相参观"预留 ----
// 只包含展示一座岛所需的东西(身份 + 建筑 + 进度),不含背包和生存数值 ——
// 别人来参观的是你的岛,不是你的背包。

export interface IslandSnapshot {
  v: 1;
  name: string;
  seed: number;
  day: number;
  buildings: Array<{ kind: BuildingKind; x: number; z: number; level?: number }>;
  /**
   * 已经安家的住客。**可选**,所以不用把 v 升到 2 ——
   * 老客户端读到新码时会忽略这个字段,新客户端读老码时当成空数组,两边都不会打不开岛。
   * 只带 trade 和家的位置:好感、库存、要求都是岛主自己的进度,客人不该看见,也不该带走。
   */
  residents?: Array<{ trade: TradeKind; x: number; z: number }>;
}

export function islandSnapshot(data: SaveData): IslandSnapshot {
  return {
    v: 1,
    name: data.island.name,
    seed: data.island.seed,
    day: data.day,
    buildings: data.buildings.map((b) => ({
      kind: b.kind,
      x: Math.round(b.x * 100) / 100,
      z: Math.round(b.z * 100) / 100,
      level: b.level,
    })),
    // 还没安家的人还在码头等,岛主自己都没安顿好,不必让客人看见
    residents: data.residents.flatMap((r) => (r.home ? [{
      trade: r.trade,
      x: Math.round(r.home.x * 100) / 100,
      z: Math.round(r.home.z * 100) / 100,
    }] : [])),
  };
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // URL 安全:岛屿码要能直接塞进邀请链接
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(code: string): string {
  const padded = code.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (code.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeIslandCode(snapshot: IslandSnapshot): string {
  return toBase64(JSON.stringify(snapshot));
}

/**
 * 参观目标有两种形态:
 *   长码 —— 岛屿数据本身编在链接里,不需要服务端,离线也能分享
 *   短 id —— 服务端存了一份,链接短得多,而且能统计有多少人来过
 * 两种都要认,因为长码永远是短链服务挂掉时的退路。
 */
export interface VisitTarget {
  snapshot: IslandSnapshot | null;  // 长码:数据已经在手上
  shortId: string | null;           // 短 id:还要去服务端取
}

const SHORT_ID_RE = /^[0-9a-z]{4,12}$/;

/**
 * 从"用户可能粘贴进来的任何东西"里认出参观目标:
 * 整条邀请链接、`?visit=xxx` 查询串、光秃秃的岛屿码或短 id 都接受。
 */
export function readVisitTarget(input: string): VisitTarget | null {
  if (!input) return null;
  const text = input.trim();
  const match = /[?&#]visit=([^&#\s]+)/.exec(text);
  // 是个链接但没带 visit 参数:不要再拿整条 URL 去当岛屿码试
  const raw = match
    ? safeDecodeURI(match[1])
    : (/^https?:\/\//i.test(text) || text.includes('/') ? '' : text);
  if (!raw) return null;
  const snapshot = decodeIslandCode(raw);
  if (snapshot) return { snapshot, shortId: null };
  if (SHORT_ID_RE.test(raw)) return { snapshot: null, shortId: raw };
  return null;
}

function safeDecodeURI(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function decodeIslandCode(code: string): IslandSnapshot | null {
  try {
    const parsed = JSON.parse(fromBase64(code.trim())) as Partial<IslandSnapshot>;
    if (parsed.v !== 1) return null;
    const buildings = Array.isArray(parsed.buildings) ? parsed.buildings.flatMap((b) => {
      if (!b || !BUILDING_KINDS.includes(b.kind)) return [];
      const x = finite(b.x, NaN), z = finite(b.z, NaN);
      const level = Math.floor(bounded(b.level, 1, 1, 2));
      return Number.isFinite(x) && Number.isFinite(z) ? [{ kind: b.kind, x, z, level }] : [];
    }) : [];
    // 老码没有这个字段:当成"这岛上没人",而不是当成坏码
    const people = Array.isArray(parsed.residents) ? parsed.residents.flatMap((r) => {
      if (!r || !TRADE_KINDS.includes(r.trade)) return [];
      const x = finite(r.x, NaN), z = finite(r.z, NaN);
      return Number.isFinite(x) && Number.isFinite(z) ? [{ trade: r.trade, x, z }] : [];
    }) : [];
    return {
      v: 1,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.slice(0, 24) : '无名小岛',
      seed: Math.floor(bounded(parsed.seed, 0, 0, 0x7fffffff)),
      day: Math.floor(bounded(parsed.day, 1, 1, 999999)),
      buildings,
      residents: people,
    };
  } catch {
    return null;
  }
}
