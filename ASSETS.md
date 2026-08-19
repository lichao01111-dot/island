# 资产交付约定

这份文档是给做模型的人看的。目标是:**导出的文件丢进 `web/assets/` 就能直接用**,不需要程序改代码去适配。

## 最重要的一条

**资产是可选的。**每一件都对应一个程序化几何体作为回退。文件不存在、格式不对、加载失败,游戏都照常跑,只是那件东西还是老样子。

所以不存在"等全部做完才能合进来"——做好一件就交一件。

## 基准文件

`web/assets/reference/` 下有三个 GLB,是当前程序化几何体的导出:

| 文件 | 对应 |
|---|---|
| `palm.glb` | 椰子树 |
| `bush.glb` | 灌木 |
| `rock.glb` | 石头 |

**用 Blender 打开它们作为尺度和朝向的基准。**文字描述再清楚也不如直接看到"一米有多大"。

重新生成:`node tools/export-reference-glb.mjs`

## 硬性要求

### 单位与尺度
- **1 个单位 = 1 米**。Blender 默认单位就是米,不用改。
- 角色约 1.8 米高。椰子树 5–8 米。灌木 1–1.5 米。参考文件里都能量。

### 原点
- **原点放在模型底面中心。**
- 导入时会自动把包围盒底面对齐到 y=0(`groundPivot`),所以原点在中心也不会穿地。但**放在底面更可控**,尤其是模型有下垂的枝叶时——自动对齐会把最低的那片叶子当成"底面"。

### 朝向
- **正面朝 +Z**,Y 轴向上。
- Blender 默认 Z 轴向上,导出 glTF 时勾选 `+Y Up`(默认就是勾上的)。

### 格式
- **`.glb`**(二进制单文件)。不要 `.gltf` + 一堆散图。
- 贴图内嵌进 glb。

## 材质

现在全场是**平面着色 + 顶点色**,零贴图。你有两个选择:

**A. 沿用顶点色**(和现有画面一致)
- 用顶点色区分部位,不用贴图
- 材质用 Principled BSDF,勾上 Base Color 走 Color Attribute

**B. 上贴图**(画面会跨一个档次,但需要整体统一)
- 每件资产一张贴图,尽量共用图集
- 基础色 + 粗糙度,不需要金属度(除了铁件)
- 单张不超过 512×512——这是低多边形风格,贴图太精细反而不搭

**B 是个方向性决定,别只在一件资产上试。**要么整套走贴图,要么整套不走,混着做会看出两张不同的画贴在一起。

## 面数预算

| 资产 | 建议面数 |
|---|---|
| 椰子树 | ≤ 1500 |
| 灌木 / 石头 | ≤ 600 |
| 角色 | ≤ 3000 |
| 建筑 | ≤ 2500 |

岛上同时有 70+ 个道具,树是最多的那类。超了不会崩,但会开始掉帧。

## 动画(角色)

角色需要骨骼动画,片段名固定:

| 片段名 | 用途 |
|---|---|
| `idle` | 站立 |
| `walk` | 行走 |
| `chop` | 采集挥击 |
| `hurt` | 受击 |

- 都做成循环(`chop`/`hurt` 除外)
- 骨骼数量不限,但别用 IK 约束——导出 glTF 时会被烘掉,不如直接做 FK

## 交付后

把 `.glb` 放进 `web/assets/`,文件名对上 `src/world/asset-manifest.ts` 里的 `url`。

需要额外修正(尺度不对、朝向反了)时,改 manifest 里的 `scale` / `yaw`,**不用回去改模型文件**:

```ts
palm: { url: 'assets/palm.glb', scale: 0.01, yaw: Math.PI, groundPivot: true },
```

## 检查

```bash
npm test
```

`test/assets.mjs` 会验证参考文件仍然合法、导入修正仍然正确。

## CC0 素材库（推荐，比自建更安全）

不想自己建模时，用 CC0 素材是**最稳**的选择：CC0 = 公有领域，连署名都不强制（不过 Kenney 本人希望你提一句，纯礼貌）。首选 **Kenney（Kay Lousberg）的 KayKit 系列**——和已经合进来的 `kaykit_Barbarian.glb`/`kaykit_Rogue.glb` 同一个作者、同一套低多边形语言。

| 游戏里的东西 | 对应 KayKit 包 | 下载 |
|---|---|---|
| 树 / 灌木 / 石头 / 植被 | **Forest Nature Pack** | <https://kaylousberg.itch.io/kaykit-forest> |
| 建筑 / 道具 | **Medieval Builder Pack** 或 **Village Pack** | <https://opengameart.org>（搜 KayKit） |
| 角色（已有野蛮人/盗贼，可换更多） | **Adventurers Pack** | <https://kaylousberg.itch.io/kaykit-adventurers> |

**接入方式（drop-in）**：把对应的 `.glb` 放进 `web/assets/`，文件名对上 `src/world/asset-manifest.ts` 的 `url` 即可——文件缺失时游戏自动回退到程序化几何体，不会崩。资源替换点在 `src/world/props.ts` 的 `ASSET_FOR`（`wood→palm`、`fiber→bush`、`stone→rock`），建筑在 `buildings.ts`。

**每件资产接入后跑一遍**：`node tools/inspect-glb.mjs web/assets/xxx.glb` 看尺度/原点/朝向，再在 manifest 里用 `scale`/`yaw`/`groundPivot` 修正（不用改模型文件）。

> 注意：itch.io 的下载需要点按钮（脚本抓取常被拦）。把包下载后解压出单个 `.glb` 丢进 `web/assets/` 即可，剩下的修正我这边做。

