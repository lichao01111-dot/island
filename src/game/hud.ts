// HUD:用一层 2D canvas 叠在 3D 之上画数值条与提示(比 DOM 好控、和小游戏一致)
import { Input } from './input';
import { safeAreaInsets } from '../platform/device';

export interface Vitals { health: number; hunger: number; thirst: number; energy: number }
// 前五项是主岛可持续取得的基础物资；fish 只能来自住客；后三项来自远征，是建筑升级的门槛材料。
export interface Inventory {
  wood: number; fiber: number; stone: number; food: number; cookedFood: number;
  fish: number;
  cloth: number; metal: number; seed: number;
}

export type ItemKind = keyof Inventory;

export const BASE_ITEMS: ItemKind[] = ['wood', 'fiber', 'stone', 'food', 'cookedFood'];
// 住客产出:岛上采不到,只能靠别人。单独一组是为了让"有人住进来"这件事在物资栏里看得见
export const RESIDENT_ITEMS: ItemKind[] = ['fish'];
export const RARE_ITEMS: ItemKind[] = ['cloth', 'metal', 'seed'];

export interface Rect { x: number; y: number; w: number; h: number }

// 稀有材料没见过就不占格子:物资栏在小屏上塞不下 8 格,
// 而且"第一次打捞后栏位多出一格"本身就是解锁反馈
export function visibleItems(inv: Inventory): ItemKind[] {
  return [
    ...BASE_ITEMS,
    ...RESIDENT_ITEMS.filter((k) => inv[k] > 0),
    ...RARE_ITEMS.filter((k) => inv[k] > 0),
  ];
}

// HUD 绘制与 Input 命中检测共用同一套坐标,否则点击位置会和画面对不上
export function itemSlotRects(count: number): Rect[] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const safeBottom = safeAreaInsets().bottom;
  const iw = Math.min(62, (w - 20) / count);
  const sx = (w - count * iw) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: sx + i * iw, y: h - 62 - safeBottom, w: iw, h: 50 }));
}

export interface BuildButton {
  label: string;
  icon: string;
  costText: string;
  affordable: boolean;
  blocked: boolean;   // 材料够但位置不合适
  rect: Rect;
}

// 漂流物指引:世界坐标投影到屏幕后的结果。offscreen 时画成边缘箭头
export interface Pointer {
  x: number;
  y: number;
  offscreen: boolean;
  distance: number;
}

// 建造按钮布局:右下竖排,和 Input 的命中检测共用同一套坐标
// 解锁岛屿建筑后按钮最多到 6 个,超过 4 个就收紧行高,否则在 667 高的屏幕上会顶穿数值条
// 建造按钮宽度:岛屿建筑最多要 4 种材料,窄于这个成本行就挤不下
export const BUILD_BUTTON_W = 118;
// 右侧操作栏占据的总宽度,提示文字要避开它
export const ACTION_RAIL_W = BUILD_BUTTON_W + 14;

export function buildButtonRects(count: number): Rect[] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const safe = safeAreaInsets();
  const bw = BUILD_BUTTON_W;
  const bh = count > 4 ? 40 : 46;
  const gap = count > 4 ? 7 : 10;
  const x = w - bw - 14 - safe.right;
  const startY = h - 84 - safe.bottom - count * (bh + gap);
  const out: Rect[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ x, y: startY + i * (bh + gap), w: bw, h: bh });
  }
  return out;
}

// 靠近篝火时显示在建造栏上方，Input 使用同一套坐标做触控命中。
export function fireActionRects(buildCount: number): Rect[] {
  const builds = buildButtonRects(buildCount);
  const safe = safeAreaInsets();
  const x = window.innerWidth - ACTION_RAIL_W - safe.right;
  const firstBuildY = builds[0]?.y ?? window.innerHeight - 84 - safe.bottom;
  return [
    { x, y: firstBuildY - 112, w: BUILD_BUTTON_W, h: 46 },
    { x, y: firstBuildY - 56, w: BUILD_BUTTON_W, h: 46 },
  ];
}

// 建筑升级始终放在篝火操作的上方，避免移动端三个动作互相覆盖。
export function upgradeActionRect(buildCount: number): Rect {
  const builds = buildButtonRects(buildCount);
  const safe = safeAreaInsets();
  const firstBuildY = builds[0]?.y ?? window.innerHeight - 84 - safe.bottom;
  return {
    x: window.innerWidth - ACTION_RAIL_W - safe.right,
    y: firstBuildY - 168,
    w: BUILD_BUTTON_W,
    h: 48,
  };
}

