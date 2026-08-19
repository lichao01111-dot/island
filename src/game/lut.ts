// 3D LUT 色彩分级。
//
// 把"分离色调 + 对比 + 饱和"这套算法烘进一张 32^3 的 3D 纹理,交给 LUTPass 采样。
// 相比每像素在 shader 里重算一遍,好处是把"调色"从"渲染"里解耦出来:
//   - 换调子 = 换一张 LUT,零 shader 改动;
//   - 以后拿到美术导出的 .cube/.3dl,直接替换这张纹理即可,代码一行不动。
//
// LUT 在 sRGB 显示空间里制作、也在 OutputPass(色调映射 + sRGB)之后应用 ——
// 这是行业里最通用的 LUT 用法:调色作用于"已经能看到"的颜色,而不是线性 HDR 中间值。
import * as THREE from 'three';

export interface GradePreset {
  /** 暗部倾向(乘算),0..1 的 sRGB 分量 */
  shadowTint: [number, number, number];
  /** 亮部倾向,0..1 */
  highlightTint: [number, number, number];
  splitStrength: number;
  contrast: number;
  saturation: number;
}

// 和旧 GradeShader 完全一致的调子:切回它能 A/B 对照,也保证不回归。
export const GRADE_CURRENT: GradePreset = {
  shadowTint: [0x4a / 255, 0x6b / 255, 0x84 / 255],
  highlightTint: [0xff / 255, 0xd9 / 255, 0xa0 / 255],
  splitStrength: 0.16,
  contrast: 1.06,
  saturation: 1.08,
};

// 动森风:抬高阴影、暖亮部、压低对比 —— 粉彩高调的关键都在"别让暗部太黑"。
export const GRADE_AC_PASTEL: GradePreset = {
  shadowTint: [0.55, 0.62, 0.68],
  highlightTint: [1.0, 0.93, 0.8],
  splitStrength: 0.18,
  contrast: 1.02,
  saturation: 1.09,
};

// 夜晚:柔和的月光。阴影接近中性(不再压红)、亮部微冷,整体"清冷但不清澈见底"。
export const GRADE_NIGHT: GradePreset = {
  shadowTint: [0.48, 0.49, 0.5],
  highlightTint: [0.7, 0.73, 0.84],
  splitStrength: 0.2,
  contrast: 1.0,
  saturation: 0.95,
};

// 黄昏/日出:金色时刻。暗部偏暖棕、亮部金黄、饱和略升 —— 让整屏(不止天空)一起暖起来。
export const GRADE_DUSK: GradePreset = {
  shadowTint: [0.72, 0.52, 0.38],
  highlightTint: [1.0, 0.78, 0.5],
  splitStrength: 0.26,
  contrast: 1.04,
  saturation: 1.12,
};

export const GRADE_PRESETS = { current: GRADE_CURRENT, ac: GRADE_AC_PASTEL } as const;
export type GradeName = keyof typeof GRADE_PRESETS;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const lerp3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** 对单个颜色做分级。逻辑与旧 GradeShader 的色相/对比/饱和段一一对应。 */
function gradePixel(r: number, g: number, b: number, p: GradePreset): [number, number, number] {
  const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const t = clamp01(luma / (luma + 0.6));
  const tint = lerp3(p.shadowTint, p.highlightTint, t);

  // 分离色调:乘算而不是加算,纯黑不会被染色
  let cr = r * (1 + (tint[0] * 2 - 1) * p.splitStrength);
  let cg = g * (1 + (tint[1] * 2 - 1) * p.splitStrength);
  let cb = b * (1 + (tint[2] * 2 - 1) * p.splitStrength);

  // 对比:围绕中灰做幂曲线,高光用 luma 权重收敛,避免海面高光被推爆
  const protect = 1 - smoothstep(0.7, 2.5, luma);
  cr = mix(cr, Math.pow(Math.max(cr, 0), p.contrast) * 0.94, protect);
  cg = mix(cg, Math.pow(Math.max(cg, 0), p.contrast) * 0.94, protect);
  cb = mix(cb, Math.pow(Math.max(cb, 0), p.contrast) * 0.94, protect);

  // 饱和度
  cr = mix(luma, cr, p.saturation);
  cg = mix(luma, cg, p.saturation);
  cb = mix(luma, cb, p.saturation);

  return [cr, cg, cb];
}

export function buildGradeLut(preset: GradePreset, size = 32): THREE.Data3DTexture {
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let bz = 0; bz < size; bz++) {
    const b = bz / (size - 1);
    for (let gy = 0; gy < size; gy++) {
      const g = gy / (size - 1);
      for (let rx = 0; rx < size; rx++) {
        const r = rx / (size - 1);
        const out = gradePixel(r, g, b, preset);
        data[i] = Math.round(clamp01(out[0]) * 255);
        data[i + 1] = Math.round(clamp01(out[1]) * 255);
        data[i + 2] = Math.round(clamp01(out[2]) * 255);
        data[i + 3] = 255;
        i += 4;
      }
    }
  }

  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
