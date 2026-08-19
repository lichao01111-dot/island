// 住客的场景表现:模型、走动、屋外堆着的产出。
//
// 单独成文件是刻意的:main.ts 已经 1800 行,住客不该再往里堆两百行。
// residents.ts 保持纯逻辑(不 import THREE,测试跑得快),这里只管看得见的部分。
import * as THREE from 'three';
import { islandHeight } from './island';
import { instantiate } from './assets';
import { TRADES, type Resident } from './residents';

export interface ResidentView {
  /** 锚点:钉在自家门口不动。产出堆在这儿,人只是在附近晃 */
  group: THREE.Group;
  /** 人本身。在 group 的局部空间里游走 */
  figure: THREE.Group;
  /** 屋外那堆待收的产出,数量跟着 stock 变 */
  stockMeshes: THREE.Mesh[];
  bobPhase: number;
  /** 用了骨骼资产才有。没有的话住客就是个静止的替身 */
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  currentClip: string;
  /** 用的是替身还是真模型。资产加载完后要据此重建视图 */
  placeholder: boolean;
  /** 当前的游走目标(锚点局部坐标)与到点后的发呆倒计时 */
  wanderX: number;
  wanderZ: number;
  pause: number;
}

const STOCK_COLORS: Record<string, string> = {
  food: '#e8d9a0', cloth: '#ddd6b6', wood: '#9a6b3f', cookedFood: '#d7b06a', fish: '#8fb6c9',
};

/** 没有外部资产时的替身:比方块人还简单,但站得住、认得出 */
function placeholderFigure(): THREE.Group {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: '#6f7f8c', flatShading: true, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: '#f3bd91', flatShading: true, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 1.0, 6), cloth);
  body.position.y = 0.5; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.36), skin);
  head.position.y = 1.2; head.castShadow = true; g.add(head);
  return g;
}

// 住客默认穿野蛮人那身,玩家默认是盗贼 —— 站在一起能一眼分开,而且不用多下一份 3.6MB。
// 'resident' 排在最前是留给以后的专用住客资产:清单里加一条就会自动优先用它。
const RESIDENT_ASSETS = ['resident', 'barbarian', 'rogue'];
const CLIPS = { idle: 'Idle', walk: 'Walking_A' } as const;

// 游走参数。半径要小于交互距离(3.4),否则人会晃出玩家够得着的范围
const WANDER_RADIUS = 2.4;
const WALK_SPEED = 1.15;
const ARRIVE = 0.25;

export function createResidentView(): ResidentView {
  const group = new THREE.Group();
  const figure = new THREE.Group();
  group.add(figure);

  // 住客复用玩家那套 KayKit 资产。没有文件就用替身 —— 和其它资产一样,缺了不能崩
  let asset = null;
  for (const name of RESIDENT_ASSETS) {
    asset = instantiate(name);
    if (asset) break;
  }
  figure.add(asset ? asset.object : placeholderFigure());

  // 没有 mixer 的骨骼模型会停在绑定姿势(KayKit 是个 T-pose),比替身还难看。
  // 所以模型和动画是一起接的:拿不到片段就不值得换掉替身。
  let mixer: THREE.AnimationMixer | null = null;
  const actions = new Map<string, THREE.AnimationAction>();
  if (asset) {
    mixer = new THREE.AnimationMixer(asset.object);
    for (const [state, name] of Object.entries(CLIPS)) {
      const clip = asset.animations.find((a) => a.name === name);
      if (clip) actions.set(state, mixer.clipAction(clip));
    }
    const idle = actions.get('idle');
    if (idle) {
      idle.play();
      // 每人错开一点,免得一排住客像复读机一样同步呼吸
      mixer.update(Math.random() * idle.getClip().duration);
    }
    asset.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
  }

  // 屋外的产出:最多三份,按 stock 显隐
  const stockMeshes: THREE.Mesh[] = [];
  const basket = new THREE.MeshStandardMaterial({ color: '#a8794d', flatShading: true, roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), basket);
    m.castShadow = true;
    m.visible = false;
    stockMeshes.push(m);
    group.add(m);
  }
  return {
    group, figure, stockMeshes, mixer, actions,
    currentClip: 'idle',
    bobPhase: Math.random() * Math.PI * 2,
    placeholder: !asset,
    wanderX: 0, wanderZ: 0,
    pause: Math.random() * 4,
  };
}

