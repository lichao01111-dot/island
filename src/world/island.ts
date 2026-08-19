// 小岛地形与海面。
// 风格是低多边形,但"低多边形"不等于"一整块纯色":平面着色负责硬朗的块面,
// 顶点色负责块面里的信息量。这里的重点全在后者 —— 地面占了画面六成,
// 它有多少层次,画面就有多少质感。
import * as THREE from 'three';
import { fbm, fbmSigned } from './noise';

export const ISLAND_RADIUS = 38;

// 海湾:把海岸线在某个方向上往里切一刀。
// 有了凹进去的岸,才会有"从外面看不见里面"的地方 —— 这是探索感最便宜的来源
const COVE_ANGLE = -2.05;
const COVE_WIDTH = 0.5;
const COVE_DEPTH = 10.5;

function coveFactor(angle: number): number {
  let d = angle - COVE_ANGLE;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.exp(-((d / COVE_WIDTH) ** 2));
}

// 多频轮廓噪声:海岸不再是几何正圆。保持确定性,存档与建造坐标不会因刷新漂移。
export function coastRadius(angle: number): number {
  return ISLAND_RADIUS
    + Math.sin(angle * 3 + 0.7) * 2.4
    + Math.sin(angle * 7 - 1.2) * 1.2
    + Math.sin(angle * 13 + 2.1) * 0.5
    - coveFactor(angle) * COVE_DEPTH;
}

// 山脊:一条蜿蜒的高地,把岛分成两侧。
// 这是整个地形里唯一真正制造"遮挡"的东西 —— 原来的地形是个处处外凸的穹顶,
// 数学上保证了站在任何一点都能看见其它所有点,所以无论岛做多大,探索性都是零。
const RIDGE_ANGLE = 0.85;
const RIDGE_SIN = Math.sin(RIDGE_ANGLE);
const RIDGE_COS = Math.cos(RIDGE_ANGLE);

function ridgeHeight(x: number, z: number): number {
  // 到山脊中轴线的垂距与沿线距离
  const along = x * RIDGE_COS + z * RIDGE_SIN;
  let perp = -x * RIDGE_SIN + z * RIDGE_COS;
  // 让脊线蜿蜒:笔直的山脊一眼就是人造的
  perp += fbmSigned(along * 0.055 + 11.3, 3.7, 2) * 7.5;
  const spine = Math.exp(-((perp / 9.5) ** 2)) * 7.2;
  // 沿线两端收口,山脊不会一路冲进海里
  const taper = Math.exp(-((along / 26) ** 2));
  return spine * taper;
}

/**
 * 岛屿高度场。
 * 组成:包络(保证边缘入水) × (基础隆起 + 山脊 + 大尺度起伏) + 细节。
 * 关键是那个"大尺度起伏"的振幅要足够大 —— 山谷比人高,才会挡住视线。
 */
export function islandHeight(x: number, z: number): number {
  const angle = Math.atan2(z, x);
  const radial = Math.hypot(x, z);
  const d = radial / coastRadius(angle);
  if (d >= 1.05) return -2.6;                 // 岛外压到水下
  // 包络:中心 1 → 边缘 0。所有隆起都乘它,岸边才一定会落进水里
  const envelope = Math.cos(Math.min(1, d) * Math.PI * 0.5);
  // 大尺度起伏:约 20 米一个丘谷 —— 这是遮挡的主力。
  // 振幅必须小于基础隆起,否则谷底会被推到海平面以下,岛中央凭空出现一片"沙滩"
  const relief = fbmSigned(x * 0.05 + 4.2, z * 0.05 - 2.8, 4) * 3.4;
  // 中尺度:约 7 米,给坡面加变化,免得丘陵是一个个规整的包
  const mid = fbmSigned(x * 0.14 - 6.1, z * 0.14 + 9.4, 3) * 1.3;
  const body = (4.4 + ridgeHeight(x, z) + relief + mid) * envelope;
  // 细节起伏:地表本身的不平整,否则轮廓线和高光会暴露它是个光滑的数学曲面。
  // 乘 shore 让它在水线附近收敛,免得沙滩坑洼影响码头选址判定
  const shore = Math.min(1, envelope * 2.2);
  const detail = fbmSigned(x * 0.26, z * 0.26, 3) * 0.30 + fbmSigned(x * 0.74, z * 0.74, 2) * 0.085;
  return body - 0.35 + detail * shore;
}

