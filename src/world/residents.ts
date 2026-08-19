// 住客:漂到岛上、要你盖房子、然后持续产出并提要求的人。
//
// 存在的理由见 RESIDENTS.md:现有的每个系统都会终结(建筑建完、探索点采完、
// 待客清单勾满即满级),住客是唯一一个**会自己提出新需求**的东西。
//
// 这个模块只放纯逻辑与定义:能不能来、产出怎么长、要求怎么出。
// 场景对象与交互留在 main,方便单独测试。
import type { Inventory, ItemKind } from '../game/hud';

export type TradeKind = 'fisher' | 'weaver' | 'carpenter' | 'sailor';

export interface TradeDef {
  kind: TradeKind;
  name: string;
  title: string;
  /** 每次产出给什么。第一刀只有渔夫,但结构按多职业写好 */
  yields: ItemKind;
  /** 他开口要的东西 —— 必须是现有系统拿得到的 */
  wants: { kind: ItemKind; count: number };
  greeting: string;
  settled: string;
  thanks: string;
}

export const TRADES: Record<TradeKind, TradeDef> = {
  fisher: {
    kind: 'fisher', name: '阿岩', title: '渔夫',
    yields: 'fish',
    wants: { kind: 'fiber', count: 3 },
    greeting: '我的船散了。你这儿要是有块地方落脚,我留下来打鱼。',
    settled: '有屋顶就好办了。往后每天都有鱼,记得来拿。',
    thanks: '有了这些纤维我能补张新网 —— 往后一天能多打一条。',
  },
  weaver: {
    kind: 'weaver', name: '苏木', title: '织工',
    yields: 'cloth',
    wants: { kind: 'fiber', count: 6 },
    greeting: '给我一间挡风的屋子,我把纤维给你织成帆布。',
    settled: '织机架起来了。纤维你尽管拿来。',
    thanks: '手感好多了,能织得更密。',
  },
  carpenter: {
    kind: 'carpenter', name: '老栓', title: '木匠',
    yields: 'wood',
    wants: { kind: 'stone', count: 4 },
    greeting: '我看得出这岛缺个会盖房子的。',
    settled: '工具棚支好了,我先给你备些料。',
    thanks: '有石头压台,锯得直多了。',
  },
  sailor: {
    kind: 'sailor', name: '阿潮', title: '水手',
    yields: 'cookedFood',
    wants: { kind: 'wood', count: 5 },
    greeting: '带我一个,我熟这片海。',
    settled: '往后出海的事,问我。',
    thanks: '这些木料够修桨了。',
  },
};

export interface ResidentRequest {
  kind: ItemKind;
  count: number;
  done: boolean;
}

export interface Resident {
  id: string;
  trade: TradeKind;
  arrivedDay: number;
  /** null = 还在码头等着,没有家 */
  home: { x: number; z: number } | null;
  stock: number;      // 屋外待收的产出
  growth: number;     // 产出计时(秒)
  quiet: number;      // 距下次开口的秒数;>0 时不提要求
  request: ResidentRequest | null;
  favor: number;      // 满足过多少次要求
}

// ---- 数值 ----
// 一天 300 秒。150 秒一份 = 每天约两份;上限 3 份意味着两天不来就停产,
// 逼你回来看一眼,但也不会因为一天没上线就白费
export const PRODUCE_SECONDS = 150;
export const MAX_STOCK = 3;
/** 安家后先安静一阵再开口,免得刚住下就催债 */
export const QUIET_AFTER_SETTLE = 120;
export const QUIET_AFTER_FULFILL = 240;

/**
 * 岛屿等级决定这座岛能留住几个人。
 * 这条是整个设计的关键:待客清单原本勾满即终点,现在变成"能招几个人"的门槛,
 * 语义反而更通 —— 客人能做的事够多,人才愿意留下来。
 */
export function residentCapacity(islandLevel: number): number {
  if (islandLevel >= 9) return 4;
  if (islandLevel >= 7) return 3;
  if (islandLevel >= 5) return 2;
  if (islandLevel >= 3) return 1;
  return 0;
}

export const ARRIVAL_GAP_DAYS = 3;

/**
 * 今天该不该漂来一位新住客。
 * 三个条件都要满足:岛屿等级够、没超上限、离上一位来的日子够远。
 * 需要码头这一条由调用方判断(码头是场景对象,不是这里的知识)。
 */
export function shouldArrive(
  day: number, islandLevel: number, residents: Resident[]
): boolean {
  if (residents.length >= residentCapacity(islandLevel)) return false;
  const lastDay = residents.reduce((max, r) => Math.max(max, r.arrivedDay), -Infinity);
  if (Number.isFinite(lastDay) && day - lastDay < ARRIVAL_GAP_DAYS) return false;
  return true;
}

/** 下一位该来什么职业:按固定顺序,先来的职业先补 */
const TRADE_ORDER: TradeKind[] = ['fisher', 'weaver', 'carpenter', 'sailor'];

export function nextTrade(residents: Resident[]): TradeKind {
  const taken = new Set(residents.map((r) => r.trade));
  return TRADE_ORDER.find((t) => !taken.has(t)) ?? TRADE_ORDER[0];
}

export function createResident(trade: TradeKind, day: number): Resident {
  return {
    id: `${trade}-${day}`,
    trade,
    arrivedDay: day,
    home: null,
    stock: 0,
    growth: 0,
    quiet: 0,
    request: null,
    favor: 0,
  };
}

/** 满足过的要求越多,产得越快 —— 这是"关系变深"目前唯一的体现 */
export function produceInterval(r: Resident): number {
  return PRODUCE_SECONDS / (1 + r.favor * 0.5);
}

/**
 * 推进一位住客的状态。返回这一帧是否刚产出一份(调用方可以据此提示)。
 * 没安家的人不产出也不提要求 —— 他还在码头站着。
 */
export function updateResident(r: Resident, dt: number): boolean {
  if (!r.home) return false;

  let produced = false;
  if (r.stock < MAX_STOCK) {
    r.growth += dt;
    const interval = produceInterval(r);
    if (r.growth >= interval) {
      r.growth -= interval;
      r.stock++;
      produced = true;
    }
  } else {
    // 堆满就停产,不要偷偷累计 —— 否则玩家离开一周回来一次性爆仓
    r.growth = 0;
  }

  if (r.quiet > 0) {
    r.quiet = Math.max(0, r.quiet - dt);
  } else if (!r.request) {
    const want = TRADES[r.trade].wants;
    r.request = { kind: want.kind, count: want.count, done: false };
  }
  return produced;
}

/** 住客安家 */
export function settle(r: Resident, x: number, z: number): void {
  r.home = { x, z };
  r.growth = 0;
  r.quiet = QUIET_AFTER_SETTLE;
}

/** 能不能满足当前要求 */
export function canFulfill(r: Resident, inv: Inventory): boolean {
  return !!r.request && !r.request.done && inv[r.request.kind] >= r.request.count;
}

/**
 * 满足要求:扣材料、加好感、进入静默期。
 * 返回被扣掉的材料,由调用方从背包里减 —— 这个模块不碰背包
 */
export function fulfill(r: Resident): { kind: ItemKind; count: number } | null {
  if (!r.request || r.request.done) return null;
  const paid = { kind: r.request.kind, count: r.request.count };
  r.request = null;
  r.favor++;
  r.quiet = QUIET_AFTER_FULFILL;
  return paid;
}

/** 收走屋外堆着的产出,返回收到几份 */
export function collect(r: Resident): number {
  const n = r.stock;
  r.stock = 0;
  return n;
}
