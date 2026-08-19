// 输入:移动端虚拟摇杆(左半屏拖拽)+ 桌面 WASD/方向键,输出统一的方向向量
import { buildButtonRects, fireActionRects, itemSlotRects, upgradeActionRect, BASE_ITEMS } from './hud';
import type { ItemKind } from './hud';

export class Input {
  dirX = 0;
  dirZ = 0;
  actionPressed = false; // 采集键/按钮:本帧是否按下
  eatPressed = false;    // 进食(F 键 / 点底部食物格)
  buildRequest = -1;     // 请求建造的按钮下标,-1 = 无
  buildCount = 0;        // 当前建造按钮数量(由主循环同步,用于命中检测)
  fuelPressed = false;
  cookPressed = false;
  upgradePressed = false;
  upgradeEnabled = false;
  fireActionsEnabled = false;
  // 物资栏当前显示的格子(由主循环同步),命中检测必须和 HUD 画的完全一致
  itemKinds: ItemKind[] = [...BASE_ITEMS];

  private keys = new Set<string>();
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  stickPos: { x: number; y: number } | null = null; // 供 HUD 绘制
  stickBase: { x: number; y: number } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (e.key === ' ' || k === 'e') this.actionPressed = true;
      if (k === 'f') this.eatPressed = true;
      if (k === 'q') this.fuelPressed = true;
      if (k === 'r') this.cookPressed = true;
      if (k === 'u') this.upgradePressed = true;
      // 数字键建造:建筑解锁后最多 6 个
      const slot = '123456'.indexOf(k);
      if (slot >= 0) this.buildRequest = slot;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    const touchStart = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.hitUpgradeAction(t.clientX, t.clientY)) {
          this.upgradePressed = true;
          continue;
        }
        const action = this.hitFireAction(t.clientX, t.clientY);
        const bi = this.hitBuildButton(t.clientX, t.clientY);
        if (action === 0) {
          this.fuelPressed = true;
        } else if (action === 1) {
          this.cookPressed = true;
        } else if (bi >= 0) {
          this.buildRequest = bi; // 建造按钮优先
        } else if (this.inFoodSlot(t.clientX, t.clientY)) {
          this.eatPressed = true;
        } else if (t.clientX < window.innerWidth * 0.55 && this.stickId === null) {
          this.stickId = t.identifier;
          this.stickOrigin = { x: t.clientX, y: t.clientY };
          this.stickBase = { x: t.clientX, y: t.clientY };
          this.stickPos = { x: t.clientX, y: t.clientY };
        } else {
          this.actionPressed = true; // 右半屏点击 = 采集
        }
      }
    };
    const touchMove = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.stickId) {
          this.stickPos = { x: t.clientX, y: t.clientY };
          const dx = t.clientX - this.stickOrigin.x;
          const dy = t.clientY - this.stickOrigin.y;
          const max = 70;
          const len = Math.hypot(dx, dy);
          const k = len > max ? max / len : 1;
          this.dirX = (dx * k) / max;
          this.dirZ = (dy * k) / max;
        }
      }
    };
    const touchEnd = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.stickId) {
          this.stickId = null;
          this.stickPos = null;
          this.stickBase = null;
          this.dirX = 0;
          this.dirZ = 0;
        }
      }
    };
    canvas.addEventListener('touchstart', touchStart, { passive: false });
    canvas.addEventListener('touchmove', touchMove, { passive: false });
    canvas.addEventListener('touchend', touchEnd, { passive: false });
    canvas.addEventListener('touchcancel', touchEnd, { passive: false });

    // 桌面:鼠标点击也算采集(点建造按钮/食物格则对应动作),方便调试
    canvas.addEventListener('mousedown', (e) => {
      if (this.hitUpgradeAction(e.clientX, e.clientY)) {
        this.upgradePressed = true;
        return;
      }
      const action = this.hitFireAction(e.clientX, e.clientY);
      const bi = this.hitBuildButton(e.clientX, e.clientY);
      if (action === 0) this.fuelPressed = true;
      else if (action === 1) this.cookPressed = true;
      else if (bi >= 0) this.buildRequest = bi;
      else if (this.inFoodSlot(e.clientX, e.clientY)) this.eatPressed = true;
      else this.actionPressed = true;
    });
  }

  private hitFireAction(x: number, y: number): number {
    if (!this.fireActionsEnabled) return -1;
    const rects = fireActionRects(this.buildCount);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    return -1;
  }

  private hitBuildButton(x: number, y: number): number {
    const rects = buildButtonRects(this.buildCount);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    return -1;
  }

  private hitUpgradeAction(x: number, y: number): boolean {
    if (!this.upgradeEnabled) return false;
    const r = upgradeActionRect(this.buildCount);
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }

  consumeBuild(): number {
    const v = this.buildRequest;
    this.buildRequest = -1;
    return v;
  }

  // 点物资栏里的生椰子/烤椰子格 = 进食,与 Hud 共用 itemSlotRects
  private inFoodSlot(x: number, y: number): boolean {
    const rects = itemSlotRects(this.itemKinds.length);
    return this.itemKinds.some((kind, i) => {
      if (kind !== 'food' && kind !== 'cookedFood') return false;
      const r = rects[i];
      return x >= r.x && x < r.x + r.w && y >= r.y && y <= r.y + r.h;
    });
  }

  consumeEat(): boolean {
    const v = this.eatPressed;
    this.eatPressed = false;
    return v;
  }

  consumeFuel(): boolean { const v = this.fuelPressed; this.fuelPressed = false; return v; }
  consumeCook(): boolean { const v = this.cookPressed; this.cookPressed = false; return v; }
  consumeUpgrade(): boolean { const v = this.upgradePressed; this.upgradePressed = false; return v; }

  // 返回相机空间的移动方向(x 右、z 前),键盘覆盖摇杆
  read(): { x: number; z: number } {
    let x = this.dirX;
    let z = this.dirZ;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x = -1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x = 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) z = -1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) z = 1;
    return { x, z };
  }

  // 输入缓冲:点击后 BUFFER_MS 内一直算"待执行",避免掉帧/挥动中丢输入
  private static readonly BUFFER_MS = 300;
  private actionAt = -1;

  markAction(): void { this.actionAt = performance.now(); }

  // 有待执行的采集意图?(不消费)
  get actionQueued(): boolean {
    if (this.actionPressed) { this.actionPressed = false; this.markAction(); }
    return this.actionAt > 0 && performance.now() - this.actionAt < Input.BUFFER_MS;
  }

  // 真正执行后才清除
  clearAction(): void { this.actionAt = -1; }
}