/**
 * 真正的水线半径(h = 0 处)。
 * 注意它不等于 coastRadius:coastRadius 是高度场的归一化分母,
 * 而地形在 d ≈ 0.95 就已经落到水面。浪花必须贴着水线,差这 5% 就会整条飘在开阔水面上。
 */
export function waterlineRadius(angle: number): number {
  const base = coastRadius(angle);
  let lo = base * 0.74;   // 一定在水上
  let hi = base * 1.06;   // 一定在水下
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) * 0.5;
    if (islandHeight(Math.cos(angle) * mid, Math.sin(angle) * mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) * 0.5;
}

// 坡度与环境光遮蔽都从"已经算好的顶点高度网格"里取邻居,而不是再去采样高度场。
// 岛放大之后顶点数到两万多,每个顶点再补 18 次 islandHeight(每次十几个噪声八度)
// 会让启动卡上好几秒 —— 而这些邻居的高度本来就已经算过了。

// 地面颜色要先读成几块安静的大区域,再在近处看到少量变化。
// 颜色本身也略微收灰:树冠已经承担了画面里最浓的绿色,地面不该和它争饱和度。
const C_SAND_WET = new THREE.Color('#9d8a68');
const C_SAND = new THREE.Color('#dac99f');
const C_SAND_DRY = new THREE.Color('#eee2c2');
const C_GRASS_DRY = new THREE.Color('#929a61');
const C_GRASS = new THREE.Color('#668b50');
const C_GRASS_LUSH = new THREE.Color('#477647');
const C_DIRT = new THREE.Color('#80674d');
const C_ROCK = new THREE.Color('#908a80');
const colorTmp = new THREE.Color();
const grassTmp = new THREE.Color();

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 地表颜色。分四层叠:
 *   1. 沙 → 草的高度带,边界被噪声打乱(直的植被线一眼假)
 *   2. 干草 ↔ 湿草的大尺度分区(哪片向阳、哪片背阴)
 *   3. 陡坡露土、峰顶露岩
 *   4. 很轻的微变化 + 柔和环境光遮蔽
 */
