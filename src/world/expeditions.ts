// 群岛远征：三座可进入的小岛、探索点、有限载货与升级蓝图。
// 主岛负责长期建设；远征岛每次出发重置资源点，但“第一次发现”永久写进日志。
import * as THREE from 'three';
import type { Inventory } from '../game/hud';
import type { BuildingKind } from './buildings';

export type ExpeditionId = 'mangrove' | 'reef' | 'cave';
export type BlueprintKind = Extract<BuildingKind, 'campfire' | 'shelter' | 'collector' | 'dock'>;
export type PoiVisual = 'seed' | 'hut' | 'cistern' | 'wreck' | 'sail' | 'crate' | 'ore' | 'hearth' | 'fungus';

export interface ExpeditionPoiDef {
  id: string;
  label: string;
  story: string;
  x: number;
  z: number;
  loot: Partial<Inventory>;
  blueprint?: BlueprintKind;
  visual: PoiVisual;
  energyCost: number;
}

export interface ExpeditionDef {
  id: ExpeditionId;
  name: string;
  icon: string;
  subtitle: string;
  description: string;
  radius: number;
  distance: number;
  requiresDockLevel: number;
  palette: { wet: string; sand: string; ground: string; high: string };
  pois: ExpeditionPoiDef[];
}

export type Cargo = Partial<Record<keyof Inventory, number>>;

export const EXPEDITION_ORDER: ExpeditionId[] = ['mangrove', 'reef', 'cave'];

export const EXPEDITIONS: Record<ExpeditionId, ExpeditionDef> = {
  mangrove: {
    id: 'mangrove', name: '雾潮红树林', icon: '叶', subtitle: '近海 · 潮湿林地',
    description: '浅水树根间藏着种子、旧棚屋和失落的蓄水办法。',
    radius: 12.5, distance: 1, requiresDockLevel: 1,
    palette: { wet: '#779c78', sand: '#aeba85', ground: '#4f8452', high: '#315f3d' },
    pois: [
      {
        id: 'mangrove-seeds', label: '潮汐种荚', story: '盐水退去后，一串耐湿种荚挂在根系之间。',
        x: -4.8, z: 2.6, loot: { seed: 2 }, visual: 'seed', energyCost: 5,
      },
      {
        id: 'mangrove-hut', label: '废弃棚屋', story: '破棚里留下了更结实的立柱接法。',
        x: 4.2, z: 3.4, loot: { cloth: 1, fiber: 1 }, blueprint: 'shelter', visual: 'hut', energyCost: 7,
      },
      {
        id: 'mangrove-cistern', label: '石槽遗迹', story: '石槽仍盛着雨水，边缘刻着完整的引流结构。',
        x: 1.4, z: -4.6, loot: { stone: 1, seed: 1 }, blueprint: 'collector', visual: 'cistern', energyCost: 6,
      },
    ],
  },
  reef: {
    id: 'reef', name: '碎帆礁', icon: '帆', subtitle: '外礁 · 沉船残骸',
    description: '风浪把旧船撕在礁石上，金属与帆布仍能抢救。',
    radius: 11.5, distance: 2, requiresDockLevel: 1,
    palette: { wet: '#90b5a2', sand: '#d2c79d', ground: '#778d61', high: '#6c6d69' },
    pois: [
      {
        id: 'reef-engine', label: '锈蚀绞盘', story: '绞盘的齿轮还能转，旁边留着船匠的加固图。',
        x: -2.75, z: -1.15, loot: { metal: 2 }, blueprint: 'dock', visual: 'wreck', energyCost: 8,
      },
      {
        id: 'reef-sail', label: '卡住的旧帆', story: '帆布被珊瑚钩住，割下来还能继续使用。',
        x: 3.35, z: 1.55, loot: { cloth: 2 }, visual: 'sail', energyCost: 6,
      },
      {
        id: 'reef-crate', label: '密封补给箱', story: '箱盖挡住了海水，里面的食物仍然完好。',
        x: 2.75, z: 4.15, loot: { food: 2, wood: 1 }, visual: 'crate', energyCost: 5,
      },
    ],
  },
  cave: {
    id: 'cave', name: '黑岩洞岛', icon: '矿', subtitle: '远海 · 黑岩洞穴',
    description: '只有加固船坞能抵达。洞里有铁矿，也有一座古老火塘。',
    radius: 12, distance: 3, requiresDockLevel: 2,
    palette: { wet: '#566563', sand: '#74736d', ground: '#4d5754', high: '#353c40' },
    pois: [
      {
        id: 'cave-ore', label: '裸露铁矿脉', story: '岩壁里闪着暗红矿纹，可以凿下一批铁料。',
        x: -2.85, z: 0.55, loot: { metal: 3 }, visual: 'ore', energyCost: 10,
      },
      {
        id: 'cave-hearth', label: '古老石火塘', story: '火塘用厚石蓄热，风再大也不容易熄灭。',
        x: 3.45, z: 3.15, loot: { stone: 3 }, blueprint: 'campfire', visual: 'hearth', energyCost: 8,
      },
      {
        id: 'cave-fungus', label: '洞口菌圃', story: '潮湿石缝长出可食用菌，也结着少见孢子。',
        x: 2.55, z: -4.25, loot: { food: 2, seed: 1 }, visual: 'fungus', energyCost: 6,
      },
    ],
  },
};

export function cargoUsed(cargo: Cargo): number {
  return Object.values(cargo).reduce((sum, n) => sum + (n ?? 0), 0);
}

export function lootSize(loot: Partial<Inventory>): number {
  return Object.values(loot).reduce((sum, n) => sum + (n ?? 0), 0);
}

export function cargoCanFit(cargo: Cargo, loot: Partial<Inventory>, capacity: number): boolean {
  return cargoUsed(cargo) + lootSize(loot) <= capacity;
}

