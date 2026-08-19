// 复用 chacha 的本地存储适配思路:微信小游戏与浏览器使用同一接口。
declare const wx: {
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: string): void;
} | undefined;

function isWeChatRuntime(): boolean {
  return typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function';
}

export function storageGet(key: string): string | null {
  try {
    if (isWeChatRuntime()) {
      const value = wx!.getStorageSync(key);
      return value === '' || value == null ? null : String(value);
    }
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    if (isWeChatRuntime()) wx!.setStorageSync(key, value);
    else if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch { /* 存储失败不阻断游戏 */ }
}