function terrainColor(h: number, x: number, z: number, slope: number, ao: number): THREE.Color {
  // 三个尺度刻意拉开。旧版把 0.2 / 0.7 两层强噪声同时铺满地表,
  // 顶点色会把径向三角网格也显出来,远景因此像一层脏滤镜。
  const moisture = fbm(x * 0.035 + 8.4, z * 0.035 - 4.7, 3); // 约 30 米的大区
  const patch = fbm(x * 0.105 - 3.1, z * 0.105 + 6.8, 2);    // 约 9 米的过渡
  const micro = fbm(x * 0.32 + 1.7, z * 0.32 - 2.6, 2) - 0.5; // 只留一点近景变化

  // 1. 沙滩:湿沙 → 干沙 → 晒白的沙脊。
  // 湿沙带要窄而深:潮线是海岸上对比最强的一条线,拉宽反而会糊掉
  colorTmp.copy(C_SAND_WET).lerp(C_SAND, smoothstep(0.02, 0.62, h));
  colorTmp.lerp(C_SAND_DRY, smoothstep(0.58, 1.16, h) * (0.24 + patch * 0.28));

  // 2. 沙 → 草:边界按噪声上下浮动,海岸植被线因此是犬牙交错的。
  // 基准抬到 1.1 是为了让沙滩有约 4 米宽 —— 之前只有一条边,读不出"这是海滩"
  const vegLine = 1.08 + (moisture - 0.5) * 0.58 + (patch - 0.5) * 0.28 + micro * 0.08;
  const grassAmount = smoothstep(vegLine - 0.24, vegLine + 0.56, h);
  grassTmp.copy(C_GRASS_DRY).lerp(C_GRASS, smoothstep(0.34, 0.67, moisture));
  // 浓绿只成为大区里的局部重心,不再把每个中尺度噪声峰都染成深斑。
  grassTmp.lerp(C_GRASS_LUSH, smoothstep(0.58, 0.8, patch) * 0.48);
  colorTmp.lerp(grassTmp, grassAmount);

  // 3. 陡坡留不住土壤 → 露出泥土;山脊高处露岩。
  // 阈值跟着新的高度范围抬到 10.5~14:那正好是山脊顶,岩石因此成了山脊的识别色
  // slope 这里不再归一到 0..1,而是"每米落差"的原始梯度:
  // 新地形的典型缓坡就有 0.3~0.5,只有真正的陡坎才会超过 0.9
  colorTmp.lerp(C_DIRT, smoothstep(0.85, 1.5, slope) * grassAmount * 0.8);
  colorTmp.lerp(C_ROCK, smoothstep(10.5, 14, h) * smoothstep(0.45, 0.95, slope));

  // 微变化只动很小的明度,AO 也压低幅度。真正的体积交给太阳阴影,
  // 避免顶点色 AO 和实时阴影叠加成大片黑斑。
  colorTmp.multiplyScalar(1 + micro * 0.065);
  const shade = 1 - smoothstep(0.08, 0.78, ao) * 0.26;
  colorTmp.multiplyScalar(shade);
  return colorTmp;
}

// ---- 贴岸浅水与浪花 ----
// 两者共用同一圈真实水线采样,既省掉重复的二分查找,也保证浅水、浪花不会互相错位。
const SHORE_SEGMENTS = 220;
let shorelineCache: Float32Array | null = null;

function shorelineSamples(): Float32Array {
  if (shorelineCache) return shorelineCache;
  shorelineCache = new Float32Array(SHORE_SEGMENTS + 1);
  for (let i = 0; i <= SHORE_SEGMENTS; i++) {
    shorelineCache[i] = waterlineRadius((i / SHORE_SEGMENTS) * Math.PI * 2);
  }
  return shorelineCache;
}

/** 周期完全闭合的海岸扰动,0 与 2π 必须一致,否则接缝处会裂开。 */
function shoreVariation(a: number, phase = 0): number {
  return Math.sin(a * 3 + phase) * 0.5
    + Math.sin(a * 7 - phase * 0.7) * 0.3
    + Math.sin(a * 13 + phase * 1.3) * 0.2;
}

