// 岛上可采集资源:椰子树(木材/椰子)、灌木(纤维)、石头(石料)
// 全部用基础几何体拼卡通造型,低面数 + flatShading
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ISLAND_RADIUS, islandHeight, waterlineRadius } from './island';
import { rng } from './rng';
import { fbm } from './noise';
import { instantiate } from './assets';
import { createStylizedMaterial, ROCK_RIM, VEGETATION_RIM } from '../game/material';

export type ResourceKind = 'wood' | 'fiber' | 'stone';

export interface Harvestable {
  mesh: THREE.Group;
  visual: THREE.Group;   // 可随风摆动的可见部分；接地阴影留在 mesh 上保持贴地
  kind: ResourceKind;
  hp: number;          // 剩余可采次数
  x: number; z: number;
  respawnAt: number;   // 0 = 存活
  swayPhase: number;
}

// ---- 共享几何体 ----
// 树/灌木/石头现在各自把所有部件合并成一个网格、用顶点色区分,
// 所以不再需要共享的"叶团/石块"几何体和材质池;只剩接地阴影这一个真正共用的面片。
const GEO = {
  contact: new THREE.PlaneGeometry(2, 2),           // 配径向渐变贴图,不能再用圆片
};

// 植被用顶点色而非材质池(整株合并成一个网格),所以这里存的是颜色不是材质。
// 叶色比原来降了饱和度:地表已经从塑料绿改成了自然的黄橄榄—深绿区间,
// 树冠还留在高饱和度上的话,两者会像贴在一起的两张不同的画
const colorPool = (hex: string[]): THREE.Color[] => hex.map((c) => new THREE.Color(c));
const LEAF_COLORS = colorPool(['#3d7a45', '#488c4e', '#356b3e', '#54a05a', '#2f6b3d', '#5fa862']);
const TRUNK_COLORS = colorPool(['#8e6039', '#9c6b42', '#a8794d', '#7d5433']);
const TRUNK_RING = new THREE.Color('#6d4a2c');
const COCONUT_COLORS = colorPool(['#6b4a2f', '#7a5636']);
// 灌木同样改成顶点色:一丛里要有顶亮底暗的色阶,单一材质做不到
const BUSH_COLORS = colorPool(['#4f9a4a', '#458c46', '#5aa64d', '#3d7f42', '#57a052']);
const BERRY_COLORS = colorPool(['#c94a63', '#d15c54', '#b83f58']);
const ROCK_COLORS = colorPool(['#8f8b86', '#7d837f', '#96876f', '#83807a']);
const MOSS_COLORS = colorPool(['#5c7a3e', '#4f6d38', '#688545']);
// 石头比植被更粗糙、几乎不反光
const ROCK_MAT = createStylizedMaterial({
  vertexColors: true, roughness: 0.97, rim: ROCK_RIM,
});
// 接地阴影。原来是一个等浓度的暗椭圆,边缘一刀切,反而更像贴纸。
// 换成径向渐变贴图:中心浓、边缘化开,物体才像"长在地上"而不是"摆在地上"。
function contactShadowTexture(): THREE.Texture | null {
  // 测试在 Node 里直接调用 scatterResources,那里没有 canvas。
  // 阴影贴图只影响观感,拿不到就退回纯色,不该让整套测试跑不起来
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // 中段衰减放慢一点,边缘再快速收掉,接近真实软阴影的半影分布
  grad.addColorStop(0, 'rgba(20,44,28,0.38)');
  grad.addColorStop(0.45, 'rgba(20,44,28,0.2)');
  grad.addColorStop(0.75, 'rgba(20,44,28,0.06)');
  grad.addColorStop(1, 'rgba(20,44,28,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 惰性创建:贴图要用 canvas,而这个模块会被 Node 里的测试直接 import
let contactMat: THREE.MeshBasicMaterial | null = null;
function contactMaterial(): THREE.MeshBasicMaterial {
  if (!contactMat) {
    const map = contactShadowTexture();
    contactMat = new THREE.MeshBasicMaterial({
      map, color: map ? 0xffffff : 0x173522,
      opacity: map ? 1 : 0.14,
      transparent: true, depthWrite: false,
    });
  }
  return contactMat;
}

const pick = <T>(arr: T[]): T => arr[(Math.random() * arr.length) | 0];

/**
 * 合并几何体,失败时说清楚是谁失败了。
 * three 只会打印"index N 属性数量不一致",不告诉你是哪一批 —— 而失败是静默的:
 * 返回 null 之后调用方通常回退到 parts[0],于是整棵树只剩一节树干还没人报警。
 */
function mergeLabeled(parts: THREE.BufferGeometry[], label: string): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (merged) return merged;
  const shapes = parts.map((p) => Object.keys(p.attributes).sort().join('+'));
  console.error(`[island] 合并「${label}」失败,各部件属性: ${[...new Set(shapes)].join(' | ')}`);
  return parts[0];
}

// 椰子树。整株合并成一个几何体、用顶点色代替材质池:
// 细节多了一个数量级,draw call 反而从每棵十几个降到 1 个。
const VEG_MAT = createStylizedMaterial({
  vertexColors: true, roughness: 0.94, rim: VEGETATION_RIM,
});

const ZERO = new THREE.Vector3();
const hslTmp = { h: 0, s: 0, l: 0 };
const paintTmp = new THREE.Color();
const tubeUp = new THREE.Vector3(0, 1, 0);
const tubeDir = new THREE.Vector3();
const tubeMid = new THREE.Vector3();
const tubeQuat = new THREE.Quaternion();

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
function smooth01(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 索引几何体转成非索引:合并时所有部件的索引状态必须一致(多面体天生非索引) */
const flat = (geo: THREE.BufferGeometry): THREE.BufferGeometry =>
  geo.index ? geo.toNonIndexed() : geo;

/**
 * 在两点之间放一节圆柱,自动朝向两点连线。
 * 注意 rotateX/Y/Z 绕的是原点而非自身中心,所以必须"先在原点定向,再平移到中点"。
 */
function tube(
  p0: THREE.Vector3, p1: THREE.Vector3, rBottom: number, rTop: number, radial = 6
): THREE.BufferGeometry {
  tubeDir.subVectors(p1, p0);
  const geo = new THREE.CylinderGeometry(rTop, rBottom, tubeDir.length(), radial, 1);
  tubeQuat.setFromUnitVectors(tubeUp, tubeDir.normalize());
  geo.applyQuaternion(tubeQuat);
  tubeMid.addVectors(p0, p1).multiplyScalar(0.5);
  geo.translate(tubeMid.x, tubeMid.y, tubeMid.z);
  return geo;
}

/** 逐顶点上色:能按位置和法线算颜色,才能做垂直色阶、层理和朝上面的苔藓 */
function paintBy(
  geo: THREE.BufferGeometry,
  fn: (x: number, y: number, z: number, ny: number, out: THREE.Color) => void
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getY(i) : 1, paintTmp);
    colors[i * 3] = paintTmp.r;
    colors[i * 3 + 1] = paintTmp.g;
    colors[i * 3 + 2] = paintTmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function paint(geo: THREE.BufferGeometry, color: THREE.Color, jitter = 0): THREE.BufferGeometry {
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // 每个面轻微抖动明度,平面着色下会变成一层细碎的色阶,不再是死板的纯色块
    const k = 1 + (Math.random() - 0.5) * jitter;
    colors[i * 3] = color.r * k;
    colors[i * 3 + 1] = color.g * k;
    colors[i * 3 + 2] = color.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * 一片棕榈叶:沿下垂弧线排开的条带,宽度先扩后收,外缘带锯齿(小叶)。
 * 原来用一个圆锥充当整片叶子 —— 那是个实心的尖三角,既没有叶面也没有下垂,
 * 树冠因此永远是把张开的伞。
 */
function frondGeometry(length: number, width: number, droop: number): THREE.BufferGeometry {
  const steps = 7;
  const positions: number[] = [];
  const indices: number[] = [];
  // uv 用不上,但必须存在:mergeGeometries 要求所有几何体的属性集合完全一致,
  // 少一个属性就会静默返回 null,整棵树只剩下第一节树干
  const uvs: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const reach = Math.sin(t * 1.35) / Math.sin(1.35) * length;  // 越往外伸展越慢
    const drop = -droop * t * t * length;                        // 二次下垂,根部平、叶尖坠
    // 宽度先扩后收;外缘按小叶节奏轻微起伏,剪影就有了锯齿
    const w = width * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95))
      * (1 + Math.sin(t * 18) * 0.16);
    // 中脊比两侧略高 → 叶面呈浅 V 形,受光时有明暗两面
    positions.push(reach, drop + w * 0.32, 0);
    positions.push(reach, drop, -w);
    positions.push(reach, drop, w);
    uvs.push(t, 0.5, t, 0, t, 1);
    if (i > 0) {
      const p = (i - 1) * 3;
      const c = i * 3;
      indices.push(p, c, p + 1, c, c + 1, p + 1);   // 一侧叶面
      indices.push(p, p + 2, c, c, p + 2, c + 2);   // 另一侧叶面
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function tree(): THREE.Group {
  const g = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];

  // 高度拉大跨度:小苗到老树都有,一眼扫过去才不觉得是复制粘贴
  const trunkH = 3.6 + Math.random() * 4.4;
  // 树干朝一个方向弯:笔直的圆柱是棕榈最假的地方,它们几乎总是被风压出弧度
  const leanDir = Math.random() * Math.PI * 2;
  const lean = 0.1 + Math.random() * 0.34;
  const trunkColor = pick(TRUNK_COLORS);
  const SEGS = 7;
  const up = new THREE.Vector3(0, 1, 0);
  const pointOnTrunk = (t: number): THREE.Vector3 => {
    const off = lean * t * t * trunkH;
    return new THREE.Vector3(
      Math.cos(leanDir) * off,
      t * trunkH,
      Math.sin(leanDir) * off
    );
  };
  const tangentOnTrunk = (t: number): THREE.Vector3 => new THREE.Vector3(
    Math.cos(leanDir) * 2 * lean * t,
    1,
    Math.sin(leanDir) * 2 * lean * t
  ).normalize();
  const top = pointOnTrunk(1);
  const topRotation = new THREE.Quaternion().setFromUnitVectors(up, tangentOnTrunk(1));
  for (let i = 0; i < SEGS; i++) {
    const t0 = i / SEGS;
    const t1 = (i + 1) / SEGS;
    const p0 = pointOnTrunk(t0);
    const p1 = pointOnTrunk(t1);
    const axis = p1.clone().sub(p0);
    const r0 = 0.34 - t0 * 0.16;
    const r1 = 0.34 - t1 * 0.16;
    const segH = axis.length();
    const seg = new THREE.CylinderGeometry(r1, r0, segH, 6, 1);
    // 圆柱默认沿 Y 轴。直接把它对齐到本节两个端点，任意弯曲方向都能严丝合缝。
    seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.normalize()));
    const mid = p0.add(p1).multiplyScalar(0.5);
    seg.translate(mid.x, mid.y, mid.z);
    parts.push(paint(seg, trunkColor, 0.16));
  }
  // 板根把高而细的树干压回地面。没有根系时，棕榈在长阴影旁尤其像插进草皮的道具。
  for (let i = 0; i < 5; i++) {
    const a = leanDir + (i / 5) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const reach = 0.75 + Math.random() * 0.45;
    const root = tube(
      new THREE.Vector3(0, 0.18, 0),
      new THREE.Vector3(Math.cos(a) * reach, 0.035, Math.sin(a) * reach),
      0.13, 0.035, 5
    );
    parts.push(paint(root, trunkColor, 0.12));
  }
  // 树干上的环状叶痕:棕榈树干的识别特征,一圈一圈的旧叶基
  for (let i = 1; i < 5; i++) {
    const t = i / 5.5;
    const p = pointOnTrunk(t);
    const ring = new THREE.CylinderGeometry(0.35 - t * 0.15, 0.35 - t * 0.15, 0.09, 6);
    ring.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, tangentOnTrunk(t)));
    ring.translate(p.x, p.y, p.z);
    parts.push(paint(ring, TRUNK_RING, 0.1));
  }

  // 树冠:叶片长度和下垂角各不相同,伞形才会被打破
  const leafColor = pick(LEAF_COLORS);
  const frondCount = 9 + ((Math.random() * 4) | 0);
  for (let i = 0; i < frondCount; i++) {
    const a = (i / frondCount) * Math.PI * 2 + Math.random() * 0.4;
    const len = 2.5 + Math.random() * 1.3;
    const frond = frondGeometry(len, 0.42 + Math.random() * 0.16, 0.26 + Math.random() * 0.3);
    // 老叶垂得更低,新叶朝上竖着 —— 树冠有了新老层次
    frond.rotateZ(-0.55 + Math.random() * 0.85);
    frond.rotateY(a);
    // 叶冠跟随树干末端切线，不会在斜树干顶端横着“折断”。
    frond.applyQuaternion(topRotation);
    frond.translate(top.x, top.y - 0.1, top.z);
    parts.push(paint(frond, leafColor, 0.22));
  }
  // 冠心:遮住叶片汇聚处的破面
  const heart = new THREE.ConeGeometry(0.26, 0.5, 6);
  heart.applyQuaternion(topRotation);
  heart.translate(top.x, top.y + 0.1, top.z);
  parts.push(paint(heart, leafColor, 0.1));

  // 椰子:成串挂在冠下,而不是散落一圈
  const nuts = (Math.random() * 4) | 0;
  if (nuts > 0) {
    const nutColor = pick(COCONUT_COLORS);
    const cluster = Math.random() * Math.PI * 2;
    for (let i = 0; i < nuts; i++) {
      const a = cluster + (Math.random() - 0.5) * 0.9;
      const c = new THREE.SphereGeometry(0.17, 6, 5);
      const nutOffset = new THREE.Vector3(
        Math.cos(a) * (0.24 + Math.random() * 0.16),
        -0.28 - Math.random() * 0.22,
        Math.sin(a) * (0.24 + Math.random() * 0.16)
      ).applyQuaternion(topRotation).add(top);
      c.translate(nutOffset.x, nutOffset.y, nutOffset.z);
      parts.push(paint(c, nutColor, 0.12));
    }
  }

  const merged = mergeLabeled(parts, '椰子树');
  for (const p of parts) if (p !== merged) p.dispose();
  const mesh = new THREE.Mesh(merged, VEG_MAT);
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

