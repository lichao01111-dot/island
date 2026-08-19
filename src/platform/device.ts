// 触屏与安全区检测。手机和平板都要用,不能只按窗口宽度判断 ——
// 平板(768/1024)和横屏手机都超过 600px,只按宽度会把它们当成桌面,
// 从而显示"按 Q/R"这种键盘提示,但触屏设备根本没有 Q/R。

export interface SafeArea { top: number; right: number; bottom: number; left: number }

/** 主输入是粗糙指针(手指)的手机/平板。带触摸屏的桌面(鼠标为主)返回 false。 */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

/** 任何能触摸的设备(手机/平板/带触摸屏的桌面)。微信小游戏运行时没有 window,返回 false。 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return isCoarsePointer()
    || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
    || 'ontouchstart' in window;
}

const ZERO: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
let safeAreaCache: SafeArea | null = null;

function readSafeArea(): SafeArea {
  if (typeof window === 'undefined' || typeof document === 'undefined') return ZERO;
  // 不支持 env(safe-area-inset-*) 的浏览器直接返回 0
  if (typeof CSS !== 'undefined' && CSS.supports
    && !CSS.supports('padding-top', 'env(safe-area-inset-top)')) return ZERO;
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top) env(safe-area-inset-right)'
      + ' env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const px = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const out: SafeArea = {
      top: px(cs.paddingTop),
      right: px(cs.paddingRight),
      bottom: px(cs.paddingBottom),
      left: px(cs.paddingLeft),
    };
    probe.remove();
    return out;
  } catch {
    return ZERO;
  }
}

/** 安全区(刘海/圆角/Home 条)。横竖屏切换会变,所以 resize 后要清一次缓存。 */
export function safeAreaInsets(): SafeArea {
  if (!safeAreaCache) safeAreaCache = readSafeArea();
  return safeAreaCache;
}

/** 旋转屏幕/窗口变化后调用,让下次 safeAreaInsets() 重新读取。 */
export function refreshSafeArea(): void {
  safeAreaCache = null;
}