function buildShallows(): THREE.Mesh {
  const bands = 4;
  const shoreline = shorelineSamples();
  const positions: number[] = [];
  const colors: number[] = [];
  const fades: number[] = [];
  const near = new THREE.Color('#78d9cb');
  const far = new THREE.Color('#45b7c7');
  const tint = new THREE.Color();

  for (let band = 0; band <= bands; band++) {
    const t = band / bands;
    // 内外两边都淡出,海岸上没有硬切线,外圈也不再是一只完美的青色圆盘。
    const fade = smoothstep(0, 0.18, t) * (1 - smoothstep(0.54, 1, t));
    for (let i = 0; i <= SHORE_SEGMENTS; i++) {
      const a = (i / SHORE_SEGMENTS) * Math.PI * 2;
      const width = 4.15 + shoreVariation(a, 0.8) * 0.72;
      const r = shoreline[i] - 0.22 + width * t;
      positions.push(Math.cos(a) * r, 0.105 + Math.sin(a * 9) * 0.004, Math.sin(a) * r);
      tint.copy(near).lerp(far, t * 0.72);
      colors.push(tint.r, tint.g, tint.b);
      fades.push(fade);
    }
  }

  const indices: number[] = [];
  const stride = SHORE_SEGMENTS + 1;
  for (let band = 0; band < bands; band++) {
    for (let i = 0; i < SHORE_SEGMENTS; i++) {
      const a = band * stride + i;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aShallowFade', new THREE.Float32BufferAttribute(fades, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true, transparent: true, opacity: 0.34, depthWrite: false,
    roughness: 0.2, metalness: 0, clearcoat: 0.42, clearcoatRoughness: 0.3,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aShallowFade;\nvarying float vShallowFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShallowFade = aShallowFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShallowFade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vShallowFade;');
  };
  material.customProgramCacheKey = () => 'island-shallows-v2';

  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 2;
  return mesh;
}

let foamTime: { value: number } | null = null;

function buildFoam(): THREE.Mesh {
  const shoreline = shorelineSamples();
  const positions: number[] = [];
  const colors: number[] = [];
  const foamMeta: number[] = []; // angle,静态 alpha,层号
  const indices: number[] = [];

  // 同一个 mesh 内放两道浪:贴沙滩的宽回洗 + 外侧较窄的碎浪,仍然只占一次 draw call。
  for (let layer = 0; layer < 2; layer++) {
    const start = positions.length / 3;
    for (let i = 0; i <= SHORE_SEGMENTS; i++) {
      const a = (i / SHORE_SEGMENTS) * Math.PI * 2;
      const shape = shoreVariation(a, layer ? 2.4 : 0.15);
      const brokenSignal = shoreVariation(a, layer ? 4.1 : 1.9);
      // 低于阈值的整段 alpha 真正归零,不再残留一条环绕全岛的白线。
      const broken = smoothstep(-0.18, 0.34, brokenSignal);
      const inner = shoreline[i] + (layer ? 1.05 : -0.42) + shape * (layer ? 0.18 : 0.3);
      const outer = inner + (layer ? 0.72 : 1.22) + Math.sin(a * (layer ? 11 : 9) + layer) * 0.1;
      const ix = Math.cos(a) * inner;
      const iz = Math.sin(a) * inner;
      const innerY = layer ? 0.145 : Math.max(0.115, islandHeight(ix, iz) + 0.055);
      const outerY = layer ? 0.13 : 0.125;
      positions.push(ix, innerY, iz, Math.cos(a) * outer, outerY, Math.sin(a) * outer);
      const c = layer ? [0.89, 0.97, 0.98] : [0.97, 0.99, 0.96];
      colors.push(...c, ...c);
      foamMeta.push(a, broken * (layer ? 0.42 : 0.72), layer);
      foamMeta.push(a, broken * (layer ? 0.05 : 0.14), layer);
    }
    for (let i = 0; i < SHORE_SEGMENTS; i++) {
      const a = start + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foamMeta, 3));
  geo.setIndex(indices);

  foamTime = { value: 0 };
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.94, depthWrite: false,
    side: THREE.DoubleSide, alphaTest: 0.012,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFoamTime = foamTime!;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uFoamTime;
        attribute vec3 aFoam;
        varying float vFoamAlpha;
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float foamWave = sin(aFoam.x * 5.0 - uFoamTime * (0.78 + aFoam.z * 0.2)) * 0.5
          + sin(aFoam.x * 11.0 + uFoamTime * (1.16 + aFoam.z * 0.12)) * 0.28 + 0.12;
        float foamPulse = smoothstep(-0.2, 0.56, foamWave);
        vFoamAlpha = aFoam.y * mix(0.18, 1.0, foamPulse);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFoamAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFoamAlpha;');
  };
  material.customProgramCacheKey = () => 'island-layered-foam-v2';

  const mesh = new THREE.Mesh(geo, material);
  // 海面也是半透明的,不指定顺序时两者按距离排序,浪花会被海面盖住
  mesh.renderOrder = 3;
  return mesh;
}

/** 让浪花沿海岸行进。由主循环每帧调用 */
export function updateShore(t: number): void {
  if (foamTime) foamTime.value = t;
}

// ---- 云影:大团软云在地面缓慢漂移 ----
// 纯程序化,不贴图、不碰光照结构。地形着色器里按世界坐标采样 fbm,
// "云下"区域 soft 压暗一点点 —— 这是画面"活起来"的关键一层。
let cloudTime: { value: number } | null = null;
let cloudStrength: { value: number } | null = null;

