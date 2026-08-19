// 外部资产清单:逻辑名 → 文件 + 导入修正。
//
// 这里列出的每一件都是"可选的"。文件不存在时游戏回退到程序化几何体,
// 所以可以一件一件替换,而不必等美术全部做完。
//
// 目录约定:
//   web/assets/            美术交付的正式资产(会被使用)
//   web/assets/reference/  当前程序化几何体导出的基准文件(只作参考,不加载)
//                          用 `node tools/export-reference-glb.mjs` 重新生成
import type { AssetSpec } from './assets';

export const ASSET_MANIFEST: Record<string, AssetSpec> = {
  // KayKit Adventurers(CC0)。模型本体约 2.2–2.4 单位高,缩到约 1.8 米;
  // 原点本来就在脚底,所以 groundPivot 实际是空操作,留着是为了别人换模型时兜底。
  // 两个角色都加载,运行时用 ?player=barbarian|rogue 或 __game.setPlayer() 切换。
  barbarian: { url: 'assets/kaykit_Barbarian.glb', scale: 0.75, groundPivot: true },
  rogue: { url: 'assets/kaykit_Rogue.glb', scale: 0.75, groundPivot: true },
  // 植被(树/灌木/石头)保持程序化几何体 —— KayKit Forest Nature Pack 是森林贴图风,
  // 和程序化的热带平涂风(棕榈/灌木/石头)混在一起会风格打架,故刻意不接。
  // 若以后想再启用,把 web/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/ 下的
  //   bush: Bush_1_A_Color1.gltf (scale 5.0)
  //   rock: Rock_1_A_Color1.gltf (scale 1.3)
  // 加回来即可。
};