/**
 * 站位离建筑中心多远。
 * 以前写死 1.9 —— 而小屋本身横跨 ±2.3,住客就站在自家屋顶底下,整个人看不见。
 * 所以这个距离必须由建筑的实际尺寸决定,调用方传进来。
 */
export const MIN_STAND_OFF = 1.9;

/** 住客此刻站的世界坐标。交互判定要用这个,不能用锚点 —— 人是会走动的 */
export function residentWorldSpot(view: ResidentView): { x: number; z: number } {
  return {
    x: view.group.position.x + view.figure.position.x,
    z: view.group.position.z + view.figure.position.z,
  };
}

function playClip(view: ResidentView, state: 'idle' | 'walk'): void {
  if (view.currentClip === state) return;
  const next = view.actions.get(state);
  const prev = view.actions.get(view.currentClip);
  if (!next) return;
  next.reset().play();
  if (prev && prev !== next) next.crossFadeFrom(prev, 0.25, false);
  view.currentClip = state;
}

/**
 * 把住客摆到该在的地方:没安家就在码头附近等,安家了就在自家门口一带走动。
 * dock 为 null(还没建码头)时不显示 —— 这种情况下他本来也不该出现。
 */
export function updateResidentView(
  view: ResidentView, r: Resident, dock: { x: number; z: number } | null, t: number,
  dt = 0, standOff = MIN_STAND_OFF
): void {
  const spot = r.home ?? dock;
  if (!spot) { view.group.visible = false; return; }
  view.group.visible = true;
  view.mixer?.update(dt);

  // 锚点:家/码头旁边一点,绕开建筑本体
  const d = Math.max(MIN_STAND_OFF, standOff);
  const ax = spot.x + Math.cos(view.bobPhase) * d;
  const az = spot.z + Math.sin(view.bobPhase) * d;
  view.group.position.set(ax, islandHeight(ax, az), az);

  // 在锚点周围踱步:走到点就发会儿呆,再挑下一个点。
  // 这点动静是"这岛上有人住"和"这岛上摆了几个雕像"的区别。
  const dx = view.wanderX - view.figure.position.x;
  const dz = view.wanderZ - view.figure.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < ARRIVE) {
    view.pause -= dt;
    playClip(view, 'idle');
    if (view.pause <= 0) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * WANDER_RADIUS;
      view.wanderX = Math.cos(a) * rr;
      view.wanderZ = Math.sin(a) * rr;
      view.pause = 2 + Math.random() * 4;
    }
    // 站定时面朝自己的家 —— 背对着房子发呆看着像在闹别扭
    view.figure.rotation.y = Math.atan2(spot.x - ax - view.figure.position.x, spot.z - az - view.figure.position.z);
  } else {
    const step = Math.min(dist, WALK_SPEED * dt);
    view.figure.position.x += (dx / dist) * step;
    view.figure.position.z += (dz / dist) * step;
    view.figure.rotation.y = Math.atan2(dx, dz);
    playClip(view, 'walk');
  }
  // 地形起伏:锚点已经带了一份高度,这里只补上人相对锚点的落差
  const fx = ax + view.figure.position.x;
  const fz = az + view.figure.position.z;
  view.figure.position.y = islandHeight(fx, fz) - view.group.position.y;

  // 产出堆在门口(锚点上,不跟着人走),按 stock 显隐;
  // 轻微上下浮动提示"这儿有东西可以拿"
  const color = STOCK_COLORS[TRADES[r.trade].yields] ?? '#e8d9a0';
  for (let i = 0; i < view.stockMeshes.length; i++) {
    const m = view.stockMeshes[i];
    m.visible = r.home !== null && i < r.stock;
    if (!m.visible) continue;
    (m.material as THREE.MeshStandardMaterial).color.set(color);
    const a = view.bobPhase + i * 2.1;
    m.position.set(Math.cos(a) * 0.7, 0.16 + Math.sin(t * 1.6 + i) * 0.03, Math.sin(a) * 0.7);
    m.rotation.y = a;
  }
}