/**
 * 不规则块体:把正二十面体的顶点沿各自方向按噪声推拉。
 * 位移只取决于顶点方向,所以非索引几何体里重复出现的同一个位置会得到同样的位移,
 * 面与面之间不会裂开。这是"棱角分明的石头"和"规整多面体"的分界线。
 */
function chunkGeometry(radius: number, detail: number, rough: number): THREE.BufferGeometry {
  const geo = flat(new THREE.IcosahedronGeometry(radius, detail));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length() || 1;
    const dx = v.x / len, dy = v.y / len, dz = v.z / len;
    const n = fbm(dx * 2.1 + 8.3, dz * 2.1 + 4.7, 2) * 0.6
      + fbm(dy * 3.4 + 1.9, dx * 3.4 + 6.1, 2) * 0.4;
    const k = 1 + (n - 0.5) * rough;
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// 灌木:问题从来不是"球不够多",而是整丛只有一个颜色。
// 真实的灌木是一团半透光的叶子,顶上受光、底下压暗,轮廓被枝条戳破。
function bush(): THREE.Group {
  const parts: THREE.BufferGeometry[] = [];

  const base = pick(BUSH_COLORS);
  base.getHSL(hslTmp);
  // 顶面偏黄、亮;底部偏冷、暗。这个垂直色阶就是"体积感"本身
  const top = new THREE.Color().setHSL(
    Math.max(0, hslTmp.h - 0.035), hslTmp.s * 0.92, Math.min(0.7, hslTmp.l + 0.17)
  );
  const bottom = new THREE.Color().setHSL(
    hslTmp.h + 0.02, Math.min(1, hslTmp.s * 1.12), Math.max(0.05, hslTmp.l - 0.14)
  );

  // 整丛宽扁:灌木几乎总是宽大于高,做成球就会像颗西兰花
  const spread = 0.85 + Math.random() * 0.45;
  const height = 0.9 + Math.random() * 0.5;

  // 木质枝干:让叶团有个"长出来的地方",而不是浮在草上
  const woodColor = pick(TRUNK_COLORS);
  const stems = 2 + ((Math.random() * 2) | 0);
  const stemTops: THREE.Vector3[] = [];
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + Math.random() * 0.8;
    const tip = new THREE.Vector3(
      Math.cos(a) * spread * 0.42, height * (0.5 + Math.random() * 0.25), Math.sin(a) * spread * 0.42
    );
    stemTops.push(tip);
    parts.push(paint(flat(tube(ZERO, tip, 0.075, 0.045, 5)), woodColor, 0.18));
  }

  // 叶团:顶上一团 + 中层一圈 + 底部外扩的裙边。
  // 大小要拉开差距、形状要够毛糙,否则几个等大的圆团叠起来就是一颗西兰花
  const clumps = 6 + ((Math.random() * 4) | 0);
  for (let i = 0; i < clumps; i++) {
    const isTop = i === 0;
    const skirt = !isTop && i > clumps * 0.62;      // 底部裙边:灌木下宽上窄
    const a = (i / clumps) * Math.PI * 2 + Math.random() * 0.7;
    const rr = isTop ? 0 : spread * (skirt ? 0.66 + Math.random() * 0.34 : 0.34 + Math.random() * 0.36);
    const r = (isTop ? 0.34 : skirt ? 0.2 : 0.28) + Math.random() * 0.26;
    const geo = chunkGeometry(r, 0, 0.85);          // 毛糙度拉高,边缘才有参差
    geo.scale(1.2, skirt ? 0.62 : 0.8, 1.2);        // 压扁
    const cy = isTop
      ? height * 0.92
      : height * (skirt ? 0.24 + Math.random() * 0.2 : 0.5 + Math.random() * 0.36);
    geo.translate(Math.cos(a) * rr, cy, Math.sin(a) * rr);
    parts.push(paintBy(geo, (x, y, z, ny, out) => {
      // 高度色阶为主,再叠一点朝向:朝上的面更接近顶面色
      const t = clamp01(y / (height * 1.25)) * 0.75 + clamp01(ny) * 0.25;
      out.copy(bottom).lerp(top, t);
      // 细碎明度抖动,平面着色下会碎成一层叶片状的色阶
      const j = 1 + (fbm(x * 6 + 3, z * 6 + 7, 2) - 0.5) * 0.22;
      out.multiplyScalar(j);
    }));
  }

  // 枯枝:必须明显伸到叶团之外才有意义。
  // 叶子最远约到 spread*1.0+团半径,枝条只伸到那儿就等于全埋在里面 —— 第一版就是这么白做的
  for (let i = 0, n = 2 + ((Math.random() * 2) | 0); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const reach = spread * (1.45 + Math.random() * 0.5);
    const from = stemTops[i % stemTops.length] ?? ZERO;
    const to = new THREE.Vector3(
      Math.cos(a) * reach,
      height * (0.85 + Math.random() * 0.65),
      Math.sin(a) * reach
    );
    parts.push(paint(flat(tube(from, to, 0.03, 0.012, 4)), woodColor, 0.2));
  }

  // 浆果:成串挂在一处,而不是天女散花
  if (Math.random() < 0.75) {
    const berryColor = pick(BERRY_COLORS);
    const a = Math.random() * Math.PI * 2;
    const cx = Math.cos(a) * spread * 0.55;
    const cz = Math.sin(a) * spread * 0.55;
    for (let i = 0, n = 3 + ((Math.random() * 4) | 0); i < n; i++) {
      const b = flat(new THREE.SphereGeometry(0.055 + Math.random() * 0.025, 5, 4));
      b.translate(
        cx + (Math.random() - 0.5) * 0.34,
        height * (0.55 + Math.random() * 0.4),
        cz + (Math.random() - 0.5) * 0.34
      );
      parts.push(paint(b, berryColor, 0.14));
    }
  }

  const g = new THREE.Group();
  const merged = mergeLabeled(parts, '灌木');
  for (const p of parts) if (p !== merged) p.dispose();
  const mesh = new THREE.Mesh(merged, VEG_MAT);
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

// 石头:关键不是形状更复杂,而是"它在这儿待了很久" ——
// 半埋进土里、朝上的面长苔、脚下有崩落的碎屑。
function rock(): THREE.Group {
  const parts: THREE.BufferGeometry[] = [];
  const stone = pick(ROCK_COLORS);
  const moss = pick(MOSS_COLORS);
  // 多数石头只带一点苔,少数长满。但下限不能是 0 ——
  // 朝上的面完全没有苔,石头就永远像刚被摆上去的
  const mossiness = 0.14 + Math.random() * Math.random() * 0.86;
  const strata = Math.random() * Math.PI * 2;

  const paintStone = (geo: THREE.BufferGeometry, topY: number): THREE.BufferGeometry =>
    paintBy(geo, (x, y, z, ny, out) => {
      // 层理:沿高度的细密明暗带,沉积岩的识别特征
      const band = Math.sin(y * 7.5 + strata) * 0.05;
      const mottle = (fbm(x * 1.9 + 2.5, z * 1.9 + 5.5, 3) - 0.5) * 0.16;
      out.copy(stone).multiplyScalar(1 + band + mottle);
      // 苔藓只长在朝上的面,而且越靠顶越多
      const m = smooth01(0.35, 0.9, clamp01(ny)) * smooth01(0.1, 0.75, y / topY) * mossiness;
      if (m > 0.001) out.lerp(moss, m * 0.85);
    });

  // 主块 1-2 个,有的是立着的卵石、有的是趴着的石板
  const blocks = 1 + ((Math.random() * 2) | 0);
  let tallest = 0.6;
  for (let i = 0; i < blocks; i++) {
    const s = 0.52 + Math.random() * 0.5;
    const slab = Math.random() < 0.4;              // 石板:扁而宽
    // detail 0 = 20 个大面。detail 1 的 80 面太密,噪声位移之后反而磨成了鹅卵石;
    // 石头要的是"劈开的棱面",面越少越硬朗
    const geo = chunkGeometry(s, 0, 0.62);
    geo.scale(
      1 + Math.random() * 0.35,
      slab ? 0.45 + Math.random() * 0.2 : 0.8 + Math.random() * 0.35,
      1 + Math.random() * 0.35
    );
    geo.rotateY(Math.random() * Math.PI * 2);
    geo.rotateX((Math.random() - 0.5) * 0.35);
    // 埋进地里三成:摆在草皮表面的石头永远像道具
    const y = s * (slab ? 0.3 : 0.52);
    geo.translate((Math.random() - 0.5) * 0.9, y, (Math.random() - 0.5) * 0.9);
    tallest = Math.max(tallest, y + s);
    parts.push(paintStone(geo, tallest));
  }

  // 脚下的碎屑:让石头看起来是从这儿风化出来的,而不是被谁放上去的
  for (let i = 0, n = 3 + ((Math.random() * 4) | 0); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = 0.7 + Math.random() * 0.7;
    const s = 0.07 + Math.random() * 0.1;
    const geo = chunkGeometry(s, 0, 0.6);
    geo.scale(1, 0.6, 1);
    geo.translate(Math.cos(a) * rr, s * 0.42, Math.sin(a) * rr);
    parts.push(paintStone(geo, tallest));
  }

  const g = new THREE.Group();
  const merged = mergeLabeled(parts, '石头');
  for (const p of parts) if (p !== merged) p.dispose();
  const mesh = new THREE.Mesh(merged, ROCK_MAT);
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

const BUILDERS: Record<ResourceKind, () => THREE.Group> = {
  wood: tree,
  fiber: bush,
  stone: rock,
};

const HP: Record<ResourceKind, number> = { wood: 3, fiber: 2, stone: 3 };

// 资产名与资源种类的对应。有外部资产就用外部资产,没有就用程序化几何体 ——
// 这是整个资产管线的回退点,也是"可以一件一件替换"的关键
const ASSET_FOR: Record<ResourceKind, string> = { wood: 'palm', fiber: 'bush', stone: 'rock' };

function buildVisual(kind: ResourceKind): THREE.Group {
  const asset = instantiate(ASSET_FOR[kind]);
  if (!asset) return BUILDERS[kind]();
  const g = new THREE.Group();
  g.add(asset.object);
  return g;
}

/**
 * 资产是异步加载的,而世界在启动时就已经用程序化几何体搭好了。
 * 加载完成后把每个资源的 visual 换掉即可 —— 外层的 mesh(世界坐标、接地阴影)
 * 和游戏状态(hp、重生计时)都不动,所以替换在任何时刻发生都安全。
 */
export function restyleResources(list: Harvestable[]): number {
  let swapped = 0;
  for (const r of list) {
    if (!instantiate(ASSET_FOR[r.kind])) continue;
    const next = buildVisual(r.kind);
    next.scale.copy(r.visual.scale);
    next.rotation.copy(r.visual.rotation);
    next.visible = r.visual.visible;
    r.mesh.remove(r.visual);
    r.mesh.add(next);
    r.visual = next;
    swapped++;
  }
  return swapped;
}

export function createResource(kind: ResourceKind, x: number, z: number): Harvestable {
  // 外层只负责世界坐标和接地阴影；visual 才参与风摆。
  // 这样阴影不会随树干一起倾斜离地。
  const visual = buildVisual(kind);
  const mesh = new THREE.Group();
  mesh.add(visual);
  if (kind === 'wood') {
    // 尺寸跨度加大:小苗(约 0.7)到老树(约 1.25),层次更丰富
    const s = 0.7 + Math.random() * 0.55;
    visual.scale.set(s * (0.9 + Math.random() * 0.18), s, s * (0.9 + Math.random() * 0.18));
  }
  const contact = new THREE.Mesh(GEO.contact, contactMaterial());
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.025;
  const contactScale = kind === 'wood' ? 1.5 : kind === 'fiber' ? 1.0 : 0.9;
  contact.scale.set(contactScale, contactScale, 1);
  contact.renderOrder = -1;
  mesh.add(contact);
  mesh.position.set(x, islandHeight(x, z), z);
  mesh.rotation.y = Math.random() * Math.PI * 2;
  return { mesh, visual, kind, hp: HP[kind], x, z, respawnAt: 0, swayPhase: Math.random() * Math.PI * 2 };
}

// 在岛上散布资源:避开中心营地区与水线,也可以避开给定的建筑落点。
// 位置由岛屿种子决定 —— 参观别人的岛时,树石长在和岛主那边一样的地方;
// 单株的高矮胖瘦仍用 Math.random,那属于观感、不影响"这是同一座岛"。
export function scatterResources(
  seed: number,
  avoid: Array<{ x: number; z: number; radius: number }> = []
): Harvestable[] {
  const rand = rng(seed);
  const out: Harvestable[] = [];
  // 数量按面积走:半径 26→38,面积翻了一倍多,数量不跟上就等于把岛稀释成空地。
  // 再往"茂密"抬一档 —— 动森那种生机感,很大程度来自植被密度本身。
  const plan: Array<[ResourceKind, number]> = [['wood', 40], ['fiber', 36], ['stone', 24]];
  for (const [kind, count] of plan) {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < 700) {
      const a = rand() * Math.PI * 2;
      const r = 5 + rand() * (ISLAND_RADIUS - 8);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = islandHeight(x, z);
      if (h < 0.35 || h > 11) continue;          // 别长在水里或山脊裸岩上
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 2.6)) continue; // 别挤在一起
      if (avoid.some((b) => Math.hypot(b.x - x, b.z - z) < b.radius + 1.6)) continue; // 别长在建筑上
      out.push(createResource(kind, x, z));
      placed++;
    }
  }
  return out;
}