export function addLootToCargo(cargo: Cargo, loot: Partial<Inventory>): void {
  for (const kind of Object.keys(loot) as Array<keyof Inventory>) {
    cargo[kind] = (cargo[kind] ?? 0) + (loot[kind] ?? 0);
  }
}

export function expeditionHeight(id: ExpeditionId, x: number, z: number): number {
  const def = EXPEDITIONS[id];
  const angle = Math.atan2(z, x);
  const outline = id === 'reef'
    ? 1 + Math.sin(angle * 3 + 0.8) * 0.045 + Math.sin(angle * 7 - 0.3) * 0.026 + Math.cos(angle * 11) * 0.014
    : id === 'cave'
      ? 1 + Math.sin(angle * 5 - 0.5) * 0.042 + Math.cos(angle * 9 + 0.6) * 0.024
      : 1;
  const d = Math.hypot(x, z) / (def.radius * outline);
  if (d >= 1.08) return -2.2;
  const dome = Math.cos(Math.min(1, d) * Math.PI * 0.5);
  const phase = id === 'mangrove' ? 0.4 : id === 'reef' ? 1.7 : 3.1;
  const bumps = Math.sin(x * 0.42 + phase) * Math.cos(z * 0.31 - phase) * 0.38
    + Math.sin(x * 0.17 + z * 0.21 + phase) * 0.48;
  const base = id === 'mangrove' ? 1.45 : id === 'reef' ? 2.2 : 3.1;
  let height = dome * base + bumps * dome - 0.28;
  if (id === 'reef') {
    // 外礁中央被反复冲刷成浅凹，给潮池与沉船留出一块低地，而不是整岛一座圆丘。
    const basin = Math.exp(-(x * x / 34 + z * z / 27));
    const channel = Math.exp(-((x + 1.7) ** 2 / 18 + (z - 0.8) ** 2 / 9));
    height -= (basin * 0.72 + channel * 0.24) * dome;
  } else if (id === 'cave') {
    // 洞岛中心略微下沉，外围玄武岩形成包围感，探索点不会都摆在同一块鼓包上。
    height -= Math.exp(-(x * x / 42 + z * z / 46)) * 0.42 * dome;
  }
  return height;
}

function islandMesh(def: ExpeditionDef): THREE.Mesh {
  const segments = 64;
  const rings = 28;
  const radius = def.radius + 2;
  const vertices: number[] = [0, expeditionHeight(def.id, 0, 0), 0];
  const colors: number[] = [];
  const color = new THREE.Color();
  const pushColor = (h: number, x: number, z: number) => {
    color.set(h < 0.05 ? def.palette.wet : h < 0.5 ? def.palette.sand : h < 1.65 ? def.palette.ground : def.palette.high);
    // 微小明度起伏让大块地面保留自然颗粒，但幅度受控，不破坏各岛主色。
    color.multiplyScalar(0.96 + Math.sin(x * 0.83 + z * 0.57 + def.distance) * 0.035);
    colors.push(color.r, color.g, color.b);
  };
  pushColor(vertices[1], 0, 0);
  for (let ring = 1; ring <= rings; ring++) {
    const r = radius * ring / rings;
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = expeditionHeight(def.id, x, z);
      vertices.push(x, h, z);
      pushColor(h, x, z);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) indices.push(0, 1 + (i + 1) % segments, 1 + i);
  for (let ring = 1; ring < rings; ring++) {
    const inner = 1 + (ring - 1) * segments;
    const outer = inner + segments;
    for (let i = 0; i < segments; i++) {
      const n = (i + 1) % segments;
      indices.push(inner + i, outer + n, outer + i, inner + i, inner + n, outer + n);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.9, dithering: true,
  }));
  mesh.receiveShadow = true;
  mesh.castShadow = def.id !== 'mangrove';
  return mesh;
}

function mangroveTree(x: number, z: number, height: number, variant: number): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: variant % 2 ? '#62432f' : '#73503a', flatShading: true, roughness: 0.95 });
  const leafDark = new THREE.MeshStandardMaterial({ color: '#285f3f', flatShading: true, roughness: 0.92 });
  const leafLight = new THREE.MeshStandardMaterial({ color: '#3d8050', flatShading: true, roughness: 0.9 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, height, 7), wood);
  trunk.position.y = height / 2;
  trunk.rotation.z = (variant % 2 ? -1 : 1) * 0.07;
  trunk.castShadow = true;
  g.add(trunk);

  // 红树林最有识别度的是露出泥面的板根。根从树脚向外张开，而不是一根直杆插进地里。
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + variant * 0.31;
    const root = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.13, 1.55, 5), wood);
    root.position.set(Math.cos(a) * 0.55, 0.35, Math.sin(a) * 0.55);
    root.rotation.order = 'YXZ';
    root.rotation.y = a;
    root.rotation.z = Math.PI / 2.7;
    root.castShadow = true;
    g.add(root);
  }

  // 三根粗枝把树冠撑开，避免叶团像一颗球粘在树干顶端。
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + 0.45;
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.7, 6), wood);
    branch.position.set(Math.cos(a) * 0.48, height * 0.78, Math.sin(a) * 0.48);
    branch.rotation.order = 'YXZ'; branch.rotation.y = a; branch.rotation.z = Math.PI / 3.4;
    branch.castShadow = true; g.add(branch);
  }
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2 + variant * 0.4;
    const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.95 + (i % 3) * 0.16, 0), i % 2 ? leafDark : leafLight);
    crown.position.set(Math.cos(a) * 1.15, height - 0.15 + Math.sin(i * 1.8) * 0.34, Math.sin(a) * 0.85);
    crown.scale.set(1.35, 0.48, 0.82);
    crown.rotation.y = a;
    crown.castShadow = true;
    g.add(crown);
  }
  g.position.set(x, expeditionHeight('mangrove', x, z), z);
  return g;
}