// 程序化云噪声:两三次 value-noise fbm,再用 smoothstep 切成大团软云
const CLOUD_GLSL = /* glsl */`
  float cloudHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float cloudValue(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = cloudHash(i);
    float b = cloudHash(i + vec2(1.0, 0.0));
    float c = cloudHash(i + vec2(0.0, 1.0));
    float d = cloudHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float cloudFbm(vec2 p) {
    return cloudValue(p) * 0.62 + cloudValue(p * 2.13) * 0.27 + cloudValue(p * 4.31) * 0.11;
  }
`;

/** 云影推进。由主循环每帧调用 */
export function updateCloudShadow(t: number): void {
  if (cloudTime) cloudTime.value = t;
}

/** 云影强度(0 关,默认 0.14),实时可调 */
export function setCloudShadow(strength: number): void {
  if (cloudStrength) cloudStrength.value = strength;
}

export function buildIsland(): THREE.Group {
  const group = new THREE.Group();

  // 分辨率决定顶点色能承载多少细节:每格约 1.1 米时细颗粒噪声才看得见。
  // 岛半径从 26 到 38,分段数要跟着涨,否则等于把细节稀释掉一半。
  const segments = 232;
  const rings = 104;
  const radius = ISLAND_RADIUS + 5;

  // ---- 第一遍:只算高度,存成极坐标网格 ----
  // ring 0 是圆心,之后每圈 segments 个点。索引:ring 0 → 0;ring>=1 → 1+(ring-1)*segments+i
  const idx = (ring: number, i: number): number =>
    ring === 0 ? 0 : 1 + (ring - 1) * segments + ((i % segments) + segments) % segments;
  const total = 1 + rings * segments;
  const hs = new Float32Array(total);
  const xs = new Float32Array(total);
  const zs = new Float32Array(total);
  hs[0] = islandHeight(0, 0);
  for (let ring = 1; ring <= rings; ring++) {
    // 近岸加密:海岸线是细节最密集、也最容易穿帮的地方
    const r = radius * Math.pow(ring / rings, 0.86);
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const k = idx(ring, i);
      xs[k] = x; zs[k] = z; hs[k] = islandHeight(x, z);
    }
  }

  // 从网格邻居估坡度与遮蔽:高度都已经算过了,这里只是查表
  const NEIGHBORS: Array<[number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2],
  ];
  // 坡度取最近四邻的平均陡峭度(不是最大值):用最大值会被单个尖角带偏,
  // 整片缓坡也会被判成陡坡。遮蔽则用全部邻居里"比自己高"的部分。
  // 两者的系数都按新地形重新标定过 —— 旧地形最高才 4.5 米,同一套阈值搬过来
  // 会让坡度普遍饱和,结果就是满屏裸土 + 全局压暗。
  const shade = (ring: number, i: number): { slope: number; ao: number } => {
    const k = idx(ring, i);
    const h = hs[k];
    let occ = 0;
    let steep = 0;
    let near = 0;
    let used = 0;
    for (let n = 0; n < NEIGHBORS.length; n++) {
      const [dr, di] = NEIGHBORS[n];
      const r2 = ring + dr;
      if (r2 < 0 || r2 > rings) continue;
      const k2 = idx(r2, i + di);
      const dist = Math.hypot(xs[k2] - xs[k], zs[k2] - zs[k]) || 1;
      const rise = (hs[k2] - h) / dist;
      occ += Math.max(0, rise);
      used++;
      if (n < 4) { steep += Math.abs(rise); near++; }
    }
    return {
      slope: steep / Math.max(1, near),
      ao: Math.min(1, (occ / Math.max(1, used)) * 1.05),
    };
  };

  // ---- 第二遍:写顶点与颜色 ----
  const vertices: number[] = [0, hs[0], 0];
  const colors: number[] = [];
  const s0 = shade(0, 0);
  const c0 = terrainColor(hs[0], 0, 0, s0.slope, s0.ao);
  colors.push(c0.r, c0.g, c0.b);
  for (let ring = 1; ring <= rings; ring++) {
    for (let i = 0; i < segments; i++) {
      const k = idx(ring, i);
      vertices.push(xs[k], hs[k], zs[k]);
      const s = shade(ring, i);
      const c = terrainColor(hs[k], xs[k], zs[k], s.slope, s.ao);
      colors.push(c.r, c.g, c.b);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) indices.push(0, 1 + ((i + 1) % segments), 1 + i);
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
  geo.setIndex(indices);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const landMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
    dithering: true,
  });
  // 云影注入:顶点传世界坐标,片元采样程序化云噪声压暗
  cloudTime = { value: 0 };
  cloudStrength = { value: 0.14 };
  landMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uCloudTime = cloudTime!;
    shader.uniforms.uCloudStrength = cloudStrength!;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CLOUD_GLSL}\nvarying vec2 vCloudUv;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvCloudUv = worldPosition.xz * 0.05;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLOUD_GLSL}\nvarying vec2 vCloudUv;\nuniform float uCloudTime;\nuniform float uCloudStrength;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 cloudUv = vCloudUv + vec2(uCloudTime * 0.012, uCloudTime * 0.007);
        float cloud = smoothstep(0.42, 0.68, cloudFbm(cloudUv));
        diffuseColor.rgb *= 1.0 - cloud * uCloudStrength;`);
  };
  landMaterial.customProgramCacheKey = () => 'island-terrain-cloudshadow-v1';
  const land = new THREE.Mesh(geo, landMaterial);
  land.receiveShadow = true;
  land.castShadow = true;   // 地形自己也投影:山脊在缓坡上的影子是体积感的来源
  group.add(land);

  // 浅水只沿真实水线生成,不再用一张正圆形面片套住整座岛。
  group.add(buildShallows());
  group.add(buildFoam());

  return group;
}

// 海面:径向网格 + 深度渐变顶点色 + 起伏波浪
// 热带海水:近岸浅绿松石 → 中段亮青 → 远处才转深蓝
const C_WATER_SHALLOW = new THREE.Color('#7fe3d8');
const C_WATER_MID = new THREE.Color('#3fbfd6');
const C_WATER_DEEP = new THREE.Color('#20699e');
const waterTmp = new THREE.Color();

export interface Ocean {
  mesh: THREE.Mesh;
  update(t: number): void;
  /** 菲涅耳掠射角要反射天空,天空颜色变了就得跟着变,否则夜里海面会亮得像白天 */
  setSkyTint(color: THREE.Color): void;
  /** 开阔海面浪尖白沫强度(0 关,默认 0.6),实时可调 */
  setWhitecap(strength: number): void;
}

export function buildOcean(): Ocean {
  const segments = 96;
  const rings = 34;
  const maxRadius = 260;
  const vertices: number[] = [0, 0, 0];
  const colors: number[] = [];

  const waterColor = (r: number): THREE.Color => {
    const c = waterTmp.copy(C_WATER_SHALLOW);
    c.lerp(C_WATER_MID, smoothstep(ISLAND_RADIUS - 3, ISLAND_RADIUS + 16, r));
    c.lerp(C_WATER_DEEP, smoothstep(ISLAND_RADIUS + 55, ISLAND_RADIUS + 150, r));
    return c;
  };
  const first = waterColor(0);
  colors.push(first.r, first.g, first.b);

  for (let ring = 1; ring <= rings; ring++) {
    const t = ring / rings;
    const r = maxRadius * Math.pow(t, 2.4);
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      vertices.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      const c = waterColor(r);
      colors.push(c.r, c.g, c.b);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < segments; i++) indices.push(0, 1 + ((i + 1) % segments), 1 + i);
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

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, opacity: 0.95,
    roughness: 0.16, metalness: 0.05,
    emissive: new THREE.Color('#0b3342'), emissiveIntensity: 0.16,
    dithering: true,
  });

  // 大波位移、法线和微波纹全放到 shader。主线程每帧只改一个时间 uniform,
  // 不再上传整张顶点缓冲并同步重算法线。
  const skyTint = { value: new THREE.Color('#cfeaf6') };
  const waterTime = { value: 0 };
  const whitecapStrength = { value: 0.6 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSkyTint = skyTint;
    shader.uniforms.uWaterTime = waterTime;
    shader.uniforms.uWhitecapStrength = whitecapStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uWaterTime;
        varying vec3 vWaterWorld;
        varying float vWhitecap;

        float islandWaterAmp(vec2 p) {
          return mix(0.055, 0.36, smoothstep(26.0, 86.0, length(p)));
        }
        float islandWaterHeight(vec2 p, float t) {
          float amp = islandWaterAmp(p);
          return sin(p.x * 0.075 + t * 1.05) * amp
            + sin(p.y * 0.058 - t * 0.78) * amp * 0.8
            + sin((p.x + p.y) * 0.17 + t * 1.9) * amp * 0.28;
        }
        vec2 islandWaterSlope(vec2 p, float t) {
          float amp = islandWaterAmp(p);
          float diagonal = cos((p.x + p.y) * 0.17 + t * 1.9) * amp * 0.28 * 0.17;
          return vec2(
            cos(p.x * 0.075 + t * 1.05) * amp * 0.075 + diagonal,
            cos(p.y * 0.058 - t * 0.78) * amp * 0.8 * 0.058 + diagonal
          );
        }
      `)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec2 waterSlope = islandWaterSlope(position.xz, uWaterTime);
        objectNormal = normalize(vec3(-waterSlope.x, 1.0, -waterSlope.y));
        // 白沫:浪陡 + 处于浪尖(高度为正)才起沫;近岸振幅小、自然不起沫
        float waterSteep = length(waterSlope);
        float waterH = islandWaterHeight(position.xz, uWaterTime);
        vWhitecap = smoothstep(0.03, 0.055, waterSteep) * smoothstep(0.04, 0.12, waterH);
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y += islandWaterHeight(position.xz, uWaterTime);
        vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSkyTint;
        uniform float uWaterTime;
        uniform float uWhitecapStrength;
        varying vec3 vWaterWorld;
        varying float vWhitecap;
      `)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // 高频细浪只扰动法线,不增加网格密度。两组不同方向避免棋盘状重复。
        vec2 wp = vWaterWorld.xz;
        vec2 microSlope = vec2(
          cos(wp.x * 0.43 + wp.y * 0.17 + uWaterTime * 1.72),
          cos(wp.y * 0.37 - wp.x * 0.14 - uWaterTime * 1.28)
        ) * 0.115;
        vec3 microNormal = normalize(mat3(viewMatrix) * vec3(-microSlope.x, 1.0, -microSlope.y));
        normal = normalize(mix(normal, microNormal, 0.24));

        float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
        float shimmer = 0.5 + 0.25 * sin(wp.x * 0.31 + uWaterTime * 0.9)
          + 0.25 * sin(wp.y * 0.27 - uWaterTime * 0.72);
        float reflection = clamp(fres * (0.48 + shimmer * 0.18), 0.0, 0.72);
        diffuseColor.rgb *= mix(0.72, 1.02, fres);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSkyTint, reflection);
        diffuseColor.rgb += uSkyTint * (0.01 * shimmer * (0.25 + fres));
        // 浪尖白沫:叠在反射之上,才像真的泡沫而不是被染色
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.98, 1.0), clamp(vWhitecap, 0.0, 1.0) * uWhitecapStrength);
        `
      );
  };
  material.customProgramCacheKey = () => 'island-ocean-water-v4';

  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 1;   // 先海面,再浅水,最后浪花

  return {
    mesh,
    setSkyTint(color: THREE.Color) { skyTint.value.copy(color); },
    setWhitecap(strength: number) { whitecapStrength.value = strength; },
    update(t: number) {
      waterTime.value = t;
    },
  };
}
