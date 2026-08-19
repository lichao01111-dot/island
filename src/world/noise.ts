// 确定性数值噪声。
//
// 为什么不继续用正弦叠加:sin(x*a)+sin(z*b) 这种式子是可分离的,
// 结果永远是规则的斜条纹或棋盘格。人眼对周期性极其敏感,所以它要么看不见
// (频率低、幅度小),要么一看就假。自然的斑驳需要不可分离的、多尺度的噪声。

function hash(x: number, y: number): number {
  // 整数格点 → [0,1) 的伪随机值。乘法常数取自常见的整数哈希,
  // 用 Math.imul 保证 32 位环绕行为在各浏览器一致
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smootherstep(t: number): number {
  // 五次曲线:一阶和二阶导数在格点处都为 0,不会留下格子边界的痕迹
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 二维数值噪声,输出 [0,1) */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smootherstep(xf);
  const v = smootherstep(yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 分形叠加:每层频率翻倍、幅度减半,得到"大块 + 中块 + 细碎"的自然层次。输出 [0,1) */
export function fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    // 每层旋转一点,避免各层的格子轴对齐后叠出十字纹
    const rx = fx * 0.8 - fy * 0.6;
    const ry = fx * 0.6 + fy * 0.8;
    sum += noise2(rx, ry) * amp;
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fy *= lacunarity;
  }
  return sum / norm;
}

/** 居中到 [-1,1] 的 fbm,做扰动时更顺手 */
export function fbmSigned(x: number, y: number, octaves = 4): number {
  return fbm(x, y, octaves) * 2 - 1;
}