function wetPatch(x: number, z: number, sx: number, sz: number): THREE.Mesh {
  const patch = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshStandardMaterial({ color: '#397a73', transparent: true, opacity: 0.72, roughness: 0.2, metalness: 0.05 })
  );
  patch.rotation.x = -Math.PI / 2;
  patch.scale.set(sx, sz, 1);
  patch.position.set(x, expeditionHeight('mangrove', x, z) + 0.045, z);
  return patch;
}

function reedCluster(x: number, z: number, variant: number): THREE.Group {
  const g = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({ color: '#668953', flatShading: true, roughness: 0.95 });
  const tipMat = new THREE.MeshStandardMaterial({ color: '#8f6842', flatShading: true, roughness: 0.96 });
  for (let i = 0; i < 5; i++) {
    const a = i * 2.1 + variant;
    const h = 0.65 + (i % 3) * 0.17;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.027, h, 4), stemMat);
    stem.position.set(Math.cos(a) * 0.22, h / 2, Math.sin(a) * 0.22); g.add(stem);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.2, 5), tipMat);
    tip.position.set(stem.position.x, h + 0.05, stem.position.z); g.add(tip);
  }
  g.position.set(x, expeditionHeight('mangrove', x, z), z);
  return g;
}

type ExpeditionUpdater = (time: number) => void;

function reefWater(updaters: ExpeditionUpdater[]): THREE.Group {
  const g = new THREE.Group();
  const shelfMat = new THREE.MeshStandardMaterial({
    color: '#63d5cf', transparent: true, opacity: 0.36, depthWrite: false,
    roughness: 0.2, metalness: 0.04, emissive: '#15545e', emissiveIntensity: 0.12,
  });
  const shelf = new THREE.Mesh(new THREE.CircleGeometry(13.15, 64), shelfMat);
  shelf.rotation.x = -Math.PI / 2;
  shelf.scale.set(1.04, 0.92, 1);
  shelf.position.y = 0.035;
  shelf.renderOrder = 2;
  g.add(shelf);

  const poolMat = new THREE.MeshStandardMaterial({
    color: '#42c6c6', transparent: true, opacity: 0.7, depthWrite: false,
    roughness: 0.14, metalness: 0.04, emissive: '#0a4d5a', emissiveIntensity: 0.2,
  });
  const rimMat = new THREE.MeshBasicMaterial({
    color: '#d8efe2', transparent: true, opacity: 0.46, depthWrite: false, side: THREE.DoubleSide,
  });
  const pools: Array<[number, number, number, number, number]> = [
    [-1.55, 0.55, 1.65, 0.82, -0.25],
    [0.6, -1.15, 1.32, 0.68, 0.38],
    [1.35, 1.45, 0.92, 0.52, -0.12],
  ];
  for (const [x, z, sx, sz, rotation] of pools) {
    const y = expeditionHeight('reef', x, z) + 0.055;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 24), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.rotation.z = rotation;
    pool.scale.set(sx, sz, 1);
    pool.position.set(x, y, z);
    pool.renderOrder = 3;
    g.add(pool);
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.88, 1.02, 24), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.rotation.z = rotation;
    rim.scale.set(sx, sz, 1);
    rim.position.set(x, y + 0.014, z);
    rim.renderOrder = 4;
    g.add(rim);
  }

  const foamMat = new THREE.MeshBasicMaterial({
    color: '#f0f5e6', transparent: true, opacity: 0.5, depthWrite: false,
  });
  for (let i = 0; i < 5; i++) {
    const foam = new THREE.Mesh(new THREE.TorusGeometry(10.65 + (i % 2) * 0.34, 0.035, 4, 30, 0.7 + (i % 3) * 0.18), foamMat);
    foam.rotation.set(Math.PI / 2, 0, i * 1.29 + 0.22);
    foam.position.y = 0.09;
    foam.renderOrder = 4;
    g.add(foam);
  }
  updaters.push((time) => {
    poolMat.opacity = 0.66 + Math.sin(time * 1.15) * 0.055;
    rimMat.opacity = 0.4 + Math.sin(time * 1.35 + 0.8) * 0.09;
    foamMat.opacity = 0.43 + Math.sin(time * 1.65) * 0.08;
  });
  return g;
}