export interface Spring { mesh: THREE.Group; x: number; z: number }

// 固定淡水泉:让玩家能围绕可靠水源选择营地位置。
// 位置沿一条固定射线扫出来,而不是写死坐标 —— 地形一改,写死的坐标可能落进海里或半山腰。
// 泉水该在山脚的缓坡上,所以挑高度最接近目标值、且附近平坦的那一点。
const SPRING_ANGLE = 2.55;
const SPRING_TARGET_H = 3.2;

function springSpot(): { x: number; z: number } {
  let best = { x: Math.cos(SPRING_ANGLE) * 12, z: Math.sin(SPRING_ANGLE) * 12 };
  let bestScore = Infinity;
  for (let r = 8; r < ISLAND_RADIUS - 6; r += 0.5) {
    const x = Math.cos(SPRING_ANGLE) * r;
    const z = Math.sin(SPRING_ANGLE) * r;
    const h = islandHeight(x, z);
    // 坡度越小越好:泉眼摆在陡坡上会有一半悬空
    const slope = Math.abs(islandHeight(x + 1, z) - islandHeight(x - 1, z))
      + Math.abs(islandHeight(x, z + 1) - islandHeight(x, z - 1));
    const score = Math.abs(h - SPRING_TARGET_H) + slope * 1.5;
    if (score < bestScore) { bestScore = score; best = { x, z }; }
  }
  return best;
}