export interface HudState {
  vitals: Vitals;
  inv: Inventory;
  day: number;
  timeOfDay: number;
  hint: string | null;
  input: Input;
  buildButtons?: BuildButton[];
  showFireActions?: boolean;
  toast?: string | null;
  hurtAlpha?: number;
  level?: number;
  levelProgress?: number;   // 0..1,距离下一级
  pointer?: Pointer | null;
  visiting?: boolean;       // 参观别人的岛:藏起属于"我"的那部分 UI
  upgradeAction?: { label: string; costText: string; enabled: boolean; reason?: string } | null;
  objective?: string | null;
  expedition?: { name: string; cargoUsed: number; cargoCapacity: number } | null;
}

const HUD_FONT = '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif';

const PANEL_TONES = {
  leaf: {
    top: 'rgba(35,72,59,0.96)', bottom: 'rgba(18,43,38,0.96)',
    border: 'rgba(176,220,174,0.48)', shine: 'rgba(231,255,221,0.13)',
  },
  slate: {
    top: 'rgba(35,55,53,0.95)', bottom: 'rgba(17,34,34,0.96)',
    border: 'rgba(194,222,211,0.34)', shine: 'rgba(236,255,247,0.10)',
  },
  sand: {
    top: 'rgba(116,74,39,0.97)', bottom: 'rgba(69,42,28,0.97)',
    border: 'rgba(255,211,137,0.58)', shine: 'rgba(255,238,188,0.15)',
  },
  tide: {
    top: 'rgba(49,87,101,0.97)', bottom: 'rgba(24,53,65,0.97)',
    border: 'rgba(171,224,236,0.52)', shine: 'rgba(225,251,255,0.13)',
  },
  muted: {
    top: 'rgba(48,57,53,0.91)', bottom: 'rgba(27,34,32,0.94)',
    border: 'rgba(221,231,222,0.24)', shine: 'rgba(255,255,255,0.07)',
  },
} as const;

type PanelTone = keyof typeof PANEL_TONES;