function reefCoralGarden(): THREE.Group {
  const g = new THREE.Group();
  const placements: Array<[number, number, number, number]> = [
    [-7.2, 0.4, 0, 1.1], [-6.4, 1.4, 1, 0.72], [-5.8, 4.2, 2, 0.9],
    [-4.6, 5.5, 0, 0.78], [5.4, -2.9, 1, 1.05], [6.8, -1.4, 2, 0.72],
    [6.1, 3.8, 0, 0.9], [4.9, 5.4, 2, 0.7], [-1.6, 6.7, 1, 0.82],
    [-7.4, -3.4, 2, 0.65], [2.9, -5.8, 0, 0.68],
  ];
  const branchGeo = new THREE.CylinderGeometry(0.07, 0.14, 1, 6);
  const branchMats = ['#c8655b', '#df9850', '#c9c4aa'].map((color) => new THREE.MeshStandardMaterial({
    color, flatShading: true, roughness: 0.86,
  }));
  const branchMatrices: THREE.Matrix4[][] = [[], [], []];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (const [x, z, variant, size] of placements) {
    const baseY = expeditionHeight('reef', x, z) + 0.02;
    for (let arm = 0; arm < 3; arm++) {
      const angle = arm * 2.1 + variant * 0.63;
      const h = size * (0.55 + arm * 0.18);
      position.set(x + Math.cos(angle) * size * 0.18, baseY + h / 2, z + Math.sin(angle) * size * 0.18);
      quaternion.setFromEuler(new THREE.Euler(Math.cos(angle) * 0.1, angle, Math.sin(angle) * 0.28));
      scale.set(size, h, size);
      branchMatrices[variant % 3].push(matrix.compose(position, quaternion, scale).clone());
    }
  }
  for (let color = 0; color < branchMatrices.length; color++) {
    const matrices = branchMatrices[color];
    const mesh = new THREE.InstancedMesh(branchGeo, branchMats[color], matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = color !== 2;
    g.add(mesh);
  }

  const brainGeo = new THREE.DodecahedronGeometry(0.48, 1);
  const brainMat = new THREE.MeshStandardMaterial({ color: '#d0a477', flatShading: true, roughness: 0.93 });
  const brains: Array<[number, number, number]> = [[-6.5, 3.4, 0.9], [5.8, 2.1, 1.1], [3.8, -5.2, 0.7], [-4.9, -4.6, 0.75]];
  const brainMesh = new THREE.InstancedMesh(brainGeo, brainMat, brains.length);
  brains.forEach(([x, z, size], i) => {
    position.set(x, expeditionHeight('reef', x, z) + size * 0.3, z);
    quaternion.setFromEuler(new THREE.Euler(0, i * 0.72, 0));
    scale.set(size, size * 0.6, size);
    brainMesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
  });
  brainMesh.instanceMatrix.needsUpdate = true;
  brainMesh.castShadow = true;
  g.add(brainMesh);

  const fanShape = new THREE.Shape();
  fanShape.moveTo(-0.07, 0);
  fanShape.lineTo(-0.42, 0.72);
  fanShape.lineTo(-0.2, 0.82);
  fanShape.lineTo(0, 0.3);
  fanShape.lineTo(0.24, 0.86);
  fanShape.lineTo(0.48, 0.68);
  fanShape.lineTo(0.08, 0);
  fanShape.closePath();
  const fanGeo = new THREE.ShapeGeometry(fanShape, 4);
  const fanMat = new THREE.MeshStandardMaterial({ color: '#8f5574', side: THREE.DoubleSide, roughness: 0.85, flatShading: true });
  for (const [i, coords] of [[0, [-5.9, -2.5]], [1, [6.3, 0.3]], [2, [1.2, 6.4]], [3, [-3.6, 6.0]]] as Array<[number, [number, number]]>) {
    const [x, z] = coords;
    const fan = new THREE.Mesh(fanGeo, fanMat);
    fan.position.set(x, expeditionHeight('reef', x, z) + 0.04, z);
    fan.rotation.y = i * 0.77 - 0.6;
    fan.scale.setScalar(0.72 + (i % 2) * 0.22);
    g.add(fan);
  }
  return g;
}

function wreckLandmark(): THREE.Group {
  const g = new THREE.Group();
  const wetWood = new THREE.MeshStandardMaterial({ color: '#4d382d', flatShading: true, roughness: 0.98 });
  const splitWood = new THREE.MeshStandardMaterial({ color: '#72604d', flatShading: true, roughness: 0.95 });
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 6.7), wetWood);
  keel.position.y = 0.24;
  keel.castShadow = true;
  g.add(keel);
  for (let i = -2; i <= 2; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(1.05 + Math.abs(i) * 0.07, 0.085, 5, 14, Math.PI), wetWood);
    rib.position.set(0, 0.28, i * 1.02);
    rib.scale.y = 0.92 + (i % 2) * 0.08;
    rib.rotation.z = i * 0.045;
    rib.castShadow = true;
    g.add(rib);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 4.8 - i * 0.55), i === 1 ? splitWood : wetWood);
      plank.position.set(side * (0.6 + i * 0.22), 0.34 + i * 0.18, 0.05 + side * i * 0.12);
      plank.rotation.z = side * (0.07 + i * 0.035);
      plank.rotation.y = side * i * 0.025;
      plank.castShadow = true;
      g.add(plank);
    }
  }
  for (let i = 0; i < 5; i++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 1.25 + (i % 3) * 0.32), splitWood);
    board.position.set(-1.45 + i * 0.67, 0.13 + (i % 2) * 0.06, -2.3 + i * 1.02);
    board.rotation.set(0.02 * i, -0.55 + i * 0.19, 0.05 * (i - 2));
    board.castShadow = true;
    g.add(board);
  }
  const brokenMast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 3.2, 7), wetWood);
  brokenMast.position.set(-0.35, 0.72, 1.25);
  brokenMast.rotation.z = 1.05;
  brokenMast.rotation.y = -0.35;
  brokenMast.castShadow = true;
  g.add(brokenMast);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.35, 3), wetWood);
  bow.rotation.x = Math.PI / 2;
  bow.position.set(0, 0.42, 3.15);
  bow.castShadow = true;
  g.add(bow);
  g.position.set(-0.1, expeditionHeight('reef', -0.1, -0.1) + 0.02, -0.1);
  g.rotation.y = -0.47;
  return g;
}

function basaltCluster(x: number, z: number, heights: number[], variant: number): THREE.Group {
  const g = new THREE.Group();
  const mats = [
    new THREE.MeshStandardMaterial({ color: '#343c3f', flatShading: true, roughness: 0.94 }),
    new THREE.MeshStandardMaterial({ color: '#49504f', flatShading: true, roughness: 0.92 }),
  ];
  heights.forEach((height, i) => {
    const radius = 0.34 + (i % 3) * 0.08;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.88, radius, height, 6), mats[(i + variant) % mats.length]);
    const a = i * 2.17 + variant * 0.51;
    column.position.set(Math.cos(a) * (0.35 + i * 0.08), height / 2, Math.sin(a) * (0.32 + i * 0.07));
    column.rotation.y = a * 0.37;
    column.rotation.z = Math.sin(a) * 0.035;
    column.castShadow = height > 1;
    g.add(column);
  });
  g.position.set(x, expeditionHeight('cave', x, z), z);
  return g;
}

