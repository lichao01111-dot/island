// stylized 材质工厂。
//
// 目标是给"平涂色 + 低多边形"的现状加一层"更被渲染过"的观感,同时给贴图资产预留接口:
//   - 菲涅尔边缘光:让物体边缘接住天光,轮廓更"圆",低多边形不再像硬纸板。
//     这是无贴图阶段最能拉开"大型游戏感"的一步 —— 动森那种柔和感一半来自边缘受光。
//   - map / roughnessMap / normalMap:现在传 null,等贴图资产到位后填上即可,
//     材质结构不用再动。
// 所有改动都叠在 MeshStandardMaterial 上,不另起炉灶,现有光照/阴影/色调映射照常生效。
import * as THREE from 'three';

export interface StylizedMaterialOptions {
  color?: THREE.ColorRepresentation;
  flatShading?: boolean;          // 默认 true,保持现有风格;传 false 切平滑
  vertexColors?: boolean;         // 默认 false(角色用纯色),植被/石头传 true
  roughness?: number;
  metalness?: number;
  // ---- 贴图预留(现在不用,接口先占好) ----
  map?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  // ---- 菲涅尔边缘光 ----
  rim?: { color: THREE.ColorRepresentation; strength: number };
}

export interface RimSpec {
  color: THREE.ColorRepresentation;
  strength: number;
}

// 记录已经注入过 rim 的材质。GLB 里多个蒙皮网格常共享同一个材质,
// applyRimToObject 逐个 mesh 遍历会重复命中 —— 不幂等就会反复声明同名 uniform。
const rimmed = new WeakSet<THREE.Material>();

/**
 * 给一个"受光材质"(Lambert/Standard/Physical)注入菲涅尔边缘光。
 * Basic 材质没有 outgoingLight/vViewPosition,会被静默跳过。
 * 已带 onBeforeCompile 的材质会链式保留原逻辑,不会覆盖掉资产自带的扩展。
 * 幂等:同一材质只会注入一次。
 */
export function applyRim(material: THREE.Material, rim: RimSpec): void {
  if (
    rimmed.has(material)
    || !(material as THREE.MeshLambertMaterial).isMeshLambertMaterial
    && !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial
    && !(material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial
  ) return;
  rimmed.add(material);

  const rimColor = new THREE.Color(rim.color);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimStrength = { value: rim.strength };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;`
      )
      .replace(
        'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
        `float islandRim = pow(1.0 - abs(dot(normalize(vViewPosition), normalize(normal))), 3.0);
          outgoingLight += uRimColor * islandRim * uRimStrength;
          gl_FragColor = vec4( outgoingLight, diffuseColor.a );`
      );
  };
  // 防止不同 rim 强度的材质共享同一个着色器缓存
  material.customProgramCacheKey = () => `stylized-rim:${rim.strength.toFixed(3)}`;
  material.needsUpdate = true;
}

/** 给一棵对象树上所有受光材质统一加 rim。用来给外部 GLB(角色)补上同一套边缘光语言。 */
export function applyRimToObject(root: THREE.Object3D, rim: RimSpec): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) applyRim(mat, rim);
  });
}

export function createStylizedMaterial(options: StylizedMaterialOptions = {}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.color ?? 0xffffff,
    flatShading: options.flatShading !== false,
    vertexColors: options.vertexColors === true,
    roughness: options.roughness ?? 0.9,
    metalness: options.metalness ?? 0,
    map: options.map ?? null,
    roughnessMap: options.roughnessMap ?? null,
    normalMap: options.normalMap ?? null,
  });

  if (options.rim) applyRim(material, options.rim);

  return material;
}

/** 植被用的共享材质参数:顶点色 + 平面着色 + 很轻的一圈天光边缘 */
export const VEGETATION_RIM = { color: '#cfe8ff', strength: 0.14 } as const;
export const ROCK_RIM = { color: '#cfe8ff', strength: 0.1 } as const;
export const CHARACTER_RIM = { color: '#cfe8ff', strength: 0.1 } as const;
// 建筑是较大的几何面,边缘光要更收敛,否则坡屋顶/栈桥会亮出一道描边
export const BUILDING_RIM = { color: '#cfe8ff', strength: 0.07 } as const;