export class Hud {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    // z-index 高于暗角层(#grade),否则 HUD 四角会被压暗
    this.canvas.style.cssText =
      'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  render(s: HudState): void {
    const {
      vitals, inv, day, timeOfDay, hint, input,
      buildButtons = [], showFireActions = false, toast = null, hurtAlpha = 0,
      level = 1, levelProgress = 0, pointer = null, visiting = false,
      upgradeAction = null, objective = null, expedition = null,
    } = s;
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const safe = safeAreaInsets();
    const compactExpedition = !!expedition && w < 600;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 左上:把四项生存数值收在同一块状态板里。共用外框比四个悬浮胶囊更稳，
    // 同时让颜色只承担“数值”而不是承担整个控件的视觉重量。
    const bars: Array<[string, number, string]> = visiting ? [] : [
      ['生命', vitals.health, '#e45353'],
      ['饥饿', vitals.hunger, '#e8894b'],
      ['口渴', vitals.thirst, '#4bb6e8'],
      ['体力', vitals.energy, '#8ad14f'],
    ];
    const bw = Math.min(150, w * 0.4);
    const statusX = 12 + safe.left;
    const statusY = 12 + safe.top;
    const statusW = bw + 48;
    if (bars.length) this.panel(ctx, statusX, statusY, statusW, 106, 15, 'slate');
    bars.forEach(([label, val, color], i) => {
      const y = statusY + 7 + i * 24;
      const meterX = statusX + 61;
      const meterW = statusW - 71;
      this.vitalIcon(ctx, label, statusX + 15, y + 12, color);
      ctx.fillStyle = 'rgba(243,248,235,0.94)';
      ctx.font = `700 11px ${HUD_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, statusX + 26, y + 12);
      this.meter(ctx, meterX, y + 7, meterW, 9, val / 100, color);
    });

    // 右上:昼夜与岛屿等级合成一张信息牌，图标全部由 Canvas 绘制，
    // 避免系统 emoji 在不同平台上破坏低多边形风格。
    const isNight = timeOfDay > 0.75 || timeOfDay < 0.2;
    const dayX = w - 124 - safe.right;
    const dayY = 12 + safe.top;
    this.panel(ctx, dayX, dayY, 112, 66, 15, isNight ? 'tide' : 'leaf');
    this.skyIcon(ctx, isNight, dayX + 18, dayY + 18);
    ctx.fillStyle = '#fff8dc';
    ctx.font = `800 14px ${HUD_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(`第 ${day} 天`, dayX + 33, dayY + 19);
    ctx.strokeStyle = 'rgba(230,245,226,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dayX + 10, dayY + 32); ctx.lineTo(dayX + 102, dayY + 32); ctx.stroke();
    ctx.fillStyle = '#ffe0a0';
    ctx.font = `750 11px ${HUD_FONT}`;
    ctx.fillText(`岛屿 Lv.${level}`, dayX + 10, dayY + 48);
    this.meter(ctx, dayX + 72, dayY + 41, 30, 7, levelProgress, '#92d56c');

    // 底部:物资(稀有材料获得后才占格)。参观时背包无从用起,也一并收起
    if (!visiting) {
      const kinds = visibleItems(inv);
      const slots = itemSlotRects(kinds.length);
      const first = slots[0];
      const totalW = slots.length * first.w;
      this.panel(ctx, first.x - 8, h - 66 - safe.bottom, totalW + 16, 56, 16, 'slate');
      kinds.forEach((kind, i) => {
        const cx = slots[i].x + slots[i].w / 2;
        const compact = slots[i].w < 50;
        const rare = RARE_ITEMS.includes(kind);
        const insetX = slots[i].x + 3;
        const insetW = slots[i].w - 6;
        ctx.fillStyle = rare ? 'rgba(197,157,77,0.15)' : 'rgba(5,15,14,0.18)';
        this.round(ctx, insetX, h - 60 - safe.bottom, insetW, 43, 11); ctx.fill();
        ctx.strokeStyle = rare ? 'rgba(255,220,139,0.38)' : 'rgba(226,245,232,0.09)';
        ctx.lineWidth = 1;
        this.round(ctx, insetX, h - 60 - safe.bottom, insetW, 43, 11); ctx.stroke();
        this.itemIcon(ctx, kind, cx - (compact ? 7 : 11), h - 38 - safe.bottom);
        ctx.font = `800 ${compact ? 12 : 14}px ${HUD_FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = inv[kind] > 0 ? '#fff8df' : 'rgba(228,236,224,0.58)';
        ctx.fillText(String(inv[kind]), cx + (compact ? 10 : 14), h - 37 - safe.bottom);
      });
    }

    // 漂流物指引:在屏幕内画一枚小标记,出屏则贴边画箭头
    // (岛直径 46 米,没有指引玩家根本不知道该往哪边走)
    if (pointer) {
      ctx.save();
      const margin = 46;
      const cx = Math.min(w - margin, Math.max(margin, pointer.x));
      const cy = Math.min(h - 120, Math.max(96, pointer.y));
      ctx.translate(cx, cy);
      if (pointer.offscreen) {
        const angle = Math.atan2(pointer.y - cy, pointer.x - cx);
        ctx.rotate(angle);
        ctx.fillStyle = 'rgba(13,29,27,0.60)';
        ctx.beginPath();
        ctx.moveTo(20, 3); ctx.lineTo(-11, -11); ctx.lineTo(-5, 1); ctx.lineTo(-11, 13);
        ctx.closePath(); ctx.fill();
        const arrow = ctx.createLinearGradient(-8, -8, 17, 7);
        arrow.addColorStop(0, '#fff1b0'); arrow.addColorStop(1, '#eab85d');
        ctx.fillStyle = arrow;
        ctx.beginPath();
        ctx.moveTo(16, 0); ctx.lineTo(-9, -10); ctx.lineTo(-4, 0); ctx.lineTo(-9, 10);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,248,213,0.78)'; ctx.lineWidth = 1.25; ctx.stroke();
        ctx.rotate(-angle);
      } else {
        ctx.fillStyle = 'rgba(16,36,33,0.70)';
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffe59b'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#fff4c5';
        ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(5, 0); ctx.lineTo(0, 5); ctx.lineTo(-5, 0); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(0, -15); ctx.stroke();
      }
      const dText = `${Math.round(pointer.distance)}m`;
      ctx.font = `800 11px ${HUD_FONT}`;
      const dw = ctx.measureText(dText).width + 14;
      this.panel(ctx, -dw / 2, 18, dw, 19, 9, 'sand');
      ctx.fillStyle = '#fff0ba'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(dText, 0, 27.5);
      ctx.restore();
    }

    // 交互提示
    if (hint) {
      const hintCenter = w < 600 ? (w - ACTION_RAIL_W) / 2 : w / 2;
      const hintMaxW = Math.max(150, Math.min(620, w < 600 ? w - ACTION_RAIL_W - 20 : w - 32));
      this.fitFont(ctx, hint, 15, 11, hintMaxW - 42, 800);
      const tw = Math.min(hintMaxW, ctx.measureText(hint).width + 42);
      const hintY = h * 0.62;
      this.panel(ctx, hintCenter - tw / 2, hintY, tw, 36, 13, 'sand');
      this.compassMark(ctx, hintCenter - tw / 2 + 15, hintY + 18, '#ffd788');
      ctx.fillStyle = '#fff2c8';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(hint, hintCenter + 5, hintY + 18);
    }

    if (toast) {
      ctx.font = `800 14px ${HUD_FONT}`;
      const tw = ctx.measureText(toast).width + 34;
      const toastY = compactExpedition ? 188 : 124;
      this.panel(ctx, (w - tw) / 2, toastY, tw, 34, 12, 'sand');
      ctx.fillStyle = '#fff1c8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(toast, w / 2, toastY + 17);
    }

    // 常驻目标只保留一行，解决 toast 消失后玩家不知道下一步做什么的问题。
    if (!visiting && objective) {
      const maxW = Math.min(430, w - 32);
      ctx.font = `700 12px ${HUD_FONT}`;
      let text = objective;
      while (text.length > 8 && ctx.measureText(text).width > maxW - 24) text = `${text.slice(0, -2)}…`;
      const objectiveW = Math.min(maxW, ctx.measureText(text).width + 34);
      const objectiveY = compactExpedition ? (toast ? 230 : 188) : (toast ? 166 : 124);
      this.panel(ctx, 12, objectiveY, objectiveW, 29, 11, 'leaf');
      this.compassMark(ctx, 25, objectiveY + 14.5, '#bde08f');
      ctx.fillStyle = '#f2e4ae'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 36, objectiveY + 14.5);
    }

    if (expedition) {
      const expeditionY = compactExpedition ? 124 : 14;
      this.panel(ctx, w / 2 - 108, expeditionY, 216, 55, 15, 'tide');
      ctx.fillStyle = '#ffe2a2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 14px ${HUD_FONT}`;
      ctx.fillText(expedition.name, w / 2, expeditionY + 18);
      ctx.fillStyle = '#d8ebe1'; ctx.font = `700 12px ${HUD_FONT}`;
      ctx.fillText(`载货 ${expedition.cargoUsed}/${expedition.cargoCapacity} · 木筏处返航`, w / 2, expeditionY + 38);
    }

    if (hurtAlpha > 0) {
      const hurt = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.18, w / 2, h / 2, Math.max(w, h) * 0.7);
      hurt.addColorStop(0, 'rgba(170,18,18,0)');
      hurt.addColorStop(0.62, `rgba(188,24,18,${Math.min(0.09, hurtAlpha * 0.09)})`);
      hurt.addColorStop(1, `rgba(155,8,8,${Math.min(0.42, hurtAlpha * 0.42)})`);
      ctx.fillStyle = hurt;
      ctx.fillRect(0, 0, w, h);
    }

    // 建造按钮(右下竖排)
    for (let bi = 0; bi < buildButtons.length; bi++) {
      const b = buildButtons[bi];
      const r = b.rect;
      const usable = b.affordable && !b.blocked;
      this.panel(ctx, r.x, r.y, r.w, r.h, 12, usable ? 'leaf' : 'muted');
      const accent = usable ? '#9bd476' : b.blocked ? '#e9bd69' : '#ce8376';
      ctx.fillStyle = accent;
      this.round(ctx, r.x + 3, r.y + 8, 3, Math.max(16, r.h - 16), 1.5); ctx.fill();
      ctx.fillStyle = usable ? 'rgba(220,246,201,0.12)' : 'rgba(225,230,221,0.08)';
      this.round(ctx, r.x + 8, r.y + 7, 25, r.h - 14, 8); ctx.fill();
      this.buildingIcon(ctx, b.label, r.x + 20.5, r.y + r.h / 2, usable ? '#f2e1ae' : '#b9c0b8', accent);
      if (b.blocked) {
        ctx.strokeStyle = '#f2c875'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(r.x + 12, r.y + r.h - 10); ctx.lineTo(r.x + 29, r.y + 10); ctx.stroke();
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = usable ? '#fff9e8' : '#e0e5df';
      ctx.font = `800 12.5px ${HUD_FONT}`;
      ctx.fillText(b.label, r.x + 38, r.y + (r.h > 42 ? 14 : 12));
      // 成本行按可用宽度自动缩字号:灯塔要 4 种材料,固定 11px 会顶出按钮外
      const costX = r.x + 38;
      const costMaxW = r.x + r.w - 7 - costX;
      let costFont = 10.5;
      ctx.font = `700 ${costFont}px ${HUD_FONT}`;
      while (costFont > 7.5 && ctx.measureText(b.costText).width > costMaxW) {
        costFont -= 0.5;
        ctx.font = `700 ${costFont}px ${HUD_FONT}`;
      }
      ctx.fillStyle = usable ? '#cfe9b9' : b.affordable ? '#f1cf8b' : '#f0aaa0';
      ctx.fillText(b.costText, costX, r.y + (r.h > 42 ? 33 : 29));

      // 对应既有 1—6 数字键，不扩大或改变按钮命中区域。
      ctx.fillStyle = usable ? 'rgba(215,240,190,0.18)' : 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.arc(r.x + r.w - 11, r.y + 11, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = usable ? '#eaf7d7' : '#c5cbc5';
      ctx.font = `800 9px ${HUD_FONT}`; ctx.textAlign = 'center';
      ctx.fillText(String(bi + 1), r.x + r.w - 11, r.y + 11.5);
    }

    if (showFireActions) {
      // 按钮说的必须是真正会被烤掉的那样东西 —— 有鱼时 cook() 优先烤鱼
      const grillFish = inv.fish > 0;
      const actions: Array<[string, string, string]> = [
        ['木', '加柴', '木材 1 · +60秒'],
        grillFish ? ['鱼', '烤鱼', '鲜鱼 1 · 熟食'] : ['椰', '烤椰子', '椰子 1 · 熟食'],
      ];
      fireActionRects(buildButtons.length).forEach((r: Rect, i: number) => {
        this.panel(ctx, r.x, r.y, r.w, r.h, 12, 'sand');
        ctx.fillStyle = 'rgba(255,225,159,0.13)';
        this.round(ctx, r.x + 8, r.y + 7, 25, r.h - 14, 8); ctx.fill();
        this.actionIcon(ctx, i === 0 ? 'fuel' : 'cook', r.x + 20.5, r.y + r.h / 2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff8e7';
        ctx.font = `800 12.5px ${HUD_FONT}`; ctx.fillText(actions[i][1], r.x + 38, r.y + 14);
        ctx.font = `700 10px ${HUD_FONT}`; ctx.fillStyle = '#f4d29a'; ctx.fillText(actions[i][2], r.x + 38, r.y + 32.5);
      });
    }


    if (upgradeAction) {
      const r = upgradeActionRect(buildButtons.length);
      this.panel(ctx, r.x, r.y, r.w, r.h, 12, upgradeAction.enabled ? 'tide' : 'muted');
      this.upgradeIcon(ctx, r.x + 18, r.y + r.h / 2, upgradeAction.enabled);
      ctx.fillStyle = upgradeAction.enabled ? '#f5fbff' : '#d9dfdc';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = `800 12px ${HUD_FONT}`;
      ctx.fillText(`升级 · ${upgradeAction.label}`, r.x + 34, r.y + 15);
      ctx.fillStyle = upgradeAction.enabled ? '#cde8f2' : '#d4b6b0'; ctx.font = `700 9.5px ${HUD_FONT}`;
      ctx.fillText(upgradeAction.enabled ? upgradeAction.costText : (upgradeAction.reason ?? upgradeAction.costText), r.x + 34, r.y + 34);
    }

    // 虚拟摇杆
    if (input.stickBase) {
      const stickGlow = ctx.createRadialGradient(input.stickBase.x, input.stickBase.y, 8, input.stickBase.x, input.stickBase.y, 50);
      stickGlow.addColorStop(0, 'rgba(235,255,232,0.15)');
      stickGlow.addColorStop(1, 'rgba(12,31,28,0.48)');
      ctx.fillStyle = stickGlow;
      ctx.beginPath(); ctx.arc(input.stickBase.x, input.stickBase.y, 50, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(224,244,223,0.52)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(input.stickBase.x, input.stickBase.y, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(224,244,223,0.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(input.stickBase.x, input.stickBase.y, 31, 0, Math.PI * 2); ctx.stroke();
      if (input.stickPos) {
        const dx = input.stickPos.x - input.stickBase.x;
        const dy = input.stickPos.y - input.stickBase.y;
        const len = Math.hypot(dx, dy);
        const k = len > 46 ? 46 / len : 1;
        const knobX = input.stickBase.x + dx * k;
        const knobY = input.stickBase.y + dy * k;
        const knob = ctx.createRadialGradient(knobX - 5, knobY - 6, 2, knobX, knobY, 23);
        knob.addColorStop(0, 'rgba(244,255,230,0.92)');
        knob.addColorStop(1, 'rgba(116,164,112,0.82)');
        ctx.fillStyle = 'rgba(8,24,22,0.35)';
        ctx.beginPath(); ctx.arc(knobX, knobY + 3, 23, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = knob;
        ctx.beginPath(); ctx.arc(knobX, knobY, 21, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(239,255,231,0.64)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
  }

  /**
   * HUD 面板的统一材质：轻微纵向渐变、内高光和一层硬边投影。
   * 不使用 shadowBlur，避免在每帧重绘的 Canvas 上制造昂贵的离屏模糊。
   */
  private panel(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number,
    tone: PanelTone,
  ): void {
    const p = PANEL_TONES[tone];
    ctx.save();
    ctx.fillStyle = 'rgba(5,18,17,0.34)';
    this.round(ctx, x, y + 3, w, h, r); ctx.fill();
    const fill = ctx.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, p.top); fill.addColorStop(1, p.bottom);
    ctx.fillStyle = fill;
    this.round(ctx, x, y, w, h, r); ctx.fill();
    ctx.strokeStyle = p.border; ctx.lineWidth = 1;
    this.round(ctx, x + 0.5, y + 0.5, w - 1, h - 1, Math.max(1, r - 0.5)); ctx.stroke();
    ctx.strokeStyle = p.shine; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + r, y + 2.5); ctx.lineTo(x + w - r, y + 2.5);
    ctx.stroke();
    ctx.restore();
  }

  private meter(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    value: number, color: string,
  ): void {
    const p = Math.max(0, Math.min(1, value));
    ctx.fillStyle = 'rgba(4,17,16,0.52)';
    this.round(ctx, x, y, w, h, h / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(235,248,233,0.12)'; ctx.lineWidth = 1;
    this.round(ctx, x + 0.5, y + 0.5, w - 1, h - 1, Math.max(1, h / 2 - 0.5)); ctx.stroke();
    const fw = Math.max(2, w * p);
    const fill = ctx.createLinearGradient(x, y, x, y + h);
    fill.addColorStop(0, color); fill.addColorStop(1, color);
    ctx.fillStyle = fill;
    this.round(ctx, x + 1, y + 1, Math.max(1, fw - 2), Math.max(2, h - 2), Math.max(1, (h - 2) / 2)); ctx.fill();
    if (fw > 8) {
      ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 4, y + 2); ctx.lineTo(x + fw - 3, y + 2); ctx.stroke();
    }
  }

  private fitFont(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxSize: number,
    minSize: number,
    maxWidth: number,
    weight: number,
  ): number {
    let size = maxSize;
    ctx.font = `${weight} ${size}px ${HUD_FONT}`;
    while (size > minSize && ctx.measureText(text).width > maxWidth) {
      size -= 0.5;
      ctx.font = `${weight} ${size}px ${HUD_FONT}`;
    }
    return size;
  }

  private vitalIcon(
    ctx: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    color: string,
  ): void {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(4,16,15,0.32)';
    ctx.beginPath(); ctx.arc(0, 1.5, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.strokeStyle = 'rgba(255,248,222,0.52)'; ctx.lineWidth = 1;
    if (label === '生命') {
      ctx.beginPath();
      ctx.moveTo(0, 6); ctx.lineTo(-6.5, 0); ctx.lineTo(-5.5, -4.5);
      ctx.lineTo(-2, -6); ctx.lineTo(0, -3.5); ctx.lineTo(2, -6);
      ctx.lineTo(5.5, -4.5); ctx.lineTo(6.5, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (label === '饥饿') {
      ctx.beginPath();
      ctx.moveTo(-6.5, -1); ctx.lineTo(6.5, -1); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-7, -3); ctx.lineTo(7, -3); ctx.stroke();
    } else if (label === '口渴') {
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.bezierCurveTo(4, -2, 6, 0.5, 6, 3);
      ctx.bezierCurveTo(6, 7, -6, 7, -6, 3); ctx.bezierCurveTo(-6, 0.5, -4, -2, 0, -7);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(1, -7); ctx.lineTo(-5, 1); ctx.lineTo(-1, 1);
      ctx.lineTo(-3, 7); ctx.lineTo(6, -2); ctx.lineTo(2, -2); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  private skyIcon(ctx: CanvasRenderingContext2D, night: boolean, x: number, y: number): void {
    ctx.save(); ctx.translate(x, y);
    if (night) {
      ctx.fillStyle = '#d9eff0';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.arc(3, -2, 6, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.fillStyle = '#a7d9de';
      ctx.beginPath(); ctx.arc(7, -6, 1.2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = '#ffe7a1'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5);
        ctx.lineTo(Math.cos(a) * 11, Math.sin(a) * 11); ctx.stroke();
      }
      const sun = ctx.createRadialGradient(-2, -2, 1, 0, 0, 7);
      sun.addColorStop(0, '#fff5bd'); sun.addColorStop(1, '#efbd58');
      ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  private compassMark(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(7,24,21,0.36)';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 1); ctx.lineTo(0, 6); ctx.lineTo(-4, 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.beginPath(); ctx.moveTo(0, -4.5); ctx.lineTo(1.5, 0); ctx.lineTo(-1.5, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  private buildingIcon(
    ctx: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    ink: string,
    accent: string,
  ): void {
    ctx.save(); ctx.translate(x, y);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 1.2;
    ctx.strokeStyle = ink; ctx.fillStyle = accent;
    if (label === '篝火') {
      ctx.strokeStyle = ink; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-7, 6); ctx.lineTo(7, 2); ctx.moveTo(-7, 2); ctx.lineTo(7, 6); ctx.stroke();
      ctx.fillStyle = accent; ctx.strokeStyle = ink; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, 3); ctx.bezierCurveTo(-7, -1, -2, -8, 1, -10);
      ctx.bezierCurveTo(2, -5, 8, -2, 4, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (label === '庇护所') {
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.moveTo(-9, -1); ctx.lineTo(0, -9); ctx.lineTo(9, -1); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(238,229,190,0.42)';
      ctx.fillRect(-6, 0, 12, 7); ctx.strokeRect(-6, 0, 12, 7);
      ctx.fillStyle = ink; ctx.fillRect(-1.5, 2, 3, 5);
    } else if (label === '集雨器') {
      ctx.fillStyle = 'rgba(126,201,218,0.58)';
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.lineTo(5, 7); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.bezierCurveTo(4, -4, 5, -2, 5, 0); ctx.bezierCurveTo(5, 4, -5, 4, -5, 0); ctx.bezierCurveTo(-5, -2, -4, -4, 0, -9); ctx.fill();
    } else if (label === '码头') {
      ctx.strokeStyle = ink; ctx.lineWidth = 1.3;
      for (let i = -1; i <= 1; i++) {
        const yy = i * 4;
        ctx.beginPath(); ctx.moveTo(-8, yy - 2); ctx.lineTo(8, yy + 1); ctx.stroke();
      }
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(-7, 8); ctx.moveTo(7, -5); ctx.lineTo(7, 9); ctx.stroke();
    } else if (label === '制图桌') {
      ctx.fillStyle = 'rgba(243,225,169,0.72)';
      ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(-2, -8); ctx.lineTo(2, -5); ctx.lineTo(9, -7); ctx.lineTo(8, 6); ctx.lineTo(1, 8); ctx.lineTo(-2, 5); ctx.lineTo(-9, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(-2, 5); ctx.moveTo(2, -5); ctx.lineTo(1, 8); ctx.stroke();
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(4, 1, 2, 0, Math.PI * 2); ctx.fill();
    } else if (label === '灯塔') {
      ctx.fillStyle = 'rgba(238,236,215,0.72)';
      ctx.beginPath(); ctx.moveTo(-5, 8); ctx.lineTo(-3, -5); ctx.lineTo(3, -5); ctx.lineTo(5, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = accent; ctx.fillRect(-4.5, -6.5, 9, 3.5); ctx.strokeRect(-4.5, -6.5, 9, 3.5);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(-10, -10); ctx.moveTo(6, -8); ctx.lineTo(10, -10); ctx.stroke();
    } else if (label === '花圃') {
      ctx.fillStyle = 'rgba(124,76,43,0.72)';
      ctx.beginPath(); ctx.ellipse(0, 6, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -7); ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.ellipse(-4, -3, 4.5, 2.5, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(4, -6, 4.5, 2.5, -0.5, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = accent;
      for (const [dx, dy] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
        ctx.beginPath(); ctx.moveTo(dx, dy - 3); ctx.lineTo(dx + 3, dy); ctx.lineTo(dx, dy + 3); ctx.lineTo(dx - 3, dy); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  private actionIcon(ctx: CanvasRenderingContext2D, kind: 'fuel' | 'cook', x: number, y: number): void {
    ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (kind === 'fuel') {
      ctx.strokeStyle = '#f7ddb0'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-7, 5); ctx.lineTo(7, 1); ctx.moveTo(-7, 1); ctx.lineTo(7, 5); ctx.stroke();
      ctx.fillStyle = '#ef9a52';
      ctx.beginPath(); ctx.moveTo(0, 1); ctx.bezierCurveTo(-6, -3, -1, -9, 1, -10); ctx.bezierCurveTo(2, -6, 7, -3, 3, 1); ctx.fill();
    } else {
      ctx.fillStyle = '#f4dfae'; ctx.strokeStyle = '#c58c53'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 1, 7.5, 0, Math.PI); ctx.lineTo(-7.5, 1); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#fff0c5';
      ctx.beginPath(); ctx.moveTo(-6, -1); ctx.lineTo(6, -1); ctx.stroke();
      ctx.strokeStyle = '#ecc271';
      ctx.beginPath(); ctx.moveTo(-3, -5); ctx.quadraticCurveTo(-5, -8, -2, -10); ctx.moveTo(3, -5); ctx.quadraticCurveTo(5, -8, 2, -10); ctx.stroke();
    }
    ctx.restore();
  }

  private upgradeIcon(ctx: CanvasRenderingContext2D, x: number, y: number, enabled: boolean): void {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = enabled ? 'rgba(199,235,244,0.15)' : 'rgba(230,235,230,0.08)';
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = enabled ? '#d9f1f5' : '#aeb9b6';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, -1); ctx.lineTo(3, -1); ctx.lineTo(3, 6); ctx.lineTo(-3, 6); ctx.lineTo(-3, -1); ctx.lineTo(-7, -1); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  private round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private itemIcon(ctx: CanvasRenderingContext2D, kind: ItemKind, x: number, y: number): void {
    ctx.save(); ctx.translate(x, y); ctx.lineWidth = 2;
    if (kind === 'wood') {
      ctx.strokeStyle = '#e0a26b'; ctx.fillStyle = '#8d5b36';
      ctx.rotate(-0.35); this.round(ctx, -11, -5, 22, 10, 4); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(-4, 4); ctx.stroke();
    } else if (kind === 'fiber') {
      ctx.fillStyle = '#78c957';
      for (const a of [-0.7, 0, 0.7]) { ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, -5, 4, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    } else if (kind === 'stone') {
      ctx.fillStyle = '#9da39f'; ctx.strokeStyle = '#69716e';
      ctx.beginPath(); ctx.moveTo(-10, 4); ctx.lineTo(-7, -6); ctx.lineTo(2, -9); ctx.lineTo(10, -2); ctx.lineTo(7, 7); ctx.lineTo(-3, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (kind === 'food') {
      ctx.fillStyle = '#eee0ba'; ctx.strokeStyle = '#9a663d';
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 10, 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (kind === 'cookedFood') {
      ctx.fillStyle = '#d7b06a'; ctx.beginPath(); ctx.arc(0, 2, 9, 0, Math.PI); ctx.lineTo(-9, 2); ctx.fill();
      ctx.strokeStyle = '#f5e5b5'; ctx.beginPath(); ctx.moveTo(-7, -1); ctx.lineTo(7, -1); ctx.stroke();
    } else if (kind === 'fish') {
      // 鲜鱼:侧身的鱼,尾鳍向左
      ctx.fillStyle = '#8fb6c9'; ctx.strokeStyle = '#4d7288';
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.quadraticCurveTo(3, -7, 10, 0);
      ctx.quadraticCurveTo(3, 7, -3, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-10, -5); ctx.lineTo(-10, 5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#22384a';
      ctx.beginPath(); ctx.arc(6, -1, 1.4, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'cloth') {
      // 帆布:一片带褶的布
      ctx.fillStyle = '#e2dcc0'; ctx.strokeStyle = '#a89c74';
      ctx.beginPath();
      ctx.moveTo(-9, -8); ctx.lineTo(9, -8); ctx.lineTo(9, 5);
      ctx.quadraticCurveTo(4, 10, 0, 5); ctx.quadraticCurveTo(-4, 0, -9, 5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(-2, 3); ctx.stroke();
    } else if (kind === 'metal') {
      // 铁件:一枚带铆钉的铁板
      ctx.fillStyle = '#9fb0bb'; ctx.strokeStyle = '#5f7480';
      ctx.beginPath();
      ctx.moveTo(-9, -5); ctx.lineTo(4, -8); ctx.lineTo(9, 1); ctx.lineTo(2, 8); ctx.lineTo(-8, 5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e6eef2';
      for (const [rx, ry] of [[-4, -1], [3, 2]]) { ctx.beginPath(); ctx.arc(rx, ry, 1.6, 0, Math.PI * 2); ctx.fill(); }
    } else {
      // 种子:两粒带芽的种子
      ctx.fillStyle = '#b8894a'; ctx.strokeStyle = '#7a5a2f';
      for (const [sx, sy] of [[-4, 3], [4, 1]]) {
        ctx.beginPath(); ctx.ellipse(sx, sy, 4, 5.5, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.strokeStyle = '#7ac95c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(4, -4); ctx.quadraticCurveTo(7, -9, 2, -10); ctx.stroke();
    }
    ctx.restore();
  }
}