function caveEntrance(): THREE.Group {
  const g = new THREE.Group();
  const x = 0;
  const z = 4.45;
  const floorY = expeditionHeight('cave', x, z) + 0.02;
  const tunnelMat = new THREE.MeshStandardMaterial({ color: '#111a1f', roughness: 1, side: THREE.DoubleSide });
  const deepMat = new THREE.MeshBasicMaterial({ color: '#05090d', side: THREE.DoubleSide });
  const outer = new THREE.Mesh(new THREE.CircleGeometry(1.55, 22), tunnelMat);
  outer.position.set(x, floorY + 1.28, z - 0.06);
  outer.scale.y = 0.88;
  g.add(outer);
  const deep = new THREE.Mesh(new THREE.CircleGeometry(1.25, 20), deepMat);
  deep.position.set(x, floorY + 1.18, z - 0.42);
  deep.scale.y = 0.82;
  g.add(deep);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2.45, 2.4),
    new THREE.MeshStandardMaterial({ color: '#151d20', roughness: 0.84, metalness: 0.04, side: THREE.DoubleSide })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, floorY + 0.055, z - 1.08);
  g.add(floor);

  const basaltMats = ['#343a3d', '#42494a', '#2b3336'].map((color) => new THREE.MeshStandardMaterial({
    color, flatShading: true, roughness: 0.95,
  }));
  const sideColumns: Array<[number, number, number, number, number]> = [
    [-1.64, 2.3, -0.08, 0.04, 0], [-1.28, 2.65, 0.03, -0.1, 1], [-1.94, 1.75, 0.18, 0.05, 2],
    [1.58, 2.45, 0.04, -0.04, 1], [1.24, 2.7, -0.05, 0.11, 2], [1.95, 1.85, -0.16, -0.04, 0],
  ];
  for (const [px, h, pz, lean, mat] of sideColumns) {
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.47, h, 6), basaltMats[mat]);
    column.position.set(px, floorY + h / 2, z + pz);
    column.rotation.z = lean;
    column.rotation.y = px * 0.21;
    column.castShadow = true;
    g.add(column);
  }
  for (const side of [-1, 1]) {
    const lintel = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.4, 1.72, 6), basaltMats[side < 0 ? 0 : 1]);
    lintel.position.set(side * 0.64, floorY + 2.48, z + 0.01);
    lintel.rotation.z = side * 1.05;
    lintel.rotation.y = side * 0.12;
    lintel.castShadow = true;
    g.add(lintel);
  }
  for (let i = 0; i < 4; i++) {
    const h = 0.32 + (i % 3) * 0.15;
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.12 + i * 0.015, h, 5), basaltMats[i % basaltMats.length]);
    tooth.position.set(-0.75 + i * 0.5, floorY + 2.28 - (i % 2) * 0.12, z + 0.18);
    tooth.rotation.z = Math.PI;
    g.add(tooth);
  }
  return g;
}

function caveCrystalField(updaters: ExpeditionUpdater[]): THREE.Group {
  const g = new THREE.Group();
  const colors = ['#63d3d0', '#8094ed', '#76d2ad'];
  const mats = colors.map((color) => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.68, roughness: 0.26, metalness: 0.08, flatShading: true,
  }));
  const geo = new THREE.ConeGeometry(0.18, 1, 5);
  const clusters: Array<[number, number, number, number]> = [
    [2.15, -0.55, 1.25, 0], [-1.7, 3.0, 1.05, 1], [-2.25, -2.45, 0.9, 2],
    [-0.45, -2.0, 0.46, 0], [1.1, 1.65, 0.42, 1],
  ];
  const matrices: THREE.Matrix4[][] = [[], [], []];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  clusters.forEach(([x, z, size, variant]) => {
    const count = size > 0.7 ? 5 : 2;
    const baseY = expeditionHeight('cave', x, z) + 0.02;
    for (let i = 0; i < count; i++) {
      const h = size * (0.55 + (i % 3) * 0.25);
      position.set(x + (i - (count - 1) / 2) * size * 0.21, baseY + h / 2, z + Math.sin(i * 1.7) * size * 0.18);
      quaternion.setFromEuler(new THREE.Euler(0, i * 0.52, (i - 2) * 0.08));
      scale.set(size * (0.72 + i * 0.05), h, size * (0.72 + i * 0.05));
      matrices[(variant + i) % mats.length].push(matrix.compose(position, quaternion, scale).clone());
    }
  });
  matrices.forEach((instances, materialIndex) => {
    const crystals = new THREE.InstancedMesh(geo, mats[materialIndex], instances.length);
    instances.forEach((transform, i) => crystals.setMatrixAt(i, transform));
    crystals.instanceMatrix.needsUpdate = true;
    crystals.castShadow = false;
    g.add(crystals);
  });
  const glow = new THREE.PointLight('#61d4d0', 1.15, 8, 2);
  glow.position.set(2.15, expeditionHeight('cave', 2.15, -0.55) + 1.25, -0.55);
  glow.castShadow = false;
  g.add(glow);
  updaters.push((time) => {
    mats.forEach((mat, i) => { mat.emissiveIntensity = 0.64 + Math.sin(time * 1.15 + i * 1.8) * 0.1; });
    glow.intensity = 1.05 + Math.sin(time * 1.3) * 0.12;
  });
  return g;
}