export function createSpring(): Spring {
  const { x, z } = springSpot();
  const g = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: '#817f79', flatShading: true, roughness: 0.88 });
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.38 + (i % 3) * 0.08, 0), rockMat);
    rock.position.set(Math.cos(a) * 1.35, 0.22, Math.sin(a) * 1.05);
    rock.castShadow = true; g.add(rock);
  }
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.22, 18),
    new THREE.MeshPhysicalMaterial({
      color: '#4bc4df', transparent: true, opacity: 0.78, side: THREE.DoubleSide,
      roughness: 0.16, clearcoat: 0.7, clearcoatRoughness: 0.2,
    }));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.16; g.add(water);
  // 泉眼后方的岩壁形成远处也能识别的小地标。
  for (let i = 0; i < 5; i++) {
    const cliff = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65 + (i % 2) * 0.18, 0), rockMat);
    cliff.position.set(-1.35 + i * 0.65, 0.5 + (i % 3) * 0.2, 0.8 + Math.abs(i - 2) * 0.12);
    cliff.scale.y = 1.25; cliff.castShadow = true; g.add(cliff);
  }
  g.position.set(x, islandHeight(x, z), z);
  return { mesh: g, x, z };
}

// 非交互环境细节:用很小的几何体打破大片空草地与规则沙滩。
// 草地风吹材质:顶点着色器里按世界坐标+时间做弯折,aBend 属性标记"离根部多高"
// (根部不动、叶尖摆动,才像草而不是整块平移)
const grassShaders: Array<{ uniforms: { uTime: { value: number } } }> = [];

