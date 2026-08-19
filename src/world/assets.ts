// 外部资产(glTF/GLB)的加载与实例化。
//
// 核心约定:**资产是渐进增强,不是依赖**。
// 任何一个资产缺失、加载失败、或者干脆一个都没有,游戏都必须照常跑 ——
// 调用方拿到 null 就回退到原来的程序化几何体。
// 这条约定让美术可以一件一件替换,中间每一刻都是可玩的完整版本,
// 而不是"等全部做完才能合进来"。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface AssetSpec {
  url: string;
  /**
   * 导入缩放。游戏单位是 1 = 1 米,但各家 DCC 的默认单位不一致
   * (Blender 默认米、Max 默认厘米、有些资产站按英寸导出)
   */
  scale?: number;
  /** 绕 Y 轴旋转弧度:把资产的正面对齐到游戏约定的 +Z */
  yaw?: number;
  /**
   * 把包围盒底面对齐到 y=0。
   * 美术习惯把原点放在包围盒中心,直接摆进场景就会有一半埋进地里 ——
   * 与其每次让人回去改文件,不如导入时自动修正
   */
  groundPivot?: boolean;
}

export interface AssetInstance {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

interface LoadedAsset {
  prototype: THREE.Object3D;
  animations: THREE.AnimationClip[];
  skinned: boolean;
}

export interface AssetReport {
  loaded: string[];
  missing: string[];
}

const assets = new Map<string, LoadedAsset>();
const box = new THREE.Box3();

/**
 * 导入修正。单独导出是为了能测 —— 这是整条管线里唯一有判断逻辑的地方,
 * 而"模型埋进地里一半"正是接资产时最常见、也最烦人的问题。
 */
export function applyAssetCorrections(root: THREE.Object3D, spec: AssetSpec): void {
  if (spec.scale && spec.scale !== 1) root.scale.setScalar(spec.scale);
  if (spec.yaw) root.rotation.y = spec.yaw;
  if (spec.groundPivot !== false) {
    // 先把变换烘进包围盒,再把整体抬到底面贴地
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    if (Number.isFinite(box.min.y)) root.position.y -= box.min.y;
  }
}

function hasSkinnedMesh(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) found = true; });
  return found;
}

/**
 * 批量加载。任何一件失败都只记进 missing,不抛错、不阻断其它资产 ——
 * 少一棵树不该让整个游戏打不开。
 */
export async function loadAssets(specs: Record<string, AssetSpec>): Promise<AssetReport> {
  const loader = new GLTFLoader();
  const report: AssetReport = { loaded: [], missing: [] };
  await Promise.all(Object.entries(specs).map(async ([name, spec]) => {
    try {
      const gltf = await loader.loadAsync(spec.url);
      const root = gltf.scene;
      applyAssetCorrections(root, spec);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      assets.set(name, {
        prototype: root,
        animations: gltf.animations ?? [],
        skinned: hasSkinnedMesh(root),
      });
      report.loaded.push(name);
    } catch {
      // 文件还没做出来是常态,不是错误。静默记账,由调用方回退
      report.missing.push(name);
    }
  }));
  return report;
}

export function hasAsset(name: string): boolean {
  return assets.has(name);
}

/**
 * 取一个可以直接加进场景的实例。资产不存在时返回 null —— 调用方据此回退。
 * 带骨骼的模型必须用 SkeletonUtils.clone:普通 clone 会让所有实例共享同一套骨骼,
 * 一个角色抬手,全场的角色跟着抬手。
 */
export function instantiate(name: string): AssetInstance | null {
  const asset = assets.get(name);
  if (!asset) return null;
  const object = asset.skinned
    ? cloneSkinned(asset.prototype)
    : asset.prototype.clone(true);
  return { object, animations: asset.animations };
}

/** 测试与调试用:清空注册表 */
export function resetAssets(): void {
  assets.clear();
}