function poiMesh(def: ExpeditionPoiDef, island: ExpeditionId, updaters: ExpeditionUpdater[]): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#7d5636', flatShading: true, roughness: 0.9 });
  const pale = new THREE.MeshStandardMaterial({ color: '#d4c69e', flatShading: true, roughness: 0.96 });
  const rock = new THREE.MeshStandardMaterial({ color: island === 'cave' ? '#55595c' : '#85847e', flatShading: true, roughness: 0.86 });
  const green = new THREE.MeshStandardMaterial({ color: '#4d8b50', flatShading: true, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: '#69757a', flatShading: true, roughness: 0.72, metalness: 0.25 });
  const rust = new THREE.MeshStandardMaterial({ color: '#9b5339', flatShading: true, roughness: 0.88, metalness: 0.12 });
  if (def.visual === 'seed') {
    for (let i = 0; i < 5; i++) {
      const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 + (i % 2) * 0.09, 0), green);
      cap.position.set((i - 2) * 0.32, 0.24 + (i % 2) * 0.16, Math.sin(i) * 0.35);
      g.add(cap);
    }
  } else if (def.visual === 'fungus') {
    const wet = new THREE.Mesh(
      new THREE.CircleGeometry(1.22, 22),
      new THREE.MeshStandardMaterial({ color: '#263f3e', transparent: true, opacity: 0.74, roughness: 0.28, depthWrite: false })
    );
    wet.rotation.x = -Math.PI / 2;
    wet.scale.z = 0.72;
    wet.position.y = 0.025;
    wet.userData.noShadow = true;
    g.add(wet);
    const stemMat = new THREE.MeshStandardMaterial({ color: '#b7afa0', roughness: 0.9, flatShading: true });
    const capMat = new THREE.MeshStandardMaterial({
      color: '#737b94', emissive: '#548f8b', emissiveIntensity: 0.28, roughness: 0.68, flatShading: true,
    });
    const stemGeo = new THREE.CylinderGeometry(0.045, 0.07, 1, 5);
    const capGeo = new THREE.SphereGeometry(0.2, 7, 4);
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, 8);
    const caps = new THREE.InstancedMesh(capGeo, capMat, 8);
    const transform = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      const a = i * 2.18;
      const h = 0.32 + (i % 4) * 0.13;
      const px = Math.cos(a) * (0.25 + (i % 3) * 0.24);
      const pz = Math.sin(a) * (0.22 + (i % 2) * 0.35);
      position.set(px, h / 2, pz);
      quaternion.identity();
      scale.set(1, h, 1);
      stems.setMatrixAt(i, transform.compose(position, quaternion, scale));
      const capSize = (0.18 + (i % 3) * 0.045) / 0.2;
      position.set(px, h + 0.035, pz);
      quaternion.setFromEuler(new THREE.Euler(0, a * 0.25, Math.sin(a) * 0.045));
      scale.set(capSize, capSize * 0.34, capSize);
      caps.setMatrixAt(i, transform.compose(position, quaternion, scale));
    }
    stems.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    stems.userData.noShadow = true;
    caps.userData.noShadow = true;
    g.add(stems, caps);
    updaters.push((time) => {
      capMat.emissiveIntensity = 0.24 + Math.sin(time * 1.05) * 0.06;
    });
  } else if (def.visual === 'hut') {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 1.8), wood); floor.position.y = 0.08; g.add(floor);
    for (const x of [-0.9, 0.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.5, 5), wood); post.position.set(x, 0.75, 0); g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.55, 0.7, 4), green); roof.position.y = 1.55; roof.rotation.y = Math.PI / 4; g.add(roof);
  } else if (def.visual === 'cistern') {
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), rock);
      s.position.set(Math.cos(a) * 0.9, 0.22, Math.sin(a) * 0.9); g.add(s);
    }
    const center = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.72, 0.08, 12), new THREE.MeshBasicMaterial({ color: '#54b8c4' }));
    center.position.y = 0.1; g.add(center);
  } else if (def.visual === 'hearth') {
    const hearthMatrix = new THREE.Matrix4();
    const hearthPosition = new THREE.Vector3();
    const hearthQuaternion = new THREE.Quaternion();
    const hearthScale = new THREE.Vector3();
    const ring = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.3, 0), rock, 8);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const size = (0.27 + (i % 2) * 0.035) / 0.3;
      hearthPosition.set(Math.cos(a) * 0.76, 0.18, Math.sin(a) * 0.76);
      hearthQuaternion.setFromEuler(new THREE.Euler(0, a, 0));
      hearthScale.setScalar(size);
      ring.setMatrixAt(i, hearthMatrix.compose(hearthPosition, hearthQuaternion, hearthScale));
    }
    ring.instanceMatrix.needsUpdate = true;
    g.add(ring);
    const charMat = new THREE.MeshStandardMaterial({ color: '#2b211d', roughness: 0.96, flatShading: true });
    for (const angle of [-0.72, 0.72]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.15, 6), charMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = angle;
      log.position.y = 0.18;
      g.add(log);
    }
    const emberMat = new THREE.MeshStandardMaterial({ color: '#c7552e', emissive: '#ff5b24', emissiveIntensity: 1.15, roughness: 0.68 });
    const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb13b', transparent: true, opacity: 0.88, depthWrite: false });
    const flames: THREE.Mesh[] = [];
    const embers = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.18, 0), emberMat, 3);
    for (let i = 0; i < 3; i++) {
      const emberSize = (0.17 + i * 0.025) / 0.18;
      hearthPosition.set((i - 1) * 0.2, 0.2, Math.sin(i * 2) * 0.12);
      hearthQuaternion.identity();
      hearthScale.setScalar(emberSize);
      embers.setMatrixAt(i, hearthMatrix.compose(hearthPosition, hearthQuaternion, hearthScale));
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16 - i * 0.025, 0.42 + i * 0.08, 5), flameMat);
      flame.position.set((i - 1) * 0.16, 0.48 + i * 0.04, Math.cos(i * 2) * 0.1);
      flame.userData.noShadow = true;
      flames.push(flame);
      g.add(flame);
    }
    embers.instanceMatrix.needsUpdate = true;
    embers.userData.noShadow = true;
    g.add(embers);
    const fireLight = new THREE.PointLight('#ff8b42', 1.1, 4.8, 2);
    fireLight.position.set(0, 1.05, 0);
    fireLight.castShadow = false;
    g.add(fireLight);
    updaters.push((time) => {
      const flicker = 0.9 + Math.sin(time * 8.1) * 0.09 + Math.sin(time * 13.7) * 0.045;
      fireLight.intensity = flicker;
      emberMat.emissiveIntensity = 1 + flicker * 0.2;
      flames.forEach((flame, i) => {
        flame.scale.y = 0.88 + Math.sin(time * (7.2 + i) + i) * 0.14;
        flame.rotation.y = time * (0.4 + i * 0.13);
      });
    });
  } else if (def.visual === 'wreck') {
    const supports = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.18, 1.22), wood);
    supports.position.y = 0.16;
    g.add(supports);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.66, 12), iron);
    drum.rotation.z = Math.PI / 2;
    drum.position.y = 0.68;
    g.add(drum);
    for (const x of [-0.44, 0.44]) {
      const gear = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.085, 6, 12), rust);
      gear.rotation.y = Math.PI / 2;
      gear.position.set(x, 0.68, 0);
      g.add(gear);
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.55, 7), rust);
    axle.rotation.z = Math.PI / 2;
    axle.position.y = 0.68;
    g.add(axle);
    const crank = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), rust);
    crank.position.set(0.83, 0.98, 0);
    crank.rotation.z = -0.55;
    g.add(crank);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.42, 6), wood);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(1.02, 1.28, 0.05);
    g.add(handle);
  } else if (def.visual === 'sail') {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 2.8, 7), wood);
    mast.position.y = 1.32;
    mast.rotation.z = -0.18;
    g.add(mast);
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 0.05, 1.9, 0, 1.45, 1.45, 0, 1.18, 0.42, 0,
    ], 3));
    sailGeo.setIndex([0, 1, 2, 0, 2, 3]);
    sailGeo.computeVertexNormals();
    const sailMat = new THREE.MeshStandardMaterial({
      color: '#d2c59c', roughness: 0.94, flatShading: true, side: THREE.DoubleSide,
    });
    const sail = new THREE.Mesh(sailGeo, sailMat);
    sail.position.set(0.03, 0.55, 0);
    sail.rotation.y = -0.34;
    sail.castShadow = true;
    g.add(sail);
    const tornGeo = new THREE.BufferGeometry();
    tornGeo.setAttribute('position', new THREE.Float32BufferAttribute([0.08, 1.05, 0.015, 0.12, 1.72, 0.015, -0.58, 1.42, 0.015], 3));
    tornGeo.setIndex([0, 1, 2]);
    tornGeo.computeVertexNormals();
    const torn = new THREE.Mesh(tornGeo, sailMat);
    torn.position.set(-0.02, 0.54, 0);
    torn.rotation.y = -0.3;
    g.add(torn);
    const ropeMat = new THREE.MeshStandardMaterial({ color: '#796649', roughness: 1 });
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.8, 5), ropeMat);
    rope.position.set(0.73, 1.32, 0.04);
    rope.rotation.z = -0.8;
    g.add(rope);
    updaters.push((time) => {
      sail.rotation.y = -0.34 + Math.sin(time * 1.1) * 0.035;
      torn.rotation.y = -0.3 + Math.sin(time * 1.25 + 0.7) * 0.055;
    });
  } else if (def.visual === 'crate') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.82, 1.05), wood);
    box.position.y = 0.42;
    g.add(box);
    for (const x of [-0.52, 0.52]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.88, 1.1), iron);
      band.position.set(x, 0.43, 0);
      g.add(band);
    }
    for (const angle of [-0.64, 0.64]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.09, 0.1), pale);
      brace.position.set(0, 0.43, 0.55);
      brace.rotation.z = angle;
      g.add(brace);
    }
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.13, 1.14), wood);
    lid.position.set(0, 0.9, -0.08);
    lid.rotation.x = -0.12;
    g.add(lid);
  } else {
    const face = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 0), rock);
    face.scale.set(1.45, 1.15, 0.72);
    face.position.set(0, 0.86, -0.05);
    face.rotation.set(0.08, -0.18, -0.12);
    g.add(face);
    const veinGeo = new THREE.BoxGeometry(0.12, 1, 0.065);
    const veins = new THREE.InstancedMesh(veinGeo, rust, 6);
    const veinMatrix = new THREE.Matrix4();
    const veinPosition = new THREE.Vector3();
    const veinQuaternion = new THREE.Quaternion();
    const veinScale = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      veinPosition.set(-0.62 + i * 0.25, 0.86 + Math.sin(i * 1.4) * 0.18, 0.7);
      veinQuaternion.setFromEuler(new THREE.Euler(0, 0, -0.55 + i * 0.17));
      veinScale.set((0.11 + (i % 2) * 0.04) / 0.12, 0.72 + (i % 3) * 0.2, 1);
      veins.setMatrixAt(i, veinMatrix.compose(veinPosition, veinQuaternion, veinScale));
    }
    veins.instanceMatrix.needsUpdate = true;
    g.add(veins);
    for (let i = 0; i < 3; i++) {
      const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + i * 0.055, 0), i % 2 ? rust : iron);
      ore.position.set(-0.72 + i * 0.65, 0.18, 0.55 + Math.sin(i) * 0.24);
      g.add(ore);
    }
  }
  g.position.set(def.x, expeditionHeight(island, def.x, def.z) + 0.02, def.z);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = o.userData.noShadow !== true; });
  return g;
}