// 两条主要探索通道同时服务构图与玩法：出生点通往泉眼、沉船海湾。
// 草地会主动从通道边缘退开，形成商业游戏里常见的“留白可走区”，而不是平均铺满噪点。
const GROUND_TRAILS: Array<Array<[number, number]>> = [
  [[0, 0], [-2.8, 1.1], [-6.1, 3.5], [-10, 6]],
  [[0.8, -0.6], [4.3, -2.6], [8.8, -6.6], [12.4, -10.2], [15.5, -13.5]],
];

function pointSegmentDistance(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

function trailDistance(x: number, z: number): number {
  let best = Infinity;
  for (const trail of GROUND_TRAILS) {
    for (let i = 1; i < trail.length; i++) {
      best = Math.min(best, pointSegmentDistance(x, z, trail[i - 1], trail[i]));
    }
  }
  return best;
}

/** 每帧推进草地风的时间;由主循环调用 */
export function updateGrassWind(t: number): void {
  for (const s of grassShaders) s.uniforms.uTime.value = t;
}

function makeGrassMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.94, metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    grassShaders.push(shader as unknown as { uniforms: { uTime: { value: number } } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        uniform float uTime;
        attribute float aBend;
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        // 两组频率叠加,让风成"波"扫过草地而不是整片同步摆;
        // 再乘一个缓慢扫过的阵风,风是一阵一阵的,不是恒定的
        float gust = 0.55 + 0.45 * sin(uTime * 0.5 - position.z * 0.07 + position.x * 0.05);
        float w = (sin(uTime * 1.7 + position.x * 0.32 + position.z * 0.21)
                + sin(uTime * 2.6 + position.x * 0.11 - position.z * 0.37) * 0.5) * gust;
        transformed.x += w * aBend * 0.17;
        transformed.z += w * aBend * 0.09;
      `);
  };
  return mat;
}

// 成片草地:上千根草叶合并成单个几何体 → 1 次 draw call
// (原先每簇 3 个独立 mesh、只有 75 簇,既稀疏又比现在更贵)
function buildGrassField(): THREE.Mesh {
  const blades: THREE.BufferGeometry[] = [];
  const tint = new THREE.Color();
  // 密度是地被"读得出来"的门槛:1600 根铺在半径 26 的岛上等于每平方米不到一根,
  // 看到的只会是零星小三角。提到 5600 才开始成片。
  // 全部合并成一个几何体,仍然只有 1 次 draw call。
  // 同样按面积补:密度不变,总量随岛长。再抬一档让地被"读得出厚度"。
  const TARGET = 11000;
  let placed = 0;
  let guard = 0;
  while (placed < TARGET && guard++ < TARGET * 14) {
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * (ISLAND_RADIUS - 4.5);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = islandHeight(x, z);
    if (h < 1.0 || h > 12.5) continue;  // 不长在水里/沙滩/山脊裸岩
    const pathD = trailDistance(x, z);
    if (pathD < 1.05 || (pathD < 1.9 && Math.random() < 0.72)) continue;
    // 用和地表配色同一套噪声决定疏密 —— 地面显得湿润的地方,草也该更密更高,
    // 两者对不上的话会看出"颜色是一层、草是另一层"
    const moisture = fbm(x * 0.05, z * 0.05, 3);
    const clump = fbm(x * 0.34, z * 0.34, 2);
    const density = moisture * 0.65 + clump * 0.55;
    if (density < 0.46) continue;                    // 裸地
    if (Math.random() > (density - 0.46) * 2.75) continue;  // 边缘自然稀疏

    // 每簇 3-6 根,簇内紧凑,整体成片
    const perTuft = 3 + ((Math.random() * 4) | 0);
    const lush = Math.min(1, Math.max(0, (density - 0.45) * 2.2));
    for (let j = 0; j < perTuft && placed < TARGET; j++) {
      // 茂盛处更高更粗,贫瘠处矮而稀 —— 高度差本身就是信息
      const height = (0.22 + Math.random() * 0.3) * (0.7 + lush * 0.75);
      const geo = new THREE.ConeGeometry(0.05 + Math.random() * 0.028, height, 3);
      geo.translate(0, height / 2, 0);      // 根部落在 y=0
      geo.rotateZ((Math.random() - 0.5) * 0.7);
      geo.rotateY(Math.random() * Math.PI);
      const ox = x + (Math.random() - 0.5) * 0.5;
      const oz = z + (Math.random() - 0.5) * 0.5;
      const oh = islandHeight(ox, oz);      // 逐根取地面高度,否则簇会浮在起伏上
      geo.translate(ox, oh, oz);

      // aBend:顶点越高越容易被风带走
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const bend = new Float32Array(pos.count);
      const colors = new Float32Array(pos.count * 3);
      // 色相跟着湿润度走:干处偏黄橄榄、湿处偏冷绿,和地表色带同源。
      // 再叠一点随机,免得同一簇里每根都一模一样
      tint.setHSL(
        0.19 + lush * 0.075 + Math.random() * 0.03,
        0.34 + Math.random() * 0.13,
        0.24 + lush * 0.09 + Math.random() * 0.06
      );
      for (let v = 0; v < pos.count; v++) {
        bend[v] = Math.max(0, Math.min(1, (pos.getY(v) - oh) / Math.max(0.001, height)));
        colors[v * 3] = tint.r; colors[v * 3 + 1] = tint.g; colors[v * 3 + 2] = tint.b;
      }
      geo.setAttribute('aBend', new THREE.BufferAttribute(bend, 1));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      blades.push(geo);
      placed++;
    }
  }
  const merged = mergeLabeled(blades, '草地');
  for (const b of blades) if (b !== merged) b.dispose();
  const mesh = new THREE.Mesh(merged, makeGrassMaterial());
  mesh.receiveShadow = true;
  return mesh;
}

function buildTrail(trail: Array<[number, number]>, width: number): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(trail.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tangent = new THREE.Vector3();
  const p = new THREE.Vector3();
  const steps = Math.max(22, trail.length * 14);
  const dirt = new THREE.Color('#776c45');
  const center = new THREE.Color('#8a7a4d');
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    curve.getPoint(t, p);
    curve.getTangent(t, tangent).normalize();
    const nx = -tangent.z;
    const nz = tangent.x;
    const w = width * (0.82 + Math.sin(t * 19 + trail.length) * 0.12 + Math.sin(t * 43) * 0.05);
    for (const lane of [-1, 0, 1]) {
      const x = p.x + nx * w * lane;
      const z = p.z + nz * w * lane;
      positions.push(x, islandHeight(x, z) + 0.045, z);
      const c = lane === 0 ? center : dirt;
      colors.push(c.r, c.g, c.b, lane === 0 ? 0.48 : 0.02);
    }
    if (i > 0) {
      const a = (i - 1) * 3;
      const b = i * 3;
      indices.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false,
    roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  return mesh;
}

function buildBeachStories(): THREE.Group {
  const g = new THREE.Group();
  const wetWood = new THREE.MeshStandardMaterial({ color: '#725038', roughness: 0.98, flatShading: true });
  const rope = new THREE.MeshStandardMaterial({ color: '#bca36b', roughness: 1, flatShading: true });
  const driftwood: Array<[number, number, number]> = [
    [-18.7, -12.8, 0.2], [-14.6, 17.3, -0.55], [19.5, 9.1, 0.8],
  ];
  for (const [x, z, rot] of driftwood) {
    const cluster = new THREE.Group();
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.7, 6), wetWood);
    log.rotation.z = Math.PI / 2; log.position.y = 0.18; log.castShadow = true; cluster.add(log);
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 1.15, 5), wetWood);
    branch.rotation.z = 1.05; branch.position.set(0.7, 0.25, 0); cluster.add(branch);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 4, 8), rope);
    tie.rotation.y = Math.PI / 2; tie.position.set(-0.45, 0.18, 0); cluster.add(tie);
    cluster.position.set(x, islandHeight(x, z) + 0.02, z);
    cluster.rotation.y = rot;
    g.add(cluster);
  }

  const starMat = new THREE.MeshStandardMaterial({
    color: '#e68154', roughness: 0.9, side: THREE.DoubleSide, flatShading: true,
  });
  for (const [x, z, a] of [[-21.2, 6.8, 0.2], [9.4, 21.1, 1.1], [21.5, -5.8, 2.2]] as const) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.34 : 0.14;
      const t = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const px = Math.cos(t) * r;
      const py = Math.sin(t) * r;
      if (i === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
    }
    shape.closePath();
    const star = new THREE.Mesh(new THREE.ShapeGeometry(shape), starMat);
    star.rotation.x = -Math.PI / 2; star.rotation.z = a;
    star.position.set(x, islandHeight(x, z) + 0.075, z);
    g.add(star);
  }
  return g;
}

export function createGroundDetails(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < GROUND_TRAILS.length; i++) {
    g.add(buildTrail(GROUND_TRAILS[i], i === 0 ? 0.82 : 0.96));
  }
  g.add(buildGrassField());
  g.add(buildBeachStories());

  // 野花:按颜色合并,每色 1 次 draw call
  const flowerColors = ['#f4d35e', '#f27d8d', '#e9eef2', '#c9a0f0'];
  for (const color of flowerColors) {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 48; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * (ISLAND_RADIUS - 7);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = islandHeight(x, z);
      if (h < 0.9 || h > 11) continue;
      const geo = new THREE.SphereGeometry(0.055, 5, 4);
      geo.translate(x, h + 0.24 + Math.random() * 0.12, z);
      parts.push(geo);
    }
    if (parts.length === 0) continue;
    const merged = mergeLabeled(parts, `野花 ${color}`);
    for (const p of parts) if (p !== merged) p.dispose();
    g.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color })));
  }
  const shellMat = new THREE.MeshLambertMaterial({ color: '#f0c9aa', flatShading: true });
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    // 跟着真实水线走。写死半径的话,岛一改形状贝壳就会散在草地上或者飘在海里
    const r = waterlineRadius(a) - 0.6 - Math.random() * 1.6;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const shell = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 4, 7, Math.PI * 1.45), shellMat);
    shell.position.set(x, islandHeight(x, z) + 0.08, z); shell.rotation.set(-Math.PI / 2, 0, a); g.add(shell);
  }
  return g;
}