function returnRaft(radius: number, id: ExpeditionId): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#895f3a', flatShading: true, roughness: 0.9 });
  for (let i = -2; i <= 2; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.5, 6), wood);
    log.rotation.z = Math.PI / 2; log.position.set(0, 0.18, i * 0.34); g.add(log);
  }
  const z = -radius + 2.4;
  g.position.set(0, Math.max(0.08, expeditionHeight(id, 0, z)), z);
  return g;
}

export interface ExpeditionPoi {
  def: ExpeditionPoiDef;
  group: THREE.Group;
  collected: boolean;
}

export interface ExpeditionWorld {
  group: THREE.Group;
  pois: ExpeditionPoi[];
  boat: THREE.Group;
  landing: { x: number; z: number };
  heightAt(x: number, z: number): number;
  update(time: number): void;
}

export function buildExpeditionWorld(id: ExpeditionId, collected: string[] = []): ExpeditionWorld {
  const def = EXPEDITIONS[id];
  const group = new THREE.Group();
  const updaters: ExpeditionUpdater[] = [];
  group.add(islandMesh(def));

  // 每座岛用少量强轮廓道具建立自己的身份，不复制主岛的资源森林。
  if (id === 'mangrove') {
    for (const [x, z, h] of [[-7, -1, 3.4], [6.5, -2, 4], [-2, 6.5, 3.2], [7, 4, 3.6]] as Array<[number, number, number]>) {
      group.add(mangroveTree(x, z, h, Math.round(x + z)));
    }
    for (const patch of [[-3.6, -1.8, 2.5, 1.5], [3.5, 5.1, 2, 1.2], [5.6, -4.7, 1.5, 0.9]] as Array<[number, number, number, number]>) {
      group.add(wetPatch(...patch));
    }
    for (let i = 0; i < 12; i++) {
      const a = i * 2.31, r = 4.6 + (i % 4) * 1.25;
      group.add(reedCluster(Math.cos(a) * r, Math.sin(a) * r, i));
    }
  } else if (id === 'reef') {
    group.add(reefWater(updaters));
    group.add(reefCoralGarden());
    group.add(wreckLandmark());
    const limestone = new THREE.MeshStandardMaterial({ color: '#8f8c80', flatShading: true, roughness: 0.94 });
    const wetStone = new THREE.MeshStandardMaterial({ color: '#667875', flatShading: true, roughness: 0.72 });
    const reefRocks: Array<[number, number, number, number]> = [
      [-7.7, -1.6, 0.9, 0], [-5.1, -5.5, 0.72, 1], [-2.2, 6.9, 0.8, 0],
      [4.4, -5.8, 0.66, 1], [7.2, 1.8, 0.92, 0], [5.6, 5.2, 0.58, 1],
      [-6.6, 4.5, 0.62, 1],
    ];
    for (const [x, z, size, wet] of reefRocks) {
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), wet ? wetStone : limestone);
      stone.position.set(x, expeditionHeight('reef', x, z) + size * 0.32, z);
      stone.scale.set(1.35, 0.58, 1);
      stone.rotation.y = x * 0.21;
      stone.castShadow = size > 0.7;
      group.add(stone);
    }
    // 登陆木筏到沉船之间的碎板构成一条自然引导线。
    const driftwood = new THREE.MeshStandardMaterial({ color: '#806b52', flatShading: true, roughness: 0.98 });
    for (let i = 0; i < 5; i++) {
      const x = -0.25 - i * 0.25;
      const z = -5.7 + i * 0.78;
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.065, 1.05 - i * 0.07), driftwood);
      board.position.set(x, expeditionHeight('reef', x, z) + 0.06, z);
      board.rotation.y = -0.35 + i * 0.13;
      board.castShadow = false;
      group.add(board);
    }
  } else {
    group.add(caveEntrance());
    group.add(caveCrystalField(updaters));
    for (const cluster of [
      [-6.6, 2.8, [1.1, 1.8, 2.35, 1.45], 0],
      [6.4, -0.8, [0.85, 1.4, 2.05, 1.15], 1],
      [-5.2, -4.4, [0.7, 1.25, 1.7], 2],
      [5.4, 5.3, [1.0, 1.65, 2.2, 1.3], 3],
    ] as Array<[number, number, number[], number]>) {
      group.add(basaltCluster(...cluster));
    }
    const pathMat = new THREE.MeshStandardMaterial({ color: '#58605d', flatShading: true, roughness: 0.94 });
    const path: Array<[number, number, number]> = [
      [-0.55, -6.3, 0.38], [-0.2, -3.5, 0.32], [-1.05, -1.65, 0.4],
      [-0.15, 0.15, 0.34], [0.8, 1.55, 0.38], [0.35, 2.85, 0.3],
    ];
    const pathMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.08, 0.11, 6), pathMat, path.length);
    const pathMatrix = new THREE.Matrix4();
    const pathPosition = new THREE.Vector3();
    const pathQuaternion = new THREE.Quaternion();
    const pathScale = new THREE.Vector3();
    path.forEach(([x, z, size], i) => {
      pathPosition.set(x, expeditionHeight('cave', x, z) + 0.055, z);
      pathQuaternion.setFromEuler(new THREE.Euler(0, x + z, 0));
      pathScale.set(size, 1, size * 0.76);
      pathMesh.setMatrixAt(i, pathMatrix.compose(pathPosition, pathQuaternion, pathScale));
    });
    pathMesh.instanceMatrix.needsUpdate = true;
    pathMesh.receiveShadow = true;
    group.add(pathMesh);
    const dampMat = new THREE.MeshStandardMaterial({
      color: '#273d3d', transparent: true, opacity: 0.46, depthWrite: false, roughness: 0.3,
    });
    for (const [x, z, sx, sz] of [[-0.8, -1.0, 0.8, 0.4], [0.35, 1.4, 0.62, 0.32], [0, 3.35, 0.86, 0.35]] as Array<[number, number, number, number]>) {
      const damp = new THREE.Mesh(new THREE.CircleGeometry(1, 18), dampMat);
      damp.rotation.x = -Math.PI / 2;
      damp.scale.set(sx, sz, 1);
      damp.position.set(x, expeditionHeight('cave', x, z) + 0.045, z);
      damp.renderOrder = 3;
      group.add(damp);
    }
  }

  const pois = def.pois.map((poi) => {
    const p = { def: poi, group: poiMesh(poi, id, updaters), collected: collected.includes(poi.id) };
    p.group.visible = !p.collected;
    group.add(p.group);
    return p;
  });
  const boat = returnRaft(def.radius, id);
  group.add(boat);
  const landing = { x: 0, z: -def.radius + 4.2 };
  return {
    group, pois, boat, landing,
    heightAt: (x, z) => expeditionHeight(id, x, z),
    update(time) { for (const updater of updaters) updater(time); },
  };
}
